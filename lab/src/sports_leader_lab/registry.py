"""Run registry: list, compare, and the model card for one run.

Ids go through the same check as load_run. A bad id or a path that resolves
outside the run store is refused before any file is read.
"""

from __future__ import annotations

from typing import Any

from sports_leader_lab import DISCLAIMER
from sports_leader_lab.cards import render_model_card, structured_card
from sports_leader_lab.data.catalog import LEAGUES
from sports_leader_lab.errors import LabError
from sports_leader_lab.payload import jsonable
from sports_leader_lab.runs import iter_run_metas, read_run_folds, read_run_meta
from sports_leader_lab.store import RunStore


def list_runs(league: str, limit: int = 20, *, store: RunStore | None = None) -> dict[str, Any]:
    """Newest runs for one league, capped by limit."""
    if league not in LEAGUES:
        raise LabError(f"unknown league '{league}'")
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1 or limit > 100:
        raise LabError("limit must be an integer from 1 to 100")
    destination = store if store is not None else RunStore.from_config()
    rows = []
    for meta in iter_run_metas(destination):
        if meta.get("league") != league:
            continue
        pooled = (meta.get("metrics") or {}).get("pooled") or {}
        model_metrics = pooled.get("model") or {}
        primary = "log_loss" if meta.get("kind") == "classifier" else "mae"
        rows.append(
            {
                "run_id": meta.get("run_id"),
                "created_at": meta.get("created_at"),
                "league": meta.get("league"),
                "target": meta.get("target"),
                "model": meta.get("model"),
                "kind": meta.get("kind"),
                "beats_elo": pooled.get("beats_elo", meta.get("beats_elo")),
                "primary_metric": primary,
                "primary": model_metrics.get(primary),
                "lab_version": (meta.get("reproducibility") or {}).get("lab_version"),
            }
        )
    rows.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return jsonable(
        {
            "league": league,
            "limit": limit,
            "runs": rows[:limit],
            "disclaimer": DISCLAIMER,
        }
    )


def compare_runs(run_ids: list[str], *, store: RunStore | None = None) -> dict[str, Any]:
    """Place runs next to each other. Different league or target is disclosed, not hidden."""
    if not isinstance(run_ids, (list, tuple)) or len(run_ids) < 2:
        raise LabError("compare_runs needs at least two run ids")
    destination = store if store is not None else RunStore.from_config()
    metas = [read_run_meta(destination, run_id) for run_id in run_ids]
    leagues = {meta.get("league") for meta in metas}
    targets = {meta.get("target") for meta in metas}
    comparable = len(leagues) == 1 and len(targets) == 1
    caveat = None
    if not comparable:
        caveat = (
            "These runs do not share a league and target, so the numbers are not a "
            "comparison on one population."
        )
    return jsonable(
        {
            "comparable": comparable,
            "caveat": caveat,
            "runs": [_compare_row(meta) for meta in metas],
            "disclaimer": DISCLAIMER,
        }
    )


def model_card(run_id: str, *, store: RunStore | None = None) -> dict[str, Any]:
    """Markdown card plus the results-reporting object, both from the run record."""
    destination = store if store is not None else RunStore.from_config()
    meta = read_run_meta(destination, run_id)
    folds = read_run_folds(destination, run_id)
    markdown = render_model_card(meta, folds)
    return jsonable(
        {
            "run_id": run_id,
            "markdown": markdown,
            "card": structured_card(meta, folds),
            "disclaimer": DISCLAIMER,
        }
    )


def _compare_row(meta: dict[str, Any]) -> dict[str, Any]:
    pooled = (meta.get("metrics") or {}).get("pooled") or {}
    model_metrics = pooled.get("model") or {}
    kind = str(meta.get("kind") or "")
    primary = "log_loss" if kind == "classifier" else "mae"
    folds = []
    for row in (meta.get("metrics") or {}).get("folds") or []:
        metrics = row.get("metrics") or {}
        folds.append(
            {
                "fold": row.get("fold"),
                "test_seasons": row.get("test_seasons"),
                "test_n": row.get("test_rows"),
                "candidate_primary": (metrics.get("model") or {}).get(primary),
                "elo_primary": (metrics.get("elo") or {}).get(primary),
                "constant_primary": (metrics.get("constant") or {}).get(primary),
                "beats_elo": row.get("beats_elo"),
            }
        )
    return {
        "run_id": meta.get("run_id"),
        "league": meta.get("league"),
        "target": meta.get("target"),
        "model": meta.get("model"),
        "kind": kind,
        "primary_metric": primary,
        "metric_direction": "lower",
        "candidate_primary": model_metrics.get(primary),
        "elo_primary": (pooled.get("elo") or {}).get(primary),
        "constant_primary": (pooled.get("constant") or {}).get(primary),
        "beats_elo": pooled.get("beats_elo"),
        "folds": folds,
        "lab_version": (meta.get("reproducibility") or {}).get("lab_version"),
        "features": (meta.get("reproducibility") or {}).get("features") or meta.get("feature_columns"),
    }
