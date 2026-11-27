"""Model cards and the fold / prediction files a run writes.

The card follows the sports-analytic-skills model-card template. Fold rows
follow its validation-design table. predictions.csv is the held-out file the
results-reporting contract names. Extra fields are included; required ones
are never dropped.
"""

from __future__ import annotations

import json
from typing import Any

import pandas as pd

from sports_leader_lab import DISCLAIMER

_CSV_FRONT = (
    "fold",
    "game_id",
    "game_date",
    "season",
    "y",
    "prediction",
    "baseline_constant",
    "baseline_home_field",
    "baseline_elo",
)


def csv_frame(predictions: pd.DataFrame) -> pd.DataFrame:
    front = [column for column in _CSV_FRONT if column in predictions.columns]
    rest = [column for column in predictions.columns if column not in front]
    return predictions.loc[:, front + rest]


def fold_document(rows: list[dict], *, kind: str) -> dict[str, Any]:
    """One row per test fold, with the validation-design and reporting fields."""
    folds = [_fold_row(row, kind=kind) for row in rows]
    return {
        "schema": "sports-analytic-skills/validation-design",
        "aggregation": "pooled over held-out rows; the fold table itself is one unweighted row per test fold",
        "primary_metric": "log_loss" if kind == "classifier" else "mae",
        "metric_direction": "lower",
        "folds": folds,
    }


def render_model_card(meta: dict[str, Any], folds: dict[str, Any]) -> str:
    """Model card from the template, plus the skill's approval-history section.

    Callers pass the sorted JSON object a reload returns. Dicts in the text are
    serialized with sorted keys so a second render of that record is the same bytes.
    """
    repro = meta.get("reproducibility") or {}
    pooled = (meta.get("metrics") or {}).get("pooled") or {}
    model_metrics = pooled.get("model") or {}
    kind = str(meta.get("kind") or "")
    primary = "log_loss" if kind == "classifier" else "mae"
    league = meta.get("league")
    target = meta.get("target")
    model = meta.get("model")
    seasons = meta.get("seasons") or []
    window = _window(seasons)
    manifest = list(repro.get("data_manifest") or [])
    families = [str(name) for name in (repro.get("families") or meta.get("families") or [])]
    features = [str(name) for name in (repro.get("features") or meta.get("feature_columns") or [])]
    split = repro.get("split") or {}
    beats = pooled.get("beats_elo")
    if beats is True:
        beat_line = "The pooled primary metric beat Elo on the same held-out rows."
    elif beats is False:
        beat_line = "The pooled primary metric did not beat Elo on the same held-out rows."
    else:
        beat_line = "Elo was not scored for this target, so there is no Elo comparison."
    lines = [
        f"# Model card: {league} {target} {model}",
        "",
        DISCLAIMER,
        "",
        "## 1. Identity",
        "",
        f"- Name: `{meta.get('run_id')}` ({model}, {kind}).",
        f"- Version: lab {repro.get('lab_version')}.",
        "- Owner: sports-leader-lab.",
        "- Reviewers: none recorded.",
        "- Status: experimental. This card is a research record, not an approval.",
        f"- Created: {meta.get('created_at')}.",
        "- Next review: not scheduled.",
        "",
        "## 2. Intended use",
        "",
        "- In scope: measuring how a model fits past games against constant, home-field, and Elo baselines.",
        "- Users: someone reading a research run.",
        "- Out of scope: live betting, picks, staking, or a claim that a gap will persist.",
        "- Prohibited uses: treating the estimate as a betting edge or a recommendation to bet.",
        "",
        "## 3. Target and timing",
        "",
        f"- Target: `{target}` ({meta.get('target_kind')}).",
        "- Grain: one row per game.",
        "- Decision time T: pregame. Features must be known at schedule, from prior games, or as of start.",
        "- Horizon: the game's result. The saved model is refit on every labeled row after the walk-forward scores are computed; the numbers below are the walk-forward scores.",
        "",
        "## 4. Data",
        "",
        f"- Sport / competition: `{league}`. Population: completed non-preseason games in the saved dataset.",
        "- Sources: public sportsleader-data Parquet, when a manifest checksum was recorded.",
        f"- Window: {window}.",
        "- Filters: preseason and games without a target are excluded. Ties are dropped for home_win.",
        f"- Snapshot: {len(manifest)} manifest file(s). See the reproduction section for sha256.",
        f"- Sample size: {pooled.get('rows', 'not recorded')} held-out prediction rows.",
        "",
        "## 5. Features",
        "",
        f"- Feature families: {', '.join(families) if families else 'none recorded'}. These are the names `build_dataset` takes.",
        f"- Feature columns: {', '.join(features) if features else 'none recorded'}.",
        "- Transforms: linear models median-impute and standardize on the fit slice of each training fold. LightGBM keeps missing values.",
        "- Time safety: the dataset audit runs before save. An automated pass is REVIEW REQUIRED, not CLEAN.",
        "",
        "## 6. Baselines",
        "",
        "- Constant training-fold rate or mean, home-field rate or mean, and Elo.",
        "- Comparison rule: the same held-out rows. Lower is better for the primary metric. A tie with Elo is not a win.",
        f"- Candidate: `{model}` with calibration `{meta.get('calibration')}`.",
        "",
        "## 7. Validation",
        "",
        f"- Design: {split.get('scheme', 'season')} walk-forward.",
        f"- Split: min_train_seasons={split.get('min_train_seasons')}, min_train_rows={split.get('min_train_rows')}, embargo_days={split.get('embargo_days')}, test_days={split.get('test_days')}.",
        f"- Primary metric: {primary} (lower is better).",
        "- Secondary metrics: Brier, AUC, and ECE for classifiers; RMSE and residual spread for regressors.",
        "- Fold boundaries are in folds.json. Train max time is before test min time, plus any embargo.",
        "- The headline number is pooled over held-out rows. The fold table is one unweighted row per test fold.",
        "",
        "## 8. Results",
        "",
        f"- Pooled candidate {primary}: {_fmt(model_metrics.get(primary))}.",
        f"- Pooled Elo {primary}: {_fmt((pooled.get('elo') or {}).get(primary))}.",
        f"- Pooled constant {primary}: {_fmt((pooled.get('constant') or {}).get(primary))}.",
        f"- {beat_line}",
        "",
        _fold_table(folds),
        "",
        "## 9. Limits and failure modes",
        "",
        "- " + DISCLAIMER,
        "- A gap on past games is not a future edge.",
        "- Kill conditions for this research record: two consecutive walk-forward test seasons worse than the constant baseline on the primary metric; a leakage audit of NOT CLEAN; a break in the feature columns used here.",
        "- No production monitor is attached.",
        "",
        "## 10. Maintenance",
        "",
        "- Monitoring: none.",
        "- Retrain trigger: a new saved dataset, not a schedule.",
        "- Kill conditions: see Limits.",
        "",
        "## 11. Artifact manifest and reproduction",
        "",
        "- Artifacts, relative to the run directory: model.joblib, folds.json, predictions.csv, predictions.parquet, meta.json, model_card.md.",
        f"- Lab version: {repro.get('lab_version')}.",
        f"- Feature families: {_stable(families)}.",
        f"- Feature columns: {_stable(features)}.",
        f"- Seeds: {_stable(repro.get('seeds'))}.",
        f"- Params: {_stable(repro.get('params'))}.",
        f"- Command recorded with the run: {_stable(repro.get('command'))}.",
        "- Data manifest sha256:",
    ]
    if manifest:
        for entry in manifest:
            lines.append(f"  - `{entry.get('path')}` {entry.get('sha256')}")
    else:
        lines.append("  - none. The dataset was not tied to a manifest checksum (in-memory frames, or the manifest was not read).")
    checksums = meta.get("checksums") or {}
    if checksums:
        lines.append("- Artifact sha256:")
        for name in sorted(checksums):
            if name == "model_card.md":
                continue
            lines.append(f"  - `{name}` {checksums[name]}")
    warnings = meta.get("warnings") or []
    if warnings:
        lines.extend(["", "Warnings recorded on the run:"])
        lines.extend(f"- {warning}" for warning in warnings)
    lines.extend(
        [
            "",
            "## 12. Approval history and linked experiments",
            "",
            "- Approval history: none. This card is not an approval.",
            "- Reviewers: none recorded.",
            f"- Linked experiment: `{meta.get('run_id')}`.",
            "",
        ]
    )
    return "\n".join(lines)


