/**
 * Recorded responses for the market bugs fixed in 0.8.1. No live calls.
 */
import test, { after, before, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { apiCache } from "../client.js";
import { dateSchema } from "../schemas.js";
import { resetMarketClient } from "./http.js";
import { getKalshiMarkets, getMarketOdds, getPolymarketMarkets } from "./service.js";
import { gammaEventOnDate, isoDate, parseKalshiEventTicker, teamHits } from "./parse.js";

const FIXTURES = join(process.cwd(), "test", "fixtures", "markets");
const read = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

const calls: string[] = [];
let restore: (() => void) | undefined;

function route(url: URL): { status: number; body: unknown } {
  const host = url.hostname;
  if (host.endsWith("espn.com") && url.pathname.endsWith("/scoreboard")) {
    if (url.pathname.includes("mens-college-basketball")) {
      const dates = url.searchParams.get("dates");
      const grouped = url.searchParams.get("groups") === "50" && url.searchParams.get("limit") === "400";
      if (dates === "20261117") {
        return { status: 200, body: read(grouped ? "cbb-kansas-scoreboard.json" : "cbb-kansas-featured.json") };
      }
      if (dates === "20261118") {
        return { status: 200, body: read(grouped ? "cbb-kansas-ambiguous.json" : "cbb-kansas-featured.json") };
      }
      return { status: 200, body: read("cbb-neutral-scoreboard.json") };
    }
    if (url.pathname.includes("/nhl/")) return { status: 200, body: read("nhl-scoreboard.json") };
    return { status: 200, body: { events: [] } };
  }
  if (host === "api.elections.kalshi.com" && url.pathname.endsWith("/markets")) {
    const series = url.searchParams.get("series_ticker");
    if (series === "KXNBASPREAD") return { status: 200, body: read("kalshi-nba-spread.json") };
    if (series === "KXNBATOTAL") return { status: 200, body: read("kalshi-nba-total.json") };
    if (series === "KXNBAGAME") return { status: 200, body: read("kalshi-nba-winner-seed.json") };
    if (series === "KXNCAAMBGAME") return { status: 200, body: read("kalshi-cbb-wishall.json") };
    return { status: 200, body: { markets: [], cursor: "" } };
  }
  if (host === "gamma-api.polymarket.com" && url.pathname.endsWith("/events")) {
    const series = url.searchParams.get("series_id");
    if (series === "10470") return { status: 200, body: read("gamma-cbb-neutral.json") };
    if (series === "10345") return { status: 200, body: read("gamma-nba-dates.json") };
    if (series === "10346") return { status: 200, body: read("gamma-nhl-null-us.json") };
    return { status: 200, body: [] };
  }
  if (host === "gamma-api.polymarket.com" && url.pathname.endsWith("/markets")) {
    return {
      status: 200,
      body: [
        {
          slug: url.searchParams.get("slug"),
          sportsMarketType: "moneyline",
          outcomes: "[\"Away\",\"Home\"]",
          outcomePrices: "[\"0.50\",\"0.50\"]",
          closed: false,
        },
      ],
    };
  }
  if (host === "gateway.polymarket.us" && url.pathname.endsWith("/bbo")) {
    if (url.pathname.includes("/aec-cbb-seton-wisc-2026-11-19/")) {
      return { status: 200, body: read("polymarket-us-seton-wisc.json") };
    }
    if (
      url.pathname.includes("/aec-nhl-mon-nyr-2026-11-16/") ||
      url.pathname.includes("/aec-nhl-van-uta-2026-11-16/")
    ) {
      return { status: 200, body: read("polymarket-us-nhl.json") };
    }
    return { status: 404, body: { message: "not found" } };
  }
  return { status: 404, body: { message: "not found" } };
}

describe("market bug regressions", { concurrency: false }, () => {
  before(() => {
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: unknown) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : String(input));
      calls.push(`${url.hostname}${url.pathname}?${url.searchParams.toString()}`);
      const result = route(url);
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    restore = () => {
      globalThis.fetch = real;
    };
  });

  after(() => restore?.());

  beforeEach(() => {
    calls.length = 0;
    apiCache.clear();
    resetMarketClient();
  });

  test("neutral site matches either home/away order and prices stay on the team", async () => {
    const odds = await getMarketOdds({
      sport: "basketball",
      league: "mens-college-basketball",
      eventId: "401920888",
    });
    assert.equal(odds.eventId, "401920888");
    const game = odds.game as { away: { abbrev: string }; home: { abbrev: string } };
    assert.equal(game.away.abbrev, "HALL");
    assert.equal(game.home.abbrev, "WIS");
    const venues = odds.venues as Array<Record<string, unknown>>;
    const kalshi = venues.find((venue) => venue.venue === "kalshi");
    assert.equal(kalshi?.status, "ok");
    assert.match(String(kalshi?.matchedBy), /teams\+scheduledDate/);
    assert.match(String(kalshi?.matchedBy), /other order/);
    const kalshiEvent = (kalshi?.events as Array<Record<string, unknown>>)[0];
    assert.equal((kalshiEvent?.home as { code: string }).code, "WIS");
    assert.equal((kalshiEvent?.away as { code: string }).code, "HALL");
    const wis = (kalshiEvent?.markets as Array<Record<string, unknown>>).find((market) => market.outcome === "WIS");
    assert.equal(wis?.yesBid, 0.61);

    const poly = venues.find((venue) => venue.venue === "polymarket");
    assert.equal(poly?.status, "ok");
    assert.match(String(poly?.matchedBy), /other order/);
    const polyEvent = (poly?.events as Array<Record<string, unknown>>)[0];
    assert.equal(polyEvent?.slug, "cbb-wisc-seton-2026-11-19");
    assert.equal((polyEvent?.home as { code: string }).code, "wisc");
    assert.equal((polyEvent?.away as { code: string }).code, "seton");

    const us = venues.find((venue) => venue.venue === "polymarket_us");
    assert.equal(us?.status, "ok");
    assert.equal(us?.slug, "aec-cbb-seton-wisc-2026-11-19");
    assert.match(String(us?.matchedBy), /constructed slug/);
    const quote = (us?.events as Array<Record<string, unknown>>)[0];
    const long = quote?.long as { code: string; mid: number; label: string };
    const short = quote?.short as { code: string; mid: number; label: string; quote: number };
    assert.equal(long.code, "seton");
    assert.equal(short.code, "wisc");
    assert.equal(long.mid, 0.31);
    assert.equal(short.mid, 0.69);
    assert.equal(short.label, "mid");
    assert.notEqual(short.mid, short.quote);

    await assert.rejects(
      () =>
        getMarketOdds({
          sport: "basketball",
          league: "mens-college-basketball",
          eventId: "401920888",
          team: "Duke",
        }),
      /Duke is not on event 401920888/,
    );
  });

  test("spread and total tickers keep their date, names, and nicknames", async () => {
    const spread = await getKalshiMarkets({ league: "nba", market: "spread", date: "20261116" });
    const events = spread.events as Array<{
      eventTicker: string;
      scheduledDate: string;
      away: { code: string; name: string; nickname?: string };
      home: { code: string; name: string; nickname?: string };
    }>;
    assert.deepEqual(
      events.map((event) => event.eventTicker).sort(),
      ["KXNBASPREAD-26NOV16GSWNOP", "KXNBASPREAD-26NOV16ZZZYYY"],
    );
    assert.ok(calls.some((call) => call.includes("series_ticker=KXNBAGAME")));
    const warriors = events.find((event) => event.eventTicker.endsWith("GSWNOP"));
    assert.equal(warriors?.scheduledDate, "2026-11-16");
    const sides = [warriors?.away, warriors?.home];
    assert.ok(sides.some((side) => side?.code === "GSW" && side.name === "Golden State" && side.nickname === "Warriors"));
    assert.ok(sides.some((side) => side?.code === "NOP" && side.name === "New Orleans" && side.nickname === "Pelicans"));
    const invented = events.find((event) => event.eventTicker.endsWith("ZZZYYY"));
    assert.ok([invented?.away.name, invented?.home.name].includes("Zeta"));
    assert.ok([invented?.away.name, invented?.home.name].includes("Yarrow"));
    assert.equal(invented?.away.name === invented?.away.code, false);

    const byNickname = await getKalshiMarkets({ league: "nba", market: "spread", date: "20261116", team: "Warriors" });
    assert.deepEqual(
      (byNickname.events as Array<{ eventTicker: string }>).map((event) => event.eventTicker),
      ["KXNBASPREAD-26NOV16GSWNOP"],
    );
    const pelicans = await getKalshiMarkets({ league: "nba", market: "spread", date: "20261116", team: "Pelicans" });
    assert.equal((pelicans.events as unknown[]).length, 1);

    const total = await getKalshiMarkets({ league: "nba", market: "total", date: "20261116" });
    const totals = total.events as Array<{ eventTicker: string; away: { name: string }; home: { name: string } }>;
    assert.deepEqual(
      totals.map((event) => event.eventTicker),
      ["KXNBATOTAL-26NOV16DENMIN"],
    );
    assert.deepEqual([totals[0]?.away.name, totals[0]?.home.name].sort(), ["Denver", "Minnesota"]);
  });

  test("Kansas does not substring-match Arkansas, and college basketball reads every Division I game", async () => {
    const odds = await getMarketOdds({
      sport: "basketball",
      league: "mens-college-basketball",
      team: "Kansas",
      date: "20261117",
      venue: "kalshi",
    });
    assert.equal(odds.eventId, "401909787");
    const game = odds.game as { away: { abbrev: string }; home: { abbrev: string } };
    assert.equal(game.home.abbrev, "KU");
    assert.notEqual(game.away.abbrev, "ARK");
    const board = calls.find((call) => call.includes("/scoreboard"));
    assert.ok(board?.includes("groups=50"), board);
    assert.ok(board?.includes("limit=400"), board);

    await assert.rejects(
      () =>
        getMarketOdds({
          sport: "basketball",
          league: "mens-college-basketball",
          team: "Kansas",
          date: "20261118",
          venue: "kalshi",
        }),
      /Kansas matches 2 mens-college-basketball games on 20261118 \(401909787, 401900001\)\. Pass eventId\./,
    );
  });

  test("Polymarket US is built from Gamma and ESPN codes when usId is missing", async () => {
    const rangers = await getMarketOdds({
      sport: "hockey",
      league: "nhl",
      team: "NYR",
      date: "20261116",
      venue: "polymarket_us",
    });
    const rangersUs = (rangers.venues as Array<Record<string, unknown>>).find((venue) => venue.venue === "polymarket_us");
    assert.equal(rangersUs?.status, "ok");
    assert.equal(rangersUs?.slug, "aec-nhl-mon-nyr-2026-11-16");
    assert.equal(rangersUs?.usId, "nhl-mon-nyr-2026-11-16");
    const quote = (rangersUs?.events as Array<Record<string, unknown>>)[0];
    assert.equal((quote?.long as { code: string }).code, "mon");
    assert.equal((quote?.short as { code: string; mid: number; label: string }).code, "nyr");
    assert.equal((quote?.short as { label: string }).label, "mid");
    assert.equal((quote?.long as { mid: number }).mid + (quote?.short as { mid: number }).mid, 1);

    const utah = await getMarketOdds({
      sport: "hockey",
      league: "nhl",
      team: "VAN",
      date: "20261116",
      venue: "polymarket_us",
    });
    const utahUs = (utah.venues as Array<Record<string, unknown>>).find((venue) => venue.venue === "polymarket_us");
    assert.equal(utahUs?.slug, "aec-nhl-van-uta-2026-11-16");
  });

  test("a Polymarket date uses eventDate only and drops duplicate slugs", async () => {
    const listed = await getPolymarketMarkets({ league: "nba", date: "20261117", venue: "polymarket" });
    const global = (listed.venues as Array<Record<string, unknown>>).find((venue) => venue.venue === "polymarket");
    const slugs = (global?.events as Array<{ slug: string }>).map((event) => event.slug);
    assert.deepEqual(slugs.sort(), ["nba-por-min-2026-11-17", "nba-uta-lac-2026-11-17"]);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  test("team filters are exact codes and names, including nicknames, not substrings", async () => {
    const wis = await getPolymarketMarkets({ league: "cbb", team: "WIS", venue: "polymarket" });
    const global = (wis.venues as Array<Record<string, unknown>>).find((venue) => venue.venue === "polymarket");
    const slugs = (global?.events as Array<{ slug: string }>).map((event) => event.slug);
    assert.deepEqual(slugs, ["cbb-wisc-seton-2026-11-19"]);
    assert.equal(slugs.some((slug) => slug.includes("uws")), false);
  });

  test("impossible dates and team-name boundaries fail closed", () => {
    assert.throws(() => isoDate("20261399"), /Invalid date "20261399"/);
    assert.throws(() => isoDate("20260231"), /Invalid date/);
    assert.equal(isoDate("20261117"), "2026-11-17");
    const parsed = dateSchema.safeParse("20261399");
    assert.equal(parsed.success, false);
    assert.match(parsed.error?.issues[0]?.message ?? "", /real calendar day/);

    const previousNight = read("gamma-nba-dates.json")[0];
    assert.equal(gammaEventOnDate(previousNight, "2026-11-17"), false);
    assert.equal(gammaEventOnDate(previousNight, "2026-11-16"), true);
    assert.equal(gammaEventOnDate({ startTime: "2026-11-17T01:00:00Z" }, "2026-11-17"), true);

    const spread = parseKalshiEventTicker("KXNBASPREAD-26NOV16DENMIN12", ["DEN", "MIN"]);
    assert.equal(spread?.awayCode, "DEN");
    assert.equal(spread?.homeCode, "MIN");
    assert.equal(spread?.scheduledDate, "2026-11-16");

    const kansas = { abbrev: "KU", location: "Kansas", name: "Jayhawks", displayName: "Kansas Jayhawks" };
    const arkansas = { abbrev: "ARK", location: "Arkansas", name: "Razorbacks", displayName: "Arkansas Razorbacks" };
    assert.equal(teamHits("mens-college-basketball", kansas, "Kansas"), true);
    assert.equal(teamHits("mens-college-basketball", arkansas, "Kansas"), false);
  });
});
