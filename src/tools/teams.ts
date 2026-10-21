import { z } from "zod";
import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { leagueSchema, sportSchema, teamIdSchema } from "../schemas.js";
import { transformTeams, transformTeam, transformTeamInjuries } from "../transforms.js";


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
    return fetchJson(`${BASE.site}/${sport}/${league}/teams`);
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
    "Get one team view selected by view: detail, roster, schedule, record, depthcharts, injuries, transactions, history, news, or leaders. Roster athletes are normalized; other views preserve varying ESPN fields after links/images/UI metadata are removed.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    teamId: teamIdSchema,
    view: teamViewSchema,
  },
  handler: async ({ sport, league, teamId, view }) => {
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

export const teamTools = [getTeams, getTeam, getTeamInjuries];
