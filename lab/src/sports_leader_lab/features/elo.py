"""As-of Elo. The rating on a game is the rating before that game is applied."""

from __future__ import annotations

import math

import pandas as pd

from sports_leader_lab.features.context import FeatureContext

ELO_K = 20.0
ELO_HOME_ADV = 60.0
ELO_INITIAL = 1500.0

ELO_COLUMNS = ("home_elo", "away_elo", "elo_diff")


def expected_score(rating: float, opponent: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((opponent - rating) / 400.0))


def build_elo(ctx: FeatureContext) -> pd.DataFrame:
    games = ctx.games
    ratings: dict[object, float] = {}
    home_elo: list[float] = []
    away_elo: list[float] = []
    for row in games.itertuples(index=False):
        home = _rating(ratings, row.home_team_id, ctx.elo_initial)
        away = _rating(ratings, row.away_team_id, ctx.elo_initial)
        home_elo.append(home)
        away_elo.append(away)
        if not bool(row.in_history):
            continue
        # Home advantage is used only for the expected score, and only when
        # the site is not neutral. It is not stored in the rating.
        advantage = 0.0 if _is_neutral(row.neutral_site) else ctx.elo_home_adv
        expected = expected_score(home + advantage, away)
        actual = _actual(float(row.home_score), float(row.away_score))
        ratings[row.home_team_id] = home + ctx.elo_k * (actual - expected)
        ratings[row.away_team_id] = away + ctx.elo_k * ((1.0 - actual) - (1.0 - expected))
    return pd.DataFrame(
        {
            "game_id": games["game_id"].to_numpy(),
            "home_elo": home_elo,
            "away_elo": away_elo,
            "elo_diff": [home - away for home, away in zip(home_elo, away_elo)],
        }
    )


def _rating(ratings: dict[object, float], team_id: object, initial: float) -> float:
    return ratings.get(team_id, initial)


def _actual(home_score: float, away_score: float) -> float:
    if home_score > away_score:
        return 1.0
    if home_score < away_score:
        return 0.0
    return 0.5


def _is_neutral(value: object) -> bool:
    if value is None or value is pd.NA:
        return False
    try:
        if isinstance(value, float) and math.isnan(value):
            return False
    except Exception:
        return False
    return bool(value)
