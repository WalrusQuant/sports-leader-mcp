"""build_dataset: a target, registry or SQL features, and a leakage audit.

The decision time is pregame. The dataset is saved only when the audit passes.
`team_points` is the home team's points on the game row.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Sequence
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

from sports_leader_lab import DISCLAIMER
from sports_leader_lab.audit import audit_dataset
from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.data.views import open_duckdb, register_views
from sports_leader_lab.errors import DataError, LabError
from sports_leader_lab.features.context import FeatureInputs, KnownAt
from sports_leader_lab.features.load import feature_inputs_from_views
from sports_leader_lab.features.registry import FeatureRegistry, FeatureSpec, build_features, default_registry
from sports_leader_lab.payload import jsonable
from sports_leader_lab.runs import new_id, save_dataset
from sports_leader_lab.sqlguard import feature_sql_problem, locked_connection, validate_select
from sports_leader_lab.store import RunStore

CT = ZoneInfo("America/Chicago")

TARGETS = {
    "home_win": "binary",
    "margin": "margin",
    "total": "count",
    "team_points": "count",
}

_ID_COLUMNS = (
    "game_id",
    "game_date",
    "season",
    "start_time",
    "home_team_id",
    "away_team_id",
    "home_team_abbr",
    "away_team_abbr",
    "home_team_name",
    "away_team_name",
    "neutral_site",
)

_OPTIONAL_DATASETS = ("team_game_stats", "injuries", "probables")


def build_dataset(
    league: str,
    target: str,
    seasons: Sequence[int],
    features: Sequence[str] | None = None,
    sql_features: Sequence[dict] | None = None,
    *,
    store: RunStore | None = None,
    cache: DataCache | None = None,
    inputs: FeatureInputs | None = None,
    con: Any | None = None,
    registry: FeatureRegistry | None = None,
) -> dict[str, Any]:
    """Build one game-grain dataset and save it when the leakage audit passes."""
    if target not in TARGETS:
        listed = ", ".join(TARGETS)
        raise LabError(f"unknown target '{target}'. Expected one of: {listed}")
    chosen_seasons = _seasons(seasons)
    destination = store if store is not None else RunStore.from_config()
    if inputs is None:
        inputs, con = _load(league, chosen_seasons, cache)
    elif con is None:
        con = _register_frames(inputs)
    registry = default_registry() if registry is None else registry
    sql_specs = _sql_specs(sql_features)
    _refuse_postgame_sql(con, sql_specs)
    for spec in sql_specs:
        registry.register(spec)
    names = _feature_names(features, sql_specs)
    built = build_features(inputs, registry=registry, names=names, con=con)
    labeled = built.frame.loc[built.frame["in_history"]].copy()
    if labeled.empty:
        raise LabError(f"no completed non-preseason games for {league} in {chosen_seasons}")
    values, target_warnings = _target_values(labeled, target)
    labeled = labeled.loc[values.notna()].copy()
    labeled["target"] = values.loc[labeled.index].to_numpy()
    if labeled.empty:
        raise LabError(f"target '{target}' has no rows after ties and unplayed games were dropped")
    feature_names = [name for name in built.feature_names if name in labeled.columns]
    report = audit_dataset(labeled, feature_names, "target", built.columns)
    if not report.ok:
        raise LabError("audit failed, dataset not saved: " + "; ".join(report.failures))
    kept, drop_warnings = _drop_empty(labeled, feature_names)
    if not kept:
        raise LabError("dataset has no usable features")
    id_columns = [column for column in _ID_COLUMNS if column in labeled.columns and column not in kept]
    saved = labeled[id_columns + ["target", *kept]].reset_index(drop=True)
    families = []
    columns = {}
    for name in kept:
        column_meta = built.columns[name]
        columns[name] = {
            "known_at": column_meta["known_at"],
            "family": column_meta["family"],
            "description": column_meta["description"],
        }
        if column_meta["family"] not in families:
            families.append(column_meta["family"])
    dataset_id = new_id("dataset")
    warnings = list(dict.fromkeys([*built.warnings, *target_warnings, *drop_warnings, *report.warnings]))
    meta: dict[str, Any] = {
        "dataset_id": dataset_id,
        "league": league,
        "target": target,
        "target_kind": TARGETS[target],
        "decision_time": "pregame",
        "seasons": chosen_seasons,
        "rows": int(len(saved)),
        "families": families,
        "feature_columns": kept,
        "columns": columns,
        "sql_features": [_sql_meta(spec) for spec in sql_specs],
        "audit": report.to_dict(),
        "warnings": warnings,
        "created_at": datetime.now(CT).isoformat(timespec="seconds"),
        "disclaimer": DISCLAIMER,
    }
    save_dataset(destination, dataset_id, saved, meta)
    return jsonable(
        {
            "dataset_id": dataset_id,
            "rows": int(len(saved)),
            "features": [
                {"name": name, "known_at": columns[name]["known_at"], "family": columns[name]["family"]}
                for name in kept
            ],
            "audit": report.to_dict(),
            "warnings": warnings,
            "target": target,
            "league": league,
            "seasons": chosen_seasons,
            "decision_time": "pregame",
            "disclaimer": DISCLAIMER,
        }
    )


def _load(league: str, seasons: list[int], cache: DataCache | None):
    source = cache if cache is not None else DataCache.from_config()
    con = open_duckdb()
    register_views(con, source, leagues=[league], datasets=["games"], seasons=seasons)
    for dataset in _OPTIONAL_DATASETS:
        try:
            register_views(con, source, leagues=[league], datasets=[dataset], seasons=seasons)
        except DataError:
            continue
    return feature_inputs_from_views(con, league, seasons=seasons), con


def _register_frames(inputs: FeatureInputs):
    con = open_duckdb()
    league = inputs.league
    con.register(f"{league}_games", inputs.games)
    if inputs.team_game_stats is not None:
        con.register(f"{league}_team_game_stats", inputs.team_game_stats)
    if inputs.injuries is not None:
        con.register(f"{league}_injuries", inputs.injuries)
    if inputs.probables is not None:
        con.register(f"{league}_probables", inputs.probables)
    for name, frame in inputs.extra.items():
        con.register(f"{league}_{name}", frame)
    return con


def _sql_specs(raw: Sequence[dict] | None) -> list[FeatureSpec]:
    specs = []
    for item in raw or []:
        if not isinstance(item, dict):
            raise LabError("sql_features entries must be objects")
        name = str(item.get("name") or "").strip()
        sql = str(item.get("sql") or "")
        columns = item.get("columns") or []
        known = str(item.get("known_at") or "")
        if not name or not sql or not columns:
            raise LabError("a SQL feature needs name, sql, and columns")
        try:
            known_at = KnownAt(known)
        except ValueError as err:
            raise LabError(
                f"SQL feature '{name}' known_at must be schedule, prior_games, or as_of_start"
            ) from err
        validate_select(sql)
        specs.append(
            FeatureSpec(
                name=name,
                description=str(item.get("description") or "custom SQL feature"),
                known_at=known_at,
                datasets=frozenset({"games"}),
                sql=sql,
                columns=tuple(str(column) for column in columns),
            )
        )
    return specs


def _refuse_postgame_sql(con: Any, specs: list[FeatureSpec]) -> None:
    if not specs:
        return
    _sandbox, dropped, raw_snapshots = locked_connection(con, drop_postgame=True)
    failures = []
    for spec in specs:
        problem = feature_sql_problem(spec.sql or "", dropped, raw_snapshots)
        if problem:
            failures.append(f"{spec.name} {problem}")
    if failures:
        raise LabError("audit failed, dataset not saved: " + "; ".join(failures))


def _feature_names(features: Sequence[str] | None, sql_specs: list[FeatureSpec]) -> list[str] | None:
    # None asks the registry for every family, including SQL features registered above.
    if features is None:
        return None
    names = list(features)
    for spec in sql_specs:
        if spec.name not in names:
            names.append(spec.name)
    return names


def _target_values(frame: pd.DataFrame, target: str) -> tuple[pd.Series, list[str]]:
    home = pd.to_numeric(frame["home_score"], errors="coerce")
    away = pd.to_numeric(frame["away_score"], errors="coerce")
    warnings: list[str] = []
    if target == "home_win":
        ties = home.notna() & away.notna() & (home == away)
        if int(ties.sum()):
            warnings.append(f"{int(ties.sum())} tied games were dropped from home_win")
        values = pd.Series(pd.NA, index=frame.index, dtype="Float64")
        decided = home.notna() & away.notna() & ~ties
        values.loc[decided] = (home.loc[decided] > away.loc[decided]).astype(float)
        return values, warnings
    if target == "margin":
        return home - away, warnings
    if target == "total":
        return home + away, warnings
    if target == "team_points":
        warnings.append("team_points is the home team's points")
        return home, warnings
    raise LabError(f"unknown target '{target}'")


def _drop_empty(frame: pd.DataFrame, names: list[str]) -> tuple[list[str], list[str]]:
    kept = []
    warnings = []
    for name in names:
        series = pd.to_numeric(frame[name], errors="coerce")
        if int(series.notna().sum()) == 0:
            warnings.append(f"{name} is all null and was dropped")
            continue
        kept.append(name)
    return kept, warnings


def _sql_meta(spec: FeatureSpec) -> dict[str, Any]:
    return {
        "name": spec.name,
        "sql": spec.sql,
        "columns": list(spec.columns),
        "known_at": spec.known_at.value,
        "description": spec.description,
    }


def _seasons(seasons: Sequence[int]) -> list[int]:
    if seasons is None or len(list(seasons)) == 0:
        raise LabError("seasons must list at least one season")
    chosen = []
    for season in seasons:
        if isinstance(season, bool) or not isinstance(season, (int, np.integer)):
            raise LabError("seasons must be integers")
        chosen.append(int(season))
    return chosen
