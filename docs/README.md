# sports-leader-mcp

A free [Model Context Protocol](https://modelcontextprotocol.io) server for live sports data across **30 verified leagues in 11 sports**: 43 tools, 4 resources, 7 resource templates, and 5 prompts.

Built on ESPN's public JSON APIs. No authentication required — just connect your MCP client and start querying.

## What You Can Do

- Get **live scores and schedules** for any league
- Pull **standings, team rosters, and depth charts**
- Look up **player stats, game logs, and splits**
- Fetch **betting odds** from DraftKings, FanDuel, Caesars, and more
- Get **full play-by-play** and win probability timelines
- Read **league-wide injury reports** and transactions
- Search for **any athlete, team, or article**
- Access **real-time sports news** filtered by sport, league, or team
- Query **historical games** for MLB, NBA, NFL, NHL, college football (FBS), and men's college basketball (Division I), every league from the 2021 season through today

## Quick Install

Requires Node.js 20 or newer. Clone the repository and build it, then point the MCP client at `dist/index.js`:

```bash
git clone https://github.com/WalrusQuant/sports-leader-mcp && cd sports-leader-mcp && npm ci && npm run build
```

```bash
node /path/to/sports-leader-mcp/dist/index.js
```

Replace `/path/to/sports-leader-mcp` with the directory created by the clone.

### Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sports-leader": {
      "command": "node",
      "args": ["/path/to/sports-leader-mcp/dist/index.js"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json` (project) or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "sports-leader": {
      "command": "node",
      "args": ["/path/to/sports-leader-mcp/dist/index.js"]
    }
  }
}
```

## 43 Tools at a Glance

| Category | Tools |
|----------|-------|
| [Discovery](tools/discovery.md) | `list_sports_and_leagues`, `search`, `espn_fetch` |
| [Scoreboard & Games](tools/scoreboard.md) | `get_scoreboard`, `get_game_summary`, `get_game_plays`, `get_game_odds`, `get_game_probabilities`, `get_slate`, `get_game_preview` |
| [Prediction markets](tools/markets.md) | `get_kalshi_markets`, `get_polymarket_markets`, `get_market_odds` |
| [Teams](tools/teams.md) | `get_teams`, `get_team`, `get_team_injuries`, `get_team_stats` |
| [Athletes](tools/athletes.md) | `get_athlete_overview`, `get_athlete_stats`, `get_athlete_gamelog`, `get_athlete_splits`, `get_player_report` |
| [League-Wide](tools/league.md) | `get_standings`, `get_league_leaders`, `get_injuries`, `get_transactions`, `get_news`, `get_rankings`, `get_power_index`, `get_futures` |
| [Historical export](tools/data.md) | `get_games`, `get_team_box_scores`, `get_team_game_stats`, `get_player_game_logs`, `get_player_trends`, `get_rosters`, `get_injury_reports`, `get_transaction_log`, `get_depth_charts`, `get_probables`, `get_lineups`, `get_weather`, `get_data_status` |

Sixteen tools (`get_scoreboard`, `get_game_summary`, `get_game_odds`, `get_injuries`, `get_athlete_gamelog`, `get_player_report`, `get_player_trends`, `get_slate`, `get_game_preview`, `get_team_stats`, `get_rankings`, `get_power_index`, `get_futures`, `get_kalshi_markets`, `get_polymarket_markets`, `get_market_odds`) publish an MCP `outputSchema`. Odds are normalized for comparison with prediction markets: numeric American moneylines, implied and no-vig probabilities, and `homeSpread` (negative = home team favored). See [Scoreboard & Games](tools/scoreboard.md#get_game_odds).

## Resources

- 4 static resources: `sports://leagues`, `sports://reference/season-types`, `sports://reference/betting-providers`, `sports://reference/api-domains`.
- 7 `espn://` resource templates that return the same compact JSON as the matching tool: game `summary`, `plays`, `probabilities`, `odds` (`espn://{sport}/{league}/game/{eventId}/...`), league injuries (`espn://{sport}/{league}/injuries`), team injuries (`espn://{sport}/{league}/team/{teamId}/injuries`), and the daily slate (`espn://{sport}/{league}/slate/{date}`).
- `get_game_summary` and `get_slate` add `resource_link` items pointing at those templates.

## Protocol compatibility

Built on MCP TypeScript SDK v2. The same server answers MCP **2026-07-28** (stateless, per-request) and every 2025-era client (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05) over both stdio and HTTP. Requires Node.js 20+.

## Self-Hosting

Running as a hosted HTTP service? See the [Self-Hosting Guide](self-hosting.md) for stateless HTTP serving, caching, rate limiting, monitoring, and the kill switch. Release notes are in the [CHANGELOG](https://github.com/WalrusQuant/sports-leader-mcp/blob/main/CHANGELOG.md).

## Reference

- [API Endpoints](reference/endpoints.md) — raw ESPN endpoint catalog
- [Response Schemas](reference/response-schemas.md) — raw upstream examples, not compact MCP contracts
- [League & Sport Slugs](reference/league-slugs.md) — broader slug reference; availability varies by endpoint
- [Gotchas & Pitfalls](reference/gotchas.md) — ESPN API quirks and common mistakes
