"""Feature registry. Families are Python builders or a single SELECT."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, Sequence

import pandas as pd

from sports_leader_lab.errors import LabError
from sports_leader_lab.features.context import FeatureContext, FeatureInputs, KnownAt
from sports_leader_lab.features.elo import ELO_COLUMNS, ELO_HOME_ADV, ELO_INITIAL, ELO_K, build_elo
from sports_leader_lab.features.form import build_form, form_columns
from sports_leader_lab.features.prepare import prepare_games
from sports_leader_lab.features.schedule import REST_COLUMNS, SITE_COLUMNS, build_rest, build_site
from sports_leader_lab.features.snapshots import (
    INJURY_COLUMNS,
    PROBABLE_COLUMNS,
    build_injuries,
    build_probables,
)

_NAME = re.compile(r"^[a-z][a-z0-9_]*$")
_SELECT = re.compile(r"^(select|with)\b", re.IGNORECASE)

# On the frame so build_dataset can filter and join. Not model features.
# season_type is known from the schedule; it is listed here so it is not trained on.
POSTGAME_COLUMNS = ("status", "completed", "season_type", "home_score", "away_score")

Builder = Callable[[FeatureContext], pd.DataFrame]
ColumnsFor = Callable[[str], tuple[str, ...]]


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    description: str
    known_at: KnownAt
    datasets: frozenset[str]
    leagues: frozenset[str] = field(default_factory=frozenset)
    builder: Builder | None = None
    sql: str | None = None
    columns: tuple[str, ...] = ()
    columns_for: ColumnsFor | None = None

    def output_columns(self, league: str) -> tuple[str, ...]:
        if self.columns_for is not None:
            return self.columns_for(league)
        return self.columns

    def applies_to(self, league: str) -> bool:
        return not self.leagues or league in self.leagues


@dataclass
class BuiltFeatures:
    """One row per game.

    `columns` are the model features (`feature_names`). `postgame` columns
    are also on `frame` and are not features. `home_score` and `away_score`
    are the target. `status` and `completed` drop postponed, cancelled, and
    unplayed rows. `season_type` drops preseason. A later `build_dataset`
    should train on `feature_names` only.
    """

    frame: pd.DataFrame
    columns: dict[str, dict[str, str]]
    warnings: list[str]
    postgame: tuple[str, ...] = ()

    @property
    def feature_names(self) -> list[str]:
        return list(self.columns)


class FeatureRegistry:
    def __init__(self) -> None:
        self._specs: list[FeatureSpec] = []

    def register(self, spec: FeatureSpec) -> None:
        if not _NAME.match(spec.name):
            raise LabError(f"illegal feature name '{spec.name}'")
        if any(existing.name == spec.name for existing in self._specs):
            raise LabError(f"feature '{spec.name}' is already registered")
        if (spec.builder is None) == (spec.sql is None):
            raise LabError(f"feature '{spec.name}' needs a Python builder or SQL, not both")
        if spec.sql is not None:
            _validate_select(spec.sql)
            if not spec.columns and spec.columns_for is None:
                raise LabError(f"SQL feature '{spec.name}' must declare its columns")
        if not isinstance(spec.known_at, KnownAt):
            raise LabError(f"feature '{spec.name}' needs a known_at value")
        self._specs.append(spec)

    def for_league(self, league: str) -> list[FeatureSpec]:
        return [spec for spec in self._specs if spec.applies_to(league)]

    def get(self, name: str) -> FeatureSpec:
        for spec in self._specs:
            if spec.name == name:
                return spec
        raise LabError(f"unknown feature '{name}'")

    def list_features(self, league: str) -> list[dict[str, object]]:
        rows = []
        for spec in self.for_league(league):
            rows.append(
                {
                    "name": spec.name,
                    "league": league,
                    "description": spec.description,
                    "known_at": spec.known_at.value,
                    "datasets": sorted(spec.datasets),
                    "columns": list(spec.output_columns(league)),
                    "builder": "sql" if spec.sql is not None else "python",
                }
            )
        return rows


def default_registry() -> FeatureRegistry:
    registry = FeatureRegistry()
    registry.register(
        FeatureSpec(
            name="team_form",
            description=(
                "Rolling and EWMA team form shifted one game: points for and against, "
                "point differential, win rate, and one league rate. The current game is excluded."
            ),
            known_at=KnownAt.PRIOR_GAMES,
            datasets=frozenset({"games", "team_game_stats"}),
            builder=build_form,
            columns_for=form_columns,
        )
    )
    registry.register(
        FeatureSpec(
            name="rest",
            description=(
                "Days since the previous played game, a venue-name change, and consecutive away games. "
                "Postponed, cancelled, and suspended-without-play games are not the previous game. "
                "The first game, and any gap longer than 21 days, is null."
            ),
            known_at=KnownAt.SCHEDULE,
            datasets=frozenset({"games"}),
            builder=build_rest,
            columns=REST_COLUMNS,
        )
    )
    registry.register(
        FeatureSpec(
            name="site",
            description="Neutral site and designated home field, from the schedule.",
            known_at=KnownAt.SCHEDULE,
            datasets=frozenset({"games"}),
            builder=build_site,
            columns=SITE_COLUMNS,
        )
    )
    registry.register(
        FeatureSpec(
            name="elo",
            description=(
                "Elo ratings entering the game. Each team's rating starts at 1500 for the "
                "first loaded game and updates only after a completed non-preseason game. "
                "Preseason results are ignored. Load every season the rating should see."
            ),
            known_at=KnownAt.PRIOR_GAMES,
            datasets=frozenset({"games"}),
            builder=build_elo,
            columns=ELO_COLUMNS,
        )
    )
    registry.register(
        FeatureSpec(
            name="probables",
            description=(
                "Distinct probable pitchers for this game whose valid_from/valid_to window "
                "covers the start time. A row published after start is excluded."
            ),
            known_at=KnownAt.AS_OF_START,
            datasets=frozenset({"probables", "games"}),
            leagues=frozenset({"mlb"}),
            builder=build_probables,
            columns=PROBABLE_COLUMNS,
        )
    )
    registry.register(
        FeatureSpec(
            name="injuries",
            description=(
                "Distinct injured players on each team whose valid_from/valid_to window "
                "covers the start time. Seasons the injury file does not cover are null, not zero."
            ),
            known_at=KnownAt.AS_OF_START,
            datasets=frozenset({"injuries", "games"}),
            builder=build_injuries,
            columns=INJURY_COLUMNS,
        )
    )
    return registry


def build_features(
    inputs: FeatureInputs,
    *,
    registry: FeatureRegistry | None = None,
    names: Sequence[str] | None = None,
    rolling_window: int = 10,
    ewma_span: int = 10,
    elo_k: float = ELO_K,
    elo_home_adv: float = ELO_HOME_ADV,
    elo_initial: float = ELO_INITIAL,
    con: object | None = None,
) -> BuiltFeatures:
    """One row per game. Feature columns exclude the game's own result."""
    source = registry if registry is not None else default_registry()
    games = prepare_games(inputs.games)
    warnings: list[str] = []
    ctx = FeatureContext(
        inputs=inputs,
        games=games,
        warnings=warnings,
        rolling_window=rolling_window,
        ewma_span=ewma_span,
        elo_k=elo_k,
        elo_home_adv=elo_home_adv,
        elo_initial=elo_initial,
        con=con,
    )
    if bool(games["start_time_missing"].any()):
        warnings.append(
            "a null start_time sorts after other games that day and is treated as the end of that date"
        )
    specs = _select(source, inputs.league, names)
    postgame = tuple(column for column in POSTGAME_COLUMNS if column in games.columns)
    base_columns = ["game_id", "game_date", "start_time", "season", "home_team_id", "away_team_id", *postgame]
    base = games[base_columns].copy()
    meta: dict[str, dict[str, str]] = {}
    frame = base
    for spec in specs:
        part = _run_spec(spec, ctx)
        expected = spec.output_columns(inputs.league)
        for column in expected:
            if column not in part.columns:
                part[column] = float("nan")
        keep = ["game_id", *list(part.columns.drop("game_id", errors="ignore"))]
        part = part.loc[:, keep].drop_duplicates("game_id")
        part = part.set_index("game_id").reindex(frame["game_id"]).reset_index()
        overlap = (set(part.columns) & set(frame.columns)) - {"game_id"}
        if overlap:
            listed = ", ".join(sorted(overlap))
            raise LabError(f"feature '{spec.name}' repeats columns {listed}")
        for column in part.columns:
            if column == "game_id":
                continue
            meta[column] = {
                "family": spec.name,
                "known_at": spec.known_at.value,
                "description": spec.description,
            }
        frame = frame.merge(part, on="game_id", how="left", validate="one_to_one")
    return BuiltFeatures(
        frame=frame,
        columns=meta,
        warnings=list(dict.fromkeys(warnings)),
        postgame=postgame,
    )


