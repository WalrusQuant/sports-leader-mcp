/**
 * End-to-end MCP tests: a real SDK Client talks to createServer() over the
 * in-memory transport while global fetch is served from test/fixtures. The SDK
 * client validates structuredContent against each tool's published
 * outputSchema (JSON Schema via Ajv), so these tests cover what a connector
 * such as Rocky's actually sees.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "./server.js";
import { apiCache } from "./client.js";
import { fixtureState, hasFixture, installFixtureFetch, readFixture } from "./fixture-fetch.js";
import { resetMarketClient } from "./markets/http.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ORIGINAL_TOOLS = [
  "get_scoreboard", "get_game_summary", "get_game_plays", "get_game_odds", "get_game_probabilities",
  "get_standings", "get_league_leaders", "get_injuries", "get_transactions", "get_news",
  "get_teams", "get_team", "get_team_injuries",
  "get_athlete_overview", "get_athlete_stats", "get_athlete_gamelog", "get_athlete_splits",
  "list_sports_and_leagues", "search", "espn_fetch",
];
const SCHEMA_TOOLS = [
  "get_scoreboard", "get_game_summary", "get_game_odds", "get_injuries", "get_athlete_gamelog", "get_slate",
  "get_team_stats", "get_rankings", "get_power_index", "get_futures",
  "get_kalshi_markets", "get_polymarket_markets", "get_market_odds",
];
const MARKET_TOOLS = ["get_kalshi_markets", "get_polymarket_markets", "get_market_odds"];
const ADDED_TOOLS = ["get_slate", "get_team_stats", "get_rankings", "get_power_index", "get_futures"];
const DATA_TOOLS = [
  "get_games", "get_team_box_scores", "get_team_game_stats", "get_player_game_logs",
  "get_rosters", "get_injury_reports", "get_transaction_log", "get_depth_charts",
  "get_probables", "get_lineups", "get_weather", "get_data_status",
];

test.after(installFixtureFetch());

async function connect() {
  const server = createServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools(); // primes the client's output validators
  return { client, tools };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  apiCache.clear();
  fixtureState.log = [];
  const res: any = await client.callTool({ name, arguments: args });
  assert.ok(!res.isError, `${name} returned an error: ${res.content?.[0]?.text}`);
  return res;
}

test("tools/list keeps every existing tool, adds get_slate, and publishes outputSchemas", async () => {
  const { tools } = await connect();
  const names = tools.map((t) => t.name);
  for (const n of ORIGINAL_TOOLS) assert.ok(names.includes(n), `missing ${n}`);
  for (const n of ADDED_TOOLS) assert.ok(names.includes(n), `missing ${n}`);
  for (const n of DATA_TOOLS) assert.ok(names.includes(n), `missing ${n}`);
  for (const n of MARKET_TOOLS) assert.ok(names.includes(n), `missing ${n}`);
  assert.equal(names.length, ORIGINAL_TOOLS.length + ADDED_TOOLS.length + DATA_TOOLS.length + MARKET_TOOLS.length);
  for (const t of tools) {
    if (SCHEMA_TOOLS.includes(t.name)) {
      assert.equal((t.outputSchema as any)?.type, "object", `${t.name} outputSchema`);
    } else {
      assert.equal(t.outputSchema, undefined, `${t.name} should not declare an outputSchema yet`);
    }
  }
  const odds = tools.find((t) => t.name === "get_game_odds")!.outputSchema as any;
  assert.ok(odds.properties.consensus && odds.properties.homeTeam && odds.properties.startUtc);
});

test("get_game_odds: identity + normalized markets, validated, 2 upstream calls, old fields kept", async () => {
  const { client } = await connect();
  const event = readFixture("nfl", "event");
  const res = await call(client, "get_game_odds", { sport: "football", league: "nfl", eventId: event.id });
  const sc = res.structuredContent;
  assert.deepEqual(JSON.parse(res.content[0].text), sc, "text block mirrors structuredContent");
  assert.equal(sc.eventId, event.id);
  assert.ok(sc.startUtc && sc.homeTeam.abbrev && sc.awayTeam.abbrev);
  assert.equal(fixtureState.log.length, 2, `odds + event only, got ${fixtureState.log.join(", ")}`);
  const first = sc.odds[0];
  for (const k of ["provider", "home", "away", "open", "current"]) assert.ok(k in first, `legacy field ${k}`);
  assert.equal(typeof first.homeMoneyLine, "number");
  assert.equal(typeof first.homeSpread, "number");
  assert.ok(Math.abs(first.homeNoVigProb + first.awayNoVigProb - 1) < 3e-4);
});

test("get_game_odds still works when the event lookup fails", async () => {
  const { client } = await connect();
  fixtureState.failEvents = true;
  try {
    const res = await call(client, "get_game_odds", { sport: "football", league: "nfl", eventId: "401872981" });
    const sc = res.structuredContent;
    assert.equal(sc.eventId, "401872981");
    assert.equal(sc.startUtc, null);
    assert.match(sc.homeTeam.id, /^\d+$/, "team ID falls back to the odds $ref");
    assert.equal(sc.homeTeam.abbrev, null);
    assert.ok(sc.odds.length > 0);
  } finally {
    fixtureState.failEvents = false;
  }
});

test("raw=true returns the untouched ESPN JSON and makes no extra calls", async () => {
  const { client } = await connect();
  const res = await call(client, "get_game_odds", { sport: "football", league: "nfl", eventId: "401872981", raw: true });
  const rawFixture = readFixture("nfl", "odds");
  assert.deepEqual(JSON.parse(res.content[0].text), rawFixture);
  assert.equal(res.structuredContent.raw, true);
  assert.equal(fixtureState.log.length, 1);
});

test("get_slate: two upstream calls, schema-valid, and served from cache on repeat", async () => {
  const { client } = await connect();
  const res = await call(client, "get_slate", { sport: "football", league: "nfl", date: "20261011" });
  assert.equal(fixtureState.log.length, 2, fixtureState.log.join(", "));
  const sc = res.structuredContent;
  assert.ok(sc.gameCount > 0);
  assert.equal(sc.injuriesAvailable, true);
  const g = sc.games[0];
  assert.ok(g.eventId && g.startUtc && g.home.id && g.away.id);
  assert.equal(typeof g.odds.homeNoVigProb, "number");
  fixtureState.log = [];
  await client.callTool({ name: "get_slate", arguments: { sport: "football", league: "nfl", date: "20261011" } });
  assert.equal(fixtureState.log.length, 0, "second call is fully cached");
});

test("get_slate degrades gracefully when the injury endpoint fails", async () => {
  const { client } = await connect();
  fixtureState.failInjuries = true;
  try {
    const res = await call(client, "get_slate", { sport: "baseball", league: "mlb", date: "20261006" });
    const sc = res.structuredContent;
    assert.equal(sc.injuriesAvailable, false);
    assert.match(sc.injuriesNote, /unavailable/);
    assert.equal(sc.games[0].home.keyInjuries, null);
  } finally {
    fixtureState.failInjuries = false;
  }
});

test("schema tools validate end to end for every fixture league", async () => {
  const { client } = await connect();
  const sports: Record<string, string> = {
    nfl: "football", "college-football": "football", mlb: "baseball", nba: "basketball",
    wnba: "basketball", nhl: "hockey", "eng.1": "soccer",
  };
  for (const [league, sport] of Object.entries(sports)) {
    const event = readFixture(league, "event");
    await call(client, "get_scoreboard", { sport, league });
    await call(client, "get_game_summary", { sport, league, eventId: event.id });
    await call(client, "get_game_odds", { sport, league, eventId: event.id });
    await call(client, "get_slate", { sport, league });
    if (hasFixture(league, "injuries")) await call(client, "get_injuries", { sport, league });
    if (hasFixture(league, "gamelog")) {
      await call(client, "get_athlete_gamelog", { sport, league, athleteId: "1" });
    }
  }
});

test("prediction markets: schemas, call counts, labels, and a postponed Kalshi date", async () => {
  const { client } = await connect();
  resetMarketClient();
  const kalshi = await call(client, "get_kalshi_markets", { league: "nfl", date: "20261011" });
  assert.equal(kalshi.structuredContent.averaged, false);
  assert.equal(kalshi.structuredContent.events.length, 1);
  assert.equal(kalshi.structuredContent.events[0].eventTicker, "KXNFLGAME-26OCT11PHIJAC");
  assert.equal(fixtureState.log.filter((path) => path.endsWith("/markets") && path.includes("trade-api")).length, 1);
  assert.equal(fixtureState.log.some((path) => path.endsWith("/orderbook")), false);

  resetMarketClient();
  fixtureState.log = [];
  const booked = await call(client, "get_kalshi_markets", { league: "nfl", date: "20261011", includeBook: true });
  const yes = booked.structuredContent.events[0].markets[0];
  assert.equal(yes.priceSource, "dollars");
  assert.equal(yes.book.priceSource, "orderbook");
  assert.equal(yes.book.yesAsk, 0.29);
  assert.equal(yes.yesAsk, 0.43);
  assert.equal(fixtureState.log.filter((path) => path.endsWith("/orderbook")).length, 2);

  resetMarketClient();
  fixtureState.log = [];
  const poly = await call(client, "get_polymarket_markets", { league: "nfl", date: "20261011", venue: "both" });
  const names = poly.structuredContent.venues.map((venue: { venue: string }) => venue.venue);
  assert.deepEqual(names, ["polymarket", "polymarket_us"]);
  assert.equal(poly.structuredContent.venues[0].status, "ok");
  assert.equal(poly.structuredContent.venues[1].status, "ok");
  assert.equal(poly.structuredContent.venues[1].slug, "aec-nfl-phi-jax-2026-10-11");
  assert.equal(poly.structuredContent.venues[1].usId, "nfl-phi-jax-2026-10-11");
  assert.equal(poly.structuredContent.venues[0].events[0].markets[0].outcomes[0].priceSource, "gamma_outcome_prices");
  assert.deepEqual(poly.structuredContent.venues[0].events[0].markets[0].outcomes.map((o: { name: string }) => o.name), ["Eagles", "Jaguars"]);
  const paths = fixtureState.log;
  assert.equal(paths.filter((path) => path === "/events").length, 1);
  assert.equal(paths.filter((path) => path === "/markets").length, 1);
  assert.equal(paths.filter((path) => path.endsWith("/bbo")).length, 1);
  assert.equal(paths.some((path) => path === "/books"), false);

  resetMarketClient();
  fixtureState.log = [];
  const usOnly = await call(client, "get_polymarket_markets", { league: "nfl", date: "20261011", venue: "polymarket_us" });
  assert.deepEqual(usOnly.structuredContent.venues.map((venue: { venue: string }) => venue.venue), ["polymarket_us"]);

  resetMarketClient();
  fixtureState.log = [];
  const odds = await call(client, "get_market_odds", { sport: "football", league: "nfl", eventId: "401872981" });
  assert.equal(odds.structuredContent.averaged, false);
  assert.equal(odds.structuredContent.eventId, "401872981");
  assert.equal(odds.structuredContent.game.away.abbrev, "PHI");
  assert.equal(odds.structuredContent.game.home.abbrev, "JAX");
  assert.deepEqual(
    odds.structuredContent.venues.map((venue: { venue: string }) => venue.venue),
    ["kalshi", "polymarket", "polymarket_us"],
  );
  const kalshiVenue = odds.structuredContent.venues[0];
  assert.equal(kalshiVenue.status, "ok");
  assert.equal(kalshiVenue.matchedBy, "teams+scheduledDate");
  assert.match(odds.structuredContent.venues[1].matchedBy, /eventDate/);
  assert.equal(odds.structuredContent.venues[2].slug, `aec-${odds.structuredContent.venues[2].usId}`);
  assert.equal(fixtureState.log.length, 5, fixtureState.log.join(", "));

  resetMarketClient();
  const postponed = await call(client, "get_market_odds", { sport: "football", league: "nfl", eventId: "401872990" });
  const postponedKalshi = postponed.structuredContent.venues.find((venue: { venue: string }) => venue.venue === "kalshi");
  assert.equal(postponedKalshi.status, "ok");
  assert.match(postponedKalshi.matchedBy, /2026-10-10/);
  assert.match(postponedKalshi.matchedBy, /postponed/);
  assert.equal(postponed.structuredContent.venues.find((venue: { venue: string }) => venue.venue === "polymarket").status, "no market found");

  resetMarketClient();
  fixtureState.failKalshi = true;
  try {
    const isolated = await call(client, "get_market_odds", { sport: "football", league: "nfl", eventId: "401872981" });
    const venues = isolated.structuredContent.venues;
    assert.equal(venues[0].status, "error");
    assert.match(venues[0].error, /500/);
    assert.equal(venues[1].status, "ok");
    assert.equal(venues[2].status, "ok");
  } finally {
    fixtureState.failKalshi = false;
  }
});
