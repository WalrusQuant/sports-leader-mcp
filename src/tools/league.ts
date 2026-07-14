import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import {
  leagueSchema,
  limitSchema,
  seasonSchema,
  sportSchema,
} from "../schemas.js";
import { transformStandings, transformInjuries, transformNews, stripRefs } from "../transforms.js";
import { z } from "zod";

export const getStandings = defineTool({
  name: "get_standings",
  title: "Get league standings",
  description:
    "Get league standings. Uses the correct /apis/v2/ path (the /site/v2/ path returns a stub).",
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
    "Get league-wide statistical leaders (points, rebounds, passing yards, etc. — varies by sport).",
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
});

export const getInjuries = defineTool({
  name: "get_injuries",
  title: "Get league-wide injuries",
  description:
    "Get the league-wide injury report (all teams). Works for NBA, NFL, NHL, MLB, Soccer. Returns 500 for MMA, Tennis, Golf.",
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
  description: "Get recent league transactions — signings, trades, waivers.",
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
    "Get real-time sports news from the Now API. Filter by sport, league, or team. Results include article URLs that can be fetched and summarized via espn_fetch.",
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
