"""Dataset and model files under the run store.

A later index can glob `datasets/*/meta.json` and `models/*/meta.json`.
This module does not list, compare, or write model cards.
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from sports_leader_lab.errors import LabError
from sports_leader_lab.payload import jsonable
from sports_leader_lab.store import RunStore


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def save_dataset(store: RunStore, dataset_id: str, frame: pd.DataFrame, meta: dict[str, Any]) -> Path:
    path = _dir(store, "datasets", dataset_id)
    frame.to_parquet(path / "data.parquet", index=False)
    _write_json(path / "meta.json", meta)
    return path


def load_dataset(store: RunStore, dataset_id: str) -> tuple[pd.DataFrame, dict]:
    path = _existing(store, "datasets", dataset_id)
    frame = pd.read_parquet(path / "data.parquet")
    return frame, _read_json(path / "meta.json")


def save_run(
    store: RunStore,
    run_id: str,
    bundle: dict[str, Any],
    meta: dict[str, Any],
    folds: list[dict],
    predictions: pd.DataFrame,
) -> Path:
    path = _dir(store, "models", run_id)
    joblib.dump(bundle, path / "model.joblib")
    _write_json(path / "meta.json", meta)
    _write_json(path / "folds.json", folds)
    predictions.to_parquet(path / "predictions.parquet", index=False)
    return path


def load_run(store: RunStore, run_id: str) -> tuple[dict, dict]:
    path = _existing(store, "models", run_id)
    bundle = joblib.load(path / "model.joblib")
    return bundle, _read_json(path / "meta.json")


def _dir(store: RunStore, kind: str, item_id: str) -> Path:
    if not item_id or "/" in item_id or item_id.startswith("."):
        raise LabError(f"illegal id '{item_id}'")
    path = store.ensure() / kind / item_id
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    return path


def _existing(store: RunStore, kind: str, item_id: str) -> Path:
    path = store.root / kind / item_id
    if not (path / "meta.json").is_file():
        label = "dataset" if kind == "datasets" else "run"
        raise LabError(f"unknown {label} '{item_id}'")
    return path


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(jsonable(payload), indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
