"""Leak fixtures fail the shared audit, and a run can be listed from its record."""

import json

import numpy as np
import pandas as pd
import pytest

from sports_leader_lab import DISCLAIMER, __version__
from sports_leader_lab.datasets import audit_features, build_dataset
from sports_leader_lab.errors import LabError
from sports_leader_lab.features.context import FeatureInputs, KnownAt
from sports_leader_lab.features.registry import FeatureSpec, default_registry
from sports_leader_lab.registry import compare_runs, list_runs, model_card
from sports_leader_lab.runs import save_dataset
from sports_leader_lab.sqlguard import feature_sql_problem
from sports_leader_lab.store import RunStore
from sports_leader_lab.training import train_classifier


def test_quoted_identifiers_are_table_names():
    dropped = {"home_score", "total_yards"}
    raw = {"nfl_injuries"}
    quoted = feature_sql_problem('SELECT game_id FROM "nfl_injuries"', dropped, raw)
    qualified = feature_sql_problem('SELECT game_id FROM "main"."nfl_injuries"', dropped, raw)
    literal = feature_sql_problem("SELECT game_id, 'nfl_injuries' AS label FROM nfl_games", dropped, raw)
    score = feature_sql_problem('SELECT game_id, "home_score" AS leaked FROM nfl_games', dropped, raw)
    yards = feature_sql_problem(
        'SELECT game_id, "total_yards" AS yards FROM nfl_team_game_stats', dropped, raw
    )
    assert quoted is not None and "raw snapshot" in quoted
    assert qualified is not None and "nfl_injuries" in qualified
    assert literal is None
    assert score is not None and "postgame" in score
    assert yards is not None and "box stat" in yards


def test_quoted_snapshot_sql_fails_the_audit_and_is_not_saved(tmp_path):
    store = RunStore(tmp_path)
    inputs = FeatureInputs(league="nfl", games=_games(2), injuries=_injuries())
    for sql in (
        'SELECT game_id, COUNT(*) AS n FROM "nfl_injuries" GROUP BY game_id',
        'SELECT game_id, COUNT(*) AS n FROM "main"."nfl_injuries" GROUP BY game_id',
    ):
        spec = {
            "name": "quoted",
            "sql": sql,
            "columns": ["n"],
            "known_at": "as_of_start",
        }
        report = audit_features(
            "nfl",
            "home_win",
            [2023],
            features=[],
            sql_features=[spec],
            inputs=inputs,
        )
        assert report["ok"] is False
        assert report["verdict"] == "NOT CLEAN"
        assert report["saved"] is False
        assert any("raw snapshot" in item for item in report["failures"])
        assert "not a recommendation to bet" in report["disclaimer"].lower()
        with pytest.raises(LabError, match="raw snapshot"):
            build_dataset(
                "nfl",
                "home_win",
                [2023],
                features=[],
                sql_features=[spec],
                inputs=inputs,
                store=store,
            )
    assert list(tmp_path.rglob("*.parquet")) == []


