# sports-leader-mcp


Free MCP server for live sports data. **43 tools, 4 resources, 7 resource templates, 5 prompts** covering scores, standings, rosters, player and team stats, betting odds, play-by-play, injuries, transactions, news, college rankings, power index, futures, and keyless Kalshi and Polymarket prices across **30 verified leagues in 11 sports**, plus a historical Parquet export for MLB, NBA, NFL, and NHL.

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
| **Betting Odds** | Spreads, moneylines, totals by sportsbook, normalized to implied and no-vig probabilities, plus keyless Kalshi and Polymarket prices for the same game |
| **Game Deep-Dives** | Boxscores, full play-by-play, win probability timelines |
| **Injuries & Transactions** | League-wide injury reports, signings, trades, waivers |
| **News** | Real-time sports news filtered by sport, league, or team |
| **Search** | Find any athlete, team, or article across ESPN |

## Tools (43)

### Discovery
| Tool | Description |
|------|-------------|
| `list_sports_and_leagues` | Discover all valid sport/league slugs |
| `search` | Global search for athletes, teams, articles |
| `espn_fetch` | Fetch any ESPN URL directly (escape hatch) |

### Scoreboard & Games
| Tool | Description |
|------|-------------|
| `get_scoreboard` | Live and scheduled games — entry point for finding eventIds. College basketball defaults to every Division I game |
| `get_game_summary` | Scores, team/player boxscore, leaders, key plays, sampled win probability |
| `get_game_plays` | Full play-by-play data |
| `get_game_odds` | Per-sportsbook lines with numeric moneylines, implied/no-vig probabilities, signed `homeSpread`, and consensus |
| `get_game_probabilities` | Win probability timeline |
| `get_slate` | One call per game day: games, team IDs, status/score, consensus no-vig probabilities, key Out/Doubtful injuries. College basketball is the full Division I slate |
| `get_game_preview` | One game: injuries, probables or lineups, weather, and Kalshi and Polymarket US winner prices. No sportsbook lines |

### Prediction markets

Keyless. No API key is read or sent. Kalshi, Polymarket, and Polymarket US are returned side by side and are never averaged. A venue with no listing is `{ "venue", "status": "no market found" }`. One venue failing leaves the others in the response.

| Tool | Description |
|------|-------------|
| `get_kalshi_markets` | Open Kalshi markets for a league (`winner`, `spread`, or `total`). Prices are the dollar fields. `includeBook` adds the top of book. |
| `get_polymarket_markets` | Polymarket global and Polymarket US, each labelled. Default market is the moneyline. |
| `get_market_odds` | Match one ESPN game to all three venues. Includes `fetchedAt` and `matchedBy`. |

Supported leagues: NFL, NBA, MLB, NHL, college football, men's college basketball, women's college basketball. Team codes differ (Wisconsin is `WIS` on Kalshi and `wisc` on Polymarket). Kalshi tickers keep the original scheduled date when a game is postponed. Polymarket global slugs use the UTC date; the US slug is `aec-` plus Gamma's `usId` (local date).

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
| `get_athlete_gamelog` | Game-by-game log. A repeated label is nested by category (`rushing.YDS` and `receiving.YDS`); a single-category log stays flat |
| `get_athlete_splits` | Home/away, by opponent, by situation |
| `get_player_report` | One call: resolve a name inside the league, then season stats, last N games, and splits. An ambiguous name returns candidates |

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

Nightly Parquet files: schedule and results, team box scores and counting stats, player game logs, rosters, injuries, transactions, depth charts, probables, lineups, and weather. Rows are denormalized (ESPN ids and names on every row). Seasons start at 2021. NBA and NHL seasons are named by the year they end (2026-27 is 2027). These names do not replace the live ESPN tools: `get_injury_reports` and `get_transaction_log` are the export, `get_injuries` and `get_transactions` stay the live feeds. A data set the manifest does not include returns an error naming it.

