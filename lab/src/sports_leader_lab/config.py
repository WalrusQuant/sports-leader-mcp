"""Cache and run-store locations. Both live outside the repo."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from sports_leader_lab.errors import ConfigError

# Same public manifest the Node data tools read (src/data/config.ts).
DEFAULT_MANIFEST_URL = (
    "https://github.com/WalrusQuant/sportsleader-data/releases/download/manifest/manifest.json"
)

# Current-season files are rechecked on this cadence. Past seasons are not.
DEFAULT_REVALIDATE_HOURS = 4.0

# github.com redirects a release download to release-assets.githubusercontent.com.
# objects.githubusercontent.com is the older asset host.
ALLOWED_DOWNLOAD_HOSTS = frozenset(
    {
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    }
)

_MANIFEST_ENV = ("SPORTSLEADER_LAB_MANIFEST_URL", "SPORTSLEADER_DATA_MANIFEST_URL")


@dataclass(frozen=True)
class LabConfig:
    manifest_url: str
    cache_dir: Path
    run_dir: Path
    revalidate_seconds: float

    def __post_init__(self) -> None:
        _require_http_url(self.manifest_url, "manifest URL")
        if self.revalidate_seconds < 0:
            raise ConfigError("revalidate interval must be >= 0")


def load_config(env: Mapping[str, str] | None = None) -> LabConfig:
    """Resolve settings from `env`, or from the process environment when `env` is omitted."""
    source = os.environ if env is None else env
    root = _cache_root(source)
    cache = _path_setting(source, "SPORTSLEADER_LAB_CACHE_DIR", root / "data")
    runs = _path_setting(source, "SPORTSLEADER_LAB_RUN_DIR", root / "runs")
    return LabConfig(
        manifest_url=_manifest_url(source),
        cache_dir=cache,
        run_dir=runs,
        revalidate_seconds=_revalidate_seconds(source),
    )


def _cache_root(env: Mapping[str, str]) -> Path:
    xdg = env.get("XDG_CACHE_HOME", "").strip()
    base = Path(xdg).expanduser() if xdg else Path.home() / ".cache"
    return base / "sports-leader-lab"


def _path_setting(env: Mapping[str, str], name: str, default: Path) -> Path:
    raw = env.get(name, "").strip()
    path = Path(raw).expanduser() if raw else default
    return path.resolve()


def _manifest_url(env: Mapping[str, str]) -> str:
    for name in _MANIFEST_ENV:
        raw = env.get(name, "").strip()
        if raw:
            _require_http_url(raw, name)
            return raw
    return DEFAULT_MANIFEST_URL


def _revalidate_seconds(env: Mapping[str, str]) -> float:
    raw = env.get("SPORTSLEADER_LAB_REVALIDATE_HOURS", "").strip()
    if not raw:
        return DEFAULT_REVALIDATE_HOURS * 3600
    try:
        hours = float(raw)
    except ValueError as err:
        raise ConfigError("SPORTSLEADER_LAB_REVALIDATE_HOURS must be a number") from err
    if hours < 0:
        raise ConfigError("SPORTSLEADER_LAB_REVALIDATE_HOURS must be >= 0")
    return hours * 3600


def _require_http_url(value: str, label: str) -> None:
    require_public_url(value, label, ConfigError)


def require_public_url(value: str, label: str, error: type[Exception]) -> None:
    """Reject credentials and any host other than the public GitHub release hosts."""
    from urllib.parse import urlparse

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise error(f"{label} must be an http or https URL")
    if parsed.username or parsed.password:
        raise error(f"{label} must not include credentials")
    if parsed.hostname.lower() not in ALLOWED_DOWNLOAD_HOSTS:
        raise error(f"{label} host must be a GitHub release host")
