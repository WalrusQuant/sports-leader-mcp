# Changelog

All notable changes to sports-leader-mcp. Dates are US Central.


## 0.5.0 — 2026-10-31

Historical Parquet export for MLB, NBA, NFL, and NHL. The existing 25 ESPN tools are unchanged.

### Added
- `get_games`, `get_team_box_scores`, `get_team_game_stats`, `get_player_game_logs` (NBA player, NHL skater/goalie, MLB batting/pitching, NFL passing/rushing/receiving), `get_rosters`, `get_injury_reports`, `get_transaction_log`, `get_depth_charts`, `get_probables`, `get_lineups`, `get_weather`, `get_published_ratings`, and `get_data_status`.
- The export names `get_injury_reports` and `get_transaction_log` sit beside the live `get_injuries` and `get_transactions` tools.
- Public, keyless access. `DEFAULT_BAYES_DATA_BASE_URL` in `src/data/config.ts` is the directory of `manifest.json` and `<league>/<dataset>/<season>.parquet` (fill it in when the static host is chosen). `BAYES_DATA_BASE_URL` overrides it. `BAYES_DATA_API_KEY` is optional and is sent as `X-API-Key` only when set.
- Disk cache. The manifest is rechecked at most every 4 hours (`BAYES_DATA_REVALIDATE_MS`) and uses `ETag` when the host sends one. Parquet files are kept while their sha256 matches the manifest, so a host with no ETag (or a GitHub release 302 to a CDN) still validates. Past seasons are not re-downloaded. `get_data_status` flags a current-season file older than 36 hours.
- Queries go through DuckDB Neo (`@duckdb/node-api`), which publishes glibc and musl builds. Filters are bound parameters; column names are checked against the manifest.
- `npm run audit` runs the data tools whenever a base URL is configured, key or not. With no base URL those checks are skipped.

## 0.4.0 — 2026-10-31

Live audit of the ESPN endpoints behind all 21 tools, then fixes and four new tools. `npm run audit` repeats that check.

### Added
- `get_rankings` — college polls (football, men's and women's basketball). Pro leagues return `unavailable` instead of an error.
- `get_power_index` — BPI (basketball) and FPI (football), sorted by rank, team id taken from the Core reference. NHL, MLB, and soccer return `unavailable`.
- `get_team_stats` — team season totals. Per-situation splits are left out (the MLB document is ~700 KB).
- `get_futures` — season futures with American odds and team or athlete ids (names are not in the Core document; 40 outcomes per market).
- `npm run audit` — calls every tool live (MLB, NBA, NFL, NHL, college football, men's and women's college basketball, WNBA, Premier League, plus a PGA scoreboard) and prints pass/fail. Not part of `npm test`.
- Scoreboard competitors for individual sports include `athlete` (`id`, `name`) and `order` (golf, tennis, racing).

### Fixed
- `get_teams` requested no limit, so college football and college basketball stopped at ESPN's default of 50. It now asks for 1000.
- `get_league_leaders` called the all-time `/leaders` collection, which ignores `season` and returns 400/404 for college, the WNBA, and soccer. It now calls `/seasons/{year}/types/{seasonType}/leaders` (type 2, then type 1 for soccer).
- `get_team` views `news`, `transactions`, `leaders`, and `history` read Site paths that return `{}`. News, transactions, and leaders now use the league news feed, league transactions, and Core season leaders. History returns the core franchise identity, the current record, and a note that season-by-season history is not published.
- `get_team` schedule retries the regular season (`seasontype=2`) when the default document has no events. That covers college basketball's empty preseason in October and an MLB team's empty postseason in November. Schedule and depth-chart views are compacted so they are not token-truncated.
- `get_standings` kept the last copy of repeated stat names, so college basketball wins/losses were a split (home, road, conference) instead of the overall record. The first value is kept. The token budget is measured on the compact JSON that is actually returned, so a full college basketball standings list is no longer replaced by a truncation envelope.
- `get_game_probabilities` returned an error on HTTP 400. Hockey, soccer, and not-yet-started games now return an empty timeline plus `unavailable`. A bad event id (404) is still an error.
- `get_news` league/team filters (2026-10-18). ESPN's now.core feed ignores `leagues` and `team`, so NFL + team=GB returned college-football previews. With sport+league the tool uses the Site API league feed and keeps articles tagged with the requested team. Site-API articles get keywords from their team/league/athlete categories (max 12).
- Removed the unused `coreV3` base (`sports.core.api.espn.com/v3`), which 404s. Athlete stats stay on the Web API v3 host. The CDN base is documented as an `espn_fetch` escape hatch (`xhr=1`), not as the schedule implementation.

