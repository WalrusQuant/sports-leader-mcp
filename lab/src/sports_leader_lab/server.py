"""stdio MCP server for the research lab."""

from __future__ import annotations

from typing import Any

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from sports_leader_lab import DISCLAIMER, __version__
from sports_leader_lab.datasets import build_dataset as build_dataset_fn
from sports_leader_lab.errors import LabError
from sports_leader_lab.payload import jsonable
from sports_leader_lab.predict import predict as predict_fn
from sports_leader_lab.query import inspect_data as inspect_data_fn
from sports_leader_lab.query import query_data as query_data_fn
from sports_leader_lab.training import train_classifier as train_classifier_fn
from sports_leader_lab.training import train_regressor as train_regressor_fn

INSTRUCTIONS = (
    "Sports modeling research lab over the public sportsleader-data Parquet files. "
    "Tools inspect that data, build a leakage-checked dataset, train a walk-forward "
    "classifier or regressor, and score a game as of a clock in US Central. "
    + DISCLAIMER
)

mcp = MCPServer("sports-leader-lab", instructions=INSTRUCTIONS, version=__version__)


def _call(fn, *args, **kwargs):
    """Turn an anticipated lab error into the message the MCP client shows."""
    try:
        return jsonable(fn(*args, **kwargs))
    except (LabError, ValueError) as err:
        raise ToolError(str(err)) from None


def health() -> dict[str, Any]:
    return {
        "ok": True,
        "server": "sports-leader-lab",
        "version": __version__,
        "disclaimer": DISCLAIMER,
    }


@mcp.tool()
def ping() -> dict[str, Any]:
    """Health check for the sports-leader-lab research server.

    The lab measures fit against simple baselines. It does not provide a
    betting edge, a pick, or a recommendation to bet.
    """
    return health()


@mcp.tool()
def inspect_data(league: str, dataset: str, seasons: list[int] | None = None) -> dict[str, Any]:
    """Describe one published dataset: rows, null rates, dates, grain, and pregame or postgame.

    This is a research description of the export. It is not a betting edge.
    """
    return _call(inspect_data_fn, league, dataset, seasons)


@mcp.tool()
def query_data(sql: str, max_rows: int = 500, seasons: list[int] | None = None) -> dict[str, Any]:
    """Run one SELECT over views such as nfl_games.

    The query runs on a connection with external file access disabled, a 20 second
    timeout, and a row cap (default 500, at most 5000). This is research access
    to the export, not a betting edge.
    """
    return _call(query_data_fn, sql, max_rows=max_rows, seasons=seasons)


@mcp.tool()
def build_dataset(
    league: str,
    target: str,
    seasons: list[int],
    features: list[str] | None = None,
    sql_features: list[dict] | None = None,
) -> dict[str, Any]:
    """Build a pregame dataset for home_win, margin, total, or team_points.

    Features come from the registry or from custom SQL. The dataset is saved
    only when the leakage audit passes. team_points is the home team's points.
    This is research data, not a betting edge.
    """
    return _call(build_dataset_fn, league, target, seasons, features=features, sql_features=sql_features)


@mcp.tool()
def train_classifier(
    dataset_id: str,
    model: str = "logistic",
    calibration: str = "none",
    min_train_seasons: int = 2,
    embargo_days: int = 0,
) -> dict[str, Any]:
    """Walk-forward home-win model: L2 logistic or LightGBM, optional Platt or isotonic.

    Early stopping and calibration use a tail inside each training fold, never
    the test fold. Metrics are log loss, Brier, AUC, ECE, and reliability bins,
    next to a constant rate, a home-field rate, and as-of Elo. A model that
    loses to Elo is flagged. This is a research fit, not a betting edge.
    """
    return _call(
        train_classifier_fn,
        dataset_id,
        model=model,
        calibration=calibration,
        min_train_seasons=min_train_seasons,
        embargo_days=embargo_days,
    )


@mcp.tool()
def train_regressor(
    dataset_id: str,
    model: str = "ridge",
    min_train_seasons: int = 2,
    embargo_days: int = 0,
) -> dict[str, Any]:
    """Walk-forward margin, total, or team-points model.

    Models are ridge, Poisson, negative binomial, or LightGBM (Poisson objective
    for counts). Poisson and negative binomial are refused for margin. Metrics
    include MAE, RMSE, Poisson deviance for counts, bias by season, and an
    Elo-implied margin. This is a research fit, not a betting edge.
    """
    return _call(
        train_regressor_fn,
        dataset_id,
        model=model,
        min_train_seasons=min_train_seasons,
        embargo_days=embargo_days,
    )


@mcp.tool()
def predict(
    run_id: str,
    game_date: str | None = None,
    game_ids: list[str] | None = None,
    market_prices: list[dict] | None = None,
) -> dict[str, Any]:
    """Score games from a saved run as of now in US Central (America/Chicago).

    Refuses when a required feature is not known before the game's start time.
    market_prices, when passed, are current home-win prices for this call only
    and are not stored. The lab does not fetch odds. This is not a betting edge.
    """
    return _call(predict_fn, run_id, game_date=game_date, game_ids=game_ids, market_prices=market_prices)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
