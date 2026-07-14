/**
 * Single source of truth for the ESPN API base URLs used across the server.
 *
 * - `BASE` is consumed by tool code (`client.ts` + the tool modules).
 * - `ENDPOINT_DOCS` is consumed by the `sports://reference/api-domains` resource.
 *
 * Keeping them in one place prevents the resource description and the code from
 * drifting apart when a URL changes.
 */

export interface EndpointDoc {
  key: string;
  base: string;
  usedFor: string;
}

export const ENDPOINT_DOCS: EndpointDoc[] = [
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
];

/** Base URLs keyed by short name, derived from ENDPOINT_DOCS. */
export const BASE = Object.fromEntries(
  ENDPOINT_DOCS.map(({ key, base }) => [key, base]),
) as Record<(typeof ENDPOINT_DOCS)[number]["key"], string>;
