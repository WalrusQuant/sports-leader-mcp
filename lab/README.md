# sports-leader-lab

Research tools for walk-forward models on the public [sportsleader-data](https://github.com/WalrusQuant/sportsleader-data) Parquet files. The lab reports how a model fits past games against simple baselines. It is not a betting edge, a pick, or a recommendation to bet.

Phase 1 is the package, the file cache, the leakage-safe feature registry, and the walk-forward split engine. Modeling tools are not in this package yet. There is no odds history and no Kalshi data.

The stdio server is separate from the Node sports-leader server:

```bash
cd lab
uv sync --group dev
uv run python -m sports_leader_lab
```

Cache and run files stay outside the repo. See the repository README for the environment variables and the MCP client snippet.
