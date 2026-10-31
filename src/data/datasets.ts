/**
 * Column lists from docs/data-export.md (bayesRatings data-export).
 * Query-time validation uses the manifest, not this catalog. The catalog
 * drives tool descriptions, fixture generation, and the player-log stat groups.
 */

export type ColType = "str" | "int" | "float" | "bool" | "date" | "ts";

export interface ColumnDef {
  name: string;
  type: ColType;
}

export const LEAGUES = ["mlb", "nba", "nfl", "nhl"] as const;
export type League = (typeof LEAGUES)[number];

const COL_TYPES = new Set<ColType>(["str", "int", "float", "bool", "date", "ts"]);

export function columns(spec: string): ColumnDef[] {
  const out: ColumnDef[] = [];
  for (const token of spec.split(/\s+/)) {
    if (!token) continue;
    const splitAt = token.lastIndexOf(":");
    const name = token.slice(0, splitAt);
    const type = token.slice(splitAt + 1);
    if (!name || !COL_TYPES.has(type as ColType)) {
      throw new Error(`bad column spec ${token}`);
    }
    out.push({ name, type: type as ColType });
  }
  return out;
}

function extend(base: ColumnDef[], spec: string): ColumnDef[] {
  return [...base, ...columns(spec)];
}

function withOpponent(base: ColumnDef[], stats: ColumnDef[]): ColumnDef[] {
  return [
    ...base,
    ...stats,
    ...stats.map((column) => ({ name: `opponent_${column.name}`, type: column.type })),
  ];
}

const TEAM_GAME = columns(`
  league:str season:int season_type:str game_id:int game_date:date
  team_id:int team_abbr:str team_name:str
  opponent_id:int opponent_abbr:str opponent_name:str
  is_home:bool score:int opponent_score:int
`);

const PLAYER = columns(`
  league:str season:int season_type:str game_id:int game_date:date
  team_id:int team_abbr:str team_name:str
  opponent_id:int opponent_abbr:str opponent_name:str
  is_home:bool player_id:int player_name:str position:str
`);

const GAMES = columns(`
  league:str season:int season_type:str game_id:int game_date:date start_time:ts
  status:str completed:bool
  home_team_id:int home_team_abbr:str home_team_name:str
  away_team_id:int away_team_abbr:str away_team_name:str
  home_score:int away_score:int ending:str neutral_site:bool
  venue:str venue_city:str venue_state:str venue_country:str
  notes:str series_summary:str if_necessary:bool
`);

const BOX_EXTRA: Record<League, ColumnDef[]> = {
  mlb: columns("hits:int home_runs:int walks:int batting_strikeouts:int pitching_strikeouts:int errors:int"),
  nba: columns("fg_pct:float fg3_pct:float rebounds:int assists:int turnovers:int points_in_paint:int"),
  nfl: columns("total_yards:int yards_per_play:float net_passing_yards:int rushing_yards:int first_downs:int turnovers:int"),
  nhl: columns("shots:int faceoff_pct:float hits:int blocked_shots:int takeaways:int giveaways:int"),
};

const TEAM_STATS: Record<League, ColumnDef[]> = {
  mlb: columns(`
    at_bats:int hits:int doubles:int triples:int home_runs:int walks:int hit_by_pitch:int
    strikeouts:int stolen_bases:int caught_stealing:int sac_flies:int total_bases:int
    plate_appearances:int left_on_base:int pitching_outs:int hits_allowed:int
    earned_runs_allowed:int walks_allowed:int strikeouts_pitched:int home_runs_allowed:int
    hit_batters:int quality_starts:int saves:int blown_saves:int bullpen_outs:int
    bullpen_earned_runs:int putouts:int fielding_assists:int errors:int double_plays:int
  `),
  nba: columns(`
    fg_made:int fg_att:int fg3_made:int fg3_att:int ft_made:int ft_att:int
    off_rebounds:int def_rebounds:int assists:int steals:int blocks:int turnovers:int
    fouls:int fast_break_points:int points_in_paint:int points_off_turnovers:int
    possessions:int minutes:int
  `),
  nfl: columns(`
    total_yards:int plays:int net_passing_yards:int pass_completions:int pass_attempts:int
    sacks_taken:int sack_yards_lost:int rushing_yards:int rushing_attempts:int
    first_downs_passing:int first_downs_rushing:int first_downs_penalty:int
    third_down_conversions:int third_down_attempts:int fourth_down_conversions:int
    fourth_down_attempts:int red_zone_touchdowns:int red_zone_trips:int penalties:int
    penalty_yards:int turnovers:int possession_seconds:int drives:int scoring_drives:int
    def_sacks:int def_tackles_for_loss:int def_passes_defended:int def_qb_hits:int
  `),
  nhl: columns(`
    shots_on_goal:int hits:int blocked_shots:int takeaways:int giveaways:int
    power_play_goals:int power_play_opportunities:int short_handed_goals:int
    penalty_minutes:int penalties:int faceoffs_won:int shots_against:int saves:int
  `),
};

