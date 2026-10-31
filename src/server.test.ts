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
];
const ADDED_TOOLS = ["get_slate", "get_team_stats", "get_rankings", "get_power_index", "get_futures"];

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
  assert.equal(names.length, ORIGINAL_TOOLS.length + ADDED_TOOLS.length);
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
