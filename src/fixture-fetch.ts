/**
 * Test-only helper: replace global fetch with a router that serves raw ESPN
 * fixtures from test/fixtures/<league>/. SDK-independent so it can be shared by
 * every end-to-end test file.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = join(fileURLToPath(new URL("..", import.meta.url)), "test", "fixtures");

export const fixtureState = {
  log: [] as string[],
  failInjuries: false,
  failEvents: false,
  /** When true, Kalshi requests return 500 so a venue failure can be isolated. */
  failKalshi: false,
  /** When true, ESPN fetches never resolve; they settle only by abort. */
  hang: false,
  /** When true, athlete splits return 500 so a player report can keep the other blocks. */
  failSplits: false,
  /** When true, the ESPN summary returns 500 so a preview can keep the other blocks. */
  failSummary: false,
  /** Raw ESPN search document. Unset answers 404, which is what search did before this hook. */
  searchBody: undefined as unknown,
  /** Number of ESPN fetches that were aborted via their signal. */
  aborted: 0,
};

const MARKET_FIXTURES = join(FIXTURES, "markets");

function firstExisting(paths: string[]): string | undefined {
  return paths.find((file) => existsSync(file));
}

function marketFixture(url: URL): { status: number; file?: string } | undefined {
  const host = url.hostname;
  if (host === "api.elections.kalshi.com") {
    if (fixtureState.failKalshi) return { status: 500 };
    if (url.pathname.endsWith("/orderbook")) return { status: 200, file: join(MARKET_FIXTURES, "kalshi-nfl-orderbook.json") };
    if (url.pathname.endsWith("/markets")) {
      const series = url.searchParams.get("series_ticker") ?? "";
      const nfl = series.startsWith("KXNFL") || series === "";
      const file = nfl
        ? firstExisting([
            join(FIXTURES, "nfl", "kalshi-markets.json"),
            join(MARKET_FIXTURES, "kalshi-nfl-markets.json"),
          ])
        : join(MARKET_FIXTURES, "kalshi-nfl-markets.json");
      return { status: 200, file };
    }
    return { status: 404 };
  }
  if (host === "gamma-api.polymarket.com") {
    if (url.pathname.includes("/events/slug/")) return { status: 404 };
    if (url.pathname.endsWith("/markets")) {
      const slug = url.searchParams.get("slug") ?? "";
      const file =
        (slug.startsWith("nfl-")
          ? firstExisting([join(FIXTURES, "nfl", "polymarket-market.json"), join(MARKET_FIXTURES, "gamma-nfl-market.json")])
          : undefined) ?? join(MARKET_FIXTURES, "gamma-nfl-market.json");
      return { status: 200, file };
    }
    if (url.pathname.endsWith("/events")) {
      const series = url.searchParams.get("series_id") ?? "";
      const nfl = series === "12185" || series === "";
      const file = nfl
        ? firstExisting([
            join(FIXTURES, "nfl", "polymarket-events.json"),
            join(MARKET_FIXTURES, "gamma-nfl-events.json"),
          ])
        : join(MARKET_FIXTURES, "gamma-nfl-events.json");
      return { status: 200, file };
    }
    return { status: 404 };
  }
  if (host === "clob.polymarket.com") {
    return { status: 200, file: join(MARKET_FIXTURES, "clob-books.json") };
  }
  if (host === "gateway.polymarket.us") {
    if (url.pathname.endsWith("/bbo")) {
      const nfl = url.pathname.includes("/nfl") || url.pathname.includes("aec-nfl");
      const file = nfl
        ? firstExisting([join(FIXTURES, "nfl", "polymarket-us.json"), join(MARKET_FIXTURES, "polymarket-us-bbo.json")])
        : join(MARKET_FIXTURES, "polymarket-us-bbo.json");
      return { status: 200, file };
    }
    return { status: 404 };
  }
  return undefined;
}

