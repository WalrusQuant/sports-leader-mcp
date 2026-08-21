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

The scoped identifier above is a Smithery registry identifier, not this repository's npm package name. For a source checkout, build the repository and point the client at `dist/index.js`:

```json
{
  "mcpServers": {
    "sports-leader": {
      "command": "node",
      "args": ["/absolute/path/to/sports-leader-mcp/dist/index.js"]
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

- [API Endpoints](../references/endpoints.md) — raw ESPN endpoint catalog
- [Response Schemas](../references/response-schemas.md) — raw upstream examples, not compact MCP contracts
- [League & Sport Slugs](../references/league-slugs.md) — broader slug reference; availability varies by endpoint
- [Gotchas & Pitfalls](../references/gotchas.md) — ESPN API quirks and common mistakes
