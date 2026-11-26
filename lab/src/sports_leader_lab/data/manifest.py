"""Parse the sportsleader-data manifest. File bytes are downloaded separately."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from sports_leader_lab.errors import DataError

_SHA = re.compile(r"^[a-f0-9]{64}$")
_IDENT = re.compile(r"^[a-z][a-z0-9_]*$")
_PATH = re.compile(r"^[a-z][a-z0-9_]*/[a-z][a-z0-9_]*/\d{4}\.parquet$")


@dataclass(frozen=True)
class ManifestFile:
    path: str
    league: str
    dataset: str
    season: int
    rows: int
    columns: tuple[tuple[str, str], ...]
    bytes: int
    sha256: str
    updated_at: str
    url: str

    @property
    def column_names(self) -> tuple[str, ...]:
        return tuple(name for name, _ in self.columns)


@dataclass(frozen=True)
class Manifest:
    version: int
    generated_at: str
    files: tuple[ManifestFile, ...]

    def current_seasons(self) -> dict[str, int]:
        latest: dict[str, int] = {}
        for entry in self.files:
            prev = latest.get(entry.league)
            if prev is None or entry.season > prev:
                latest[entry.league] = entry.season
        return latest

    def is_current(self, entry: ManifestFile) -> bool:
        return entry.season == self.current_seasons().get(entry.league)

    def find(self, league: str, dataset: str, season: int) -> ManifestFile | None:
        for entry in self.files:
            if entry.league == league and entry.dataset == dataset and entry.season == season:
                return entry
        return None

    def leagues(self) -> set[str]:
        return {entry.league for entry in self.files}

    def datasets(self) -> set[str]:
        return {entry.dataset for entry in self.files}


def parse_manifest(raw: str | bytes | dict[str, Any]) -> Manifest:
    if isinstance(raw, (str, bytes)):
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as err:
            raise DataError("manifest is not valid JSON") from err
    else:
        payload = raw
    if not isinstance(payload, dict):
        raise DataError("manifest is not a JSON object")
    version = payload.get("version")
    generated = payload.get("generated_at")
    files = payload.get("files")
    if not isinstance(version, int):
        raise DataError("manifest is missing version")
    if not isinstance(generated, str) or not generated:
        raise DataError("manifest is missing generated_at")
    if not isinstance(files, list):
        raise DataError("manifest is missing files")
    parsed = tuple(_parse_file(entry, index) for index, entry in enumerate(files))
    return Manifest(version=version, generated_at=generated, files=parsed)


def _parse_file(entry: Any, index: int) -> ManifestFile:
    label = f"files[{index}]"
    if not isinstance(entry, dict):
        raise DataError(f"manifest {label} is not an object")
    league = _req_str(entry, "league", label)
    dataset = _req_str(entry, "dataset", label)
    if not _IDENT.match(league) or not _IDENT.match(dataset):
        raise DataError(f"manifest {label} has an illegal league or dataset name")
    season = entry.get("season")
    if not isinstance(season, int) or season < 0:
        raise DataError(f"manifest {label} is missing season")
    path = _req_str(entry, "path", label)
    expected = f"{league}/{dataset}/{season}.parquet"
    if path != expected or not _PATH.match(path):
        raise DataError(f"manifest path does not match league/dataset/season: {path}")
    sha = _req_str(entry, "sha256", label).lower()
    if not _SHA.match(sha):
        raise DataError(f"manifest {path} has an invalid sha256")
    columns = _columns(entry.get("columns"), path)
    url = entry.get("url")
    if not isinstance(url, str) or not url:
        url = _release_url(league, dataset, season)
    _require_public_url(url, path)
    rows = entry.get("rows")
    size = entry.get("bytes")
    if not isinstance(rows, int) or not isinstance(size, int):
        raise DataError(f"manifest {path} is missing rows or bytes")
    updated = _req_str(entry, "updated_at", label)
    return ManifestFile(
        path=path,
        league=league,
        dataset=dataset,
        season=season,
        rows=rows,
        columns=columns,
        bytes=size,
        sha256=sha,
        updated_at=updated,
        url=url,
    )


def _columns(raw: Any, path: str) -> tuple[tuple[str, str], ...]:
    if not isinstance(raw, list) or not raw:
        raise DataError(f"manifest {path} is missing columns")
    columns: list[tuple[str, str]] = []
    for index, column in enumerate(raw):
        if not isinstance(column, dict):
            raise DataError(f"manifest {path} column {index} is invalid")
        name = column.get("name")
        kind = column.get("type")
        if not isinstance(name, str) or not isinstance(kind, str):
            raise DataError(f"manifest {path} column {index} is invalid")
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
            raise DataError(f"manifest {path} has an illegal column name")
        columns.append((name, kind))
    return tuple(columns)


def _release_url(league: str, dataset: str, season: int) -> str:
    return (
        "https://github.com/WalrusQuant/sportsleader-data/releases/download/"
        f"{league}_{dataset}/{season}.parquet"
    )


def _require_public_url(url: str, path: str) -> None:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise DataError(f"manifest {path} url must be http or https")
    if parsed.username or parsed.password:
        raise DataError(f"manifest {path} url must not include credentials")


def _req_str(entry: dict[str, Any], key: str, label: str) -> str:
    value = entry.get(key)
    if not isinstance(value, str) or not value:
        raise DataError(f"manifest {label} is missing {key}")
    return value
