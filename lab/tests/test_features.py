"""Hand-checked form, rest, Elo, and as-of snapshots, plus a registry extension."""

from __future__ import annotations

import math

import duckdb
import pandas as pd
import pytest

from sports_leader_lab.features.context import FeatureInputs, KnownAt
from sports_leader_lab.features.elo import expected_score
from sports_leader_lab.features.prepare import prior_roll_ewma
from sports_leader_lab.features.registry import FeatureSpec, build_features, default_registry

K = 20.0
HA = 60.0


def test_prior_roll_and_ewma_exclude_the_current_value():
    roll, ewma = prior_roll_ewma([10.0, 0.0, 6.0], [True, True, True], window=2, span=2)
    assert math.isnan(roll[0]) and math.isnan(ewma[0])
    assert roll[1] == pytest.approx(10.0)
    assert ewma[1] == pytest.approx(10.0)
    assert roll[2] == pytest.approx(5.0)
    # span 2, alpha 2/3: after [10, 0] the state is (2/3)*0 + (1/3)*10.
    assert ewma[2] == pytest.approx(10.0 / 3.0)
    # A false `use` flag does not enter history and does not change later rows.
    held, _ = prior_roll_ewma([10.0, 99.0, 0.0], [True, False, True], window=2, span=2)
    assert held[2] == pytest.approx(10.0)


def test_builtin_features_match_hand_calculation_and_declare_known_at():
    built = build_features(_inputs(), rolling_window=2, ewma_span=2, elo_k=K, elo_home_adv=HA)
    frame = built.frame.set_index("game_id")
    assert set(built.columns) >= {"home_roll_points_for", "home_elo", "home_rest_days", "neutral_site"}
    assert all(info["known_at"] == KnownAt.PRIOR_GAMES.value for info in (
        built.columns["home_roll_points_for"],
        built.columns["home_elo"],
    ))
    assert built.columns["home_rest_days"]["known_at"] == KnownAt.SCHEDULE.value
    assert built.columns["neutral_site"]["known_at"] == KnownAt.SCHEDULE.value
    assert built.columns["home_injury_count"]["known_at"] == KnownAt.AS_OF_START.value
    assert built.columns["home_probable_count"]["known_at"] == KnownAt.AS_OF_START.value
    assert "home_roll_batting_avg" in built.feature_names
    assert "home_roll_yards_per_play" not in built.feature_names

    # Preseason blowout is on the schedule (rest) and out of the rating and the form.
    assert frame.loc[2, "home_elo"] == pytest.approx(1500.0)
    assert frame.loc[2, "away_elo"] == pytest.approx(1500.0)
    assert math.isnan(frame.loc[2, "home_roll_points_for"])
    assert frame.loc[2, "home_rest_days"] == pytest.approx(4.0)

    home_after, away_after = _update(1500, 1500, 10, 0, neutral=False)
    assert frame.loc[3, "home_elo"] == pytest.approx(home_after)
    assert frame.loc[3, "away_elo"] == pytest.approx(away_after)
    # Game 3 is a home loss. Using that result as if it were already known would not match.
    leaked_home, leaked_away = _update(1500, 1500, 0, 10, neutral=False)
    assert frame.loc[3, "home_elo"] != pytest.approx(leaked_home)
    assert frame.loc[3, "home_roll_points_for"] == pytest.approx(10.0)
    assert frame.loc[3, "away_roll_points_for"] == pytest.approx(0.0)
    assert frame.loc[3, "home_ewma_points_for"] == pytest.approx(10.0)
    assert frame.loc[3, "home_roll_batting_avg"] == pytest.approx(0.5)
    assert frame.loc[3, "away_roll_batting_avg"] == pytest.approx(0.25)
    assert frame.loc[3, "home_rest_days"] == pytest.approx(3.0)
    assert frame.loc[3, "home_venue_changed"] == pytest.approx(0.0)
    assert frame.loc[3, "away_consecutive_away"] == pytest.approx(1.0)
    assert frame.loc[3, "home_injury_count"] == pytest.approx(1.0)
    assert frame.loc[3, "home_probable_count"] == pytest.approx(1.0)
    assert frame.loc[2, "home_probable_count"] == pytest.approx(0.0)

    # Game 30 is the tie. Its pregame Elo is the post-game-3 rating, with no home advantage.
    r1, r2 = _update(home_after, away_after, 0, 10, neutral=False)
    assert frame.loc[30, "away_elo"] == pytest.approx(r1)
    assert frame.loc[30, "home_elo"] == pytest.approx(r2)
    assert frame.loc[30, "away_roll_points_for"] == pytest.approx(5.0)
    assert frame.loc[30, "away_ewma_points_for"] == pytest.approx(10.0 / 3.0)
    assert frame.loc[30, "home_roll_points_for"] == pytest.approx(5.0)
    assert frame.loc[30, "neutral_site"] == pytest.approx(1.0)
    assert frame.loc[30, "home_field"] == pytest.approx(0.0)
    assert frame.loc[30, "away_venue_changed"] == pytest.approx(1.0)
    assert frame.loc[30, "home_injury_count"] == pytest.approx(0.0)
    assert frame.loc[30, "away_injury_count"] == pytest.approx(2.0)

    # Game 20 has the lower id and the later start. It must see game 30.
    after_tie_home, after_tie_away = _update(r2, r1, 4, 4, neutral=True)
    assert frame.loc[20, "home_elo"] == pytest.approx(after_tie_away)
    assert frame.loc[20, "home_elo"] != pytest.approx(r1)
    assert frame.loc[20, "away_elo"] == pytest.approx(1500.0)
    assert frame.loc[20, "home_roll_points_for"] == pytest.approx(2.0)
    assert frame.loc[20, "home_rest_days"] == pytest.approx(0.0)
    assert math.isnan(frame.loc[20, "away_roll_points_for"])


