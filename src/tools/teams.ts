import { z } from "zod";
import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { leagueSchema, sportSchema, teamIdSchema } from "../schemas.js";
import { transformTeams, transformTeam, transformTeamInjuries } from "../transforms.js";

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
    const path = view === "detail" ? base : `${base}/${view}`;
    return fetchJson(path);
  },
  transform: transformTeam,
});

export const getTeamInjuries = defineTool({
  name: "get_team_injuries",
  title: "Get team injury report",
  description: "Get a normalized injury report for one team. Filters Active/news-only entries and returns player, position, status, injury detail, dates, return date, and a capped note when supplied.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    teamId: teamIdSchema,
  },
  handler: async ({ sport, league, teamId }) => {
    return fetchJson(`${BASE.site}/${sport}/${league}/teams/${teamId}/injuries`);
  },
  transform: transformTeamInjuries,
});

export const teamTools = [getTeams, getTeam, getTeamInjuries];
