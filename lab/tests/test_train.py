"""Walk-forward training stays inside the training fold and flags a loss to Elo."""

import numpy as np
import pandas as pd

from sports_leader_lab import DISCLAIMER
from sports_leader_lab.runs import save_dataset
from sports_leader_lab.store import RunStore
from sports_leader_lab.training import train_classifier, train_regressor


def test_classifier_flags_a_model_that_loses_to_elo_and_keeps_the_holdout_inside_train(tmp_path):
    store = RunStore(tmp_path)
    dataset_id = _save_noise_dataset(store)
    logistic = train_classifier(
        dataset_id, model="logistic", calibration="platt", min_train_seasons=1, store=store
    )
    light = train_classifier(dataset_id, model="lightgbm", min_train_seasons=1, store=store)
    for result in (logistic, light):
        assert result["disclaimer"] == DISCLAIMER
        assert result["pooled"]["beats_elo"] is False
        assert any("does not beat the as-of Elo baseline" in warning for warning in result["warnings"])
        assert result["pooled"]["model"]["log_loss"] is not None
        assert result["pooled"]["model"]["brier"] is not None
        assert result["pooled"]["model"]["ece"] is not None
        assert result["pooled"]["model"]["reliability_bins"]
        assert result["pooled"]["constant"]["log_loss"] is not None
        assert result["pooled"]["home_field"]["log_loss"] is not None
        assert result["pooled"]["elo"]["log_loss"] < result["pooled"]["model"]["log_loss"]
        fold = result["folds"][0]
        assert fold["early_stopping_end"] is None or fold["early_stopping_end"] < fold["test_start"]
        assert fold["calibration_end"] is None or fold["calibration_end"] < fold["test_start"]
        assert (tmp_path / "models" / result["run_id"] / "model.joblib").is_file()
        assert (tmp_path / "models" / result["run_id"] / "predictions.parquet").is_file()
    assert logistic["folds"][0]["calibration_end"] is not None
    assert logistic["folds"][0]["calibration_end"] < logistic["folds"][0]["test_start"]
    assert light["folds"][0]["early_stopping_end"] is not None
    assert light["folds"][0]["early_stopping_end"] < light["folds"][0]["test_start"]


def test_regressor_reports_margin_and_count_metrics(tmp_path):
    store = RunStore(tmp_path)
    margin_id = _save_margin_dataset(store)
    margin = train_regressor(margin_id, model="ridge", min_train_seasons=1, store=store)
    assert margin["pooled"]["model"]["mae"] is not None
    assert margin["pooled"]["model"]["rmse"] is not None
    assert margin["pooled"]["model"]["residual_sd"] is not None
    assert margin["pooled"]["elo"]["mae"] is not None
    assert margin["pooled"]["bias_by_season"]
    assert "implied_home_win_prob_mean" in margin["pooled"]["model"]
    assert margin["disclaimer"] == DISCLAIMER
    boosted = train_regressor(margin_id, model="lightgbm", min_train_seasons=1, store=store)
    assert boosted["folds"][0]["early_stopping_end"] < boosted["folds"][0]["test_start"]

    count_id = _save_count_dataset(store)
    poisson = train_regressor(count_id, model="poisson", min_train_seasons=1, store=store)
    negbin = train_regressor(count_id, model="negbin", min_train_seasons=1, store=store)
    assert poisson["pooled"]["model"]["poisson_deviance"] is not None
    assert negbin["pooled"]["model"]["mae"] is not None
    assert poisson["pooled"]["beats_elo"] is None
    assert any("count targets" in warning for warning in poisson["warnings"])


def _save_noise_dataset(store: RunStore) -> str:
    frame = _rows(target="binary")
    return _save(store, frame, "home_win", "binary", ["noise"])


def _save_margin_dataset(store: RunStore) -> str:
    frame = _rows(target="margin")
    return _save(store, frame, "margin", "margin", ["noise", "elo_diff"])


def _save_count_dataset(store: RunStore) -> str:
    frame = _rows(target="count")
    return _save(store, frame, "total", "count", ["noise"])


def _save(store, frame, target, kind, features) -> str:
    dataset_id = "dataset_test"
    meta = {
        "dataset_id": dataset_id,
        "league": "nfl",
        "target": target,
        "target_kind": kind,
        "seasons": [2023, 2024],
        "families": ["synthetic"],
        "feature_columns": features,
        "columns": {name: {"known_at": "prior_games", "family": "synthetic"} for name in features},
        "sql_features": [],
        "rows": len(frame),
    }
    save_dataset(store, dataset_id, frame, meta)
    return dataset_id


def _rows(target: str) -> pd.DataFrame:
    rng = np.random.default_rng(0)
    rows = []
    for season, count, origin in ((2023, 80, "2023-09-01"), (2024, 40, "2024-09-01")):
        for index in range(count):
            home_elo = 1600.0 if index % 2 == 0 else 1400.0
            away_elo = 1500.0
            if target == "binary":
                y = 1.0 if home_elo > away_elo else 0.0
            elif target == "margin":
                y = (home_elo - away_elo) / 25.0
            else:
                y = 20.0 + (index % 5)
            rows.append(
                {
                    "game_id": f"{season}-{index}",
                    "game_date": pd.Timestamp(origin) + pd.Timedelta(days=index),
                    "season": season,
                    "home_elo": home_elo,
                    "away_elo": away_elo,
                    "elo_diff": home_elo - away_elo,
                    "home_field": 1.0 if index % 5 else 0.0,
                    "neutral_site": index % 5 == 0,
                    "noise": float(rng.normal()),
                    "target": y,
                }
            )
    return pd.DataFrame(rows)