def test_nfl_omits_mlb_probables_and_missing_injury_seasons_stay_null():
    games = pd.DataFrame(
        [
            _game(1, "2023-09-10 17:00", 2023, 1, 2, 21, 14),
            _game(2, "2024-09-08 17:00", 2024, 1, 2, 10, 7),
        ]
    )
    injuries = pd.DataFrame(
        [
            {
                "season": 2024,
                "team_id": 1,
                "player_id": 9,
                "valid_from": "2024-09-01 00:00",
                "valid_to": pd.NaT,
            }
        ]
    )
    built = build_features(
        FeatureInputs(league="nfl", games=games, injuries=injuries),
        names=["elo", "injuries", "team_form"],
    )
    assert "home_probable_count" not in built.feature_names
    frame = built.frame.set_index("game_id")
    assert math.isnan(frame.loc[1, "home_injury_count"])
    assert frame.loc[2, "home_injury_count"] == pytest.approx(1.0)
    listed = {row["name"] for row in default_registry().list_features("nfl")}
    assert "probables" not in listed
    assert "probables" in {row["name"] for row in default_registry().list_features("mlb")}


def test_registry_accepts_a_python_family_and_a_select():
    registry = default_registry()

    def build_epa(ctx):
        return ctx.inputs.extra["future_statcast"][["game_id", "prior_epa"]]

    registry.register(
        FeatureSpec(
            name="statcast_epa",
            description="Caller-supplied prior EPA from a dataset the catalog does not ship yet.",
            known_at=KnownAt.PRIOR_GAMES,
            datasets=frozenset({"future_statcast"}),
            leagues=frozenset({"mlb"}),
            builder=build_epa,
            columns=("prior_epa",),
        )
    )
    games = pd.DataFrame([_game(1, "2023-04-01 18:00", 2023, 1, 2, 1, 0)])
    extra = pd.DataFrame({"game_id": [1], "prior_epa": [0.2]})
    built = build_features(
        FeatureInputs(league="mlb", games=games, extra={"future_statcast": extra}),
        registry=registry,
        names=["statcast_epa"],
    )
    assert built.frame.loc[0, "prior_epa"] == pytest.approx(0.2)
    assert built.columns["prior_epa"]["known_at"] == "prior_games"

    con = duckdb.connect()
    con.register("mlb_games", games)
    registry.register(
        FeatureSpec(
            name="season_number",
            description="Season, which is known when the game is scheduled.",
            known_at=KnownAt.SCHEDULE,
            datasets=frozenset({"games"}),
            sql="SELECT game_id, season AS season_number FROM mlb_games",
            columns_for=lambda league: ("season_number",),
        )
    )
    sql_built = build_features(
        FeatureInputs(league="mlb", games=games),
        registry=registry,
        names=["season_number"],
        con=con,
    )
    assert sql_built.frame.loc[0, "season_number"] == 2023
    with pytest.raises(Exception, match="SELECT"):
        registry.register(
            FeatureSpec(
                name="bad_sql",
                description="not a select",
                known_at=KnownAt.SCHEDULE,
                datasets=frozenset({"games"}),
                sql="DELETE FROM mlb_games",
                columns=("game_id",),
            )
        )


