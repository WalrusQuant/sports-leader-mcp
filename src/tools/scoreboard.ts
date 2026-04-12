import { BASE, fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
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
    "Get live and scheduled games for a sport/league. Returns event IDs, scores, status, teams, start times, and venue. Use this as the entry point for finding games — other tools take the eventId returned here.",
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
});

export const getGameSummary = defineTool({
  name: "get_game_summary",
  title: "Get game summary",
  description:
    "Get a full game summary: boxscore, plays, leaders, broadcasts, standings context, win probability. The richest single-call view of one game.",
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
});

export const getGamePlays = defineTool({
  name: "get_game_plays",
  title: "Get game play-by-play",
  description:
    "Get full play-by-play for a game from the Core API. For long games pass a high limit (e.g. 400).",
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
});

export const getGameOdds = defineTool({
  name: "get_game_odds",
  title: "Get game betting odds",
  description:
    "Get betting odds (spread, moneyline, over/under) for a game. Optionally filter by sportsbook providerId.",
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
});

export const getGameProbabilities = defineTool({
  name: "get_game_probabilities",
  title: "Get game win probabilities",
  description:
    "Get the win-probability timeline for a game (probability of each team winning at each play).",
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
});

export const scoreboardTools = [
  getScoreboard,
  getGameSummary,
  getGamePlays,
  getGameOdds,
  getGameProbabilities,
];
