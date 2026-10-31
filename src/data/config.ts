import os from "node:os";
import path from "node:path";

import { DataExportError } from "./errors.js";

/**
 * Public directory of the historical Parquet export. No API key.
 * Contains `manifest.json` and `<league>/<dataset>/<season>.parquet`.
 * Use the apex host: `www.bayesratings.com` answers 301 to this origin.
 * Override with `BAYES_DATA_BASE_URL`.
 */
export const DEFAULT_BAYES_DATA_BASE_URL = "https://bayesratings.com/data/v1/";

/** How long to trust a cached manifest before checking the host again. */
export const DEFAULT_REVALIDATE_MS = 4 * 60 * 60 * 1000;

/** get_data_status flags a current-season file older than this. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export const NOT_CONFIGURED = "data export not configured";

export interface DataConfig {
  /** Directory URL of the export. Requests are anonymous. */
  baseUrl: string;
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

/** Env value if set, otherwise the built-in default (which may still be empty). */
export function resolvedBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  defaultBaseUrl: string = DEFAULT_BAYES_DATA_BASE_URL,
): string {
  const fromEnv = env.BAYES_DATA_BASE_URL?.trim() ?? "";
  return fromEnv || defaultBaseUrl.trim();
}

export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new DataExportError(`${NOT_CONFIGURED}: BAYES_DATA_BASE_URL is not a valid URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new DataExportError(`${NOT_CONFIGURED}: BAYES_DATA_BASE_URL must be http or https`);
  }
  if (url.username || url.password) {
    throw new DataExportError(`${NOT_CONFIGURED}: BAYES_DATA_BASE_URL must not include credentials`);
  }
  url.hash = "";
  return url.href.replace(/\/+$/, "") || url.origin;
}

/**
 * Resolve the export settings. Returns null only when neither the env
 * override nor {@link DEFAULT_BAYES_DATA_BASE_URL} is set. There is no API key.
 */
export function readDataConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaultBaseUrl: string = DEFAULT_BAYES_DATA_BASE_URL,
): DataConfig | null {
  const baseRaw = resolvedBaseUrl(env, defaultBaseUrl);
  if (!baseRaw) return null;
  const cacheDir = env.BAYES_DATA_CACHE_DIR?.trim()
    ? path.resolve(env.BAYES_DATA_CACHE_DIR.trim())
    : defaultCacheDir(env);
  return {
    baseUrl: normalizeBaseUrl(baseRaw),
    cacheDir,
    revalidateMs: readRevalidateMs(env.BAYES_DATA_REVALIDATE_MS),
  };
}

export function requireDataConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaultBaseUrl: string = DEFAULT_BAYES_DATA_BASE_URL,
): DataConfig {
  const config = readDataConfig(env, defaultBaseUrl);
  if (!config) {
    throw new DataExportError(
      `${NOT_CONFIGURED}: set BAYES_DATA_BASE_URL or fill DEFAULT_BAYES_DATA_BASE_URL in src/data/config.ts`,
    );
  }
  return config;
}

/** True when a base URL will be used (env override or the built-in public default). */
export function isDataExportConfigured(
  env: NodeJS.ProcessEnv = process.env,
  defaultBaseUrl: string = DEFAULT_BAYES_DATA_BASE_URL,
): boolean {
  return resolvedBaseUrl(env, defaultBaseUrl).length > 0;
}
