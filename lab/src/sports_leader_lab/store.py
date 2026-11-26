"""Run directory for later train/predict artifacts. Phase 1 only reserves the path."""

from __future__ import annotations

from pathlib import Path

from sports_leader_lab.config import LabConfig, load_config


class RunStore:
    """Directory outside the repo where later phases write models, folds, and cards."""

    def __init__(self, root: Path) -> None:
        self.root = root

    @classmethod
    def from_config(cls, config: LabConfig | None = None) -> RunStore:
        cfg = config if config is not None else load_config()
        return cls(cfg.run_dir)

    def ensure(self) -> Path:
        self.root.mkdir(parents=True, mode=0o700, exist_ok=True)
        return self.root
