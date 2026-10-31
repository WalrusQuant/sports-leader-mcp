import type { DataConfig } from "./config.js";
import { ensureParquetRetry } from "./cache.js";
import { DataExportError } from "./errors.js";
import { defaultDeps, type DataDeps } from "./http.js";
import { loadManifest } from "./cache.js";
import type { Manifest, ManifestFile } from "./manifest.js";

/**
 * Parquet is queried with @duckdb/node-api (DuckDB Neo). The package ships
 * prebuilt binaries for glibc and musl on x64 and arm64, so `npm ci` works on
 * a plain Linux box and on Alpine without a compiler. Filter values are bound
 * parameters. Column names are checked against the manifest and a strict
 * identifier pattern before they are quoted into SQL.
 */

export const DEFAULT_ROW_LIMIT = 100;
export const MAX_ROW_LIMIT = 250;

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[0-9]+$/;

/** DuckDBTypeId values, inlined so the native module stays lazy. */
const TYPE_DATE = 13;

export interface DataQuery {
  dataset: string;
  league: string;
  seasons?: number[];
  from?: string;
  to?: string;
  team?: string;
  opponent?: string;
  player?: string;
  columns?: string[];
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
}

export interface DataResult {
  dataset: string;
  league: string;
  seasons: number[];
  updated_at: string;
  files: { path: string; season: number; updated_at: string; rows: number }[];
  rowCount: number;
  limit: number;
  columns: string[];
  rows: Record<string, unknown>[];
}

type SqlValue = string | number | bigint | boolean | null;

interface Conn {
  runAndReadAll(
    sql: string,
    values?: SqlValue[],
  ): Promise<{
    columnCount: number;
    columnTypeId(index: number): number;
    getRowObjectsJS(): Record<string, unknown>[];
  }>;
}

let connectionPromise: Promise<Conn> | null = null;
let queue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function connection(): Promise<Conn> {
  if (!connectionPromise) {
    connectionPromise = import("@duckdb/node-api")
      .then(async (duckdb) => {
        const instance = await duckdb.DuckDBInstance.create(":memory:");
        return instance.connect();
      })
      .catch((err: unknown) => {
        connectionPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        throw new DataExportError(`Parquet reader failed to load (@duckdb/node-api): ${message}`);
      });
  }
  return connectionPromise;
}

function quoteIdent(name: string): string {
  if (!IDENT.test(name)) throw new DataExportError(`invalid column name ${name}`);
  return `"${name}"`;
}

