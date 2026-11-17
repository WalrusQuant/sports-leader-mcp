# Historical export

Nightly Parquet files for MLB, NBA, NFL, and NHL: games, team box scores, team counting stats, player game logs, rosters, injuries, transactions, depth charts, probables, lineups, and weather. Rows already carry ESPN ids and names. The manifest is the list of data sets; one that is not published returns an error naming it.

Seasons start at 2021. NBA and NHL use the year the season ends (2026-27 is `2027`). Only the current season of each league is rebuilt nightly, around 7:15 AM CT.

`get_injury_reports` and `get_transaction_log` are this export. `get_injuries` and `get_transactions` remain the live ESPN tools.

## Setup

No API key. The default manifest is

`https://github.com/WalrusQuant/sportsleader-data/releases/download/manifest/manifest.json`

(`DEFAULT_BAYES_DATA_MANIFEST_URL`). Every file entry includes a `url`. The release tag is `<league>_<dataset>` and the asset is `<season>.parquet`, for example `nba_games/2027.parquet`. GitHub answers `302` to a short-lived CDN URL (`cache-control: no-cache`, no ETag on that hop). The CDN can `304`, but the signed URL is different each time, so the cache trusts the manifest `sha256` and reports `updated_at`. Unchanged files are not downloaded again, which keeps unauthenticated GitHub requests low (the manifest is rechecked at most every 4 hours).

`SPORTSLEADER_DATA_MANIFEST_URL` replaces the manifest URL. `BAYES_DATA_MANIFEST_URL` is the same setting; the `SPORTSLEADER_` name wins when both are set. `SPORTSLEADER_DATA_BASE_URL` (alias `BAYES_DATA_BASE_URL`) selects a directory mirror instead: `{base}/manifest.json`, and `{base}/<path>` only when a file has no `url`. The ESPN tools do not use these variables. The default manifest URL is unchanged.

| Variable | Default |
|----------|---------|
| `BAYES_DATA_CACHE_DIR` | `~/.cache/sports-leader-mcp/bayes-data` |
| `BAYES_DATA_REVALIDATE_MS` | 4 hours |

A cached parquet file is reused while its sha256 matches the manifest. `updated_at` is included on every result. `get_data_status` flags a current-season file older than 36 hours while that league is in season. In season means the current games file has a game in the last 7 days. The export is published to GitHub Releases nightly after about 7:15 AM CT.

Queries use DuckDB (`@duckdb/node-api`). Filter values are parameters. Column names have to appear in the manifest.

`limit` defaults to 100 and cannot exceed 250.

## get_data_status

No required arguments. Optional `includeColumns: true` adds each file's column names and types.

The summary lists datasets, files, row counts, `updated_at`, whether the file is the current season, and `stale: true` when that current-season file is older than 36 hours and the league has a game in the last 7 days.

## get_player_game_logs

| League | `statGroup` | File |
|--------|-------------|------|
| nba | `player`, or omit it | `player_game_logs` |
| nhl | `skater` or `goalie` | `skater_game_logs`, `goalie_game_logs` |
| mlb | `batting` or `pitching` | `batting_game_logs`, `pitching_game_logs` |
| nfl | `passing`, `rushing`, or `receiving` | `passing_game_logs`, `rushing_game_logs`, `receiving_game_logs` |

## get_player_trends

Same files as `get_player_game_logs`. Groups one player's rows and returns `games`, `avg`, and `total` for each group.

| `by` | Group key |
|------|-----------|
| `home_away` | `home` or `away` |
| `opponent` | Opponent abbreviation |
| `month` | `YYYY-MM` |
| `rest` | Days since the previous game in the query. The first game is `first`. |

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

## Tools

Shared arguments: `league` (`mlb`, `nba`, `nfl`, `nhl`), `season`, `seasons`, `from`, `to` (`YYYY-MM-DD`), `team`, `opponent`, `player`, `columns`, `sort`, `order` (`asc` or `desc`), `limit`.

`team` and `opponent` take an ESPN id or an abbreviation. On games and weather, `team` matches either side; with `opponent` set, the two have to be the two teams in the game. `player` is an ESPN athlete id, or a case-insensitive substring of `player_name`.

Date filters use `game_date` or `date` when the file has one. Rosters and depth charts use the `valid_from` / `valid_to` span (`valid_to` empty means still current).

| Tool | Data set | Leagues |
|------|----------|---------|
| `get_games` | `games` | mlb, nba, nfl, nhl |
| `get_team_box_scores` | `team_box_scores` | mlb, nba, nfl, nhl |
| `get_team_game_stats` | `team_game_stats` | mlb, nba, nfl, nhl |
| `get_player_game_logs` | see above | nba, nhl, mlb, nfl |
| `get_player_trends` | same player logs, aggregated | nba, nhl, mlb, nfl |
| `get_rosters` | `rosters` | mlb, nba, nfl, nhl |
| `get_injury_reports` | `injuries` | mlb, nba, nfl, nhl |
| `get_transaction_log` | `transactions` | mlb, nba, nfl, nhl |
| `get_depth_charts` | `depth_charts` | nfl |
| `get_probables` | `probables` | mlb, nhl |
| `get_lineups` | `lineups` | mlb, nba, nhl |
| `get_weather` | `weather` | mlb, nfl |

`get_team_game_stats` is wide (each counting stat has an `opponent_` copy). Pass `columns` or a low `limit` so the response stays inside the token budget.
