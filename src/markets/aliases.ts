/**
 * ESPN abbreviations are not the Kalshi or Polymarket codes.
 * Identity (case-insensitive) is the default. This table is only the pairs
 * that differ, checked against the public team lists and open markets on
 * 2026-11-16. Wisconsin is the college example: ESPN/Kalshi `WIS`, Gamma `wisc`.
 */

export interface CodeAlias {
  /** Kalshi ticker code, when it is not the ESPN abbreviation. */
  kalshi?: string;
  /** Gamma team abbreviation, when it is not the lowercased ESPN abbreviation. */
  gamma?: string;
}

/** Keys are ESPN league slugs. Inner keys are ESPN abbreviations. */
export const ALIASES: Record<string, Record<string, CodeAlias>> = {
  nfl: {
    JAX: { kalshi: "JAC" },
    LAR: { kalshi: "LA", gamma: "la" },
    WSH: { kalshi: "WAS", gamma: "was" },
  },
  nba: {
    GS: { kalshi: "GSW", gamma: "gsw" },
    NO: { kalshi: "NOP", gamma: "nop" },
    NY: { kalshi: "NYK", gamma: "nyk" },
    SA: { kalshi: "SAS", gamma: "sas" },
    UTAH: { kalshi: "UTA", gamma: "uta" },
    WSH: { kalshi: "WAS", gamma: "was" },
  },
  nhl: {
    CGY: { gamma: "cal" },
    LA: { gamma: "lak" },
    MTL: { gamma: "mon" },
    UTAH: { kalshi: "UTA", gamma: "utah" },
    VGK: { gamma: "las" },
  },
  mlb: {
    ATH: { gamma: "oak" },
    CHW: { gamma: "cws" },
  },
  "college-football": {
    ASU: { gamma: "arzst" },
    ARIZ: { gamma: "arz" },
    AUB: { gamma: "aubrn" },
    BALL: { gamma: "ballst" },
    BAY: { gamma: "bayl" },
    BC: { gamma: "boscol" },
    CAL: { gamma: "cah" },
    CLEM: { gamma: "clmsn" },
    COLO: { gamma: "col" },
    FSU: { gamma: "flst" },
    GT: { gamma: "gtech" },
    ISU: { gamma: "iowast" },
    IU: { gamma: "ind" },
    KU: { gamma: "kan" },
    MD: { gamma: "mary" },
    MEM: { gamma: "mphs" },
    MINN: { gamma: "minnst" },
    MSU: { gamma: "mst" },
    NEB: { gamma: "nebr" },
    NU: { gamma: "nw" },
    ORST: { gamma: "oregst" },
    OSU: { gamma: "ohiost" },
    OU: { gamma: "okl" },
    PSU: { gamma: "pennst" },
    RUTG: { gamma: "rutger" },
    SYR: { gamma: "syra" },
    TEX: { gamma: "tx" },
    TLSA: { gamma: "tulsa" },
    TULN: { gamma: "tulane" },
    UGA: { gamma: "ga" },
    UNC: { gamma: "ncar" },
    UVA: { gamma: "vir" },
    VAN: { gamma: "vand" },
    VT: { gamma: "vtech" },
    WIS: { gamma: "wisc" },
    WSU: { gamma: "washst" },
    WYO: { gamma: "wyom" },
  },
  "mens-college-basketball": {
    WIS: { gamma: "wisc" },
  },
  "womens-college-basketball": {
    WIS: { gamma: "wisc" },
  },
};

export interface LeagueMarketConfig {
  sport: string;
  league: string;
  /** Gamma `/sports` series id. Fixed so we never download a catalog at runtime. */
  gammaSeriesId: string;
  /** Gamma sport code used in slugs (`cfb`, not `college-football`). */
  gammaSport: string;
  kalshi: { winner: string; spread?: string; total?: string };
}

/**
 * Fixed series list. Do not discover these from Kalshi `/series` (that Sports
 * category document is several megabytes and is not needed at runtime).
 * Gamma series ids are the `/sports` values recorded on 2026-11-16.
 */
