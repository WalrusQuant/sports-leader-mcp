"""inspect_data and query_data.

inspect_data describes one dataset. query_data runs one SELECT on a locked
connection, with a timeout and a row cap. It can see scores: it is an
inspector, not a feature builder. Custom SQL features cannot see those columns.
"""

from __future__ import annotations

import re
from typing import Any, Sequence

import duckdb
import pandas as pd

from sports_leader_lab import DISCLAIMER
from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.data.catalog import DATASETS, GRAIN, LEAGUES, column_timing
from sports_leader_lab.data.views import open_duckdb, register_views, view_name
from sports_leader_lab.errors import DataError, LabError
from sports_leader_lab.payload import jsonable
from sports_leader_lab.sqlguard import (
    QUERY_MAX_ROWS,
    QUERY_MAX_ROWS_LIMIT,
    QUERY_TIMEOUT_S,
    execute_select,
    locked_connection,
    validate_select,
)

_IDENT = re.compile(r"^[a-z][a-z0-9_]*$")


def inspect_data(
    league: str,
    dataset: str,
    seasons: Sequence[int] | None = None,
    *,
    cache: DataCache | None = None,
) -> dict[str, Any]:
    _known(league, dataset)
    chosen = _season_list(seasons) if seasons is not None else None
    source = cache if cache is not None else DataCache.from_config()
    con = open_duckdb()
    registered = register_views(
        con,
        source,
        leagues=[league],
        datasets=[dataset],
        seasons=chosen,
    )
    view = registered[0]
    columns = _columns(con, view.name)
    stats = _profile(con, view.name, columns)
    grain, key = _grain(dataset)
    described = []
    for column in columns:
        timing = column_timing(dataset, column)
        described.append(
            {
                "name": column,
                "null_rate": stats["nulls"].get(column),
                "timing": "pregame" if timing in {"pregame", "as_of"} else "postgame",
                "requires_as_of_join": timing == "as_of",
            }
        )
    return jsonable(
        {
            "league": league,
            "dataset": dataset,
            "view": view.name,
            "seasons": list(view.seasons),
            "rows": stats["rows"],
            "grain": grain,
            "key": key,
            "date_min": stats["date_min"],
            "date_max": stats["date_max"],
            "columns": described,
            "disclaimer": DISCLAIMER,
        }
    )


def query_data(
    sql: str,
    max_rows: int = QUERY_MAX_ROWS,
    seasons: Sequence[int] | None = None,
    *,
    timeout_s: float = QUERY_TIMEOUT_S,
    cache: DataCache | None = None,
) -> dict[str, Any]:
    """SELECT-only query over published views. Default cap is 500 rows and 20 seconds."""
    text = validate_select(sql)
    if max_rows < 1 or max_rows > QUERY_MAX_ROWS_LIMIT:
        raise LabError(f"max_rows must be between 1 and {QUERY_MAX_ROWS_LIMIT}")
    views = _views_in(text)
    if not views:
        raise LabError("query must name a published view such as nfl_games")
    chosen = _season_list(seasons) if seasons is not None else None
    source = cache if cache is not None else DataCache.from_config()
    con = open_duckdb()
    for league, dataset in views:
        register_views(con, source, leagues=[league], datasets=[dataset], seasons=chosen)
    sandbox, _dropped = locked_connection(con, drop_postgame=False)
    frame, truncated = execute_select(
        sandbox,
        text,
        max_rows=max_rows,
        timeout_s=timeout_s,
        overflow="truncate",
    )
    records = _records(frame)
    return jsonable(
        {
            "columns": list(frame.columns),
            "rows": records,
            "row_count": len(records),
            "truncated": truncated,
            "max_rows": max_rows,
            "timeout_s": timeout_s,
            "views": [view_name(league, dataset) for league, dataset in views],
            "disclaimer": DISCLAIMER,
        }
    )


def _known(league: str, dataset: str) -> None:
    if league not in LEAGUES:
        raise DataError(f"unknown league '{league}'")
    if dataset not in DATASETS:
        raise DataError(f"unknown dataset '{dataset}'")


def _season_list(seasons: Sequence[int]) -> list[int]:
    import numpy as np

    if len(list(seasons)) == 0:
        raise LabError("seasons must list at least one season")
    chosen = []
    for season in seasons:
        if isinstance(season, bool) or not isinstance(season, (int, np.integer)):
            raise LabError("seasons must be integers")
        chosen.append(int(season))
    return chosen


def _columns(con: duckdb.DuckDBPyConnection, view: str) -> list[str]:
    rows = con.execute(f"DESCRIBE {view}").fetchall()
    return [str(row[0]).lower() for row in rows]


def _profile(con: duckdb.DuckDBPyConnection, view: str, columns: list[str]) -> dict:
    safe = [column for column in columns if _IDENT.match(column)]
    null_sql = ", ".join(
        f'avg(CASE WHEN "{column}" IS NULL THEN 1.0 ELSE 0.0 END) AS "{column}"' for column in safe
    )
    select = "count(*) AS n" if not null_sql else f"count(*) AS n, {null_sql}"
    row = con.execute(f"SELECT {select} FROM {view}").fetchone()
    rows = int(row[0]) if row else 0
    nulls = {}
    for index, column in enumerate(safe, start=1):
        value = row[index] if row else None
        nulls[column] = None if value is None else float(value)
    date_column = next((name for name in ("game_date", "date", "valid_from") if name in safe), None)
    date_min = None
    date_max = None
    if date_column is not None and rows:
        span = con.execute(f'SELECT min("{date_column}"), max("{date_column}") FROM {view}').fetchone()
        if span and span[0] is not None:
            date_min = _iso(span[0])
            date_max = _iso(span[1])
    return {"rows": rows, "nulls": nulls, "date_min": date_min, "date_max": date_max}


def _grain(dataset: str) -> tuple[str, list[str]]:
    key = [str(column) for column in GRAIN.get(dataset, ())]
    if dataset == "games":
        label = "game"
    elif "player_id" in key and "game_id" in key:
        label = "player-game"
    elif "game_id" in key and "team_id" in key:
        label = "team-game"
    elif key:
        label = "snapshot"
    else:
        label = "table"
    return label, key


def _views_in(sql: str) -> list[tuple[str, str]]:
    from sports_leader_lab.sqlguard import _mask_literals

    masked = _mask_literals(sql).lower()
    found: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for token in re.findall(r"\b[a-z][a-z0-9_]*\b", masked):
        for league in LEAGUES:
            prefix = league + "_"
            if not token.startswith(prefix):
                continue
            dataset = token[len(prefix) :]
            if dataset not in DATASETS:
                continue
            pair = (league, dataset)
            if pair not in seen:
                seen.add(pair)
                found.append(pair)
    return found


def _records(frame: pd.DataFrame) -> list[dict]:
    if frame.empty:
        return []
    return jsonable(frame.to_dict(orient="records"))


def _iso(value) -> str:
    parsed = pd.to_datetime(value, errors="coerce")
    if pd.isna(parsed):
        return str(value)
    if isinstance(parsed, pd.Timestamp) and parsed == parsed.normalize():
        return parsed.date().isoformat()
    return pd.Timestamp(parsed).isoformat()
