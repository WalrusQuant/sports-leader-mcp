"""Rest, travel, and site. These use the schedule, not the result.

The previous game is the previous game that was actually played. Postponed,
cancelled, and suspended-without-play rows stay on the slate and do not
reset rest. The first played game, and any gap longer than `REST_MAX_DAYS`,
has null rest: an offseason of about 245 days is not a rest measurement.
Travel keys on the venue name, then `venue_city` when the name is missing.
"""

from __future__ import annotations

import pandas as pd

from sports_leader_lab.features.context import FeatureContext
from sports_leader_lab.features.prepare import team_long

# Longer than an NFL bye (14 days) and shorter than an offseason.
REST_MAX_DAYS = 21

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
    long["venue_key"] = _venue_key(long)
    if long["venue_key"].isna().all():
        _warn(ctx, "venue and venue_city are missing; venue_changed stays null")
    pieces = [_rest_for_team(group) for _, group in long.groupby("team_id", sort=False)]
    rested = pd.concat(pieces, ignore_index=True) if pieces else long
    return _with_diff(_pivot(rested, ["rest_days", "venue_changed", "consecutive_away"]))


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


def _rest_for_team(group: pd.DataFrame) -> pd.DataFrame:
    """Rest from the previous played game. The current row is not that game."""
    ordered = group.sort_values(["game_date", "start_time", "game_id"])
    prev_date: list[object] = []
    prev_key: list[object] = []
    prev_away: list[object] = []
    last: tuple[object, object, bool] | None = None
    for row in ordered.itertuples(index=False):
        if last is None:
            prev_date.append(pd.NaT)
            prev_key.append(pd.NA)
            prev_away.append(pd.NA)
        else:
            prev_date.append(last[0])
            prev_key.append(last[1])
            prev_away.append(last[2])
        if bool(row.played):
            last = (row.game_date, row.venue_key, not bool(row.is_home))
    out = ordered.copy()
    out["prev_date"] = prev_date
    out["prev_key"] = prev_key
    out["prev_away"] = prev_away
    delta = (out["game_date"] - out["prev_date"]).dt.days.astype("float64")
    out["rest_days"] = delta.where(delta <= REST_MAX_DAYS)
    current = out["venue_key"]
    previous = out["prev_key"]
    known = current.notna() & previous.notna()
    changed = (current.astype("string") != previous.astype("string")).fillna(False)
    out["venue_changed"] = changed.astype("float64").mask(~known)
    away_now = ~out["is_home"].astype(bool)
    previous_away = out["prev_away"].map(_as_optional_bool)
    out["consecutive_away"] = (away_now & previous_away.eq(1.0)).astype("float64")
    out.loc[previous_away.isna(), "consecutive_away"] = float("nan")
    return out


def _venue_key(frame: pd.DataFrame) -> pd.Series:
    venue = _clean(frame["venue"]) if "venue" in frame.columns else _empty(frame)
    city = _clean(frame["venue_city"]) if "venue_city" in frame.columns else _empty(frame)
    return venue.where(venue.notna(), city)


def _clean(series: pd.Series) -> pd.Series:
    text = series.astype("string").str.strip()
    blank = text.isna() | text.eq("") | text.str.lower().isin({"none", "nan", "<na>", "nat"})
    return text.mask(blank)


def _empty(frame: pd.DataFrame) -> pd.Series:
    return pd.Series(pd.NA, index=frame.index, dtype="string")


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


def _warn(ctx: FeatureContext, message: str) -> None:
    if message not in ctx.warnings:
        ctx.warnings.append(message)


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
