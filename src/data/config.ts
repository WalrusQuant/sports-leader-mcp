import os from "node:os";
import path from "node:path";

import { DataExportError } from "./errors.js";
import { dataUrl } from "./http.js";

/**
 * Public manifest for the historical Parquet export. No API key.
 * Each file entry has its own `url` (GitHub Releases:
 * `releases/download/<league>_<dataset>/<season>.parquet`).
 * `www` is not used. Override with `SPORTSLEADER_DATA_MANIFEST_URL`
 * (`BAYES_DATA_MANIFEST_URL` is the same setting).
 * `SPORTSLEADER_DATA_BASE_URL` (`BAYES_DATA_BASE_URL` still works) selects a
 * directory-style mirror (`{base}/manifest.json` and `{base}/<path>` when a
 * file has no url).
 */
export const DEFAULT_BAYES_DATA_MANIFEST_URL =
  "https://github.com/WalrusQuant/sportsleader-data/releases/download/manifest/manifest.json";

/** How long to trust a cached manifest before checking the host again. */
export const DEFAULT_REVALIDATE_MS = 4 * 60 * 60 * 1000;

/** get_data_status flags a current-season file older than this while the league is in season. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * A current season is in season when its games file has a game on or before
 * today and within this many days. Older than that, the league is off-season
 * and its files are not flagged stale.
 */
export const OFFSEASON_QUIET_DAYS = 7;

export const NOT_CONFIGURED = "data export not configured";

export interface DataConfig {
  /** Absolute manifest URL. */
  manifestUrl: string;
  /**
   * Directory used only when a manifest file omits `url`.
   * Null for the GitHub Releases default, where every file has a url.
   */
  baseUrl: string | null;
  cacheDir: string;
  revalidateMs: number;
}

function defaultCacheDir(env: NodeJS.ProcessEnv): string {
  const base = env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(base, "sports-leader-mcp", "bayes-data");
}

function readRevalidateMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_REVALIDATE_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new DataExportError("BAYES_DATA_REVALIDATE_MS must be a non-negative number of milliseconds");
  }
  return n;
}

export function normalizeBaseUrl(raw: string, label = "BAYES_DATA_BASE_URL"): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DataExportError(`${NOT_CONFIGURED}: ${label} is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DataExportError(`${NOT_CONFIGURED}: ${label} must be http or https`);
  }
  if (url.username || url.password) {
    throw new DataExportError(`${NOT_CONFIGURED}: ${label} must not include credentials`);
  }
  url.hash = "";
  return url.href.replace(/\/+$/, "") || url.origin;
}

function firstEnv(env: NodeJS.ProcessEnv, names: readonly string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = env[name]?.trim() ?? "";
    if (value) return { name, value };
  }
  return null;
}

/**
 * Resolve the export settings.
 * `SPORTSLEADER_DATA_MANIFEST_URL` wins, then `BAYES_DATA_MANIFEST_URL`.
 * A base URL alone (`SPORTSLEADER_DATA_BASE_URL`, then `BAYES_DATA_BASE_URL`)
 * uses the directory layout (`{base}/manifest.json`).
 * With neither set, the GitHub Releases manifest is used.
 * Returns null only when every source is empty (tests).
 */
export function readDataConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaultManifestUrl: string = DEFAULT_BAYES_DATA_MANIFEST_URL,
): DataConfig | null {
  const manifestEnv = firstEnv(env, ["SPORTSLEADER_DATA_MANIFEST_URL", "BAYES_DATA_MANIFEST_URL"]);
  const baseEnv = firstEnv(env, ["SPORTSLEADER_DATA_BASE_URL", "BAYES_DATA_BASE_URL"]);
  let manifestUrl = "";
  let baseUrl: string | null = null;
  if (manifestEnv) {
    manifestUrl = normalizeBaseUrl(manifestEnv.value, manifestEnv.name);
    baseUrl = baseEnv ? normalizeBaseUrl(baseEnv.value, baseEnv.name) : null;
  } else if (baseEnv) {
    baseUrl = normalizeBaseUrl(baseEnv.value, baseEnv.name);
    manifestUrl = dataUrl(baseUrl, "manifest.json");
  } else if (defaultManifestUrl.trim()) {
    manifestUrl = normalizeBaseUrl(defaultManifestUrl, "DEFAULT_BAYES_DATA_MANIFEST_URL");
  } else {
    return null;
  }
  const cacheDir = env.BAYES_DATA_CACHE_DIR?.trim()
    ? path.resolve(env.BAYES_DATA_CACHE_DIR.trim())
    : defaultCacheDir(env);
  return {
    manifestUrl,
    baseUrl,
    cacheDir,
    revalidateMs: readRevalidateMs(env.BAYES_DATA_REVALIDATE_MS),
  };
}

export function requireDataConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaultManifestUrl: string = DEFAULT_BAYES_DATA_MANIFEST_URL,
): DataConfig {
  const config = readDataConfig(env, defaultManifestUrl);
  if (!config) {
    throw new DataExportError(
      `${NOT_CONFIGURED}: set SPORTSLEADER_DATA_MANIFEST_URL or SPORTSLEADER_DATA_BASE_URL ` +
        "(BAYES_DATA_MANIFEST_URL and BAYES_DATA_BASE_URL still work)",
    );
  }
  return config;
}

/** True when a manifest URL will be used (env or the built-in GitHub Releases default). */
export function isDataExportConfigured(
  env: NodeJS.ProcessEnv = process.env,
  defaultManifestUrl: string = DEFAULT_BAYES_DATA_MANIFEST_URL,
): boolean {
  if (env.SPORTSLEADER_DATA_MANIFEST_URL?.trim() || env.BAYES_DATA_MANIFEST_URL?.trim()) return true;
  if (env.SPORTSLEADER_DATA_BASE_URL?.trim() || env.BAYES_DATA_BASE_URL?.trim()) return true;
  return defaultManifestUrl.trim().length > 0;
}
