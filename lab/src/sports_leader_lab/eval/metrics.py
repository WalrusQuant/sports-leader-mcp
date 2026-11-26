"""Log loss, Brier, AUC, ECE, and reliability bins.

Log loss, Brier, and AUC are the scikit-learn definitions. ECE and the bins
are equal-width on [0, 1]; scikit-learn does not ship an ECE.
"""

from __future__ import annotations

import numpy as np
from sklearn.metrics import (
    brier_score_loss,
    log_loss,
    mean_absolute_error,
    mean_poisson_deviance,
    roc_auc_score,
    root_mean_squared_error,
)


def classification_scores(y_true, y_prob, *, n_bins: int = 10, with_bins: bool = True) -> dict:
    y = np.asarray(y_true, dtype=float)
    probability = np.clip(np.asarray(y_prob, dtype=float), 0.0, 1.0)
    if len(y) == 0:
        return {
            "log_loss": None,
            "brier": None,
            "auc": None,
            "ece": None,
            "reliability_bins": [] if with_bins else None,
        }
    scores = {
        "log_loss": float(log_loss(y, probability, labels=[0, 1])),
        "brier": float(brier_score_loss(y, probability)),
        "auc": _auc(y, probability),
        "ece": expected_calibration_error(y, probability, n_bins=n_bins),
    }
    if with_bins:
        scores["reliability_bins"] = reliability_bins(y, probability, n_bins=n_bins)
    return scores


def regression_scores(y_true, y_pred, *, count: bool = False) -> dict:
    y = np.asarray(y_true, dtype=float)
    pred = np.asarray(y_pred, dtype=float)
    residual = y - pred
    deviance = None
    if count and len(y) and np.all(y >= 0) and np.all(pred > 0):
        deviance = float(mean_poisson_deviance(y, pred))
    return {
        "mae": float(mean_absolute_error(y, pred)) if len(y) else None,
        "rmse": float(root_mean_squared_error(y, pred)) if len(y) else None,
        "residual_sd": float(np.std(residual, ddof=1)) if len(y) > 1 else None,
        "poisson_deviance": deviance,
    }


def reliability_bins(y_true, y_prob, *, n_bins: int = 10) -> list[dict]:
    """Equal-width bins on [0, 1]. The last bin includes 1."""
    y = np.asarray(y_true, dtype=float)
    probability = np.clip(np.asarray(y_prob, dtype=float), 0.0, 1.0)
    if n_bins < 1:
        raise ValueError("n_bins must be >= 1")
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    indexes = np.digitize(probability, edges[1:-1], right=False) if n_bins > 1 else np.zeros(len(y), dtype=int)
    rows = []
    for index in range(n_bins):
        mask = indexes == index
        count = int(mask.sum())
        rows.append(
            {
                "bin": index,
                "lo": float(edges[index]),
                "hi": float(edges[index + 1]),
                "count": count,
                "confidence": float(probability[mask].mean()) if count else None,
                "accuracy": float(y[mask].mean()) if count else None,
            }
        )
    return rows


def expected_calibration_error(y_true, y_prob, *, n_bins: int = 10) -> float | None:
    y = np.asarray(y_true, dtype=float)
    if len(y) == 0:
        return None
    total = 0.0
    for row in reliability_bins(y, y_prob, n_bins=n_bins):
        if not row["count"]:
            continue
        total += (row["count"] / len(y)) * abs(row["accuracy"] - row["confidence"])
    return float(total)


def _auc(y: np.ndarray, probability: np.ndarray) -> float | None:
    if len(np.unique(y)) < 2:
        return None
    return float(roc_auc_score(y, probability))
