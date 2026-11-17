# Historical export

Nightly Parquet files for six leagues: MLB (`mlb`), NBA (`nba`), NFL (`nfl`), NHL (`nhl`), college football (`cfb`, FBS), and men's college basketball (`cbb`, Division I). Every one of those leagues is published from the 2021 season through today. Women's college basketball is not in this export. The files are games, team box scores, team counting stats, player game logs, rosters, injuries, transactions, depth charts, probables, lineups, and weather. Rows already carry ESPN ids and names. The manifest is the list of data sets; a league or season the manifest does not have returns an error naming it.

Season names: NBA, NHL, and `cbb` use the year the season ends (2026-27 is `2027`). NFL, MLB, and `cfb` use the year the season starts (the 2026 NFL season is `2026`). Every league starts at 2021. Only the current season of each league is rebuilt nightly, around 4:15 AM CT. `get_scoreboard` and `get_slate` read `games` for days older than that freshness and older than today and the previous 2 US-Eastern days.

`get_injury_reports` and `get_transaction_log` are this export. `get_injuries` and `get_transactions` remain the live ESPN tools.

## Setup

No API key. The default manifest is

`https://github.com/WalrusQuant/sportsleader-data/releases/download/manifest/manifest.json`

(`DEFAULT_BAYES_DATA_MANIFEST_URL`). Every file entry includes a `url`. The release tag is `<league>_<dataset>` and the asset is `<season>.parquet`, for example `nba_games/2027.parquet`. GitHub answers `302` to a short-lived CDN URL (`cache-control: no-cache`, no ETag on that hop). The CDN can `304`, but the signed URL is different each time, so the cache trusts the manifest `sha256` and reports `updated_at`. Unchanged files are not downloaded again, which keeps unauthenticated GitHub requests low (the manifest is rechecked at most every 4 hours).

`SPORTSLEADER_DATA_MANIFEST_URL` replaces the manifest URL. `BAYES_DATA_MANIFEST_URL` is the same setting; the `SPORTSLEADER_` name wins when both are set. `SPORTSLEADER_DATA_BASE_URL` (alias `BAYES_DATA_BASE_URL`) selects a directory mirror instead: `{base}/manifest.json`, and `{base}/<path>` only when a file has no `url`. `get_scoreboard` and `get_slate` use this manifest for older days. The other ESPN tools do not, except a preview or market lookup that resolves one of those dates. The default manifest URL is unchanged.

| Variable | Default |
|----------|---------|
| `BAYES_DATA_CACHE_DIR` | `~/.cache/sports-leader-mcp/bayes-data` |
| `BAYES_DATA_REVALIDATE_MS` | 4 hours |

A cached parquet file is reused while its sha256 matches the manifest. `updated_at` is included on every result. `get_data_status` flags a current-season file older than 36 hours while that league is in season. In season means the current games file has a game in the last 7 days. The export is published to GitHub Releases nightly, around 4:15 AM CT.

Queries use DuckDB (`@duckdb/node-api`). Filter values are parameters. Column names have to appear in the manifest.

`limit` defaults to 100 and cannot exceed 250.

## get_data_status

Parameters: optional `includeColumns` (default false) and `raw`. `includeColumns: true` adds each file's column names and types.

The summary lists datasets, files, row counts, `updated_at`, whether the file is the current season, and `stale: true` when that current-season file is older than 36 hours and the league has a game in the last 7 days.

## get_player_game_logs

| League | `statGroup` | File |
|--------|-------------|------|
| nba | `player`, or omit it | `player_game_logs` |
| cbb | `player`, or omit it | `player_game_logs` |
| nhl | `skater` or `goalie` | `skater_game_logs`, `goalie_game_logs` |
| mlb | `batting` or `pitching` | `batting_game_logs`, `pitching_game_logs` |
| nfl | `passing`, `rushing`, or `receiving` | `passing_game_logs`, `rushing_game_logs`, `receiving_game_logs` |
| cfb | `passing`, `rushing`, or `receiving` | `passing_game_logs`, `rushing_game_logs`, `receiving_game_logs` |

