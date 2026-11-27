"""One-league lab smoke: build, train, and predict.

Prints one line and exits 0 when the three steps return a research estimate
with the disclaimer and a US Central as-of time. This repository does not
schedule a Monday job. A weekly audit that lives outside the repo should run:

    cd lab && uv run python scripts/smoke.py

`npm run audit` prints the same check as a `lab smoke` row when `uv` is on
PATH, and skips the row when it is not.
"""

from __future__ import annotations

import os
import sys
import tempfile

from sports_leader_lab.config import load_config
from sports_leader_lab.data.cache import DataCache
from sports_leader_lab.datasets import build_dataset
from sports_leader_lab.predict import predict
from sports_leader_lab.runs import load_dataset
from sports_leader_lab.store import RunStore
from sports_leader_lab.training import train_classifier


def main() -> int:
    runs = tempfile.mkdtemp(prefix="sports-leader-lab-smoke-")
    env = os.environ.copy()
    env["SPORTSLEADER_LAB_RUN_DIR"] = runs
    config = load_config(env)
    cache = DataCache(config)
    store = RunStore.from_config(config)
    try:
        built = build_dataset(
            "nfl",
            "home_win",
            [2023, 2024],
            features=["site", "elo"],
            store=store,
            cache=cache,
        )
        trained = train_classifier(
            built["dataset_id"],
            model="logistic",
            scheme="season",
            min_train_seasons=1,
            store=store,
        )
        frame, _meta = load_dataset(store, built["dataset_id"])
        latest = frame.sort_values(["game_date", "game_id"]).iloc[-1]
        scored = predict(
            trained["run_id"],
            game_ids=[str(latest["game_id"])],
            store=store,
            cache=cache,
        )
    except Exception as err:
        print(f"FAIL nfl home_win {err.__class__.__name__}: {err}", file=sys.stderr)
        return 1
    game = scored["games"][0]
    if scored["as_of_timezone"] != "America/Chicago":
        print("FAIL nfl home_win as_of_timezone was not America/Chicago", file=sys.stderr)
        return 1
    if "not a recommendation to bet" not in scored["disclaimer"].lower():
        print("FAIL nfl home_win disclaimer missing", file=sys.stderr)
        return 1
    replay = "yes" if any("research replay" in warning for warning in scored["warnings"]) else "no"
    log_loss = trained["pooled"]["model"]["log_loss"]
    print(
        "PASS nfl home_win "
        f"rows={built['rows']} log_loss={log_loss:.6f} "
        f"game={game['game_id']} as_of={scored['as_of']} replay={replay}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
