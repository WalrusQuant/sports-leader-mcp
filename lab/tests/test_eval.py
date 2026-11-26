"""Metrics match scikit-learn on fixed inputs. ECE is checked by hand."""

import numpy as np
import pytest
from sklearn.metrics import brier_score_loss, log_loss, mean_poisson_deviance, roc_auc_score

from sports_leader_lab.eval import (
    classification_scores,
    constant_rate,
    elo_implied_margin,
    elo_win_probability,
    fails_to_beat,
    home_field_rate,
    regression_scores,
)
from sports_leader_lab.features.elo import expected_score


def test_classification_metrics_match_sklearn_on_fixed_inputs():
    y = np.array([0, 0, 1, 1, 1, 0])
    probability = np.array([0.1, 0.2, 0.7, 0.8, 0.9, 0.4])
    scores = classification_scores(y, probability, n_bins=2)
    assert scores["log_loss"] == pytest.approx(log_loss(y, probability, labels=[0, 1]))
    assert scores["brier"] == pytest.approx(brier_score_loss(y, probability))
    assert scores["auc"] == pytest.approx(roc_auc_score(y, probability))
    # Two equal-width bins. 0.1 and 0.2 and 0.4 are in [0, 0.5); the rest in [0.5, 1].
    # Bin 0: y = 0, 0, 0, confidence 0.2333..., accuracy 0.
    # Bin 1: y = 1, 1, 1, confidence 0.8, accuracy 1.
    low = np.array([0.1, 0.2, 0.4])
    assert scores["reliability_bins"][0]["count"] == 3
    assert scores["reliability_bins"][0]["confidence"] == pytest.approx(low.mean())
    assert scores["reliability_bins"][0]["accuracy"] == pytest.approx(0.0)
    assert scores["reliability_bins"][1]["count"] == 3
    assert scores["reliability_bins"][1]["confidence"] == pytest.approx(0.8)
    assert scores["reliability_bins"][1]["accuracy"] == pytest.approx(1.0)
    expected_ece = 0.5 * abs(0.0 - low.mean()) + 0.5 * abs(1.0 - 0.8)
    assert scores["ece"] == pytest.approx(expected_ece)


def test_two_point_ece_is_the_weighted_gap():
    scores = classification_scores([0, 1], [0.2, 0.8], n_bins=2)
    assert scores["ece"] == pytest.approx(0.2)


def test_poisson_deviance_matches_sklearn():
    y = np.array([0, 1, 2, 3])
    pred = np.array([0.5, 1.0, 1.5, 2.5])
    scores = regression_scores(y, pred, count=True)
    assert scores["poisson_deviance"] == pytest.approx(mean_poisson_deviance(y, pred))
    assert scores["mae"] == pytest.approx(np.mean(np.abs(y - pred)))


def test_baselines_and_the_elo_flag():
    assert constant_rate([1, 0, 1, 0]) == pytest.approx(0.5)
    home = home_field_rate([1, 1, 0, 0], [True, True, False, False], [True, False])
    assert home == pytest.approx([1.0, 0.0])
    probability = elo_win_probability([1600], [1500], [False], home_adv=60)
    assert probability[0] == pytest.approx(expected_score(1660, 1500))
    margin = elo_implied_margin([0, 100], [0, 10], [50])
    assert margin[0] == pytest.approx(5.0)
    assert fails_to_beat(0.70, 0.60) is True
    assert fails_to_beat(0.50, 0.60) is False
    assert fails_to_beat(0.60, 0.60) is False