Parameters: `league`, `statGroup` (required when the league has more than one file; omit it for `nba` and `cbb`), optional `season`, `seasons`, `from`, `to`, `team`, `opponent`, `player`, `columns`, `sort`, `order`, `limit`, and `raw`. See [Shared filters](#shared-filters).

## get_player_trends

Same files as `get_player_game_logs`. Groups one player's rows and returns `games`, `avg`, and `total` for each group.

| `by` | Group key |
|------|-----------|
| `home_away` | `home` or `away` |
| `opponent` | Opponent abbreviation |
| `month` | `YYYY-MM` |
| `rest` | Days since the previous game in the query. The first game is `first`. |

Parameters: `league`, `player` (required), `by` (required), `statGroup` (same rules as [`get_player_game_logs`](#get_player_game_logs)), optional `season`, `seasons`, `lastN`, and `raw`. This tool does not take `from`, `to`, `team`, `opponent`, `columns`, `sort`, `order`, or `limit`.

`lastN` keeps the most recent games after rest is measured, so the oldest game in the window still has its real gap. A name that matches two players returns `candidates` instead of a blended line. `avg` and `total` use the manifest's numeric stat columns only. Counting stats are averaged and summed. Rate columns (save percentage, passer rating, QBR, and any pct, rating, avg, or per-game stat) are not summed: `avg` holds the group rate and `total` omits them. Save percentage is saves / shots against (81 / 87 = 0.931, not the mean of the per-game rates). Passer rating is recomputed from completions, attempts, yards, touchdowns, and interceptions. QBR is the mean weighted by attempts, or omitted when attempts are missing. `longest` and `long` use the maximum in `total` (the mean of each game's long stays in `avg`). A player who is only in another stat group returns `resolved: false`, `reason: "wrong_group"`, and the `statGroup` to pass. A player in no log returns `resolved: false` and `reason: "not_found"`. NFL still has no defensive or kicking log: the choices are passing, rushing, and receiving. Did-not-play rows are left out when the file has that column.

```json
{
  "resolved": true,
  "player": { "id": 1966, "name": "LeBron James", "query": "1966" },
  "by": "home_away",
  "seasons": [2027],
  "updated_at": "2026-11-16T10:16:45+00:00",
  "groups": [
    { "key": "home", "games": 6, "avg": { "points": 16, "rebounds": 7.167, "assists": 7.167 }, "total": { "points": 96, "rebounds": 43, "assists": 43 } },
    { "key": "away", "games": 5, "avg": { "points": 14, "rebounds": 7.2, "assists": 6.6 }, "total": { "points": 70, "rebounds": 36, "assists": 33 } }
  ]
}
```

`avg` and `total` also include the other numeric columns on that file (minutes, field goals, turnovers, and so on). The snippet above keeps three of them.

## Shared filters

Every data tool accepts optional `raw`. The query tools share these arguments unless a tool section says otherwise.

| Argument | Meaning |
|----------|---------|
| `league` | Required. `mlb`, `nba`, `nfl`, `nhl`, `cfb` (college football, FBS), or `cbb` (men's college basketball, Division I). |
| `season` | Season year. Omit for the current season in the export. See the naming rules above. |
| `seasons` | Extra seasons to read with `season`, at most 20. |
| `from`, `to` | Inclusive `YYYY-MM-DD`. They filter `game_date` or `date`. Rosters and depth charts use the `valid_from` / `valid_to` span instead (`valid_to` empty means still current). |
| `team` | ESPN team id or abbreviation. On games and weather it matches either side. |
| `opponent` | ESPN opponent id or abbreviation. With `team` on games and weather, the two values have to be the two teams in the game. |
| `player` | ESPN athlete id, or a case-insensitive substring of `player_name`. |
| `columns` | Column names, checked against the manifest. Omit for every column. |
| `sort` | Column to sort by. Defaults to the date column when the file has one. |
| `order` | `asc` or `desc`. Default `desc`. |
| `limit` | Maximum rows. Default 100, hard cap 250. |

| Tool | Data set | Leagues |
|------|----------|---------|
| `get_games` | `games` | mlb, nba, nfl, nhl, cfb, cbb |
| `get_team_box_scores` | `team_box_scores` | mlb, nba, nfl, nhl, cfb, cbb |
| `get_team_game_stats` | `team_game_stats` | mlb, nba, nfl, nhl, cfb, cbb |
| `get_player_game_logs` | see above | nba, cbb, nhl, mlb, nfl, cfb |
| `get_player_trends` | same player logs, aggregated | nba, cbb, nhl, mlb, nfl, cfb |
| `get_rosters` | `rosters` | mlb, nba, nfl, nhl, cfb, cbb |
| `get_injury_reports` | `injuries` | mlb, nba, nfl, nhl, cfb, cbb |
| `get_transaction_log` | `transactions` | mlb, nba, nfl, nhl, cfb, cbb |
| `get_depth_charts` | `depth_charts` | nfl |
| `get_probables` | `probables` | mlb, nhl |
| `get_lineups` | `lineups` | mlb, nba, nhl |
| `get_weather` | `weather` | mlb, nfl |

A file the manifest does not publish for that league and season is an error from the tool. `get_data_status` lists what is there.

## get_games

Schedule and results, one row per game. Upcoming games have no score. `game_id` is the ESPN event id. `get_scoreboard` and `get_slate` read this file for older days.

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `opponent`, `columns`, `sort`, `order`, `limit`, and `raw`. No `player`.

## get_team_box_scores

ESPN team box line, one row per team per game. League-specific columns (hits, field-goal percentage, total yards, shots, and so on) come from that league's file.

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `opponent`, `columns`, `sort`, `order`, `limit`, and `raw`. No `player`.

## get_team_game_stats

Full team counting stats for and against, one row per team per game, including an `opponent_` copy of each stat. The rows are wide. Pass `columns` or a low `limit` so the response stays inside the token budget.

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `opponent`, `columns`, `sort`, `order`, `limit`, and `raw`. No `player`.

## get_rosters

Roster rows with `valid_from` and `valid_to`. An empty `valid_to` means still current. A date range keeps rows whose span overlaps it.

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `player`, `columns`, `sort`, `order`, `limit`, and `raw`. No `opponent`.

## get_injury_reports

Historical injury rows (ESPN, the NBA report, and the NFL practice report), with `valid_from` and `valid_to`. This is not the live [`get_injuries`](league.md#get_injuries) tool.

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `player`, `columns`, `sort`, `order`, `limit`, and `raw`. No `opponent`.

## get_transaction_log

Historical transactions (ESPN, plus MLB official). This is not the live [`get_transactions`](league.md#get_transactions) tool.

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `player`, `columns`, `sort`, `order`, `limit`, and `raw`. No `opponent`.

## get_depth_charts

NFL depth-chart slots with the span each was current. A date range overlaps `valid_from` and `valid_to`.

Parameters: `league` (`nfl`), optional `season`, `seasons`, `from`, `to`, `team`, `player`, `columns`, `sort`, `order`, `limit`, and `raw`. No `opponent`.

## get_probables

Probable starting pitchers (MLB) and goalies (NHL).

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `player`, `columns`, `sort`, `order`, `limit`, and `raw`. No `opponent`.

## get_lineups

Announced lineups: MLB batting orders, NBA starting fives, and NHL lines and pairs.

NHL lineups come from the official NHL API. Starting goalies are the ESPN probables before the game and the NHL box score after it. Lines and pairs come from the official shift charts. This export does not use Daily Faceoff. `get_game_preview` reads the same rows.

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `player`, `columns`, `sort`, `order`, `limit`, and `raw`. No `opponent`.

## get_weather

Game weather for MLB and NFL: ESPN conditions and the National Weather Service hourly outlook. `wind_mph` and `wind_gust_mph` are separate columns. `team` matches either side.

Parameters: `league`, optional `season`, `seasons`, `from`, `to`, `team`, `opponent`, `columns`, `sort`, `order`, `limit`, and `raw`. No `player`.
