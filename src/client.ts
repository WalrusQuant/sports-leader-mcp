import { TtlCache } from "./cache.js";

const USER_AGENT = "sports-leader-mcp/0.1.0";
const DEFAULT_TIMEOUT_MS = process.env.SPORTS_LEADER_TIMEOUT
  ? parseInt(process.env.SPORTS_LEADER_TIMEOUT, 10)
  : 30_000;

const ALLOWED_HOSTS = new Set([
  "site.api.espn.com",
  "sports.core.api.espn.com",
  "site.web.api.espn.com",
  "cdn.espn.com",
  "now.core.api.espn.com",
  "fantasy.espn.com",
]);

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
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(
      `Host not allowed: ${parsed.hostname}. Allowed: ${[...ALLOWED_HOSTS].join(", ")}`,
    );
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
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: FetchOptions = {},
): Promise<T> {
  const { params, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;

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
        signal: controller.signal,
      });

      if (res.status === 429 && attempt < maxAttempts) {
        const backoff = 500 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, backoff));
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
      if (err instanceof UpstreamError) throw err;
      if (attempt === maxAttempts) break;
      const backoff = 500 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, backoff));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Request failed: ${String(lastErr)}`);
}

export const BASE = {
  site: "https://site.api.espn.com/apis/site/v2/sports",
  siteV2: "https://site.api.espn.com/apis/v2/sports",
  core: "https://sports.core.api.espn.com/v2/sports",
  coreV3: "https://sports.core.api.espn.com/v3/sports",
  web: "https://site.web.api.espn.com/apis/common/v3/sports",
  cdn: "https://cdn.espn.com/core",
  now: "https://now.core.api.espn.com/v1/sports/news",
  search: "https://site.web.api.espn.com/apis/search/v2",
  ontology: "https://sports.core.api.espn.com/v2",
} as const;