const FIXED: Record<string, ColumnDef[]> = {
  games: GAMES,
  player_game_logs: extend(PLAYER, `
    starter:bool did_not_play:bool dnp_reason:str ejected:bool minutes:float
    points:int fg_made:int fg_att:int fg3_made:int fg3_att:int ft_made:int ft_att:int
    rebounds:int off_rebounds:int def_rebounds:int assists:int turnovers:int
    steals:int blocks:int fouls:int plus_minus:int
  `),
  skater_game_logs: extend(PLAYER, `
    unit:str toi_seconds:int pp_toi_seconds:int sh_toi_seconds:int es_toi_seconds:int
    shifts:int goals:int assists:int shots:int shots_missed:int plus_minus:int
    hits:int blocked_shots:int takeaways:int giveaways:int faceoffs_won:int
    faceoffs_lost:int penalty_minutes:int shootout_goals:int
  `),
  goalie_game_logs: extend(PLAYER, `
    starter:bool goalie_order:int toi_seconds:int shots_against:int goals_against:int
    saves:int save_pct:float even_strength_saves:int power_play_saves:int
    short_handed_saves:int shootout_shots_against:int shootout_saves:int penalty_minutes:int
  `),
  batting_game_logs: extend(PLAYER, `
    starter:bool batting_order:int at_bats:int runs:int hits:int rbi:int home_runs:int
    walks:int strikeouts:int pitches_seen:int
  `),
  pitching_game_logs: extend(PLAYER, `
    starter:bool pitching_order:int decision:str outs:int hits_allowed:int runs_allowed:int
    earned_runs:int walks:int strikeouts:int home_runs_allowed:int pitches:int strikes:int
  `),
  passing_game_logs: extend(PLAYER, `
    starter:bool completions:int attempts:int yards:int touchdowns:int interceptions:int
    sacks:int sack_yards_lost:int qbr:float passer_rating:float
  `),
  rushing_game_logs: extend(PLAYER, "carries:int yards:int touchdowns:int longest:int"),
  receiving_game_logs: extend(PLAYER, "receptions:int targets:int yards:int touchdowns:int longest:int"),
  rosters: columns(`
    league:str season:int team_id:int team_abbr:str team_name:str player_id:int
    player_name:str position:str jersey:str roster_group:str status:str
    injury_status:str injury_date:ts valid_from:ts valid_to:ts last_seen:ts
  `),
  injuries: columns(`
    source:str league:str season:int team_id:int team_abbr:str team_name:str
    player_id:int player_name:str position:str status:str injury:str detail:str
    side:str return_date:date practice_status:str game_id:int game_date:date
    week:int comment:str reported_at:ts valid_from:ts valid_to:ts last_seen:ts
  `),
  transactions: columns(`
    source:str league:str season:int date:date team_id:int team_abbr:str team_name:str
    player_id:int player_name:str type:str description:str first_seen:ts
  `),
  depth_charts: columns(`
    league:str season:int team_id:int team_abbr:str team_name:str formation:str
    slot:str depth:int player_id:int player_name:str position:str
    valid_from:ts valid_to:ts last_seen:ts
  `),
  probables: columns(`
    source:str league:str season:int game_id:int game_date:date team_id:int
    team_abbr:str team_name:str role:str player_id:int player_name:str status:str
    note:str valid_from:ts valid_to:ts last_seen:ts
  `),
  lineups: columns(`
    source:str league:str season:int game_id:int game_date:date team_id:int
    team_abbr:str team_name:str role:str slot:str player_id:int player_name:str
    position:str status:str valid_from:ts valid_to:ts last_seen:ts
  `),
  weather: columns(`
    source:str league:str season:int game_id:int game_date:date
    home_team_id:int home_team_abbr:str away_team_id:int away_team_abbr:str
    venue:str condition:str temperature_f:float high_f:float low_f:float
    wind_mph:float wind_gust_mph:float wind_dir:str humidity_pct:float
    precip_pct:float dewpoint_f:float fetch_phase:str hour_offset:int
    period_start:ts valid_from:ts valid_to:ts
  `),
  team_ratings: columns(`
    league:str season:int date:date team_id:int team_abbr:str team_name:str
    rating:float rating_low:float rating_high:float rank:int
  `),
};

