import pandas as pd
import pytest

from sports_leader_lab.config import LabConfig
from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.data.catalog import DATASETS, LEAGUES, column_timing
from sports_leader_lab.data.manifest import parse_manifest
from sports_leader_lab.data.views import open_duckdb, read_view, register_views
from sports_leader_lab.errors import ChecksumMismatch, DataError
from tests.support import ORIGIN, Origin, file_entry, manifest

FOUR_HOURS = 4 * 3600


def test_catalog_lists_eighteen_datasets_and_six_leagues():
    assert len(DATASETS) == 18
    assert len(set(DATASETS)) == 18
    assert LEAGUES == ("mlb", "nba", "nfl", "nhl", "cfb", "cbb")
    assert column_timing("games", "game_date") == "pregame"
    assert column_timing("games", "start_time") == "pregame"
    assert column_timing("games", "home_score") == "postgame"
    assert column_timing("team_game_stats", "team_id") == "pregame"
    assert column_timing("team_game_stats", "opponent_id") == "pregame"
    assert column_timing("team_game_stats", "score") == "postgame"
    assert column_timing("team_game_stats", "total_yards") == "postgame"
    assert column_timing("injuries", "valid_from") == "as_of"
    assert column_timing("injuries", "status") == "as_of"
    assert column_timing("probables", "player_id") == "pregame"
    assert column_timing("future_statcast", "epa") == "postgame"


def test_manifest_rejects_a_path_that_does_not_match(tmp_path):
    entry, _ = file_entry("nfl", "games", 2023, pd.DataFrame({"season": [2023]}))
    entry["path"] = "../secrets.parquet"
    with pytest.raises(DataError, match="does not match"):
        parse_manifest(manifest([entry]))
    entry["path"] = "nfl/games/2023.parquet"
    entry["url"] = "https://user:secret@data.invalid/nfl_games/2023.parquet"
    with pytest.raises(DataError, match="credentials"):
        parse_manifest(manifest([entry]))


def test_past_season_is_not_redownloaded_and_current_season_revalidates(tmp_path):
    past, past_bytes = file_entry("nfl", "games", 2023, pd.DataFrame({"season": [2023], "game_id": [1]}))
    current, current_bytes = file_entry(
        "nfl", "games", 2024, pd.DataFrame({"season": [2024], "game_id": [2]})
    )
    payload = manifest([past, current])
    origin = Origin(payload, {past["url"]: past_bytes, current["url"]: current_bytes})
    clock = {"now": 1_000_000.0}
    cache = _cache(tmp_path, origin, clock)
    manifest_url = f"{ORIGIN}/manifest.json"

    first = cache.load_manifest()
    past_path = cache.ensure(first.find("nfl", "games", 2023))
    current_path = cache.ensure(first.find("nfl", "games", 2024))
    assert past_path.is_file() and current_path.is_file()
    assert origin.parquet_calls() == [past["url"], current["url"]]

    cache.ensure(first.find("nfl", "games", 2023))
    cache.ensure(first.find("nfl", "games", 2024))
    assert origin.parquet_calls() == [past["url"], current["url"]]

    # Inside the revalidation window the cached manifest is trusted, so a
    # changed current-season hash is not downloaded yet.
    revised, revised_bytes = file_entry(
        "nfl", "games", 2024, pd.DataFrame({"season": [2024], "game_id": [9]})
    )
    origin.files[current["url"]] = revised_bytes
    origin.payload = manifest([past, revised])
    held = list(origin.parquet_calls())
    cache.ensure(cache.load_manifest().find("nfl", "games", 2024))
    assert origin.parquet_calls() == held
    assert origin.calls.count(manifest_url) == 1

    clock["now"] += FOUR_HOURS + 1
    refreshed = cache.load_manifest()
    assert origin.calls.count(manifest_url) == 2
    cache.ensure(refreshed.find("nfl", "games", 2023))
    assert origin.parquet_calls().count(past["url"]) == 1
    updated = cache.ensure(refreshed.find("nfl", "games", 2024))
    assert origin.parquet_calls().count(current["url"]) == 2
    assert pd.read_parquet(updated)["game_id"].tolist() == [9]
    # A later pass still does not download the unchanged past season.
    clock["now"] += FOUR_HOURS + 1
    cache.load_manifest()
    cache.ensure(cache.load_manifest().find("nfl", "games", 2023))
    assert origin.parquet_calls().count(past["url"]) == 1


