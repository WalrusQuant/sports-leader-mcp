import { z } from "zod";

import { requireDataConfig } from "./config.js";
import { dataStatus } from "./cache.js";
import { DATASET_NAMES, PLAYER_LOG_GROUPS } from "./datasets.js";
import { DataExportError } from "./errors.js";
import { defaultDeps } from "./http.js";
import { queryDataset, type DataQuery } from "./query.js";
import { defineTool } from "../tool.js";

const leagueField = z
  .enum(["mlb", "nba", "nfl", "nhl"])
  .describe("League slug: mlb, nba, nfl, or nhl. Every row carries ESPN team and player ids.");

const seasonField = z
  .number()
  .int()
  .min(1990)
  .max(2100)
  .optional()
  .describe("Season year. NBA and NHL use the year the season ends (2026-27 is 2027). Omit for the current season in the export. Seasons start at 2021.");

const seasonsField = z
  .array(z.number().int().min(1990).max(2100))
  .max(20)
  .optional()
  .describe("Extra seasons to read with season. Past seasons stay cached; the current season is revalidated every few hours.");

const fromField = z
  .string()
  .optional()
  .describe("Inclusive start date, YYYY-MM-DD. Filters game_date or date. Rosters and depth charts use the valid_from/valid_to window instead.");

const toField = z
  .string()
  .optional()
  .describe("Inclusive end date, YYYY-MM-DD.");

const teamField = z
  .string()
  .min(1)
  .max(80)
  .optional()
  .describe("ESPN team id or abbreviation (for example 13 or LAL). Games and weather match either side.");

const opponentField = z
  .string()
  .min(1)
  .max(80)
  .optional()
  .describe("ESPN opponent id or abbreviation. On games and weather, combined with team this is the other side of the matchup.");

const playerField = z
  .string()
  .min(1)
  .max(80)
  .optional()
  .describe("ESPN athlete id, or a case-insensitive substring of player_name.");

const columnsField = z
  .array(z.string().min(1).max(64))
  .max(200)
  .optional()
  .describe("Columns to return. Names are checked against the manifest. Omit for every column.");

const sortField = z
  .string()
  .min(1)
  .max(64)
  .optional()
  .describe("Column to sort by. Defaults to the date column when the file has one.");

const orderField = z
  .enum(["asc", "desc"])
  .optional()
  .describe("Sort direction. Defaults to desc.");

const limitField = z
  .number()
  .int()
  .min(1)
  .max(250)
  .optional()
  .describe("Maximum rows. Default 100, hard cap 250, so the result stays inside the token budget.");

const range = { from: fromField, to: toField };
const projection = { columns: columnsField, sort: sortField, order: orderField, limit: limitField };
const seasoning = { season: seasonField, seasons: seasonsField };

const EXPORT_HINT =
  "Reads the historical Parquet export (see get_data_status). Works with no API key when DEFAULT_BAYES_DATA_BASE_URL or BAYES_DATA_BASE_URL is set; otherwise returns \"data export not configured\". Includes each file's updated_at. ESPN ids are on every row.";

