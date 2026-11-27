import { z } from "zod";

import { defineTool, type AnyToolDef } from "../tool.js";
import { callLabTool } from "./bridge.js";

const seasons = z
  .array(z.number().int())
  .optional()
  .describe("Published seasons to load. Omit to use every published season.");

const sqlFeatures = z
  .array(z.record(z.string(), z.unknown()))
  .optional()
  .describe("Optional custom SQL features. Each one is an audited SELECT that cannot see postgame columns.");

const split = {
  scheme: z
    .enum(["season", "date"])
    .optional()
    .describe("season (default) holds out a later season. date walks windows of test_days. There is no random split."),
  min_train_seasons: z
    .number()
    .int()
    .optional()
    .describe("Earlier seasons required before a season fold, and before the first date fold. Default 2."),
  min_train_rows: z.number().int().optional().describe("Minimum training rows. Default 50."),
  embargo_days: z
    .number()
    .int()
    .optional()
    .describe("Full days dropped between the training rows and the test window. Default 0."),
  test_days: z.number().int().optional().describe("Length of each date-scheme test window. Default 14."),
};

function forward(name: string) {
  return async (args: Record<string, unknown>) => callLabTool(name, args);
}

const research = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const writes = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const labTools: AnyToolDef[] = [
  defineTool({
    name: "ping",
    title: "Lab ping",
    acceptsRaw: false,
    annotations: research,
    description:
      "Health check for the sports-leader-lab research server.\n\n" +
      "The lab measures fit against simple baselines. It does not provide a betting edge, a pick, or a recommendation to bet.",
    inputShape: {},
    handler: forward("ping"),
  }),
  defineTool({
    name: "inspect_data",
    title: "Inspect lab data",
    acceptsRaw: false,
    annotations: research,
    description:
      "Describe one published dataset before querying or building.\n\n" +
      "league is mlb, nba, nfl, nhl, cfb, or cbb. dataset is one published name such as games or team_game_stats. " +
      "Omit seasons to use every published season. Returns rows, date range, grain, null rates, and whether each column is pregame or postgame. " +
      "This describes the export. It is not a betting edge.",
    inputShape: {
      league: z.string().describe("mlb, nba, nfl, nhl, cfb, or cbb."),
      dataset: z.string().describe("Published dataset name, such as games or team_game_stats."),
      seasons,
    },
    handler: forward("inspect_data"),
  }),
  defineTool({
    name: "query_data",
    title: "Query lab data",
    acceptsRaw: false,
    annotations: research,
    description:
      "Run one SELECT over a published view such as nfl_games or mlb_team_game_stats.\n\n" +
      "Only a single SELECT is accepted. The connection has no external file access. " +
      "max_rows is 1 to 5000 (default 500). The query stops at 20 seconds. Pass seasons to limit which published seasons are loaded. " +
      "This is research access to the export, not a betting edge.",
    inputShape: {
      sql: z.string().describe("One SELECT naming a published view such as nfl_games."),
      max_rows: z.number().int().optional().describe("Row cap from 1 to 5000. Default 500."),
      seasons,
    },
    handler: forward("query_data"),
  }),
  defineTool({
    name: "build_dataset",
    title: "Build lab dataset",
    acceptsRaw: false,
    annotations: writes,
    description:
      "Build one pregame dataset and save it only when the leakage audit passes.\n\n" +
      "target is home_win, margin, total, or team_points (the home team's points). " +
      "seasons must list at least one season. features names registry families: site, elo, team_form, rest, injuries, and probables (MLB). " +
      "Omit features to use every family for that league. sql_features is optional custom SQL that cannot see postgame columns. " +
      "A failed audit does not save. This is research data, not a betting edge.",
    inputShape: {
      league: z.string(),
      target: z.string().describe("home_win, margin, total, or team_points."),
      seasons: z.array(z.number().int()).describe("At least one published season."),
      features: z
        .array(z.string())
        .optional()
        .describe("Registry families: site, elo, team_form, rest, injuries, probables."),
      sql_features: sqlFeatures,
    },
    handler: forward("build_dataset"),
  }),
  defineTool({
    name: "audit_features",
    title: "Audit lab features",
    acceptsRaw: false,
    annotations: research,
    description:
      "Run the dataset leakage checks and do not save.\n\n" +
      "Same arguments as build_dataset. Hard-fails a target, score, or margin copy (including a scaled copy) once 30 overlapping rows are non-null, " +
      "or on every row when the frame is shorter. A column with fewer than two distinct values is not a copy. " +
      "Same-game box stats, timestamps after start, and raw snapshot names also fail. A very high single-feature AUC is a warning. " +
      "ok true means REVIEW REQUIRED, never clean. This is a research check, not a betting edge.",
    inputShape: {
      league: z.string(),
      target: z.string(),
      seasons: z.array(z.number().int()),
      features: z.array(z.string()).optional(),
      sql_features: sqlFeatures,
    },
    handler: forward("audit_features"),
  }),
  defineTool({
    name: "train_classifier",
    title: "Train lab classifier",
    acceptsRaw: false,
    annotations: writes,
    description:
      "Walk-forward home-win model. There is no random split.\n\n" +
      "model is logistic or lightgbm. calibration is none, platt, or isotonic, fit on a tail inside each training fold. " +
      "scheme is season (hold out a later season after min_train_seasons earlier ones) or date (folds of test_days, with embargo_days between train and test, and at least min_train_rows). " +
      "Metrics are log loss, Brier, AUC, and ECE, next to a constant rate, a home-field rate, and as-of Elo. Losing to Elo is flagged. " +
      "This is a research fit, not a betting edge.",
    inputShape: {
      dataset_id: z.string().describe("dataset_id returned by build_dataset."),
      model: z.enum(["logistic", "lightgbm"]).optional().describe("logistic (default) or lightgbm."),
      calibration: z.enum(["none", "platt", "isotonic"]).optional().describe("none (default), platt, or isotonic."),
      ...split,
    },
    handler: forward("train_classifier"),
  }),
  defineTool({
    name: "train_regressor",
    title: "Train lab regressor",
    acceptsRaw: false,
    annotations: writes,
    description:
      "Walk-forward margin, total, or team-points model. There is no random split.\n\n" +
      "model is ridge, poisson, negbin, or lightgbm. Poisson and negative binomial are refused for margin. " +
      "scheme, min_train_seasons, min_train_rows, embargo_days, and test_days match train_classifier. " +
      "Metrics include MAE, RMSE, Poisson deviance for counts, bias by season, and an Elo-implied margin. " +
      "Count targets are not compared to Elo. This is a research fit, not a betting edge.",
    inputShape: {
      dataset_id: z.string(),
      model: z
        .enum(["ridge", "poisson", "negbin", "lightgbm"])
        .optional()
        .describe("ridge (default), poisson, negbin, or lightgbm."),
      ...split,
    },
    handler: forward("train_regressor"),
  }),
  defineTool({
    name: "predict",
    title: "Lab predict",
    acceptsRaw: false,
    annotations: research,
    description:
      "Score games from a saved run as of now in America/Chicago.\n\n" +
      "Pass game_date (YYYY-MM-DD) or game_ids. Each game has home_team_abbr, away_team_abbr, estimate, and estimate_kind. " +
      "For a home_win model, estimate is P(home team wins) and estimate_kind is home_win_probability. " +
      "Read it with the home abbreviation: GB at LAR with estimate 0.688 is P(LAR win) = 0.688, so P(GB win) is about 0.312. " +
      "For margin, total, or team_points, estimate is that target and estimate_kind is the target name. " +
      "The result also includes as_of, as_of_timezone, and start_time_ct. A completed game is a research replay. " +
      "A game with no start time is refused. market_prices, when passed, are current {game_id, home_implied_prob, source} rows for this call only and are not stored. " +
      "The lab does not fetch odds. This is not a betting edge.",
    inputShape: {
      run_id: z.string(),
      game_date: z.string().optional().describe("YYYY-MM-DD. Use this or game_ids."),
      game_ids: z.array(z.string()).optional(),
      market_prices: z
        .array(
          z.object({
            game_id: z.string(),
            home_implied_prob: z.number(),
            source: z.string().optional(),
          }),
        )
        .optional()
        .describe("Caller-supplied prices for this call only. Not stored."),
    },
    handler: forward("predict"),
  }),
  defineTool({
    name: "list_runs",
    title: "List lab runs",
    acceptsRaw: false,
    annotations: research,
    description:
      "List saved runs for one league, newest first.\n\n" +
      "limit is an integer from 1 to 100 (default 20). Order is created_at, then the monotonic sequence, then run_id. " +
      "This is a research index, not a betting edge.",
    inputShape: {
      league: z.string(),
      limit: z.number().int().optional().describe("1 to 100. Default 20."),
    },
    handler: forward("list_runs"),
  }),
  defineTool({
    name: "compare_runs",
    title: "Compare lab runs",
    acceptsRaw: false,
    annotations: research,
    description:
      "Compare at least two saved runs on the primary metric.\n\n" +
      "Pass run_ids. Runs that do not share a league and target come back with a caveat that the numbers are not a comparison. " +
      "This is a research comparison, not a betting edge.",
    inputShape: {
      run_ids: z.array(z.string()).describe("At least two run ids."),
    },
    handler: forward("compare_runs"),
  }),
  defineTool({
    name: "model_card",
    title: "Lab model card",
    acceptsRaw: false,
    annotations: research,
    description:
      "Rebuild the twelve-section model card for one run.\n\n" +
      "The markdown is rendered from the run record and matches the saved model_card.md. " +
      "Sections cover the question, data window, features, split, metrics against the baselines, limits, and approval history. " +
      "The card is a research record. It is not an approval and not a betting edge.",
    inputShape: {
      run_id: z.string(),
    },
    handler: forward("model_card"),
  }),
];

export const LAB_TOOL_NAMES = labTools.map((tool) => tool.name);
