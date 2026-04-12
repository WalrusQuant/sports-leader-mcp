#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { scoreboardTools } from "./tools/scoreboard.js";
import { leagueTools } from "./tools/league.js";
import { teamTools } from "./tools/teams.js";
import { athleteTools } from "./tools/athletes.js";
import { discoveryTools } from "./tools/discovery.js";
import type { ToolDef } from "./tool.js";
import { UpstreamError } from "./client.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ALL_TOOLS: ToolDef<any>[] = [
  ...scoreboardTools,
  ...leagueTools,
  ...teamTools,
  ...athleteTools,
  ...discoveryTools,
];

function toTextResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function toErrorResult(err: unknown) {
  let message: string;
  if (err instanceof UpstreamError) {
    message = `Upstream error ${err.status} from ${err.url}: ${err.message}${err.body ? `\n${err.body}` : ""}`;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "sports-leader-mcp",
    version: "0.1.0",
  });

  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
      },
      async (args: Record<string, unknown>) => {
        try {
          const data = await tool.handler(args as never);
          return toTextResult(data);
        } catch (err) {
          return toErrorResult(err);
        }
      },
    );
  }

  // ── Prompts ──────────────────────────────────────────────────────────────

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
3. If the user wants more detail on a specific game, call \`get_game_summary\` with the event_id from the scoreboard results to get a full breakdown including play-by-play highlights, box score leaders, and game notes.`,
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
1. Call \`search_athletes\` (or the appropriate discovery tool) with the player's name, sport="${args.sport}", and league="${args.league}" to find the athlete's ID.
2. Using the athlete_id from step 1, call \`get_athlete_overview\` to retrieve the player's profile, current team, position, and season highlights.
3. Call \`get_athlete_stats\` with the same athlete_id to get detailed season and career statistics broken down by category.
4. Call \`get_athlete_splits\` with the same athlete_id to retrieve situational splits (home/away, by opponent type, clutch situations, etc.).
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

All calls should use sport="${args.sport}", league="${args.league}", and event_id="${args.event_id}".

After collecting the data, produce a structured analysis that includes:
- Game overview (final score, venue, attendance, key storylines)
- Statistical leaders on both sides
- Turning-point plays identified from the play log and probability shifts
- Odds context (did the favorite cover? how did the line move?)`,
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