## 0.3.0 — 2026-10-06

MCP TypeScript SDK v2 and spec 2026-07-28. Tool names, inputs, and compact output are unchanged from 0.2.0.

### Changed
- Migrated from `@modelcontextprotocol/sdk` 1.x to `@modelcontextprotocol/server` 2.3 (plus `@modelcontextprotocol/node` for HTTP). Tools, prompts, and resources use `registerTool` / `registerPrompt` / `registerResource` with zod 4 schemas (`zod ^4.2.0`).
- **HTTP is stateless.** Every `POST /mcp` is answered by a fresh server instance. 2026-07-28 requests are served per request with no handshake; 2025-era clients (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07) still get the classic `initialize` flow, served statelessly. No `Mcp-Session-Id` is issued, and `GET`/`DELETE /mcp` return `405`.
- stdio serves both eras from the same binary (`serveStdio`).
- `tools/list` order is fixed (registration order).
- Published JSON Schemas are now draft 2020-12 (generated by zod 4). Input schemas no longer advertise `additionalProperties: false`; the server ignores unknown arguments as before.
- `/health` reports `stateless` and the supported protocol versions; `/stats` and `/health` no longer report session counts.
- Node.js 20+ is required (was 18+).

### Added
- Cache hints on 2026-07-28 responses: list results public for 1 h, static `sports://` resources 24 h, `espn://` template reads 30 s (slate), 60 s (game data), 5 min (injuries).
- Cancellation: a cancelled call (or a dropped HTTP connection) aborts its in-flight ESPN requests, which are not retried.
- Tests for both eras: an SDK v2 client at 2026-07-28 and an unmodified SDK 1.29 client over HTTP and stdio, raw `initialize` at older revisions, the kill switch, and the rate limit.

### Removed
- The HTTP session map, oldest-session eviction, and the `MAX_SESSIONS` environment variable.
- The `execution.taskSupport` field in tool listings (tasks are no longer part of the core spec).

## 0.2.0 — 2026-10-06

Odds normalization, `get_slate`, output schemas, and resource templates on SDK 1.29 (spec 2025-11-25). Changes to output only add fields; nothing was renamed or removed. This line is kept on the `release/v1` branch.

### Added
- Odds normalized for prediction-market comparison in `get_game_odds`, `get_scoreboard` events, `get_game_summary`, and `get_slate`: numeric American moneylines (decimal/fractional converted), `*ImpliedProb` (vig included), `*NoVigProb` (proportional; three-way for soccer, `null` + `noVigReason` when a price is missing), `overround`, `homeSpread` (negative = home team favored), `total`, and a cross-book `consensus`.
- `get_game_odds` adds `eventId`, `startUtc`, and `homeTeam`/`awayTeam` (`id`, `abbrev`) using one cached event lookup.
- `get_slate(sport, league, date?, includeInjuries?)`: a whole game day in one call. The `game-analysis` prompt now starts with it.
- MCP `outputSchema` on `get_scoreboard`, `get_game_summary`, `get_game_odds`, `get_injuries`, `get_athlete_gamelog`, and `get_slate`. With `raw: true`, `structuredContent` is `{ raw: true, response }`.
- `teamId`/`athleteId` on injuries, `eventId` on game logs.
- Seven `espn://` resource templates (game summary, plays, probabilities, odds; league injuries; team injuries; slate) that return the same compact JSON as the matching tool, and `resource_link` items on `get_game_summary` and `get_slate`.
- Golden-file fixture tests for NFL, MLB, NBA, NHL, EPL, NCAAF, and WNBA, plus `npm run fixtures:capture` and `npm run test:update-golden`.

### Fixed
- League/sport/tool counts in all docs (30 verified leagues in 11 sports, 21 tools).

### Known issues
- ESPN's per-team injuries endpoint returns an empty document. As of 2026-10-19 `get_team_injuries` filters the league report by `teamId` instead (it previously returned one blank placeholder entry).

## 0.1.0

Initial release.
