import { z } from "zod";
import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { teamStatsOutput } from "../output-schemas.js";
import { leagueSchema, seasonSchema, sportSchema, teamIdSchema } from "../schemas.js";
import { articleHasTeam } from "./league.js";
import { fetchFirstOk, leagueSeasonYear, seasonLeadersPaths } from "../season.js";
import { transformTeams, transformTeam, transformTeamInjuries, transformTeamStats } from "../transforms.js";


// ESPN's site /teams/{id}/injuries returns {} — use the (cached) league
// report and keep only this team's bucket.
async function leagueInjuriesForTeam(sport: string, league: string, teamId: string) {
  const data = (await fetchJson(`${BASE.site}/${sport}/${league}/injuries`)) as any;
  const buckets: any[] = Array.isArray(data?.injuries) ? data.injuries : [];
  const bucket = buckets.find((b) => String(b?.id ?? "") === String(teamId));
  return {
    timestamp: data?.timestamp,
    season: data?.season,
    teamId: String(teamId),
    team: bucket?.displayName,
    injuries: Array.isArray(bucket?.injuries) ? bucket.injuries : [],
  };
}

export const getTeams = defineTool({
  name: "get_teams",
  title: "Get teams",
  description:
    "List teams in a league as compact identity records: ID, name, abbreviation, location, and venue when available. Use the IDs with team-scoped tools.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
  },
  handler: async ({ sport, league }) => {
    // The Site teams endpoint defaults to 50. That is the whole NBA/NFL/NHL,
    // and only the first page of college football (~760) and men's college
    // basketball (~360).
    return fetchJson(`${BASE.site}/${sport}/${league}/teams`, { params: { limit: 1000 } });
  },
  transform: transformTeams,
});

const teamViewSchema = z
  .enum([
    "detail",
    "roster",
    "schedule",
    "record",
    "depthcharts",
    "injuries",
    "transactions",
    "history",
    "news",
    "leaders",
  ])
  .default("detail")
  .describe(
    "Which team view to fetch. 'detail' = team profile, others map to team sub-resources.",
  );

export const getTeam = defineTool({
  name: "get_team",
  title: "Get team details",
  description:
    "Get one team view selected by view: detail, roster, schedule, record, depthcharts, injuries, transactions, history, news, or leaders. Roster, schedule, and depth chart are normalized. news, transactions, leaders, and history are read from endpoints that actually return data — the Site sub-resources for those four views (and for record and injuries) return an empty document. Optional season selects a schedule or leaders year.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    teamId: teamIdSchema,
    view: teamViewSchema,
    season: seasonSchema,
  },
  handler: async ({ sport, league, teamId, view, season }) => {
    const base = `${BASE.site}/${sport}/${league}/teams/${teamId}`;
    // ESPN's /record and /injuries sub-resources return {} — serve them from
    // the team detail record and the league injury report instead.
    if (view === "record") {
      const data = (await fetchJson(base)) as any;
      const t = data?.team ?? {};
      return {
        team: { id: t.id, abbreviation: t.abbreviation, displayName: t.displayName },
        standingSummary: t.standingSummary,
        record: t.record,
      };
    }
    if (view === "injuries") {
      return transformTeamInjuries(await leagueInjuriesForTeam(sport, league, teamId));
    }
    // /teams/{id}/news, /transactions, /leaders, and /history return {}.
    if (view === "news") {
      const raw = (await fetchJson(`${BASE.site}/${sport}/${league}/news`, {
        params: { team: teamId, limit: 40 },
      })) as { articles?: unknown[] };
      const articles = (Array.isArray(raw?.articles) ? raw.articles : []).filter((article) =>
        articleHasTeam(article, teamId),
      );
      const headlines = articles.slice(0, 15);
      return { resultsCount: headlines.length, headlines };
    }
    if (view === "transactions") {
      return fetchJson(`${BASE.site}/${sport}/${league}/transactions`, {
        params: { team: teamId, limit: 25 },
      });
    }
    if (view === "leaders") {
      const year = season ?? (await leagueSeasonYear(sport, league));
      const years = season === undefined ? [year, year - 1] : [year];
      const urls = years.flatMap((y) => seasonLeadersPaths(sport, league, y, { teamId }));
      return fetchFirstOk(urls);
    }
    if (view === "history") {
      const detail = (await fetchJson(base)) as { team?: { id?: string; abbreviation?: string; displayName?: string; record?: unknown } };
      let franchise: unknown;
      try {
        franchise = await fetchJson(`${BASE.core}/${sport}/leagues/${league}/franchises/${teamId}`);
      } catch {
        franchise = undefined;
      }
      const t = detail?.team ?? {};
      return {
        note: "ESPN's /teams/{id}/history endpoint returns an empty document. Season-by-season franchise history is not on the public API. This is the core franchise identity plus the current record from team detail.",
        franchise,
        team: { id: t.id, abbreviation: t.abbreviation, displayName: t.displayName },
        record: t.record,
      };
    }
    if (view === "schedule") {
      const params = season !== undefined ? { season } : undefined;
      const data = (await fetchJson(`${base}/schedule`, { params })) as { events?: unknown[]; season?: { type?: number } };
      const events = Array.isArray(data?.events) ? data.events : [];
      // An empty default schedule is the preseason (college basketball in
      // October) or a postseason the team is not in (MLB in November).
      // Regular season (seasontype=2) is the useful document in both cases.
      if (events.length === 0) {
        const regular = (await fetchJson(`${base}/schedule`, {
          params: { ...params, seasontype: 2 },
        })) as { events?: unknown[] };
        if (Array.isArray(regular?.events) && regular.events.length > 0) return regular;
      }
      return data;
    }
    const path = view === "detail" ? base : `${base}/${view}`;
    return fetchJson(path);
  },
  transform: transformTeam,
});

export const getTeamInjuries = defineTool({
  name: "get_team_injuries",
  title: "Get team injury report",
  description: "Get a normalized injury report for one team. Filters Active/news-only entries and returns player, position, status, injury detail, dates, return date, and a capped note when supplied. Built from the league injury report (ESPN's per-team endpoint returns an empty document).",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    teamId: teamIdSchema,
  },
  handler: async ({ sport, league, teamId }) => leagueInjuriesForTeam(sport, league, teamId),
  transform: transformTeamInjuries,
});

export const getTeamStats = defineTool({
  name: "get_team_stats",
  title: "Get team season stats",
  description:
    "Get a team's season stat line (totals only, not every split). Categories and stat abbreviations vary by sport: NBA general/offensive, NFL passing/rushing, MLB batting/pitching/fielding. Omit season for ESPN's current season. For individual player lines use get_athlete_stats.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    teamId: teamIdSchema,
    season: seasonSchema,
  },
  outputSchema: teamStatsOutput,
  handler: async ({ sport, league, teamId, season }) => {
    return fetchJson(`${BASE.site}/${sport}/${league}/teams/${teamId}/statistics`, {
      params: { season },
    });
  },
  transform: transformTeamStats,
});

export const teamTools = [getTeams, getTeam, getTeamInjuries, getTeamStats];