export interface DatasetInfo {
  dataset: string;
  leagues: readonly League[];
  about: string;
}

export const DATASET_INFO: readonly DatasetInfo[] = [
  { dataset: "games", leagues: LEAGUES, about: "Schedule and results, one row per game." },
  { dataset: "team_box_scores", leagues: LEAGUES, about: "ESPN team box line, one row per team per game." },
  { dataset: "team_game_stats", leagues: LEAGUES, about: "Team counting stats for and against, one row per team per game." },
  { dataset: "player_game_logs", leagues: ["nba"], about: "NBA player box line, one row per player per game." },
  { dataset: "skater_game_logs", leagues: ["nhl"], about: "NHL skater box line, one row per player per game." },
  { dataset: "goalie_game_logs", leagues: ["nhl"], about: "NHL goalie box line, one row per goalie per game." },
  { dataset: "batting_game_logs", leagues: ["mlb"], about: "MLB batting line, one row per batter per game." },
  { dataset: "pitching_game_logs", leagues: ["mlb"], about: "MLB pitching line, one row per pitcher per game." },
  { dataset: "passing_game_logs", leagues: ["nfl"], about: "NFL passing line, one row per passer per game." },
  { dataset: "rushing_game_logs", leagues: ["nfl"], about: "NFL rushing line, one row per rusher per game." },
  { dataset: "receiving_game_logs", leagues: ["nfl"], about: "NFL receiving line, one row per receiver per game." },
  { dataset: "rosters", leagues: LEAGUES, about: "Roster entries with the span each was current." },
  { dataset: "injuries", leagues: LEAGUES, about: "Injury entries from ESPN and the NBA and NFL reports." },
  { dataset: "transactions", leagues: LEAGUES, about: "Transactions from ESPN and MLB." },
  { dataset: "depth_charts", leagues: ["nfl"], about: "NFL depth-chart slots with the span each was current." },
  { dataset: "probables", leagues: ["mlb", "nhl"], about: "Probable starting pitchers and goalies." },
  { dataset: "lineups", leagues: ["mlb", "nba", "nhl"], about: "Announced lineups." },
  { dataset: "weather", leagues: ["mlb", "nfl"], about: "Game weather from ESPN and the National Weather Service." },
  { dataset: "team_ratings", leagues: LEAGUES, about: "Published team rating and range, by day." },
];

export const DATASET_NAMES: readonly string[] = DATASET_INFO.map((info) => info.dataset);

/** statGroup -> dataset, by league. NBA has a single group. */
export const PLAYER_LOG_GROUPS: Record<string, Record<string, string>> = {
  nba: { player: "player_game_logs" },
  nhl: { skater: "skater_game_logs", goalie: "goalie_game_logs" },
  mlb: { batting: "batting_game_logs", pitching: "pitching_game_logs" },
  nfl: { passing: "passing_game_logs", rushing: "rushing_game_logs", receiving: "receiving_game_logs" },
};

export function columnsFor(dataset: string, league: string): ColumnDef[] {
  if (dataset === "team_box_scores" || dataset === "team_game_stats") {
    const extra = dataset === "team_box_scores" ? BOX_EXTRA[league as League] : TEAM_STATS[league as League];
    if (!extra) throw new Error(`${dataset} is not published for ${league}`);
    return dataset === "team_box_scores" ? [...TEAM_GAME, ...extra] : withOpponent(TEAM_GAME, extra);
  }
  const fixed = FIXED[dataset];
  if (!fixed) throw new Error(`unknown dataset ${dataset}`);
  return fixed;
}

export function datasetInfo(dataset: string): DatasetInfo | undefined {
  return DATASET_INFO.find((info) => info.dataset === dataset);
}
