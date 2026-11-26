"""As-of Elo. The rating on a game is the rating before that game is applied.

Between seasons, each rating moves `elo_season_regress` of the way back to
the initial rating. The default is 1/3. Zero disables that pull. The earliest
season in the frame is still a cold start at the initial rating, and the
builder says so: a rating changes when that season is left out of the load.
"""

from __future__ import annotations

import math

import pandas as pd

from sports_leader_lab.errors import LabError
from sports_leader_lab.features.context import FeatureContext

ELO_K = 20.0
ELO_HOME_ADV = 60.0
ELO_INITIAL = 1500.0
# One third of the way back to 1500 at each new season. FiveThirtyEight used
# the same fraction. 0 keeps the rating continuous with no seasonal pull.
ELO_SEASON_REGRESS = 1.0 / 3.0

ELO_COLUMNS = ("home_elo", "away_elo", "elo_diff")


def expected_score(rating: float, opponent: float) -> float:
    return 1.0 / (1.0 + 10.0 ** ((opponent - rating) / 400.0))


def build_elo(ctx: FeatureContext) -> pd.DataFrame:
    games = ctx.games
    regress = float(ctx.elo_season_regress)
    if not 0.0 <= regress <= 1.0:
        raise LabError("elo_season_regress must be between 0 and 1")
    if not games.empty:
        earliest = int(pd.to_numeric(games["season"]).min())
        if regress:
            pull = (
                f"At each later season boundary, ratings move {regress:g} of the way "
                f"back to {ctx.elo_initial:g}."
            )
        else:
            pull = "Season-to-season regression is off (elo_season_regress is 0)."
        ctx.warnings.append(
            f"Elo cold-starts every team at {ctx.elo_initial:g} in season {earliest}, "
            "the earliest season in this frame. Ratings change if that season is not loaded. "
            + pull
        )
    ratings: dict[object, float] = {}
    home_elo: list[float] = []
    away_elo: list[float] = []
    seen_season: int | None = None
    for row in games.itertuples(index=False):
        season = int(row.season)
        if seen_season is not None and season != seen_season and regress:
            for team, rating in list(ratings.items()):
                ratings[team] = (1.0 - regress) * rating + regress * ctx.elo_initial
        seen_season = season
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
