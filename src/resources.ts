import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ENDPOINT_DOCS } from "./endpoints.js";

/**
 * Register the static reference resources on a server. The api-domains resource
 * is derived from ENDPOINT_DOCS (the same source `BASE` is built from) so the
 * documented URLs can't drift from the ones the code actually calls.
 */
export function registerResources(server: McpServer): void {
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

  // api-domains: derived from ENDPOINT_DOCS so it stays in sync with BASE
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
              domains: ENDPOINT_DOCS,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}
