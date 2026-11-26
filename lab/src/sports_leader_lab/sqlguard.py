"""SELECT-only SQL on a connection that cannot read the filesystem.

User-facing SQL (query_data, and custom SQL features) runs here. The sandbox
is a copy of the caller's tables with `enable_external_access` off and
`lock_configuration` on, so a statement cannot turn file access back on.
Custom SQL features also have postgame columns removed from that copy.
"""

from __future__ import annotations

import re
import threading
from typing import Iterable

import duckdb
import pandas as pd

from sports_leader_lab.data.catalog import DATASETS, GRAIN, LEAGUES, column_timing, is_snapshot_dataset
from sports_leader_lab.errors import LabError

_NAME = re.compile(r"^[a-z][a-z0-9_]*$")
_SELECT = re.compile(r"^(select|with)\b", re.IGNORECASE)

# Result fields a custom feature must not be able to name, even on a table
# whose dataset we cannot infer. Snapshot tables still keep their own as-of
# `status` when the dataset is known (an injury status is not the game result).
_ALWAYS_POSTGAME = frozenset(
    {"home_score", "away_score", "score", "opponent_score", "completed"}
)

QUERY_TIMEOUT_S = 20.0
QUERY_MAX_ROWS = 500
QUERY_MAX_ROWS_LIMIT = 5000
FEATURE_SQL_TIMEOUT_S = 60.0
FEATURE_SQL_MAX_ROWS = 2_000_000


def validate_select(sql: str) -> str:
    """One SELECT or WITH. A semicolon inside a string or comment is allowed."""
    statements = [part for part in _split_sql(sql) if part.strip()]
    if len(statements) != 1:
        raise LabError("SQL must be a single SELECT")
    text = _strip_leading_comments(statements[0]).strip()
    if not _SELECT.match(text):
        raise LabError("SQL must be a SELECT")
    return text