interface FilterArgs {
  league: string;
  season?: number;
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

function mergeSeasons(season: number | undefined, seasons: number[] | undefined): number[] | undefined {
  const list = [...(seasons ?? [])];
  if (season !== undefined) list.unshift(season);
  return list.length ? [...new Set(list)] : undefined;
}

function toQuery(dataset: string, args: FilterArgs): DataQuery {
  return {
    dataset,
    league: args.league,
    seasons: mergeSeasons(args.season, args.seasons),
    from: args.from,
    to: args.to,
    team: args.team,
    opponent: args.opponent,
    player: args.player,
    columns: args.columns,
    sort: args.sort,
    order: args.order,
    limit: args.limit,
  };
}

async function run(dataset: string, args: FilterArgs) {
  return queryDataset(requireDataConfig(), toQuery(dataset, args), defaultDeps());
}

function datasetForPlayerLog(league: string, statGroup: string | undefined): string {
  const groups = PLAYER_LOG_GROUPS[league];
  if (!groups) {
    throw new DataExportError(`player game logs are published for nba, nhl, mlb, and nfl, not ${league}`);
  }
  const names = Object.keys(groups);
  if (!statGroup) {
    if (names.length === 1) return groups[names[0]]!;
    throw new DataExportError(`statGroup is required for ${league} player logs. Use one of: ${names.join(", ")}`);
  }
  const dataset = groups[statGroup];
  if (!dataset) {
    throw new DataExportError(`statGroup "${statGroup}" is not valid for ${league}. Use one of: ${names.join(", ")}`);
  }
  return dataset;
}

const statGroupField = z
  .enum(["player", "skater", "goalie", "batting", "pitching", "passing", "rushing", "receiving"])
  .optional()
  .describe(
    "Which box the league keeps. nba: player (optional). nhl: skater or goalie. mlb: batting or pitching. nfl: passing, rushing, or receiving.",
  );

export const getGames = defineTool({
  name: "get_games",
  title: "Get games",
  description: `Schedule and results, one row per game (upcoming games have no score). ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, opponent: opponentField, ...projection },
  handler: (args) => run("games", args),
});

export const getTeamBoxScores = defineTool({
  name: "get_team_box_scores",
  title: "Get team box scores",
  description: `ESPN team box line, one row per team per game. League-specific columns (hits, fg_pct, total_yards, shots, and so on) come from that league's file. ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, opponent: opponentField, ...projection },
  handler: (args) => run("team_box_scores", args),
});

export const getTeamGameStats = defineTool({
  name: "get_team_game_stats",
  title: "Get team game stats",
  description: `Full team counting stats for and against, one row per team per game, including opponent_ copies of each stat. Wide rows: pass columns or a low limit. ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, opponent: opponentField, ...projection },
  handler: (args) => run("team_game_stats", args),
});

export const getPlayerGameLogs = defineTool({
  name: "get_player_game_logs",
  title: "Get player game logs",
  description:
    "Player box lines. nba reads player_game_logs (statGroup player, or omit it). nhl: skater or goalie. mlb: batting or pitching. nfl: passing, rushing, or receiving. " +
    EXPORT_HINT,
  inputShape: {
    league: leagueField,
    statGroup: statGroupField,
    ...seasoning,
    ...range,
    team: teamField,
    opponent: opponentField,
    player: playerField,
    ...projection,
  },
  handler: async (args) => run(datasetForPlayerLog(args.league, args.statGroup), args),
});

export const getRosters = defineTool({
  name: "get_rosters",
  title: "Get rosters",
  description: `Roster rows with valid_from / valid_to (empty valid_to means still current). A date range keeps rows whose span overlaps it. ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, player: playerField, ...projection },
  handler: (args) => run("rosters", args),
});

export const getInjuryReports = defineTool({
  name: "get_injury_reports",
  title: "Get injury reports",
  description:
    "Historical injury rows from the Parquet export (ESPN, the NBA report, and the NFL practice report), with valid_from / valid_to. This is not the live get_injuries tool. " +
    EXPORT_HINT,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, player: playerField, ...projection },
  handler: (args) => run("injuries", args),
});

export const getTransactionLog = defineTool({
  name: "get_transaction_log",
  title: "Get transaction log",
  description:
    "Historical transactions from the Parquet export (ESPN, plus MLB official). This is not the live get_transactions tool. " +
    EXPORT_HINT,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, player: playerField, ...projection },
  handler: (args) => run("transactions", args),
});

export const getDepthCharts = defineTool({
  name: "get_depth_charts",
  title: "Get depth charts",
  description: `NFL depth-chart slots with the span each was current. A date range overlaps valid_from / valid_to. ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, player: playerField, ...projection },
  handler: (args) => run("depth_charts", args),
});

export const getProbables = defineTool({
  name: "get_probables",
  title: "Get probables",
  description: `Probable starting pitchers (MLB) and goalies (NHL). ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, player: playerField, ...projection },
  handler: (args) => run("probables", args),
});

export const getLineups = defineTool({
  name: "get_lineups",
  title: "Get lineups",
  description: `Announced lineups: MLB batting orders, NBA starting fives, NHL lines. ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, player: playerField, ...projection },
  handler: (args) => run("lineups", args),
});

export const getWeather = defineTool({
  name: "get_weather",
  title: "Get weather",
  description: `Game weather for MLB and NFL (ESPN conditions and the NWS hourly outlook). team matches either side. ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, opponent: opponentField, ...projection },
  handler: (args) => run("weather", args),
});