def structured_card(meta: dict[str, Any], folds: dict[str, Any]) -> dict[str, Any]:
    """Results-reporting JSON. The command is the recorded tool call, not an invented shell line."""
    repro = meta.get("reproducibility") or {}
    pooled = (meta.get("metrics") or {}).get("pooled") or {}
    model_metrics = pooled.get("model") or {}
    kind = str(meta.get("kind") or "")
    primary = "log_loss" if kind == "classifier" else "mae"
    league = meta.get("league")
    target = meta.get("target")
    seasons = meta.get("seasons") or []
    manifest = list(repro.get("data_manifest") or [])
    results: dict[str, Any] = {
        f"candidate_{primary}": model_metrics.get(primary),
        f"elo_{primary}": (pooled.get("elo") or {}).get(primary),
        f"constant_{primary}": (pooled.get("constant") or {}).get(primary),
        "beats_elo": pooled.get("beats_elo"),
        "folds": folds.get("folds") or [],
    }
    return {
        "title": f"{league} {target} {meta.get('model')}",
        "analysis_type": "predictive",
        "question": (
            f"How well does {meta.get('model')} fit past {league} {target} games "
            "against simple baselines on a walk-forward split?"
        ),
        "data": {
            "source": "sportsleader-data" if manifest else "in-memory frames; no manifest sha256",
            "sport": league,
            "grain": "game",
            "period": _window(seasons),
            "n": pooled.get("rows"),
            "manifest": manifest,
        },
        "methods": {
            "target": target,
            "decision_time": meta.get("decision_time") or "pregame",
            "baseline": "constant training-fold rate or mean, home field, and Elo",
            "candidate": meta.get("model"),
        },
        "validation": {
            "design": f"{(repro.get('split') or {}).get('scheme', 'season')} walk-forward",
            "primary_metric": primary,
            "metric_direction": "lower",
            "comparison_population": "identical held-out game rows",
        },
        "results": results,
        "interpretation": DISCLAIMER,
        "limits": [
            DISCLAIMER,
            "A gap on past games is not a future edge.",
            "No production monitor is attached.",
        ],
        "reproduction": {
            "artifacts": [
                "model.joblib",
                "folds.json",
                "predictions.csv",
                "meta.json",
                "model_card.md",
            ],
            "command": repro.get("command"),
            "lab_version": repro.get("lab_version"),
            "seeds": repro.get("seeds"),
            "split": repro.get("split"),
            "features": repro.get("features") or meta.get("feature_columns"),
            "params": repro.get("params"),
            "data_manifest": manifest,
            "checksums": meta.get("checksums") or {},
        },
        "disclaimer": DISCLAIMER,
    }


