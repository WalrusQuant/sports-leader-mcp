import { DataExportError } from "./errors.js";

export interface ManifestColumn {
  name: string;
  type: string;
}

export interface ManifestFile {
  path: string;
  league: string;
  dataset: string;
  season: number;
  rows: number;
  columns: ManifestColumn[];
  bytes: number;
  sha256: string;
  updated_at: string;
  /** Absolute download URL. GitHub Releases publishes one per file. */
  url?: string;
}

export interface ManifestDataset {
  leagues?: string[];
  about?: string;
}

export interface Manifest {
  version: number;
  generated_at: string;
  ids?: string;
  datasets: Record<string, ManifestDataset>;
  files: ManifestFile[];
}

const PATH_RE = /^(mlb|nba|nfl|nhl)\/[a-z0-9_]+\/\d{4}\.parquet$/;
const SHA_RE = /^[a-f0-9]{64}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reqString(obj: Record<string, unknown>, key: string, label: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new DataExportError(`manifest ${label} is missing ${key}`);
  }
  return value;
}

function reqNumber(obj: Record<string, unknown>, key: string, label: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DataExportError(`manifest ${label} is missing ${key}`);
  }
  return value;
}

export function parseManifest(raw: unknown): Manifest {
  if (!isRecord(raw)) throw new DataExportError("manifest is not a JSON object");
  if (!Array.isArray(raw.files)) throw new DataExportError("manifest is missing files");
  const version = raw.version;
  if (typeof version !== "number") throw new DataExportError("manifest is missing version");
  const generatedAt = raw.generated_at;
  if (typeof generatedAt !== "string" || generatedAt.length === 0) {
    throw new DataExportError("manifest is missing generated_at");
  }

  const datasets: Record<string, ManifestDataset> = {};
  if (isRecord(raw.datasets)) {
    for (const [name, info] of Object.entries(raw.datasets)) {
      if (!isRecord(info)) continue;
      const leagues = Array.isArray(info.leagues)
        ? info.leagues.filter((league): league is string => typeof league === "string")
        : undefined;
      datasets[name] = {
        leagues,
        about: typeof info.about === "string" ? info.about : undefined,
      };
    }
  }

  const files: ManifestFile[] = raw.files.map((entry, index) => {
    if (!isRecord(entry)) throw new DataExportError(`manifest files[${index}] is not an object`);
    const label = `files[${index}]`;
    const league = reqString(entry, "league", label);
    const dataset = reqString(entry, "dataset", label);
    const season = reqNumber(entry, "season", label);
    const filePath = reqString(entry, "path", label);
    if (!PATH_RE.test(filePath) || filePath !== `${league}/${dataset}/${season}.parquet`) {
      throw new DataExportError(`manifest path does not match league/dataset/season: ${filePath}`);
    }
    const sha256 = reqString(entry, "sha256", label);
    if (!SHA_RE.test(sha256)) throw new DataExportError(`manifest ${filePath} has an invalid sha256`);
    if (!Array.isArray(entry.columns) || entry.columns.length === 0) {
      throw new DataExportError(`manifest ${filePath} is missing columns`);
    }
    const columns: ManifestColumn[] = entry.columns.map((column, columnIndex) => {
      if (!isRecord(column) || typeof column.name !== "string" || typeof column.type !== "string") {
        throw new DataExportError(`manifest ${filePath} column ${columnIndex} is invalid`);
      }
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(column.name)) {
        throw new DataExportError(`manifest ${filePath} has an illegal column name`);
      }
      return { name: column.name, type: column.type };
    });
    let url: string | undefined;
    if (typeof entry.url === "string" && entry.url.length > 0) {
      let parsed: URL;
      try {
        parsed = new URL(entry.url);
      } catch {
        throw new DataExportError(`manifest ${filePath} has an invalid url`);
      }
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new DataExportError(`manifest ${filePath} url must be http or https`);
      }
      if (parsed.username || parsed.password) {
        throw new DataExportError(`manifest ${filePath} url must not include credentials`);
      }
      url = parsed.href;
    }
    return {
      path: filePath,
      league,
      dataset,
      season,
      rows: reqNumber(entry, "rows", label),
      columns,
      bytes: reqNumber(entry, "bytes", label),
      sha256: sha256.toLowerCase(),
      updated_at: reqString(entry, "updated_at", label),
      url,
    };
  });

  return {
    version,
    generated_at: generatedAt,
    ids: typeof raw.ids === "string" ? raw.ids : undefined,
    datasets,
    files,
  };
}

export function currentSeasonByLeague(manifest: Manifest): Map<string, number> {
  const max = new Map<string, number>();
  for (const file of manifest.files) {
    const prev = max.get(file.league);
    if (prev === undefined || file.season > prev) max.set(file.league, file.season);
  }
  return max;
}

export function isCurrentSeasonFile(manifest: Manifest, file: ManifestFile): boolean {
  return file.season === currentSeasonByLeague(manifest).get(file.league);
}
