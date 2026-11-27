# Tools

Overview of all 54 tools available in sports-leader-mcp.

Compact JSON is the default. The live-data tools accept optional `raw: true`; oversized output is replaced with a valid `{ "truncated": true, ... }` envelope instead of partial JSON. The eleven research-lab tools do not take `raw`.

Results carry the compact JSON as a text block and as MCP `structuredContent` (top-level arrays as `{ "items": [...] }`). `get_scoreboard`, `get_game_summary`, `get_game_odds`, `get_injuries`, `get_athlete_gamelog`, `get_player_report`, `get_player_trends`, `get_slate`, `get_game_preview`, `get_team_stats`, `get_rankings`, `get_power_index`, `get_futures`, `get_kalshi_markets`, `get_polymarket_markets`, and `get_market_odds` also publish an `outputSchema`; schemas allow extra properties because fields are only ever added. With `raw: true` the text block is the untouched ESPN JSON and `structuredContent` is `{ "raw": true, "response": ... }`.

Large sub-payloads are also available as `espn://` resource templates (see the [docs home](../README.md#resources)); `get_game_summary` and `get_slate` return `resource_link` items that point at them.

## Discovery & Search

| Tool | Description |
|------|-------------|
| [`list_sports_and_leagues`](discovery.md#list_sports_and_leagues) | Curated verified sport/league slug catalog |
| [`search`](discovery.md#search) | Global search for athletes, teams, and articles |
| [`espn_fetch`](discovery.md#espn_fetch) | Fetch any ESPN URL directly (escape hatch) |

## Scoreboard & Games

| Tool | Description |
|------|-------------|
| [`get_scoreboard`](scoreboard.md#get_scoreboard) | Live and scheduled games. Older days come from the games export. Entry point for finding eventIds. |
| [`get_game_summary`](scoreboard.md#get_game_summary) | Score, team/player boxscore, leaders, key plays, sampled win probability. |
| [`get_game_plays`](scoreboard.md#get_game_plays) | Full play-by-play data for a game. |
| [`get_game_odds`](scoreboard.md#get_game_odds) | Betting odds per provider with numeric moneylines, implied and no-vig probabilities, signed `homeSpread`, and consensus. |
| [`get_game_probabilities`](scoreboard.md#get_game_probabilities) | Win probability timeline for a game. |
| [`get_slate`](scoreboard.md#get_slate) | One-call slate: games, team IDs, status/score, consensus no-vig probabilities, key Out/Doubtful injuries. Older days come from the games export. |
| [`get_game_preview`](scoreboard.md#get_game_preview) | One game: injuries, probables or lineups, weather, and Kalshi and Polymarket US winner prices. |

## Prediction markets

Keyless Kalshi and Polymarket prices. Venues are labelled and are not averaged. See [Prediction markets](markets.md).

| Tool | Description |
|------|-------------|
| [`get_kalshi_markets`](markets.md#get_kalshi_markets) | Open Kalshi markets. Dollar prices, optional top of book. |
| [`get_polymarket_markets`](markets.md#get_polymarket_markets) | Polymarket global and Polymarket US, each labelled. |
| [`get_market_odds`](markets.md#get_market_odds) | Match one ESPN game to Kalshi, Polymarket, and Polymarket US. |

## Teams

| Tool | Description |
|------|-------------|
| [`get_teams`](teams.md#get_teams) | Compact team identity records and IDs. |
| [`get_team`](teams.md#get_team) | Team info, roster, schedule, record, depth chart, injuries, transactions, history, news, or leaders. |
| [`get_team_injuries`](teams.md#get_team_injuries) | Injury report for a single team. |
| [`get_team_stats`](teams.md#get_team_stats) | Team season stat line (totals only). |

## Athletes

| Tool | Description |
|------|-------------|
| [`get_athlete_overview`](athletes.md#get_athlete_overview) | Player snapshot — season stats, next game, news. |
| [`get_athlete_stats`](athletes.md#get_athlete_stats) | Season statistics converted into named fields. |
| [`get_athlete_gamelog`](athletes.md#get_athlete_gamelog) | Game-by-game log. Repeated labels are nested by category (`rushing.YDS` and `receiving.YDS`). |
| [`get_athlete_splits`](athletes.md#get_athlete_splits) | Statistical splits — home/away, by opponent, by situation. |
| [`get_player_report`](athletes.md#get_player_report) | One call: name resolution, season stats, last N games, and splits. |

## League-Wide

| Tool | Description |
|------|-------------|
| [`get_standings`](league.md#get_standings) | League standings. |
| [`get_league_leaders`](league.md#get_league_leaders) | League-wide statistical leaders. |
| [`get_injuries`](league.md#get_injuries) | League-wide injury report. |
| [`get_transactions`](league.md#get_transactions) | Recent signings, trades, waivers. |
| [`get_news`](league.md#get_news) | Real-time sports news feed. |
| [`get_rankings`](league.md#get_rankings) | College poll rankings. |
| [`get_power_index`](league.md#get_power_index) | BPI or FPI team ratings. |
| [`get_futures`](league.md#get_futures) | Season futures odds. |

## Historical export

Parquet files for MLB, NBA, NFL, NHL, college football (FBS), and men's college basketball (Division I), every league from the 2021 season through today, from GitHub Releases ([sportsleader-data](https://github.com/WalrusQuant/sportsleader-data)), no API key. The current season is rebuilt nightly, around 4:15 AM CT. The manifest is `releases/download/manifest/manifest.json`; each file is fetched from its manifest `url`. Override with `SPORTSLEADER_DATA_MANIFEST_URL` (`BAYES_DATA_MANIFEST_URL` still works). `SPORTSLEADER_DATA_BASE_URL` is an optional directory mirror (`BAYES_DATA_BASE_URL` is the same). A data set the manifest does not publish returns a clear error; `get_data_status` lists what is there. See [Historical data](data.md). `get_scoreboard` and `get_slate` read `games` for older days. The live `get_injuries` and `get_transactions` tools are unchanged.

| Tool | Description |
|------|-------------|
| [`get_games`](data.md#get_games) | Schedule and results. |
| [`get_team_box_scores`](data.md#get_team_box_scores) | Team box line. |
| [`get_team_game_stats`](data.md#get_team_game_stats) | Team counting stats for and against. |
| [`get_player_game_logs`](data.md#get_player_game_logs) | Player box lines. `statGroup` picks the league's file. |
| [`get_player_trends`](data.md#get_player_trends) | Averages and totals by home/away, opponent, month, or rest. Rates are recomputed; longest is a max. |
| [`get_rosters`](data.md#get_rosters) | Roster spans. |
| [`get_injury_reports`](data.md#get_injury_reports) | Injury history from the export. |
| [`get_transaction_log`](data.md#get_transaction_log) | Transaction history from the export. |
| [`get_depth_charts`](data.md#get_depth_charts) | NFL depth chart. |
| [`get_probables`](data.md#get_probables) | Probable pitchers and goalies. |
| [`get_lineups`](data.md#get_lineups) | Lineups. NHL rows come from the official NHL API. |
| [`get_weather`](data.md#get_weather) | Game weather. |
| [`get_data_status`](data.md#get_data_status) | Manifest summary and freshness. |

## Research lab

Same connector. The first call starts the Python lab when `uv` and Python 3.11, 3.12, or 3.13 are installed. These tools do not take `raw`. A result is a research fit against simple baselines, not a betting edge. For `home_win`, `estimate` is P(home team wins) and `estimate_kind` is `home_win_probability`.

| Tool | Description |
|------|-------------|
| `ping` | Lab health check and the research disclaimer. |
| `inspect_data` | Rows, dates, grain, null rates, and pregame or postgame for one published dataset. |
| `query_data` | One SELECT on a published view such as `nfl_games`. |
| `build_dataset` | Pregame dataset. Saved only when the leakage audit passes. |
| `audit_features` | The same leakage checks. Does not save. A pass is REVIEW REQUIRED. |
| `train_classifier` | Walk-forward logistic or LightGBM. No random split. |
| `train_regressor` | Walk-forward ridge, Poisson, negative binomial, or LightGBM. |
| `predict` | Score games as of America/Chicago. `home_win` estimates are P(home team wins). |
| `list_runs` | Saved runs for one league, newest first. |
| `compare_runs` | At least two runs on the primary metric. |
| `model_card` | Twelve-section card. A research record, not an approval. |
