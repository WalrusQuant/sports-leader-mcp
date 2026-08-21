import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
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
  leagueSchema,
  limitSchema,
  providerIdSchema,
  seasonTypeSchema,
  sportSchema,
  weekSchema,
} from "../schemas.js";

export const getScoreboard = defineTool({
  name: "get_scoreboard",
  title: "Get scoreboard",
  description:
    "Entry point for live, completed, and scheduled games. Returns eventId, start time, state/detail, competitors with team IDs, current/final and period scores, records, and venue. Pass eventId to the other game tools.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    date: dateSchema,
    dateRange: dateRangeSchema,
    week: weekSchema,
    seasonType: seasonTypeSchema,
  },
  handler: async ({ sport, league, date, dateRange, week, seasonType }) => {
    return fetchJson(`${BASE.site}/${sport}/${league}/scoreboard`, {
      params: {
        dates: dateRange ?? date,
        week,
        seasontype: seasonType,
      },
    });
  },
  transform: transformScoreboard,
});

export const getGameSummary = defineTool({
  name: "get_game_summary",
  title: "Get game summary",
  description:
    "Get a compact full-game view: event identity and score, team/player box scores, correctly grouped leaders, scoring and recent plays, sampled win probability, venue, broadcasts, and standings context when ESPN supplies it.",
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
  transform: transformGameSummary,
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
    "Get compact betting markets by provider: favorite, spread, moneylines, total and prices, plus available open/current lines. Optionally filter by providerId from sports://reference/betting-providers.",
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
  transform: transformGameOdds,
});

export const getGameProbabilities = defineTool({
  name: "get_game_probabilities",
  title: "Get game win probabilities",
  description:
    "Get the full compact win-probability timeline keyed by playId with homeWinPct and awayWinPct. Use get_game_summary when sampled probability points are sufficient.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
    limit: limitSchema,
  },
  handler: async ({ sport, league, eventId, limit }) => {
    return fetchJson(
      `${BASE.core}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/probabilities`,
      { params: { limit: limit ?? 200 } },
    );
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
