# sports-leader-mcp


Free MCP server for live sports data. **38 tools, 4 resources, 7 resource templates, 5 prompts** covering scores, standings, rosters, player and team stats, betting odds, play-by-play, injuries, transactions, news, college rankings, power index, and futures across **30 verified leagues in 11 sports**, plus a historical Parquet export for MLB, NBA, NFL, and NHL.

No ESPN auth or API keys. Stdio mode has no server-side request quota; HTTP mode applies configurable per-IP limits.

---

## Install

Requires Node.js 20 or newer. Clone and build:
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
| **Standings, Rankings & Power Index** | Standings, statistical leaders, college polls, and BPI/FPI |
| **Betting Odds** | Spreads, moneylines, totals by sportsbook, normalized to implied and no-vig probabilities for comparison with prediction markets |
| **Game Deep-Dives** | Boxscores, full play-by-play, win probability timelines |
| **Injuries & Transactions** | League-wide injury reports, signings, trades, waivers |
| **News** | Real-time sports news filtered by sport, league, or team |
| **Search** | Find any athlete, team, or article across ESPN |

## Tools (38)

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
| `get_team_stats` | Team season stat line (totals, not every split) |

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
| `get_rankings` | College poll rankings (AP, coaches, and the other polls ESPN publishes) |
| `get_power_index` | BPI (basketball) or FPI (football) with rank and projections |
| `get_futures` | Season futures odds (championship, awards) with team or athlete ids |

### Historical export (MLB, NBA, NFL, NHL)

Nightly Parquet files: schedule and results, team box scores and counting stats, player game logs, rosters, injuries, transactions, depth charts, probables, lineups, weather, and the published team rating. Rows are denormalized (ESPN ids and names on every row). Seasons start at 2021. NBA and NHL seasons are named by the year they end (2026-27 is 2027). These names do not replace the live ESPN tools: `get_injury_reports` and `get_transaction_log` are the export, `get_injuries` and `get_transactions` stay the live feeds.

| Tool | Data set |
|------|----------|
| `get_games` | Schedule and results |
| `get_team_box_scores` | ESPN team box line |
| `get_team_game_stats` | Team counting stats for and against |
| `get_player_game_logs` | NBA player, NHL skater/goalie, MLB batting/pitching, NFL passing/rushing/receiving (`statGroup`) |
| `get_rosters` | Roster spans (`valid_to` empty means still current) |
| `get_injury_reports` | Injury history |
| `get_transaction_log` | Transaction history |
| `get_depth_charts` | NFL depth chart |
| `get_probables` | Probable pitchers and goalies |
| `get_lineups` | Announced lineups |
| `get_weather` | Game weather |
| `get_published_ratings` | Published rating and range, by day |
| `get_data_status` | Manifest summary and freshness |

Filters: `league`, `season` / `seasons`, `from` / `to` (`YYYY-MM-DD`), `team` and `opponent` (ESPN id or abbreviation), `player` (ESPN id or a name substring), `columns`, `sort`, `order`, `limit` (default 100, hard cap 250). Column names are checked against the manifest and bound as SQL parameters. Every result includes the file's `updated_at`. `get_data_status` flags a current-season file older than 36 hours.

#### Configuration

No API key. Install and the historical data is available: seasons from 2021, with the current season rebuilt daily at about 7:15 AM CT.

```ts
// src/data/config.ts
export const DEFAULT_BAYES_DATA_BASE_URL = "https://bayesratings.com/data/v1/";
```

That directory contains `manifest.json` and `<league>/<dataset>/<season>.parquet`. Use the apex host. `www.bayesratings.com` returns a 301 to `https://bayesratings.com`, and the client follows redirects. `BAYES_DATA_BASE_URL` overrides the constant when you want a different directory. The other 25 tools do not use this URL.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEFAULT_BAYES_DATA_BASE_URL` | `https://bayesratings.com/data/v1/` | Public export directory |
| `BAYES_DATA_BASE_URL` | the constant | Override that directory |
| `BAYES_DATA_CACHE_DIR` | `~/.cache/sports-leader-mcp/bayes-data` | On-disk file cache (`XDG_CACHE_HOME` is honored) |
| `BAYES_DATA_REVALIDATE_MS` | `14400000` (4 hours) | How often to re-check the manifest |

The manifest is cached and revalidated with `ETag` / `If-None-Match` (the public host sends both, and answers `304`). A parquet file is reused while its sha256 matches the manifest, so past seasons stay on disk and the current season is picked up the next time the manifest changes. `updated_at` from the manifest is what the tools report and what the 36-hour flag uses.

