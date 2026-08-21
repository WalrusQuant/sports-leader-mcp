import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the guided workflow prompts on a server. Extracted from the entry
 * point so prompts, resources, tools, and transport stay independently readable.
 */
export function registerPrompts(server: McpServer): void {
  server.prompt(
    "get-live-scores",
    "What games are happening right now?",
    {
      sport: z.string().describe("The sport slug (e.g. football, basketball, baseball)"),
      league: z.string().describe("The league slug (e.g. nfl, nba, mlb)"),
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a sports data assistant. The user wants to see live scores for ${args.sport.toUpperCase()} / ${args.league.toUpperCase()}.

Follow these steps:
1. Call \`get_scoreboard\` with sport="${args.sport}" and league="${args.league}" to retrieve all current and recent games.
2. Present a clean summary of each game: teams, current score, game status (quarter/period/inning, time remaining), and venue.
3. If the user wants more detail on a specific game, call \`get_game_summary\` with the \`eventId\` from the scoreboard results to get the box score, leaders, scoring/recent plays, and sampled win probability.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "player-stats-report",
    "Give me a full stats breakdown for a player",
    {
      player_name: z.string().describe("Full name of the player"),
      sport: z.string().describe("The sport slug (e.g. football, basketball, baseball)"),
      league: z.string().describe("The league slug (e.g. nfl, nba, mlb)"),
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a sports data assistant. The user wants a complete stats report for player "${args.player_name}" in ${args.sport.toUpperCase()} / ${args.league.toUpperCase()}.

Follow these steps in order:
1. Call \`search\` with query="${args.player_name}", sport="${args.sport}" to find the athlete's ID.
2. Using the \`athleteId\` from step 1, call \`get_athlete_overview\` to retrieve the player's profile, current team, position, and season highlights.
3. Call \`get_athlete_stats\` with the same \`athleteId\` to get detailed season statistics broken down by category.
4. Call \`get_athlete_splits\` with the same \`athleteId\` to retrieve available situational splits.
5. Synthesize all of the above into a comprehensive player report: bio, season stats table, career trends, and notable splits.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "game-analysis",
    "Analyze a specific game in detail",
    {
      sport: z.string().describe("The sport slug (e.g. football, basketball, baseball)"),
      league: z.string().describe("The league slug (e.g. nfl, nba, mlb)"),
      event_id: z.string().describe("The ESPN event/game ID to analyze"),
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a sports data assistant. The user wants an in-depth analysis of event_id="${args.event_id}" in ${args.sport.toUpperCase()} / ${args.league.toUpperCase()}.

Gather data by calling all of the following tools in parallel where possible:
1. \`get_game_summary\` — Full game overview: box score, scoring leaders, team stats, and game notes.
2. \`get_game_odds\` — Betting lines, spread, over/under, and movement throughout the game.
3. \`get_game_plays\` — Full play-by-play or key plays/drives log.
4. \`get_game_probabilities\` — Win probability chart and key momentum shifts.

All calls should use sport="${args.sport}", league="${args.league}", and eventId="${args.event_id}".

After collecting the data, produce a structured analysis that includes:
- Game overview (final score, venue, attendance, key storylines)
- Statistical leaders on both sides
- Turning-point plays identified from the play log and probability shifts
- Odds context (favorite, closing/current line, and whether the favorite covered when the result permits it)`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "league-overview",
    "What's the current state of a league?",
    {
      sport: z.string().describe("The sport slug (e.g. football, basketball, baseball)"),
      league: z.string().describe("The league slug (e.g. nfl, nba, mlb)"),
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a sports data assistant. The user wants a comprehensive overview of ${args.sport.toUpperCase()} / ${args.league.toUpperCase()}.

Gather data by calling all of the following tools (use sport="${args.sport}" and league="${args.league}" for each):
1. \`get_standings\` — Current division/conference standings with win-loss records and key tiebreaker stats.
2. \`get_league_leaders\` — Statistical leaders across major categories (points, rebounds, yards, ERA, etc.).
3. \`get_injuries\` — Significant player injuries and their expected return timelines.
4. \`get_news\` — Latest league news, trades, and headlines.
5. \`get_transactions\` — Recent roster moves, signings, waivers, and trades.

Synthesize the results into a league pulse report covering: standings race highlights, top performers, injury impact on contenders, and notable recent transactions.`,
          },
        },
      ],
    }),
  );

  server.prompt(
    "compare-teams",
    "Compare two teams head to head",
    {
      sport: z.string().describe("The sport slug (e.g. football, basketball, baseball)"),
      league: z.string().describe("The league slug (e.g. nfl, nba, mlb)"),
      team1_id: z.string().describe("ESPN team ID for the first team"),
      team2_id: z.string().describe("ESPN team ID for the second team"),
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `You are a sports data assistant. The user wants a head-to-head comparison of two teams in ${args.sport.toUpperCase()} / ${args.league.toUpperCase()}.

Gather data by calling \`get_team\` multiple times for each team with different view parameters. Use sport="${args.sport}" and league="${args.league}" throughout.

For team1 (teamId="${args.team1_id}"):
- \`get_team\` with view="record" — season record and standings position
- \`get_team\` with view="roster" — current active roster
- \`get_team\` with view="leaders" — statistical leaders on the team
- \`get_team\` with view="injuries" — current injury report

For team2 (teamId="${args.team2_id}"):
- \`get_team\` with view="record" — season record and standings position
- \`get_team\` with view="roster" — current active roster
- \`get_team\` with view="leaders" — statistical leaders on the team
- \`get_team\` with view="injuries" — current injury report

After collecting all data, produce a side-by-side comparison covering:
- Record and standings context
- Key offensive and defensive statistical leaders
- Roster depth and notable injuries
- Overall assessment of which team has the edge and why`,
          },
        },
      ],
    }),
  );
}
