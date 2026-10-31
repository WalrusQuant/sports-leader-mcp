import { CancelledError, currentRequestSignal } from "../client.js";
import { VERSION } from "../version.js";
import type { DataConfig } from "./config.js";
import { DataExportError } from "./errors.js";

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
 * GET one export object. Requests are anonymous: no API key is sent.
 *
 * Redirects are followed (up to 5), including the 301 from www.bayesratings.com
 * to the apex. `If-None-Match` is forwarded when we have an ETag; a missing
 * ETag is normal and the cache then trusts the manifest checksum.
 */
export async function dataFetch(
  config: DataConfig,
  rel: string,
  deps: DataDeps,
  etag?: string | null,
): Promise<DataResponse> {
  let current = dataUrl(config.baseUrl, rel);
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
        throw new DataExportError(`data export request timed out for ${rel}`);
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new DataExportError(`data export request failed for ${rel}: ${message}`);
    }

    if (REDIRECT.has(res.status)) {
      const location = res.headers.get("location");
      await drain(res);
      if (!location) throw new DataExportError(`data export redirected (${res.status}) for ${rel} with no Location`);
      hops += 1;
      if (hops > MAX_REDIRECTS) {
        throw new DataExportError(`data export exceeded ${MAX_REDIRECTS} redirects for ${rel}`);
      }
      current = new URL(location, current).href;
      continue;
    }

    if (res.status === 401) {
      await drain(res);
      throw new DataExportError("data export unauthorized (401).");
    }

    if (res.status === 429) {
      const retry = res.headers.get("retry-after");
      await drain(res);
      throw new DataExportError(`data export rate limited (429)${retry ? `; retry after ${retry}` : ""}`);
    }

    if (res.status === 304) {
      await drain(res);
      return { status: 304, etag: res.headers.get("etag") ?? etag ?? null, body: null };
    }

    if (!res.ok) {
      await drain(res);
      throw new DataExportError(`data export request failed (${res.status}) for ${rel}`);
    }

    const body = Buffer.from(await res.arrayBuffer());
    if (body.length === 0) throw new DataExportError(`data export returned an empty body for ${rel}`);
    if (body.length > MAX_BYTES) throw new DataExportError(`data export response for ${rel} exceeds ${MAX_BYTES} bytes`);
    return { status: res.status, etag: res.headers.get("etag"), body };
  }
}