def test_synthetic_leaks_fail_and_a_high_auc_feature_warns(tmp_path):
    games = _games(24)
    inputs = FeatureInputs(league="nfl", games=games, team_game_stats=_yards(games))
    leaks = (
        ("copied", _copy_target, "home_win", "copies the target"),
        ("score", _copy_score, "margin", "copies home_score"),
        ("clock", _after_start, "home_win", "after start_time"),
        ("yards", _copy_yards, "home_win", "same-game box stat"),
    )
    for name, builder, target, expected in leaks:
        registry = default_registry()
        registry.register(
            FeatureSpec(
                name=name,
                description="leak",
                known_at=KnownAt.PRIOR_GAMES,
                datasets=frozenset({"games"}),
                builder=builder,
                columns=(name,),
            )
        )
        report = audit_features(
            "nfl",
            target,
            [2023],
            features=[name],
            inputs=inputs,
            registry=registry,
        )
        assert report["ok"] is False, name
        assert report["verdict"] == "NOT CLEAN"
        assert any(expected in item for item in report["failures"]), report["failures"]
        store = RunStore(tmp_path / name)
        with pytest.raises(LabError, match="audit failed"):
            build_dataset(
                "nfl",
                target,
                [2023],
                features=[name],
                inputs=inputs,
                store=store,
                registry=registry,
            )
        assert list((tmp_path / name).rglob("*.parquet")) == []

    almost = (games["home_score"] > games["away_score"]).astype(float).to_numpy().copy()
    almost[0] = 1.0 - almost[0]

    def nearly(ctx, values=almost):
        return pd.DataFrame({"game_id": ctx.games["game_id"].to_numpy(), "almost": values})

    registry = default_registry()
    registry.register(
        FeatureSpec(
            name="almost",
            description="nearly the target",
            known_at=KnownAt.PRIOR_GAMES,
            datasets=frozenset({"games"}),
            builder=nearly,
            columns=("almost",),
        )
    )
    warned = audit_features(
        "nfl", "home_win", [2023], features=["almost"], inputs=inputs, registry=registry
    )
    assert warned["ok"] is True
    assert warned["verdict"] == "REVIEW REQUIRED"
    assert any("AUC" in warning for warning in warned["warnings"])

    wide_games = _games(64)
    wide = FeatureInputs(league="nfl", games=wide_games, team_game_stats=_yards(wide_games))
    one_nan = _audit_builder(wide, "one_nan", _one_nan_score, "margin")
    assert one_nan["ok"] is False
    assert any("copies home_score" in item for item in one_nan["failures"]), one_nan["failures"]

    half_null = _audit_builder(wide, "half_null", _half_null_score, "margin")
    assert half_null["ok"] is False
    assert half_null["verdict"] == "NOT CLEAN"
    assert any("copies home_score" in item for item in half_null["failures"]), half_null["failures"]
    with pytest.raises(LabError, match="audit failed"):
        build_dataset(
            "nfl",
            "margin",
            [2023],
            features=["half_null"],
            inputs=wide,
            store=RunStore(tmp_path / "half_null"),
            registry=_registry("half_null", _half_null_score),
        )
    assert list((tmp_path / "half_null").rglob("*.parquet")) == []

    scaled = _audit_builder(inputs, "scaled", _scaled_margin, "margin")
    assert scaled["ok"] is False
    assert any("affine copy of the score margin" in item for item in scaled["failures"]), scaled["failures"]

    flipped = _audit_builder(inputs, "flipped", _flipped_margin, "margin")
    assert flipped["ok"] is False
    assert any("affine copy of the score margin" in item for item in flipped["failures"]), flipped["failures"]

    clean = audit_features("nfl", "home_win", [2023], features=["site", "elo"], inputs=inputs)
    assert clean["ok"] is True
    assert clean["verdict"] == "REVIEW REQUIRED"
    assert clean["failures"] == []
    assert clean["disclaimer"] == DISCLAIMER


