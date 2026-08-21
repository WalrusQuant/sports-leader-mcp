import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import {
  leagueSchema,
  limitSchema,
  seasonSchema,
  sportSchema,
} from "../schemas.js";
import { transformStandings, transformInjuries, transformNews, transformLeagueLeaders, stripRefs } from "../transforms.js";
import { z } from "zod";

export const getStandings = defineTool({
  name: "get_standings",
  title: "Get league standings",
  description:
    "Get compact standings grouped by ESPN conference/division. Each entry includes team ID/identity plus named standings statistics such as wins, losses, percentage, streak, and games back when supplied.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    season: seasonSchema,
  },
  handler: async ({ sport, league, season }) => {
    return fetchJson(`${BASE.siteV2}/${sport}/${league}/standings`, {
      params: { season },
    });
  },
  transform: transformStandings,
});

export const getLeagueLeaders = defineTool({
  name: "get_league_leaders",
  title: "Get league statistical leaders",
  description:
    "Get compact league leader categories and ranked values. Athlete IDs are extracted from ESPN references; some Core responses do not include athlete names, so use the IDs with athlete tools when needed.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    season: seasonSchema,
  },
  handler: async ({ sport, league, season }) => {
    return fetchJson(`${BASE.core}/${sport}/leagues/${league}/leaders`, {
      params: { season },
    });
  },
  transform: transformLeagueLeaders,
});

export const getInjuries = defineTool({
  name: "get_injuries",
  title: "Get league-wide injuries",
  description:
    "Get actual league injuries grouped by team. Compact mode filters ESPN's Active/news-only records and keeps player, position, team, status, injury detail, dates, return date, and a capped note. ESPN does not support this endpoint for every sport.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
  },
  handler: async ({ sport, league }) => {
    return fetchJson(`${BASE.site}/${sport}/${league}/injuries`);
  },
  transform: transformInjuries,
});

export const getTransactions = defineTool({
  name: "get_transactions",
  title: "Get league transactions",
  description: "Get recent league transactions such as signings, trades, and waivers. Compact mode recursively removes references/images/UI metadata, but the remaining ESPN shape varies by league.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
  },
  handler: async ({ sport, league }) => {
    return fetchJson(`${BASE.site}/${sport}/${league}/transactions`);
  },
  transform: stripRefs,
});

export const getNews = defineTool({
  name: "get_news",
  title: "Get sports news",
  description:
    "Get compact current headlines filtered by sport, league, or team abbreviation. Returns headline ID/type/text, description, publication time, source, keywords, and article URL. Use espn_fetch only if full article JSON is required.",
  inputShape: {
    sport: sportSchema.optional(),
    league: leagueSchema.optional(),
    team: z
      .string()
      .optional()
      .describe("Team abbreviation, e.g. 'LAL', 'KC'."),
    limit: limitSchema,
  },
  handler: async ({ sport, league, team, limit }) => {
    return fetchJson(BASE.now, {
      params: {
        sport,
        leagues: league,
        team,
        limit: limit ?? 20,
      },
    });
  },
  transform: transformNews,
});

export const leagueTools = [
  getStandings,
  getLeagueLeaders,
  getInjuries,
  getTransactions,
  getNews,
];