| Tool | Data set |
|------|----------|
| `get_games` | Schedule and results |
| `get_team_box_scores` | ESPN team box line |
| `get_team_game_stats` | Team counting stats for and against |
| `get_player_game_logs` | NBA player, NHL skater/goalie, MLB batting/pitching, NFL passing/rushing/receiving (`statGroup`) |
| `get_player_trends` | Averages and totals by home/away, opponent, month, or days of rest. Rates are recomputed; longest is a max |
| `get_rosters` | Roster spans (`valid_to` empty means still current) |
| `get_injury_reports` | Injury history |
| `get_transaction_log` | Transaction history |
| `get_depth_charts` | NFL depth chart |
| `get_probables` | Probable pitchers and goalies |
| `get_lineups` | Announced lineups |
| `get_weather` | Game weather |
| `get_data_status` | Manifest summary and freshness |

Filters: `league`, `season` / `seasons`, `from` / `to` (`YYYY-MM-DD`), `team` and `opponent` (ESPN id or abbreviation), `player` (ESPN id or a name substring), `columns`, `sort`, `order`, `limit` (default 100, hard cap 250). Column names are checked against the manifest and bound as SQL parameters. Every result includes the file's `updated_at`. `get_data_status` flags a current-season file older than 36 hours while that league is in season. In season means the current games file has a game in the last 7 days.

#### Configuration

No API key. Install and the historical data is available: seasons from 2021, published to GitHub Releases nightly after about 7:15 AM CT.

```ts
// src/data/config.ts
export const DEFAULT_BAYES_DATA_MANIFEST_URL =
  "https://github.com/WalrusQuant/sportsleader-data/releases/download/manifest/manifest.json";
```

The manifest lists every file and its download `url`. The pattern is `https://github.com/WalrusQuant/sportsleader-data/releases/download/<league>_<dataset>/<season>.parquet` (for example `nba_games/2027.parquet`). Those URLs 302 to a short-lived CDN link. The CDN can answer `304`, but the GitHub hop does not, and the signed link changes every request, so a cached file is kept while its sha256 matches the manifest. That also stays under GitHub's unauthenticated download cap: the manifest is checked at most every 4 hours, and unchanged seasons are not downloaded again. `updated_at` is what the tools report and what the 36-hour flag uses.

| Variable | Default | Purpose |
|----------|---------|---------|
| `DEFAULT_BAYES_DATA_MANIFEST_URL` | GitHub Releases manifest above | Built-in public source |
| `SPORTSLEADER_DATA_MANIFEST_URL` | the constant | Preferred manifest override. File `url`s in that manifest are still used |
| `SPORTSLEADER_DATA_BASE_URL` | unset | Preferred directory mirror: `{base}/manifest.json`, and `{base}/<path>` when a file has no `url` |
| `BAYES_DATA_MANIFEST_URL` | unset | Alias of `SPORTSLEADER_DATA_MANIFEST_URL`. The new name wins when both are set |
| `BAYES_DATA_BASE_URL` | unset | Alias of `SPORTSLEADER_DATA_BASE_URL` |
| `BAYES_DATA_CACHE_DIR` | `~/.cache/sports-leader-mcp/bayes-data` | On-disk file cache (`XDG_CACHE_HOME` is honored) |
| `BAYES_DATA_REVALIDATE_MS` | `14400000` (4 hours) | How often to re-check the manifest |

The live ESPN tools and the prediction-market tools do not use this export. A `429` or a GitHub `403` with `x-ratelimit-remaining: 0` is returned as a rate-limit error.