def test_run_record_lists_compares_and_writes_a_model_card(tmp_path):
    store = RunStore(tmp_path)
    dataset_id = _save(store)
    logistic = train_classifier(dataset_id, model="logistic", min_train_seasons=1, store=store)
    boosted = train_classifier(dataset_id, model="lightgbm", min_train_seasons=1, store=store)
    listed = list_runs("nfl", limit=1, store=store)
    assert listed["runs"][0]["run_id"] == boosted["run_id"]
    logistic_meta = json.loads((tmp_path / "models" / logistic["run_id"] / "meta.json").read_text(encoding="utf-8"))
    boosted_meta = json.loads((tmp_path / "models" / boosted["run_id"] / "meta.json").read_text(encoding="utf-8"))
    assert "." in logistic_meta["created_at"]
    assert boosted_meta["sequence"] == logistic_meta["sequence"] + 1
    assert listed["disclaimer"] == DISCLAIMER
    with pytest.raises(LabError, match="unknown league"):
        list_runs("zzz", store=store)
    with pytest.raises(LabError, match="illegal"):
        compare_runs(["../../../x", logistic["run_id"]], store=store)
    with pytest.raises(LabError, match="at least two"):
        compare_runs([logistic["run_id"]], store=store)

    compared = compare_runs([logistic["run_id"], boosted["run_id"]], store=store)
    assert compared["comparable"] is True
    assert {row["run_id"] for row in compared["runs"]} == {logistic["run_id"], boosted["run_id"]}
    assert compared["runs"][0]["primary_metric"] == "log_loss"
    assert compared["disclaimer"] == DISCLAIMER

    run_dir = tmp_path / "models" / logistic["run_id"]
    folds = json.loads((run_dir / "folds.json").read_text(encoding="utf-8"))
    assert folds["schema"] == "sports-analytic-skills/validation-design"
    row = folds["folds"][0]
    for key in (
        "fold",
        "train_seasons",
        "n_train",
        "n_test",
        "train_period",
        "test_period",
        "train_n",
        "test_n",
        "baseline_primary",
        "candidate_primary",
        "gap",
        "secondary_metrics",
        "exclusions",
        "failures",
    ):
        assert key in row
    predictions = pd.read_csv(run_dir / "predictions.csv")
    for column in ("fold", "game_id", "season", "y", "prediction", "baseline_elo"):
        assert column in predictions.columns
    meta = json.loads((run_dir / "meta.json").read_text(encoding="utf-8"))
    repro = meta["reproducibility"]
    assert repro["lab_version"] == __version__ == "0.1.0.dev0"
    assert repro["families"] == ["synthetic"]
    assert repro["features"] == ["noise"]
    assert repro["params"]["model"] == "logistic"
    assert repro["split"]["scheme"] == "season"
    assert repro["seeds"]["lightgbm_random_state"] == 0
    assert repro["data_manifest"] == []
    assert len(meta["checksums"]["predictions.csv"]) == 64
    assert len(meta["checksums"]["predictions.parquet"]) == 64

    card = model_card(logistic["run_id"], store=store)
    for heading in (
        "## 1. Identity",
        "## 2. Intended use",
        "## 3. Target and timing",
        "## 4. Data",
        "## 5. Features",
        "## 6. Baselines",
        "## 7. Validation",
        "## 8. Results",
        "## 9. Limits and failure modes",
        "## 10. Maintenance",
        "## 11. Artifact manifest and reproduction",
        "## 12. Approval history and linked experiments",
    ):
        assert heading in card["markdown"]
    assert card["markdown"] == (run_dir / "model_card.md").read_text(encoding="utf-8")
    assert "not a recommendation to bet" in card["markdown"].lower()
    assert card["card"]["analysis_type"] == "predictive"
    assert card["card"]["validation"]["metric_direction"] == "lower"
    assert card["card"]["validation"]["comparison_population"] == "identical held-out game rows"
    assert card["card"]["data"]["n"] > 0
    assert card["card"]["reproduction"]["command"]["tool"] == "train_classifier"
    assert card["disclaimer"] == DISCLAIMER
    assert (run_dir / "model_card.md").is_file()


def test_clean_schedule_features_do_not_copy_constant_box_flags():
    """home_consecutive_away is 0 on every played home row. Away is_home is 0 too."""
    games, stats = _round_robin(48)
    inputs = FeatureInputs(league="nfl", games=games, team_game_stats=stats)
    report = audit_features(
        "nfl",
        "home_win",
        [2023],
        features=["site", "elo", "team_form", "rest"],
        inputs=inputs,
    )
    assert report["ok"] is True
    assert report["verdict"] == "REVIEW REQUIRED"
    assert report["failures"] == []
    assert report["rows"] >= 30
    joined = " ".join(report["warnings"])
    assert "is_home" not in joined
    assert "home_consecutive_away" not in joined
    assert "flat_zero" not in joined


