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
    "List all teams in a league. Returns team IDs, names, abbreviations, colors, and logos. Use the IDs with get_team and other team-scoped tools.",
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
    "Get a team's info, roster, schedule, record, depth chart, injuries, transactions, history, news, or leaders. Pick which view via the 'view' param.",
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
  description: "Get the current injury report for a single team.",
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