Files are queried with [DuckDB Neo](https://duckdb.org/) (`@duckdb/node-api`). It ships prebuilt binaries for glibc and musl, on x64 and arm64, so `npm ci` does not need a compiler on a normal Linux image or on Alpine.

`npm run audit` reads the public manifest, downloads one file per data set, and runs the matching tool. No API key is used. Clearing the default and unsetting `BAYES_DATA_BASE_URL` prints those checks as skipped instead of failed.

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

## Protocol compatibility

Built on MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). One server serves both protocol eras, over HTTP and stdio:

| Client speaks | Works? | How |
|---|---|---|
| 2026-07-28 (stateless MCP) | Yes | Per-request, no handshake; list results carry cache hints |
| 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 | Yes | Classic `initialize` handshake. Over HTTP it is served statelessly (no `Mcp-Session-Id`; `GET`/`DELETE /mcp` return 405) |

Tool names, inputs, compact output, `outputSchema`/`structuredContent` and `resource_link` items are the same in both eras. `npm test` checks this with a v2 client at 2026-07-28 and an unmodified SDK 1.29 client.

- **Stateless HTTP:** no session map, no `Mcp-Session-Id`, no `MAX_SESSIONS`; any replica can answer any request. See the [Self-Hosting Guide](docs/self-hosting.md#protocol-versions-and-stateless-http).
- **Cache hints (2026-07-28 only):** list results are `public` for 1 h, static `sports://` resources 24 h, `espn://` template reads 30 s (slate), 60 s (game data) or 5 min (injuries).
- **Cancellation:** cancelling a call aborts its in-flight ESPN requests (they are not retried).
- **Requirements:** Node.js 20+; schemas are authored with zod 4 (`^4.2.0`, required by SDK v2).

## Local Development

After cloning and installing (see [Install](#install)):
```bash
npm run dev       # watch mode — recompiles on file changes
npm start         # run the server via stdio
PORT=3000 npm start  # run as HTTP server on port 3000
npm test          # build and run unit, golden-file, and MCP end-to-end tests
npm run audit     # live pass/fail check of every tool against ESPN; data export when a base URL is set
npm run test:update-golden  # regenerate test/golden after an intentional output change
npm run fixtures:capture    # re-record raw ESPN fixtures into test/fixtures
```

`npm run audit` is not part of `npm test`. It calls the real ESPN APIs for MLB, NBA, NFL, NHL, college football, men's and women's college basketball, WNBA, and the Premier League, validates compact output against each tool's schema, and exits non-zero on a failure. Re-run it when a tool starts returning empty or upstream errors. MLB in late October and November is the offseason: the audit accepts an empty current scoreboard and checks 2026-07-04 instead. It also checks the public historical export at `https://bayesratings.com/data/v1/` with no API key: one file per data set. Those lines are `SKIP` only when the default has been cleared and `BAYES_DATA_BASE_URL` is unset.

## Agent-safe responses

Dedicated tools return compact, curated JSON by default. Every tool accepts `raw: true`, but raw ESPN responses can be extremely large and should be used only to recover a specific omitted field. Responses over `SPORTS_LEADER_MAX_TOKENS` are replaced with valid truncation metadata; the server never cuts JSON mid-document.

Compact outputs intentionally remove image variants, navigation links, references, and UI metadata. They are returned as both compact JSON text and MCP `structuredContent`; a top-level array result is exposed as `structuredContent: { "items": [...] }` (same shape for every protocol era). `get_scoreboard`, `get_game_summary`, `get_game_odds`, `get_injuries`, `get_athlete_gamelog`, and `get_slate` also publish an MCP `outputSchema`; schemas allow additional properties because fields are only ever added. With `raw: true`, the text block is the untouched ESPN JSON and `structuredContent` is `{ "raw": true, "response": ... }`. See [tool contracts](docs/tools/) for the current response shapes.

### Odds conventions

All normalized odds (in `get_game_odds`, `get_scoreboard` events, `get_game_summary`, and `get_slate`) use:

- **Moneylines**: American odds as numbers (`-225`, `185`); decimal/fractional prices are converted.
- **`*ImpliedProb`**: break-even probability of the price, vig included.
- **`*NoVigProb`**: implied probabilities divided by their sum so all outcomes total 1. Soccer is three-way (home/away/draw). If any needed price is missing, no-vig is `null` with a `noVigReason`.
- **`homeSpread`**: the home team's spread. **Negative means the home team is favored.**
- **`consensus`**: mean of per-provider no-vig probabilities (re-normalized), median spread and total.

## License

MIT