def test_same_second_runs_use_sequence_then_run_id(tmp_path, monkeypatch):
    store = RunStore(tmp_path)
    stamp = "2026-11-26T18:15:07-06:00"
    older = _listed("run_aaaaaaaaaaaa", stamp, 1)
    newer = _listed("run_bbbbbbbbbbbb", stamp, 2)
    tied_low = _listed("run_aaaaaaaaaaaa", stamp, 7)
    tied_high = _listed("run_bbbbbbbbbbbb", stamp, 7)

    def oldest_first(_store):
        return [older, newer]

    monkeypatch.setattr("sports_leader_lab.registry.iter_run_metas", oldest_first)
    assert list_runs("nfl", limit=1, store=store)["runs"][0]["run_id"] == "run_bbbbbbbbbbbb"

    def newest_first(_store):
        return [newer, older]

    monkeypatch.setattr("sports_leader_lab.registry.iter_run_metas", newest_first)
    assert list_runs("nfl", limit=1, store=store)["runs"][0]["run_id"] == "run_bbbbbbbbbbbb"

    def tied(_store):
        return [tied_low, tied_high]

    monkeypatch.setattr("sports_leader_lab.registry.iter_run_metas", tied)
    assert list_runs("nfl", limit=1, store=store)["runs"][0]["run_id"] == "run_bbbbbbbbbbbb"


def _registry(name, builder):
    registry = default_registry()
    registry.register(
        FeatureSpec(
            name=name,
            description="leak",
            known_at=KnownAt.PRIOR_GAMES,
            datasets=frozenset({"games"}),
            builder=builder,
            columns=(name,),
        )
    )
    return registry


def _audit_builder(inputs, name, builder, target):
    return audit_features(
        "nfl",
        target,
        [2023],
        features=[name],
        inputs=inputs,
        registry=_registry(name, builder),
    )


def _one_nan_score(ctx):
    values = ctx.games["home_score"].to_numpy(dtype=float).copy()
    values[0] = np.nan
    return pd.DataFrame({"game_id": ctx.games["game_id"], "one_nan": values})


def _half_null_score(ctx):
    values = ctx.games["home_score"].to_numpy(dtype=float).copy()
    values[: len(values) // 2] = np.nan
    return pd.DataFrame({"game_id": ctx.games["game_id"], "half_null": values})


def _scaled_margin(ctx):
    margin = ctx.games["home_score"].to_numpy(dtype=float) - ctx.games["away_score"].to_numpy(dtype=float)
    return pd.DataFrame({"game_id": ctx.games["game_id"], "scaled": 2.0 * margin + 3.0})


def _flipped_margin(ctx):
    margin = ctx.games["away_score"].to_numpy(dtype=float) - ctx.games["home_score"].to_numpy(dtype=float)
    return pd.DataFrame({"game_id": ctx.games["game_id"], "flipped": margin})


def _listed(run_id: str, created_at: str, sequence: int) -> dict:
    return {
        "run_id": run_id,
        "created_at": created_at,
        "sequence": sequence,
        "league": "nfl",
        "target": "home_win",
        "model": "logistic",
        "kind": "classifier",
        "metrics": {"pooled": {"model": {"log_loss": 0.5}, "beats_elo": False}},
        "reproducibility": {"lab_version": "0.1.0.dev0"},
    }


def _copy_target(ctx):
    home = ctx.games["home_score"].to_numpy()
    away = ctx.games["away_score"].to_numpy()
    return pd.DataFrame({"game_id": ctx.games["game_id"], "copied": (home > away).astype(float)})


def _copy_score(ctx):
    return pd.DataFrame({"game_id": ctx.games["game_id"], "score": ctx.games["home_score"].to_numpy()})


def _after_start(ctx):
    start = pd.to_datetime(ctx.games["start_time"], utc=True) + pd.Timedelta(hours=3)
    return pd.DataFrame({"game_id": ctx.games["game_id"], "clock": start})


def _copy_yards(ctx):
    return pd.DataFrame(
        {"game_id": ctx.games["game_id"], "yards": [100 + index for index in range(len(ctx.games))]}
    )


def _yards(games: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "game_id": games["game_id"].to_numpy(),
            "team_id": games["home_team_id"].to_numpy(),
            "total_yards": [100 + index for index in range(len(games))],
        }
    )


