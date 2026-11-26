"""Shared inputs for feature builders. Builders do not import the registry."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import pandas as pd


class KnownAt(str, Enum):
    """When a feature's value is allowed to be known.

    `schedule` is on the slate before the game. `prior_games` uses only
    earlier games. `as_of_start` is a snapshot whose validity window covers
    the start time.
    """

    SCHEDULE = "schedule"
    PRIOR_GAMES = "prior_games"
    AS_OF_START = "as_of_start"


@dataclass
class FeatureInputs:
    league: str
    games: pd.DataFrame
    team_game_stats: pd.DataFrame | None = None
    injuries: pd.DataFrame | None = None
    probables: pd.DataFrame | None = None
    # Later datasets (Statcast, shots, EPA) land here and a new family reads them.
    extra: dict[str, pd.DataFrame] = field(default_factory=dict)


@dataclass
class FeatureContext:
    inputs: FeatureInputs
    games: pd.DataFrame
    warnings: list[str]
    rolling_window: int = 10
    ewma_span: int = 10
    elo_k: float = 20.0
    elo_home_adv: float = 60.0
    elo_initial: float = 1500.0
    con: Any = None

    @property
    def league(self) -> str:
        return self.inputs.league
