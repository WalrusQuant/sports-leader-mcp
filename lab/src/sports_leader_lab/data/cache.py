"""Download Parquet on demand, check sha256, and keep past seasons on disk.

The manifest is refreshed every few hours. A file whose bytes already match
the manifest sha256 is not downloaded again. Past seasons therefore stay
put. The current season is revalidated because its expected hash comes from
that refreshed manifest: a changed hash downloads the new file once.

DuckDB httpfs is not used. Python downloads the bytes and DuckDB reads the
local file.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
import urllib.error
import urllib.request
import warnings
from pathlib import Path
from typing import Callable

from sports_leader_lab.config import LabConfig, load_config, require_public_url
from sports_leader_lab.data.manifest import Manifest, ManifestFile, parse_manifest
from sports_leader_lab.errors import ChecksumMismatch, DataError

USER_AGENT = "sports-leader-lab/0.1.0"
_MAX_BYTES = 256 * 1024 * 1024
_TIMEOUT_SECONDS = 60

Fetcher = Callable[[str], bytes]
Clock = Callable[[], float]


class DataCache:
    def __init__(
        self,
        config: LabConfig | None = None,
        *,
        fetcher: Fetcher | None = None,
        clock: Clock | None = None,
    ) -> None:
        self.config = config if config is not None else load_config()
        self._fetcher = fetcher if fetcher is not None else http_get
        self._clock = clock if clock is not None else time.time

    @classmethod
    def from_config(cls, config: LabConfig | None = None) -> DataCache:
        return cls(config if config is not None else load_config())

    def load_manifest(self, *, force: bool = False) -> Manifest:
        path, meta_path = self._manifest_paths()
        meta = _read_json(meta_path)
        if not force and _manifest_is_fresh(meta, path, self.config.manifest_url, self._clock(), self.config.revalidate_seconds):
            cached = _cached_manifest(path)
            if cached is not None:
                return cached
        try:
            body = self._fetcher(self.config.manifest_url)
        except DataError:
            cached = _cached_manifest(path)
            if cached is None:
                raise
            warnings.warn(
                "manifest refresh failed; using the cached manifest",
                UserWarning,
                stacklevel=2,
            )
            return cached
        except Exception as err:
            cached = _cached_manifest(path)
            if cached is None:
                raise DataError(f"manifest refresh failed ({err.__class__.__name__})") from None
            warnings.warn(
                "manifest refresh failed; using the cached manifest",
                UserWarning,
                stacklevel=2,
            )
            return cached
        manifest = parse_manifest(body)
        _atomic_write(path, body if isinstance(body, bytes) else body.encode("utf-8"))
        _atomic_write(
            meta_path,
            json.dumps({"checked_at": self._clock(), "url": self.config.manifest_url}).encode("utf-8"),
        )
        return manifest

    def ensure(self, entry: ManifestFile) -> Path:
        """Return the local Parquet path. Download only when the sha256 does not match."""
        dest = self.local_path(entry)
        if dest.is_file() and _sha256(dest.read_bytes()) == entry.sha256:
            return dest
        body = self._fetcher(entry.url)
        digest = hashlib.sha256(body).hexdigest()
        if digest != entry.sha256:
            raise ChecksumMismatch(f"sha256 mismatch for {entry.path}")
        _atomic_write(dest, body)
        _atomic_write(
            dest.with_name(dest.name + ".meta.json"),
            json.dumps({"sha256": digest, "updated_at": entry.updated_at}).encode("utf-8"),
        )
        return dest

    def ensure_many(self, entries: list[ManifestFile]) -> list[Path]:
        return [self.ensure(entry) for entry in entries]

    def local_path(self, entry: ManifestFile) -> Path:
        return self._safe_join(entry.path)

    def _manifest_paths(self) -> tuple[Path, Path]:
        root = self.config.cache_dir
        return root / "manifest.json", root / "manifest.meta.json"

    def _safe_join(self, rel: str) -> Path:
        root = (self.config.cache_dir / "files").resolve()
        dest = (root / rel).resolve()
        if dest != root and root not in dest.parents:
            raise DataError(f"refusing manifest path {rel}")
        if dest.suffix != ".parquet":
            raise DataError(f"refusing manifest path {rel}")
        return dest


def http_get(url: str) -> bytes:
    """GET one public GitHub release URL, following redirects. The URL is not included in errors."""
    require_public_url(url, "download URL", DataError)
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
    )
    opener = urllib.request.build_opener(_GuardedRedirect)
    try:
        with opener.open(request, timeout=_TIMEOUT_SECONDS) as response:
            chunks: list[bytes] = []
            total = 0
            while True:
                block = response.read(1024 * 1024)
                if not block:
                    break
                total += len(block)
                if total > _MAX_BYTES:
                    raise DataError("download exceeded the size limit")
                chunks.append(block)
            return b"".join(chunks)
    except DataError:
        raise
    except urllib.error.HTTPError as err:
        raise DataError(f"download failed with HTTP {err.code}") from None
    except Exception as err:
        raise DataError(f"download failed ({err.__class__.__name__})") from None


class _GuardedRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        require_public_url(newurl, "download URL", DataError)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _manifest_is_fresh(
    meta: dict[str, object] | None,
    path: Path,
    url: str,
    now: float,
    revalidate_seconds: float,
) -> bool:
    if meta is None or not path.is_file() or meta.get("url") != url:
        return False
    checked = meta.get("checked_at")
    try:
        age = now - float(checked)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return False
    return age < revalidate_seconds


def _cached_manifest(path: Path) -> Manifest | None:
    if not path.is_file():
        return None
    try:
        return parse_manifest(path.read_text(encoding="utf8"))
    except (OSError, UnicodeError, DataError):
        return None


def _sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def _read_json(path: Path) -> dict[str, object] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _atomic_write(dest: Path, body: bytes) -> None:
    dest.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    tmp = dest.with_name(f"{dest.name}.{os.getpid()}.{time.time_ns()}.tmp")
    try:
        tmp.write_bytes(body)
        os.chmod(tmp, 0o600)
        os.replace(tmp, dest)
    finally:
        if tmp.exists():
            tmp.unlink()