def _select(registry: FeatureRegistry, league: str, names: Sequence[str] | None) -> list[FeatureSpec]:
    if names is None:
        return registry.for_league(league)
    chosen = []
    for name in names:
        spec = registry.get(name)
        if not spec.applies_to(league):
            raise LabError(f"feature '{name}' is not available for {league}")
        chosen.append(spec)
    return chosen


def _run_spec(spec: FeatureSpec, ctx: FeatureContext) -> pd.DataFrame:
    if spec.sql is not None:
        return _run_sql(spec, ctx)
    assert spec.builder is not None
    part = spec.builder(ctx)
    if "game_id" not in part.columns:
        raise LabError(f"feature '{spec.name}' did not return game_id")
    return part


def _run_sql(spec: FeatureSpec, ctx: FeatureContext) -> pd.DataFrame:
    if ctx.con is None:
        raise LabError(f"feature '{spec.name}' is SQL and needs a DuckDB connection")
    sql = _validate_select(spec.sql or "")
    sandbox = _locked_sql_connection(ctx.con)
    try:
        frame = sandbox.execute(sql).fetchdf()
    except Exception as err:
        raise LabError(f"SQL feature '{spec.name}' failed ({err.__class__.__name__})") from None
    frame.columns = [str(column).lower() for column in frame.columns]
    expected = spec.output_columns(ctx.league)
    missing = [column for column in ("game_id", *expected) if column not in frame.columns]
    if missing:
        raise LabError(f"feature '{spec.name}' SQL is missing {', '.join(missing)}")
    return frame[["game_id", *expected]]


def _locked_sql_connection(con: object):
    """Copy the caller's tables into a connection that cannot read the filesystem.

    Views over local Parquet stay on the caller's connection, because turning
    `enable_external_access` off there would stop those views from reading.
    SQL features run here instead. `lock_configuration` blocks a statement
    from turning external access back on.
    """
    import duckdb

    sandbox = duckdb.connect(database=":memory:")
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
        frame = con.execute(f"SELECT * FROM {name}").fetchdf()
        sandbox.register(name, frame)
    sandbox.execute("SET enable_external_access = false")
    sandbox.execute("SET lock_configuration = true")
    return sandbox


def _validate_select(sql: str) -> str:
    """One SELECT or WITH. A semicolon inside a string or comment is allowed."""
    statements = [part for part in _split_sql(sql) if part.strip()]
    if len(statements) != 1:
        raise LabError("SQL feature must be a single SELECT")
    text = _strip_leading_comments(statements[0]).strip()
    if not _SELECT.match(text):
        raise LabError("SQL feature must be a SELECT")
    return text


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