def _round_robin(n: int) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Several teams over consecutive days, with is_home and a constant stat column."""
    pairings = ((1, 2), (3, 4), (1, 3), (2, 4), (1, 4), (2, 3))
    games = []
    stats = []
    start = pd.Timestamp("2023-09-07")
    for index in range(n):
        home, away = pairings[index % len(pairings)]
        if (index // len(pairings)) % 2 == 1:
            home, away = away, home
        when = start + pd.Timedelta(days=index)
        home_score = 17 + (index % 11)
        away_score = 9 + (index % 7)
        game_id = 5000 + index
        games.append(
            {
                "game_id": game_id,
                "game_date": when.date().isoformat(),
                "start_time": when.isoformat(sep=" "),
                "season": 2023,
                "season_type": "regular",
                "status": "final",
                "completed": True,
                "home_team_id": home,
                "away_team_id": away,
                "home_score": home_score,
                "away_score": away_score,
                "neutral_site": False,
                "venue": f"Venue {home}",
                "venue_city": f"City {home}",
            }
        )
        for team, opponent, is_home, points, allowed in (
            (home, away, True, home_score, away_score),
            (away, home, False, away_score, home_score),
        ):
            stats.append(
                {
                    "game_id": game_id,
                    "team_id": team,
                    "opponent_id": opponent,
                    "team_abbr": f"T{team}",
                    "opponent_abbr": f"T{opponent}",
                    "team_name": f"Team {team}",
                    "opponent_name": f"Team {opponent}",
                    "is_home": is_home,
                    "league": "nfl",
                    "season": 2023,
                    "season_type": "regular",
                    "game_date": when.date().isoformat(),
                    "score": points,
                    "opponent_score": allowed,
                    "total_yards": 280 + index + (0 if is_home else 15),
                    "plays": 60 + (index % 5),
                    "flat_zero": 0,
                }
            )
    return pd.DataFrame(games), pd.DataFrame(stats)


def _games(n: int) -> pd.DataFrame:
    rows = []
    for index in range(n):
        home_win = index % 2 == 0
        rows.append(
            {
                "game_id": 100 + index,
                "game_date": f"2023-09-{(index % 27) + 1:02d}",
                "start_time": f"2023-09-{(index % 27) + 1:02d} 18:00",
                "season": 2023,
                "season_type": "regular",
                "status": "final",
                "completed": True,
                "home_team_id": 1,
                "away_team_id": 2,
                "home_score": 24 if home_win else 7,
                "away_score": 10 if home_win else 21,
                "neutral_site": False,
                "venue": "Home",
            }
        )
    return pd.DataFrame(rows)


def _injuries() -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "player_id": 10,
                "team_id": 1,
                "season": 2023,
                "valid_from": "2023-09-01 12:00",
                "valid_to": None,
                "status": "out",
            }
        ]
    )


def _save(store: RunStore) -> str:
    rows = []
    for season, count, origin in ((2023, 80, "2023-09-01"), (2024, 40, "2024-09-01")):
        for index in range(count):
            rows.append(
                {
                    "game_id": f"{season}-{index}",
                    "game_date": pd.Timestamp(origin) + pd.Timedelta(days=index),
                    "season": season,
                    "home_elo": 1600.0 if index % 2 == 0 else 1400.0,
                    "away_elo": 1500.0,
                    "neutral_site": False,
                    "noise": float(index),
                    "target": 1.0 if index % 2 == 0 else 0.0,
                }
            )
    dataset_id = "dataset_0123456789ab"
    save_dataset(
        store,
        dataset_id,
        pd.DataFrame(rows),
        {
            "dataset_id": dataset_id,
            "league": "nfl",
            "target": "home_win",
            "target_kind": "binary",
            "seasons": [2023, 2024],
            "families": ["synthetic"],
            "feature_columns": ["noise"],
            "columns": {"noise": {"known_at": "prior_games", "family": "synthetic"}},
            "sql_features": [],
            "data_manifest": [],
            "rows": len(rows),
        },
    )
    return dataset_id
