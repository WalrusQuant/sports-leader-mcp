"""Run directory for dataset and model artifacts.

Layout, so a later index can glob it:

- `datasets/<dataset_id>/data.parquet` and `meta.json`
- `models/<run_id>/model.joblib`, `meta.json`, `folds.json`, `predictions.parquet`
"""

from __future__ import annotations

from pathlib import Path

from sports_leader_lab.config import LabConfig, load_config


class RunStore:
    """Directory outside the repo where datasets and trained runs are written."""

    def __init__(self, root: Path) -> None:
        self.root = root

    @classmethod
    def from_config(cls, config: LabConfig | None = None) -> RunStore:
        cfg = config if config is not None else load_config()
        return cls(cfg.run_dir)

    def ensure(self) -> Path:
        self.root.mkdir(parents=True, mode=0o700, exist_ok=True)
        return self.root