def locked_connection(con: duckdb.DuckDBPyConnection, *, drop_postgame: bool = False):
    """Copy `main` tables into a connection that cannot read the filesystem.

    Views over local Parquet stay on the caller's connection, because turning
    `enable_external_access` off there would stop those views from reading.
    Returns the sandbox, the column names that were removed, and the raw
    snapshot table names that were replaced. Custom SQL (`drop_postgame=True`)
    does not receive those raw tables. It receives `{table}_asof`, which keeps
    a snapshot row only when `valid_from <= start_time` and `valid_to` is null
    or later than `start_time`. `query_data` leaves the tables as published.
    """
    sandbox = duckdb.connect(database=":memory:")
    dropped: set[str] = set()
    raw_snapshots: set[str] = set()
    frames: dict[str, pd.DataFrame] = {}
    names = con.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'main'
        """
    ).fetchall()
    for (name,) in names:
        if not isinstance(name, str) or not _NAME.match(name):
            continue
        frames[name] = con.execute(f"SELECT * FROM {name}").fetchdf()
    games = {
        league_of(name): frame
        for name, frame in frames.items()
        if dataset_of(name) == "games" and league_of(name) is not None
    }
    for name, frame in frames.items():
        dataset = dataset_of(name)
        if drop_postgame and dataset is not None and is_snapshot_dataset(dataset):
            raw_snapshots.add(name)
            league = league_of(name)
            schedule = games.get(league) if league is not None else None
            asof = asof_snapshot(dataset, schedule, frame)
            sandbox.register(f"{name}_asof", asof)
            continue
        if drop_postgame:
            frame, gone = strip_postgame(name, frame)
            dropped.update(gone)
        sandbox.register(name, frame)
    sandbox.execute("SET enable_external_access = false")
    sandbox.execute("SET lock_configuration = true")
    return sandbox, dropped, raw_snapshots


def feature_sql_problem(sql: str, dropped: Iterable[str], raw_snapshots: Iterable[str]) -> str | None:
    """A reason to refuse one custom SQL feature, or None when it is safe to run."""
    named = referenced_columns(sql, dropped)
    if named:
        listed = ", ".join(sorted(named))
        return f"references postgame columns: {listed}"
    raw = referenced_columns(sql, raw_snapshots)
    if raw:
        listed = ", ".join(sorted(raw))
        views = ", ".join(f"{table}_asof" for table in sorted(raw))
        return (
            f"references raw snapshot {listed}; use {views}, which only includes rows "
            "with valid_from <= start_time and valid_to null or later than start_time"
        )
    return None


def strip_postgame(table: str, frame: pd.DataFrame) -> tuple[pd.DataFrame, set[str]]:
    """Drop result columns from one sandbox table."""
    dataset = dataset_of(table)
    keep: list[str] = []
    gone: set[str] = set()
    for column in frame.columns:
        if _is_postgame(dataset, str(column)):
            gone.add(str(column).lower())
            continue
        keep.append(column)
    if not keep:
        if "game_id" in frame.columns:
            keep = ["game_id"]
            gone.discard("game_id")
        else:
            raise LabError(f"table '{table}' has no pregame columns to query")
    return frame.loc[:, keep].copy(), gone


def league_of(table: str) -> str | None:
    dataset = dataset_of(table)
    if dataset is None or not table.endswith("_" + dataset):
        return None
    league = table[: -(len(dataset) + 1)]
    if league in LEAGUES:
        return league
    return None


def dataset_of(table: str) -> str | None:
    for league in LEAGUES:
        prefix = league + "_"
        if table.startswith(prefix):
            dataset = table[len(prefix) :]
            if dataset in DATASETS:
                return dataset
    if table in DATASETS:
        return table
    return None


def asof_snapshot(dataset: str, games: pd.DataFrame | None, snaps: pd.DataFrame) -> pd.DataFrame:
    """Snapshot rows that are valid at each game's start. Raw rows are not returned.

    The window is half-open: `valid_from <= start` and `valid_to` null or
    `valid_to > start`. A `date` column is used when the table has no
    `valid_from`. Game-scoped snapshots (probables, lineups, weather) also
    have to name that game. Team snapshots have to name the home or away team.
    """
    extra = [column for column in snaps.columns if column not in {"game_id", "start_time"}]
    empty = pd.DataFrame(columns=["game_id", "start_time", *extra])
    if games is None or games.empty or "game_id" not in games.columns or "start_time" not in games.columns:
        return empty
    clock = "valid_from" if "valid_from" in snaps.columns else "date" if "date" in snaps.columns else None
    if clock is None or snaps.empty:
        return empty
    schedule = pd.DataFrame(
        {
            "game_id": games["game_id"].to_numpy(),
            "g_start": _naive_utc(games["start_time"]),
        }
    )
    if "home_team_id" in games.columns:
        schedule["home_team_id"] = games["home_team_id"].to_numpy()
    if "away_team_id" in games.columns:
        schedule["away_team_id"] = games["away_team_id"].to_numpy()
    rows = snaps.drop(columns=[column for column in ("start_time",) if column in snaps.columns]).copy()
    rows["_from"] = _naive_utc(rows[clock])
    rows["_to"] = _naive_utc(rows["valid_to"]) if "valid_to" in rows.columns else pd.NaT
    rows = rows[rows["_from"].notna()]
    if rows.empty:
        return empty
    game_scoped = "game_id" in GRAIN.get(dataset, ())
    if game_scoped and "game_id" in rows.columns:
        joined = rows.merge(schedule, on="game_id", how="inner")
        if "team_id" in joined.columns and "home_team_id" in joined.columns:
            home = joined["team_id"] == joined["home_team_id"]
            away = (
                joined["team_id"] == joined["away_team_id"]
                if "away_team_id" in joined.columns
                else False
            )
            joined = joined.loc[home | away]
    elif "team_id" in rows.columns and "home_team_id" in schedule.columns:
        if "game_id" in rows.columns:
            rows = rows.drop(columns=["game_id"])
        parts = [rows.merge(schedule, left_on="team_id", right_on="home_team_id", how="inner")]
        if "away_team_id" in schedule.columns:
            parts.append(rows.merge(schedule, left_on="team_id", right_on="away_team_id", how="inner"))
        joined = pd.concat(parts, ignore_index=True)
    else:
        if not game_scoped and "game_id" in rows.columns:
            rows = rows.drop(columns=["game_id"])
        joined = rows.merge(schedule, how="cross")
    if joined.empty:
        return empty
    start = joined["g_start"]
    active = joined["_from"].notna() & (joined["_from"] <= start) & (joined["_to"].isna() | (joined["_to"] > start))
    joined = joined.loc[active].copy()
    if joined.empty:
        return empty
    joined["start_time"] = joined["g_start"]
    keep = ["game_id", "start_time"]
    for column in snaps.columns:
        if column in {"game_id", "start_time"} or column not in joined.columns:
            continue
        keep.append(column)
    return joined.loc[:, keep].drop_duplicates().reset_index(drop=True)


def _naive_utc(series: pd.Series) -> pd.Series:
    converted = pd.to_datetime(series, utc=True, format="mixed", errors="coerce")
    return converted.dt.tz_convert("UTC").dt.tz_localize(None)


def referenced_columns(sql: str, names: Iterable[str]) -> set[str]:
    """Column names used outside of strings and comments."""
    masked = _mask_literals(sql).lower()
    found: set[str] = set()
    for name in names:
        if re.search(rf"\b{re.escape(name.lower())}\b", masked):
            found.add(name.lower())
    return found


def execute_select(
    con: duckdb.DuckDBPyConnection,
    sql: str,
    *,
    max_rows: int,
    timeout_s: float,
    overflow: str = "truncate",
) -> tuple[pd.DataFrame, bool]:
    """Run one SELECT with a row cap and a wall-clock timeout.

    `overflow='truncate'` returns the first `max_rows` and a truncated flag.
    `overflow='error'` raises when the result is longer than `max_rows`.
    The timeout calls `interrupt()` from the waiting thread.
    """
    if max_rows < 1:
        raise LabError("max_rows must be >= 1")
    if timeout_s <= 0:
        raise LabError("timeout must be > 0")
    if overflow not in {"truncate", "error"}:
        raise LabError("overflow must be truncate or error")
    text = validate_select(sql)
    limited = f"SELECT * FROM (\n{text}\n) AS _lab_query LIMIT {max_rows + 1}"
    box: dict[str, object] = {}

    def work() -> None:
        try:
            box["frame"] = con.execute(limited).fetchdf()
        except Exception as err:
            box["error"] = err

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    thread.join(timeout_s)
    if thread.is_alive():
        interrupt = getattr(con, "interrupt", None)
        if interrupt is not None:
            try:
                interrupt()
            except Exception:
                pass
        thread.join(5)
        raise LabError(f"query exceeded {timeout_s:g}s")
    if "error" in box:
        err = box["error"]
        raise LabError(f"query failed ({err.__class__.__name__})") from None
    frame = box.get("frame")
    if not isinstance(frame, pd.DataFrame):
        raise LabError("query failed (empty result)")
    frame.columns = [str(column).lower() for column in frame.columns]
    truncated = len(frame) > max_rows
    if truncated and overflow == "error":
        raise LabError(f"query returned more than {max_rows} rows")
    if truncated:
        frame = frame.iloc[:max_rows].copy()
    return frame, truncated


def _is_postgame(dataset: str | None, column: str) -> bool:
    lowered = column.lower()
    if dataset is None:
        return lowered in _ALWAYS_POSTGAME or lowered == "status"
    if lowered in _ALWAYS_POSTGAME:
        return True
    return column_timing(dataset, lowered) == "postgame"


def _mask_literals(sql: str) -> str:
    """Replace strings and comments with spaces so a word inside them is not a column."""
    out: list[str] = []
    i = 0
    in_single = False
    in_double = False
    in_line = False
    in_block = False
    dollar: str | None = None
    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""
        if in_line:
            out.append("\n" if ch == "\n" else " ")
            if ch == "\n":
                in_line = False
            i += 1
            continue
        if in_block:
            out.append("\n" if ch == "\n" else " ")
            if ch == "*" and nxt == "/":
                out.append(" ")
                i += 2
                in_block = False
                continue
            i += 1
            continue
        if dollar is not None:
            if sql.startswith(dollar, i):
                out.extend(" " for _ in dollar)
                i += len(dollar)
                dollar = None
                continue
            out.append("\n" if ch == "\n" else " ")
            i += 1
            continue
        if in_single:
            out.append(" ")
            if ch == "'" and nxt == "'":
                out.append(" ")
                i += 2
                continue
            if ch == "'":
                in_single = False
            i += 1
            continue
        if in_double:
            out.append(" ")
            if ch == '"' and nxt == '"':
                out.append(" ")
                i += 2
                continue
            if ch == '"':
                in_double = False
            i += 1
            continue
        if ch == "-" and nxt == "-":
            out.append(" ")
            out.append(" ")
            i += 2
            in_line = True
            continue
        if ch == "/" and nxt == "*":
            out.append(" ")
            out.append(" ")
            i += 2
            in_block = True
            continue
        if ch == "'":
            in_single = True
            out.append(" ")
            i += 1
            continue
        if ch == '"':
            in_double = True
            out.append(" ")
            i += 1
            continue
        if ch == "$":
            tag = _dollar_tag(sql, i)
            if tag is not None:
                dollar = tag
                out.extend(" " for _ in tag)
                i += len(tag)
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def _split_sql(sql: str) -> list[str]:
    parts: list[str] = []
    buf: list[str] = []
    i = 0
    in_single = False
    in_double = False
    in_line = False
    in_block = False
    dollar: str | None = None
    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""
        if in_line:
            buf.append(ch)
            if ch == "\n":
                in_line = False
            i += 1
            continue
        if in_block:
            buf.append(ch)
            if ch == "*" and nxt == "/":
                buf.append(nxt)
                i += 2
                in_block = False
                continue
            i += 1
            continue
        if dollar is not None:
            if sql.startswith(dollar, i):
                buf.append(dollar)
                i += len(dollar)
                dollar = None
                continue
            buf.append(ch)
            i += 1
            continue
        if in_single:
            buf.append(ch)
            if ch == "'" and nxt == "'":
                buf.append(nxt)
                i += 2
                continue
            if ch == "'":
                in_single = False
            i += 1
            continue
        if in_double:
            buf.append(ch)
            if ch == '"' and nxt == '"':
                buf.append(nxt)
                i += 2
                continue
            if ch == '"':
                in_double = False
            i += 1
            continue
        if ch == "-" and nxt == "-":
            buf.append(ch)
            buf.append(nxt)
            i += 2
            in_line = True
            continue
        if ch == "/" and nxt == "*":
            buf.append(ch)
            buf.append(nxt)
            i += 2
            in_block = True
            continue
        if ch == "'":
            in_single = True
            buf.append(ch)
            i += 1
            continue
        if ch == '"':
            in_double = True
            buf.append(ch)
            i += 1
            continue
        if ch == "$":
            tag = _dollar_tag(sql, i)
            if tag is not None:
                dollar = tag
                buf.append(tag)
                i += len(tag)
                continue
        if ch == ";":
            parts.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return parts


def _dollar_tag(sql: str, index: int) -> str | None:
    if not sql.startswith("$", index):
        return None
    end = sql.find("$", index + 1)
    if end < 0:
        return None
    tag = sql[index : end + 1]
    body = tag[1:-1]
    if body and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", body):
        return None
    return tag


def _strip_leading_comments(sql: str) -> str:
    text = sql.lstrip()
    while True:
        if text.startswith("--"):
            newline = text.find("\n")
            text = "" if newline < 0 else text[newline + 1 :].lstrip()
            continue
        if text.startswith("/*"):
            end = text.find("*/")
            if end < 0:
                return ""
            text = text[end + 2 :].lstrip()
            continue
        return text
