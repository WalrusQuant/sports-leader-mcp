# sports-leader-mcp

A free [Model Context Protocol](https://modelcontextprotocol.io) server for live sports data across **17 sports and 139 leagues**.

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

## Quick Install

```bash
npx -y @smithery/cli install @wickwireadam-o0nh/sports-leader-mcp --client claude
```

Or add to your MCP client config manually:

```json
{
  "mcpServers": {
    "sports-leader": {
      "command": "npx",
      "args": ["-y", "@wickwireadam-o0nh/sports-leader-mcp"]
    }
  }
}
```

## 20 Tools at a Glance

| Category | Tools |
|----------|-------|
| [Discovery](tools/discovery.md) | `list_sports_and_leagues`, `search`, `espn_fetch` |
| [Scoreboard & Games](tools/scoreboard.md) | `get_scoreboard`, `get_game_summary`, `get_game_plays`, `get_game_odds`, `get_game_probabilities` |
| [Teams](tools/teams.md) | `get_teams`, `get_team`, `get_team_injuries` |
| [Athletes](tools/athletes.md) | `get_athlete_overview`, `get_athlete_stats`, `get_athlete_gamelog`, `get_athlete_splits` |
| [League-Wide](tools/league.md) | `get_standings`, `get_league_leaders`, `get_injuries`, `get_transactions`, `get_news` |

## Self-Hosting

Running as a hosted HTTP service? See the [Self-Hosting Guide](self-hosting.md) for caching, rate limiting, monitoring, and the kill switch.

## Reference

- [API Endpoints](reference/endpoints.md) — full catalog of ESPN API endpoints across 8 domains
- [Response Schemas](reference/response-schemas.md) — annotated JSON examples for every major endpoint
- [League & Sport Slugs](reference/league-slugs.md) — all 139 leagues mapped to their sport categories
- [Gotchas & Pitfalls](reference/gotchas.md) — 16 common mistakes and how to avoid them
