"""inspect_data, query_data, and the locked SELECT sandbox."""

import threading

import pandas as pd
import pytest

from sports_leader_lab.config import LabConfig
from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.errors import DataError, LabError
from sports_leader_lab.query import inspect_data, query_data
from sports_leader_lab.sqlguard import execute_select
from tests.support import MANIFEST_URL, Origin, file_entry, manifest

FOUR_HOURS = 4 * 3600


def test_inspect_reports_grain_nulls_and_pregame_tags(tmp_path):
    frame = pd.DataFrame(
        {
            "season": [2023, 2023],
            "game_id": [1, 2],
            "game_date": ["2023-09-01", "2023-09-08"],
            "home_score": [24, None],
            "status": ["final", "scheduled"],
        }
    )
    cache = _cache(tmp_path, frame)
    described = inspect_data("nfl", "games", [2023], cache=cache)
    assert described["rows"] == 2
    assert described["grain"] == "game"
    assert described["key"] == ["game_id"]
    assert described["date_min"] == "2023-09-01"
    assert described["date_max"] == "2023-09-08"
    by_name = {column["name"]: column for column in described["columns"]}
    assert by_name["game_date"]["timing"] == "pregame"
    assert by_name["home_score"]["timing"] == "postgame"
    assert by_name["home_score"]["null_rate"] == pytest.approx(0.5)
    assert "not a recommendation to bet" in described["disclaimer"].lower()


def test_inspect_errors_are_clear_for_unknown_names():
    with pytest.raises(DataError, match="unknown league"):
        inspect_data("zzz", "games", [2023])
    with pytest.raises(DataError, match="unknown dataset"):
        inspect_data("nfl", "not_a_dataset", [2023])


def test_inspect_errors_for_an_unknown_season(tmp_path):
    cache = _cache(tmp_path, pd.DataFrame({"season": [2023], "game_id": [1], "game_date": ["2023-09-01"]}))
    with pytest.raises(DataError, match="no files for nfl games season 2024"):
        inspect_data("nfl", "games", [2024], cache=cache)


def test_query_is_select_only_capped_and_can_see_scores(tmp_path):
    frame = pd.DataFrame(
        {
            "season": [2023] * 6,
            "game_id": list(range(6)),
            "home_score": list(range(6)),
        }
    )
    cache = _cache(tmp_path, frame)
    with pytest.raises(LabError, match="must be a SELECT"):
        query_data("DELETE FROM nfl_games", cache=cache)
    result = query_data(
        "SELECT game_id, home_score FROM nfl_games ORDER BY game_id",
        max_rows=3,
        seasons=[2023],
        cache=cache,
    )
    assert result["truncated"] is True
    assert result["row_count"] == 3
    assert result["rows"][0]["home_score"] == 0
    assert "not a recommendation to bet" in result["disclaimer"].lower()


def test_query_cannot_read_a_file(tmp_path):
    cache = _cache(tmp_path, pd.DataFrame({"season": [2023], "game_id": [1], "home_score": [7]}))
    with pytest.raises(LabError, match="failed"):
        query_data("SELECT game_id, read_text('/etc/hostname') AS host FROM nfl_games", cache=cache)


def test_query_must_name_a_view_before_it_touches_data():
    with pytest.raises(LabError, match="published view"):
        query_data("SELECT 1 AS n")


def test_execute_select_times_out():
    class Slow:
        def __init__(self):
            self.event = threading.Event()

        def execute(self, _sql):
            if not self.event.wait(2):
                raise RuntimeError("not interrupted")
            raise RuntimeError("interrupted")

        def interrupt(self):
            self.event.set()

    with pytest.raises(LabError, match="exceeded"):
        execute_select(Slow(), "SELECT 1", max_rows=5, timeout_s=0.1)


def _cache(tmp_path, frame: pd.DataFrame) -> DataCache:
    entry, body = file_entry("nfl", "games", 2023, frame)
    origin = Origin(manifest([entry]), {entry["url"]: body})
    config = LabConfig(
        manifest_url=MANIFEST_URL,
        cache_dir=tmp_path,
        run_dir=tmp_path / "runs",
        revalidate_seconds=FOUR_HOURS,
    )
    return DataCache(config, fetcher=origin, clock=lambda: 1_000_000.0)
