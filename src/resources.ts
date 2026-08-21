import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ENDPOINT_DOCS } from "./endpoints.js";
import { LEAGUE_CATALOG } from "./catalog.js";

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
        "Curated list of verified sport and league slug pairs for ESPN API tools. Read this once to choose sport and league parameters; list_sports_and_leagues returns the same compact catalog.",
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
              slugs: LEAGUE_CATALOG,
              note: "This is a curated catalog of slug pairs verified against the public endpoints.",
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
