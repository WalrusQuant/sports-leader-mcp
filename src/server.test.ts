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
import { chicagoToday } from "./tools/preview.js";
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
  "get_player_report", "get_player_trends", "get_game_preview",
];
const MARKET_TOOLS = ["get_kalshi_markets", "get_polymarket_markets", "get_market_odds"];
const ADDED_TOOLS = ["get_slate", "get_team_stats", "get_rankings", "get_power_index", "get_futures"];
const DATA_TOOLS = [
  "get_games", "get_team_box_scores", "get_team_game_stats", "get_player_game_logs",
  "get_rosters", "get_injury_reports", "get_transaction_log", "get_depth_charts",
  "get_probables", "get_lineups", "get_weather", "get_player_trends", "get_data_status",
];
const PLAYER_TOOLS = ["get_player_report"];
const PREVIEW_TOOLS = ["get_game_preview"];

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
  for (const n of PLAYER_TOOLS) assert.ok(names.includes(n), `missing ${n}`);
  for (const n of PREVIEW_TOOLS) assert.ok(names.includes(n), `missing ${n}`);
  assert.equal(
    names.length,
    ORIGINAL_TOOLS.length + ADDED_TOOLS.length + DATA_TOOLS.length + MARKET_TOOLS.length + PLAYER_TOOLS.length + PREVIEW_TOOLS.length,
  );
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

const JACOBS_SEARCH = {
  results: [{
    type: "player",
    contents: [
      {
        uid: "s:20~l:28~a:4047365",
        type: "player",
        displayName: "Josh Jacobs",
        sport: "football",
        defaultLeagueSlug: "nfl",
        subtitle: "Green Bay Packers",
      },
      {
        uid: "s:40~l:41~a:8277",
        type: "player",
        displayName: "Josh Jacobs",
        sport: "basketball",
        defaultLeagueSlug: "mens-college-basketball",
        subtitle: "Little Rock Trojans",
      },
    ],
  }],
};

const TWO_NFL_JACOBS = {
  results: [{
    type: "player",
    contents: [
      {
        uid: "s:20~l:28~a:4047365",
        type: "player",
        displayName: "Josh Jacobs",
        sport: "football",
        defaultLeagueSlug: "nfl",
        subtitle: "Green Bay Packers",
      },
      {
        uid: "s:20~l:28~a:111",
        type: "player",
        displayName: "Josh Jacobs",
        sport: "football",
        defaultLeagueSlug: "nfl",
        subtitle: "Las Vegas Raiders",
      },
    ],
  }],
};

test("get_player_report resolves Josh Jacobs in the NFL and keeps the other blocks when splits fail", async () => {
  const { client } = await connect();
  fixtureState.searchBody = JACOBS_SEARCH;
  fixtureState.failSplits = true;
  try {
    const res = await call(client, "get_player_report", {
      sport: "football",
      league: "nfl",
      player: "Josh Jacobs",
      lastN: 5,
    });
    const sc = res.structuredContent;
    assert.equal(sc.resolved, true);
    assert.equal(sc.athlete.id, "4047365");
    assert.equal(sc.athlete.name, "Josh Jacobs");
    assert.equal(sc.athlete.team, "GB");
    assert.equal(sc.athlete.position, "RB");
    assert.equal(sc.season.year, 2026);
    assert.equal(sc.season.categories[0].stats.CAR, "36");
    assert.ok(sc.recent.length > 0);
    assert.equal(sc.splits, undefined);
    assert.match(sc.errors.splits, /splits unavailable/);
    assert.equal(sc.errors.season, undefined);
    assert.ok(sc.sources.some((source: { block: string }) => source.block === "gamelog"));

    fixtureState.searchBody = TWO_NFL_JACOBS;
    const ambiguous = await call(client, "get_player_report", {
      sport: "football",
      league: "nfl",
      player: "Josh Jacobs",
    });
    assert.equal(ambiguous.structuredContent.resolved, false);
    assert.equal(ambiguous.structuredContent.reason, "ambiguous");
    assert.equal(ambiguous.structuredContent.athlete, undefined);
    assert.deepEqual(
      ambiguous.structuredContent.candidates.map((candidate: { id: string }) => candidate.id).sort(),
      ["111", "4047365"],
    );
    assert.equal(fixtureState.log.some((path) => path.endsWith("/stats")), false);

    fixtureState.searchBody = undefined;
    const byId = await call(client, "get_player_report", {
      sport: "football",
      league: "nfl",
      player: "4047365",
      include: ["recent"],
    });
    assert.equal(byId.structuredContent.athlete.id, "4047365");
    assert.ok(byId.structuredContent.recent.length > 0);
    assert.equal(byId.structuredContent.season, undefined);
    assert.equal(byId.structuredContent.splits, undefined);
    assert.equal(fixtureState.log.some((path) => path.endsWith("/search/v2")), false);
  } finally {
    fixtureState.failSplits = false;
    fixtureState.searchBody = undefined;
  }
});

