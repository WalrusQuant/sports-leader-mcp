"""predict refuses a feature that is not pregame and does not store a market price."""

from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd

from sports_leader_lab import DISCLAIMER
from sports_leader_lab.datasets import build_dataset
from sports_leader_lab.errors import LabError
from sports_leader_lab.features.context import FeatureInputs
from sports_leader_lab.predict import predict
from sports_leader_lab.runs import load_run
from sports_leader_lab.store import RunStore
from sports_leader_lab.training import train_classifier

import pytest


def test_predict_is_as_of_central_time_and_does_not_store_the_price(tmp_path):
    store = RunStore(tmp_path)
    played = _games(2023, 16) + _games(2024, 16)
    upcoming = {
        "game_id": 9001,
        "game_date": "2026-11-29",
        "start_time": "2026-11-29 18:00",
        "season": 2026,
        "season_type": "regular",
        "status": "scheduled",
        "completed": False,
        "home_team_id": 1,
        "away_team_id": 2,
        "home_team_abbr": "GB",
        "away_team_abbr": "CHI",
        "home_score": None,
        "away_score": None,
        "neutral_site": False,
        "venue": "Lambeau",
    }
    inputs = FeatureInputs(league="nfl", games=pd.DataFrame(played + [upcoming]))
    built = build_dataset(
        "nfl", "home_win", [2023, 2024], features=["site", "elo"], inputs=inputs, store=store
    )
    trained = train_classifier(built["dataset_id"], model="logistic", min_train_seasons=1, store=store)
    before = sorted(path.relative_to(tmp_path).as_posix() for path in tmp_path.rglob("*") if path.is_file())
    clock = datetime(2026, 11, 26, 16, 0, tzinfo=ZoneInfo("America/Chicago"))
    result = predict(
        trained["run_id"],
        game_ids=["9001"],
        market_prices=[{"game_id": "9001", "home_implied_prob": 0.42, "source": "caller"}],
        as_of=clock,
        inputs=inputs,
        store=store,
    )
    after = sorted(path.relative_to(tmp_path).as_posix() for path in tmp_path.rglob("*") if path.is_file())
    assert before == after
    blob = "\n".join(path.read_text(encoding="utf-8") for path in tmp_path.rglob("*.json"))
    assert "0.42" not in blob
    assert result["as_of"] == "2026-11-26T16:00:00-06:00"
    assert result["as_of_timezone"] == "America/Chicago"
    assert result["disclaimer"] == DISCLAIMER
    game = result["games"][0]
    assert game["game_id"] == "9001"
    assert game["start_time_ct"].endswith("-06:00")
    assert game["estimate_kind"] == "home_win_probability"
    assert game["market"]["home_implied_prob"] == pytest.approx(0.42)
    assert game["market"]["source"] == "caller"
    assert "not stored" in result["market_note"].lower() or "were not stored" in result["market_note"]


def test_predict_refuses_a_feature_that_is_not_known_before_start(tmp_path):
    store = RunStore(tmp_path)
    inputs = FeatureInputs(league="nfl", games=pd.DataFrame(_games(2023, 12) + _games(2024, 12)))
    built = build_dataset("nfl", "home_win", [2023, 2024], features=["elo"], inputs=inputs, store=store)
    trained = train_classifier(built["dataset_id"], model="logistic", min_train_seasons=1, store=store)
    _bundle, meta = load_run(store, trained["run_id"])
    meta["known_at"]["home_elo"] = "postgame"
    from sports_leader_lab.runs import _write_json

    _write_json(tmp_path / "models" / trained["run_id"] / "meta.json", meta)
    with pytest.raises(LabError, match="not known before start"):
        predict(trained["run_id"], game_ids=["1"], inputs=inputs, store=store)


def test_predict_refuses_a_game_with_no_start_time(tmp_path):
    store = RunStore(tmp_path)
    played = _games(2023, 12) + _games(2024, 12)
    upcoming = _games(2025, 1)[0]
    upcoming["game_id"] = 77
    upcoming["start_time"] = None
    upcoming["completed"] = False
    upcoming["home_score"] = None
    upcoming["away_score"] = None
    inputs = FeatureInputs(league="nfl", games=pd.DataFrame(played + [upcoming]))
    built = build_dataset("nfl", "home_win", [2023, 2024], features=["elo"], inputs=inputs, store=store)
    trained = train_classifier(built["dataset_id"], model="logistic", min_train_seasons=1, store=store)
    with pytest.raises(LabError, match="no start_time"):
        predict(trained["run_id"], game_ids=["77"], inputs=inputs, store=store)


def _games(season: int, n: int) -> list[dict]:
    rows = []
    for index in range(n):
        home_win = index % 2 == 0
        rows.append(
            {
                "game_id": season * 1000 + index,
                "game_date": f"{season}-09-{(index % 27) + 1:02d}",
                "start_time": f"{season}-09-{(index % 27) + 1:02d} {12 + (index % 8):02d}:00",
                "season": season,
                "season_type": "regular",
                "status": "final",
                "completed": True,
                "home_team_id": 1,
                "away_team_id": 2,
                "home_team_abbr": "GB",
                "away_team_abbr": "CHI",
                "home_score": 27 if home_win else 10,
                "away_score": 14 if home_win else 24,
                "neutral_site": False,
                "venue": "Lambeau",
            }
        )
    return rows
