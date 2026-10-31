/**
 * Historical export tests. Fixtures are generated in-process with DuckDB.
 * HTTP is mocked. Nothing here contacts a live host.
 */
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ALL_TOOLS, runTool } from "../server.js";
import {
  DEFAULT_BAYES_DATA_MANIFEST_URL,
  isDataExportConfigured,
  normalizeBaseUrl,
  readDataConfig,
  requireDataConfig,
  type DataConfig,
} from "./config.js";
import { dataStatus, sha256 } from "./cache.js";
import { columnsFor, DATASET_INFO, type ColumnDef, type ColType } from "./datasets.js";
import { dataUrl, type DataDeps } from "./http.js";
import type { ManifestFile } from "./manifest.js";
import { queryDataset } from "./query.js";
import { DATA_TOOL_NAMES, getGames, getPlayerGameLogs } from "./tools.js";

const SQL_TYPE: Record<ColType, string> = {
  str: "VARCHAR",
  int: "BIGINT",
  float: "DOUBLE",
  bool: "BOOLEAN",
  date: "DATE",
  ts: "TIMESTAMPTZ",
};

function quote(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`bad column ${name}`);
  return `"${name}"`;
}

function sampleValue(column: ColumnDef, index: number, league: string): unknown {
  switch (column.name) {
    case "league":
      return league;
    case "season":
      return 2026;
    case "season_type":
      return "regular";
    case "source":
      return "espn";
    case "game_id":
      return 401000 + index;
    case "game_date":
    case "date":
    case "return_date":
      return index === 0 ? "2026-01-15" : "2026-01-16";
    case "team_id":
    case "home_team_id":
      return 13;
    case "team_abbr":
    case "home_team_abbr":
      return "LAL";
    case "team_name":
    case "home_team_name":
      return "Los Angeles Lakers";
    case "opponent_id":
    case "away_team_id":
      return 2;
    case "opponent_abbr":
    case "away_team_abbr":
      return "BOS";
    case "opponent_name":
    case "away_team_name":
      return "Boston Celtics";
    case "player_id":
      return 1966;
    case "player_name":
      return "LeBron James";
    case "is_home":
    case "completed":
    case "starter":
      return true;
    case "valid_to":
      return null;
    case "start_time":
    case "valid_from":
    case "last_seen":
    case "first_seen":
    case "reported_at":
    case "injury_date":
    case "period_start":
      return "2026-01-15T18:00:00Z";
    default:
      if (column.type === "str") return column.name;
      if (column.type === "int") return index + 1;
      if (column.type === "float") return 1.25;
      if (column.type === "bool") return index === 0;
      if (column.type === "date") return "2026-01-15";
      return "2026-01-15T18:00:00Z";
  }
}

function row(columns: ColumnDef[], league: string, overrides: Record<string, unknown> = {}, index = 0) {
  const out: Record<string, unknown> = {};
  for (const column of columns) out[column.name] = sampleValue(column, index, league);
  return { ...out, ...overrides };
}

