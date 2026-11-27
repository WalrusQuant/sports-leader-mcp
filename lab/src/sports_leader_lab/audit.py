"""Leakage checks shared by build_dataset and audit_features.

A failed check is NOT CLEAN. A pass, including a high-AUC warning, is
REVIEW REQUIRED. The automated check never returns CLEAN.
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
# Compare the non-null overlap once it has this many rows. A shorter frame
# is compared only when every row overlaps, so a four-row fixture still fails.
_OVERLAP_MIN = 30


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
    stats: pd.DataFrame | None = None,
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
        elif _affine(series, target):
            failures.append(f"{name} is an affine copy of the target")
        for banned in _copy_columns(frame):
            if _same(series, frame[banned]):
                failures.append(f"{name} copies {banned}")
            elif _affine(series, frame[banned]):
                failures.append(f"{name} is an affine copy of {banned}")
        if margin is not None and _same(series, margin):
            failures.append(f"{name} copies the score margin")
        elif margin is not None and _affine(series, margin):
            failures.append(f"{name} is an affine copy of the score margin")
        if total is not None and _same(series, total):
            failures.append(f"{name} copies the score total")
        elif total is not None and _affine(series, total):
            failures.append(f"{name} is an affine copy of the score total")
        for column in _same_game_box_stats(series, frame, stats):
            failures.append(f"{name} copies same-game box stat {column}")
        if _after_start(series, frame):
            failures.append(f"{name} has timestamps after start_time")
        suspicious = _suspicious_auc(name, series, target)
        if suspicious:
            warnings.append(suspicious)
    return AuditReport(ok=not failures, failures=_unique(failures), warnings=_unique(warnings))


_STAT_KEYS = frozenset(
    {
        "game_id",
        "team_id",
        "team_abbr",
        "team_name",
        "season",
        "season_type",
        "league",
        "opponent_id",
        "opponent_team_id",
        "opponent_abbr",
        "opponent_name",
        "home_away",
        "is_home",
        "start_time",
        "game_date",
        "home_team_id",
        "home_team_abbr",
        "home_team_name",
        "away_team_id",
        "away_team_abbr",
        "away_team_name",
    }
)


def _same_game_box_stats(series: pd.Series, frame: pd.DataFrame, stats: pd.DataFrame | None) -> list[str]:
    """Same-game home or away stat columns that match this feature on every row."""
    if stats is None or stats.empty:
        return []
    if "game_id" not in stats.columns or "team_id" not in stats.columns or "game_id" not in frame.columns:
        return []
    found: list[str] = []
    for side in ("home_team_id", "away_team_id"):
        if side not in frame.columns:
            continue
        keys = frame[["game_id", side]].drop_duplicates("game_id")
        joined = stats.merge(keys, left_on=["game_id", "team_id"], right_on=["game_id", side], how="inner")
        if joined.empty:
            continue
        aligned = joined.drop_duplicates("game_id").set_index("game_id")
        for column in aligned.columns:
            if column in _STAT_KEYS:
                continue
            mapped = frame["game_id"].map(aligned[column])
            if _same(series, pd.Series(mapped.to_numpy(), index=series.index)):
                found.append(str(column))
    return list(dict.fromkeys(found))


def _copy_columns(frame: pd.DataFrame) -> list[str]:
    """Score columns. `completed` is constant on the rows that reach the audit, so it is not a copy target."""
    columns: list[str] = []
    for name in ("home_score", "away_score", "score", "opponent_score"):
        if name in frame.columns and name not in columns:
            columns.append(name)
    return columns


def _paired(series: pd.Series, other: pd.Series) -> tuple[np.ndarray, np.ndarray] | None:
    """Non-null overlap of at least 30 rows, or every row when the frame is shorter."""
    left = pd.to_numeric(series, errors="coerce")
    right = pd.to_numeric(other, errors="coerce")
    if len(left) == 0 or len(left) != len(right):
        return None
    both = (left.notna() & right.notna()).to_numpy()
    count = int(both.sum())
    needed = min(_OVERLAP_MIN, len(left))
    if count < needed:
        return None
    return left.to_numpy(dtype=float)[both], right.to_numpy(dtype=float)[both]


def _distinct(values: np.ndarray) -> int:
    """Distinct values after rounding, so a near-constant column counts as one value."""
    if values.size == 0:
        return 0
    return int(np.unique(np.round(values, 8)).size)


def _same(series: pd.Series, other: pd.Series) -> bool:
    paired = _paired(series, other)
    if paired is None:
        return False
    left, right = paired
    # Two constants match by arithmetic and carry no information about leakage.
    if _distinct(left) < 2 or _distinct(right) < 2:
        return False
    return bool(np.allclose(left, right))


def _affine(series: pd.Series, other: pd.Series) -> bool:
    """True when the feature is a*column + b on the overlap, and not a constant or an exact copy."""
    paired = _paired(series, other)
    if paired is None:
        return False
    left, right = paired
    if _distinct(left) < 2 or _distinct(right) < 2:
        return False
    design = np.column_stack([right, np.ones(len(right))])
    coef, _, _, _ = np.linalg.lstsq(design, left, rcond=None)
    slope = float(coef[0])
    intercept = float(coef[1])
    if abs(slope) <= 1e-8:
        return False
    if np.allclose(slope, 1.0) and np.allclose(intercept, 0.0):
        return False
    return bool(np.allclose(design @ coef, left))


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