export const getPublishedRatings = defineTool({
  name: "get_published_ratings",
  title: "Get published ratings",
  description: `Published team rating and its range, by day, as shown on the site (rating, rating_low, rating_high, rank). Not forecasts or model internals. ${EXPORT_HINT}`,
  inputShape: { league: leagueField, ...seasoning, ...range, team: teamField, ...projection },
  handler: (args) => run("team_ratings", args),
});

export const getDataStatus = defineTool({
  name: "get_data_status",
  title: "Get data export status",
  description:
    "Manifest summary for the historical Parquet export: datasets, files, row counts, and updated_at. " +
    "Flags any current-season file older than 36 hours (the nightly rebuild is about 7:15 AM CT; only that season is rewritten). " +
    "The base URL is DEFAULT_BAYES_DATA_BASE_URL (fill that constant in with the public static host) or the BAYES_DATA_BASE_URL override. " +
    "It must be the directory of manifest.json and <league>/<dataset>/<season>.parquet. " +
    "X-API-Key is sent only when BAYES_DATA_API_KEY is set. " +
    "If no base URL is configured, the data tools return \"data export not configured\" and the ESPN tools keep working. " +
    "Optional BAYES_DATA_CACHE_DIR and BAYES_DATA_REVALIDATE_MS (default 4 hours). " +
    "Redirects such as a GitHub release 302 are followed. Cache checks use the manifest sha256 and updated_at when the host sends no ETag.",
  inputShape: {
    includeColumns: z
      .boolean()
      .optional()
      .describe("Include each file's column names and types. Default false, to keep the summary small."),
  },
  handler: async ({ includeColumns }) => dataStatus(requireDataConfig(), defaultDeps(), includeColumns === true),
});

export const dataTools = [
  getGames,
  getTeamBoxScores,
  getTeamGameStats,
  getPlayerGameLogs,
  getRosters,
  getInjuryReports,
  getTransactionLog,
  getDepthCharts,
  getProbables,
  getLineups,
  getWeather,
  getPublishedRatings,
  getDataStatus,
];

export const DATA_TOOL_NAMES: readonly string[] = dataTools.map((tool) => tool.name);

const DATASET_TOOL: Record<string, { tool: string; statGroup?: string }> = {
  games: { tool: "get_games" },
  team_box_scores: { tool: "get_team_box_scores" },
  team_game_stats: { tool: "get_team_game_stats" },
  player_game_logs: { tool: "get_player_game_logs", statGroup: "player" },
  skater_game_logs: { tool: "get_player_game_logs", statGroup: "skater" },
  goalie_game_logs: { tool: "get_player_game_logs", statGroup: "goalie" },
  batting_game_logs: { tool: "get_player_game_logs", statGroup: "batting" },
  pitching_game_logs: { tool: "get_player_game_logs", statGroup: "pitching" },
  passing_game_logs: { tool: "get_player_game_logs", statGroup: "passing" },
  rushing_game_logs: { tool: "get_player_game_logs", statGroup: "rushing" },
  receiving_game_logs: { tool: "get_player_game_logs", statGroup: "receiving" },
  rosters: { tool: "get_rosters" },
  injuries: { tool: "get_injury_reports" },
  transactions: { tool: "get_transaction_log" },
  depth_charts: { tool: "get_depth_charts" },
  probables: { tool: "get_probables" },
  lineups: { tool: "get_lineups" },
  weather: { tool: "get_weather" },
  team_ratings: { tool: "get_published_ratings" },
};

/** One live-audit call per manifest dataset. */
export function auditCallForFile(file: { dataset: string; league: string; season: number }): { tool: string; args: Record<string, unknown> } {
  const mapped = DATASET_TOOL[file.dataset];
  if (!mapped) throw new Error(`no data tool for dataset ${file.dataset}`);
  return {
    tool: mapped.tool,
    args: {
      league: file.league,
      season: file.season,
      limit: 5,
      ...(mapped.statGroup ? { statGroup: mapped.statGroup } : {}),
    },
  };
}

export { DATASET_NAMES };