def test_unplayed_game_does_not_enter_history():
    rows = [
        _game(1, "2023-04-01 18:00", 2023, 1, 2, 10, 0),
        _game(2, "2023-04-05 18:00", 2023, 1, 2, 99, 0, completed=False),
    ]
    built = build_features(FeatureInputs(league="nfl", games=pd.DataFrame(rows)), names=["team_form", "elo"])
    frame = built.frame.set_index("game_id")
    assert frame.loc[2, "home_roll_points_for"] == pytest.approx(10.0)
    assert frame.loc[2, "home_elo"] != pytest.approx(1500.0)
    assert frame.loc[1, "home_elo"] == pytest.approx(1500.0)


def _inputs() -> FeatureInputs:
    games = pd.DataFrame(
        [
            _game(1, "2023-03-28 18:00", 2023, 1, 2, 20, 0, season_type="preseason", venue="CityA"),
            _game(2, "2023-04-01 18:00", 2023, 1, 2, 10, 0, venue="CityA"),
            _game(3, "2023-04-04 18:00", 2023, 1, 2, 0, 10, venue="CityA"),
            _game(30, "2023-04-08 18:00", 2023, 2, 1, 4, 4, neutral=True, venue="CityB"),
            _game(20, "2023-04-08 21:00", 2023, 1, 3, 3, 1, venue="CityC"),
        ]
    )
    stats = pd.DataFrame(
        [
            {"game_id": 1, "team_id": 1, "hits": 100, "at_bats": 100},
            {"game_id": 1, "team_id": 2, "hits": 0, "at_bats": 4},
            {"game_id": 2, "team_id": 1, "hits": 2, "at_bats": 4},
            {"game_id": 2, "team_id": 2, "hits": 1, "at_bats": 4},
            {"game_id": 3, "team_id": 1, "hits": 0, "at_bats": 4},
            {"game_id": 3, "team_id": 2, "hits": 4, "at_bats": 4},
            {"game_id": 30, "team_id": 2, "hits": 1, "at_bats": 4},
            {"game_id": 30, "team_id": 1, "hits": 1, "at_bats": 4},
            {"game_id": 20, "team_id": 1, "hits": 3, "at_bats": 4},
            {"game_id": 20, "team_id": 3, "hits": 1, "at_bats": 4},
        ]
    )
    injuries = pd.DataFrame(
        [
            # Active at game 2 (Apr 1 18:00) and closed exactly at game 3's start.
            {"season": 2023, "team_id": 1, "player_id": 12, "game_id": 2,
             "valid_from": "2023-04-01 00:00", "valid_to": "2023-04-04 18:00"},
            # Known before game 3 and still open. A duplicate row is one player.
            {"season": 2023, "team_id": 1, "player_id": 10, "game_id": 3,
             "valid_from": "2023-04-03 00:00", "valid_to": pd.NaT},
            {"season": 2023, "team_id": 1, "player_id": 10, "game_id": 3,
             "valid_from": "2023-04-03 00:00", "valid_to": pd.NaT},
            # Published after game 3's start. Counts on Apr 8, not on Apr 4.
            {"season": 2023, "team_id": 1, "player_id": 11, "game_id": 3,
             "valid_from": "2023-04-04 19:00", "valid_to": pd.NaT},
        ]
    )
    probables = pd.DataFrame(
        [
            {"season": 2023, "game_id": 3, "team_id": 1, "player_id": 20,
             "valid_from": "2023-04-04 12:00", "valid_to": pd.NaT},
            {"season": 2023, "game_id": 3, "team_id": 1, "player_id": 20,
             "valid_from": "2023-04-04 12:00", "valid_to": pd.NaT},
            {"season": 2023, "game_id": 3, "team_id": 1, "player_id": 21,
             "valid_from": "2023-04-04 19:00", "valid_to": pd.NaT},
            {"season": 2023, "game_id": 30, "team_id": 2, "player_id": 99,
             "valid_from": "2023-04-01 00:00", "valid_to": pd.NaT},
        ]
    )
    return FeatureInputs(
        league="mlb",
        games=games,
        team_game_stats=stats,
        injuries=injuries,
        probables=probables,
    )


def _game(game_id, start, season, home, away, home_score, away_score, **extra):
    row = {
        "game_id": game_id,
        "game_date": start[:10],
        "start_time": start,
        "season": season,
        "season_type": extra.get("season_type", "regular"),
        "home_team_id": home,
        "away_team_id": away,
        "home_score": home_score,
        "away_score": away_score,
        "neutral_site": extra.get("neutral", False),
        "venue_city": extra.get("venue", "CityA"),
        "completed": extra.get("completed", True),
    }
    return row


def _update(home: float, away: float, home_score: float, away_score: float, *, neutral: bool):
    advantage = 0.0 if neutral else HA
    expected = expected_score(home + advantage, away)
    actual = 1.0 if home_score > away_score else 0.0 if home_score < away_score else 0.5
    return home + K * (actual - expected), away + K * ((1.0 - actual) - (1.0 - expected))
