/**
 * Keyless HTTP for Kalshi and Polymarket.
 *
 * Unauthenticated Kalshi limits are unpublished and a short burst returns 429,
 * so each host is serialized and a 429 waits before retrying. Successful
 * responses are cached for 15 seconds. No API key is read or sent.
 * Gamma answers 406 on limit>50 unless the request accepts gzip.
 */

import { TtlCache } from "../cache.js";
import { CancelledError, UpstreamError, currentRequestSignal } from "../client.js";
import { VERSION } from "../version.js";

export const MARKET_CACHE_TTL_MS = 15_000;

export const MARKET_HOSTS = [
  "api.elections.kalshi.com",
  "gamma-api.polymarket.com",
  "clob.polymarket.com",
  "gateway.polymarket.us",
] as const;

/** Minimum gap between requests to one host. Polymarket US stays under ~25 req/s. */
export const HOST_GAP_MS: Record<string, number> = {
  "api.elections.kalshi.com": 400,
  "gamma-api.polymarket.com": 80,
  "clob.polymarket.com": 40,
  "gateway.polymarket.us": 50,
};

const USER_AGENT = `sports-leader-mcp/${VERSION}`;
const marketCache = new TtlCache();
const tails = new Map<string, Promise<void>>();
const lastAt = new Map<string, number>();

export function resetMarketClient(): void {
  marketCache.clear();
  tails.clear();
  lastAt.clear();
}

export interface MarketRequest {
  method?: "GET" | "POST";
  body?: string;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError(signal.reason));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CancelledError(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function assertMarketHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (parsed.protocol !== "https:") throw new Error(`Only https:// URLs allowed, got: ${parsed.protocol}`);
  if (!MARKET_HOSTS.includes(parsed.hostname as (typeof MARKET_HOSTS)[number])) {
    throw new Error(`Host not allowed: ${parsed.hostname}`);
  }
  return parsed.hostname;
}

function enqueue<T>(host: string, task: () => Promise<T>): Promise<T> {
  const prev = tails.get(host) ?? Promise.resolve();
  const run = prev.then(async () => {
    const gap = HOST_GAP_MS[host] ?? 100;
    const wait = gap - (Date.now() - (lastAt.get(host) ?? 0));
    if (wait > 0) await sleep(wait, currentRequestSignal());
    lastAt.set(host, Date.now());
    return task();
  });
  tails.set(
    host,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

/**
 * Fetch JSON from an allowed prediction-market host.
 * 429s are retried with Retry-After or an exponential wait. Other 4xx responses,
 * including Gamma 406, are thrown as UpstreamError and are not cached.
 */
export function marketFetch(url: string, request: MarketRequest = {}): Promise<unknown> {
  const host = assertMarketHost(url);
  const key = `${request.method ?? "GET"} ${url} ${request.body ?? ""}`;
  const cached = marketCache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);

  return enqueue(host, async () => {
    const again = marketCache.get(key);
    if (again !== undefined) return again;
    const signal = currentRequestSignal();
    let lastError: unknown;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const headers: Record<string, string> = {
          Accept: "application/json",
          "Accept-Encoding": "gzip",
          "User-Agent": USER_AGENT,
        };
        if (request.body) headers["Content-Type"] = "application/json";
        const response = await fetch(url, {
          method: request.method ?? "GET",
          headers,
          body: request.body,
          signal,
        });
        if (response.status === 429 && attempt < 4) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const wait = Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1000 : 400 * 2 ** (attempt - 1);
          await sleep(Math.min(wait, 8_000), signal);
          continue;
        }
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          throw new UpstreamError(
            `Upstream returned ${response.status} ${response.statusText}`,
            response.status,
            url,
            body.slice(0, 240),
          );
        }
        const data = (await response.json()) as unknown;
        marketCache.set(key, data, MARKET_CACHE_TTL_MS);
        return data;
      } catch (err) {
        lastError = err;
        if (err instanceof CancelledError || err instanceof UpstreamError) throw err;
        if (signal?.aborted) throw new CancelledError(signal.reason);
        if (attempt === 4) break;
        await sleep(400 * 2 ** (attempt - 1), signal);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  });
}
