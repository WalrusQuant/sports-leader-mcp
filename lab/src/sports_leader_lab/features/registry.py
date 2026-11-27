"""Feature registry. Families are Python builders or a single SELECT."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Sequence

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
from sports_leader_lab.sqlguard import (
    FEATURE_SQL_MAX_ROWS,
    FEATURE_SQL_TIMEOUT_S,
    execute_select,
    feature_sql_problem,
    locked_connection,
    validate_select,
)

_NAME = re.compile(r"^[a-z][a-z0-9_]*$")

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
            validate_select(spec.sql)
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

    def list_features(self, league: str) -> list[dict[str, Any]]:
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
                "At each new season, ratings move one third of the way back to 1500 "
                "(elo_season_regress, 0 disables it). The earliest loaded season is a cold "
                "start: ratings change if that season is left out. Preseason results are ignored."
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
    elo_season_regress: float = 1.0 / 3.0,
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
        elo_season_regress=elo_season_regress,
        con=con,
    )
    if bool(games["start_time_missing"].any()):
        warnings.append(
            "a null start_time sorts after other games that day and is treated as the end of that date"
        )
    specs = _select(source, inputs.league, names)
    postgame = tuple(column for column in POSTGAME_COLUMNS if column in games.columns)
    identity = [
        column
        for column in (
            "home_team_abbr",
            "away_team_abbr",
            "home_team_name",
            "away_team_name",
            "in_history",
            "start_time_missing",
        )
        if column in games.columns
    ]
    base_columns = ["game_id", "game_date", "start_time", "season", "home_team_id", "away_team_id", *identity, *postgame]
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
    sql = validate_select(spec.sql or "")
    sandbox, dropped, raw_snapshots = locked_connection(ctx.con, drop_postgame=True)
    problem = feature_sql_problem(sql, dropped, raw_snapshots)
    if problem:
        raise LabError(f"SQL feature '{spec.name}' {problem}")
    try:
        frame, _truncated = execute_select(
            sandbox,
            sql,
            max_rows=FEATURE_SQL_MAX_ROWS,
            timeout_s=FEATURE_SQL_TIMEOUT_S,
            overflow="error",
        )
    except LabError as err:
        raise LabError(f"SQL feature '{spec.name}' failed ({err})") from None
    expected = spec.output_columns(ctx.league)
    missing = [column for column in ("game_id", *expected) if column not in frame.columns]
    if missing:
        raise LabError(f"feature '{spec.name}' SQL is missing {', '.join(missing)}")
    return frame[["game_id", *expected]]

