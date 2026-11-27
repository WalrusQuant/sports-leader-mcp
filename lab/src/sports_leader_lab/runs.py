"""Dataset and model files under the run store.

Listing and comparison live in registry.py and call the helpers here, so every
read still goes through the id check.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from sports_leader_lab.cards import csv_frame, fold_document, render_model_card
from sports_leader_lab.errors import LabError
from sports_leader_lab.payload import jsonable
from sports_leader_lab.store import RunStore

# Ids are a prefix plus 12 hex characters. Anything else is refused before a
# path join, and the resolved path has to stay inside the kind directory.
_ID = re.compile(r"^(run|dataset)_[0-9a-f]{12}$")
_KIND_PREFIX = {"datasets": "dataset", "models": "run"}


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
    document = fold_document(folds, kind=str(meta.get("kind") or ""))
    _write_json(path / "folds.json", document)
    csv_frame(predictions).to_csv(path / "predictions.csv", index=False)
    predictions.to_parquet(path / "predictions.parquet", index=False)
    stored = dict(meta)
    checksums = {
        "model.joblib": _sha256(path / "model.joblib"),
        "folds.json": _sha256(path / "folds.json"),
        "predictions.csv": _sha256(path / "predictions.csv"),
    }
    stored["artifacts"] = {
        "model": "model.joblib",
        "folds": "folds.json",
        "predictions": "predictions.csv",
        "predictions_parquet": "predictions.parquet",
        "model_card": "model_card.md",
        "meta": "meta.json",
    }
    stored["checksums"] = checksums
    markdown = render_model_card(stored, document)
    card_path = path / "model_card.md"
    card_path.write_text(markdown, encoding="utf-8")
    checksums["model_card.md"] = _sha256(card_path)
    _write_json(path / "meta.json", stored)
    return path


def load_run(store: RunStore, run_id: str) -> tuple[dict, dict]:
    path = _existing(store, "models", run_id)
    bundle = joblib.load(path / "model.joblib")
    return bundle, _read_json(path / "meta.json")


def read_run_meta(store: RunStore, run_id: str) -> dict:
    """Run record only. The model file is not unpickled."""
    path = _existing(store, "models", run_id)
    return _read_json(path / "meta.json")


def read_run_folds(store: RunStore, run_id: str) -> dict:
    path = _existing(store, "models", run_id)
    payload = json.loads((path / "folds.json").read_text(encoding="utf-8"))
    if isinstance(payload, dict):
        return payload
    return {"schema": "legacy", "aggregation": "unknown", "folds": payload}


def iter_run_metas(store: RunStore) -> list[dict]:
    """Metas whose directory name is a legal run id and whose path stays inside the store."""
    root = store.ensure().resolve()
    kind_root = root / "models"
    if not kind_root.is_dir():
        return []
    found: list[dict] = []
    for child in kind_root.iterdir():
        if _ID.fullmatch(child.name) is None or not child.name.startswith("run_"):
            continue
        try:
            path = _checked(store, "models", child.name)
        except LabError:
            continue
        meta_path = path / "meta.json"
        if not meta_path.is_file():
            continue
        found.append(_read_json(meta_path))
    return found


def _dir(store: RunStore, kind: str, item_id: str) -> Path:
    path = _checked(store, kind, item_id)
    path.mkdir(parents=True, mode=0o700, exist_ok=True)
    return path


def _existing(store: RunStore, kind: str, item_id: str) -> Path:
    path = _checked(store, kind, item_id)
    if not (path / "meta.json").is_file():
        label = "dataset" if kind == "datasets" else "run"
        raise LabError(f"unknown {label} '{item_id}'")
    return path


def _checked(store: RunStore, kind: str, item_id: str) -> Path:
    """Reject an id that is not `run_` or `dataset_` plus 12 hex digits, or that resolves outside its kind directory."""
    prefix = _KIND_PREFIX.get(kind)
    if prefix is None or not isinstance(item_id, str) or _ID.fullmatch(item_id) is None:
        raise LabError(f"illegal id '{item_id}'")
    if not item_id.startswith(prefix + "_"):
        raise LabError(f"illegal id '{item_id}'")
    root = store.ensure().resolve()
    kind_root = (root / kind).resolve()
    path = (kind_root / item_id).resolve()
    if path == kind_root or path.parent != kind_root or not path.is_relative_to(kind_root):
        raise LabError(f"illegal id '{item_id}'")
    return path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(jsonable(payload), indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
