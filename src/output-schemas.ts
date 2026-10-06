/**
 * Zod output schemas for the most-used tools, exposed as MCP `outputSchema`.
 *
 * Design notes:
 * - Objects are `.passthrough()` so the JSON Schema clients see allows
 *   additional properties. This server only ever *adds* fields to compact
 *   output, so a client validating against today's schema keeps working.
 * - Every schema is wrapped by `withEnvelope`: top-level fields become optional
 *   and the server's two non-compact shapes are allowed —
 *     1. the token-budget truncation envelope `{ truncated: true, ... }`, and
 *     2. `raw=true` mode, where structuredContent is `{ raw: true, response }`
 *        (the text content still carries the untouched ESPN JSON).
 *   Nested shapes stay strictly typed.
 */
import { z } from "zod";

const obj = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const str = z.string();
const optStr = z.string().optional();
const nullableNum = z.number().nullable();

function withEnvelope<T extends z.ZodRawShape>(shape: T) {
  const optionalShape = Object.fromEntries(
    Object.entries(shape).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
  ) as { [K in keyof T]: z.ZodOptional<T[K]> };
  return z
    .object({
      ...optionalShape,
      // token-budget envelope
      truncated: z.literal(true).optional(),
      estimatedTokens: z.number().optional(),
      budgetTokens: z.number().optional(),
      message: z.string().optional(),
      dataSummary: z.record(z.unknown()).optional(),
      // raw=true mode
      raw: z.literal(true).optional(),
      response: z.unknown().optional(),
    })
    .passthrough();
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

export const compactTeamSchema = obj({
  id: str,
  abbrev: str,
  name: str,
  displayName: optStr,
});

export const statusSchema = obj({
  state: str.describe("pre | in | post"),
  detail: str,
});

export const normalizedMarketSchema = obj({
  provider: str,
  providerId: z.string().nullable(),
  threeWay: z.boolean().describe("True when a draw is a possible outcome (soccer)."),
  homeMoneyLine: nullableNum.describe("American odds, e.g. -225 or 185."),
  awayMoneyLine: nullableNum,
  drawMoneyLine: nullableNum,
  homeImpliedProb: nullableNum.describe("Break-even probability including vig."),
  awayImpliedProb: nullableNum,
  drawImpliedProb: nullableNum,
  homeNoVigProb: nullableNum.describe("Vig-free probability; home+away(+draw) sums to 1."),
  awayNoVigProb: nullableNum,
  drawNoVigProb: nullableNum,
  overround: nullableNum.describe("Bookmaker margin: sum of implied probabilities minus 1."),
  noVigReason: z.string().nullable().describe("Why no-vig is null, when it is."),
  homeSpread: nullableNum.describe("Home team spread; negative = home favored."),
  total: nullableNum,
});

export const consensusSchema = obj({
  providerCount: z.number(),
  providers: z.array(str),
  homeNoVigProb: nullableNum,
  awayNoVigProb: nullableNum,
  drawNoVigProb: nullableNum,
  homeSpread: nullableNum,
  total: nullableNum,
  method: str,
  reason: z.string().nullable(),
});

const oddsBlockSchema = obj({
  markets: z.array(normalizedMarketSchema),
  consensus: consensusSchema,
});

// ─── get_scoreboard ───────────────────────────────────────────────────────────

export const scoreboardOutput = withEnvelope({
  date: z.unknown(),
  spreadConvention: optStr,
  noVigMethod: optStr,
  events: z.array(
    obj({
      id: str,
      date: str.describe("Start time, ISO-8601 UTC."),
      name: str,
      status: statusSchema,
      venue: obj({ name: str, city: z.unknown().optional() }).optional(),
      competitors: z.array(
        obj({
          homeAway: str,
          winner: z.boolean().optional(),
          team: obj({ id: optStr, abbrev: optStr, name: optStr, displayName: optStr }),
          score: str,
          linescores: z.array(str).optional(),
          record: optStr,
        }),
      ),
      odds: oddsBlockSchema.optional(),
    }),
  ),
});

// ─── get_game_summary ─────────────────────────────────────────────────────────

const looseRecord = z.record(z.unknown());

export const gameSummaryOutput = withEnvelope({
  game: obj({
    id: str,
    date: optStr,
    status: statusSchema,
    competitors: z.array(
      obj({
        homeAway: str,
        winner: z.boolean().optional(),
        team: compactTeamSchema.optional(),
        score: str,
        linescores: z.array(str).optional(),
        record: optStr,
      }),
    ),
  }),
  boxscore: obj({ teams: z.array(looseRecord), players: z.array(looseRecord) }).optional(),
  leaders: z.array(looseRecord).optional(),
  plays: obj({ count: z.number(), scoring: z.array(looseRecord), recent: z.array(looseRecord) }).optional(),
  winProbability: obj({ count: z.number(), samples: z.array(looseRecord) }).optional(),
  gameInfo: looseRecord.optional(),
  broadcasts: z.unknown().optional(),
  standings: looseRecord.optional(),
  odds: obj({
    markets: z.array(normalizedMarketSchema),
    consensus: consensusSchema,
    spreadConvention: str,
    noVigMethod: str,
  }).optional(),
});

// ─── get_game_odds ────────────────────────────────────────────────────────────

const teamRefSchema = obj({
  id: z.string().nullable(),
  abbrev: z.string().nullable(),
});

export const gameOddsOutput = withEnvelope({
  eventId: z.string().nullable(),
  startUtc: z.string().nullable().describe("ISO-8601 UTC start time (null if event lookup failed)."),
  homeTeam: teamRefSchema,
  awayTeam: teamRefSchema,
  consensus: consensusSchema,
  spreadConvention: str,
  noVigMethod: str,
  count: z.number().optional(),
  odds: z.array(
    normalizedMarketSchema
      .omit({ provider: true })
      .extend({
        provider: str,
        details: optStr,
        spread: z.number().optional().describe("ESPN's raw spread field (home-relative)."),
        overUnder: z.number().optional(),
        overOdds: z.number().optional(),
        underOdds: z.number().optional(),
        home: looseRecord,
        away: looseRecord,
        open: looseRecord,
        current: looseRecord,
      })
      .passthrough(),
  ),
});

// ─── get_injuries ─────────────────────────────────────────────────────────────

export const injuriesOutput = withEnvelope({
  timestamp: z.unknown(),
  season: z.unknown(),
  injuries: z.array(
    obj({
      team: str,
      teamId: optStr,
      injuries: z.array(
        obj({
          player: str,
          athleteId: optStr,
          position: optStr,
          team: str,
          status: str,
          injury: optStr,
          returnDate: optStr,
          date: optStr,
          note: optStr,
        }),
      ),
    }),
  ),
});

// ─── get_athlete_gamelog ──────────────────────────────────────────────────────

export const gamelogOutput = withEnvelope({
  labels: z.array(z.unknown()),
  games: z.array(
    obj({
      eventId: str,
      date: optStr,
      opponent: str,
      homeAway: z.enum(["H", "A"]),
      result: optStr,
      score: optStr,
      stats: z.record(str),
    }),
  ),
});

// ─── get_slate ────────────────────────────────────────────────────────────────

const keyInjurySchema = obj({
  athleteId: optStr,
  player: str,
  position: optStr,
  status: str,
  injury: optStr,
  returnDate: optStr,
});

const slateSideSchema = obj({
  id: str,
  abbrev: str,
  name: str,
  record: optStr,
  winner: z.boolean().optional(),
  score: z.string().nullable(),
  keyInjuries: z.array(keyInjurySchema).nullable().describe("null = injury report unavailable."),
  keyInjuriesOmitted: z.number().optional(),
  otherInjuryCount: z.number().optional().describe("Injured players with other statuses (Questionable, IL, IR, ...)."),
});

export const slateOutput = withEnvelope({
  sport: optStr,
  league: optStr,
  date: optStr,
  gameCount: z.number(),
  spreadConvention: str,
  noVigMethod: str,
  keyInjuryStatuses: z.array(str),
  injuriesAvailable: z.boolean(),
  injuriesNote: optStr,
  games: z.array(
    obj({
      eventId: str,
      startUtc: z.string().nullable(),
      name: str,
      status: statusSchema,
      neutralSite: z.boolean(),
      home: slateSideSchema,
      away: slateSideSchema,
      odds: obj({
        providers: z.array(str),
        homeNoVigProb: nullableNum,
        awayNoVigProb: nullableNum,
        drawNoVigProb: nullableNum,
        homeMoneyLine: nullableNum,
        awayMoneyLine: nullableNum,
        drawMoneyLine: nullableNum,
        homeSpread: nullableNum,
        total: nullableNum,
        reason: z.string().nullable(),
      }),
    }),
  ),
});
