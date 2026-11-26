"""Injury and probable counts known at the scheduled start time.

A row counts when `valid_from <= start` and (`valid_to` is null or
`valid_to > start`). The interval is half-open at the end. A season the
snapshot frame does not cover stays null, rather than a false zero.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

from sports_leader_lab.features.context import FeatureContext
from sports_leader_lab.features.prepare import prepare_table

INJURY_COLUMNS = ("home_injury_count", "away_injury_count")
PROBABLE_COLUMNS = ("home_probable_count", "away_probable_count")


def build_injuries(ctx: FeatureContext) -> pd.DataFrame:
    snaps = prepare_table(ctx.inputs.injuries)
    return _team_counts(ctx, snaps, "injury", INJURY_COLUMNS, by_game=False)


def build_probables(ctx: FeatureContext) -> pd.DataFrame:
    snaps = prepare_table(ctx.inputs.probables)
    return _team_counts(ctx, snaps, "probable", PROBABLE_COLUMNS, by_game=True)


def _team_counts(
    ctx: FeatureContext,
    snaps: pd.DataFrame | None,
    label: str,
    columns: tuple[str, str],
    *,
    by_game: bool,
) -> pd.DataFrame:
    games = ctx.games
    home = _counts(games, snaps, games["home_team_id"], label, by_game=by_game, ctx=ctx)
    away = _counts(games, snaps, games["away_team_id"], label, by_game=by_game, ctx=ctx)
    return pd.DataFrame(
        {
            "game_id": games["game_id"].to_numpy(),
            columns[0]: home,
            columns[1]: away,
        }
    )


def _counts(
    games: pd.DataFrame,
    snaps: pd.DataFrame | None,
    teams: pd.Series,
    label: str,
    *,
    by_game: bool,
    ctx: FeatureContext,
) -> list[float]:
    size = len(games)
    if snaps is None:
        _warn(ctx, f"{label} counts are null; the dataset is not loaded")
        return [math.nan] * size
    if snaps.empty or "valid_from" not in snaps.columns or "team_id" not in snaps.columns:
        _warn(ctx, f"{label} counts are null; valid_from and team_id are required")
        return [math.nan] * size
    if by_game and "game_id" not in snaps.columns:
        _warn(ctx, f"{label} counts are null; game_id is required")
        return [math.nan] * size
    covered = set(pd.to_numeric(snaps["season"], errors="coerce").dropna().astype(int)) if "season" in snaps.columns else None
    usable = snaps[snaps["valid_from"].notna()].copy()
    if usable.empty:
        _warn(ctx, f"{label} rows have no valid_from; counts stay null")
        return [math.nan] * size
    usable["valid_from"] = _clock(usable["valid_from"])
    if "valid_to" in usable.columns:
        usable["valid_to"] = _clock(usable["valid_to"])
    else:
        usable["valid_to"] = pd.NaT
    if "player_id" not in usable.columns:
        usable["player_id"] = np.arange(len(usable))
    out = [math.nan] * size
    work = games[["game_id", "season", "start_time"]].copy()
    work["team_id"] = teams.to_numpy()
    work["row_pos"] = np.arange(size)
    for team_id, group in work.groupby("team_id", sort=False):
        team_snaps = usable[usable["team_id"] == team_id]
        for row in group.itertuples(index=False):
            season = int(row.season) if pd.notna(row.season) else None
            if covered is not None and season not in covered:
                continue
            rows = team_snaps
            if by_game:
                rows = team_snaps[team_snaps["game_id"] == row.game_id]
            out[int(row.row_pos)] = _distinct_in_window(rows, row.start_time)
    return out


def _clock(series: pd.Series) -> pd.Series:
    converted = pd.to_datetime(series, utc=True, format="mixed", errors="coerce")
    return converted.dt.tz_convert("UTC").dt.tz_localize(None)


def _warn(ctx: FeatureContext, message: str) -> None:
    if message not in ctx.warnings:
        ctx.warnings.append(message)


def _distinct_in_window(rows: pd.DataFrame, start: object) -> float:
    if rows.empty:
        return 0.0
    start_ts = pd.Timestamp(start)
    valid_from = rows["valid_from"]
    valid_to = rows["valid_to"]
    active = valid_from.notna() & (valid_from <= start_ts) & (valid_to.isna() | (valid_to > start_ts))
    chosen = rows.loc[active, "player_id"]
    if chosen.empty:
        return 0.0
    known = chosen.dropna()
    anonymous = int(chosen.isna().sum())
    return float(known.nunique() + anonymous)
