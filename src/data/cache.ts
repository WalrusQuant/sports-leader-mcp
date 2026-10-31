import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { STALE_AFTER_MS, type DataConfig } from "./config.js";
import { datasetInfo } from "./datasets.js";
import { ChecksumMismatchError, DataExportError } from "./errors.js";
import { dataFetch, type DataDeps } from "./http.js";
import {
  currentSeasonByLeague,
  parseManifest,
  type Manifest,
  type ManifestFile,
} from "./manifest.js";

interface CacheMeta {
  etag: string | null;
  checkedAt: number;
  sha256?: string;
  updated_at?: string;
}

const inflight = new Map<string, Promise<unknown>>();

function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

export function sha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    const text = await readFile(file, "utf8");
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function atomicWrite(dest: string, body: Buffer | string): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
  const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, dest);
}

function cachePaths(config: DataConfig) {
  return {
    manifest: path.join(config.cacheDir, "manifest.json"),
    manifestMeta: path.join(config.cacheDir, "manifest.meta.json"),
  };
}

function parquetPath(config: DataConfig, rel: string): string {
  if (!/^(mlb|nba|nfl|nhl)\/[a-z0-9_]+\/\d{4}\.parquet$/.test(rel)) {
    throw new DataExportError(`refusing manifest path ${rel}`);
  }
  const root = path.resolve(config.cacheDir, "files");
  const dest = path.resolve(root, rel);
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw new DataExportError(`refusing manifest path ${rel}`);
  }
  return dest;
}

async function fileSha256(file: string): Promise<string | null> {
  try {
    return sha256(await readFile(file));
  } catch {
    return null;
  }
}

export async function loadManifest(config: DataConfig, deps: DataDeps, opts?: { force?: boolean }): Promise<Manifest> {
  return once(`manifest:${config.cacheDir}`, async () => {
    const paths = cachePaths(config);
    const meta = await readJson<CacheMeta>(paths.manifestMeta);
    const fresh = meta !== null && !opts?.force && deps.now() - meta.checkedAt < config.revalidateMs;
    if (fresh) {
      const cached = await readJson<unknown>(paths.manifest);
      if (cached) return parseManifest(cached);
    }

    const res = await dataFetch(config, "manifest.json", deps, meta?.etag);
    if (res.status === 304) {
      await atomicWrite(paths.manifestMeta, JSON.stringify({ etag: res.etag ?? meta?.etag ?? null, checkedAt: deps.now() }));
      const cached = await readJson<unknown>(paths.manifest);
      if (!cached) throw new DataExportError("manifest cache missing after 304");
      return parseManifest(cached);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(res.body!.toString("utf8"));
    } catch {
      throw new DataExportError("manifest is not valid JSON");
    }
    const manifest = parseManifest(parsed);
    await atomicWrite(paths.manifest, res.body!);
    await atomicWrite(paths.manifestMeta, JSON.stringify({ etag: res.etag, checkedAt: deps.now() }));
    return manifest;
  });
}

/**
 * Return a local parquet path whose bytes match the manifest.
 *
 * The manifest is refreshed at most every `revalidateMs`. File validity does
 * not require an ETag: a local file is reused when its sha256 matches the
 * manifest, for past seasons indefinitely and for the current season as soon
 * as that manifest check has run. `updated_at` is stored beside the file and
 * is what staleness reporting uses. A checksum miss downloads the object
 * (following redirects) and rejects bytes that still do not match.
 */
export async function ensureParquet(config: DataConfig, entry: ManifestFile, deps: DataDeps): Promise<string> {
  const dest = parquetPath(config, entry.path);
  return once(`file:${dest}`, () => ensureParquetUncached(config, entry, deps, dest));
}

async function writeMeta(metaPath: string, meta: CacheMeta): Promise<void> {
  await atomicWrite(metaPath, JSON.stringify(meta));
}

async function ensureParquetUncached(
  config: DataConfig,
  entry: ManifestFile,
  deps: DataDeps,
  dest: string,
): Promise<string> {
  const metaPath = `${dest}.meta.json`;
  const meta = await readJson<CacheMeta>(metaPath);
  const localHash = await fileSha256(dest);

  if (localHash === entry.sha256) {
    if (meta?.sha256 !== entry.sha256 || meta?.updated_at !== entry.updated_at) {
      await writeMeta(metaPath, {
        etag: meta?.etag ?? null,
        checkedAt: deps.now(),
        sha256: entry.sha256,
        updated_at: entry.updated_at,
      });
    }
    return dest;
  }

  const res = await dataFetch(config, entry.path, deps);
  if (res.status === 304 || !res.body) {
    throw new DataExportError(`data export returned no body for ${entry.path}`);
  }
  const hash = sha256(res.body);
  if (hash !== entry.sha256) throw new ChecksumMismatchError(entry.path);
  await atomicWrite(dest, res.body);
  await writeMeta(metaPath, {
    etag: res.etag,
    checkedAt: deps.now(),
    sha256: hash,
    updated_at: entry.updated_at,
  });
  return dest;
}

