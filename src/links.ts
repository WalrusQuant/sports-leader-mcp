/**
 * Resource templates and resource links for large sub-payloads.
 *
 * Each template maps 1:1 onto an existing tool: the template variables are the
 * tool's argument names, and reading a URI returns exactly the compact JSON the
 * tool returns for those arguments. Tools such as get_game_summary attach
 * `resource_link` content items pointing at these URIs so a client can fetch
 * plays, probabilities, odds, or injuries on demand instead of up front.
 *
 * This module is SDK-independent (plain data + URI helpers) so it can be shared
 * across SDK versions.
 */

export interface TemplateDef {
  name: string;
  title: string;
  uriTemplate: string;
  /** Tool whose compact output a read returns. */
  tool: string;
  description: string;
}

export const RESOURCE_TEMPLATES: TemplateDef[] = [
  {
    name: "game-summary",
    title: "Game summary",
    uriTemplate: "espn://{sport}/{league}/game/{eventId}/summary",
    tool: "get_game_summary",
    description: "Compact game summary (same as get_game_summary).",
  },
  {
    name: "game-plays",
    title: "Game play-by-play",
    uriTemplate: "espn://{sport}/{league}/game/{eventId}/plays",
    tool: "get_game_plays",
    description: "Compact play-by-play (same as get_game_plays, default limit). Large: fetch only when needed.",
  },
  {
    name: "game-probabilities",
    title: "Game win-probability timeline",
    uriTemplate: "espn://{sport}/{league}/game/{eventId}/probabilities",
    tool: "get_game_probabilities",
    description: "Full win-probability timeline (same as get_game_probabilities).",
  },
  {
    name: "game-odds",
    title: "Game odds",
    uriTemplate: "espn://{sport}/{league}/game/{eventId}/odds",
    tool: "get_game_odds",
    description: "Per-provider odds with no-vig probabilities and consensus (same as get_game_odds).",
  },
  {
    name: "league-injuries",
    title: "League injury report",
    uriTemplate: "espn://{sport}/{league}/injuries",
    tool: "get_injuries",
    description: "League-wide compact injury report (same as get_injuries). Large for NFL.",
  },
  {
    name: "team-injuries",
    title: "Team injury report",
    uriTemplate: "espn://{sport}/{league}/team/{teamId}/injuries",
    tool: "get_team_injuries",
    description: "One team's injury report (same as get_team_injuries). Note: ESPN's site endpoint behind it currently returns an empty document; prefer the league report.",
  },
  {
    name: "slate",
    title: "Daily slate",
    uriTemplate: "espn://{sport}/{league}/slate/{date}",
    tool: "get_slate",
    description: "Games for an ESPN game day (YYYYMMDD) with consensus no-vig odds and key injuries (same as get_slate).",
  },
];

export interface ResourceLinkContent {
  type: "resource_link";
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType: string;
}

const enc = (v: unknown) => encodeURIComponent(String(v));

export function gameUri(sport: unknown, league: unknown, eventId: unknown, part: string): string {
  return `espn://${enc(sport)}/${enc(league)}/game/${enc(eventId)}/${part}`;
}

export function leagueInjuriesUri(sport: unknown, league: unknown): string {
  return `espn://${enc(sport)}/${enc(league)}/injuries`;
}

export function teamInjuriesUri(sport: unknown, league: unknown, teamId: unknown): string {
  return `espn://${enc(sport)}/${enc(league)}/team/${enc(teamId)}/injuries`;
}

export function link(uri: string, name: string, title: string, description: string): ResourceLinkContent {
  return { type: "resource_link", uri, name, title, description, mimeType: "application/json" };
}

/** Links attached to get_game_summary: the big sub-payloads it only samples. */
export function summaryLinks(args: Record<string, unknown>): ResourceLinkContent[] {
  const { sport, league, eventId } = args;
  if (!sport || !league || !eventId) return [];
  const links = [
    link(gameUri(sport, league, eventId, "plays"), "game-plays", "Full play-by-play",
      "Complete compact play-by-play; the summary only includes scoring and the last 20 plays."),
    link(gameUri(sport, league, eventId, "probabilities"), "game-probabilities", "Full win-probability timeline",
      "Every win-probability point; the summary only includes ~25 samples."),
    link(gameUri(sport, league, eventId, "odds"), "game-odds", "All sportsbook odds",
      "Every provider's line with no-vig probabilities and consensus."),
  ];
  // League report rather than per-team links: ESPN's site team-injuries
  // endpoint currently returns {} (see get_team_injuries), while the league
  // report is populated and cached.
  links.push(link(leagueInjuriesUri(sport, league), "league-injuries", "League injury report",
    "Compact injury report for every team (filter by teamId for this game's teams)."));
  return links;
}

/** Links attached to get_slate: the full league injury report it filters. */
export function slateLinks(args: Record<string, unknown>): ResourceLinkContent[] {
  const { sport, league } = args;
  if (!sport || !league) return [];
  return [
    link(leagueInjuriesUri(sport, league), "league-injuries", "Full league injury report",
      "All statuses (Questionable, IL, IR, ...); the slate lists only Out/Doubtful."),
  ];
}