function assertDate(value: string, label: string): string {
  if (!DATE_RE.test(value)) throw new DataExportError(`${label} must be YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new DataExportError(`${label} is not a real date`);
  }
  return value;
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function unionColumns(files: ManifestFile[]): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const file of files) {
    for (const column of file.columns) {
      if (seen.has(column.name)) continue;
      seen.add(column.name);
      names.push(column.name);
    }
  }
  return names;
}

function resolveFiles(manifest: Manifest, query: DataQuery): ManifestFile[] {
  if (!/^(mlb|nba|nfl|nhl)$/.test(query.league)) {
    throw new DataExportError("league must be mlb, nba, nfl, or nhl");
  }
  const matching = manifest.files.filter((file) => file.dataset === query.dataset && file.league === query.league);
  if (matching.length === 0) {
    const leagues = [...new Set(manifest.files.filter((file) => file.dataset === query.dataset).map((file) => file.league))].sort();
    throw new DataExportError(
      leagues.length
        ? `${query.dataset} is not published for ${query.league}. Leagues in the manifest: ${leagues.join(", ")}`
        : `${query.dataset} is not in the manifest`,
    );
  }
  const requested = query.seasons?.length
    ? query.seasons
    : [Math.max(...matching.map((file) => file.season))];
  if (requested.length > 20) throw new DataExportError("at most 20 seasons can be queried at once");
  return requested.map((season) => {
    if (!Number.isInteger(season)) throw new DataExportError(`season must be an integer (${season})`);
    const file = matching.find((item) => item.season === season);
    if (!file) {
      const have = [...new Set(matching.map((item) => item.season))].sort((a, b) => a - b).join(", ");
      throw new DataExportError(`${query.dataset} has no ${query.league} file for season ${season}. Available seasons: ${have}`);
    }
    return file;
  });
}

function sideMatch(available: Set<string>, idCol: string, abbrCol: string, value: string, params: SqlValue[]): string | null {
  const parts: string[] = [];
  if (ID_RE.test(value) && available.has(idCol)) {
    params.push(BigInt(value));
    parts.push(`${quoteIdent(idCol)} = ?`);
  }
  if (available.has(abbrCol)) {
    params.push(value);
    parts.push(`upper(${quoteIdent(abbrCol)}) = upper(?)`);
  }
  return parts.length ? `(${parts.join(" OR ")})` : null;
}

function addTeamFilters(dataset: string, available: string[], query: DataQuery, params: SqlValue[]): string[] {
  const names = new Set(available);
  const where: string[] = [];
  const gameLevel = names.has("home_team_id") || names.has("home_team_abbr");
  const rowLevel = names.has("team_id") || names.has("team_abbr");

  const matchup = Boolean(query.team && query.opponent && gameLevel && !rowLevel);

  if (query.team && !matchup) {
    if (rowLevel) {
      const match = sideMatch(names, "team_id", "team_abbr", query.team, params);
      if (!match) throw new DataExportError(`${dataset} has no team column`);
      where.push(match);
    } else if (gameLevel) {
      const home = sideMatch(names, "home_team_id", "home_team_abbr", query.team, params);
      const away = sideMatch(names, "away_team_id", "away_team_abbr", query.team, params);
      if (!home || !away) throw new DataExportError(`${dataset} has no team column`);
      where.push(`(${home} OR ${away})`);
    } else {
      throw new DataExportError(`${dataset} has no team column`);
    }
  }

  if (query.opponent && !matchup) {
    if (names.has("opponent_id") || names.has("opponent_abbr")) {
      const match = sideMatch(names, "opponent_id", "opponent_abbr", query.opponent, params);
      if (!match) throw new DataExportError(`${dataset} has no opponent column`);
      where.push(match);
    } else if (gameLevel) {
      const home = sideMatch(names, "home_team_id", "home_team_abbr", query.opponent, params);
      const away = sideMatch(names, "away_team_id", "away_team_abbr", query.opponent, params);
      if (!home || !away) throw new DataExportError(`${dataset} has no opponent column`);
      where.push(`(${home} OR ${away})`);
    } else {
      throw new DataExportError(`${dataset} has no opponent column`);
    }
  }

  if (matchup && query.team && query.opponent) {
    const homeTeam = sideMatch(names, "home_team_id", "home_team_abbr", query.team, params);
    const awayOpp = sideMatch(names, "away_team_id", "away_team_abbr", query.opponent, params);
    const awayTeam = sideMatch(names, "away_team_id", "away_team_abbr", query.team, params);
    const homeOpp = sideMatch(names, "home_team_id", "home_team_abbr", query.opponent, params);
    if (!homeTeam || !awayOpp || !awayTeam || !homeOpp) {
      throw new DataExportError(`${dataset} has no team column`);
    }
    where.push(`((${homeTeam} AND ${awayOpp}) OR (${awayTeam} AND ${homeOpp}))`);
  }

  return where;
}

function addPlayerFilter(dataset: string, available: Set<string>, player: string, params: SqlValue[]): string {
  if (ID_RE.test(player)) {
    if (!available.has("player_id")) throw new DataExportError(`${dataset} has no player column`);
    params.push(BigInt(player));
    return `${quoteIdent("player_id")} = ?`;
  }
  if (!available.has("player_name")) throw new DataExportError(`${dataset} has no player column`);
  params.push(`%${escapeLike(player)}%`);
  return `${quoteIdent("player_name")} ILIKE ? ESCAPE '\\'`;
}

function addDateFilters(dataset: string, available: Set<string>, query: DataQuery, params: SqlValue[]): string[] {
  if (!query.from && !query.to) return [];
  const from = query.from ? assertDate(query.from, "from") : undefined;
  const to = query.to ? assertDate(query.to, "to") : undefined;
  const dateCol = available.has("game_date") ? "game_date" : available.has("date") ? "date" : null;
  if (dateCol) {
    const where: string[] = [];
    if (from) {
      params.push(from);
      where.push(`${quoteIdent(dateCol)} >= CAST(? AS DATE)`);
    }
    if (to) {
      params.push(to);
      where.push(`${quoteIdent(dateCol)} <= CAST(? AS DATE)`);
    }
    return where;
  }
  if (!available.has("valid_from")) {
    throw new DataExportError(`${dataset} has no date column`);
  }
  const where: string[] = [];
  if (to) {
    params.push(to);
    where.push(`${quoteIdent("valid_from")} < CAST(? AS TIMESTAMPTZ) + INTERVAL 1 DAY`);
  }
  if (from) {
    params.push(from);
    where.push(`(${quoteIdent("valid_to")} IS NULL OR ${quoteIdent("valid_to")} >= CAST(? AS TIMESTAMPTZ))`);
  }
  return where;
}

function normalizeValue(value: unknown, typeId: number): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    return value <= max && value >= min ? Number(value) : value.toString();
  }
  if (value instanceof Date) {
    if (typeId === TYPE_DATE) return value.toISOString().slice(0, 10);
    return value.toISOString();
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function oldestUpdatedAt(files: ManifestFile[]): string {
  return files.reduce((oldest, file) =>
    Date.parse(file.updated_at) < Date.parse(oldest.updated_at) ? file : oldest,
  ).updated_at;
}

export async function queryDataset(config: DataConfig, query: DataQuery, deps: DataDeps = defaultDeps()): Promise<DataResult> {
  const limit = query.limit ?? DEFAULT_ROW_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROW_LIMIT) {
    throw new DataExportError(`limit must be an integer from 1 to ${MAX_ROW_LIMIT}`);
  }
  const manifest = await loadManifest(config, deps);
  const selectedFiles = resolveFiles(manifest, query);

  const available = unionColumns(selectedFiles);
  const availableSet = new Set(available);
  let selected = available;
  if (query.columns) {
    if (query.columns.length === 0) throw new DataExportError("columns must list at least one column");
    const unknown = query.columns.filter((name) => !availableSet.has(name));
    if (unknown.length) {
      throw new DataExportError(`unknown column ${unknown.join(", ")}. Available columns: ${available.join(", ")}`);
    }
    selected = query.columns;
  }

  const locals: string[] = [];
  const resolved: ManifestFile[] = [];
  for (const file of selectedFiles) {
    const got = await ensureParquetRetry(config, file, deps);
    locals.push(got.path);
    resolved.push(got.file);
  }

  const params: SqlValue[] = [];
  const scans = locals.map((local) => {
    params.push(local);
    return "SELECT * FROM read_parquet(?)";
  });
  const where = [
    ...addDateFilters(query.dataset, availableSet, query, params),
    ...addTeamFilters(query.dataset, available, query, params),
  ];
  if (query.player) where.push(addPlayerFilter(query.dataset, availableSet, query.player, params));

  const direction = query.order === "asc" ? "ASC" : "DESC";
  const sortCol = query.sort ?? (availableSet.has("game_date") ? "game_date" : availableSet.has("date") ? "date" : availableSet.has("valid_from") ? "valid_from" : undefined);
  if (query.sort && !availableSet.has(query.sort)) {
    throw new DataExportError(`unknown sort column ${query.sort}. Available columns: ${available.join(", ")}`);
  }
  let orderSql = "";
  if (sortCol) {
    orderSql = `ORDER BY ${quoteIdent(sortCol)} ${direction} NULLS LAST`;
    if (availableSet.has("game_id") && sortCol !== "game_id") orderSql += `, ${quoteIdent("game_id")} ASC`;
  }
  params.push(limit);

  const sql = `
    SELECT ${selected.map(quoteIdent).join(", ")}
    FROM (${scans.join(" UNION ALL BY NAME ")}) AS src
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ${orderSql}
    LIMIT ?
  `;

  const rows = await enqueue(async () => {
    const conn = await connection();
    const result = await conn.runAndReadAll(sql, params);
    const typeIds = Array.from({ length: result.columnCount }, (_, index) => result.columnTypeId(index));
    return result.getRowObjectsJS().map((row) => {
      const out: Record<string, unknown> = {};
      for (const [index, name] of selected.entries()) {
        out[name] = normalizeValue(row[name], typeIds[index] ?? 0);
      }
      return out;
    });
  });

  return {
    dataset: query.dataset,
    league: query.league,
    seasons: resolved.map((file) => file.season),
    updated_at: oldestUpdatedAt(resolved),
    files: resolved.map((file) => ({
      path: file.path,
      season: file.season,
      updated_at: file.updated_at,
      rows: file.rows,
    })),
    rowCount: rows.length,
    limit,
    columns: selected,
    rows,
  };
}
