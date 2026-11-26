"""Register one DuckDB view per league and dataset, over local Parquet files."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Sequence

import duckdb
import numpy as np
import pandas as pd

from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.data.manifest import Manifest, ManifestFile
from sports_leader_lab.errors import DataError

_IDENT = re.compile(r"^[a-z][a-z0-9_]*$")


@dataclass(frozen=True)
class RegisteredView:
    name: str
    league: str
    dataset: str
    seasons: tuple[int, ...]
    paths: tuple[str, ...]
    rows: int

    def describe(self) -> dict[str, object]:
        return {
            "name": self.name,
            "league": self.league,
            "dataset": self.dataset,
            "seasons": list(self.seasons),
            "rows": self.rows,
        }


def open_duckdb() -> duckdb.DuckDBPyConnection:
    """In-memory DuckDB. Parquet is read from disk; httpfs is not required."""
    return duckdb.connect(database=":memory:")


def register_views(
    con: duckdb.DuckDBPyConnection,
    cache: DataCache,
    *,
    leagues: Sequence[str] | None = None,
    datasets: Sequence[str] | None = None,
    seasons: Sequence[int] | None = None,
    manifest: Manifest | None = None,
) -> list[RegisteredView]:
    """Create views such as `nhl_games` and `mlb_team_game_stats`.

    `seasons` limits which files are downloaded and attached. The view still
    has a `season` column, so SQL can filter further (`WHERE season = 2023`).
    A requested league, dataset, or season that the manifest does not publish
    raises `DataError`.
    """
    snapshot = manifest if manifest is not None else cache.load_manifest()
    league_filter = _names(leagues, "league", snapshot.leagues())
    dataset_filter = _names(datasets, "dataset", snapshot.datasets())
    season_filter = set(_season_ints(seasons)) if seasons is not None else None

    groups: dict[tuple[str, str], list[ManifestFile]] = {}
    for entry in snapshot.files:
        if league_filter is not None and entry.league not in league_filter:
            continue
        if dataset_filter is not None and entry.dataset not in dataset_filter:
            continue
        groups.setdefault((entry.league, entry.dataset), []).append(entry)

    if league_filter is not None:
        present = {league for league, _ in groups}
        for league in league_filter:
            if league not in present and league not in snapshot.leagues():
                raise DataError(f"unknown league '{league}'")
    if dataset_filter is not None:
        present_ds = {dataset for _, dataset in groups}
        for dataset in dataset_filter:
            if dataset not in present_ds and dataset not in snapshot.datasets():
                raise DataError(f"unknown dataset '{dataset}'")

    named = datasets is not None
    registered: list[RegisteredView] = []
    for league, dataset in sorted(groups):
        chosen = [
            entry
            for entry in groups[(league, dataset)]
            if season_filter is None or entry.season in season_filter
        ]
        if not chosen:
            if named and season_filter is not None:
                listed = ", ".join(str(season) for season in sorted(season_filter))
                raise DataError(f"no files for {league} {dataset} season {listed}")
            continue
        if season_filter is not None and named:
            have = {entry.season for entry in chosen}
            missing = sorted(season_filter - have)
            if missing:
                listed = ", ".join(str(season) for season in missing)
                raise DataError(f"no files for {league} {dataset} season {listed}")
        view = register_view(con, cache, league, dataset, chosen)
        registered.append(view)
    if league_filter is not None and not registered:
        missing = ", ".join(sorted(league_filter))
        raise DataError(f"unknown league '{missing}'")
    return registered


def register_view(
    con: duckdb.DuckDBPyConnection,
    cache: DataCache,
    league: str,
    dataset: str,
    entries: Sequence[ManifestFile],
) -> RegisteredView:
    if not entries:
        raise DataError(f"no files for {league} {dataset}")
    name = view_name(league, dataset)
    paths = [cache.ensure(entry) for entry in entries]
    files_sql = ", ".join(_sql_string(path.as_posix()) for path in paths)
    con.execute(
        f"CREATE OR REPLACE VIEW {name} AS "
        f"SELECT * FROM read_parquet([{files_sql}], union_by_name = true)"
    )
    rows = con.execute(f"SELECT count(*) FROM {name}").fetchone()
    count = int(rows[0]) if rows else 0
    return RegisteredView(
        name=name,
        league=league,
        dataset=dataset,
        seasons=tuple(sorted({entry.season for entry in entries})),
        paths=tuple(path.as_posix() for path in paths),
        rows=count,
    )


def view_name(league: str, dataset: str) -> str:
    if not _IDENT.match(league) or not _IDENT.match(dataset):
        raise DataError(f"illegal view name {league}_{dataset}")
    return f"{league}_{dataset}"


def read_view(
    con: duckdb.DuckDBPyConnection,
    name: str,
    *,
    seasons: Sequence[int] | None = None,
) -> pd.DataFrame:
    """Read a registered view. `seasons` is a bound filter on the `season` column."""
    if not _IDENT.match(name):
        raise DataError(f"unknown view '{name}'")
    if seasons is None:
        return con.execute(f"SELECT * FROM {name}").fetchdf()
    chosen = _season_ints(seasons)
    placeholders = ", ".join(["?"] * len(chosen))
    return con.execute(
        f"SELECT * FROM {name} WHERE season IN ({placeholders})",
        chosen,
    ).fetchdf()


def _season_ints(seasons: Sequence[object]) -> list[int]:
    """Accept Python ints and numpy integer scalars. Booleans are not seasons."""
    chosen: list[int] = []
    for season in seasons:
        if isinstance(season, bool) or not isinstance(season, (int, np.integer)):
            raise DataError("seasons must be integers")
        chosen.append(int(season))
    return chosen


def _names(requested: Sequence[str] | None, label: str, known: set[str]) -> set[str] | None:
    if requested is None:
        return None
    cleaned: set[str] = set()
    for name in requested:
        if not isinstance(name, str) or not _IDENT.match(name):
            raise DataError(f"unknown {label} '{name}'")
        if name not in known:
            raise DataError(f"unknown {label} '{name}'")
        cleaned.add(name)
    return cleaned


def _sql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"