def _fold_row(row: dict, *, kind: str) -> dict[str, Any]:
    metrics = row.get("metrics") or {}
    model = metrics.get("model") or {}
    elo = metrics.get("elo") or {}
    constant = metrics.get("constant") or {}
    if kind == "classifier":
        primary = "log_loss"
        candidate = model.get("log_loss")
        baseline_name, baseline = _baseline(elo, constant, "log_loss")
        secondary = {key: model.get(key) for key in ("brier", "auc", "ece") if model.get(key) is not None}
    else:
        primary = "mae"
        candidate = model.get("mae")
        baseline_name, baseline = _baseline(elo, constant, "mae")
        secondary = {
            key: model.get(key)
            for key in ("rmse", "residual_sd", "poisson_deviance")
            if model.get(key) is not None
        }
    gap = None
    if candidate is not None and baseline is not None:
        gap = float(candidate) - float(baseline)
    train_seasons = [str(season) for season in (row.get("train_seasons") or [])]
    test_seasons = [str(season) for season in (row.get("test_seasons") or [])]
    warning = row.get("warning")
    return {
        "fold": row.get("fold"),
        "test_season": int(test_seasons[0]) if len(test_seasons) == 1 and str(test_seasons[0]).isdigit() else None,
        "train_seasons": ",".join(train_seasons),
        "n_train": row.get("train_rows"),
        "n_test": row.get("test_rows"),
        "train_period": _period(row.get("train_start"), row.get("train_end"), train_seasons),
        "test_period": _period(row.get("test_start"), row.get("test_end"), test_seasons),
        "train_n": row.get("train_rows"),
        "test_n": row.get("test_rows"),
        "primary_metric": primary,
        "metric_direction": "lower",
        "baseline": baseline_name,
        "baseline_primary": baseline,
        "candidate_primary": candidate,
        "gap": gap,
        "secondary_metrics": secondary,
        "exclusions": [],
        "failures": [],
        "warnings": [warning] if warning else [],
        "beats_elo": row.get("beats_elo"),
    }


def _baseline(elo: dict, constant: dict, key: str) -> tuple[str, Any]:
    if elo.get(key) is not None:
        return "elo", elo.get(key)
    return "constant", constant.get(key)


def _period(start: Any, end: Any, seasons: list[str]) -> str:
    if start and end:
        return f"{start}/{end}"
    if seasons:
        return ",".join(seasons)
    return ""


def _window(seasons: list) -> str:
    if not seasons:
        return "not recorded"
    ordered = sorted(int(season) for season in seasons)
    if len(ordered) == 1:
        return str(ordered[0])
    return f"{ordered[0]}-{ordered[-1]}"


def _stable(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(", ", ": "), default=str)


def _fmt(value: Any) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f"{float(value):.6f}"
    return "not recorded"


def _fold_table(folds: dict[str, Any]) -> str:
    header = (
        "fold | train_period | test_period | train_n | test_n | baseline_primary | "
        "candidate_primary | gap | secondary_metrics | exclusions | failures"
    )
    lines = [header, "--- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---"]
    for row in folds.get("folds") or []:
        lines.append(
            " | ".join(
                [
                    str(row.get("fold")),
                    str(row.get("train_period")),
                    str(row.get("test_period")),
                    str(row.get("train_n")),
                    str(row.get("test_n")),
                    _fmt(row.get("baseline_primary")),
                    _fmt(row.get("candidate_primary")),
                    _fmt(row.get("gap")),
                    _stable(row.get("secondary_metrics")),
                    str(row.get("exclusions")),
                    str(row.get("failures")),
                ]
            )
        )
    if len(lines) == 2:
        lines.append("none | | | | | | | | | |")
    return "\n".join(lines)