For team1 (team_id="${args.team1_id}"):
- \`get_team\` with view="record" — season record and standings position
- \`get_team\` with view="roster" — current active roster
- \`get_team\` with view="leaders" — statistical leaders on the team
- \`get_team\` with view="injuries" — current injury report

For team2 (team_id="${args.team2_id}"):
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

  // ── Resources ──────────────────────────────────────────────────────────────

  // sports-leagues: curated list of valid sport/league slug pairs
  server.resource(
    "sports-leagues",
    "sports://leagues",
    {
      description:
        "Curated list of valid sport and league slug pairs for ESPN API tools. Read this once to know what values are valid for the `sport` and `league` parameters. For the full live ESPN ontology, call the list_sports_and_leagues tool instead.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(
            {
              description:
                "Valid sport/league slug pairs for ESPN API tools. Pass `sport` and `league` together.",
              slugs: [
                // American football
                { sport: "football", league: "nfl", name: "NFL" },
                { sport: "football", league: "college-football", name: "NCAA Football (FBS)" },
                // Basketball
                { sport: "basketball", league: "nba", name: "NBA" },
                { sport: "basketball", league: "wnba", name: "WNBA" },
                { sport: "basketball", league: "mens-college-basketball", name: "NCAA Men's Basketball" },
                { sport: "basketball", league: "womens-college-basketball", name: "NCAA Women's Basketball" },
                // Baseball
                { sport: "baseball", league: "mlb", name: "MLB" },
                { sport: "baseball", league: "college-baseball", name: "NCAA Baseball" },
                // Ice hockey
                { sport: "hockey", league: "nhl", name: "NHL" },
                // Soccer
                { sport: "soccer", league: "usa.1", name: "MLS (US)" },
                { sport: "soccer", league: "eng.1", name: "English Premier League" },
                { sport: "soccer", league: "esp.1", name: "La Liga (Spain)" },
                { sport: "soccer", league: "ger.1", name: "Bundesliga (Germany)" },
                { sport: "soccer", league: "ita.1", name: "Serie A (Italy)" },
                { sport: "soccer", league: "fra.1", name: "Ligue 1 (France)" },
                { sport: "soccer", league: "uefa.champions", name: "UEFA Champions League" },
                { sport: "soccer", league: "fifa.world", name: "FIFA World Cup" },
                // Golf
                { sport: "golf", league: "pga", name: "PGA Tour" },
                { sport: "golf", league: "lpga", name: "LPGA Tour" },
                // Tennis
                { sport: "tennis", league: "atp", name: "ATP (Men's)" },
                { sport: "tennis", league: "wta", name: "WTA (Women's)" },
                // MMA
                { sport: "mma", league: "ufc", name: "UFC" },
                // Motorsport
                { sport: "racing", league: "f1", name: "Formula 1" },
                { sport: "racing", league: "nascar", name: "NASCAR Cup Series" },
              ],
              note: "Call the list_sports_and_leagues tool to retrieve ESPN's live full ontology with hundreds of additional leagues.",
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  // season-types: reference for season type codes
  server.resource(
    "season-types",
    "sports://reference/season-types",
    {
      description:
        "Mapping of seasonType numeric codes used by ESPN API tools. Pass these as the `seasonType` parameter.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(
            {
              description: "ESPN season type codes for the `seasonType` parameter.",
              seasonTypes: [
                { code: 1, label: "preseason" },
                { code: 2, label: "regular" },
                { code: 3, label: "postseason" },
                { code: 4, label: "offseason" },
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  // betting-providers: reference for sportsbook provider IDs
  server.resource(
    "betting-providers",
    "sports://reference/betting-providers",
    {
      description:
        "Sportsbook provider IDs for the `providerId` parameter in the get_game_odds tool.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(
            {
              description: "ESPN sportsbook provider IDs for the `providerId` parameter.",
              providers: [
                { id: 38, name: "Caesars Sportsbook" },
                { id: 37, name: "FanDuel" },
                { id: 41, name: "DraftKings" },
                { id: 58, name: "BetMGM" },
                { id: 68, name: "ESPN BET" },
                { id: 2000, name: "Bet365" },
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  // api-domains: reference for ESPN API base URLs
  server.resource(
    "api-domains",
    "sports://reference/api-domains",
    {
      description:
        "ESPN API base URL domains used by this server. Useful when constructing custom URLs via the espn_fetch tool.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.toString(),
          mimeType: "application/json",
          text: JSON.stringify(
            {
              description: "ESPN API base URLs used by the sports-leader-mcp tools.",
              domains: [
                {
                  key: "site",
                  base: "https://site.api.espn.com/apis/site/v2/sports",
                  usedFor:
                    "Scoreboards, game summaries, team info, news, injuries, transactions — the primary public-facing Site API.",
                },
                {
                  key: "siteV2",
                  base: "https://site.api.espn.com/apis/v2/sports",
                  usedFor:
                    "Standings — alternate v2 path on the site API host (the /site/v2/ path returns a stub for standings).",
                },
                {
                  key: "core",
                  base: "https://sports.core.api.espn.com/v2/sports",
                  usedFor:
                    "Play-by-play, odds, win probabilities, league leaders, athlete stats — the Core API with deep game data.",
                },
                {
                  key: "coreV3",
                  base: "https://sports.core.api.espn.com/v3/sports",
                  usedFor:
                    "Athlete statistics with structured split/category breakdowns (v3 Core API).",
                },
                {
                  key: "web",
                  base: "https://site.web.api.espn.com/apis/common/v3/sports",
                  usedFor:
                    "Team rosters — the web-facing common API used by ESPN's own front-end.",
                },
                {
                  key: "cdn",
                  base: "https://cdn.espn.com/core",
                  usedFor: "Team schedules — served from ESPN's CDN edge layer.",
                },
                {
                  key: "now",
                  base: "https://now.core.api.espn.com/v1/sports/news",
                  usedFor:
                    "Real-time sports news articles; filterable by sport, league, or team.",
                },
                {
                  key: "search",
                  base: "https://site.web.api.espn.com/apis/search/v2",
                  usedFor:
                    "Global ESPN search across athletes, teams, news, and articles.",
                },
                {
                  key: "ontology",
                  base: "https://sports.core.api.espn.com/v2",
                  usedFor:
                    "ESPN sports/league ontology — used to list all valid sport and league slugs.",
                },
              ],
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}

async function startStdio() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function startHttp(port: number) {
  const app = express();
  app.use(express.json());

  // Map of session ID → { server, transport }
  const sessions = new Map<
    string,
    { server: McpServer; transport: StreamableHTTPServerTransport }
  >();

  // POST /mcp — main MCP endpoint (initialize + tool calls)
  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
      },
    });

    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE stream for server-initiated notifications
  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // DELETE /mcp — close a session
  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", tools: ALL_TOOLS.length });
  });

  app.listen(port, "0.0.0.0", () => {
    console.log(`sports-leader-mcp HTTP server listening on port ${port}`);
  });
}

async function main() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : undefined;

  if (port) {
    await startHttp(port);
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