test("chicagoToday is the America/Chicago calendar day", () => {
  assert.equal(chicagoToday(new Date("2026-11-17T04:30:00Z")), "20261116");
  assert.equal(chicagoToday(new Date("2026-11-17T06:30:00Z")), "20261117");
});

test("get_game_preview: one game, schema, call count, and both winner books", async () => {
  const { client } = await connect();
  resetMarketClient();
  const res = await call(client, "get_game_preview", {
    sport: "football",
    league: "nfl",
    eventId: "401872981",
  });
  const sc = res.structuredContent;
  assert.equal(sc.event.id, "401872981");
  assert.equal(sc.event.away.abbr, "PHI");
  assert.equal(sc.event.home.abbr, "JAX");
  assert.equal(sc.event.venue, "Tottenham Hotspur Stadium");
  assert.equal(sc.event.indoor, false);
  assert.equal(sc.event.startUtc, "2026-10-11T13:30Z");
  assert.deepEqual(
    sc.injuries.away.map((row: { player: string }) => row.player),
    ["Lane Johnson"],
  );
  assert.equal(sc.injuries.away[0].detail, "Left Knee Surgery");
  assert.equal(sc.injuries.home[0].player, "Travis Hunter");
  assert.equal(sc.injuries.home[0].status, "Doubtful");
  assert.equal(sc.probables, null);
  assert.equal(sc.lineups, null);
  assert.deepEqual(sc.weather, { tempF: 64, condition: "Clear", windMph: 12, precipPct: 10 });
  const kalshi = sc.markets.kalshi;
  assert.equal(kalshi.find((row: { team: string }) => row.team === "PHI").bid, 0.41);
  assert.equal(kalshi.find((row: { team: string }) => row.team === "JAX").ticker, "KXNFLGAME-26OCT11PHIJAC-JAC");
  const us = sc.markets.polymarketUS;
  assert.equal(us.find((row: { team: string }) => row.team === "PHI").mid, 0.42);
  assert.equal(us.find((row: { team: string }) => row.team === "PHI").label, "mid");
  assert.equal(us.find((row: { team: string }) => row.team === "JAX").mid, 0.58);
  assert.equal(us.find((row: { team: string }) => row.team === "JAX").label, "mid");
  assert.equal(us[0].slug, "aec-nfl-phi-jax-2026-10-11");
  assert.equal(sc.errors, undefined);
  assert.ok(sc.sources.includes("espn summary"));
  assert.ok(sc.sources.includes("kalshi trade-api/v2"));
  assert.ok(sc.sources.includes("polymarket.us gateway"));
  const paths = fixtureState.log;
  assert.equal(paths.filter((path) => path.endsWith("/summary")).length, 1);
  assert.equal(paths.filter((path) => path.endsWith("/scoreboard")).length, 1, paths.join(", "));
  assert.equal(paths.filter((path) => path.includes("/trade-api/")).length, 1);
  assert.equal(paths.filter((path) => path === "/events").length, 1);
  assert.equal(paths.filter((path) => path === "/markets").length, 1);
  assert.equal(paths.filter((path) => path.endsWith("/bbo")).length, 1);
  assert.equal(paths.length, 6, paths.join(", "));
});

