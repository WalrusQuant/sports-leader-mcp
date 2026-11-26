"""Team form from prior games only: points, wins, and one league rate."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import pandas as pd

from sports_leader_lab.features.context import FeatureContext
from sports_leader_lab.features.prepare import prepare_table, prior_roll_ewma, team_long

_BASE_METRICS = ("points_for", "points_against", "point_diff", "win")


@dataclass(frozen=True)
class Rate:
    name: str
    needs: tuple[str, ...]
    compute: Callable[[pd.DataFrame], pd.Series]


def _div(num: pd.Series, den: pd.Series) -> pd.Series:
    numerator = pd.to_numeric(num, errors="coerce")
    denominator = pd.to_numeric(den, errors="coerce")
    valid = denominator > 0
    return (numerator / denominator).where(valid)


def _efg(frame: pd.DataFrame) -> pd.Series:
    made = pd.to_numeric(frame["fg_made"], errors="coerce")
    threes = pd.to_numeric(frame["fg3_made"], errors="coerce")
    return _div(made + 0.5 * threes, frame["fg_att"])


def _rate(num: str, den: str) -> Callable[[pd.DataFrame], pd.Series]:
    def compute(frame: pd.DataFrame) -> pd.Series:
        return _div(frame[num], frame[den])

    return compute


RATES: dict[str, tuple[Rate, ...]] = {
    "mlb": (Rate("batting_avg", ("hits", "at_bats"), _rate("hits", "at_bats")),),
    "nba": (Rate("efg", ("fg_made", "fg3_made", "fg_att"), _efg),),
    "cbb": (Rate("efg", ("fg_made", "fg3_made", "fg_att"), _efg),),
    "nfl": (Rate("yards_per_play", ("total_yards", "plays"), _rate("total_yards", "plays")),),
    "cfb": (Rate("yards_per_play", ("total_yards", "plays"), _rate("total_yards", "plays")),),
    "nhl": (
        Rate("shooting_pct", ("score", "shots_on_goal"), _rate("score", "shots_on_goal")),
        Rate("save_pct", ("saves", "shots_against"), _rate("saves", "shots_against")),
    ),
}


def form_columns(league: str) -> tuple[str, ...]:
    names = list(_BASE_METRICS) + [rate.name for rate in RATES.get(league, ())]
    columns: list[str] = []
    for metric in names:
        for kind in ("roll", "ewma"):
            columns.append(f"home_{kind}_{metric}")
            columns.append(f"away_{kind}_{metric}")
    return tuple(columns)


def build_form(ctx: FeatureContext) -> pd.DataFrame:
    long = team_long(ctx.games)
    metrics = list(_BASE_METRICS)
    stats = prepare_table(ctx.inputs.team_game_stats)
    for rate in RATES.get(ctx.league, ()):
        metrics.append(rate.name)
        long[rate.name] = _rate_values(ctx, long, stats, rate)
    value_columns: list[str] = []
    for metric in metrics:
        roll, ewma = _by_team(long, metric, ctx.rolling_window, ctx.ewma_span)
        long[f"roll_{metric}"] = roll
        long[f"ewma_{metric}"] = ewma
        value_columns.extend((f"roll_{metric}", f"ewma_{metric}"))
    return _pivot(long, value_columns)


def _rate_values(
    ctx: FeatureContext,
    long: pd.DataFrame,
    stats: pd.DataFrame | None,
    rate: Rate,
) -> pd.Series:
    empty = pd.Series(float("nan"), index=long.index, dtype="float64")
    if stats is None:
        ctx.warnings.append(f"{rate.name} skipped; team_game_stats is not loaded")
        return empty
    missing = [column for column in ("game_id", "team_id", *rate.needs) if column not in stats.columns]
    if missing:
        ctx.warnings.append(f"{rate.name} skipped; team_game_stats is missing {', '.join(missing)}")
        return empty
    computed = stats[["game_id", "team_id"]].copy()
    computed[rate.name] = rate.compute(stats).to_numpy()
    computed = computed.drop_duplicates(["game_id", "team_id"])
    merged = long[["game_id", "team_id"]].merge(computed, on=["game_id", "team_id"], how="left")
    return pd.Series(merged[rate.name].to_numpy(), index=long.index, dtype="float64")


def _by_team(long: pd.DataFrame, metric: str, window: int, span: int) -> tuple[list[float], list[float]]:
    roll_by_index: dict[object, float] = {}
    ewma_by_index: dict[object, float] = {}
    for _, group in long.groupby("team_id", sort=False):
        values = [float(value) if pd.notna(value) else float("nan") for value in group[metric].tolist()]
        use = [bool(flag) for flag in group["in_history"].tolist()]
        team_roll, team_ewma = prior_roll_ewma(values, use, window, span)
        for row_index, roll_value, ewma_value in zip(group.index, team_roll, team_ewma):
            roll_by_index[row_index] = roll_value
            ewma_by_index[row_index] = ewma_value
    return (
        [roll_by_index[index] for index in long.index],
        [ewma_by_index[index] for index in long.index],
    )


def _pivot(long: pd.DataFrame, value_columns: list[str]) -> pd.DataFrame:
    home = long[long["is_home"]].set_index("game_id")
    away = long[~long["is_home"]].set_index("game_id")
    data = {f"home_{column}": home[column] for column in value_columns}
    data.update({f"away_{column}": away[column] for column in value_columns})
    return pd.DataFrame(data).reset_index()
