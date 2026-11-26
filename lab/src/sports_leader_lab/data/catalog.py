"""Datasets the public export publishes, and whether a column is known before the game.

The manifest is the source of truth for which files exist. A dataset that is not
in this list still gets a DuckDB view, and the feature registry can take a family
for it. That is the hook for later sources (Statcast, NHL shots, nflverse EPA).
"""

from __future__ import annotations

LEAGUES: tuple[str, ...] = ("mlb", "nba", "nfl", "nhl", "cfb", "cbb")

# Eighteen datasets, matching the sportsleader-data manifest and the Node catalog.
DATASETS: tuple[str, ...] = (
    "games",
    "team_box_scores",
    "team_game_stats",
    "player_game_logs",
    "skater_game_logs",
    "goalie_game_logs",
    "batting_game_logs",
    "pitching_game_logs",
    "passing_game_logs",
    "rushing_game_logs",
    "receiving_game_logs",
    "rosters",
    "injuries",
    "transactions",
    "depth_charts",
    "probables",
    "lineups",
    "weather",
)

# Grain for the later inspect_data tool. Not every snapshot has a single natural key.
GRAIN: dict[str, tuple[str, ...]] = {
    "games": ("game_id",),
    "team_box_scores": ("game_id", "team_id"),
    "team_game_stats": ("game_id", "team_id"),
    "player_game_logs": ("game_id", "player_id"),
    "skater_game_logs": ("game_id", "player_id"),
    "goalie_game_logs": ("game_id", "player_id"),
    "batting_game_logs": ("game_id", "player_id"),
    "pitching_game_logs": ("game_id", "player_id"),
    "passing_game_logs": ("game_id", "player_id"),
    "rushing_game_logs": ("game_id", "player_id"),
    "receiving_game_logs": ("game_id", "player_id"),
    "rosters": ("player_id", "team_id", "valid_from"),
    "injuries": ("player_id", "valid_from"),
    "transactions": ("player_id", "date", "type"),
    "depth_charts": ("team_id", "slot", "valid_from"),
    "probables": ("game_id", "team_id", "player_id", "valid_from"),
    "lineups": ("game_id", "team_id", "player_id", "valid_from"),
    "weather": ("game_id", "valid_from"),
}

# Identity and schedule fields. Known before first pitch.
_SCHEDULE = {
    "league",
    "season",
    "season_type",
    "game_id",
    "game_date",
    "start_time",
    "team_id",
    "team_abbr",
    "team_name",
    "opponent_id",
    "opponent_abbr",
    "opponent_name",
    "home_team_id",
    "home_team_abbr",
    "home_team_name",
    "away_team_id",
    "away_team_abbr",
    "away_team_name",
    "is_home",
    "neutral_site",
    "venue",
    "venue_city",
    "venue_state",
    "venue_country",
    "player_id",
    "player_name",
    "position",
    "jersey",
    "notes",
    "series_summary",
    "if_necessary",
    "week",
    "source",
}

# Timing columns on snapshot datasets. The value is pregame only after an as-of join.
_AS_OF = {
    "valid_from",
    "valid_to",
    "last_seen",
    "reported_at",
    "first_seen",
    "injury_date",
    "return_date",
    "period_start",
    "date",
}

_SNAPSHOTS = {
    "rosters",
    "injuries",
    "transactions",
    "depth_charts",
    "probables",
    "lineups",
    "weather",
}

_STAT_TABLES = {
    "team_box_scores",
    "team_game_stats",
    "player_game_logs",
    "skater_game_logs",
    "goalie_game_logs",
    "batting_game_logs",
    "pitching_game_logs",
    "passing_game_logs",
    "rushing_game_logs",
    "receiving_game_logs",
}


def column_timing(dataset: str, column: str) -> str:
    """Return `pregame`, `postgame`, or `as_of`.

    `as_of` columns (and the rest of a snapshot row) are known before the game
    only when the row is joined with `valid_from <= start` and
    `valid_to` null or `valid_to > start`. Unknown columns on a results table
    are `postgame`, which is the safe tag for a later leakage audit.
    """
    if column in _AS_OF:
        return "as_of"
    if dataset in _SNAPSHOTS:
        if column in _SCHEDULE:
            return "pregame"
        return "as_of"
    if column in _SCHEDULE:
        return "pregame"
    if dataset == "games" or dataset in _STAT_TABLES or dataset not in DATASETS:
        return "postgame"
    return "postgame"
