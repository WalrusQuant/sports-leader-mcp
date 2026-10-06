# Tools

Overview of all 21 tools available in sports-leader-mcp.

Compact JSON is the default. Every tool accepts optional `raw: true`; oversized output is replaced with a valid `{ "truncated": true, ... }` envelope instead of partial JSON.

Results carry the compact JSON as a text block and as MCP `structuredContent` (top-level arrays as `{ "items": [...] }`). `get_scoreboard`, `get_game_summary`, `get_game_odds`, `get_injuries`, `get_athlete_gamelog`, and `get_slate` also publish an `outputSchema`; schemas allow extra properties because fields are only ever added. With `raw: true` the text block is the untouched ESPN JSON and `structuredContent` is `{ "raw": true, "response": ... }`.

Large sub-payloads are also available as `espn://` resource templates (see the [README](../../README.md#resource-templates)); `get_game_summary` and `get_slate` return `resource_link` items that point at them.

## Discovery & Search

| Tool | Description |
|------|-------------|
| [`list_sports_and_leagues`](discovery.md#list_sports_and_leagues) | Curated verified sport/league slug catalog |
| [`search`](discovery.md#search) | Global search for athletes, teams, and articles |
| [`espn_fetch`](discovery.md#espn_fetch) | Fetch any ESPN URL directly (escape hatch) |

## Scoreboard & Games

| Tool | Description |
|------|-------------|
| [`get_scoreboard`](scoreboard.md#get_scoreboard) | Get live and scheduled games. Entry point for finding eventIds. |
| [`get_game_summary`](scoreboard.md#get_game_summary) | Score, team/player boxscore, leaders, key plays, sampled win probability. |
| [`get_game_plays`](scoreboard.md#get_game_plays) | Full play-by-play data for a game. |
| [`get_game_odds`](scoreboard.md#get_game_odds) | Betting odds per provider with numeric moneylines, implied and no-vig probabilities, signed `homeSpread`, and consensus. |
| [`get_game_probabilities`](scoreboard.md#get_game_probabilities) | Win probability timeline for a game. |
| [`get_slate`](scoreboard.md#get_slate) | One-call daily slate: games, team IDs, status/score, consensus no-vig probabilities, key Out/Doubtful injuries. |

## Teams

| Tool | Description |
|------|-------------|
| [`get_teams`](teams.md#get_teams) | Compact team identity records and IDs. |
| [`get_team`](teams.md#get_team) | Team info, roster, schedule, record, depth chart, injuries, transactions, history, news, or leaders. |
| [`get_team_injuries`](teams.md#get_team_injuries) | Injury report for a single team. |

## Athletes

| Tool | Description |
|------|-------------|
| [`get_athlete_overview`](athletes.md#get_athlete_overview) | Player snapshot — season stats, next game, news. |
| [`get_athlete_stats`](athletes.md#get_athlete_stats) | Season statistics converted into named fields. |
| [`get_athlete_gamelog`](athletes.md#get_athlete_gamelog) | Game-by-game log with stats per game. |
| [`get_athlete_splits`](athletes.md#get_athlete_splits) | Statistical splits — home/away, by opponent, by situation. |

## League-Wide

| Tool | Description |
|------|-------------|
| [`get_standings`](league.md#get_standings) | League standings. |
| [`get_league_leaders`](league.md#get_league_leaders) | League-wide statistical leaders. |
| [`get_injuries`](league.md#get_injuries) | League-wide injury report. |
| [`get_transactions`](league.md#get_transactions) | Recent signings, trades, waivers. |
| [`get_news`](league.md#get_news) | Real-time sports news feed. |
