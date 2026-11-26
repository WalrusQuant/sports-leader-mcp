"""Normalize the games table the feature families share."""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from sports_leader_lab.errors import LabError

_REQUIRED = (
    "game_id",
    "game_date",
    "season",
    "home_team_id",
    "away_team_id",
    "home_score",
    "away_score",
)


def prepare_games(games: pd.DataFrame) -> pd.DataFrame:
    frame = _lower(games)
    missing = [column for column in _REQUIRED if column not in frame.columns]
    if missing:
        raise LabError(f"games is missing {', '.join(missing)}")
    if frame["game_id"].duplicated().any():
        raise LabError("games has duplicate game_id values")
    frame["game_date"] = _as_timestamp(frame["game_date"])
    if frame["game_date"].isna().any():
        raise LabError("games has a missing game_date")
    if "neutral_site" not in frame.columns:
        frame["neutral_site"] = pd.NA
    if "venue" not in frame.columns:
        frame["venue"] = pd.NA
    if "venue_city" not in frame.columns:
        frame["venue_city"] = pd.NA
    if "status" not in frame.columns:
        frame["status"] = pd.NA
    if "season_type" not in frame.columns:
        frame["season_type"] = pd.NA
    if "start_time" in frame.columns:
        frame["start_time"] = _as_timestamp(frame["start_time"])
    else:
        frame["start_time"] = pd.Series(pd.NaT, index=frame.index)
    # A missing clock sorts after every timed game that day, and as-of joins
    # use the end of the date so a midnight fill does not look earlier.
    frame["start_time_missing"] = frame["start_time"].isna()
    end_of_day = frame["game_date"] + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
    frame["start_time"] = frame["start_time"].fillna(end_of_day)
    if "completed" in frame.columns:
        completed = frame["completed"].map(_as_bool)
    else:
        completed = frame["home_score"].notna() & frame["away_score"].notna()
    frame["completed"] = completed.fillna(False).astype(bool)
    frame["played"] = [
        was_played(status, done)
        for status, done in zip(frame["status"].tolist(), frame["completed"].tolist(), strict=True)
    ]
    frame["in_history"] = (
        pd.Series(frame["played"], index=frame.index)
        & frame["home_score"].notna()
        & frame["away_score"].notna()
        & ~frame["season_type"].map(is_preseason)
    )
    frame["home_score"] = pd.to_numeric(frame["home_score"], errors="coerce")
    frame["away_score"] = pd.to_numeric(frame["away_score"], errors="coerce")
    return frame.sort_values(["game_date", "start_time", "game_id"]).reset_index(drop=True)


def prepare_table(frame: pd.DataFrame | None) -> pd.DataFrame | None:
    if frame is None:
        return None
    return _lower(frame)


def was_played(status: Any, completed: bool) -> bool:
    """True when the game was played.

    Postponed, cancelled, and abandoned games are not a previous game for
    rest or travel. A suspension counts only when the game was completed.
    """
    text = ""
    if status is not None and status is not pd.NA:
        try:
            if status == status:  # NaN
                text = str(status).strip().lower()
        except Exception:
            text = ""
    if any(token in text for token in ("postpon", "cancel", "abandon")):
        return False
    if "suspend" in text and not completed:
        return False
    return bool(completed)


def is_preseason(value: Any) -> bool:
    if value is None or value is pd.NA:
        return False
    try:
        if value != value:  # NaN
            return False
    except Exception:
        pass
    text = str(value).strip().lower()
    return text in {"preseason", "pre", "1", "exhibition"}


def team_long(games: pd.DataFrame) -> pd.DataFrame:
    """One row per team per game. `is_home` is the designated home side."""
    shared = [
        "game_id",
        "game_date",
        "start_time",
        "season",
        "season_type",
        "venue",
        "venue_city",
        "neutral_site",
        "in_history",
        "played",
    ]
    home = games[shared].copy()
    home["team_id"] = games["home_team_id"]
    home["opponent_id"] = games["away_team_id"]
    home["is_home"] = True
    home["points_for"] = games["home_score"]
    home["points_against"] = games["away_score"]
    away = games[shared].copy()
    away["team_id"] = games["away_team_id"]
    away["opponent_id"] = games["home_team_id"]
    away["is_home"] = False
    away["points_for"] = games["away_score"]
    away["points_against"] = games["home_score"]
    long = pd.concat([home, away], ignore_index=True)
    long["point_diff"] = long["points_for"] - long["points_against"]
    long["win"] = _win(long["points_for"], long["points_against"])
    return long.sort_values(["team_id", "game_date", "start_time", "game_id"]).reset_index(drop=True)


def prior_roll_ewma(
    values: list[float],
    use: list[bool],
    window: int,
    span: int,
) -> tuple[list[float], list[float]]:
    """Rolling mean and EWMA of values strictly before each row.

    A row enters history only when `use` is true and the value is finite.
    The feature on that row does not include itself.
    """
    if window < 1 or span < 1:
        raise LabError("rolling window and EWMA span must be >= 1")
    roll = [math.nan] * len(values)
    ewma = [math.nan] * len(values)
    history: list[float] = []
    state: float | None = None
    alpha = 2.0 / (span + 1.0)
    for index, (value, keep) in enumerate(zip(values, use)):
        if history:
            tail = history[-window:]
            roll[index] = sum(tail) / len(tail)
            assert state is not None
            ewma[index] = state
        if keep and math.isfinite(value):
            history.append(float(value))
            state = float(value) if state is None else alpha * float(value) + (1.0 - alpha) * state
    return roll, ewma


def _win(points_for: pd.Series, points_against: pd.Series) -> pd.Series:
    win = pd.Series(math.nan, index=points_for.index, dtype="float64")
    both = points_for.notna() & points_against.notna()
    win = win.mask(both & (points_for > points_against), 1.0)
    win = win.mask(both & (points_for < points_against), 0.0)
    win = win.mask(both & (points_for == points_against), 0.5)
    return win


def _lower(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    out.columns = [str(column).lower() for column in out.columns]
    return out


def _as_timestamp(series: pd.Series) -> pd.Series:
    converted = pd.to_datetime(series, errors="coerce", utc=True)
    return converted.dt.tz_convert("UTC").dt.tz_localize(None)


def _as_bool(value: Any) -> bool:
    if value is None or value is pd.NA:
        return False
    try:
        if value != value:
            return False
    except Exception:
        pass
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "t", "yes"}
    return bool(value)
