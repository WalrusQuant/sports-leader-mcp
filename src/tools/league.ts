import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { injuriesOutput } from "../output-schemas.js";
import {
  leagueSchema,
  limitSchema,
  seasonSchema,
  seasonTypeSchema,
  sportSchema,
} from "../schemas.js";
import { fetchFirstOk, leagueSeasonYear, seasonLeadersPaths } from "../season.js";
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
    "Get compact statistical leaders for a season. Omit season to use the league's current season year. ESPN's /leaders collection is all-time and 400/404s for college, WNBA, and soccer, and it ignores the season query. This tool calls /seasons/{year}/types/{seasonType}/leaders instead (type 2, then type 1 for soccer). Athlete IDs are extracted from Core references; names are often absent, so follow up with athlete tools.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    season: seasonSchema,
    seasonType: seasonTypeSchema,
  },
  handler: async ({ sport, league, season, seasonType }) => {
    const year = season ?? (await leagueSeasonYear(sport, league));
    // Without an explicit season, try the previous year too so early-season
    // college (no stats yet) still returns last season's leaders.
    const years = season === undefined ? [year, year - 1] : [year];
    const urls = years.flatMap((y) => seasonLeadersPaths(sport, league, y, { seasonType }));
    try {
      return await fetchFirstOk(urls);
    } catch (err) {
      if (season === undefined && seasonType === undefined) {
        return await fetchJson(`${BASE.core}/${sport}/leagues/${league}/leaders`);
      }
      throw err;
    }
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
  outputSchema: injuriesOutput,
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

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** True when an ESPN article is tagged with `team` (abbreviation or numeric team ID). */
export function articleHasTeam(article: any, team: string): boolean {
  const t = team.trim().toLowerCase();
  return arr<any>(article?.categories).some((c) => {
    if (c?.type !== "team") return false;
    const abbr = String(c?.team?.abbreviation ?? "").toLowerCase();
    const id = String(c?.teamId ?? c?.team?.id ?? "");
    return (abbr !== "" && abbr === t) || id === t;
  });
}

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
    const want = limit ?? 20;
    // ESPN's now.core news feed ignores both `leagues` and `team` (verified
    // 2026-10-18: NFL + team=GB returned college-football previews). The Site
    // API league feed honors the league, and its `team` param is only a loose
    // boost, so we over-fetch and keep articles tagged with that team.
    if (sport && league) {
      const raw = await fetchJson(`${BASE.site}/${sport}/${league}/news`, {
        params: { team: team?.toLowerCase(), limit: team ? 50 : want },
      });
      const articles = arr<any>((raw as any)?.articles);
      const kept = team ? articles.filter((a) => articleHasTeam(a, team)) : articles;
      const headlines = kept.slice(0, want);
      return { resultsCount: headlines.length, headlines };
    }
    const raw = await fetchJson(BASE.now, {
      params: { sport, leagues: league, limit: team ? 100 : want },
    });
    if (!team) return raw;
    const headlines = arr<any>((raw as any)?.headlines)
      .filter((a) => articleHasTeam(a, team))
      .slice(0, want);
    return { resultsCount: headlines.length, headlines };
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
