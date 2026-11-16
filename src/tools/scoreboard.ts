import { BASE } from "../endpoints.js";
import { UpstreamError, fetchJson } from "../client.js";
import { upstreamDetail } from "../season.js";
import { defineTool } from "../tool.js";
import {
  transformScoreboard,
  transformGameSummary,
  transformGamePlays,
  transformGameProbabilities,
  transformGameOdds,
} from "../transforms.js";
import {
  dateRangeSchema,
  dateSchema,
  eventIdSchema,
  groupsSchema,
  leagueSchema,
  limitSchema,
  providerIdSchema,
  seasonTypeSchema,
  sportSchema,
  weekSchema,
} from "../schemas.js";
import { summaryLinks } from "../links.js";
import { gameOddsOutput, gameSummaryOutput, scoreboardOutput } from "../output-schemas.js";

/**
 * ESPN's college-basketball scoreboard with no `groups` is a short featured
 * list, not Division I. Group 50 is every Division I game for both the men's
 * and women's leagues. A grouped scoreboard returns 100 events unless `limit`
 * is set, and a Saturday is often past that (155 men's games on 2026-02-07).
 * 400 covers any single date.
 *
 * A `week` query is left on ESPN's own page. Opening week is about 470 games,
 * and the compact scoreboard for that many games exceeds the token budget.
 */
const DIVISION_I_BASKETBALL = new Set(["mens-college-basketball", "womens-college-basketball"]);
const DIVISION_I_GROUP = "50";
const DIVISION_I_SCOREBOARD_LIMIT = 400;

export function scoreboardQuery(
  sport: string,
  league: string,
  input: { dates?: string; week?: number; seasontype?: number; groups?: string },
): Record<string, string | number | undefined> {
  const divisionOne = sport === "basketball" && DIVISION_I_BASKETBALL.has(league);
  const weekly = input.week != null;
  return {
    dates: input.dates,
    week: input.week,
    seasontype: input.seasontype,
    groups: input.groups ?? (divisionOne && !weekly ? DIVISION_I_GROUP : undefined),
    limit: divisionOne && !weekly ? DIVISION_I_SCOREBOARD_LIMIT : undefined,
  };
}

export const getScoreboard = defineTool({
  name: "get_scoreboard",
  title: "Get scoreboard",
  description:
    "Entry point for live, completed, and scheduled games. Returns eventId, start time, state/detail, competitors with team IDs, current/final and period scores, records, and venue, plus normalized odds (numeric moneylines, implied and no-vig probabilities, signed homeSpread) when ESPN lists them. Individual sports (golf, tennis, racing) include competitor.athlete (name, id) and order. Men's and women's college basketball default to every Division I game (group 50, limit 400); pass groups to request one conference. Other leagues, including college football, are unchanged. Pass eventId to the other game tools; use get_slate for a one-call daily view with injuries.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    date: dateSchema,
    dateRange: dateRangeSchema,
    week: weekSchema,
    seasonType: seasonTypeSchema,
    groups: groupsSchema,
  },
  handler: async ({ sport, league, date, dateRange, week, seasonType, groups }) => {
    return fetchJson(`${BASE.site}/${sport}/${league}/scoreboard`, {
      params: scoreboardQuery(sport, league, {
        dates: dateRange ?? date,
        week,
        seasontype: seasonType,
        groups,
      }),
    });
  },
  outputSchema: scoreboardOutput,
  transform: transformScoreboard,
});

export const getGameSummary = defineTool({
  name: "get_game_summary",
  title: "Get game summary",
  description:
    "Get a compact full-game view: event identity and score, team/player box scores, correctly grouped leaders, scoring and recent plays, sampled win probability, venue, broadcasts, standings context, and normalized pick-center odds (no-vig probabilities, signed homeSpread) when ESPN supplies them.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
  },
  handler: async ({ sport, league, eventId }) => {
    return fetchJson(`${BASE.site}/${sport}/${league}/summary`, {
      params: { event: eventId },
    });
  },
  outputSchema: gameSummaryOutput,
  transform: transformGameSummary,
  links: summaryLinks,
});

export const getGamePlays = defineTool({
  name: "get_game_plays",
  title: "Get game play-by-play",
  description:
    "Get compact play-by-play for a game. Returns play ID, period, clock, text, score value, scoring flag, and team ID. Use limit to bound long games.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
    limit: limitSchema,
  },
  handler: async ({ sport, league, eventId, limit }) => {
    return fetchJson(
      `${BASE.core}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/plays`,
      { params: { limit: limit ?? 400 } },
    );
  },
  transform: transformGamePlays,
});

export const getGameOdds = defineTool({
  name: "get_game_odds",
  title: "Get game betting odds",
  description:
    "Get compact betting markets by provider for one game, ready to compare with prediction-market prices: eventId, startUtc, home/away team IDs and abbreviations, numeric American moneylines, implied and no-vig probabilities (draw included for soccer), overround, signed homeSpread (negative = home favored), total, open/current lines, and a cross-provider consensus. Optionally filter by providerId from sports://reference/betting-providers.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
    providerId: providerIdSchema,
  },
  handler: async ({ sport, league, eventId, providerId }) => {
    return fetchJson(
      `${BASE.core}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/odds`,
      { params: { "provider.priority": providerId } },
    );
  },
  outputSchema: gameOddsOutput,
  // Event identity (start time, home/away team IDs and abbreviations) is not
  // in the odds document; one small cached core-API event fetch supplies it.
  context: async ({ sport, league, eventId }) =>
    fetchJson(`${BASE.core}/${sport}/leagues/${league}/events/${eventId}`),
  transform: transformGameOdds,
});

export const getGameProbabilities = defineTool({
  name: "get_game_probabilities",
  title: "Get game win probabilities",
  description:
    "Get the full compact win-probability timeline keyed by playId with homeWinPct and awayWinPct. Use get_game_summary when sampled probability points are sufficient. Hockey, soccer, and games that have not started return count 0 plus unavailable instead of an error — ESPN answers those with HTTP 400.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
    limit: limitSchema,
  },
  handler: async ({ sport, league, eventId, limit }) => {
    try {
      return await fetchJson(
        `${BASE.core}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/probabilities`,
        { params: { limit: limit ?? 200 } },
      );
    } catch (err) {
      // 400 = not published (NHL and soccer never; college football before kickoff).
      // 404 still means a bad event id and is returned as a tool error.
      if (err instanceof UpstreamError && err.status === 400) {
        return { count: 0, items: [], unavailable: upstreamDetail(err) };
      }
      throw err;
    }
  },
  transform: transformGameProbabilities,
});

export const scoreboardTools = [
  getScoreboard,
  getGameSummary,
  getGamePlays,
  getGameOdds,
  getGameProbabilities,
];