export const LEAGUES: Record<string, LeagueMarketConfig> = {
  nfl: {
    sport: "football",
    league: "nfl",
    gammaSeriesId: "12185",
    gammaSport: "nfl",
    kalshi: { winner: "KXNFLGAME", spread: "KXNFLSPREAD", total: "KXNFLTOTAL" },
  },
  nba: {
    sport: "basketball",
    league: "nba",
    gammaSeriesId: "10345",
    gammaSport: "nba",
    kalshi: { winner: "KXNBAGAME", spread: "KXNBASPREAD", total: "KXNBATOTAL" },
  },
  mlb: {
    sport: "baseball",
    league: "mlb",
    gammaSeriesId: "3",
    gammaSport: "mlb",
    kalshi: { winner: "KXMLBGAME" },
  },
  nhl: {
    sport: "hockey",
    league: "nhl",
    gammaSeriesId: "10346",
    gammaSport: "nhl",
    kalshi: { winner: "KXNHLGAME" },
  },
  "college-football": {
    sport: "football",
    league: "college-football",
    gammaSeriesId: "12756",
    gammaSport: "cfb",
    kalshi: { winner: "KXNCAAFGAME" },
  },
  "mens-college-basketball": {
    sport: "basketball",
    league: "mens-college-basketball",
    gammaSeriesId: "10470",
    gammaSport: "cbb",
    kalshi: { winner: "KXNCAAMBGAME" },
  },
  "womens-college-basketball": {
    sport: "basketball",
    league: "womens-college-basketball",
    gammaSeriesId: "10471",
    gammaSport: "cwbb",
    kalshi: { winner: "KXNCAAWBGAME" },
  },
};

const LEAGUE_INPUT: Record<string, string> = {
  nfl: "nfl",
  nba: "nba",
  mlb: "mlb",
  nhl: "nhl",
  cfb: "college-football",
  ncaaf: "college-football",
  "college-football": "college-football",
  cbb: "mens-college-basketball",
  ncaab: "mens-college-basketball",
  ncaamb: "mens-college-basketball",
  "mens-college-basketball": "mens-college-basketball",
  cwbb: "womens-college-basketball",
  ncaaw: "womens-college-basketball",
  ncaawb: "womens-college-basketball",
  "womens-college-basketball": "womens-college-basketball",
};

export function resolveLeague(input: string): LeagueMarketConfig | undefined {
  const key = LEAGUE_INPUT[input.trim().toLowerCase()];
  return key ? LEAGUES[key] : undefined;
}

export function supportedLeagueList(): string {
  return Object.values(LEAGUES)
    .map((league) => league.league)
    .join(", ");
}

/** Kalshi codes declared for a league, used to split concatenated ticker blobs. */
export function kalshiCodesFor(league: string): string[] {
  const key = LEAGUE_INPUT[league.trim().toLowerCase()] ?? league;
  const rows = ALIASES[key] ?? {};
  const codes = new Set<string>();
  for (const [espn, row] of Object.entries(rows)) {
    codes.add((row.kalshi ?? espn).toUpperCase());
  }
  return [...codes];
}

/**
 * True when two codes are the same team in this league. Order does not matter:
 * an ESPN abbreviation matches its Kalshi or Gamma alias and the reverse.
 */
export function codesEqual(league: string, left: string, right: string): boolean {
  const a = left.trim().toUpperCase();
  const b = right.trim().toUpperCase();
  if (!a || !b) return false;
  if (a === b) return true;
  const key = LEAGUE_INPUT[league.trim().toLowerCase()] ?? league;
  const table = ALIASES[key] ?? {};
  for (const [espn, row] of Object.entries(table)) {
    const codes = [espn, row.kalshi, row.gamma]
      .filter((code): code is string => Boolean(code))
      .map((code) => code.toUpperCase());
    if (codes.includes(a) && codes.includes(b)) return true;
  }
  return false;
}
