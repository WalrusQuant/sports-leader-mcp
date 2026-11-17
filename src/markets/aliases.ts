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
  /** Polymarket US slug code, when it is neither the ESPN nor the Gamma abbreviation. */
  us?: string;
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
    PHX: { us: "pho" },
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
function leagueKey(input: string): string {
  return LEAGUE_INPUT[input.trim().toLowerCase()] ?? input;
}

export function kalshiCodesFor(league: string): string[] {
  const rows = ALIASES[leagueKey(league)] ?? {};
  const codes = new Set<string>();
  for (const [espn, row] of Object.entries(rows)) {
    codes.add((row.kalshi ?? espn).toUpperCase());
  }
  return [...codes];
}

export interface ProTeam {
  /** Kalshi ticker code. */
  code: string;
  /** ESPN abbreviation when it is not the Kalshi code. */
  espn?: string;
  /** City or disambiguated name, matching Kalshi's yes_sub_title when that is a place. */
  name: string;
  nickname: string;
}

/**
 * Pro codes and nicknames. Spread and total tickers only print one side, so
 * the other code has to come from somewhere other than that market's suffix.
 * College codes are not listed; those are read off the winner series.
 */
export const PRO_TEAMS: Record<string, ProTeam[]> = {
  nba: [
    { code: "ATL", name: "Atlanta", nickname: "Hawks" },
    { code: "BOS", name: "Boston", nickname: "Celtics" },
    { code: "BKN", name: "Brooklyn", nickname: "Nets" },
    { code: "CHA", name: "Charlotte", nickname: "Hornets" },
    { code: "CHI", name: "Chicago", nickname: "Bulls" },
    { code: "CLE", name: "Cleveland", nickname: "Cavaliers" },
    { code: "DAL", name: "Dallas", nickname: "Mavericks" },
    { code: "DEN", name: "Denver", nickname: "Nuggets" },
    { code: "DET", name: "Detroit", nickname: "Pistons" },
    { code: "GSW", espn: "GS", name: "Golden State", nickname: "Warriors" },
    { code: "HOU", name: "Houston", nickname: "Rockets" },
    { code: "IND", name: "Indiana", nickname: "Pacers" },
    { code: "LAC", name: "Los Angeles C", nickname: "Clippers" },
    { code: "LAL", name: "Los Angeles L", nickname: "Lakers" },
    { code: "MEM", name: "Memphis", nickname: "Grizzlies" },
    { code: "MIA", name: "Miami", nickname: "Heat" },
    { code: "MIL", name: "Milwaukee", nickname: "Bucks" },
    { code: "MIN", name: "Minnesota", nickname: "Timberwolves" },
    { code: "NOP", espn: "NO", name: "New Orleans", nickname: "Pelicans" },
    { code: "NYK", espn: "NY", name: "New York", nickname: "Knicks" },
    { code: "OKC", name: "Oklahoma City", nickname: "Thunder" },
    { code: "ORL", name: "Orlando", nickname: "Magic" },
    { code: "PHI", name: "Philadelphia", nickname: "76ers" },
    { code: "PHX", name: "Phoenix", nickname: "Suns" },
    { code: "POR", name: "Portland", nickname: "Trail Blazers" },
    { code: "SAC", name: "Sacramento", nickname: "Kings" },
    { code: "SAS", espn: "SA", name: "San Antonio", nickname: "Spurs" },
    { code: "TOR", name: "Toronto", nickname: "Raptors" },
    { code: "UTA", espn: "UTAH", name: "Utah", nickname: "Jazz" },
    { code: "WAS", espn: "WSH", name: "Washington", nickname: "Wizards" },
  ],
  nfl: [
    { code: "ARI", name: "Arizona", nickname: "Cardinals" },
    { code: "ATL", name: "Atlanta", nickname: "Falcons" },
    { code: "BAL", name: "Baltimore", nickname: "Ravens" },
    { code: "BUF", name: "Buffalo", nickname: "Bills" },
    { code: "CAR", name: "Carolina", nickname: "Panthers" },
    { code: "CHI", name: "Chicago", nickname: "Bears" },
    { code: "CIN", name: "Cincinnati", nickname: "Bengals" },
    { code: "CLE", name: "Cleveland", nickname: "Browns" },
    { code: "DAL", name: "Dallas", nickname: "Cowboys" },
    { code: "DEN", name: "Denver", nickname: "Broncos" },
    { code: "DET", name: "Detroit", nickname: "Lions" },
    { code: "GB", name: "Green Bay", nickname: "Packers" },
    { code: "HOU", name: "Houston", nickname: "Texans" },
    { code: "IND", name: "Indianapolis", nickname: "Colts" },
    { code: "JAC", espn: "JAX", name: "Jacksonville", nickname: "Jaguars" },
    { code: "KC", name: "Kansas City", nickname: "Chiefs" },
    { code: "LA", espn: "LAR", name: "Los Angeles R", nickname: "Rams" },
    { code: "LAC", name: "Los Angeles C", nickname: "Chargers" },
    { code: "LV", name: "Las Vegas", nickname: "Raiders" },
    { code: "MIA", name: "Miami", nickname: "Dolphins" },
    { code: "MIN", name: "Minnesota", nickname: "Vikings" },
    { code: "NE", name: "New England", nickname: "Patriots" },
    { code: "NO", name: "New Orleans", nickname: "Saints" },
    { code: "NYG", name: "New York G", nickname: "Giants" },
    { code: "NYJ", name: "New York J", nickname: "Jets" },
    { code: "PHI", name: "Philadelphia", nickname: "Eagles" },
    { code: "PIT", name: "Pittsburgh", nickname: "Steelers" },
    { code: "SEA", name: "Seattle", nickname: "Seahawks" },
    { code: "SF", name: "San Francisco", nickname: "49ers" },
    { code: "TB", name: "Tampa Bay", nickname: "Buccaneers" },
    { code: "TEN", name: "Tennessee", nickname: "Titans" },
    { code: "WAS", espn: "WSH", name: "Washington", nickname: "Commanders" },
  ],
  nhl: [
    { code: "ANA", name: "Anaheim", nickname: "Ducks" },
    { code: "BOS", name: "Boston", nickname: "Bruins" },
    { code: "BUF", name: "Buffalo", nickname: "Sabres" },
    { code: "CAR", name: "Carolina", nickname: "Hurricanes" },
    { code: "CBJ", name: "Columbus", nickname: "Blue Jackets" },
    { code: "CGY", name: "Calgary", nickname: "Flames" },
    { code: "CHI", name: "Chicago", nickname: "Blackhawks" },
    { code: "COL", name: "Colorado", nickname: "Avalanche" },
    { code: "DAL", name: "Dallas", nickname: "Stars" },
    { code: "DET", name: "Detroit", nickname: "Red Wings" },
    { code: "EDM", name: "Edmonton", nickname: "Oilers" },
    { code: "FLA", name: "Florida", nickname: "Panthers" },
    { code: "LA", name: "Los Angeles", nickname: "Kings" },
    { code: "MIN", name: "Minnesota", nickname: "Wild" },
    { code: "MTL", name: "Montreal", nickname: "Canadiens" },
    { code: "NJ", name: "New Jersey", nickname: "Devils" },
    { code: "NSH", name: "Nashville", nickname: "Predators" },
    { code: "NYI", name: "New York I", nickname: "Islanders" },
    { code: "NYR", name: "New York R", nickname: "Rangers" },
    { code: "OTT", name: "Ottawa", nickname: "Senators" },
    { code: "PHI", name: "Philadelphia", nickname: "Flyers" },
    { code: "PIT", name: "Pittsburgh", nickname: "Penguins" },
    { code: "SEA", name: "Seattle", nickname: "Kraken" },
    { code: "SJ", name: "San Jose", nickname: "Sharks" },
    { code: "STL", name: "St. Louis", nickname: "Blues" },
    { code: "TB", name: "Tampa Bay", nickname: "Lightning" },
    { code: "TOR", name: "Toronto", nickname: "Maple Leafs" },
    { code: "UTA", espn: "UTAH", name: "Utah", nickname: "Mammoth" },
    { code: "VAN", name: "Vancouver", nickname: "Canucks" },
    { code: "VGK", name: "Vegas", nickname: "Golden Knights" },
    { code: "WPG", name: "Winnipeg", nickname: "Jets" },
    { code: "WSH", name: "Washington", nickname: "Capitals" },
  ],
  mlb: [
    { code: "ARI", name: "Arizona", nickname: "Diamondbacks" },
    { code: "ATH", name: "Athletics", nickname: "Athletics" },
    { code: "ATL", name: "Atlanta", nickname: "Braves" },
    { code: "BAL", name: "Baltimore", nickname: "Orioles" },
    { code: "BOS", name: "Boston", nickname: "Red Sox" },
    { code: "CHC", name: "Chicago C", nickname: "Cubs" },
    { code: "CHW", name: "Chicago W", nickname: "White Sox" },
    { code: "CIN", name: "Cincinnati", nickname: "Reds" },
    { code: "CLE", name: "Cleveland", nickname: "Guardians" },
    { code: "COL", name: "Colorado", nickname: "Rockies" },
    { code: "DET", name: "Detroit", nickname: "Tigers" },
    { code: "HOU", name: "Houston", nickname: "Astros" },
    { code: "KC", name: "Kansas City", nickname: "Royals" },
    { code: "LAA", name: "Los Angeles A", nickname: "Angels" },
    { code: "LAD", name: "Los Angeles D", nickname: "Dodgers" },
    { code: "MIA", name: "Miami", nickname: "Marlins" },
    { code: "MIL", name: "Milwaukee", nickname: "Brewers" },
    { code: "MIN", name: "Minnesota", nickname: "Twins" },
    { code: "NYM", name: "New York M", nickname: "Mets" },
    { code: "NYY", name: "New York Y", nickname: "Yankees" },
    { code: "PHI", name: "Philadelphia", nickname: "Phillies" },
    { code: "PIT", name: "Pittsburgh", nickname: "Pirates" },
    { code: "SD", name: "San Diego", nickname: "Padres" },
    { code: "SEA", name: "Seattle", nickname: "Mariners" },
    { code: "SF", name: "San Francisco", nickname: "Giants" },
    { code: "STL", name: "St. Louis", nickname: "Cardinals" },
    { code: "TB", name: "Tampa Bay", nickname: "Rays" },
    { code: "TEX", name: "Texas", nickname: "Rangers" },
    { code: "TOR", name: "Toronto", nickname: "Blue Jays" },
    { code: "WSH", name: "Washington", nickname: "Nationals" },
  ],
};

