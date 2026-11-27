"""One live check against the public sportsleader-data release.

Skipped unless SPORTSLEADER_LAB_LIVE=1. The offline suite never downloads.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

import pandas as pd
import pytest
from pandas.testing import assert_series_equal

from sports_leader_lab import DISCLAIMER
from sports_leader_lab.config import load_config
from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.data.catalog import DATASETS, LEAGUES
from sports_leader_lab.data.views import open_duckdb, read_view, register_views
from sports_leader_lab.datasets import build_dataset
from sports_leader_lab.features.context import FeatureInputs
from sports_leader_lab.features.registry import build_features
from sports_leader_lab.predict import predict
from sports_leader_lab.query import inspect_data, query_data
from sports_leader_lab.splits import walk_forward
from sports_leader_lab.store import RunStore
from sports_leader_lab.training import train_classifier, train_regressor

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        os.environ.get("SPORTSLEADER_LAB_LIVE") != "1",
        reason="set SPORTSLEADER_LAB_LIVE=1 to download sportsleader-data",
    ),
]


def test_nfl_2023_2024_games_and_team_stats(tmp_path):
    config = load_config(
        {
            "SPORTSLEADER_LAB_CACHE_DIR": str(tmp_path / "cache"),
            "SPORTSLEADER_LAB_RUN_DIR": str(tmp_path / "runs"),
        }
    )
    cache = DataCache(config)
    manifest = cache.load_manifest()
    assert set(DATASETS) <= manifest.datasets()
    assert set(LEAGUES) <= manifest.leagues()

    con = open_duckdb()
    views = register_views(
        con,
        cache,
        leagues=["nfl"],
        datasets=["games", "team_game_stats"],
        seasons=[2023, 2024],
        manifest=manifest,
    )
    assert {view.name for view in views} == {"nfl_games", "nfl_team_game_stats"}
    by_path = {file.path: file for file in manifest.files}
    for view in views:
        for path in view.paths:
            rel = path.split("/files/", 1)[1]
            entry = by_path[rel]
            assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == entry.sha256
            first_mtime = os.stat(path).st_mtime_ns
            cache.ensure(entry)
            assert os.stat(path).st_mtime_ns == first_mtime

    games = read_view(con, "nfl_games")
    stats = read_view(con, "nfl_team_game_stats")
    games_2023 = read_view(con, "nfl_games", seasons=[2023])
    assert len(games_2023) > 100
    assert set(games["season"]) == {2023, 2024}
    assert len(games_2023) + len(read_view(con, "nfl_games", seasons=[2024])) == len(games)
    assert {"game_id", "game_date", "start_time", "home_team_id", "away_team_id", "home_score", "away_score"} <= set(games.columns)
    assert {"team_id", "opponent_id", "game_date", "score", "total_yards", "plays"} <= set(stats.columns)

    built = build_features(
        FeatureInputs(league="nfl", games=games, team_game_stats=stats),
        names=["team_form", "rest", "site", "elo"],
    )
    earliest = built.frame.sort_values(["game_date", "start_time", "game_id"]).iloc[0]
    assert earliest["home_elo"] == pytest.approx(1500.0)
    assert earliest["away_elo"] == pytest.approx(1500.0)
    assert "home_roll_yards_per_play" in built.feature_names
    assert not any("yards_per_play skipped" in warning for warning in built.warnings)

    target = built.frame.sort_values(["game_date", "start_time"]).iloc[len(built.frame) // 2]
    later_ids = _later_ids(games, target["game_id"])
    assert target["game_id"] in later_ids
    scrubbed_games = _scrub_games(games, later_ids)
    original_score = games.loc[games["game_id"] == target["game_id"], "home_score"].iloc[0]
    scrubbed_score = scrubbed_games.loc[scrubbed_games["game_id"] == target["game_id"], "home_score"].iloc[0]
    assert scrubbed_score != original_score
    scrubbed = build_features(
        FeatureInputs(
            league="nfl",
            games=scrubbed_games,
            team_game_stats=_scrub_stats(stats, later_ids),
        ),
        names=["team_form", "rest", "site", "elo"],
    )
    columns = built.feature_names
    assert_series_equal(
        built.frame.set_index("game_id").loc[target["game_id"], columns],
        scrubbed.frame.set_index("game_id").loc[target["game_id"], columns],
        check_names=False,
    )

    folds = walk_forward(built.frame, scheme="season", min_train_seasons=1)
    assert len(folds) == 1
    assert folds[0].train_seasons == (2023,)
    assert folds[0].test_seasons == (2024,)
    assert folds[0].test_start > folds[0].train_end
    assert folds[0].train_rows > 100
    assert folds[0].test_rows > 100
    assert "betting" not in " ".join(built.warnings).lower()


def test_p2_tools_run_on_nfl_2023_2024(tmp_path):
    cache = DataCache(load_config())
    store = RunStore(tmp_path / "runs")
    inspected = inspect_data("nfl", "games", [2024], cache=cache)
    assert inspected["rows"] > 100
    assert inspected["disclaimer"] == DISCLAIMER
    scores = [column for column in inspected["columns"] if column["name"] == "home_score"]
    assert scores and scores[0]["timing"] == "postgame"
    queried = query_data(
        "SELECT game_id, home_team_abbr, home_score FROM nfl_games",
        max_rows=5,
        seasons=[2024],
        cache=cache,
    )
    assert queried["row_count"] == 5
    assert queried["truncated"] is True
    assert "home_score" in queried["columns"]
    assert queried["disclaimer"] == DISCLAIMER

    wins = build_dataset(
        "nfl",
        "home_win",
        [2023, 2024],
        features=["site", "elo"],
        store=store,
        cache=cache,
    )
    assert wins["rows"] > 200
    assert wins["audit"]["ok"] is True
    classified = train_classifier(wins["dataset_id"], model="logistic", min_train_seasons=1, store=store)
    assert classified["pooled"]["model"]["log_loss"] is not None
    assert classified["pooled"]["elo"]["log_loss"] is not None
    assert classified["folds"][0]["test_seasons"] == [2024]
    assert classified["disclaimer"] == DISCLAIMER

    margins = build_dataset(
        "nfl",
        "margin",
        [2023, 2024],
        features=["site", "elo"],
        store=store,
        cache=cache,
    )
    regressed = train_regressor(margins["dataset_id"], model="ridge", min_train_seasons=1, store=store)
    assert regressed["pooled"]["model"]["mae"] is not None
    assert regressed["pooled"]["elo"]["mae"] is not None

    game_id = str(queried["rows"][0]["game_id"])
    scored = predict(classified["run_id"], game_ids=[game_id], store=store, cache=cache)
    game = scored["games"][0]
    assert scored["as_of_timezone"] == "America/Chicago"
    assert scored["disclaimer"] == DISCLAIMER
    assert game["game_id"] == game_id
    assert isinstance(game["estimate"], float)
    assert "implied_home_win_prob" not in game
    assert game["market"] is None


def _later_ids(games: pd.DataFrame, game_id: object) -> set[object]:
    starts = pd.to_datetime(games["start_time"], utc=True)
    cutoff = starts.loc[games["game_id"] == game_id].iloc[0]
    return set(games.loc[starts >= cutoff, "game_id"].tolist())


def _scrub_games(games: pd.DataFrame, later_ids: set[object]) -> pd.DataFrame:
    frame = games.copy()
    later = frame["game_id"].isin(later_ids)
    away = pd.to_numeric(frame.loc[later, "away_score"], errors="coerce").fillna(0).to_numpy()
    frame.loc[later, "home_score"] = away + 40
    frame.loc[later, "away_score"] = 1
    return frame


def _scrub_stats(stats: pd.DataFrame, later_ids: set[object]) -> pd.DataFrame:
    frame = stats.copy()
    later = frame["game_id"].isin(later_ids)
    frame.loc[later, "total_yards"] = 1
    frame.loc[later, "plays"] = 1
    frame.loc[later, "score"] = 1
    return frame
