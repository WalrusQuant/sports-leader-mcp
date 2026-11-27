"""Leakage checks run when a dataset is saved.

This is not the standalone audit_features tool. build_dataset calls it and
refuses to write the dataset when a check fails. A single feature with a very
high AUC is a warning, not a failure.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score

from sports_leader_lab.features.registry import POSTGAME_COLUMNS

PREGAME_KNOWN = frozenset({"schedule", "prior_games", "as_of_start"})
FORBIDDEN_NAMES = frozenset(POSTGAME_COLUMNS) | {"score", "opponent_score", "target"}
_AUC_WARN = 0.95


@dataclass
class AuditReport:
    ok: bool
    failures: list[str]
    warnings: list[str]

    def to_dict(self) -> dict:
        return {"ok": self.ok, "failures": list(self.failures), "warnings": list(self.warnings)}


def audit_dataset(
    frame: pd.DataFrame,
    feature_columns: list[str],
    target_column: str,
    column_meta: dict,
) -> AuditReport:
    failures: list[str] = []
    warnings: list[str] = []
    target = pd.to_numeric(frame[target_column], errors="coerce")
    margin = None
    total = None
    if "home_score" in frame.columns and "away_score" in frame.columns:
        home = pd.to_numeric(frame["home_score"], errors="coerce")
        away = pd.to_numeric(frame["away_score"], errors="coerce")
        margin = home - away
        total = home + away
    for name in feature_columns:
        meta = column_meta.get(name) or {}
        known = meta.get("known_at")
        if known not in PREGAME_KNOWN:
            failures.append(
                f"{name} known_at is {known!r}; a feature must be schedule, prior_games, or as_of_start"
            )
        if str(name).lower() in FORBIDDEN_NAMES:
            failures.append(f"{name} is a postgame column and cannot be a feature")
        series = frame[name]
        if _same(series, target):
            failures.append(f"{name} copies the target")
        for banned in ("home_score", "away_score", "score", "opponent_score"):
            if banned in frame.columns and _same(series, frame[banned]):
                failures.append(f"{name} copies {banned}")
        if margin is not None and _same(series, margin):
            failures.append(f"{name} copies the score margin")
        if total is not None and _same(series, total):
            failures.append(f"{name} copies the score total")
        if _after_start(series, frame):
            failures.append(f"{name} has timestamps after start_time")
        suspicious = _suspicious_auc(name, series, target)
        if suspicious:
            warnings.append(suspicious)
    return AuditReport(ok=not failures, failures=_unique(failures), warnings=_unique(warnings))


def _same(series: pd.Series, other: pd.Series) -> bool:
    left = pd.to_numeric(series, errors="coerce")
    right = pd.to_numeric(other, errors="coerce")
    if len(left) == 0:
        return False
    both = left.notna() & right.notna()
    if int(both.sum()) != len(left):
        return False
    return bool(np.allclose(left.to_numpy(dtype=float), right.to_numpy(dtype=float)))


def _after_start(series: pd.Series, frame: pd.DataFrame) -> bool:
    if "start_time" not in frame.columns:
        return False
    if pd.api.types.is_numeric_dtype(series):
        return False
    if not (pd.api.types.is_datetime64_any_dtype(series) or series.dtype == object):
        return False
    parsed = pd.to_datetime(series, utc=True, format="mixed", errors="coerce")
    if parsed.notna().mean() < 0.8:
        return False
    start = pd.to_datetime(frame["start_time"], utc=True, format="mixed", errors="coerce")
    return bool((parsed > start).fillna(False).any())


def _suspicious_auc(name: str, series: pd.Series, target: pd.Series) -> str | None:
    y = target.to_numpy(dtype=float)
    finite = y[np.isfinite(y)]
    if len(np.unique(finite)) != 2 or not set(np.unique(finite)).issubset({0.0, 1.0}):
        return None
    values = pd.to_numeric(series, errors="coerce")
    if int(values.notna().sum()) < 20 or int(values.nunique(dropna=True)) < 2:
        return None
    filled = values.fillna(values.median()).to_numpy(dtype=float)
    score = float(roc_auc_score(y, filled))
    if max(score, 1.0 - score) >= _AUC_WARN:
        return f"{name} has single-feature AUC {score:.3f}; check it for leakage"
    return None


def _unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))