/** ESPN, Kalshi, and pro-table codes used to split a concatenated ticker blob. */
export function seedTeamCodes(league: string): string[] {
  const key = leagueKey(league);
  const codes = new Set<string>(kalshiCodesFor(key));
  for (const espn of Object.keys(ALIASES[key] ?? {})) codes.add(espn.toUpperCase());
  for (const team of PRO_TEAMS[key] ?? []) {
    codes.add(team.code.toUpperCase());
    if (team.espn) codes.add(team.espn.toUpperCase());
  }
  return [...codes];
}

export function proTeamByCode(league: string, code: string): ProTeam | undefined {
  const upper = code.trim().toUpperCase();
  if (!upper) return undefined;
  return (PRO_TEAMS[leagueKey(league)] ?? []).find(
    (team) => team.code.toUpperCase() === upper || team.espn?.toUpperCase() === upper,
  );
}

/** Every spelling of one team: the given code, then ESPN, Kalshi, Gamma, and US slug codes. */
export function codeSpellings(league: string, code: string): string[] {
  const raw = code.trim().toLowerCase();
  if (!raw) return [];
  const upper = raw.toUpperCase();
  const spellings = new Set<string>([raw]);
  const key = leagueKey(league);
  for (const [espn, row] of Object.entries(ALIASES[key] ?? {})) {
    const all = [espn, row.kalshi, row.gamma, row.us].filter((item): item is string => Boolean(item));
    if (!all.some((item) => item.toUpperCase() === upper)) continue;
    for (const item of all) spellings.add(item.toLowerCase());
  }
  const team = proTeamByCode(key, raw);
  if (team) {
    spellings.add(team.code.toLowerCase());
    if (team.espn) spellings.add(team.espn.toLowerCase());
  }
  return [raw, ...[...spellings].filter((item) => item !== raw)];
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
  const table = ALIASES[leagueKey(league)] ?? {};
  for (const [espn, row] of Object.entries(table)) {
    const codes = [espn, row.kalshi, row.gamma, row.us]
      .filter((code): code is string => Boolean(code))
      .map((code) => code.toUpperCase());
    if (codes.includes(a) && codes.includes(b)) return true;
  }
  const leftTeam = proTeamByCode(league, a);
  const rightTeam = proTeamByCode(league, b);
  if (leftTeam && rightTeam && leftTeam.code === rightTeam.code) return true;
  return false;
}
