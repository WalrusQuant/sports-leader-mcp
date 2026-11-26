"""Constant rate, home-field rate, and as-of Elo baselines.

Elo win probability uses the pregame ratings and the same home advantage as
the Elo feature (added only when the site is not neutral). Elo-implied margin
is a line fit on the training fold only: margin = a + b * elo_diff.
"""

from __future__ import annotations

import numpy as np

from sports_leader_lab.features.elo import ELO_HOME_ADV


def constant_rate(y_train) -> float:
    y = np.asarray(y_train, dtype=float)
    if len(y) == 0:
        return 0.5
    return float(np.mean(y))


def home_field_rate(y_train, home_train, home_test) -> np.ndarray:
    """Training mean of y at home, and the training mean when not at home.

    `home_*` is true when the row is a non-neutral home game. A side with no
    training rows falls back to the overall mean.
    """
    y = np.asarray(y_train, dtype=float)
    home = np.asarray(home_train, dtype=bool)
    asked = np.asarray(home_test, dtype=bool)
    overall = constant_rate(y)
    home_mean = float(np.mean(y[home])) if len(y) and home.any() else overall
    away_mean = float(np.mean(y[~home])) if len(y) and (~home).any() else overall
    return np.where(asked, home_mean, away_mean).astype(float)


def elo_win_probability(home_elo, away_elo, neutral, *, home_adv: float = ELO_HOME_ADV) -> np.ndarray:
    home = np.asarray(home_elo, dtype=float)
    away = np.asarray(away_elo, dtype=float)
    neutral_site = np.asarray(neutral, dtype=bool)
    advantage = np.where(neutral_site, 0.0, home_adv)
    return 1.0 / (1.0 + 10.0 ** ((away - (home + advantage)) / 400.0))


def elo_implied_margin(elo_diff_train, y_train, elo_diff_test) -> np.ndarray:
    """Least squares of the target on elo_diff, fit on the training fold only."""
    diff = np.asarray(elo_diff_train, dtype=float)
    y = np.asarray(y_train, dtype=float)
    asked = np.asarray(elo_diff_test, dtype=float)
    if len(diff) < 2 or np.allclose(diff, diff[0]):
        return np.full(len(asked), constant_rate(y) if len(y) else 0.0)
    design = np.column_stack([np.ones(len(diff)), diff])
    coef, *_ = np.linalg.lstsq(design, y, rcond=None)
    return coef[0] + coef[1] * asked


def fails_to_beat(model_score, baseline_score, *, lower_is_better: bool = True) -> bool | None:
    """True when the model is worse than the baseline. A tie is not a failure."""
    if model_score is None or baseline_score is None:
        return None
    if lower_is_better:
        return bool(model_score > baseline_score)
    return bool(model_score < baseline_score)
