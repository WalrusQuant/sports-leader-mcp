import { AsyncLocalStorage } from "node:async_hooks";
import { TtlCache } from "./cache.js";
import { VERSION } from "./version.js";

const USER_AGENT = `sports-leader-mcp/${VERSION}`;
const DEFAULT_TIMEOUT_MS = process.env.SPORTS_LEADER_TIMEOUT
  ? parseInt(process.env.SPORTS_LEADER_TIMEOUT, 10)
  : 30_000;

// Any *.espn.com subdomain is permitted. The espn_fetch escape hatch is
// documented as "locked to ESPN hostnames (*.espn.com)", so we honor that
// literally rather than maintaining a brittle fixed allowlist that lags
// behind ESPN's actual subdomains.
const ALLOWED_HOST_SUFFIX = ".espn.com";
const ALLOWED_ROOT_HOST = "espn.com";

export class UpstreamError extends Error {
  constructor(
    message: string,
    public status: number,
    public url: string,
    public body?: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

function assertAllowedHost(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Only https:// URLs allowed, got: ${parsed.protocol}`);
  }
  const host = parsed.hostname;
  const isEspn =
    host === ALLOWED_ROOT_HOST || host.endsWith(ALLOWED_HOST_SUFFIX);
  if (!isEspn) {
    throw new Error(`Host not allowed: ${host}. Only *.espn.com is permitted.`);
  }
}

export const apiCache = new TtlCache();

function getTtlMs(path: string): number {

  // 30s — live scoreboards
  if (path.includes("/scoreboard")) return 30_000;

  // 60s — in-progress game data
  if (path.includes("/summary")) return 60_000;
  if (path.includes("/plays")) return 60_000;
  if (path.includes("/odds")) return 60_000;
  if (path.includes("/probabilities")) return 60_000;

  // 300s — semi-live data
  if (path.includes("/injuries") && !path.includes("/teams/")) return 300_000;
  if (path.includes("/transactions")) return 300_000;
  if (path.includes("/news")) return 300_000;
  if (path.includes("/search")) return 300_000;

  // 3600s — standings, league, teams
  if (path.includes("/standings")) return 3_600_000;
  if (path.includes("/leaders")) return 3_600_000;
  if (path.includes("/teams")) return 3_600_000;

  // 86400s — athletes, ontology
  if (path.includes("/athletes/")) return 86_400_000;
  if (path.includes("/ontology/")) return 86_400_000;

  // Default
  return 300_000;
}

export interface FetchOptions {
  params?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  /**
   * Caller cancellation. Defaults to the signal of the MCP request currently
   * being served (see {@link withRequestSignal}), so tool handlers don't have
   * to thread it through every call site.
   */
  signal?: AbortSignal;
}

/**
 * The MCP request's cancel signal, scoped to the async work of one tool call or
 * resource read. When the client cancels (notifications/cancelled, or the HTTP
 * request is closed), in-flight ESPN fetches are aborted and not retried.
 */
const requestSignal = new AsyncLocalStorage<AbortSignal | undefined>();

export function withRequestSignal<T>(signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return requestSignal.run(signal, fn);
}

export function currentRequestSignal(): AbortSignal | undefined {
  return requestSignal.getStore();
}

/** Thrown when the caller cancelled; never cached, never retried. */
export class CancelledError extends Error {
  constructor(reason?: unknown) {
    super(`Request cancelled${reason instanceof Error ? `: ${reason.message}` : ""}`);
    this.name = "CancelledError";
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError(signal.reason));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new CancelledError(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOptions = {},
): Promise<T> {
  const { params, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const callerSignal = opts.signal ?? currentRequestSignal();

  const u = new URL(url);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== "") {
        u.searchParams.set(k, String(v));
      }
    }
  }

  const resolvedUrl = u.toString();
  assertAllowedHost(resolvedUrl);

  // Cache check
  const cached = apiCache.get<T>(resolvedUrl);
  if (cached !== undefined) return cached;
  if (callerSignal?.aborted) throw new CancelledError(callerSignal.reason);

  const maxAttempts = 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(resolvedUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
        signal: callerSignal ? AbortSignal.any([controller.signal, callerSignal]) : controller.signal,
      });

      if (res.status === 429 && attempt < maxAttempts) {
        await sleep(500 * 2 ** (attempt - 1), callerSignal);
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new UpstreamError(
          `ESPN API returned ${res.status} ${res.statusText}`,
          res.status,
          resolvedUrl,
          body.slice(0, 500),
        );
      }

      const data = (await res.json()) as T;
      apiCache.set(resolvedUrl, data, getTtlMs(u.pathname));
      return data;
    } catch (err) {
      lastErr = err;
      if (err instanceof UpstreamError || err instanceof CancelledError) throw err;
      if (callerSignal?.aborted) throw new CancelledError(callerSignal.reason);
      if (attempt === maxAttempts) break;
      await sleep(500 * 2 ** (attempt - 1), callerSignal);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Request failed: ${String(lastErr)}`);
}