function fixtureFor(url: URL): string | undefined {
  const p = url.pathname;
  const league = p.match(/\/sports\/[^/]+\/leagues\/([^/]+)\//)?.[1] ?? p.match(/\/sports\/[^/]+\/([^/]+)\//)?.[1];
  if (!league) return undefined;
  if (p.endsWith("/scoreboard")) return join(FIXTURES, league, "scoreboard.json");
  if (p.endsWith("/summary")) {
    const event = url.searchParams.get("event");
    if (event && /^[0-9]+$/.test(event)) {
      const specific = join(FIXTURES, league, `summary-${event}.json`);
      if (existsSync(specific)) return specific;
    }
    return join(FIXTURES, league, "summary.json");
  }
  if (/\/competitions\/\d+\/odds$/.test(p)) return join(FIXTURES, league, "odds.json");
  if (/\/competitions\/\d+\/plays$/.test(p)) return join(FIXTURES, league, "plays.json");
  if (/\/competitions\/\d+\/probabilities$/.test(p)) return join(FIXTURES, league, "probabilities.json");
  if (/\/leagues\/[^/]+\/events\/\d+$/.test(p)) return fixtureState.failEvents ? undefined : join(FIXTURES, league, "event.json");
  if (/\/teams\/[^/]+\/injuries$/.test(p)) return undefined;
  if (p.endsWith("/injuries")) return fixtureState.failInjuries ? undefined : join(FIXTURES, league, "injuries.json");
  if (p.endsWith("/gamelog")) return join(FIXTURES, league, "gamelog.json");
  if (/\/athletes\/[^/]+\/stats$/.test(p)) return join(FIXTURES, league, "stats.json");
  if (/\/athletes\/[^/]+\/splits$/.test(p)) return join(FIXTURES, league, "splits.json");
  if (/\/athletes\/[^/]+$/.test(p)) return join(FIXTURES, league, "athlete.json");
  return undefined;
}

export function readFixture(league: string, name: string): any {
  return JSON.parse(readFileSync(join(FIXTURES, league, `${name}.json`), "utf8"));
}

export function hasFixture(league: string, name: string): boolean {
  return existsSync(join(FIXTURES, league, `${name}.json`));
}

/** Install the fixture router; returns a function that restores the real fetch. */
export function installFixtureFetch(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const market = marketFixture(url);
    if (market) {
      init?.signal?.throwIfAborted?.();
      fixtureState.log.push(url.pathname);
      if (!market.file || market.status !== 200) {
        return new Response(JSON.stringify({ error: "fixture" }), { status: market.status, statusText: "Fixture" });
      }
      return new Response(readFileSync(market.file, "utf8"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // Non-ESPN traffic (test MCP clients talking to a local HTTP server) is real.
    if (!url.hostname.endsWith("espn.com")) return realFetch(input, init);
    init?.signal?.throwIfAborted?.();
    fixtureState.log.push(url.pathname);
    if (url.pathname.endsWith("/search/v2")) {
      if (fixtureState.searchBody === undefined) {
        return new Response(JSON.stringify({ error: "not found" }), { status: 404, statusText: "Not Found" });
      }
      return new Response(JSON.stringify(fixtureState.searchBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (fixtureState.failSplits && /\/athletes\/[^/]+\/splits$/.test(url.pathname)) {
      return new Response(JSON.stringify({ error: "splits down" }), { status: 500, statusText: "Server Error" });
    }
    if (fixtureState.failSummary && url.pathname.endsWith("/summary")) {
      return new Response(JSON.stringify({ error: "summary down" }), { status: 500, statusText: "Server Error" });
    }
    if (fixtureState.hang) {
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener(
          "abort",
          () => {
            fixtureState.aborted++;
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
    const file = fixtureFor(url);
    if (!file || !existsSync(file)) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, statusText: "Not Found" });
    }
    return new Response(readFileSync(file, "utf8"), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}