async function writeParquet(file: string, columns: ColumnDef[], rows: Record<string, unknown>[]): Promise<Buffer> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:");
  const conn = await instance.connect();
  const table = `fixture_${Math.random().toString(16).slice(2)}`;
  try {
    const defs = columns.map((column) => `${quote(column.name)} ${SQL_TYPE[column.type]}`).join(", ");
    await conn.run(`CREATE TABLE ${table} (${defs})`);
    const placeholders = columns
      .map((column) => {
        if (column.type === "date") return "CAST(? AS DATE)";
        if (column.type === "ts") return "CAST(? AS TIMESTAMPTZ)";
        return "?";
      })
      .join(", ");
    for (const record of rows) {
      const values = columns.map((column) => {
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

interface StoredFile {
  body: Buffer;
  sha256: string;
  entry: ManifestFile;
}

function fileEntry(
  dataset: string,
  league: string,
  season: number,
  columns: ColumnDef[],
  body: Buffer,
  rowCount: number,
  updatedAt: string,
): StoredFile {
  const rel = `${league}/${dataset}/${season}.parquet`;
  return {
    body,
    sha256: sha256(body),
    entry: {
      path: rel,
      league,
      dataset,
      season,
      rows: rowCount,
      columns: columns.map((column) => ({ name: column.name, type: column.type })),
      bytes: body.length,
      sha256: sha256(body),
      updated_at: updatedAt,
    },
  };
}

interface Call {
  url: string;
  key: string | null;
  ifNoneMatch: string | null;
}

interface MockState {
  calls: Call[];
  files: Map<string, Buffer>;
  manifest: unknown;
  etag: string | null;
  redirect: boolean;
  unauthorized: boolean;
  parquetBodies: Buffer[] | null;
  parquetServes: number;
  alwaysRedirect: boolean;
}

function manifestBody(files: StoredFile[], generatedAt = "2026-10-31T12:00:00Z") {
  return {
    version: 2,
    generated_at: generatedAt,
    ids: "game_id = ESPN event id",
    datasets: Object.fromEntries(
      DATASET_INFO.map((info) => [info.dataset, { leagues: [...info.leagues], about: info.about }]),
    ),
    files: files.map((file) => file.entry),
  };
}

function mockFetch(state: MockState): DataDeps["fetch"] {
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    state.calls.push({
      url: url.href,
      key: headers.get("x-api-key"),
      ifNoneMatch: headers.get("if-none-match"),
    });
    if (state.unauthorized) {
      return new Response("no", { status: 401, headers: { "WWW-Authenticate": "ApiKey" } });
    }
    if (state.alwaysRedirect) {
      const next = new URL(url.href);
      next.hostname = `hop${state.calls.length}.example`;
      return new Response(null, { status: 302, headers: { Location: next.href } });
    }
    const release = url.pathname.match(/^\/([a-z]+)_([a-z0-9_]+)\/(\d{4})\.parquet$/);
    if (url.hostname === "releases.example" && release) {
      const dest = new URL(url.href);
      dest.hostname = "cdn.example";
      return new Response(null, { status: 302, headers: { Location: dest.href, "Cache-Control": "no-cache" } });
    }
    if (release && url.hostname === "cdn.example") {
      const key = `${release[1]}/${release[2]}/${release[3]}.parquet`;
      const file = state.files.get(key);
      if (!file) return new Response("missing", { status: 404 });
      return new Response(new Uint8Array(file), { status: 200, headers: { ETag: "\"0xCDN\"" } });
    }
    if (state.redirect && url.hostname === "files.example") {
      const dest = new URL(url.href);
      dest.hostname = "cdn.example";
      return new Response(null, { status: 302, headers: { Location: dest.href } });
    }
    const rel = url.pathname.replace(/^\/export\//, "");
    if (rel === "manifest.json") {
      const body = Buffer.from(JSON.stringify(state.manifest));
      if (state.etag && headers.get("if-none-match") === state.etag) {
        return new Response(null, { status: 304, headers: { ETag: state.etag } });
      }
      const responseHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (state.etag) responseHeaders.ETag = state.etag;
      return new Response(new Uint8Array(body), { status: 200, headers: responseHeaders });
    }
    const file = state.files.get(rel);
    if (!file) return new Response("missing", { status: 404 });
    let body = file;
    if (state.parquetBodies) {
      body = state.parquetBodies[Math.min(state.parquetServes, state.parquetBodies.length - 1)] ?? file;
      state.parquetServes += 1;
    }
    const etag = state.etag ? `"${sha256(body)}"` : null;
    const responseHeaders: Record<string, string> = { "Content-Type": "application/octet-stream" };
    if (etag) responseHeaders.ETag = etag;
    return new Response(new Uint8Array(body), { status: 200, headers: responseHeaders });
  };
}

function deps(state: MockState, now: () => number): DataDeps {
  return { fetch: mockFetch(state), now };
}

function config(cacheDir: string, overrides: Partial<DataConfig> = {}): DataConfig {
  return {
    manifestUrl: "https://files.example/export/manifest.json",
    baseUrl: "https://files.example/export",
    cacheDir,
    revalidateMs: 60 * 60 * 1000,
    ...overrides,
  };
}

describe("bayes data export", { concurrency: 1 }, () => {
  test("GitHub Releases is the default manifest and directory overrides still work", () => {
    assert.equal(
      DEFAULT_BAYES_DATA_MANIFEST_URL,
      "https://github.com/WalrusQuant/bayesratings-data/releases/download/manifest/manifest.json",
    );
    const builtin = readDataConfig({});
    assert.equal(builtin?.manifestUrl, DEFAULT_BAYES_DATA_MANIFEST_URL);
    assert.equal(builtin?.baseUrl, null);
    assert.equal(isDataExportConfigured({}), true);
    const directory = readDataConfig({ BAYES_DATA_BASE_URL: "https://cdn.example/releases/data/" });
    assert.equal(directory?.baseUrl, "https://cdn.example/releases/data");
    assert.equal(directory?.manifestUrl, "https://cdn.example/releases/data/manifest.json");
    const manifestOnly = readDataConfig({
      BAYES_DATA_MANIFEST_URL: "https://example.com/custom/manifest.json",
    });
    assert.equal(manifestOnly?.manifestUrl, "https://example.com/custom/manifest.json");
    assert.equal(manifestOnly?.baseUrl, null);
    assert.equal(readDataConfig({ BAYES_DATA_BASE_URL: "  ", BAYES_DATA_MANIFEST_URL: "  " }, ""), null);
    assert.equal(isDataExportConfigured({ BAYES_DATA_BASE_URL: "https://cdn.example/data" }), true);
    assert.throws(() => normalizeBaseUrl("https://user:super-secret@files.example/data"), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /credentials/);
      assert.equal(err.message.includes("super-secret"), false);
      return true;
    });
    assert.equal(
      dataUrl("https://github.com/org/repo/releases/download/data", "nba/games/2027.parquet"),
      "https://github.com/org/repo/releases/download/data/nba/games/2027.parquet",
    );
    assert.equal(dataUrl("https://files.example/export/", "manifest.json"), "https://files.example/export/manifest.json");
  });

  test("tools report data export not configured when no base url is set", async () => {
    assert.throws(() => requireDataConfig({ BAYES_DATA_BASE_URL: "", BAYES_DATA_MANIFEST_URL: "" }, ""), /data export not configured/);
    if (!isDataExportConfigured()) {
      const result = await runTool(getGames, { league: "nba" });
      assert.equal(result.isError, true);
      const block = result.content[0];
      assert.equal(block?.type, "text");
      if (block?.type === "text") assert.match(block.text, /data export not configured/);
    }
  });

  test("existing tools stay first and every data set has a tool", () => {
    const names = ALL_TOOLS.map((tool) => tool.name);
    assert.deepEqual(names.slice(0, 25), [
      "get_scoreboard", "get_game_summary", "get_game_plays", "get_game_odds", "get_game_probabilities",
      "get_standings", "get_league_leaders", "get_injuries", "get_transactions", "get_news",
      "get_teams", "get_team", "get_team_injuries", "get_team_stats",
      "get_athlete_overview", "get_athlete_stats", "get_athlete_gamelog", "get_athlete_splits",
      "list_sports_and_leagues", "search", "espn_fetch",
      "get_slate",
      "get_rankings", "get_power_index", "get_futures",
    ]);
    assert.deepEqual(names.slice(25), [...DATA_TOOL_NAMES]);
    assert.equal(names.includes("get_injuries"), true);
    assert.equal(names.includes("get_injury_reports"), true);
    assert.equal(names.includes("get_transactions"), true);
    assert.equal(names.includes("get_transaction_log"), true);
  });

  test("player log stat groups are validated before any download", async () => {
    await assert.rejects(() => getPlayerGameLogs.handler({ league: "nba", statGroup: "goalie" }), /not valid for nba/);
    await assert.rejects(() => getPlayerGameLogs.handler({ league: "nhl" }), /statGroup is required/);
  });

  test("queries filter fixtures without interpolating untrusted sql", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bayes-data-"));
    try {
      const stored = await buildFixtures(dir);
      const state = freshState(stored);
      let now = Date.parse("2026-10-31T18:00:00Z");
      const cfg = config(dir);
      const run = (query: Parameters<typeof queryDataset>[1]) =>
        queryDataset(cfg, query, deps(state, () => now));

      const games = await run({ dataset: "games", league: "nba", seasons: [2026] });
      assert.equal(games.rowCount, 2);
      assert.equal(games.updated_at, "2026-10-30T12:00:00Z");
      assert.equal(games.rows[0]?.game_date, "2026-01-16");
      assert.equal(typeof games.rows[0]?.game_id, "number");
      assert.equal(games.files[0]?.updated_at, "2026-10-30T12:00:00Z");
      assert.ok(state.calls.every((call) => call.key === null));

      const byAbbr = await run({ dataset: "games", league: "nba", team: "LAL", opponent: "BOS" });
      assert.equal(byAbbr.rowCount, 2);
      const byId = await run({ dataset: "games", league: "nba", team: "13", from: "2026-01-16", to: "2026-01-16" });
      assert.deepEqual(byId.rows.map((record) => record.game_id), [402]);
      const none = await run({ dataset: "games", league: "nba", team: "LAL", opponent: "NYK" });
      assert.equal(none.rowCount, 0);
      const projected = await run({
        dataset: "games",
        league: "nba",
        columns: ["game_id", "home_team_abbr"],
        limit: 1,
      });
      assert.equal(projected.rowCount, 1);
      assert.deepEqual(Object.keys(projected.rows[0] ?? {}), ["game_id", "home_team_abbr"]);

      const bothSeasons = await run({ dataset: "games", league: "nba", seasons: [2025, 2026] });
      assert.equal(bothSeasons.rowCount, 3);
      assert.equal(bothSeasons.updated_at, "2026-01-01T00:00:00Z");

      const logs = await run({ dataset: "player_game_logs", league: "nba", player: "lebron" });
      assert.equal(logs.rowCount, 1);
      assert.equal(logs.rows[0]?.player_id, 1966);
      const byPlayerId = await run({ dataset: "player_game_logs", league: "nba", player: "1966" });
      assert.equal(byPlayerId.rowCount, 1);
      const injected = await run({ dataset: "player_game_logs", league: "nba", player: "James' OR '1'='1" });
      assert.equal(injected.rowCount, 0);
      await assert.rejects(() => run({ dataset: "games", league: "nba", sort: "game_date; drop table t" }), /unknown sort column/);
      await assert.rejects(() => run({ dataset: "games", league: "nba", columns: ["season; drop table t"] }), /unknown column/);
      await assert.rejects(() => run({ dataset: "games", league: "nba", player: "LeBron" }), /no player column/);
      await assert.rejects(() => run({ dataset: "depth_charts", league: "nba" }), /not published for nba/);
      await assert.rejects(() => run({ dataset: "games", league: "nba", seasons: [1999] }), /Available seasons/);
      await assert.rejects(() => run({ dataset: "games", league: "nba", limit: 251 }), /limit/);

      const roster = await run({ dataset: "rosters", league: "nba", from: "2026-02-01", to: "2026-02-01" });
      assert.equal(roster.rowCount, 1);
      assert.equal(roster.rows[0]?.player_name, "LeBron James");
      const ended = await run({ dataset: "rosters", league: "nba", from: "2025-01-01", to: "2025-01-01" });
      assert.equal(ended.rowCount, 0);

      const box = await run({ dataset: "team_box_scores", league: "mlb", team: "LAL" });
      assert.equal(typeof box.rows[0]?.hits, "number");
      const nbaBox = await run({ dataset: "team_box_scores", league: "nba" });
      assert.equal(typeof nbaBox.rows[0]?.fg_pct, "number");
      const stats = await run({ dataset: "team_game_stats", league: "mlb", columns: ["left_on_base", "opponent_left_on_base"] });
      assert.deepEqual(Object.keys(stats.rows[0] ?? {}), ["left_on_base", "opponent_left_on_base"]);

      for (const info of DATASET_INFO) {
        const league = stored.find((file) => file.entry.dataset === info.dataset)?.entry.league;
        assert.ok(league, `fixture for ${info.dataset}`);
        const result = await run({ dataset: info.dataset, league, limit: 5 });
        assert.equal(result.dataset, info.dataset, info.dataset);
        assert.ok(result.rowCount >= 1, info.dataset);
        assert.ok(result.updated_at, info.dataset);
        const expected = columnsFor(info.dataset, league).map((column) => column.name);
        assert.deepEqual(result.columns, expected, info.dataset);
      }
      assert.equal((await run({ dataset: "passing_game_logs", league: "nfl" })).rows[0]?.passer_rating !== undefined, true);
      assert.equal(typeof (await run({ dataset: "goalie_game_logs", league: "nhl" })).rows[0]?.save_pct, "number");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("cache follows redirects, sends no API key, and trusts the manifest checksum", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bayes-cache-"));
    try {
      const columns = columnsFor("games", "nba");
      const body = await writeParquet(path.join(dir, "seed.parquet"), columns, [
        row(columns, "nba", { game_id: 7, game_date: "2026-02-01" }),
      ]);
      const current = fileEntry("games", "nba", 2027, columns, body, 1, "2026-10-31T12:00:00Z");
      const pastBody = await writeParquet(path.join(dir, "past.parquet"), columns, [
        row(columns, "nba", { game_id: 8, game_date: "2025-04-01", season: 2025 }),
      ]);
      const past = fileEntry("games", "nba", 2025, columns, pastBody, 1, "2025-07-01T00:00:00Z");
      const state = freshState([current, past]);
      state.redirect = true;
      state.etag = null;
      let now = Date.parse("2026-10-31T18:00:00Z");
      const cfg = config(dir, { revalidateMs: 1_000 });
      const clock = deps(state, () => now);

      const first = await queryDataset(cfg, { dataset: "games", league: "nba", seasons: [2027] }, clock);
      assert.equal(first.rows[0]?.game_id, 7);
      await queryDataset(cfg, { dataset: "games", league: "nba", seasons: [2025] }, clock);
      const origin = state.calls.filter((call) => new URL(call.url).hostname === "files.example");
      const cdn = state.calls.filter((call) => new URL(call.url).hostname === "cdn.example");
      assert.ok(origin.length >= 1);
      assert.ok(cdn.length >= 1);
      assert.ok(state.calls.every((call) => call.key === null));

      const beforeQuiet = state.calls.length;
      now += 100;
      await queryDataset(cfg, { dataset: "games", league: "nba", seasons: [2027] }, clock);
      assert.equal(state.calls.length, beforeQuiet, "within the window the cache does not call the host");

      now += 5_000;
      await queryDataset(cfg, { dataset: "games", league: "nba", seasons: [2025] }, clock);
      const afterWindow = state.calls.slice(beforeQuiet);
      const pastFetches = afterWindow.filter((call) => call.url.includes("/2025.parquet"));
      assert.equal(pastFetches.length, 0, "a past season whose checksum still matches is not re-downloaded");
      assert.ok(afterWindow.some((call) => call.url.includes("manifest.json")));
      assert.ok(afterWindow.every((call) => call.ifNoneMatch === null));

      const replacement = await writeParquet(path.join(dir, "next.parquet"), columns, [
        row(columns, "nba", { game_id: 9, game_date: "2026-03-01" }),
      ]);
      current.body = replacement;
      current.sha256 = sha256(replacement);
      current.entry.sha256 = current.sha256;
      current.entry.bytes = replacement.length;
      current.entry.updated_at = "2026-10-31T17:00:00Z";
      state.files.set(current.entry.path, replacement);
      state.manifest = manifestBody([current, past]);
      now += 5_000;
      const updated = await queryDataset(cfg, { dataset: "games", league: "nba", seasons: [2027] }, clock);
      assert.equal(updated.rows[0]?.game_id, 9);
      assert.equal(updated.updated_at, "2026-10-31T17:00:00Z");

      state.unauthorized = true;
      state.calls.length = 0;
      now += 5_000;
      await assert.rejects(
        () => queryDataset(cfg, { dataset: "games", league: "nba", seasons: [2027] }, clock),
        /401/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest etag 304 is used when the host sends one, and redirects give up", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bayes-etag-"));
    try {
      const columns = columnsFor("games", "nba");
      const body = await writeParquet(path.join(dir, "seed.parquet"), columns, [row(columns, "nba", { game_id: 1 })]);
      const file = fileEntry("games", "nba", 2026, columns, body, 1, "2026-10-31T12:00:00Z");
      const state = freshState([file]);
      state.etag = "\"manifest-etag\"";
      let now = Date.parse("2026-10-31T18:00:00Z");
      const cfg = config(dir, { revalidateMs: 1_000 });
      await dataStatus(cfg, deps(state, () => now));
      now += 5_000;
      state.calls.length = 0;
      const status = await dataStatus(cfg, deps(state, () => now));
      assert.equal(status.generated_at, "2026-10-31T12:00:00Z");
      assert.equal(status.manifestUrl, "https://files.example/export/manifest.json");
      assert.equal(status.baseUrl, "https://files.example/export");
      assert.ok(state.calls.some((call) => call.ifNoneMatch === "\"manifest-etag\""));
      assert.ok(state.calls.every((call) => call.key === null));
      assert.equal(status.files.length, 1);

      const loop = freshState([file]);
      loop.alwaysRedirect = true;
      const loopDir = `${dir}-loop`;
      await assert.rejects(
        () => dataStatus(config(loopDir, { revalidateMs: 0 }), deps(loop, () => now)),
        /exceeded 5 redirects/,
      );
      await rm(loopDir, { recursive: true, force: true });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest file urls are fetched through the release redirect, not a built path", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bayes-url-"));
    try {
      const columns = columnsFor("games", "nba");
      const body = await writeParquet(path.join(dir, "seed.parquet"), columns, [row(columns, "nba", { game_id: 11 })]);
      const file = fileEntry("games", "nba", 2027, columns, body, 1, "2026-10-31T12:00:00Z");
      file.entry.url = "https://releases.example/nba_games/2027.parquet";
      const state = freshState([file]);
      const cfg = config(dir, { baseUrl: null });
      const now = Date.parse("2026-10-31T18:00:00Z");
      const result = await queryDataset(cfg, { dataset: "games", league: "nba", seasons: [2027], limit: 1 }, deps(state, () => now));
      assert.equal(result.rows[0]?.game_id, 11);
      assert.ok(state.calls.some((call) => call.url.startsWith("https://releases.example/nba_games/2027.parquet")));
      assert.ok(state.calls.some((call) => call.url.startsWith("https://cdn.example/nba_games/2027.parquet")));
      assert.equal(state.calls.some((call) => call.url.includes("/nba/games/2027.parquet")), false);
      const release = state.calls.find((call) => call.url.startsWith("https://releases.example/"));
      assert.equal(release?.ifNoneMatch, null);
      const before = state.calls.length;
      await queryDataset(cfg, { dataset: "games", league: "nba", seasons: [2027], limit: 1 }, deps(state, () => now));
      assert.equal(state.calls.length, before, "sha256 match skips the release download");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("get_data_status flags current-season files older than 36 hours", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bayes-status-"));
    try {
      const column = [{ name: "league", type: "str" as const }];
      const entry = (league: string, season: number, updatedAt: string): StoredFile => ({
        body: Buffer.alloc(0),
        sha256: "ab".repeat(32),
        entry: {
          path: `${league}/games/${season}.parquet`,
          league,
          dataset: "games",
          season,
          rows: 1,
          columns: column,
          bytes: 1,
          sha256: "ab".repeat(32),
          updated_at: updatedAt,
        },
      });
      const files = [
        entry("nba", 2027, "2026-10-29T00:00:00Z"),
        entry("nba", 2024, "2020-01-01T00:00:00Z"),
        entry("nhl", 2027, "2026-10-31T16:00:00Z"),
      ];
      const state = freshState(files);
      const now = Date.parse("2026-10-31T18:00:00Z");
      const status = await dataStatus(config(dir), deps(state, () => now));
      assert.deepEqual(
        status.stale.map((file) => file.path),
        ["nba/games/2027.parquet"],
      );
      assert.equal(status.files.find((file) => file.path === "nba/games/2024.parquet")?.stale, false);
      assert.equal(status.files.find((file) => file.path === "nhl/games/2027.parquet")?.stale, false);
      assert.equal(status.staleAfterHours, 36);
      assert.ok(state.calls.every((call) => !call.url.endsWith(".parquet")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a checksum mismatch is not cached, then a matching download is", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bayes-sum-"));
    try {
      const columns = columnsFor("games", "nba");
      const good = await writeParquet(path.join(dir, "good.parquet"), columns, [row(columns, "nba", { game_id: 3 })]);
      const file = fileEntry("games", "nba", 2026, columns, good, 1, "2026-10-31T12:00:00Z");
      const state = freshState([file]);
      state.parquetBodies = [Buffer.from("not parquet"), good];
      const result = await queryDataset(config(dir), { dataset: "games", league: "nba" }, deps(state, () => Date.parse("2026-10-31T18:00:00Z")));
      assert.equal(result.rows[0]?.game_id, 3);
      assert.equal(state.parquetServes, 2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function freshState(files: StoredFile[]): MockState {
  return {
    calls: [],
    files: new Map(files.map((file) => [file.entry.path, file.body])),
    manifest: manifestBody(files),
    etag: null,
    redirect: false,
    unauthorized: false,
    parquetBodies: null,
    parquetServes: 0,
    alwaysRedirect: false,
  };
}

async function buildFixtures(dir: string): Promise<StoredFile[]> {
  const stored: StoredFile[] = [];
  const updated = "2026-10-30T12:00:00Z";
  const add = async (
    dataset: string,
    league: string,
    season: number,
    rows: Record<string, unknown>[],
    updatedAt = updated,
  ) => {
    const columns = columnsFor(dataset, league);
    const body = await writeParquet(path.join(dir, `${league}-${dataset}-${season}.parquet`), columns, rows);
    stored.push(fileEntry(dataset, league, season, columns, body, rows.length, updatedAt));
  };

  const games = columnsFor("games", "nba");
  await add("games", "nba", 2026, [
    row(games, "nba", {
      game_id: 401, game_date: "2026-01-15", home_team_id: 13, home_team_abbr: "LAL",
      away_team_id: 2, away_team_abbr: "BOS", home_score: 110, away_score: 104,
    }, 0),
    row(games, "nba", {
      game_id: 402, game_date: "2026-01-16", home_team_id: 2, home_team_abbr: "BOS",
      away_team_id: 13, away_team_abbr: "LAL", home_score: 99, away_score: 101,
    }, 1),
  ]);
  await add("games", "nba", 2025, [row(games, "nba", { season: 2025, game_id: 500, game_date: "2025-12-01" })], "2026-01-01T00:00:00Z");
  await add("games", "mlb", 2026, [row(games, "mlb", { game_id: 700, home_team_abbr: "NYY", home_team_id: 10 })]);

  for (const league of ["mlb", "nba", "nfl", "nhl"] as const) {
    await add("team_box_scores", league, 2026, [row(columnsFor("team_box_scores", league), league)]);
    await add("team_game_stats", league, 2026, [row(columnsFor("team_game_stats", league), league)]);
  }

  const single: Array<[string, string]> = [
    ["player_game_logs", "nba"],
    ["skater_game_logs", "nhl"],
    ["goalie_game_logs", "nhl"],
    ["batting_game_logs", "mlb"],
    ["pitching_game_logs", "mlb"],
    ["passing_game_logs", "nfl"],
    ["rushing_game_logs", "nfl"],
    ["receiving_game_logs", "nfl"],
    ["injuries", "nfl"],
    ["transactions", "mlb"],
    ["depth_charts", "nfl"],
    ["probables", "mlb"],
    ["lineups", "nba"],
    ["weather", "mlb"],
    ["team_ratings", "nba"],
  ];
  for (const [dataset, league] of single) {
    await add(dataset, league, 2026, [row(columnsFor(dataset, league), league)]);
  }

  const rosters = columnsFor("rosters", "nba");
  await add("rosters", "nba", 2026, [
    row(rosters, "nba", { player_id: 1966, player_name: "LeBron James", valid_from: "2026-01-15T00:00:00Z", valid_to: null }),
    row(rosters, "nba", {
      player_id: 1, player_name: "Old Player", valid_from: "2025-10-01T00:00:00Z", valid_to: "2026-01-10T00:00:00Z",
    }, 1),
  ]);
  return stored;
}
