"""stdio MCP server for the research lab."""

from __future__ import annotations

from typing import Any

from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

from sports_leader_lab import DISCLAIMER, __version__
from sports_leader_lab.datasets import audit_features as audit_features_fn
from sports_leader_lab.datasets import build_dataset as build_dataset_fn
from sports_leader_lab.errors import LabError
from sports_leader_lab.payload import jsonable
from sports_leader_lab.predict import predict as predict_fn
from sports_leader_lab.query import inspect_data as inspect_data_fn
from sports_leader_lab.query import query_data as query_data_fn
from sports_leader_lab.registry import compare_runs as compare_runs_fn
from sports_leader_lab.registry import list_runs as list_runs_fn
from sports_leader_lab.registry import model_card as model_card_fn
from sports_leader_lab.training import train_classifier as train_classifier_fn
from sports_leader_lab.training import train_regressor as train_regressor_fn

INSTRUCTIONS = (
    "Sports modeling research lab over the public sportsleader-data Parquet files. "
    "Tools inspect that data, audit features, build a leakage-checked dataset, train a "
    "walk-forward classifier or regressor, list and compare runs, write a model card, "
    "and score a game as of a clock in US Central. "
    + DISCLAIMER
)

mcp = MCPServer("sports-leader-lab", instructions=INSTRUCTIONS, version=__version__)


def _call(fn, *args, **kwargs):
    """Turn a tool failure into the message the MCP client shows.

    Lab errors stay as written. Anything else still becomes a tool error, with
    the exception type and message, instead of a generic "Error executing tool".
    """
    try:
        return jsonable(fn(*args, **kwargs))
    except ToolError:
        raise
    except (LabError, ValueError) as err:
        raise ToolError(str(err)) from None
    except Exception as err:
        detail = str(err).strip() or err.__class__.__name__
        raise ToolError(f"{err.__class__.__name__}: {detail}") from None


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
    """Describe one published dataset before querying or building.

    league is mlb, nba, nfl, nhl, cfb, or cbb. dataset is one published name such
    as games or team_game_stats. Omit seasons to use every published season.
    Returns rows, date range, grain, null rates, and whether each column is
    pregame or postgame. This describes the export. It is not a betting edge.
    """
    return _call(inspect_data_fn, league, dataset, seasons)


