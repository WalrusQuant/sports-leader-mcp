# sports-leader-lab

Research tools for walk-forward models on the public [sportsleader-data](https://github.com/WalrusQuant/sportsleader-data) Parquet files. The lab reports how a model fits past games against simple baselines. It is not a betting edge, a pick, or a recommendation to bet.

These tools are part of the sports-leader MCP connector. One client config lists all 54 tools. The Node server starts this package on the first lab call. `python -m sports_leader_lab` remains the process that Node spawns; it is not a second connector to add.

Cache and run files stay outside the repo. See the repository README for the environment variables. Lab calls need `uv` and Python 3.11, 3.12, or 3.13. Without them the connector still starts and the live-data tools still work.

## Tools

| Tool | What it does |
|------|----------------|
| `ping` | Health check. Returns the lab version and the research disclaimer. |
| `inspect_data` | Rows, dates, grain, null rates, and pregame or postgame for one published dataset. |
| `query_data` | One SELECT on a published view such as `nfl_games`. External file access is off. Default cap 500 rows, at most 5000, 20 second timeout. |
| `build_dataset` | Pregame dataset for `home_win`, `margin`, `total`, or `team_points`. Saved only when the leakage audit passes. |
| `audit_features` | The same leakage checks as `build_dataset`. Does not save. A pass is REVIEW REQUIRED, never clean. |
| `train_classifier` | Walk-forward logistic or LightGBM. Calibration is none, Platt, or isotonic. `scheme` defaults to `season` (`date` is the other). `min_train_rows` defaults to 50. `test_days` defaults to 14. |
| `train_regressor` | Walk-forward ridge, Poisson, negative binomial, or LightGBM. Poisson and negative binomial are refused for margin. `scheme` defaults to `season`, `min_train_rows` to 50, and `test_days` to 14. |
| `predict` | Score `game_date` or `game_ids` as of now in America/Chicago. For `home_win`, `estimate` is P(home team wins). A completed game is a research replay. |
| `list_runs` | Saved runs for one league, newest first. `limit` is 1 to 100. |
| `compare_runs` | At least two runs on the primary metric. A different league or target is labeled, not hidden. |
| `model_card` | Twelve-section card rebuilt from the run record. It is a research record, not an approval. |

Feature families for `build_dataset` and `audit_features` are `site`, `elo`, `team_form`, `rest`, `injuries`, and `probables` (MLB). Omit `features` to use every family for that league.

`predict` returns `home_team_abbr`, `away_team_abbr`, `estimate`, and `estimate_kind` on each game. For a `home_win` run, `estimate` is P(home team wins) and `estimate_kind` is `home_win_probability`. GB at LAR with `estimate` 0.688 is P(LAR win) = 0.688, so P(GB win) is about 0.312. For `margin`, `total`, or `team_points`, `estimate` is that target and `estimate_kind` is the target name.

## Guardrails

- Walk-forward only. There is no random split.
- Features are known from the schedule, from prior games, or as of the start time.
- The leakage audit blocks a save on a target, score, or margin copy, a same-game box stat, a timestamp after start, or a raw snapshot reference.
- Metrics sit next to a constant baseline, a home-field baseline, and as-of Elo. A tie with Elo is not a win.
- Every result includes the no-edge disclaimer.
- `predict` compares a market price only when the caller passes one on that call. The price is not stored. The lab does not fetch odds and has no Kalshi data.

## Checks

```bash
uv run pytest
SPORTSLEADER_LAB_LIVE=1 uv run pytest -m live
uv run python scripts/smoke.py
```

The live marker pins NHL 2023 and MLB 2023 `home_win` (site and Elo, date folds) to the manifest sha256 of `games` and `team_game_stats`, and checks log loss stays within 0.02 of Elo. It also runs Brewers, Packers, and Bucks over stdio.

This package does not schedule a Monday job. `scripts/smoke.py` is the one-league build, train, and predict check a weekly audit outside the repo should run.
