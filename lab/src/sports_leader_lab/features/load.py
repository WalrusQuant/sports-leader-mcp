"""Load feature inputs from DuckDB views registered by the data layer."""

from __future__ import annotations

from typing import Sequence

import duckdb
import pandas as pd

from sports_leader_lab.data.views import read_view, view_name
from sports_leader_lab.errors import DataError
from sports_leader_lab.features.context import FeatureInputs


def feature_inputs_from_views(
    con: duckdb.DuckDBPyConnection,
    league: str,
    *,
    seasons: Sequence[int] | None = None,
    extra_datasets: Sequence[str] = (),
) -> FeatureInputs:
    """Read `games` and the optional tables the built-in families use.

    `extra_datasets` copies more views into `FeatureInputs.extra` so a family
    registered for a later dataset can see it without a code change here.
    """
    games = _optional(con, league, "games", seasons)
    if games is None:
        raise DataError(f"no files for {league} games")
    return FeatureInputs(
        league=league,
        games=games,
        team_game_stats=_optional(con, league, "team_game_stats", seasons),
        injuries=_optional(con, league, "injuries", seasons),
        probables=_optional(con, league, "probables", seasons),
        extra={
            dataset: frame
            for dataset in extra_datasets
            if (frame := _optional(con, league, dataset, seasons)) is not None
        },
    )


def _optional(
    con: duckdb.DuckDBPyConnection,
    league: str,
    dataset: str,
    seasons: Sequence[int] | None,
) -> pd.DataFrame | None:
    name = view_name(league, dataset)
    try:
        return read_view(con, name, seasons=seasons)
    except duckdb.CatalogException:
        return None
