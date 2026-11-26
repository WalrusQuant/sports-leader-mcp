import tomllib
from pathlib import Path

import pytest

from sports_leader_lab import __version__
from sports_leader_lab.config import DEFAULT_MANIFEST_URL, load_config
from sports_leader_lab.errors import ConfigError
from sports_leader_lab.store import RunStore

ROOT = Path(__file__).resolve().parents[2]
LAB = Path(__file__).resolve().parents[1]


def test_version_is_dev_and_matches_pyproject():
    pyproject = tomllib.loads((LAB / "pyproject.toml").read_text(encoding="utf8"))
    assert pyproject["project"]["version"] == "0.1.0.dev0"
    assert __version__ == "0.1.0.dev0"


def test_manifest_url_matches_the_node_data_tools():
    source = (ROOT / "src" / "data" / "config.ts").read_text(encoding="utf8")
    assert DEFAULT_MANIFEST_URL in source
    assert DEFAULT_MANIFEST_URL.startswith("https://github.com/WalrusQuant/sportsleader-data/")


def test_default_dirs_live_outside_the_repo():
    config = load_config({})
    for path in (config.cache_dir, config.run_dir):
        assert path.is_absolute()
        assert path != ROOT
        assert ROOT not in path.parents


def test_env_overrides_cache_run_dir_and_xdg(tmp_path):
    config = load_config(
        {
            "XDG_CACHE_HOME": str(tmp_path / "xdg"),
            "SPORTSLEADER_LAB_CACHE_DIR": str(tmp_path / "cache"),
            "SPORTSLEADER_LAB_RUN_DIR": str(tmp_path / "runs"),
            "SPORTSLEADER_LAB_REVALIDATE_HOURS": "1.5",
        }
    )
    assert config.cache_dir == (tmp_path / "cache").resolve()
    assert config.run_dir == (tmp_path / "runs").resolve()
    assert config.revalidate_seconds == 1.5 * 3600
    store = RunStore.from_config(config)
    assert store.ensure() == config.run_dir
    assert store.root.is_dir()


def test_xdg_default_when_cache_dir_is_unset(tmp_path):
    config = load_config({"XDG_CACHE_HOME": str(tmp_path / "xdg")})
    assert config.cache_dir == (tmp_path / "xdg" / "sports-leader-lab" / "data").resolve()
    assert config.run_dir == (tmp_path / "xdg" / "sports-leader-lab" / "runs").resolve()


def test_bad_settings_are_rejected():
    with pytest.raises(ConfigError):
        load_config({"SPORTSLEADER_LAB_REVALIDATE_HOURS": "-1"})
    with pytest.raises(ConfigError):
        load_config({"SPORTSLEADER_LAB_MANIFEST_URL": "https://user:secret@github.com/WalrusQuant/manifest.json"})
    with pytest.raises(ConfigError):
        load_config({"SPORTSLEADER_LAB_MANIFEST_URL": "file:///tmp/manifest.json"})
    with pytest.raises(ConfigError, match="GitHub release host"):
        load_config({"SPORTSLEADER_LAB_MANIFEST_URL": "https://example.com/manifest.json"})
    allowed = load_config(
        {"SPORTSLEADER_LAB_MANIFEST_URL": "https://release-assets.githubusercontent.com/manifest.json"}
    )
    assert allowed.manifest_url.startswith("https://release-assets.githubusercontent.com/")
