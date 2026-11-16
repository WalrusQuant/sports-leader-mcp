/**
 * Prediction-market parsing. Fixtures are recorded responses; these tests do
 * not call Kalshi or Polymarket.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { UpstreamError } from "../client.js";
import { codesEqual, LEAGUES } from "./aliases.js";
import { HOST_GAP_MS, marketFetch, resetMarketClient } from "./http.js";
import {
  clobTopOfBook,
  decodeGammaStringList,
  gammaEventIsCurrent,
  gammaEventOnDate,
  isGammaGameSlug,
  kalshiTopOfBook,
  labelMatchesTeam,
  oddsVenues,
  parseKalshiEventTicker,
  polymarketGameSlug,
  polymarketUsSlug,
  polymarketVenues,
  splitTeamBlob,
} from "./parse.js";

const FIXTURES = join(process.cwd(), "test", "fixtures", "markets");
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

test("fixed Kalshi series list is the shipped set", () => {
  assert.equal(LEAGUES.nfl?.kalshi.winner, "KXNFLGAME");
  assert.equal(LEAGUES.nfl?.kalshi.spread, "KXNFLSPREAD");
  assert.equal(LEAGUES.nfl?.kalshi.total, "KXNFLTOTAL");
  assert.equal(LEAGUES.nba?.kalshi.spread, "KXNBASPREAD");
  assert.equal(LEAGUES.nba?.kalshi.total, "KXNBATOTAL");
  assert.equal(LEAGUES.mlb?.kalshi.winner, "KXMLBGAME");
  assert.equal(LEAGUES["college-football"]?.kalshi.winner, "KXNCAAFGAME");
  assert.equal(LEAGUES["mens-college-basketball"]?.gammaSeriesId, "10470");
  assert.equal(LEAGUES.nfl?.gammaSeriesId, "12185");
  const src = readdirSync(join(process.cwd(), "src", "markets"))
    .filter((name) => name.endsWith(".ts") && name !== "markets.test.ts")
    .map((name) => readFileSync(join(process.cwd(), "src", "markets", name), "utf8"))
    .join("\n");
  assert.equal(src.includes("category=Sports"), false);
  assert.equal(src.includes("/series?"), false);
});

test("parses a Kalshi event ticker and a postponed original date", () => {
  const parsed = parseKalshiEventTicker("KXNFLGAME-26NOV15MINGB", ["MIN", "GB"]);
  assert.ok(parsed);
  assert.equal(parsed?.scheduledDate, "2026-11-15");
  assert.equal(parsed?.awayCode, "MIN");
  assert.equal(parsed?.homeCode, "GB");
  const fixture = read("kalshi-nfl-markets.json");
  const postponed = parseKalshiEventTicker(fixture.markets[2].event_ticker, ["CHI", "GB"]);
  assert.equal(postponed?.scheduledDate, "2026-10-10");
  assert.equal(postponed?.awayCode, "CHI");
  assert.equal(postponed?.homeCode, "GB");
  const jags = parseKalshiEventTicker("KXNFLGAME-26OCT11PHIJAC", ["PHI", "JAC", "JAX"]);
  assert.equal(jags?.homeCode, "JAC");
});

test("splits concatenated codes longest-first", () => {
  assert.deepEqual(splitTeamBlob("LACMIN", ["LA", "LAC", "MIN"]), { away: "LAC", home: "MIN" });
  assert.equal(splitTeamBlob("NOPE", ["NO"]), null);
});

test("Kalshi orderbook yes ask is 1 minus the best no bid", () => {
  const book = kalshiTopOfBook(read("kalshi-nfl-orderbook.json"));
  assert.equal(book.priceSource, "orderbook");
  assert.equal(book.bestYesBid, 0.28);
  assert.equal(book.bestNoBid, 0.71);
  assert.equal(book.yesAsk, 0.29);
  assert.equal(book.noAsk, 0.72);
});

test("decodes Gamma JSON-string outcomes and token ids", () => {
  const market = read("gamma-nfl-market.json")[0];
  assert.deepEqual(decodeGammaStringList(market.outcomes), ["Eagles", "Jaguars"]);
  assert.deepEqual(decodeGammaStringList(market.clobTokenIds), ["111", "222"]);
  assert.deepEqual(decodeGammaStringList(["already", "array"]), ["already", "array"]);
  assert.deepEqual(decodeGammaStringList("not json"), []);
});

test("CLOB book uses the best prices, not the first level", () => {
  const book = clobTopOfBook(read("clob-books.json")[0]);
  assert.equal(book.priceSource, "clob_book");
  assert.equal(book.bid, 0.41);
  assert.equal(book.ask, 0.43);
  assert.equal(book.mid, 0.42);
});

test("alias table matches codes that differ across ESPN, Kalshi, and Gamma", () => {
  assert.equal(codesEqual("nfl", "JAX", "JAC"), true);
  assert.equal(codesEqual("nfl", "WSH", "was"), true);
  assert.equal(codesEqual("nfl", "LAR", "la"), true);
  assert.equal(codesEqual("nba", "GS", "gsw"), true);
  assert.equal(codesEqual("nba", "SA", "SAS"), true);
  assert.equal(codesEqual("nhl", "MTL", "mon"), true);
  assert.equal(codesEqual("mlb", "ATH", "oak"), true);
  assert.equal(codesEqual("college-football", "WIS", "wisc"), true);
  assert.equal(codesEqual("mens-college-basketball", "wisc", "WIS"), true);
  assert.equal(codesEqual("nfl", "PHI", "phi"), true);
  assert.equal(codesEqual("nfl", "PHI", "JAC"), false);
  const chargers = { abbrev: "LAC", location: "Los Angeles", name: "Chargers", displayName: "Los Angeles Chargers" };
  const rams = { abbrev: "LAR", location: "Los Angeles", name: "Rams", displayName: "Los Angeles Rams" };
  assert.equal(labelMatchesTeam(chargers, "Los Angeles C"), true);
  assert.equal(labelMatchesTeam(rams, "Los Angeles C"), false);
  const wisconsin = { abbrev: "WIS", location: "Wisconsin", name: "Badgers", displayName: "Wisconsin Badgers" };
  assert.equal(labelMatchesTeam(wisconsin, "Wisconsin"), true);
  assert.equal(labelMatchesTeam(wisconsin, "Badgers"), true);
});

test("Polymarket global slugs use the UTC date and the US slug is aec- plus usId", () => {
  const start = "2026-11-17T01:15:00Z";
  assert.equal(polymarketGameSlug("nfl", "pit", "cin", start), "nfl-pit-cin-2026-11-17");
  assert.equal(isGammaGameSlug("nfl", "nfl-pit-cin-2026-11-17"), true);
  assert.equal(isGammaGameSlug("nfl", "nfl-ari-dal-2026-11-01-player-props"), false);
  const usId = "nfl-pit-cin-2026-11-16";
  assert.equal(polymarketUsSlug(usId), "aec-nfl-pit-cin-2026-11-16");
  assert.notEqual(polymarketUsSlug(usId), `aec-${polymarketGameSlug("nfl", "pit", "cin", start)}`);
  const events = read("gamma-nfl-events.json");
  assert.equal(gammaEventOnDate(events[0], "2026-10-11"), true);
  assert.equal(gammaEventIsCurrent(events[1], new Date("2026-11-16T12:00:00Z")), false);
  assert.equal(gammaEventOnDate(events[1], "2026-10-11"), false);
});

test("venue filters keep labels and do not invent a third blended book", () => {
  assert.deepEqual(polymarketVenues("both"), ["polymarket", "polymarket_us"]);
  assert.deepEqual(polymarketVenues("polymarket"), ["polymarket"]);
  assert.deepEqual(polymarketVenues("polymarket_us"), ["polymarket_us"]);
  assert.deepEqual(oddsVenues("all"), ["kalshi", "polymarket", "polymarket_us"]);
  assert.deepEqual(oddsVenues("kalshi"), ["kalshi"]);
});

test("market HTTP sends gzip, no authorization, caches, backs off on 429, and rejects other hosts", async () => {
  const real = globalThis.fetch;
  try {
    resetMarketClient();
    const seen: Array<Record<string, string>> = [];
    let calls = 0;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      calls += 1;
      seen.push(Object.fromEntries(new Headers(init?.headers).entries()));
      if (calls === 1) return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const first = await marketFetch("https://gamma-api.polymarket.com/events?limit=100");
    assert.deepEqual(first, { ok: true });
    assert.equal(calls, 2);
    assert.equal(seen[0]?.["accept-encoding"], "gzip");
    assert.equal(seen[0]?.authorization, undefined);
    await marketFetch("https://gamma-api.polymarket.com/events?limit=100");
    assert.equal(calls, 2, "second identical call is cached");

    resetMarketClient();
    globalThis.fetch = (async () => new Response("nope", { status: 406 })) as typeof fetch;
    await assert.rejects(
      () => marketFetch("https://gamma-api.polymarket.com/events?limit=80"),
      (err: unknown) => err instanceof UpstreamError && err.status === 406,
    );
    assert.throws(() => marketFetch("https://example.com/markets"), /not allowed/);
    assert.ok(HOST_GAP_MS["gateway.polymarket.us"]! <= 50);

    resetMarketClient();
    const times: number[] = [];
    globalThis.fetch = (async () => {
      times.push(Date.now());
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await Promise.all([
      marketFetch("https://api.elections.kalshi.com/trade-api/v2/markets?limit=1"),
      marketFetch("https://api.elections.kalshi.com/trade-api/v2/markets?limit=2"),
    ]);
    assert.equal(times.length, 2);
    assert.ok((times[1] ?? 0) - (times[0] ?? 0) >= HOST_GAP_MS["api.elections.kalshi.com"]! - 40);
  } finally {
    globalThis.fetch = real;
    resetMarketClient();
  }
});