Files are queried with [DuckDB Neo](https://duckdb.org/) (`@duckdb/node-api`). It ships prebuilt binaries for glibc and musl, on x64 and arm64, so `npm ci` does not need a compiler on a normal Linux image or on Alpine.

`npm run audit` reads the GitHub Releases manifest and runs a tool for each data set that is actually published. A data set the manifest no longer includes is not a failure. No API key is used. Clearing the default and unsetting both the `SPORTSLEADER_DATA_*` and `BAYES_DATA_*` URL variables prints those checks as skipped instead of failed.

## Prompts (5)

Guided workflows that chain tools together:

| Prompt | What It Does |
|--------|-------------|
| `get-live-scores` | Get current scores, then drill into game details |
| `player-stats-report` | One call for season stats, recent games, and splits |
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

`npm run audit` is not part of `npm test`. It calls the real ESPN APIs for MLB, NBA, NFL, NHL, college football, men's and women's college basketball, WNBA, and the Premier League, validates compact output against each tool's schema, and exits non-zero on a failure. The same command prints a contract section for the raw behaviors those tools depend on: a single scoreboard date per league, rejection of `dates=YYYYMMDD-YYYYMMDD` (if ESPN accepts a range again the line is INFO), men's college basketball `groups=50&limit=400` returning more games than the default, summary `injuries` and `gameInfo` weather and venue, NHL and MLB `competitors[].probables`, the NFL gamelog categories, Kalshi `yes_bid_dollars` / `yes_ask_dollars`, and the Polymarket Gamma and US book shapes. Each line names the endpoint. An offseason league with no games is skipped. `.github/workflows/ci.yml` runs the offline suite on pull requests and on `main`. `.github/workflows/contract.yml` runs this audit when dispatched, with no schedule. For the leagues with prediction markets it also calls `get_market_odds` on today's first game. A league with no listing (MLB in the offseason) is skipped. It previews the first game of the day for NFL, NBA, NHL, and men's college basketball; `"no market found"` passes with a note. A 4xx, a Gamma 406, or a schema failure fails the audit. Re-run it when a tool starts returning empty or upstream errors. MLB in late October and November is the offseason: the audit accepts an empty current scoreboard and checks 2026-07-04 instead. It also checks the public historical export on GitHub Releases with no API key: one file for each data set the live manifest still publishes. A removed data set is not a failure. Those lines are `SKIP` only when the manifest default has been cleared and both the `SPORTSLEADER_DATA_*` and `BAYES_DATA_*` URL variables are unset.

## Agent-safe responses

Dedicated tools return compact, curated JSON by default. Every tool accepts `raw: true`, but raw ESPN responses can be extremely large and should be used only to recover a specific omitted field. Responses over `SPORTS_LEADER_MAX_TOKENS` are replaced with valid truncation metadata; the server never cuts JSON mid-document.

Compact outputs intentionally remove image variants, navigation links, references, and UI metadata. They are returned as both compact JSON text and MCP `structuredContent`; a top-level array result is exposed as `structuredContent: { "items": [...] }` (same shape for every protocol era). `get_scoreboard`, `get_game_summary`, `get_game_odds`, `get_injuries`, `get_athlete_gamelog`, `get_player_report`, `get_player_trends`, `get_slate`, `get_game_preview`, `get_kalshi_markets`, `get_polymarket_markets`, and `get_market_odds` also publish an MCP `outputSchema`; schemas allow additional properties because fields are only ever added. With `raw: true`, the text block is the untouched ESPN JSON and `structuredContent` is `{ "raw": true, "response": ... }`. See [tool contracts](docs/tools/) for the current response shapes.

`get_athlete_gamelog` nests each stat under its ESPN category when the flat label list repeats one (`stats.rushing.YDS` and `stats.receiving.YDS`). `categories` lists those groups. A single-category log, which is what MLB, NBA, and NHL publish, keeps `stats` as a flat map of abbreviation to value. Games are newest first and each one has `seasonType` when ESPN labels the split. `get_player_report` recent games use the same stat shape and leave preseason out unless `includePreseason` is true. The report adds `athlete.injury` when ESPN lists a current injury.

### Odds conventions

All normalized odds (in `get_game_odds`, `get_scoreboard` events, `get_game_summary`, and `get_slate`) use:

- **Moneylines**: American odds as numbers (`-225`, `185`); decimal/fractional prices are converted.
- **`*ImpliedProb`**: break-even probability of the price, vig included.
- **`*NoVigProb`**: implied probabilities divided by their sum so all outcomes total 1. Soccer is three-way (home/away/draw). If any needed price is missing, no-vig is `null` with a `noVigReason`.
- **`homeSpread`**: the home team's spread. **Negative means the home team is favored.**
- **`consensus`**: mean of per-provider no-vig probabilities (re-normalized), median spread and total.

## License

MIT