def test_checksum_mismatch_keeps_nothing(tmp_path):
    entry, body = file_entry("nfl", "games", 2023, pd.DataFrame({"season": [2023]}))
    origin = Origin(manifest([entry]), {entry["url"]: b"not the parquet"})
    cache = _cache(tmp_path, origin, {"now": 10.0})
    parsed = cache.load_manifest()
    with pytest.raises(ChecksumMismatch):
        cache.ensure(parsed.find("nfl", "games", 2023))
    assert list((tmp_path / "files").rglob("*.parquet")) == []
    del body


def test_views_cover_every_dataset_and_league_and_filter_by_season(tmp_path):
    entries = []
    files = {}
    for index, dataset in enumerate(DATASETS):
        if dataset == "games":
            continue
        league = LEAGUES[index % len(LEAGUES)]
        frame = pd.DataFrame({"season": [2023], "game_id": [index], "league": [league]})
        entry, body = file_entry(league, dataset, 2023, frame)
        entries.append(entry)
        files[entry["url"]] = body
    for league in LEAGUES:
        for season, game_id in ((2023, 1), (2024, 2)):
            frame = pd.DataFrame(
                {"season": [season], "game_id": [game_id], "home_team_id": [10], "opponent_id": [20]}
            )
            entry, body = file_entry(league, "games", season, frame)
            entries.append(entry)
            files[entry["url"]] = body
    # A dataset the catalog does not know yet still becomes a view.
    future, future_body = file_entry(
        "mlb", "future_statcast", 2023, pd.DataFrame({"season": [2023], "game_id": [7], "epa": [0.1]})
    )
    entries.append(future)
    files[future["url"]] = future_body

    origin = Origin(manifest(entries), files)
    cache = _cache(tmp_path, origin, {"now": 10.0})
    con = open_duckdb()
    registered = register_views(con, cache)
    names = {view.name for view in registered}
    assert {f"{league}_games" for league in LEAGUES} <= names
    assert {f"{LEAGUES[index % len(LEAGUES)]}_{dataset}" for index, dataset in enumerate(DATASETS)} <= names
    assert "mlb_future_statcast" in names
    for view in registered:
        assert all(not path.startswith("http") for path in view.paths)
        assert view.rows >= 1

    nfl_2023 = read_view(con, "nfl_games", seasons=[2023])
    nfl_all = read_view(con, "nfl_games")
    assert nfl_2023["season"].tolist() == [2023]
    assert sorted(nfl_all["season"].tolist()) == [2023, 2024]
    filtered = con.execute("SELECT game_id FROM nfl_games WHERE season = 2024").fetchdf()
    assert filtered["game_id"].tolist() == [2]
    extensions = con.execute(
        "SELECT loaded FROM duckdb_extensions() WHERE extension_name = 'httpfs'"
    ).fetchall()
    assert extensions == [] or extensions[0][0] is False or extensions[0][0] == 0

    with pytest.raises(DataError, match="unknown league"):
        register_views(con, cache, leagues=["zzz"])
    with pytest.raises(DataError, match="unknown dataset"):
        register_views(con, cache, datasets=["not_a_dataset"])
    with pytest.raises(DataError, match="no files for nfl games season 1999"):
        register_views(con, cache, leagues=["nfl"], datasets=["games"], seasons=[1999])


def _cache(tmp_path, origin: Origin, clock: dict) -> DataCache:
    config = LabConfig(
        manifest_url=f"{ORIGIN}/manifest.json",
        cache_dir=tmp_path,
        run_dir=tmp_path / "runs",
        revalidate_seconds=FOUR_HOURS,
    )
    return DataCache(config, fetcher=origin, clock=lambda: clock["now"])
