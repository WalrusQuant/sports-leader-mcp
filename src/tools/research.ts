import { BASE } from "../endpoints.js";
import { UpstreamError, fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { futuresOutput, powerIndexOutput, rankingsOutput } from "../output-schemas.js";
import { leagueSchema, seasonSchema, sportSchema, weekSchema } from "../schemas.js";
import { fetchPagedItems, leagueSeasonYear, upstreamDetail } from "../season.js";
import { transformFutures, transformPowerIndex, transformRankings } from "../transforms.js";

export const getRankings = defineTool({
  name: "get_rankings",
  title: "Get college rankings",
  description:
    "Get college poll rankings (AP, coaches, and other polls ESPN publishes). Works for college football, men's college basketball, and women's college basketball. Pro leagues have no rankings document; the tool returns polls: [] and unavailable instead of an error. Omit season and week for the latest poll.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    season: seasonSchema,
    week: weekSchema,
  },
  outputSchema: rankingsOutput,
  handler: async ({ sport, league, season, week }) => {
    try {
      return await fetchJson(`${BASE.site}/${sport}/${league}/rankings`, {
        params: { season, week },
      });
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 404 || err.status === 400)) {
        return { rankings: [], unavailable: upstreamDetail(err) };
      }
      throw err;
    }
  },
  transform: transformRankings,
});

export const getPowerIndex = defineTool({
  name: "get_power_index",
  title: "Get power index",
  description:
    "Get ESPN's team power index for a season: BPI for basketball (nba, wnba, college) and FPI for football (nfl, college-football), including rank and projected wins when ESPN publishes them. Sorted by rank. NHL, MLB, and soccer are not published; the tool returns teams: [] and unavailable. Omit season for the league's current season year. teamId is the ESPN team id (names are not in this document — join with get_teams).",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    season: seasonSchema,
  },
  outputSchema: powerIndexOutput,
  handler: async ({ sport, league, season }) => {
    const year = season ?? (await leagueSeasonYear(sport, league));
    try {
      const page = await fetchPagedItems(
        `${BASE.core}/${sport}/leagues/${league}/seasons/${year}/powerindex`,
        200,
      );
      return { season: year, ...page };
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 400 || err.status === 404)) {
        return { season: year, count: 0, items: [], unavailable: upstreamDetail(err) };
      }
      throw err;
    }
  },
  transform: transformPowerIndex,
});

export const getFutures = defineTool({
  name: "get_futures",
  title: "Get futures odds",
  description:
    "Get season futures (championship, conference, awards) with American odds. Each outcome is a teamId and/or athleteId taken from ESPN's reference — this document does not include names, so join with get_teams or get_athlete_overview. At most 40 outcomes per market are returned (favorites first, as ESPN orders them); outcomeCount is the full book. Omit season for the current season year. An empty markets list means ESPN has not posted futures for that season.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    season: seasonSchema,
  },
  outputSchema: futuresOutput,
  handler: async ({ sport, league, season }) => {
    const year = season ?? (await leagueSeasonYear(sport, league));
    try {
      const page = await fetchPagedItems(
        `${BASE.core}/${sport}/leagues/${league}/seasons/${year}/futures`,
        100,
      );
      return { season: year, ...page };
    } catch (err) {
      if (err instanceof UpstreamError && (err.status === 400 || err.status === 404)) {
        return { season: year, count: 0, items: [], unavailable: upstreamDetail(err) };
      }
      throw err;
    }
  },
  transform: transformFutures,
});

export const researchTools = [getRankings, getPowerIndex, getFutures];
