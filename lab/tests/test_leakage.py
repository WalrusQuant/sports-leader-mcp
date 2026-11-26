"""Scrubbing a game and everything after it must not change that game's features."""

from __future__ import annotations

import pandas as pd
from pandas.testing import assert_series_equal

from sports_leader_lab.features.context import FeatureInputs
from sports_leader_lab.features.registry import build_features
from tests.test_features import _inputs


def test_no_feature_changes_when_this_game_and_the_future_are_scrubbed():
    inputs = _inputs()
    original = build_features(inputs, rolling_window=2, ewma_span=2)
    features = original.feature_names
    ordered = original.frame.sort_values(["game_date", "start_time", "game_id"])
    for game_id in ordered["game_id"].tolist():
        mutated = build_features(_scrub(inputs, int(game_id)), rolling_window=2, ewma_span=2)
        left = original.frame.set_index("game_id").loc[game_id, features]
        right = mutated.frame.set_index("game_id").loc[game_id, features]
        assert_series_equal(left, right, check_names=False)


def test_an_earlier_result_does_change_the_next_games_form_and_elo():
    inputs = _inputs()
    original = build_features(inputs, rolling_window=2, ewma_span=2).frame.set_index("game_id")
    games = inputs.games.copy()
    games.loc[games["game_id"] == 2, "home_score"] = 0
    games.loc[games["game_id"] == 2, "away_score"] = 10
    changed = build_features(
        FeatureInputs(
            league="mlb",
            games=games,
            team_game_stats=inputs.team_game_stats,
            injuries=inputs.injuries,
            probables=inputs.probables,
        ),
        rolling_window=2,
        ewma_span=2,
    ).frame.set_index("game_id")
    assert changed.loc[2, "home_elo"] == original.loc[2, "home_elo"]
    assert changed.loc[3, "home_elo"] != original.loc[3, "home_elo"]
    assert changed.loc[3, "home_roll_points_for"] != original.loc[3, "home_roll_points_for"]


def _scrub(inputs: FeatureInputs, game_id: int) -> FeatureInputs:
    games = inputs.games.copy()
    start = pd.Timestamp(games.loc[games["game_id"] == game_id, "start_time"].iloc[0])
    later = pd.to_datetime(games["start_time"]) >= start
    away = games.loc[later, "away_score"].to_numpy()
    games.loc[later, "home_score"] = away + 50
    games.loc[later, "away_score"] = 1
    later_ids = set(games.loc[later, "game_id"].tolist())
    stats = inputs.team_game_stats.copy()
    stats.loc[stats["game_id"].isin(later_ids), "hits"] = 99
    stats.loc[stats["game_id"].isin(later_ids), "at_bats"] = 100
    extra = {
        "game_id": 999,
        "game_date": "2023-04-20",
        "start_time": "2023-04-20 18:00",
        "season": 2023,
        "season_type": "regular",
        "home_team_id": 1,
        "away_team_id": 2,
        "home_score": 80,
        "away_score": 0,
        "neutral_site": False,
        "venue_city": "CityZ",
        "completed": True,
    }
    games = pd.concat([games, pd.DataFrame([extra])], ignore_index=True)
    injuries = pd.concat(
        [
            inputs.injuries,
            pd.DataFrame(
                [
                    {
                        "season": 2023,
                        "team_id": 1,
                        "player_id": 500,
                        "game_id": game_id,
                        "valid_from": (start + pd.Timedelta(hours=2)).isoformat(),
                        "valid_to": pd.NaT,
                    }
                ]
            ),
        ],
        ignore_index=True,
    )
    probables = pd.concat(
        [
            inputs.probables,
            pd.DataFrame(
                [
                    {
                        "season": 2023,
                        "game_id": game_id,
                        "team_id": 1,
                        "player_id": 500,
                        "valid_from": (start + pd.Timedelta(hours=2)).isoformat(),
                        "valid_to": pd.NaT,
                    }
                ]
            ),
        ],
        ignore_index=True,
    )
    return FeatureInputs(
        league="mlb",
        games=games,
        team_game_stats=stats,
        injuries=injuries,
        probables=probables,
    )
