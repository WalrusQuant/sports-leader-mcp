"""Walk-forward classifiers and regressors.

Early stopping and calibration use a tail of the training fold only. The test
fold is scored after the fit. The saved model is then refit on every labeled
row, with that same inner tail, so predict does not keep the last test fold
out of the model. Reported metrics are the walk-forward scores.

Logistic regression is L2. Count targets (total, team_points) can use Poisson,
a negative-binomial GLM, or LightGBM with a Poisson objective. Margin can be
negative, so Poisson and negative binomial are refused for it.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import norm
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from sklearn.linear_model import LogisticRegression, PoissonRegressor, Ridge

from sports_leader_lab import DISCLAIMER, __version__
from sports_leader_lab.errors import LabError
from sports_leader_lab.eval.baselines import (
    constant_rate,
    elo_implied_margin,
    elo_win_probability,
    fails_to_beat,
    home_field_rate,
)
from sports_leader_lab.eval.metrics import classification_scores, regression_scores
from sports_leader_lab.features.elo import ELO_HOME_ADV
from sports_leader_lab.payload import jsonable
from sports_leader_lab.runs import load_dataset, new_id, save_run
from sports_leader_lab.splits.walk import walk_forward
from sports_leader_lab.store import RunStore

CT = ZoneInfo("America/Chicago")
_INNER_MIN = 40

CLASSIFIER_MODELS = ("logistic", "lightgbm")
REGRESSOR_MODELS = ("ridge", "poisson", "negbin", "lightgbm")
CALIBRATIONS = ("none", "platt", "isotonic")


class _NegBin:
    """NB2 log-link GLM. `beta` includes the intercept. `alpha` is the dispersion."""

    def __init__(self, beta: np.ndarray, alpha: float) -> None:
        self.beta = np.asarray(beta, dtype=float)
        self.alpha = float(alpha)

    def predict(self, features: np.ndarray) -> np.ndarray:
        design = np.column_stack([np.ones(len(features)), np.asarray(features, dtype=float)])
        return np.exp(np.clip(design @ self.beta, -20.0, 20.0))


def train_classifier(
    dataset_id: str,
    model: str = "logistic",
    calibration: str = "none",
    *,
    scheme: str = "season",
    min_train_seasons: int = 2,
    min_train_rows: int = 50,
    embargo_days: int = 0,
    test_days: int = 14,
    store: RunStore | None = None,
) -> dict:
    if model not in CLASSIFIER_MODELS:
        raise LabError(f"unknown classifier '{model}'. Expected logistic or lightgbm")
    if calibration not in CALIBRATIONS:
        raise LabError("calibration must be none, platt, or isotonic")
    return _train(
        dataset_id,
        kind="classifier",
        model=model,
        calibration=calibration,
        scheme=scheme,
        min_train_seasons=min_train_seasons,
        min_train_rows=min_train_rows,
        embargo_days=embargo_days,
        test_days=test_days,
        store=store,
    )


def train_regressor(
    dataset_id: str,
    model: str = "ridge",
    *,
    scheme: str = "season",
    min_train_seasons: int = 2,
    min_train_rows: int = 50,
    embargo_days: int = 0,
    test_days: int = 14,
    store: RunStore | None = None,
) -> dict:
    if model not in REGRESSOR_MODELS:
        raise LabError(f"unknown regressor '{model}'. Expected ridge, poisson, negbin, or lightgbm")
    return _train(
        dataset_id,
        kind="regressor",
        model=model,
        calibration="none",
        scheme=scheme,
        min_train_seasons=min_train_seasons,
        min_train_rows=min_train_rows,
        embargo_days=embargo_days,
        test_days=test_days,
        store=store,
    )


def _train(
    dataset_id: str,
    *,
    kind: str,
    model: str,
    calibration: str,
    scheme: str,
    min_train_seasons: int,
    min_train_rows: int,
    embargo_days: int,
    test_days: int,
    store: RunStore | None,
) -> dict:
    destination = store if store is not None else RunStore.from_config()
    frame, meta = load_dataset(destination, dataset_id)
    target_kind = meta["target_kind"]
    if kind == "classifier" and target_kind != "binary":
        raise LabError(f"train_classifier needs a binary target, got {meta['target']}")
    if kind == "regressor" and target_kind == "binary":
        raise LabError("train_regressor does not take home_win; use margin, total, or team_points")
    if model in {"poisson", "negbin"} and target_kind != "count":
        raise LabError("poisson and negbin are for count targets (total, team_points); margin can be negative")
    features = list(meta["feature_columns"])
    missing = [name for name in features if name not in frame.columns]
    if missing:
        raise LabError(f"dataset is missing features: {', '.join(missing)}")
    work = frame.copy()
    work["game_date"] = pd.to_datetime(work["game_date"])
    folds = walk_forward(
        work,
        scheme=scheme,
        min_train_seasons=min_train_seasons,
        min_train_rows=min_train_rows,
        embargo_days=embargo_days,
        test_days=test_days,
    )
    if not folds:
        raise LabError("walk-forward produced no folds; add seasons or lower min_train_seasons")
    warnings: list[str] = []
    fold_rows: list[dict] = []
    pieces: list[pd.DataFrame] = []
    count = target_kind == "count"
    for fold in folds:
        train = work.iloc[list(fold.train_iloc)]
        test = work.iloc[list(fold.test_iloc)]
        fitted = _fit_predict(
            train,
            test,
            features,
            kind=kind,
            model=model,
            calibration=calibration,
            count=count,
        )
        if fitted is None:
            seasons = ", ".join(str(season) for season in fold.test_seasons)
            warnings.append(
                f"fold {fold.fold} (test {seasons}) was skipped because the training fold had one class"
            )
            continue
        _guard_inner_dates(fitted, test)
        warnings.extend(fitted["warnings"])
        scored = _score_fold(fitted, test, kind=kind, count=count)
        scored["fold"] = fold.fold
        scored["train_rows"] = int(fold.train_rows)
        scored["test_rows"] = int(fold.test_rows)
        scored["train_seasons"] = list(fold.train_seasons)
        scored["test_seasons"] = list(fold.test_seasons)
        scored["train_start"] = _day(fold.train_start)
        scored["train_end"] = _day(fold.train_end)
        scored["test_start"] = _day(fold.test_start)
        scored["test_end"] = _day(fold.test_end)
        fold_rows.append(scored)
        part = fitted["predictions"].copy()
        part.insert(0, "fold", fold.fold)
        pieces.append(part)
    if not pieces:
        raise LabError("every walk-forward fold was skipped")
    predictions = pd.concat(pieces, ignore_index=True)
    pooled = _pool(predictions, kind=kind, count=count, target_kind=target_kind)
    warnings.extend(pooled.pop("warnings"))
    final, final_warnings = _refit(work, features, kind=kind, model=model, calibration=calibration, count=count)
    warnings.extend(final_warnings)
    run_id = new_id("run")
    residual_sd = pooled["model"].get("residual_sd")
    bundle = {
        "estimator": final["estimator"],
        "base_estimator": final["base"],
        "features": features,
        "medians": final["medians"],
        "means": final["means"],
        "stds": final["stds"],
        "impute": final["impute"],
        "scale": final["scale"],
        "model": model,
        "kind": kind,
        "target": meta["target"],
        "target_kind": target_kind,
        "league": meta["league"],
        "calibration": calibration,
        "residual_sd": residual_sd,
        "home_adv": ELO_HOME_ADV,
    }
    created = datetime.now(CT).isoformat(timespec="seconds")
    unique_warnings = list(dict.fromkeys(warnings))
    run_meta = {
        "run_id": run_id,
        "kind": kind,
        "created_at": created,
        "league": meta["league"],
        "target": meta["target"],
        "target_kind": target_kind,
        "model": model,
        "calibration": calibration,
        "dataset_id": dataset_id,
        "seasons": list(meta["seasons"]),
        "families": list(meta["families"]),
        "feature_columns": features,
        "known_at": {name: meta["columns"][name]["known_at"] for name in features},
        "sql_features": list(meta.get("sql_features") or []),
        "decision_time": "pregame",
        "scheme": scheme,
        "metrics": {"folds": fold_rows, "pooled": pooled},
        "feature_importance": final["importance"],
        "beats_elo": pooled["beats_elo"],
        "warnings": unique_warnings,
        "reproducibility": {
            "lab_version": __version__,
            "seeds": {
                "lightgbm_random_state": 0,
                "numpy": None,
                "sklearn": None,
            },
            "split": {
                "scheme": scheme,
                "min_train_seasons": min_train_seasons,
                "min_train_rows": min_train_rows,
                "embargo_days": embargo_days,
                "test_days": test_days,
            },
            "params": _recorded_params(model, kind=kind, calibration=calibration),
            "features": features,
            "data_manifest": list(meta.get("data_manifest") or []),
            "command": {
                "tool": "train_classifier" if kind == "classifier" else "train_regressor",
                "dataset_id": dataset_id,
                "model": model,
                "calibration": calibration,
                "scheme": scheme,
                "min_train_seasons": min_train_seasons,
                "min_train_rows": min_train_rows,
                "embargo_days": embargo_days,
                "test_days": test_days,
            },
        },
        "disclaimer": DISCLAIMER,
    }
    save_run(destination, run_id, bundle, run_meta, fold_rows, predictions)
    return jsonable(
        {
            "run_id": run_id,
            "dataset_id": dataset_id,
            "model": model,
            "calibration": calibration,
            "kind": kind,
            "target": meta["target"],
            "folds": fold_rows,
            "pooled": pooled,
            "feature_importance": final["importance"],
            "warnings": unique_warnings,
            "disclaimer": DISCLAIMER,
        }
    )


def _fit_predict(train, test, features, *, kind, model, calibration, count):
    stopping = model == "lightgbm"
    calibrating = calibration in {"platt", "isotonic"}
    fit, stop, cal, note = _slices(train, stopping=stopping, calibrating=calibrating)
    warnings = [note] if note else []
    try:
        y_fit = _y(fit, kind)
    except LabError:
        return None
    if kind == "classifier" and len(np.unique(y_fit)) < 2:
        return None
    state = _state(fit, features, impute=model != "lightgbm", scale=model != "lightgbm")
    x_fit = _matrix(fit, features, state)
    x_stop = _matrix(stop, features, state) if stop is not None else None
    x_cal = _matrix(cal, features, state) if cal is not None else None
    base = _estimator(
        model,
        kind=kind,
        count=count,
        x_fit=x_fit,
        y_fit=y_fit,
        x_stop=x_stop,
        y_stop=_y(stop, kind) if stop is not None else None,
        warnings=warnings,
    )
    estimator = base
    if calibrating:
        if cal is None:
            warnings.append("calibration was skipped because the training fold has no inner holdout")
        else:
            y_cal = _y(cal, kind)
            if len(np.unique(y_cal)) < 2:
                warnings.append("calibration was skipped because the holdout had one class")
            else:
                method = "sigmoid" if calibration == "platt" else "isotonic"
                estimator = CalibratedClassifierCV(FrozenEstimator(base), method=method)
                estimator.fit(x_cal, y_cal)
    predicted = _predict(estimator, _matrix(test, features, state), kind=kind)
    baselines = _baselines(train, test, kind=kind, count=count)
    return {
        "estimator": estimator,
        "base": base,
        "state": state,
        "warnings": warnings,
        "predictions": _prediction_frame(test, predicted, baselines),
        "early_stopping_end": _date_end(stop),
        "calibration_end": _date_end(cal) if calibrating else None,
        "baselines": baselines,
    }


def _score_fold(fitted, test, *, kind, count) -> dict:
    pred = fitted["predictions"]
    model_scores = _metric_block(pred["y"], pred["prediction"], kind=kind, count=count, with_bins=True)
    table: dict[str, Any] = {"model": model_scores}
    for name in ("constant", "home_field", "elo"):
        column = pred[f"baseline_{name}"]
        if column.isna().all():
            table[name] = None
            continue
        table[name] = _metric_block(pred["y"], column, kind=kind, count=count, with_bins=False)
    beats, flag_warning = _beat_flag(table, kind=kind)
    return {
        "metrics": table,
        "beats_elo": beats,
        "early_stopping_end": fitted["early_stopping_end"],
        "calibration_end": fitted["calibration_end"],
        "warning": flag_warning,
    }


def _pool(predictions: pd.DataFrame, *, kind, count, target_kind) -> dict:
    model_scores = _metric_block(
        predictions["y"], predictions["prediction"], kind=kind, count=count, with_bins=True
    )
    table: dict[str, Any] = {"model": model_scores}
    warnings = []
    for name in ("constant", "home_field", "elo"):
        column = predictions[f"baseline_{name}"]
        if column.isna().all():
            table[name] = None
            continue
        table[name] = _metric_block(predictions["y"], column, kind=kind, count=count, with_bins=False)
    beats, flag_warning = _beat_flag(table, kind=kind)
    if flag_warning:
        warnings.append(flag_warning)
    if target_kind == "count":
        warnings.append("Elo does not predict count targets; the beat-Elo flag is not applied")
        table["elo"] = None
        beats = None
    if kind == "regressor" and target_kind == "margin" and model_scores.get("residual_sd"):
        scale = float(model_scores["residual_sd"])
        implied = norm.cdf(predictions["prediction"].to_numpy(dtype=float) / scale)
        predictions["implied_home_win_prob"] = implied
        model_scores["implied_home_win_prob_mean"] = float(np.mean(implied))
    else:
        predictions["implied_home_win_prob"] = np.nan
    bias = {}
    if kind == "regressor":
        for season, part in predictions.groupby("season"):
            bias[str(int(season))] = float((part["prediction"] - part["y"]).mean())
    table["bias_by_season"] = bias
    table["rows"] = int(len(predictions))
    table["beats_elo"] = beats
    table["warnings"] = warnings
    return table


def _beat_flag(table: dict, *, kind: str) -> tuple[bool | None, str | None]:
    elo = table.get("elo")
    model = table["model"]
    if not elo:
        return None, None
    if kind == "classifier":
        failed = fails_to_beat(model.get("log_loss"), elo.get("log_loss"), lower_is_better=True)
        label = "log loss"
    else:
        failed = fails_to_beat(model.get("mae"), elo.get("mae"), lower_is_better=True)
        label = "MAE"
    if failed:
        return False, f"model does not beat the as-of Elo baseline on {label}"
    if failed is False:
        return True, None
    return None, None


def _refit(frame, features, *, kind, model, calibration, count):
    stopping = model == "lightgbm"
    calibrating = calibration in {"platt", "isotonic"}
    fit, stop, cal, note = _slices(frame, stopping=stopping, calibrating=calibrating)
    warnings = [note] if note else []
    y_fit = _y(fit, kind)
    state = _state(fit, features, impute=model != "lightgbm", scale=model != "lightgbm")
    base = _estimator(
        model,
        kind=kind,
        count=count,
        x_fit=_matrix(fit, features, state),
        y_fit=y_fit,
        x_stop=_matrix(stop, features, state) if stop is not None else None,
        y_stop=_y(stop, kind) if stop is not None else None,
        warnings=warnings,
    )
    estimator = base
    if calibrating and cal is not None and len(np.unique(_y(cal, kind))) > 1:
        method = "sigmoid" if calibration == "platt" else "isotonic"
        estimator = CalibratedClassifierCV(FrozenEstimator(base), method=method)
        estimator.fit(_matrix(cal, features, state), _y(cal, kind))
    elif calibrating:
        warnings.append("the saved model was not calibrated; the inner holdout was too small or one class")
    return {
        "estimator": estimator,
        "base": base,
        "medians": state["medians"],
        "means": state["means"],
        "stds": state["stds"],
        "impute": state["impute"],
        "scale": state["scale"],
        "importance": _importance(base, features),
    }, warnings


def _slices(frame: pd.DataFrame, *, stopping: bool, calibrating: bool):
    ordered = frame.sort_values(["game_date", "game_id"], kind="mergesort")
    n = len(ordered)
    if n < _INNER_MIN or not (stopping or calibrating):
        note = None
        if n < _INNER_MIN and (stopping or calibrating):
            note = "training fold has fewer than 40 rows; early stopping and calibration were skipped"
        return ordered, None, None, note
    if stopping and calibrating:
        fit_end = int(n * 0.70)
        stop_end = int(n * 0.85)
        if fit_end < 20 or stop_end - fit_end < 8 or n - stop_end < 8:
            return ordered, None, None, "training fold is too small to hold out early stopping and calibration"
        return ordered.iloc[:fit_end], ordered.iloc[fit_end:stop_end], ordered.iloc[stop_end:], None
    cut = int(n * 0.80)
    if cut < 20 or n - cut < 8:
        return ordered, None, None, "training fold is too small for an inner holdout"
    if stopping:
        return ordered.iloc[:cut], ordered.iloc[cut:], None, None
    return ordered.iloc[:cut], None, ordered.iloc[cut:], None


def _estimator(model, *, kind, count, x_fit, y_fit, x_stop, y_stop, warnings):
    if model == "logistic":
        estimator = LogisticRegression(C=1.0, max_iter=1000)
        estimator.fit(x_fit, y_fit)
        return estimator
    if model == "ridge":
        estimator = Ridge(alpha=1.0)
        estimator.fit(x_fit, y_fit)
        return estimator
    if model == "poisson":
        estimator = PoissonRegressor(alpha=0.1, max_iter=300)
        estimator.fit(x_fit, y_fit)
        return estimator
    if model == "negbin":
        return _fit_negbin(x_fit, y_fit, warnings)
    if model == "lightgbm":
        if kind == "classifier":
            estimator = lgb.LGBMClassifier(
                n_estimators=400 if x_stop is not None else 100,
                learning_rate=0.05,
                num_leaves=15,
                min_child_samples=5,
                random_state=0,
                verbosity=-1,
                force_col_wise=True,
            )
        else:
            estimator = lgb.LGBMRegressor(
                objective="poisson" if count else "regression",
                n_estimators=400 if x_stop is not None else 100,
                learning_rate=0.05,
                num_leaves=15,
                min_child_samples=5,
                random_state=0,
                verbosity=-1,
                force_col_wise=True,
            )
        if x_stop is not None and (kind == "regressor" or len(np.unique(y_stop)) > 1):
            estimator.fit(
                x_fit,
                y_fit,
                eval_X=x_stop,
                eval_y=y_stop,
                callbacks=[lgb.early_stopping(30, verbose=False), lgb.log_evaluation(0)],
            )
        else:
            if x_stop is not None:
                warnings.append("early stopping was skipped because the holdout had one class")
            estimator.set_params(n_estimators=100)
            estimator.fit(x_fit, y_fit)
        return estimator
    raise LabError(f"unknown model '{model}'")


def _fit_negbin(features: np.ndarray, y: np.ndarray, warnings: list[str]) -> _NegBin:
    from scipy.optimize import minimize
    from scipy.special import gammaln

    target = np.asarray(y, dtype=float)
    if np.any(target < 0):
        raise LabError("negbin requires non-negative counts")
    design = np.column_stack([np.ones(len(features)), np.asarray(features, dtype=float)])
    start = np.zeros(design.shape[1] + 1)
    start[0] = np.log(max(float(target.mean()), 0.1))

    def nll(theta: np.ndarray) -> float:
        beta = theta[:-1]
        alpha = float(np.exp(np.clip(theta[-1], -8.0, 8.0)))
        mu = np.exp(np.clip(design @ beta, -20.0, 20.0))
        rate = 1.0 / alpha
        log_like = (
            gammaln(target + rate)
            - gammaln(rate)
            - gammaln(target + 1.0)
            + rate * np.log(rate / (rate + mu))
            + target * np.log(mu / (rate + mu) + 1e-12)
        )
        return float(-np.mean(log_like) + 1e-4 * np.dot(beta[1:], beta[1:]))

    result = minimize(nll, start, method="L-BFGS-B")
    if not result.success or not np.isfinite(result.fun):
        detail = getattr(result, "message", "") or "optimizer did not converge"
        raise LabError(f"negbin fit failed ({detail})")
    log_alpha = float(result.x[-1])
    # The likelihood clips log(alpha) to [-8, 8]. The lower end is Poisson.
    if log_alpha <= -8.0 + 1e-6:
        warnings.append(
            "negbin dispersion hit its lower bound, so the fit is Poisson"
        )
    elif log_alpha >= 8.0 - 1e-6:
        warnings.append("negbin dispersion hit its upper bound")
    beta = result.x[:-1]
    alpha = float(np.exp(np.clip(log_alpha, -8.0, 8.0)))
    return _NegBin(beta, alpha)


def _state(frame: pd.DataFrame, features: list[str], *, impute: bool, scale: bool) -> dict:
    values = frame[features].apply(pd.to_numeric, errors="coerce")
    medians = {}
    if impute:
        for name in features:
            column = values[name]
            medians[name] = float(column.median()) if column.notna().any() else 0.0
        values = values.fillna(medians)
    matrix = values.to_numpy(dtype=float)
    means = {}
    stds = {}
    if scale:
        mean = np.nanmean(matrix, axis=0)
        std = np.nanstd(matrix, axis=0)
        std = np.where(std < 1e-6, 1.0, std)
        means = {name: float(mean[index]) for index, name in enumerate(features)}
        stds = {name: float(std[index]) for index, name in enumerate(features)}
    return {"medians": medians, "means": means, "stds": stds, "impute": impute, "scale": scale, "features": features}


def _matrix(frame: pd.DataFrame | None, features: list[str], state: dict) -> np.ndarray | None:
    if frame is None:
        return None
    values = frame[features].apply(pd.to_numeric, errors="coerce")
    if state["impute"]:
        values = values.fillna(state["medians"])
    matrix = values.to_numpy(dtype=float)
    if state["scale"]:
        mean = np.array([state["means"][name] for name in features])
        std = np.array([state["stds"][name] for name in features])
        matrix = (matrix - mean) / std
    return matrix


def _predict(estimator, features: np.ndarray, *, kind: str) -> np.ndarray:
    if kind == "classifier":
        probability = estimator.predict_proba(features)
        classes = [int(label) for label in estimator.classes_]
        return probability[:, classes.index(1)]
    return np.asarray(estimator.predict(features), dtype=float)


def _baselines(train: pd.DataFrame, test: pd.DataFrame, *, kind: str, count: bool) -> dict:
    y_train = train["target"].to_numpy(dtype=float)
    home_train = _home_flag(train)
    home_test = _home_flag(test)
    constant = np.full(len(test), constant_rate(y_train))
    home = home_field_rate(y_train, home_train, home_test)
    elo = np.full(len(test), np.nan)
    parts = _elo_parts(train), _elo_parts(test)
    if parts[0] is not None and parts[1] is not None and not count:
        home_elo, away_elo, neutral, diff = parts[1]
        if kind == "classifier":
            elo = elo_win_probability(home_elo, away_elo, neutral)
        else:
            elo = elo_implied_margin(parts[0][3], y_train, diff)
    return {"constant": constant, "home_field": home, "elo": elo}


def _prediction_frame(test: pd.DataFrame, predicted: np.ndarray, baselines: dict) -> pd.DataFrame:
    return pd.DataFrame(
        {
            "game_id": test["game_id"].to_numpy(),
            "game_date": pd.to_datetime(test["game_date"]).to_numpy(),
            "season": test["season"].to_numpy(),
            "y": test["target"].to_numpy(dtype=float),
            "prediction": predicted,
            "baseline_constant": baselines["constant"],
            "baseline_home_field": baselines["home_field"],
            "baseline_elo": baselines["elo"],
        }
    )


def _recorded_params(model: str, *, kind: str, calibration: str) -> dict[str, Any]:
    """Constructor settings that do not change inside a fold."""
    params: dict[str, Any] = {"model": model, "kind": kind, "calibration": calibration}
    if model == "logistic":
        params.update({"C": 1.0, "max_iter": 1000})
    elif model == "ridge":
        params.update({"alpha": 1.0})
    elif model == "poisson":
        params.update({"alpha": 0.1, "max_iter": 300})
    elif model == "negbin":
        params.update({"log_alpha_clip": [-8.0, 8.0]})
    elif model == "lightgbm":
        params.update(
            {
                "learning_rate": 0.05,
                "num_leaves": 15,
                "min_child_samples": 5,
                "random_state": 0,
                "n_estimators": "400 with an inner stop slice, else 100",
                "objective": "binary" if kind == "classifier" else "poisson for count targets, otherwise regression",
            }
        )
    return params


def _metric_block(y, pred, *, kind, count, with_bins: bool) -> dict:
    if kind == "classifier":
        return classification_scores(y, pred, with_bins=with_bins)
    return regression_scores(y, pred, count=count)


def _importance(estimator, features: list[str]) -> list[dict]:
    if hasattr(estimator, "coef_"):
        values = np.abs(np.ravel(estimator.coef_))
    elif hasattr(estimator, "feature_importances_"):
        values = np.asarray(estimator.feature_importances_, dtype=float)
    elif isinstance(estimator, _NegBin):
        values = np.abs(estimator.beta[1:])
    else:
        return []
    order = np.argsort(-values)
    return [{"feature": features[index], "importance": float(values[index])} for index in order]


def _y(frame: pd.DataFrame, kind: str) -> np.ndarray:
    if kind == "classifier":
        return frame["target"].to_numpy(dtype=int)
    return frame["target"].to_numpy(dtype=float)


def _home_flag(frame: pd.DataFrame) -> np.ndarray:
    if "home_field" in frame.columns:
        return pd.to_numeric(frame["home_field"], errors="coerce").fillna(1.0).to_numpy(dtype=float) >= 0.5
    if "neutral_site" in frame.columns:
        neutral = frame["neutral_site"].map(lambda value: bool(value) if pd.notna(value) else False)
        return ~neutral.to_numpy(dtype=bool)
    return np.ones(len(frame), dtype=bool)


def _elo_parts(frame: pd.DataFrame):
    if "home_elo" not in frame.columns or "away_elo" not in frame.columns:
        return None
    home = pd.to_numeric(frame["home_elo"], errors="coerce").to_numpy(dtype=float)
    away = pd.to_numeric(frame["away_elo"], errors="coerce").to_numpy(dtype=float)
    if "elo_diff" in frame.columns:
        diff = pd.to_numeric(frame["elo_diff"], errors="coerce").to_numpy(dtype=float)
    else:
        diff = home - away
    if not np.isfinite(home).all() or not np.isfinite(away).all():
        return None
    if "neutral_site" in frame.columns:
        neutral = frame["neutral_site"].map(lambda value: bool(value) if pd.notna(value) else False).to_numpy()
    elif "home_field" in frame.columns:
        neutral = pd.to_numeric(frame["home_field"], errors="coerce").fillna(1.0).to_numpy(dtype=float) < 0.5
    else:
        neutral = np.zeros(len(frame), dtype=bool)
    return home, away, neutral, diff


def _guard_inner_dates(fitted: dict, test: pd.DataFrame) -> None:
    test_start = pd.Timestamp(test["game_date"].min())
    for key in ("early_stopping_end", "calibration_end"):
        end = fitted[key]
        if end is not None and pd.Timestamp(end) >= test_start:
            raise LabError(f"{key.replace('_', ' ')} reached the test fold")


def _date_end(frame: pd.DataFrame | None):
    if frame is None or frame.empty:
        return None
    return pd.Timestamp(frame["game_date"].max()).date().isoformat()


def _day(value) -> str:
    return pd.Timestamp(value).date().isoformat()


def design_matrix(frame: pd.DataFrame, bundle: dict) -> np.ndarray:
    """Apply the saved impute and scale. Predict uses this and does not refit it."""
    state = {
        "medians": bundle["medians"],
        "means": bundle["means"],
        "stds": bundle["stds"],
        "impute": bundle["impute"],
        "scale": bundle["scale"],
    }
    matrix = _matrix(frame, list(bundle["features"]), state)
    if matrix is None:
        raise LabError("design matrix is empty")
    return matrix