test("get_game_preview include fetches only the requested block", async () => {
  const { client } = await connect();
  resetMarketClient();
  const res = await call(client, "get_game_preview", {
    sport: "football",
    league: "nfl",
    eventId: "401872981",
    include: ["injuries"],
  });
  const sc = res.structuredContent;
  assert.equal(sc.injuries.away[0].player, "Lane Johnson");
  assert.equal(sc.weather, undefined);
  assert.equal(sc.markets, undefined);
  assert.equal(sc.probables, undefined);
  assert.equal(sc.lineups, undefined);
  assert.deepEqual(
    fixtureState.log.map((path) => path.split("/").pop()),
    ["summary"],
  );
});

test("get_game_preview keeps the other blocks when one fetch fails", async () => {
  const { client } = await connect();
  resetMarketClient();
  fixtureState.failSummary = true;
  try {
    const failedSummary = await call(client, "get_game_preview", {
      sport: "football",
      league: "nfl",
      eventId: "401872981",
    });
    const sc = failedSummary.structuredContent;
    assert.equal(sc.event.away.abbr, "PHI");
    assert.equal(sc.injuries, undefined);
    assert.match(sc.errors.injuries, /500/);
    assert.match(sc.errors.weather, /500/);
    assert.equal(sc.markets.kalshi.length, 2);
    assert.equal(sc.markets.polymarketUS[0].slug, "aec-nfl-phi-jax-2026-10-11");
  } finally {
    fixtureState.failSummary = false;
  }

  resetMarketClient();
  fixtureState.failKalshi = true;
  try {
    const failedKalshi = await call(client, "get_game_preview", {
      sport: "football",
      league: "nfl",
      eventId: "401872981",
    });
    const sc = failedKalshi.structuredContent;
    assert.equal(sc.injuries.away[0].player, "Lane Johnson");
    assert.equal(sc.weather.tempF, 64);
    assert.equal(sc.markets.kalshi, "no market found");
    assert.equal(sc.markets.polymarketUS.length, 2);
    assert.match(sc.errors.markets, /kalshi:/);
    assert.match(sc.errors.markets, /500/);
  } finally {
    fixtureState.failKalshi = false;
  }
});

test("get_game_preview resolves one team and keeps a postponed Kalshi date", async () => {
  const { client } = await connect();
  resetMarketClient();
  const byTeam = await call(client, "get_game_preview", {
    sport: "football",
    league: "nfl",
    team: "PHI",
    date: "20261011",
    include: ["markets"],
  });
  assert.equal(byTeam.structuredContent.event.id, "401872981");
  assert.equal(byTeam.structuredContent.event.home.abbr, "JAX");

  resetMarketClient();
  const postponed = await call(client, "get_game_preview", {
    sport: "football",
    league: "nfl",
    eventId: "401872990",
    include: ["markets"],
  });
  const tickers = postponed.structuredContent.markets.kalshi.map((row: { ticker: string }) => row.ticker);
  assert.ok(tickers.some((ticker: string) => ticker.includes("26OCT10")));
  assert.equal(postponed.structuredContent.markets.polymarketUS, "no market found");

  const missing = await client.callTool({
    name: "get_game_preview",
    arguments: { sport: "football", league: "nfl", team: "NOPE", date: "20261011" },
  });
  assert.equal(missing.isError, true);
  const neither = await client.callTool({
    name: "get_game_preview",
    arguments: { sport: "football", league: "nfl" },
  });
  assert.equal(neither.isError, true);

  const disagree = await client.callTool({
    name: "get_game_preview",
    arguments: { sport: "football", league: "nfl", eventId: "401872981", team: "Dallas" },
  });
  assert.equal(disagree.isError, true);
  const disagreeText = JSON.stringify(disagree.content ?? []);
  assert.match(disagreeText, /Dallas/);
  assert.match(disagreeText, /401872981/);
});

test("get_game_preview reads MLB probables from the scoreboard", async () => {
  const { client } = await connect();
  const res = await call(client, "get_game_preview", {
    sport: "baseball",
    league: "mlb",
    eventId: "401908015",
    include: ["probables"],
  });
  const sc = res.structuredContent;
  assert.equal(sc.event.id, "401908015");
  assert.equal(sc.probables.home.player, "Chris Sale");
  assert.equal(sc.probables.home.role, "Probable Starting Pitcher");
  assert.equal(sc.probables.away.player, "Yoshinobu Yamamoto");
  assert.equal(sc.markets, undefined);
  assert.equal(sc.injuries, undefined);
});
