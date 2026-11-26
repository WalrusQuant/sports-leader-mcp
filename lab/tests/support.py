"""Small in-memory Parquet files and a manifest the cache can read without the network."""

from __future__ import annotations

import hashlib
import json

import pandas as pd

ORIGIN = "https://data.invalid"


def parquet_bytes(frame: pd.DataFrame) -> bytes:
    import io

    buffer = io.BytesIO()
    frame.to_parquet(buffer, index=False)
    return buffer.getvalue()


def file_entry(league: str, dataset: str, season: int, frame: pd.DataFrame) -> tuple[dict, bytes]:
    body = parquet_bytes(frame)
    digest = hashlib.sha256(body).hexdigest()
    columns = [{"name": name, "type": "int"} for name in frame.columns]
    entry = {
        "path": f"{league}/{dataset}/{season}.parquet",
        "league": league,
        "dataset": dataset,
        "season": season,
        "rows": int(len(frame)),
        "columns": columns,
        "bytes": len(body),
        "sha256": digest,
        "updated_at": "2024-01-01T00:00:00Z",
        "url": f"{ORIGIN}/{league}_{dataset}/{season}.parquet",
    }
    return entry, body


def manifest(entries: list[dict], *, version: int = 1) -> dict:
    return {"version": version, "generated_at": "2024-01-01T00:00:00Z", "files": entries}


class Origin:
    """Fetcher that records URLs and serves a mutable manifest plus Parquet bytes."""

    def __init__(self, payload: dict, files: dict[str, bytes]) -> None:
        self.payload = payload
        self.files = files
        self.calls: list[str] = []

    def __call__(self, url: str) -> bytes:
        self.calls.append(url)
        if url.endswith("/manifest.json"):
            return json.dumps(self.payload).encode("utf-8")
        if url not in self.files:
            raise AssertionError(f"unexpected download {url}")
        return self.files[url]

    def parquet_calls(self) -> list[str]:
        return [url for url in self.calls if not url.endswith("/manifest.json")]
