"""Frozen past-season goldens and a live stdio pass of three team examples.

Skipped unless SPORTSLEADER_LAB_LIVE=1. The sha256 pins are the sportsleader-data
manifest hashes of the files the 2023 home_win slice reads. A changed file fails
here instead of quietly moving the log loss.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import sys
from pathlib import Path

import pytest
from mcp import Client, StdioServerParameters

from sports_leader_lab.config import load_config
from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.datasets import build_dataset
from sports_leader_lab.runs import load_dataset
from sports_leader_lab.store import RunStore
from sports_leader_lab.training import train_classifier

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        os.environ.get("SPORTSLEADER_LAB_LIVE") != "1",
        reason="set SPORTSLEADER_LAB_LIVE=1 to download sportsleader-data",
    ),
]

# Date-fold logistic regression on site + elo, one season, min_train_rows 50.
# The band is versus Elo on the same held-out rows, plus a tighter band versus
# the log loss recorded when these hashes were pinned.
ELO_BAND = 0.02
PIN_BAND = 0.005

GOLDEN = {
    "nhl": {
        "files": {
            "nhl/games/2023.parquet": "5718a73fdc2df12c5c789257f9758336fa7353643892476dcecb810179298be4",
            "nhl/team_game_stats/2023.parquet": "7ff453f23c1ae92d81f17f8842fa56b78c66e5f2317191483e2c1b31d8a26d28",
        },
        "rows": 1403,
        "log_loss": 0.678170,
        "elo_log_loss": 0.677812,
    },
    "mlb": {
        "files": {
            "mlb/games/2023.parquet": "a7e00bfe270e03e6f4676d5478138e200068416a2a93bc7a690f2c2193217963",
            "mlb/team_game_stats/2023.parquet": "f9b8b31e1e5822e6e8c2f735a1abed51a49c13fead20b0928e2efe807ce27345",
        },
        "rows": 2471,
        "log_loss": 0.690878,
        "elo_log_loss": 0.698441,
    },
}

EXAMPLES = (
    ("mlb", "MIL", "Brewers"),
    ("nfl", "GB", "Packers"),
    ("nba", "MIL", "Bucks"),
)


@pytest.fixture(scope="module")
def live_home(tmp_path_factory):
    root = tmp_path_factory.mktemp("golden")
    cache_dir = root / "cache"
    run_dir = root / "runs"
    env = {
        "SPORTSLEADER_LAB_CACHE_DIR": str(cache_dir),
        "SPORTSLEADER_LAB_RUN_DIR": str(run_dir),
    }
    config = load_config(env)
    return {
        "env": env,
        "cache": DataCache(config),
        "store": RunStore.from_config(config),
    }


@pytest.mark.parametrize("league", ["nhl", "mlb"])
def test_2023_home_win_stays_within_a_band_of_elo(live_home, league):
    pin = GOLDEN[league]
    cache: DataCache = live_home["cache"]
    store: RunStore = live_home["store"]
    manifest = cache.load_manifest()
    by_path = {entry.path: entry for entry in manifest.files}
    for path, digest in pin["files"].items():
        entry = by_path.get(path)
        assert entry is not None, f"{path} is not in the manifest; the golden slice moved"
        assert entry.sha256 == digest, f"{path} sha256 is {entry.sha256}, pin is {digest}"
        local = cache.ensure(entry)
        actual = hashlib.sha256(Path(local).read_bytes()).hexdigest()
        assert actual == digest, f"{path} bytes hash {actual}, pin is {digest}"

    built = build_dataset(
        league,
        "home_win",
        [2023],
        features=["site", "elo"],
        store=store,
        cache=cache,
    )
    frame, meta = load_dataset(store, built["dataset_id"])
    recorded = {row["path"]: row["sha256"] for row in meta["data_manifest"]}
    assert recorded == pin["files"]
    assert len(frame) == pin["rows"]

    trained = train_classifier(
        built["dataset_id"],
        model="logistic",
        scheme="date",
        min_train_seasons=1,
        min_train_rows=50,
        store=store,
    )
    model = trained["pooled"]["model"]["log_loss"]
    elo = trained["pooled"]["elo"]["log_loss"]
    assert abs(model - elo) <= ELO_BAND
    assert abs(model - pin["log_loss"]) <= PIN_BAND
    assert abs(elo - pin["elo_log_loss"]) <= PIN_BAND
    assert "not a recommendation to bet" in trained["disclaimer"].lower()


def test_brewers_packers_and_bucks_over_stdio(live_home, capsys):
    cache: DataCache = live_home["cache"]
    manifest = cache.load_manifest()
    seasons_by_league = {}
    for league, _abbr, _label in EXAMPLES:
        published = sorted(
            {entry.season for entry in manifest.files if entry.league == league and entry.dataset == "games"}
        )
        assert len(published) >= 2, published
        seasons_by_league[league] = published[-2:]

    child_env = os.environ.copy()
    child_env.update(live_home["env"])
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "sports_leader_lab"],
        env=child_env,
    )

    async def run():
        report = []
        async with Client(params) as client:
            ping = _payload(await client.call_tool("ping", {}))
            assert ping["ok"] is True
            for league, abbr, label in EXAMPLES:
                seasons = seasons_by_league[league]
                built = _payload(
                    await client.call_tool(
                        "build_dataset",
                        {
                            "league": league,
                            "target": "home_win",
                            "seasons": seasons,
                            "features": ["site", "elo"],
                        },
                    )
                )
                trained = _payload(
                    await client.call_tool(
                        "train_classifier",
                        {
                            "dataset_id": built["dataset_id"],
                            "model": "logistic",
                            "scheme": "season",
                            "min_train_seasons": 1,
                        },
                    )
                )
                found = _payload(
                    await client.call_tool(
                        "query_data",
                        {
                            "sql": (
                                "SELECT game_id, game_date, completed, start_time, "
                                "home_team_abbr, away_team_abbr, home_team_name, away_team_name "
                                f"FROM {league}_games "
                                f"WHERE home_team_abbr = '{abbr}' OR away_team_abbr = '{abbr}' "
                                "ORDER BY game_date DESC"
                            ),
                            "seasons": seasons,
                            "max_rows": 40,
                        },
                    )
                )
                game, completed = _choose(found["rows"])
                predicted = _payload(
                    await client.call_tool(
                        "predict",
                        {
                            "run_id": trained["run_id"],
                            "game_ids": [str(game["game_id"])],
                            "market_prices": [
                                {
                                    "game_id": str(game["game_id"]),
                                    "home_implied_prob": 0.51,
                                    "source": "caller",
                                }
                            ],
                        },
                    )
                )
                scored = predicted["games"][0]
                assert predicted["as_of_timezone"] == "America/Chicago"
                assert predicted["as_of"].endswith("-06:00") or predicted["as_of"].endswith("-05:00")
                assert "not a recommendation to bet" in predicted["disclaimer"].lower()
                assert "not stored" in predicted["market_note"].lower()
                assert scored["start_time_ct"].endswith("-06:00") or scored["start_time_ct"].endswith("-05:00")
                assert scored["market"]["home_implied_prob"] == 0.51
                if completed:
                    assert any("research replay" in warning for warning in predicted["warnings"])
                run_meta = (live_home["store"].root / "models" / trained["run_id"] / "meta.json").read_text()
                assert "home_implied_prob" not in run_meta
                report.append(
                    {
                        "label": label,
                        "league": league,
                        "seasons": seasons,
                        "dataset_rows": built["rows"],
                        "run_id": trained["run_id"],
                        "folds": len(trained["folds"]),
                        "log_loss": trained["pooled"]["model"]["log_loss"],
                        "elo_log_loss": (trained["pooled"].get("elo") or {}).get("log_loss"),
                        "game_id": scored["game_id"],
                        "game_date": scored["game_date"],
                        "matchup": f"{scored['away_team_abbr']} at {scored['home_team_abbr']}",
                        "completed": scored["completed"],
                        "estimate": scored["estimate"],
                        "as_of": predicted["as_of"],
                        "as_of_timezone": predicted["as_of_timezone"],
                        "start_time_ct": scored["start_time_ct"],
                        "warnings": predicted["warnings"],
                        "market_note": predicted["market_note"],
                        "disclaimer": predicted["disclaimer"],
                    }
                )
        return report

    report = asyncio.run(run())
    text = json.dumps(report, indent=2)
    Path("/tmp/lab-p5-examples.json").write_text(text + "\n", encoding="utf-8")
    print(text)
    captured = capsys.readouterr()
    assert text in captured.out
    assert len(report) == 3


def _choose(rows: list[dict]) -> tuple[dict, bool]:
    if not rows:
        raise AssertionError("the team has no games in the trained seasons")
    upcoming = [row for row in rows if not _completed(row)]
    if upcoming:
        upcoming.sort(key=lambda row: (str(row["game_date"]), str(row["game_id"])))
        return upcoming[0], False
    played = sorted(rows, key=lambda row: (str(row["game_date"]), str(row["game_id"])), reverse=True)
    return played[0], True


def _completed(row: dict) -> bool:
    value = row.get("completed")
    return value is True or value == 1


def _payload(result) -> dict:
    if getattr(result, "is_error", False):
        raise AssertionError(f"tool error: {result!r}")
    structured = getattr(result, "structured_content", None)
    if isinstance(structured, dict) and structured:
        return structured
    data = getattr(result, "data", None)
    if isinstance(data, dict) and data:
        return data
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if isinstance(text, str) and text.startswith("{"):
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
    raise AssertionError(f"tool result had no payload: {result!r}")
