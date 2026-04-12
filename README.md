# sports-leader-mcp

A free [Model Context Protocol](https://modelcontextprotocol.io) server for live sports data: scores, standings, rosters, player stats, odds, play-by-play, injuries, transactions, and news across **17 sports and 139 leagues**.

Built on ESPN's undocumented public JSON APIs. No auth, no keys, no rate limits — just point your agent at it.

## Install (Smithery)

```bash
npx -y @smithery/cli install sports-leader-mcp --client claude
```

Or add to your MCP client config manually (after `npm run build`):

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

## Local dev

```bash
npm install
npm run build
npm start
```

## Tools

**Discovery**
- `list_sports_and_leagues` — get all valid sport/league slugs
- `search` — global search for athletes, teams, articles

**Games & scoreboard**
- `get_scoreboard` — live and scheduled games (entry point for finding eventIds)
- `get_game_summary` — boxscore, plays, leaders in one call
- `get_game_plays` — full play-by-play
- `get_game_odds` — spread, moneyline, over/under
- `get_game_probabilities` — win probability timeline

**Teams**
- `get_teams` — list all teams in a league
- `get_team` — team info / roster / schedule / record / depth chart / injuries / transactions / history / news / leaders (via `view` param)
- `get_team_injuries`

**Players**
- `get_athlete_overview` — snapshot + next game + news
- `get_athlete_stats` — season stats with categories and glossary
- `get_athlete_gamelog` — game-by-game log
- `get_athlete_splits` — home/away/opponent splits

**League-wide**
- `get_standings`
- `get_league_leaders`
- `get_injuries` — league-wide injury report
- `get_transactions`
- `get_news` — real-time news feed

**Escape hatch**
- `espn_fetch` — fetch any ESPN URL (locked to ESPN hosts). Useful for endpoints not covered by a dedicated tool, or resolving article URLs from `get_news`.

## Notes

- ESPN's APIs are undocumented and may change without notice
- Be respectful with request volume — the server retries 429s with exponential backoff but has no persistent cache
- Fantasy sports endpoints (ffl / fba / flb / fhl) are planned for v0.2

## License

MIT
