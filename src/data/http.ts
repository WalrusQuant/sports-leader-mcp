import { CancelledError, currentRequestSignal } from "../client.js";
import { VERSION } from "../version.js";
import { DataExportError } from "./errors.js";
import type { ManifestFile } from "./manifest.js";
import type { DataConfig } from "./config.js";

export interface DataDeps {
  fetch: typeof fetch;
  now: () => number;
}

export function defaultDeps(): DataDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    now: () => Date.now(),
  };
}

export interface DataResponse {
  status: number;
  etag: string | null;
  body: Buffer | null;
}

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
const MAX_BYTES = 256 * 1024 * 1024;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

/** Absolute download URL: the manifest `url` when present, otherwise `{base}/{path}`. */
export function fileDownloadUrl(config: DataConfig, file: ManifestFile): string {
  if (file.url) return file.url;
  if (!config.baseUrl) {
    throw new DataExportError(`manifest file ${file.path} has no url and BAYES_DATA_BASE_URL is not set`);
  }
  return dataUrl(config.baseUrl, file.path);
}

function safeLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "export url";
  }
}

/** Join `rel` onto the export directory. The base is always treated as a directory. */
export function dataUrl(baseUrl: string, rel: string): string {
  const url = new URL(baseUrl);
  const prefix = url.pathname.endsWith("/") ? url.pathname : `${url.pathname.replace(/\/+$/, "")}/`;
  const suffix = rel.replace(/^\/+/, "");
  url.pathname = prefix === "/" ? `/${suffix}` : `${prefix}${suffix}`;
  return url.href;
}

function abortSignal(): AbortSignal {
  const signals: AbortSignal[] = [AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)];
  const request = currentRequestSignal();
  if (request) signals.push(request);
  return AbortSignal.any(signals);
}

async function drain(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // The body is unused on redirects and errors.
  }
}

/**
 * GET one absolute export URL. Requests are anonymous: no API key is sent.
 *
 * GitHub release downloads answer 302 (cache-control: no-cache, no ETag) to a
 * short-lived CDN URL. That CDN may 304 if If-None-Match is forwarded, but the
 * signed URL changes every time, so parquet freshness is the manifest sha256,
 * not this header. Redirects are followed (up to 5).
 */
export async function dataFetch(
  url: string,
  deps: DataDeps,
  etag?: string | null,
): Promise<DataResponse> {
  let current = url;
  const label = safeLabel(url);
  let hops = 0;

  while (true) {
    const headers: Record<string, string> = {
      Accept: "*/*",
      "User-Agent": `sports-leader-mcp/${VERSION}`,
    };
    if (etag) headers["If-None-Match"] = etag;

    let res: Response;
    try {
      res = await deps.fetch(current, { headers, redirect: "manual", signal: abortSignal() });
    } catch (err) {
      const request = currentRequestSignal();
      if (request?.aborted) throw new CancelledError(request.reason);
      if (err instanceof Error && err.name === "AbortError") {
        throw new DataExportError(`data export request timed out for ${label}`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new DataExportError(`data export request failed for ${label}: ${message}`);
    }

    if (REDIRECT.has(res.status)) {
      const location = res.headers.get("location");
      await drain(res);
      if (!location) throw new DataExportError(`data export redirected (${res.status}) for ${label} with no Location`);
      hops += 1;
      if (hops > MAX_REDIRECTS) {
        throw new DataExportError(`data export exceeded ${MAX_REDIRECTS} redirects for ${label}`);
      }
      current = new URL(location, current).href;
      continue;
    }

    if (res.status === 401) {
      await drain(res);
      throw new DataExportError("data export unauthorized (401).");
    }

    if (res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")) {
      const retry = res.headers.get("retry-after");
      await drain(res);
      throw new DataExportError(
        `data export rate limited (${res.status})${retry ? `; retry after ${retry}` : ""}. ` +
          "Unauthenticated GitHub release downloads are capped; cached files are kept until the manifest sha256 changes.",
      );
    }

    if (res.status === 304) {
      await drain(res);
      return { status: 304, etag: res.headers.get("etag") ?? etag ?? null, body: null };
    }

    if (!res.ok) {
      await drain(res);
      throw new DataExportError(`data export request failed (${res.status}) for ${label}`);
    }

    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) throw new DataExportError(`data export returned an empty body for ${label}`);
    if (body.length > MAX_BYTES) throw new DataExportError(`data export response for ${label} exceeds ${MAX_BYTES} bytes`);
    return { status: res.status, etag: res.headers.get("etag"), body };
  }
}
