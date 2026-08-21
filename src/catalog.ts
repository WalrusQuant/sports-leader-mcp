export interface LeagueCatalogEntry {
  sport: string;
  league: string;
  name: string;
}

/**
 * Curated, verified slug pairs for the public Site/Core endpoints used by this
 * server. ESPN's ontology endpoint returns thousands of unresolved references,
 * so it is not suitable as an agent-facing discovery response.
 */
export const LEAGUE_CATALOG: LeagueCatalogEntry[] = [
  { sport: "football", league: "nfl", name: "NFL" },
  { sport: "football", league: "college-football", name: "NCAA Football (FBS)" },
  { sport: "football", league: "cfl", name: "CFL" },
  { sport: "football", league: "ufl", name: "UFL" },
  { sport: "basketball", league: "nba", name: "NBA" },
  { sport: "basketball", league: "wnba", name: "WNBA" },
  { sport: "basketball", league: "mens-college-basketball", name: "NCAA Men's Basketball" },
  { sport: "basketball", league: "womens-college-basketball", name: "NCAA Women's Basketball" },
  { sport: "baseball", league: "mlb", name: "MLB" },
  { sport: "baseball", league: "college-baseball", name: "NCAA Baseball" },
  { sport: "baseball", league: "college-softball", name: "NCAA Softball" },
  { sport: "hockey", league: "nhl", name: "NHL" },
  { sport: "hockey", league: "mens-college-hockey", name: "NCAA Men's Hockey" },
  { sport: "soccer", league: "usa.1", name: "MLS" },
  { sport: "soccer", league: "eng.1", name: "English Premier League" },
  { sport: "soccer", league: "esp.1", name: "La Liga" },
  { sport: "soccer", league: "ger.1", name: "Bundesliga" },
  { sport: "soccer", league: "ita.1", name: "Serie A" },
  { sport: "soccer", league: "fra.1", name: "Ligue 1" },
  { sport: "soccer", league: "uefa.champions", name: "UEFA Champions League" },
  { sport: "soccer", league: "fifa.world", name: "FIFA World Cup" },
  { sport: "golf", league: "pga", name: "PGA Tour" },
  { sport: "golf", league: "lpga", name: "LPGA Tour" },
  { sport: "tennis", league: "atp", name: "ATP" },
  { sport: "tennis", league: "wta", name: "WTA" },
  { sport: "mma", league: "ufc", name: "UFC" },
  { sport: "racing", league: "f1", name: "Formula 1" },
  { sport: "racing", league: "nascar-premier", name: "NASCAR Cup Series" },
  { sport: "lacrosse", league: "pll", name: "Premier Lacrosse League" },
  { sport: "australian-football", league: "afl", name: "AFL" },
];