export async function ensureParquetRetry(
  config: DataConfig,
  entry: ManifestFile,
  deps: DataDeps,
): Promise<{ manifest: Manifest; path: string; file: ManifestFile }> {
  let manifest = await loadManifest(config, deps);
  let file = manifest.files.find((item) => item.path === entry.path) ?? entry;
  try {
    const local = await ensureParquet(config, file, deps);
    return { manifest, path: local, file };
  } catch (err) {
    if (!(err instanceof ChecksumMismatchError)) throw err;
    manifest = await loadManifest(config, deps, { force: true });
    file = manifest.files.find((item) => item.path === entry.path) ?? file;
    const local = await ensureParquet(config, file, deps);
    return { manifest, path: local, file };
  }
}

export interface StatusFile {
  path: string;
  league: string;
  dataset: string;
  season: number;
  rows: number;
  bytes: number;
  columnCount: number;
  columns?: { name: string; type: string }[];
  updated_at: string;
  currentSeason: boolean;
  ageHours: number | null;
  stale: boolean;
}

export interface DataStatus {
  configured: true;
  baseUrl: string;
  apiKeyConfigured: boolean;
  cacheDir: string;
  version: number;
  generated_at: string;
  ids?: string;
  staleAfterHours: number;
  datasetCount: number;
  fileCount: number;
  datasets: { dataset: string; leagues: string[]; about?: string; fileCount: number }[];
  files: StatusFile[];
  stale: { path: string; league: string; dataset: string; season: number; updated_at: string; ageHours: number | null }[];
}

export async function dataStatus(config: DataConfig, deps: DataDeps, includeColumns = false): Promise<DataStatus> {
  const manifest = await loadManifest(config, deps);
  const current = currentSeasonByLeague(manifest);
  const now = deps.now();
  const files: StatusFile[] = manifest.files.map((file) => {
    const parsed = Date.parse(file.updated_at);
    const ageMs = Number.isNaN(parsed) ? null : now - parsed;
    const ageHours = ageMs === null ? null : Math.round((ageMs / 3_600_000) * 10) / 10;
    const currentSeason = file.season === current.get(file.league);
    const stale = currentSeason && (ageMs === null || ageMs > STALE_AFTER_MS);
    return {
      path: file.path,
      league: file.league,
      dataset: file.dataset,
      season: file.season,
      rows: file.rows,
      bytes: file.bytes,
      columnCount: file.columns.length,
      ...(includeColumns ? { columns: file.columns } : {}),
      updated_at: file.updated_at,
      currentSeason,
      ageHours,
      stale,
    };
  });

  const byDataset = new Map<string, StatusFile[]>();
  for (const file of files) {
    const list = byDataset.get(file.dataset) ?? [];
    list.push(file);
    byDataset.set(file.dataset, list);
  }

  const datasets = [...byDataset.entries()].map(([dataset, list]) => {
    const info = manifest.datasets[dataset];
    const catalog = datasetInfo(dataset);
    const leagues = info?.leagues?.length
      ? info.leagues
      : [...new Set(list.map((file) => file.league))].sort();
    return {
      dataset,
      leagues,
      about: info?.about ?? catalog?.about,
      fileCount: list.length,
    };
  });

  const stale = files
    .filter((file) => file.stale)
    .map((file) => ({
      path: file.path,
      league: file.league,
      dataset: file.dataset,
      season: file.season,
      updated_at: file.updated_at,
      ageHours: file.ageHours,
    }));

  return {
    configured: true,
    baseUrl: config.baseUrl,
    apiKeyConfigured: config.apiKey !== null,
    cacheDir: config.cacheDir,
    version: manifest.version,
    generated_at: manifest.generated_at,
    ids: manifest.ids,
    staleAfterHours: STALE_AFTER_MS / 3_600_000,
    datasetCount: datasets.length,
    fileCount: files.length,
    datasets,
    files,
    stale,
  };
}