@mcp.tool()
def query_data(sql: str, max_rows: int = 500, seasons: list[int] | None = None) -> dict[str, Any]:
    """Run one SELECT over a published view such as nfl_games or mlb_team_game_stats.

    Only a single SELECT is accepted. The connection has no external file access.
    max_rows is 1 to 5000 (default 500). The query stops at 20 seconds. Pass
    seasons to limit which published seasons are loaded. This is research access
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
    """Build one pregame dataset and save it only when the leakage audit passes.

    target is home_win, margin, total, or team_points (the home team's points).
    seasons must list at least one season. features names registry families:
    site, elo, team_form, rest, injuries, and probables (MLB). Omit features to
    use every family for that league. sql_features is optional custom SQL that
    cannot see postgame columns. A failed audit does not save. This is research
    data, not a betting edge.
    """
    return _call(build_dataset_fn, league, target, seasons, features=features, sql_features=sql_features)


@mcp.tool()
def train_classifier(
    dataset_id: str,
    model: str = "logistic",
    calibration: str = "none",
    scheme: str = "season",
    min_train_seasons: int = 2,
    min_train_rows: int = 50,
    embargo_days: int = 0,
    test_days: int = 14,
) -> dict[str, Any]:
    """Walk-forward home-win model. There is no random split.

    model is logistic or lightgbm. calibration is none, platt, or isotonic, fit
    on a tail inside each training fold. scheme is season (hold out a later
    season after min_train_seasons earlier ones) or date (folds of test_days,
    with embargo_days between train and test, and at least min_train_rows).
    Metrics are log loss, Brier, AUC, and ECE, next to a constant rate, a
    home-field rate, and as-of Elo. Losing to Elo is flagged. This is a
    research fit, not a betting edge.
    """
    return _call(
        train_classifier_fn,
        dataset_id,
        model=model,
        calibration=calibration,
        scheme=scheme,
        min_train_seasons=min_train_seasons,
        min_train_rows=min_train_rows,
        embargo_days=embargo_days,
        test_days=test_days,
    )


@mcp.tool()
def train_regressor(
    dataset_id: str,
    model: str = "ridge",
    scheme: str = "season",
    min_train_seasons: int = 2,
    min_train_rows: int = 50,
    embargo_days: int = 0,
    test_days: int = 14,
) -> dict[str, Any]:
    """Walk-forward margin, total, or team-points model. There is no random split.

    model is ridge, poisson, negbin, or lightgbm. Poisson and negative binomial
    are refused for margin. scheme, min_train_seasons, min_train_rows,
    embargo_days, and test_days match train_classifier. Metrics include MAE,
    RMSE, Poisson deviance for counts, bias by season, and an Elo-implied
    margin. Count targets are not compared to Elo. This is a research fit, not
    a betting edge.
    """
    return _call(
        train_regressor_fn,
        dataset_id,
        model=model,
        scheme=scheme,
        min_train_seasons=min_train_seasons,
        min_train_rows=min_train_rows,
        embargo_days=embargo_days,
        test_days=test_days,
    )


@mcp.tool()
def predict(
    run_id: str,
    game_date: str | None = None,
    game_ids: list[str] | None = None,
    market_prices: list[dict] | None = None,
) -> dict[str, Any]:
    """Score games from a saved run as of now in America/Chicago.

    Pass game_date (YYYY-MM-DD) or game_ids. Each game has home_team_abbr,
    away_team_abbr, estimate, and estimate_kind. For a home_win model, estimate
    is P(home team wins) and estimate_kind is home_win_probability. Read it with
    the home abbreviation: GB at LAR with estimate 0.688 is P(LAR win) = 0.688,
    so P(GB win) is about 0.312. For margin, total, or team_points, estimate is
    that target and estimate_kind is the target name. The result also includes
    as_of, as_of_timezone, and start_time_ct. A completed game is a research
    replay. A game with no start time is refused. market_prices, when passed,
    are current {game_id, home_implied_prob, source} rows for this call only
    and are not stored. The lab does not fetch odds. This is not a betting edge.
    """
    return _call(predict_fn, run_id, game_date=game_date, game_ids=game_ids, market_prices=market_prices)


@mcp.tool()
def audit_features(
    league: str,
    target: str,
    seasons: list[int],
    features: list[str] | None = None,
    sql_features: list[dict] | None = None,
) -> dict[str, Any]:
    """Run the dataset leakage checks and do not save.

    Same arguments as build_dataset. Hard-fails a target, score, or margin copy
    (including a scaled copy) once 30 overlapping rows are non-null, or on every
    row when the frame is shorter. A column with fewer than two distinct values
    is not a copy. Same-game box stats, timestamps after start, and raw snapshot
    names also fail. A very high single-feature AUC is a warning. ok true means
    REVIEW REQUIRED, never clean. This is a research check, not a betting edge.
    """
    return _call(
        audit_features_fn,
        league,
        target,
        seasons,
        features=features,
        sql_features=sql_features,
    )


@mcp.tool()
def list_runs(league: str, limit: int = 20) -> dict[str, Any]:
    """List saved runs for one league, newest first.

    limit is an integer from 1 to 100 (default 20). Order is created_at, then
    the monotonic sequence, then run_id. This is a research index, not a betting edge.
    """
    return _call(list_runs_fn, league, limit)


@mcp.tool()
def compare_runs(run_ids: list[str]) -> dict[str, Any]:
    """Compare at least two saved runs on the primary metric.

    Pass run_ids. Runs that do not share a league and target come back with a
    caveat that the numbers are not a comparison. This is a research comparison,
    not a betting edge.
    """
    return _call(compare_runs_fn, run_ids)


@mcp.tool()
def model_card(run_id: str) -> dict[str, Any]:
    """Rebuild the twelve-section model card for one run.

    The markdown is rendered from the run record and matches the saved
    model_card.md. Sections cover the question, data window, features, split,
    metrics against the baselines, limits, and approval history. The card is a
    research record. It is not an approval and not a betting edge.
    """
    return _call(model_card_fn, run_id)


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
