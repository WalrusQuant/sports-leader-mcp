import { BASE, fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import {
  athleteIdSchema,
  leagueSchema,
  seasonSchema,
  seasonTypeSchema,
  sportSchema,
} from "../schemas.js";

export const getAthleteOverview = defineTool({
  name: "get_athlete_overview",
  title: "Get athlete overview",
  description:
    "Get a player snapshot: season stats, next game, rotowire notes, recent news. The best single-call view of a player.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    athleteId: athleteIdSchema,
  },
  handler: async ({ sport, league, athleteId }) => {
    return fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}/overview`);
  },
});

export const getAthleteStats = defineTool({
  name: "get_athlete_stats",
  title: "Get athlete season stats",
  description:
    "Get a player's full season stats with categories, labels, and glossary. Works best for NFL, NBA, NHL, MLB.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    athleteId: athleteIdSchema,
    season: seasonSchema,
    seasonType: seasonTypeSchema,
  },
  handler: async ({ sport, league, athleteId, season, seasonType }) => {
    return fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}/stats`, {
      params: { season, seasontype: seasonType },
    });
  },
});

export const getAthleteGamelog = defineTool({
  name: "get_athlete_gamelog",
  title: "Get athlete game log",
  description: "Get a player's game-by-game log with stats per game.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    athleteId: athleteIdSchema,
    season: seasonSchema,
  },
  handler: async ({ sport, league, athleteId, season }) => {
    return fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}/gamelog`, {
      params: { season },
    });
  },
});

export const getAthleteSplits = defineTool({
  name: "get_athlete_splits",
  title: "Get athlete statistical splits",
  description:
    "Get a player's statistical splits — home/away, by opponent, by month, by situation, etc.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    athleteId: athleteIdSchema,
    season: seasonSchema,
    seasonType: seasonTypeSchema,
  },
  handler: async ({ sport, league, athleteId, season, seasonType }) => {
    return fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}/splits`, {
      params: { season, seasontype: seasonType },
    });
  },
});

export const athleteTools = [
  getAthleteOverview,
  getAthleteStats,
  getAthleteGamelog,
  getAthleteSplits,
];
