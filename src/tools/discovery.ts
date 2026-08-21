import { z } from "zod";
import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { limitSchema, sportSchema } from "../schemas.js";
import { transformSearch, transformSportsAndLeagues } from "../transforms.js";

export const listSportsAndLeagues = defineTool({
  name: "list_sports_and_leagues",
  title: "List all sports and leagues",
  description:
    "Return a compact, curated catalog of verified sport/league slug pairs for the other tools. The raw ESPN ontology is available with raw=true, but consists mainly of unresolved references.",
  inputShape: {
    limit: limitSchema,
  },
  handler: async ({ limit }) => {
    return fetchJson(`${BASE.ontology}/ontology/leagues`, {
      params: { limit: limit ?? 500 },
    });
  },
  transform: transformSportsAndLeagues,
});

export const search = defineTool({
  name: "search",
  title: "Search ESPN",
  description:
    "Search ESPN for athletes, teams, and articles. Compact results include names, types, usable athlete/team IDs when available, sport/league slugs, and article URLs.",
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
  transform: transformSearch,
});

export const espnFetch = defineTool({
  name: "espn_fetch",
  title: "Fetch an ESPN URL",
  description:
    "Escape hatch for ESPN JSON endpoints not covered by a dedicated tool. Locked to HTTPS ESPN hostnames. This output is uncurated and, if it exceeds the token budget, is replaced by a valid truncation envelope rather than partial JSON. Prefer dedicated tools.",
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
