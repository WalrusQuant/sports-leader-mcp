import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import {
  athleteIdSchema,
  leagueSchema,
  seasonSchema,
  seasonTypeSchema,
  sportSchema,
} from "../schemas.js";
import { transformAthleteStats, transformGamelog, transformAthleteSplits, stripRefs } from "../transforms.js";

export const getAthleteOverview = defineTool({
  name: "get_athlete_overview",
  title: "Get athlete overview",
  description:
    "Get a player snapshot after removing ESPN links/images/UI metadata. May include current statistics, next game, notes, and news; exact fields vary by sport. Use get_athlete_stats or get_athlete_gamelog for normalized tables.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    athleteId: athleteIdSchema,
  },
  handler: async ({ sport, league, athleteId }) => {
    return fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}/overview`);
  },
  transform: stripRefs,
});

export const getAthleteStats = defineTool({
  name: "get_athlete_stats",
  title: "Get athlete season stats",
  description:
    "Get compact player season stats with positional ESPN arrays converted into named stat fields. Works best for NFL, NBA, NHL, and MLB.",
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
  transform: transformAthleteStats,
});

export const getAthleteGamelog = defineTool({
  name: "get_athlete_gamelog",
  title: "Get athlete game log",
  description: "Get a compact game-by-game log. Returns date, opponent, home/away, result, score, and named stat fields; large duplicate event/reference objects are removed.",
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
  transform: transformGamelog,
});

export const getAthleteSplits = defineTool({
  name: "get_athlete_splits",
  title: "Get athlete statistical splits",
  description:
    "Get available player split categories with ESPN's positional stat arrays converted into named fields. Split types vary by sport and player; do not assume every home/away, opponent, month, or situation split exists.",
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
  transform: transformAthleteSplits,
});

export const athleteTools = [
  getAthleteOverview,
  getAthleteStats,
  getAthleteGamelog,
  getAthleteSplits,
];
