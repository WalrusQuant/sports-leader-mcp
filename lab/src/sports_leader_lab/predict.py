"""Predict a saved run for games that have not started, as of a clock in US Central.

The lab does not fetch odds. Pass `market_prices` (or, from Python, a
`market_source` callback) to show a current price beside the estimate. That
price is read at call time and is not written to the run store. There is no
odds history and no Kalshi path.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Sequence
from zoneinfo import ZoneInfo

import pandas as pd

from scipy.stats import norm

from sports_leader_lab import DISCLAIMER
from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.data.views import open_duckdb, register_views
from sports_leader_lab.datasets import _register_frames, _sql_specs
from sports_leader_lab.errors import DataError, LabError
from sports_leader_lab.features.load import feature_inputs_from_views
from sports_leader_lab.features.registry import build_features, default_registry
from sports_leader_lab.payload import jsonable
from sports_leader_lab.runs import load_run
from sports_leader_lab.store import RunStore
from sports_leader_lab.training import _predict, design_matrix

CT = ZoneInfo("America/Chicago")
PREGAME = frozenset({"schedule", "prior_games", "as_of_start"})
_OPTIONAL = ("team_game_stats", "injuries", "probables")

MarketSource = Callable[[Sequence[str]], Sequence[dict]]


def predict(
    run_id: str,
    game_date: str | None = None,
    game_ids: Sequence[str] | None = None,
    market_prices: Sequence[dict] | None = None,
    *,
    market_source: MarketSource | None = None,
    as_of: datetime | None = None,
    store: RunStore | None = None,
    cache: DataCache | None = None,
    inputs=None,
    con: object | None = None,
) -> dict[str, Any]:
    """Score games from a saved run. Refuses when a feature is not known before start."""
    destination = store if store is not None else RunStore.from_config()
    bundle, meta = load_run(destination, run_id)
    _require_pregame(meta)
    if inputs is None:
        inputs, con = _load_history(meta, cache)
    elif meta.get("sql_features") and con is None:
        con = _register_frames(inputs)
    registry = default_registry()
    for spec in _sql_specs(meta.get("sql_features")):
        registry.register(spec)
    built = build_features(
        inputs,
        registry=registry,
        names=list(meta["families"]) if meta.get("families") else None,
        con=con,
    )
    chosen = _select_games(built.frame, game_date=game_date, game_ids=game_ids)
    if chosen["start_time"].isna().any() or (
        "start_time_missing" in chosen.columns and chosen["start_time_missing"].fillna(False).astype(bool).any()
    ):
        raise LabError(
            "refusing to predict: a game has no start_time, so a feature cannot be shown to be known before the start"
        )
    missing = [name for name in bundle["features"] if name not in chosen.columns]
    if missing:
        raise LabError("refusing to predict: missing features " + ", ".join(missing))
    clock = _clock(as_of)
    markets = _markets(chosen["game_id"].astype(str).tolist(), market_prices, market_source)
    matrix = design_matrix(chosen, bundle)
    estimates = _predict(bundle["estimator"], matrix, kind=bundle["kind"])
    warnings = list(built.warnings)
    trained = {int(season) for season in meta.get("seasons") or []}
    if trained and int(chosen["season"].max()) > max(trained):
        warnings.append(
            f"prediction season {int(chosen['season'].max())} is after the training window "
            f"through {max(trained)}"
        )
    games = []
    for index, (row, estimate) in enumerate(zip(chosen.itertuples(index=False), estimates, strict=True)):
        game_id = str(row.game_id)
        nulls = [
            name
            for name in bundle["features"]
            if pd.isna(chosen.iloc[index][name])
        ]
        if nulls:
            warnings.append(f"game {game_id} is missing {', '.join(nulls)}; the saved impute was applied")
        completed = bool(getattr(row, "completed", False))
        if completed:
            warnings.append(f"game {game_id} is already completed; this is a research replay")
        item = {
            "game_id": game_id,
            "season": int(row.season),
            "game_date": pd.Timestamp(row.game_date).date().isoformat(),
            "home_team_abbr": _text(row, "home_team_abbr"),
            "away_team_abbr": _text(row, "away_team_abbr"),
            "home_team_name": _text(row, "home_team_name"),
            "away_team_name": _text(row, "away_team_name"),
            "start_time_ct": _as_ct(row.start_time),
            "estimate": float(estimate),
            "estimate_kind": _kind(meta["target"]),
            "implied_home_win_prob": _implied(estimate, bundle, meta),
            "market": markets.get(game_id),
            "completed": completed,
            "model_version": run_id,
        }
        games.append(item)
    note = (
        "Current prices were passed in for this call and were not stored."
        if markets
        else "No current price was passed in. The lab does not fetch or store odds."
    )
    return jsonable(
        {
            "run_id": run_id,
            "model": meta["model"],
            "model_version": run_id,
            "as_of": clock.isoformat(timespec="seconds"),
            "as_of_timezone": "America/Chicago",
            "data_through": _data_through(built.frame),
            "games": games,
            "warnings": list(dict.fromkeys(warnings)),
            "market_note": note,
            "disclaimer": DISCLAIMER,
        }
    )


def _require_pregame(meta: dict) -> None:
    known = meta.get("known_at") or {}
    features = meta.get("feature_columns") or []
    for name in features:
        timing = known.get(name)
        if timing not in PREGAME:
            raise LabError(
                f"refusing to predict: feature '{name}' is not known before start time ({timing})"
            )


def _load_history(meta: dict, cache: DataCache | None):
    source = cache if cache is not None else DataCache.from_config()
    league = meta["league"]
    manifest = source.load_manifest()
    published = sorted(
        entry.season
        for entry in manifest.files
        if entry.league == league and entry.dataset == "games"
    )
    if not published:
        raise DataError(f"no files for {league} games")
    start = min(int(season) for season in meta.get("seasons") or published)
    seasons = [season for season in published if season >= start]
    con = open_duckdb()
    register_views(con, source, leagues=[league], datasets=["games"], seasons=seasons)
    for dataset in _OPTIONAL:
        try:
            register_views(con, source, leagues=[league], datasets=[dataset], seasons=seasons)
        except DataError:
            continue
    return feature_inputs_from_views(con, league, seasons=seasons), con


def _select_games(frame: pd.DataFrame, *, game_date: str | None, game_ids: Sequence[str] | None) -> pd.DataFrame:
    if game_ids:
        wanted = {str(game_id) for game_id in game_ids}
        chosen = frame.loc[frame["game_id"].astype(str).isin(wanted)].copy()
    elif game_date:
        dates = pd.to_datetime(frame["game_date"]).dt.date
        chosen = frame.loc[dates == pd.Timestamp(game_date).date()].copy()
    else:
        raise LabError("pass game_date or game_ids")
    if chosen.empty:
        raise LabError("no games matched")
    return chosen.reset_index(drop=True)


def _markets(game_ids: Sequence[str], prices: Sequence[dict] | None, source: MarketSource | None) -> dict:
    rows = list(prices or [])
    if source is not None and not rows:
        rows = list(source(list(game_ids)))
    found = {}
    for row in rows:
        if not isinstance(row, dict) or "game_id" not in row or "home_implied_prob" not in row:
            raise LabError("market price needs game_id and home_implied_prob")
        probability = float(row["home_implied_prob"])
        if not 0.0 <= probability <= 1.0:
            raise LabError("home_implied_prob must be between 0 and 1")
        found[str(row["game_id"])] = {
            "home_implied_prob": probability,
            "source": str(row.get("source") or "caller"),
        }
    return found


def _clock(as_of: datetime | None) -> datetime:
    if as_of is None:
        return datetime.now(CT)
    if as_of.tzinfo is None:
        return as_of.replace(tzinfo=CT)
    return as_of.astimezone(CT)


def _as_ct(value) -> str:
    parsed = pd.to_datetime(value, utc=True)
    return parsed.tz_convert(CT).isoformat(timespec="seconds")


def _data_through(frame: pd.DataFrame) -> str | None:
    if "in_history" in frame.columns:
        history = frame.loc[frame["in_history"]]
    else:
        history = frame
    if history.empty:
        return None
    return pd.Timestamp(history["game_date"].max()).date().isoformat()


def _implied(estimate: float, bundle: dict, meta: dict) -> float | None:
    if meta.get("target") != "margin":
        return None
    scale = bundle.get("residual_sd")
    if not scale:
        return None
    return float(norm.cdf(float(estimate) / float(scale)))


def _kind(target: str) -> str:
    if target == "home_win":
        return "home_win_probability"
    return target


def _text(row, name: str):
    if not hasattr(row, name):
        return None
    value = getattr(row, name)
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    return str(value)
