# sports-leader-mcp


Free MCP server for live sports data. **21 tools, 4 resources, 5 prompts** covering scores, standings, rosters, player stats, betting odds, play-by-play, injuries, transactions, and news across **30 verified leagues in 11 sports**.

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
| **Betting Odds** | Spreads, moneylines, totals by sportsbook, normalized to implied and no-vig probabilities for comparison with prediction markets |
| **Game Deep-Dives** | Boxscores, full play-by-play, win probability timelines |
| **Injuries & Transactions** | League-wide injury reports, signings, trades, waivers |
| **News** | Real-time sports news filtered by sport, league, or team |
| **Search** | Find any athlete, team, or article across ESPN |

## Tools (21)

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
| `get_game_odds` | Per-sportsbook lines with numeric moneylines, implied/no-vig probabilities, signed `homeSpread`, and consensus |
| `get_game_probabilities` | Win probability timeline |
| `get_slate` | One call per game day: games, team IDs, status/score, consensus no-vig probabilities, key Out/Doubtful injuries |

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

### Resource templates

Large sub-payloads are also addressable as resources. Reading a URI returns exactly the compact JSON the matching tool returns for those arguments (variables are validated with the tool's input schema).

| Template | Same as |
|----------|---------|
| `espn://{sport}/{league}/game/{eventId}/summary` | `get_game_summary` |
| `espn://{sport}/{league}/game/{eventId}/plays` | `get_game_plays` |
| `espn://{sport}/{league}/game/{eventId}/probabilities` | `get_game_probabilities` |
| `espn://{sport}/{league}/game/{eventId}/odds` | `get_game_odds` |
| `espn://{sport}/{league}/injuries` | `get_injuries` |
| `espn://{sport}/{league}/team/{teamId}/injuries` | `get_team_injuries` |
| `espn://{sport}/{league}/slate/{date}` | `get_slate` |

`get_game_summary` appends `resource_link` content items (after the normal text block) for the full plays, probability timeline, all-book odds, and league injury report; `get_slate` links the full league injury report. Clients that ignore links get the same output as before.

## Supported Sports

**30 verified leagues across 11 sports** (the curated catalog in [`src/catalog.ts`](src/catalog.ts), also served by `list_sports_and_leagues` and `sports://leagues`):

Football (NFL, NCAA FBS, CFL, UFL) · Basketball (NBA, WNBA, NCAA men's and women's) · Baseball (MLB, NCAA baseball and softball) · Hockey (NHL, NCAA men's) · Soccer (MLS, Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Champions League, World Cup) · Golf (PGA, LPGA) · Tennis (ATP, WTA) · MMA (UFC) · Racing (F1, NASCAR Cup) · Lacrosse (PLL) · Australian Football (AFL)

ESPN exposes other leagues too; their slugs may work with the same tools or with `espn_fetch`, but they are not verified here.

## Local Development

After cloning and installing (see [Install](#install)):
```bash
npm run dev       # watch mode — recompiles on file changes
npm start         # run the server via stdio
PORT=3000 npm start  # run as HTTP server on port 3000
npm test          # build and run unit, golden-file, and MCP end-to-end tests
npm run test:update-golden  # regenerate test/golden after an intentional output change
npm run fixtures:capture    # re-record raw ESPN fixtures into test/fixtures
```

## Agent-safe responses

Dedicated tools return compact, curated JSON by default. Every tool accepts `raw: true`, but raw ESPN responses can be extremely large and should be used only to recover a specific omitted field. Responses over `SPORTS_LEADER_MAX_TOKENS` are replaced with valid truncation metadata; the server never cuts JSON mid-document.

Compact outputs intentionally remove image variants, navigation links, references, and UI metadata. They are returned as both compact JSON text and MCP `structuredContent` when the result is an object. `get_scoreboard`, `get_game_summary`, `get_game_odds`, `get_injuries`, `get_athlete_gamelog`, and `get_slate` also publish an MCP `outputSchema`; schemas allow additional properties because fields are only ever added. With `raw: true`, the text block is the untouched ESPN JSON and `structuredContent` is `{ "raw": true, "response": ... }`. See [tool contracts](docs/tools/) for the current response shapes.

### Odds conventions

All normalized odds (in `get_game_odds`, `get_scoreboard` events, `get_game_summary`, and `get_slate`) use:

- **Moneylines**: American odds as numbers (`-225`, `185`); decimal/fractional prices are converted.
- **`*ImpliedProb`**: break-even probability of the price, vig included.
- **`*NoVigProb`**: implied probabilities divided by their sum so all outcomes total 1. Soccer is three-way (home/away/draw). If any needed price is missing, no-vig is `null` with a `noVigReason`.
- **`homeSpread`**: the home team's spread. **Negative means the home team is favored.**
- **`consensus`**: mean of per-provider no-vig probabilities (re-normalized), median spread and total.

## License

MIT
