# Tools

Overview of all 20 tools available in sports-leader-mcp.

## Discovery & Search

| Tool | Description |
|------|-------------|
| [`list_sports_and_leagues`](tools/discovery.md#list_sports_and_leagues) | Discover all valid sport and league slugs |
| [`search`](tools/discovery.md#search) | Global search for athletes, teams, and articles |
| [`espn_fetch`](tools/discovery.md#espn_fetch) | Fetch any ESPN URL directly (escape hatch) |

## Scoreboard & Games

| Tool | Description |
|------|-------------|
| [`get_scoreboard`](tools/scoreboard.md#get_scoreboard) | Get live and scheduled games. Entry point for finding eventIds. |
| [`get_game_summary`](tools/scoreboard.md#get_game_summary) | Full game summary — boxscore, plays, leaders, broadcasts, win probability. |
| [`get_game_plays`](tools/scoreboard.md#get_game_plays) | Full play-by-play data for a game. |
| [`get_game_odds`](tools/scoreboard.md#get_game_odds) | Betting odds — spread, moneyline, over/under. |
| [`get_game_probabilities`](tools/scoreboard.md#get_game_probabilities) | Win probability timeline for a game. |

## Teams

| Tool | Description |
|------|-------------|
| [`get_teams`](tools/teams.md#get_teams) | List all teams in a league with IDs, names, and logos. |
| [`get_team`](tools/teams.md#get_team) | Team info, roster, schedule, record, depth chart, injuries, transactions, history, news, or leaders. |
| [`get_team_injuries`](tools/teams.md#get_team_injuries) | Injury report for a single team. |

## Athletes

| Tool | Description |
|------|-------------|
| [`get_athlete_overview`](tools/athletes.md#get_athlete_overview) | Player snapshot — season stats, next game, news. |
| [`get_athlete_stats`](tools/athletes.md#get_athlete_stats) | Full season stats with categories and glossary. |
| [`get_athlete_gamelog`](tools/athletes.md#get_athlete_gamelog) | Game-by-game log with stats per game. |
| [`get_athlete_splits`](tools/athletes.md#get_athlete_splits) | Statistical splits — home/away, by opponent, by situation. |

## League-Wide

| Tool | Description |
|------|-------------|
| [`get_standings`](tools/league.md#get_standings) | League standings. |
| [`get_league_leaders`](tools/league.md#get_league_leaders) | League-wide statistical leaders. |
| [`get_injuries`](tools/league.md#get_injuries) | League-wide injury report. |
| [`get_transactions`](tools/league.md#get_transactions) | Recent signings, trades, waivers. |
| [`get_news`](tools/league.md#get_news) | Real-time sports news feed. |
