import { z } from "zod";
import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { limitSchema, sportSchema } from "../schemas.js";

export const listSportsAndLeagues = defineTool({
  name: "list_sports_and_leagues",
  title: "List all sports and leagues",
  description:
    "Discover all valid sport and league slugs. Returns ESPN's full ontology of sports and leagues. Call this first when you don't know the right slug to pass to other tools.",
  inputShape: {
    limit: limitSchema,
  },
  handler: async ({ limit }) => {
    return fetchJson(`${BASE.ontology}/ontology/leagues`, {
      params: { limit: limit ?? 500 },
    });
  },
});

export const search = defineTool({
  name: "search",
  title: "Search ESPN",
  description:
    "Global ESPN search for athletes, teams, news, and articles. Returns mixed results with IDs you can pass to other tools (athleteId, teamId).",
  inputShape: {
    query: z.string().min(1).describe("Search query, e.g. 'LeBron James' or 'Chiefs'."),
    sport: sportSchema.optional(),
    limit: limitSchema,
  },
  handler: async ({ query, sport, limit }) => {
    return fetchJson(BASE.search, {
      params: { query, sport, limit: limit ?? 20 },
    });
  },
});

export const espnFetch = defineTool({
  name: "espn_fetch",
  title: "Fetch an ESPN URL",
  description:
    "Escape hatch: fetch any ESPN URL and return its JSON. Use this for endpoints not covered by a dedicated tool, or to resolve article URLs from get_news. Locked to ESPN hostnames (*.espn.com). Returns the verbatim ESPN response (no curated transform), but a token-budget guard caps very large responses. Use dedicated tools when available — they return compact, curated views.",
  inputShape: {
    url: z
      .string()
      .url()
      .describe(
        "Full ESPN URL. Must be https:// and on an *.espn.com host (e.g. site.api.espn.com, sports.core.api.espn.com, site.web.api.espn.com, cdn.espn.com, now.core.api.espn.com).",
      ),
  },
  handler: async ({ url }) => {
    return fetchJson(url);
  },
});

export const discoveryTools = [listSportsAndLeagues, search, espnFetch];
