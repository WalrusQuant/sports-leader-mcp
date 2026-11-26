"""Rest, travel, and site. These use the schedule, not the result."""

from __future__ import annotations

import pandas as pd

from sports_leader_lab.features.context import FeatureContext
from sports_leader_lab.features.prepare import team_long

REST_COLUMNS = (
    "home_rest_days",
    "away_rest_days",
    "rest_diff",
    "home_venue_changed",
    "away_venue_changed",
    "home_consecutive_away",
    "away_consecutive_away",
)

SITE_COLUMNS = ("neutral_site", "home_field")


def build_rest(ctx: FeatureContext) -> pd.DataFrame:
    long = team_long(ctx.games)
    # Shift within the team schedule. A later game cannot change an earlier row.
    grouped = long.groupby("team_id", sort=False)
    long["prev_date"] = grouped["game_date"].shift(1)
    long["prev_city"] = grouped["venue_city"].shift(1)
    long["prev_away"] = grouped["is_home"].shift(1).map(_invert_home)
    delta = long["game_date"] - long["prev_date"]
    long["rest_days"] = delta.dt.days.astype("float64")
    cities_known = long["prev_city"].notna() & long["venue_city"].notna()
    changed = (long["venue_city"].astype("string") != long["prev_city"].astype("string")).fillna(False)
    long["venue_changed"] = changed.astype("float64").mask(~cities_known)
    away_now = ~long["is_home"]
    long["consecutive_away"] = (away_now & long["prev_away"].eq(True)).astype("float64")
    long.loc[long["prev_away"].isna(), "consecutive_away"] = float("nan")
    return _with_diff(_pivot(long, ["rest_days", "venue_changed", "consecutive_away"]))


def build_site(ctx: FeatureContext) -> pd.DataFrame:
    games = ctx.games
    neutral = games["neutral_site"].map(_as_optional_bool)
    return pd.DataFrame(
        {
            "game_id": games["game_id"].to_numpy(),
            "neutral_site": neutral.astype("float64").to_numpy(),
            "home_field": (1.0 - neutral).astype("float64").to_numpy(),
        }
    )


def _with_diff(frame: pd.DataFrame) -> pd.DataFrame:
    frame["rest_diff"] = frame["home_rest_days"] - frame["away_rest_days"]
    order = ["game_id", *REST_COLUMNS]
    return frame[order]


def _pivot(long: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    home = long[long["is_home"]].set_index("game_id")
    away = long[~long["is_home"]].set_index("game_id")
    data: dict[str, pd.Series] = {}
    for column in columns:
        data[f"home_{column}"] = home[column]
        data[f"away_{column}"] = away[column]
    return pd.DataFrame(data).reset_index()


def _invert_home(value: object) -> object:
    if value is None or value is pd.NA:
        return pd.NA
    try:
        if value != value:  # NaN
            return pd.NA
    except Exception:
        return pd.NA
    return not bool(value)


def _as_optional_bool(value: object) -> float:
    if value is None or value is pd.NA:
        return float("nan")
    try:
        if value != value:  # NaN
            return float("nan")
    except Exception:
        return float("nan")
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "t", "yes"}:
            return 1.0
        if text in {"0", "false", "f", "no"}:
            return 0.0
        return float("nan")
    return 1.0 if bool(value) else 0.0
