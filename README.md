# sports-leader-mcp


Free MCP server for live sports data. **20 tools, 4 resources, 5 prompts** covering scores, standings, rosters, player stats, betting odds, play-by-play, injuries, transactions, and news across **17 sports and 139 leagues**.

No ESPN auth or API keys. Stdio mode has no server-side request quota; HTTP mode applies configurable per-IP limits.

---

## Install

Clone and build:
```bash
git clone https://github.com/WalrusQuant/sports-leader-mcp.git
cd sports-leader-mcp
npm install
npm run build
```

Then add to your MCP client config (e.g. Claude Desktop, Cursor, etc.):
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

Replace `/absolute/path/to/` with the actual path where you cloned the repo.

## What You Can Do

| | |
|---|---|
| **Live Scores** | Real-time scoreboards for every game in every league |
| **Player Stats** | Season stats, game logs, home/away splits, career data |
| **Standings & Leaders** | Current standings and statistical leaders for any league |
| **Betting Odds** | Spreads, moneylines, totals from DraftKings, FanDuel, Caesars, BetMGM, ESPN BET |
| **Game Deep-Dives** | Boxscores, full play-by-play, win probability timelines |
| **Injuries & Transactions** | League-wide injury reports, signings, trades, waivers |
| **News** | Real-time sports news filtered by sport, league, or team |
| **Search** | Find any athlete, team, or article across ESPN |

## Tools (20)

### Discovery
| Tool | Description |
|------|-------------|
| `list_sports_and_leagues` | Discover all valid sport/league slugs |
| `search` | Global search for athletes, teams, articles |
| `espn_fetch` | Fetch any ESPN URL directly (escape hatch) |

### Scoreboard & Games
| Tool | Description |
|------|-------------|
| `get_scoreboard` | Live and scheduled games — entry point for finding eventIds |
| `get_game_summary` | Scores, team/player boxscore, leaders, key plays, sampled win probability |
| `get_game_plays` | Full play-by-play data |
| `get_game_odds` | Spread, moneyline, over/under by sportsbook |
| `get_game_probabilities` | Win probability timeline |

### Teams
| Tool | Description |
|------|-------------|
| `get_teams` | Compact team IDs, names, abbreviations, locations, and venues |
| `get_team` | Team detail, roster, schedule, record, depth chart, injuries, transactions, history, news, or leaders |
| `get_team_injuries` | Injury report for a single team |

### Athletes
| Tool | Description |
|------|-------------|
| `get_athlete_overview` | Player snapshot — stats, next game, news |
| `get_athlete_stats` | Season stats converted into named fields |
| `get_athlete_gamelog` | Game-by-game log |
| `get_athlete_splits` | Home/away, by opponent, by situation |

### League-Wide
| Tool | Description |
|------|-------------|
| `get_standings` | Current league standings |
| `get_league_leaders` | Statistical leaders by category |
| `get_injuries` | League-wide injury report |
| `get_transactions` | Recent signings, trades, waivers |
| `get_news` | Real-time sports news feed |

## Prompts (5)

Guided workflows that chain tools together:

| Prompt | What It Does |
|--------|-------------|
| `get-live-scores` | Get current scores, then drill into game details |
| `player-stats-report` | Search for a player, pull overview + stats + splits |
| `game-analysis` | Full game breakdown — summary, odds, plays, win probability |
| `league-overview` | Standings, leaders, injuries, news, transactions |
| `compare-teams` | Head-to-head comparison of two teams |

## Resources (4)

Static reference data agents can browse:

| Resource | URI | Description |
|----------|-----|-------------|
| Sports & Leagues | `sports://leagues` | All valid sport/league slugs |
| Season Types | `sports://reference/season-types` | Season type codes (1-4) |
| Betting Providers | `sports://reference/betting-providers` | Sportsbook provider IDs |
| API Domains | `sports://reference/api-domains` | ESPN API base URLs |

## Supported Sports

Basketball, Football, Baseball, Hockey, Soccer, Golf, Racing, Tennis, MMA, Lacrosse, Rugby, Cricket, Volleyball, Water Polo, Field Hockey, Australian Football, Rugby League

**139 leagues** including NFL, NBA, WNBA, MLB, NHL, NCAA, Premier League, La Liga, Serie A, Bundesliga, Ligue 1, MLS, UFC, PGA Tour, F1, and many more.

## Local Development

After cloning and installing (see [Install](#install)):
```bash
npm run dev       # watch mode — recompiles on file changes
npm start         # run the server via stdio
PORT=3000 npm start  # run as HTTP server on port 3000
npm test          # build and run transform regression tests
```

## Agent-safe responses

Dedicated tools return compact, curated JSON by default. Every tool accepts `raw: true`, but raw ESPN responses can be extremely large and should be used only to recover a specific omitted field. Responses over `SPORTS_LEADER_MAX_TOKENS` are replaced with valid truncation metadata; the server never cuts JSON mid-document.

Compact outputs intentionally remove image variants, navigation links, references, and UI metadata. They are returned as both compact JSON text and MCP `structuredContent` when the result is an object. See [tool contracts](docs/tools/) for the current response shapes.

## License

MIT
