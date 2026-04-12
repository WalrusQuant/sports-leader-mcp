import { z } from "zod";

const slug = (description: string) =>
  z
    .string()
    .min(1)
    .regex(/^[a-z0-9.\-]+$/i, "slug must be lowercase letters, digits, '.' or '-'")
    .describe(description);

export const sportSchema = slug(
  "Sport category slug. Examples: 'basketball', 'football', 'baseball', 'hockey', 'soccer', 'mma', 'tennis', 'golf', 'racing'. Use list_sports_and_leagues to discover all valid slugs.",
);

export const leagueSchema = slug(
  "League slug. Examples: 'nba', 'wnba', 'nfl', 'college-football', 'mens-college-basketball', 'mlb', 'nhl', 'eng.1' (Premier League), 'usa.1' (MLS). Use list_sports_and_leagues to discover all valid slugs.",
);

export const eventIdSchema = z
  .string()
  .min(1)
  .describe("ESPN event (game) ID, e.g. '401765432'. Find via get_scoreboard.");

export const athleteIdSchema = z
  .string()
  .min(1)
  .describe("ESPN athlete (player) ID, e.g. '3136776'. Find via search or team roster.");

export const teamIdSchema = z
  .string()
  .min(1)
  .describe("ESPN team ID, e.g. '13'. Find via get_teams.");

export const dateSchema = z
  .string()
  .regex(/^\d{8}$/, "date must be YYYYMMDD")
  .optional()
  .describe("Single date in YYYYMMDD format, e.g. '20250315'.");

export const dateRangeSchema = z
  .string()
  .regex(/^\d{8}-\d{8}$/, "dateRange must be YYYYMMDD-YYYYMMDD")
  .optional()
  .describe("Date range in YYYYMMDD-YYYYMMDD format, e.g. '20250301-20250331'.");

export const seasonSchema = z
  .number()
  .int()
  .min(1900)
  .max(2100)
  .optional()
  .describe("Season year, e.g. 2025.");

export const seasonTypeSchema = z
  .number()
  .int()
  .min(1)
  .max(4)
  .optional()
  .describe("1=preseason, 2=regular, 3=postseason, 4=offseason.");

export const weekSchema = z
  .number()
  .int()
  .min(1)
  .max(25)
  .optional()
  .describe("Week number (football).");

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .optional()
  .describe("Max results to return.");

export const providerIdSchema = z
  .number()
  .int()
  .optional()
  .describe(
    "Sportsbook provider ID. 38=Caesars, 37=FanDuel, 41=DraftKings, 58=BetMGM, 68=ESPN BET, 2000=Bet365.",
  );
