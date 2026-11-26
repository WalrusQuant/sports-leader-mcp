"""build_dataset saves a clean frame and refuses a leak."""

import pandas as pd
import pytest

from sports_leader_lab.datasets import build_dataset
from sports_leader_lab.errors import LabError
from sports_leader_lab.features.context import FeatureInputs, KnownAt
from sports_leader_lab.features.registry import FeatureSpec, default_registry
from sports_leader_lab.store import RunStore


def test_build_dataset_saves_pregame_features_and_the_disclaimer(tmp_path):
    store = RunStore(tmp_path)
    result = build_dataset(
        "nfl",
        "home_win",
        [2023],
        features=["site", "elo"],
        inputs=FeatureInputs(league="nfl", games=_games(6)),
        store=store,
    )
    assert result["rows"] == 6
    assert result["decision_time"] == "pregame"
    assert result["audit"]["ok"] is True
    assert "not a recommendation to bet" in result["disclaimer"].lower()
    names = {feature["name"] for feature in result["features"]}
    assert "home_elo" in names
    assert "home_score" not in names
    saved = pd.read_parquet(tmp_path / "datasets" / result["dataset_id"] / "data.parquet")
    assert "home_score" not in saved.columns
    assert "target" in saved.columns
    assert (tmp_path / "datasets" / result["dataset_id"] / "meta.json").is_file()


def test_build_dataset_refuses_a_score_copy_and_writes_nothing(tmp_path):
    store = RunStore(tmp_path)
    registry = default_registry()
    registry.register(
        FeatureSpec(
            name="copied",
            description="the score",
            known_at=KnownAt.PRIOR_GAMES,
            datasets=frozenset({"games"}),
            builder=lambda ctx: pd.DataFrame(
                {"game_id": ctx.games["game_id"], "copied": ctx.games["home_score"]}
            ),
            columns=("copied",),
        )
    )
    with pytest.raises(LabError, match="audit failed"):
        build_dataset(
            "nfl",
            "margin",
            [2023],
            features=["copied"],
            inputs=FeatureInputs(league="nfl", games=_games(4)),
            store=store,
            registry=registry,
        )
    assert list(tmp_path.rglob("*.parquet")) == []


def test_build_dataset_refuses_a_timestamp_after_start(tmp_path):
    store = RunStore(tmp_path)
    registry = default_registry()

    def leaked(ctx):
        start = pd.to_datetime(ctx.games["start_time"], utc=True)
        return pd.DataFrame({"game_id": ctx.games["game_id"], "after_start": start + pd.Timedelta(hours=3)})

    registry.register(
        FeatureSpec(
            name="late",
            description="after the game",
            known_at=KnownAt.SCHEDULE,
            datasets=frozenset({"games"}),
            builder=leaked,
            columns=("after_start",),
        )
    )
    with pytest.raises(LabError, match="after start_time"):
        build_dataset(
            "nfl",
            "home_win",
            [2023],
            features=["late"],
            inputs=FeatureInputs(league="nfl", games=_games(4)),
            store=store,
            registry=registry,
        )
    assert list(tmp_path.rglob("*.parquet")) == []


def test_build_dataset_refuses_sql_that_names_a_score(tmp_path):
    store = RunStore(tmp_path)
    games = _games(3)
    with pytest.raises(LabError, match="postgame"):
        build_dataset(
            "nfl",
            "home_win",
            [2023],
            features=[],
            sql_features=[
                {
                    "name": "leaked",
                    "sql": "SELECT game_id, home_score AS leaked FROM nfl_games",
                    "columns": ["leaked"],
                    "known_at": "schedule",
                }
            ],
            inputs=FeatureInputs(league="nfl", games=games),
            store=store,
        )
    assert list(tmp_path.rglob("*.parquet")) == []


def test_build_dataset_warns_on_a_single_feature_with_high_auc(tmp_path):
    store = RunStore(tmp_path)
    games = _games(24)
    home = games["home_score"].to_numpy()
    away = games["away_score"].to_numpy()
    almost = (home > away).astype(float)
    almost[0] = 1.0 - almost[0]

    def builder(ctx, values=almost):
        return pd.DataFrame({"game_id": ctx.games["game_id"].to_numpy(), "almost": values})

    registry = default_registry()
    registry.register(
        FeatureSpec(
            name="almost",
            description="nearly the target",
            known_at=KnownAt.PRIOR_GAMES,
            datasets=frozenset({"games"}),
            builder=builder,
            columns=("almost",),
        )
    )
    result = build_dataset(
        "nfl",
        "home_win",
        [2023],
        features=["almost"],
        inputs=FeatureInputs(league="nfl", games=games),
        store=store,
        registry=registry,
    )
    assert result["audit"]["ok"] is True
    assert any("AUC" in warning for warning in result["audit"]["warnings"])
    assert (tmp_path / "datasets" / result["dataset_id"] / "data.parquet").is_file()


def test_margin_total_and_team_points_targets(tmp_path):
    store = RunStore(tmp_path)
    games = _games(4)
    margin = build_dataset(
        "nfl", "margin", [2023], features=["elo"], inputs=FeatureInputs(league="nfl", games=games), store=store
    )
    assert margin["rows"] == 4
    total = build_dataset(
        "nfl", "total", [2023], features=["elo"], inputs=FeatureInputs(league="nfl", games=games), store=store
    )
    points = build_dataset(
        "nfl",
        "team_points",
        [2023],
        features=["elo"],
        inputs=FeatureInputs(league="nfl", games=games),
        store=store,
    )
    assert any("home team's points" in warning for warning in points["warnings"])
    assert total["rows"] == 4


def _games(n: int, season: int = 2023) -> pd.DataFrame:
    rows = []
    for index in range(n):
        home_win = index % 2 == 0
        rows.append(
            {
                "game_id": season * 100 + index,
                "game_date": f"{season}-09-{(index % 27) + 1:02d}",
                "start_time": f"{season}-09-{(index % 27) + 1:02d} 18:00",
                "season": season,
                "season_type": "regular",
                "status": "final",
                "completed": True,
                "home_team_id": 1 if index % 2 == 0 else 2,
                "away_team_id": 2 if index % 2 == 0 else 1,
                "home_score": 24 if home_win else 7,
                "away_score": 10 if home_win else 21,
                "neutral_site": False,
                "venue": "Home",
            }
        )
    return pd.DataFrame(rows)
