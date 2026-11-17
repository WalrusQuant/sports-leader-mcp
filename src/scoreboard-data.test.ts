/**
 * Historical scoreboard days come from the games export. HTTP is mocked and
 * parquet fixtures are written in-process. Nothing here contacts a live host.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { apiCache } from "./client.js";
import { sha256 } from "./data/cache.js";
import type { ColumnDef, ColType } from "./data/datasets.js";
import type { ManifestFile } from "./data/manifest.js";
import { scoreboardOutput, slateOutput } from "./output-schemas.js";
import {
  dataLeagueFor,
  eventFromGame,
  seasonForDate,
} from "./scoreboard-data.js";
import { getScoreboard, setScoreboardNowForTests } from "./tools/scoreboard.js";
import { getSlate } from "./tools/slate.js";
import { transformScoreboard, transformSlate } from "./transforms.js";

const PINNED_NOW = new Date("2026-11-17T18:00:00Z");
const MANIFEST_URL = "https://files.example/export/manifest.json";

const SQL_TYPE: Record<ColType, string> = {
  str: "VARCHAR",
  int: "BIGINT",
  float: "DOUBLE",
  bool: "BOOLEAN",
  date: "DATE",
  ts: "TIMESTAMPTZ",
};

const GAME_COLUMNS: ColumnDef[] = [
  { name: "game_id", type: "int" },
  { name: "game_date", type: "date" },
  { name: "start_time", type: "ts" },
  { name: "status", type: "str" },
  { name: "completed", type: "bool" },
  { name: "season", type: "int" },
  { name: "season_type", type: "str" },
  { name: "ending", type: "str" },
  { name: "neutral_site", type: "bool" },
  { name: "home_team_id", type: "int" },
  { name: "home_team_abbr", type: "str" },
  { name: "home_team_name", type: "str" },
  { name: "away_team_id", type: "int" },
  { name: "away_team_abbr", type: "str" },
  { name: "away_team_name", type: "str" },
  { name: "home_score", type: "int" },
  { name: "away_score", type: "int" },
  { name: "venue", type: "str" },
  { name: "venue_city", type: "str" },
];

const ENV_KEYS = [
  "SPORTSLEADER_DATA_MANIFEST_URL",
  "SPORTSLEADER_DATA_BASE_URL",
  "BAYES_DATA_MANIFEST_URL",
  "BAYES_DATA_BASE_URL",
  "BAYES_DATA_CACHE_DIR",
  "BAYES_DATA_REVALIDATE_MS",
  "SPORTS_LEADER_MAX_TOKENS",
] as const;

const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function quote(name: string): string {
  return `"${name}"`;
}

async function writeParquet(file: string, rows: Record<string, unknown>[]): Promise<Buffer> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const table = `fixture_${Math.random().toString(16).slice(2)}`;
  try {
    const defs = GAME_COLUMNS.map((column) => `${quote(column.name)} ${SQL_TYPE[column.type]}`).join(", ");
    await conn.run(`CREATE TABLE ${table} (${defs})`);
    const placeholders = GAME_COLUMNS.map((column) => {
      if (column.type === "date") return "CAST(? AS DATE)";
      if (column.type === "ts") return "CAST(? AS TIMESTAMPTZ)";
      return "?";
    }).join(", ");
    for (const record of rows) {
      const values = GAME_COLUMNS.map((column) => {
        const value = record[column.name];
        if (value === null || value === undefined) return null;
        if (column.type === "int") return BigInt(value as number);
        return value as string | number | boolean;
      });
      await conn.run(`INSERT INTO ${table} VALUES (${placeholders})`, values);
    }
    const dest = file.replaceAll("'", "''");
    await conn.run(`COPY ${table} TO '${dest}' (FORMAT PARQUET, COMPRESSION ZSTD)`);
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
  const { readFile } = await import("node:fs/promises");
  return readFile(file);
}

interface FixtureState {
  manifestStatus: number;
  manifest: unknown;
  files: Map<string, Buffer>;
  calls: string[];
  espn: (url: URL) => unknown;
  injuries: unknown;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function installFetch(state: FixtureState): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    state.calls.push(href);
    const url = new URL(href);
    if (url.pathname.endsWith("/manifest.json")) {
      if (state.manifestStatus !== 200) return new Response("no", { status: state.manifestStatus });
      return jsonResponse(state.manifest);
    }
    if (url.pathname.endsWith(".parquet")) {
      const rel = url.pathname.replace(/^\/export\//, "");
      const body = state.files.get(rel);
      if (!body) return new Response("missing", { status: 404 });
      return new Response(new Uint8Array(body), { status: 200 });
    }
    if (url.pathname.endsWith("/injuries")) return jsonResponse(state.injuries);
    if (url.pathname.endsWith("/scoreboard")) return jsonResponse(state.espn(url));
    return new Response("unexpected", { status: 500 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function game(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    game_id: 401468803,
    game_date: "2023-01-15",
    start_time: "2023-01-15T18:00:00Z",
    status: "final",
    completed: true,
    season: 2023,
    season_type: "regular",
    ending: null,
    neutral_site: false,
    home_team_id: 8,
    home_team_abbr: "DET",
    home_team_name: "Detroit Pistons",
    away_team_id: 18,
    away_team_abbr: "NY",
    away_team_name: "New York Knicks",
    home_score: 104,
    away_score: 117,
    venue: "Little Caesars Arena",
    venue_city: "Detroit",
    ...overrides,
  };
}

function espnEvent(id: string, iso: string): unknown {
  return {
    id,
    date: iso,
    name: "BOS @ ORL",
    shortName: "BOS @ ORL",
    status: { type: { state: "pre", completed: false, shortDetail: "Scheduled" } },
    competitions: [{
      date: iso,
      competitors: [
        { homeAway: "home", team: { id: "2", abbreviation: "ORL", displayName: "Orlando Magic", name: "Magic" }, score: "0" },
        { homeAway: "away", team: { id: "1", abbreviation: "BOS", displayName: "Boston Celtics", name: "Celtics" }, score: "0" },
      ],
    }],
  };
}

describe("historical scoreboards", { concurrency: 1 }, () => {
  let cacheDir = "";
  let parquetDir = "";
  let state: FixtureState;
  let restoreFetch: (() => void) | null = null;

  test.before(async () => {
    cacheDir = await mkdtemp(path.join(tmpdir(), "scoreboard-data-cache-"));
    parquetDir = await mkdtemp(path.join(tmpdir(), "scoreboard-data-parquet-"));
  });

  test.after(async () => {
    restoreEnv();
    setScoreboardNowForTests(null);
    await rm(cacheDir, { recursive: true, force: true });
    await rm(parquetDir, { recursive: true, force: true });
  });

  test.beforeEach(() => {
    apiCache.clear();
    setScoreboardNowForTests(() => PINNED_NOW);
    process.env.SPORTSLEADER_DATA_MANIFEST_URL = MANIFEST_URL;
    delete process.env.SPORTSLEADER_DATA_BASE_URL;
    delete process.env.BAYES_DATA_MANIFEST_URL;
    delete process.env.BAYES_DATA_BASE_URL;
    process.env.BAYES_DATA_CACHE_DIR = cacheDir;
    process.env.BAYES_DATA_REVALIDATE_MS = "0";
    delete process.env.SPORTS_LEADER_MAX_TOKENS;
    state = {
      manifestStatus: 200,
      manifest: { version: 2, generated_at: "2026-11-17T04:00:00Z", files: [] },
      files: new Map(),
      calls: [],
      espn: () => ({ events: [] }),
      injuries: { injuries: [] },
    };
    restoreFetch = installFetch(state);
  });

  test.afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
    restoreEnv();
    setScoreboardNowForTests(null);
  });

  async function publish(
    league: string,
    season: number,
    rows: Record<string, unknown>[],
    updatedAt: string,
  ): Promise<void> {
    const rel = `${league}/games/${season}.parquet`;
    const body = await writeParquet(path.join(parquetDir, `${league}-${season}-${state.files.size}.parquet`), rows);
    state.files.set(rel, body);
    const entry: ManifestFile = {
      path: rel,
      league,
      dataset: "games",
      season,
      rows: rows.length,
      columns: GAME_COLUMNS.map((column) => ({ name: column.name, type: column.type })),
      bytes: body.length,
      sha256: sha256(body),
      updated_at: updatedAt,
      url: `https://files.example/export/${rel}`,
    };
    const manifest = state.manifest as { files: ManifestFile[]; generated_at: string; version: number };
    manifest.files.push(entry);
  }

  function urls(part: string): string[] {
    return state.calls.filter((url) => url.includes(part));
  }

  test("season years and league aliases", () => {
    assert.equal(seasonForDate("nba", "20230115"), 2023);
    assert.equal(seasonForDate("nba", "20221018"), 2023);
    assert.equal(seasonForDate("cbb", "20201125"), 2021);
    assert.equal(seasonForDate("cbb", "20240106"), 2024);
    assert.equal(seasonForDate("mlb", "20260704"), 2026);
    assert.equal(seasonForDate("nfl", "20220908"), 2022);
    assert.equal(seasonForDate("nfl", "20230115"), 2022);
    assert.equal(seasonForDate("cfb", "20240914"), 2024);
    assert.equal(seasonForDate("cfb", "20250101"), 2024);
    assert.equal(dataLeagueFor("football", "college-football"), "cfb");
    assert.equal(dataLeagueFor("basketball", "mens-college-basketball"), "cbb");
    assert.equal(dataLeagueFor("basketball", "womens-college-basketball"), null);
  });

  test("a games row keeps the ESPN event id and omits a winner on a tie", () => {
    const event = eventFromGame(game());
    assert.equal(event?.id, "401468803");
    const tie = eventFromGame(game({ game_id: 9, home_score: 20, away_score: 20 }));
    const competitors = (tie?.competitions as { competitors: { winner?: boolean }[] }[])[0]?.competitors ?? [];
    assert.equal(competitors.every((side) => side.winner === false), true);
    const scheduled = eventFromGame(game({
      status: "scheduled",
      completed: false,
      home_score: null,
      away_score: null,
    }));
    const status = (scheduled?.status as { type: { state: string } }).type;
    assert.equal(status.state, "pre");
    const scheduledSides = (scheduled?.competitions as { competitors: { score?: string }[] }[])[0]?.competitors ?? [];
    assert.equal(scheduledSides.every((side) => side.score === undefined), true);
  });

  test("an NBA week in 2023 is one games query", async () => {
    const rows = [
      game(),
      game({
        game_id: 401468900,
        game_date: "2023-01-16",
        start_time: "2023-01-16T00:30:00Z",
        home_team_abbr: "LAL",
        away_team_abbr: "BOS",
        home_score: 110,
        away_score: 108,
        venue: "Crypto.com Arena",
      }),
    ];
    await publish("nba", 2023, rows, "2026-10-31T15:29:04Z");
    const raw = await getScoreboard.handler({
      sport: "basketball",
      league: "nba",
      dateRange: "20230115-20230121",
    });
    assert.equal(urls("/scoreboard").length, 0);
    assert.equal(urls(".parquet").length, 1);
    const compact = transformScoreboard(raw) as {
      source: string;
      sourceNote: string;
      days: { date: string; source: string; games: number }[];
      events: {
        id: string;
        name: string;
        source: string;
        venue?: { name: string };
        competitors: { homeAway: string; winner?: boolean; score: string; linescores?: string[]; record?: string; team: { abbrev?: string } }[];
        odds?: unknown;
      }[];
    };
    assert.equal(scoreboardOutput.safeParse(compact).success, true);
    assert.equal(compact.source, "data");
    assert.match(compact.sourceNote, /historical games export/);
    assert.match(compact.sourceNote, /Period scores, records, odds, and broadcasts/);
    assert.equal(compact.days.length, 7);
    assert.equal(compact.days.every((day) => day.source === "data"), true);
    assert.equal(compact.days[0]?.games, 1);
    assert.equal(compact.days[1]?.games, 1);
    assert.equal(compact.days[2]?.games, 0);
    const knicks = compact.events.find((event) => event.id === "401468803");
    assert.ok(knicks);
    assert.equal(knicks.source, "data");
    assert.equal(knicks.name, "NY @ DET");
    assert.equal(knicks.venue?.name, "Little Caesars Arena");
    assert.equal(knicks.odds, undefined);
    const home = knicks.competitors.find((side) => side.homeAway === "home");
    const away = knicks.competitors.find((side) => side.homeAway === "away");
    assert.equal(home?.team.abbrev, "DET");
    assert.equal(home?.score, "104");
    assert.equal(home?.winner, false);
    assert.equal(away?.score, "117");
    assert.equal(away?.winner, true);
    assert.equal(home?.linescores, undefined);
    assert.equal(home?.record, undefined);
    assert.deepEqual(compact.events.map((event) => event.id), ["401468803", "401468900"]);
  });

  test("a mixed range keeps old days on the export and recent days on ESPN", async () => {
    await publish("nba", 2027, [
      game({ game_id: 401800013, game_date: "2026-11-13", start_time: "2026-11-13T00:00:00Z", season: 2027 }),
      game({ game_id: 401800014, game_date: "2026-11-14", start_time: "2026-11-14T00:00:00Z", season: 2027 }),
    ], "2026-11-16T12:00:00Z");
    state.espn = (url) => ({
      events: [espnEvent(`espn-${url.searchParams.get("dates")}`, "2026-11-17T00:00:00Z")],
    });
    const raw = await getScoreboard.handler({
      sport: "basketball",
      league: "nba",
      dateRange: "20261113-20261117",
    });
    assert.deepEqual(
      urls("/scoreboard").map((url) => new URL(url).searchParams.get("dates")),
      ["20261115", "20261116", "20261117"],
    );
    assert.equal(urls(".parquet").length, 1);
    const compact = transformScoreboard(raw) as {
      source: string;
      days: { date: string; source: string }[];
      events: { id: string; source: string }[];
    };
    assert.equal(compact.source, "mixed");
    assert.deepEqual(compact.days.map((day) => day.source), ["data", "data", "espn", "espn", "espn"]);
    assert.deepEqual(compact.events.map((event) => event.id), [
      "401800013",
      "401800014",
      "espn-20261115",
      "espn-20261116",
      "espn-20261117",
    ]);
    assert.deepEqual(compact.events.map((event) => event.source), ["data", "data", "espn", "espn", "espn"]);
  });

  test("a missing season falls back to one ESPN request per day", async () => {
    await publish("nba", 2022, [game({ game_date: "2022-01-15", season: 2022 })], "2026-10-31T15:29:04Z");
    state.espn = (url) => ({ events: [espnEvent(`espn-${url.searchParams.get("dates")}`, "2023-01-15T00:00:00Z")] });
    const raw = await getScoreboard.handler({
      sport: "basketball",
      league: "nba",
      date: "20230115",
    });
    assert.equal(urls(".parquet").length, 0);
    assert.equal(urls("/scoreboard").length, 1);
    const compact = transformScoreboard(raw) as { source: string; sourceNote: string; events: { id: string }[] };
    assert.equal(compact.source, "espn");
    assert.match(compact.sourceNote, /not in the games export/);
    assert.equal(compact.events[0]?.id, "espn-20230115");
  });

  test("a manifest failure falls back to ESPN inside the 14-day cap", async () => {
    state.manifestStatus = 500;
    state.espn = (url) => ({ events: [espnEvent(`espn-${url.searchParams.get("dates")}`, "2023-01-15T00:00:00Z")] });
    const raw = await getScoreboard.handler({
      sport: "basketball",
      league: "nba",
      dateRange: "20230115-20230117",
    });
    assert.equal(urls("/scoreboard").length, 3);
    const compact = transformScoreboard(raw) as { source: string; sourceNote: string };
    assert.equal(compact.source, "espn");
    assert.match(compact.sourceNote, /could not be read/);
  });

  test("a long range does not fan out to ESPN when the export is down", async () => {
    state.manifestStatus = 500;
    await assert.rejects(
      () => getScoreboard.handler({
        sport: "basketball",
        league: "nba",
        dateRange: "20230101-20230120",
      }),
      /20 days/,
    );
    assert.equal(urls("/scoreboard").length, 0);
    assert.equal(urls("manifest.json").length, 1);
  });

  test("a multi-week range is one parquet query", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => game({
      game_id: 401470000 + index,
      game_date: `2023-01-${String(index + 1).padStart(2, "0")}`,
      start_time: `2023-01-${String(index + 1).padStart(2, "0")}T01:00:00Z`,
    }));
    await publish("nba", 2023, rows, "2026-10-31T15:29:04Z");
    await getScoreboard.handler({
      sport: "basketball",
      league: "nba",
      dateRange: "20230101-20230215",
    });
    assert.equal(urls("/scoreboard").length, 0);
    assert.equal(urls(".parquet").length, 1);
  });

  test("a conference group stays on ESPN and group 50 can use the export", async () => {
    await publish("cbb", 2024, [
      game({
        game_id: 401600314,
        game_date: "2024-01-06",
        start_time: "2024-01-06T19:00:00Z",
        season: 2024,
        home_team_id: 275,
        home_team_abbr: "WIS",
        home_team_name: "Wisconsin Badgers",
        away_team_abbr: "NEB",
        away_team_name: "Nebraska Cornhuskers",
      }),
    ], "2026-11-01T00:00:00Z");
    state.espn = () => ({ events: [espnEvent("espn-group", "2024-01-06T19:00:00Z")] });
    const grouped = await getScoreboard.handler({
      sport: "basketball",
      league: "mens-college-basketball",
      date: "20240106",
      groups: "8",
    });
    assert.equal(urls(".parquet").length, 0);
    assert.equal(urls("/scoreboard").length, 1);
    assert.equal(new URL(urls("/scoreboard")[0]!).searchParams.get("groups"), "8");
    const groupedCompact = transformScoreboard(grouped) as { source: string; sourceNote: string };
    assert.equal(groupedCompact.source, "espn");
    assert.match(groupedCompact.sourceNote, /groups filter/);

    state.calls.length = 0;
    const division = await getScoreboard.handler({
      sport: "basketball",
      league: "mens-college-basketball",
      date: "20240106",
      groups: "50",
    });
    assert.equal(urls("/scoreboard").length, 0);
    assert.equal(urls(".parquet").length, 1);
    const divisionCompact = transformScoreboard(division) as { source: string; events: { id: string }[] };
    assert.equal(divisionCompact.source, "data");
    assert.equal(divisionCompact.events[0]?.id, "401600314");
  });

  test("college football reads the cfb games file", async () => {
    await publish("cfb", 2024, [
      game({
        game_id: 401628350,
        game_date: "2024-09-14",
        start_time: "2024-09-14T16:00:00Z",
        season: 2024,
        home_team_id: 275,
        home_team_abbr: "WIS",
        home_team_name: "Wisconsin Badgers",
        away_team_id: 333,
        away_team_abbr: "ALA",
        away_team_name: "Alabama Crimson Tide",
        home_score: 17,
        away_score: 42,
        venue: "Camp Randall Stadium",
      }),
    ], "2026-11-01T00:00:00Z");
    const raw = await getScoreboard.handler({
      sport: "football",
      league: "college-football",
      date: "20240914",
    });
    assert.equal(urls("/scoreboard").length, 0);
    const compact = transformScoreboard(raw) as {
      source: string;
      events: { id: string; name: string; competitors: { homeAway: string; team: { id?: string } }[] }[];
    };
    assert.equal(compact.source, "data");
    assert.equal(compact.events[0]?.id, "401628350");
    assert.equal(compact.events[0]?.name, "ALA @ WIS");
    assert.equal(compact.events[0]?.competitors.find((side) => side.homeAway === "home")?.team.id, "275");
  });

  test("a historical slate does not call the injury report", async () => {
    await publish("nba", 2023, [game()], "2026-10-31T15:29:04Z");
    const raw = await getSlate.handler({
      sport: "basketball",
      league: "nba",
      date: "20230115",
      includeInjuries: true,
    });
    assert.equal(urls("/injuries").length, 0);
    const slate = transformSlate(raw, { args: { sport: "basketball", league: "nba", date: "20230115" } }) as {
      source: string;
      injuriesNote?: string;
      games: { eventId: string; home: { keyInjuries: unknown; score: string | null }; odds: { homeMoneyLine: unknown; reason: string } }[];
    };
    assert.equal(slateOutput.safeParse(slate).success, true);
    assert.equal(slate.source, "data");
    assert.match(slate.injuriesNote ?? "", /historical games export/);
    assert.equal(slate.games[0]?.eventId, "401468803");
    assert.equal(slate.games[0]?.home.keyInjuries, null);
    assert.equal(slate.games[0]?.home.score, "104");
    assert.equal(slate.games[0]?.odds.homeMoneyLine, null);
    assert.match(slate.games[0]?.odds.reason ?? "", /not in the historical games export/);
  });

  test("a mixed slate applies injuries only to ESPN games", async () => {
    await publish("nba", 2027, [
      game({ game_id: 401800013, game_date: "2026-11-13", start_time: "2026-11-13T00:00:00Z", season: 2027 }),
    ], "2026-11-16T12:00:00Z");
    state.espn = (url) => ({
      events: [espnEvent(`espn-${url.searchParams.get("dates")}`, "2026-11-17T00:00:00Z")],
    });
    state.injuries = {
      injuries: [{
        id: "2",
        injuries: [{
          status: "Out",
          athlete: { id: "99", displayName: "Paolo Banchero", position: { abbreviation: "F" } },
          details: { type: "Knee" },
        }],
      }],
    };
    const raw = await getSlate.handler({
      sport: "basketball",
      league: "nba",
      dateRange: "20261113-20261117",
      includeInjuries: true,
    });
    assert.equal(urls("/injuries").length, 1);
    const slate = transformSlate(raw) as {
      source: string;
      games: { eventId: string; home: { keyInjuries: { player: string }[] | null } }[];
    };
    assert.equal(slate.source, "mixed");
    const historical = slate.games.find((row) => row.eventId === "401800013");
    const live = slate.games.find((row) => row.eventId === "espn-20261117");
    assert.equal(historical?.home.keyInjuries, null);
    assert.equal(live?.home.keyInjuries?.[0]?.player, "Paolo Banchero");
  });

  test("a scoreboard that exceeds the token budget returns the next page from offset", async () => {
    const rows = Array.from({ length: 30 }, (_, index) => game({
      game_id: 500000000 + index,
      start_time: `2023-01-15T${String(index % 24).padStart(2, "0")}:00:00Z`,
      venue: `Arena ${index} with a long name so the compact game is not tiny`,
    }));
    await publish("nba", 2023, rows, "2026-10-31T15:29:04Z");
    process.env.SPORTS_LEADER_MAX_TOKENS = "1500";
    const raw = await getScoreboard.handler({
      sport: "basketball",
      league: "nba",
      date: "20230115",
    });
    const first = transformScoreboard(raw, { args: { offset: 0 } }) as {
      page: { offset: number; returned: number; total: number; note: string };
      days: { games: number }[];
      events: { id: string }[];
    };
    assert.equal(scoreboardOutput.safeParse(first).success, true);
    assert.equal(first.page.total, 30);
    assert.ok(first.page.returned > 0 && first.page.returned < 30);
    assert.equal(first.days[0]?.games, 30);
    assert.match(first.page.note, /offset=/);
    const second = transformScoreboard(raw, { args: { offset: first.page.returned } }) as {
      page: { offset: number; returned: number; total: number };
      events: { id: string }[];
    };
    assert.equal(second.page.offset, first.page.returned);
    assert.equal(second.page.total, 30);
    assert.notEqual(second.events[0]?.id, first.events[0]?.id);
  });

  test("today, the previous two days, and a future day stay on ESPN", async () => {
    await publish("nba", 2027, [
      game({ game_id: 401909994, game_date: "2026-11-15", start_time: "2026-11-15T00:00:00Z", season: 2027, status: "scheduled", completed: false, home_score: null, away_score: null }),
    ], "2026-11-17T04:00:00Z");
    state.espn = (url) => ({ day: { date: url.searchParams.get("dates") }, events: [espnEvent("live", "2026-11-17T00:00:00Z")] });
    for (const date of ["20261115", "20261116", "20261117", "20261120"]) {
      state.calls.length = 0;
      const raw = await getScoreboard.handler({ sport: "basketball", league: "nba", date });
      assert.equal(urls("manifest.json").length, 0, date);
      assert.equal(urls("/scoreboard").length, 1, date);
      const compact = transformScoreboard(raw) as { source?: string };
      assert.equal(compact.source, undefined, date);
    }
  });

  test("a scheduled export game has a null slate score", async () => {
    await publish("nba", 2027, [
      game({
        game_id: 401909994,
        game_date: "2026-10-28",
        start_time: "2026-10-28T23:00:00Z",
        season: 2027,
        status: "scheduled",
        completed: false,
        home_score: null,
        away_score: null,
      }),
    ], "2026-11-16T12:00:00Z");
    const raw = await getSlate.handler({
      sport: "basketball",
      league: "nba",
      date: "20261028",
      includeInjuries: true,
    });
    const slate = transformSlate(raw) as { games: { status: { state: string }; home: { score: string | null } }[] };
    assert.equal(slate.games[0]?.status.state, "pre");
    assert.equal(slate.games[0]?.home.score, null);
    assert.equal(urls("/injuries").length, 0);
  });
});
