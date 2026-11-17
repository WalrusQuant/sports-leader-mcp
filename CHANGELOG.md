# Changelog

All notable changes to sports-leader-mcp. Dates are US Central.


## 0.8.1 — 2026-11-16

Market matching for neutral sites, Kalshi spreads and totals, and Polymarket dates. 43 tools.

### Fixed
- `get_market_odds` and `get_game_preview` accept either home/away order. Seton Hall at Wisconsin (401920888, Nov 19) is a neutral site: ESPN lists Wisconsin at home, while Kalshi `KXNCAAMBGAME-26NOV19WISHALL` and Polymarket `cbb-wisc-seton-2026-11-19` list Wisconsin first. Prices stay on the team. The Polymarket US slug is tried in both orders.
- Kalshi spread and total events keep their ticker date. A spread suffix such as `NOP9` is a team code plus a line, and the other team is read from the winner series and the pro abbreviation list. `get_kalshi_markets` for NBA spreads on 20261116 had been returning the one event whose codes were already in the alias table. Team names and nicknames are returned with the codes, so Warriors, Pelicans, Wizards, Nets, and Suns match.
- A team lookup uses the same word-boundary match as `get_game_preview` and returns an error when more than one game matches. "Kansas" no longer selects Arkansas at Indiana by substring. Men's and women's college basketball scoreboards in the market tools request every Division I game (group 50, limit 400).
- Polymarket US is requested from `aec-{sport}-{away}-{home}-{eventDate}` when Gamma's `usId` is null, trying Gamma and ESPN codes and the swapped order. That covers `aec-nhl-mon-nyr-2026-11-16`, `aec-nhl-van-uta-2026-11-16`, and `aec-cfb-wisc-pur-2026-11-21`. Each team's mid is the bid/ask midpoint (the other team is one minus that midpoint) and is labelled `mid`.
- `get_polymarket_markets` uses Gamma `eventDate` alone when it is present, so a previous night's late tip is not included with the next day's games. Duplicate slugs are dropped. Team filters are exact codes, aliases, and names: `WIS` matches Wisconsin and not Wisconsin-Stout.
- A date that is not a calendar day, such as `20261399`, is rejected. `get_game_preview` returns an error when `eventId` and `team` are both passed and name different games.

## 0.8.0 — 2026-11-16

One call for a game's injuries, probables or lineups, weather, and winner prices. 43 tools.

### Added
- `get_game_preview` takes `sport`, `league`, and either `eventId` or `team` (optional `date`, default today in America/Chicago). It returns that one game: injuries and weather from the ESPN summary, the venue, MLB probable pitchers and NHL probable goalies from the scoreboard, and NBA, MLB, and NHL announced lineups from the same Parquet path as `get_lineups`.
- Kalshi and Polymarket US winner prices come from the existing `get_market_odds` matcher. No new venue client. Prices are not averaged, and there are no sportsbook lines. A game with neither listing is `"no market found"`. Postponed games keep the original date in the Kalshi ticker.
- `include` fetches only the named blocks. One block failing leaves the others in the response and puts the message on `errors`. An indoor venue is `{ "indoor": true }`. The summary venue often omits `indoor`; the scoreboard flag fills that in.

## 0.7.1 — 2026-11-16

`get_athlete_gamelog` keeps every stat when ESPN repeats a label. 42 tools.

### Fixed
- Game logs zipped ESPN's flat label list onto each row, so a repeated abbreviation kept only the last value. NFL rushing and receiving (and passing and rushing) both publish `YDS`, `AVG`, `TD`, and `LNG`. Josh Jacobs (4047365) at Detroit on 2026-10-25 had 36 rushing yards and 55 receiving yards; the log showed receiving yards as `YDS` and dropped the 36. Stats are now nested by ESPN category (`rushing.YDS`, `receiving.YDS`), and `categories` lists each group. `get_player_report` recent games use that same shape.
- College football has the same passing/rushing repeats. Checked the same day: MLB batting and pitching are separate documents, each with unique labels; NBA lines and NHL skater and goalie lines are unique too, so those logs stay a flat stat map. A label repeated inside one category gets a `_2` suffix.

## 0.7.0 — 2026-11-16

One call for how a player has looked lately, and trend aggregates from the Parquet game logs. 42 tools. The existing 40 tools are unchanged.

### Added
- `get_player_report` resolves a name or ESPN id inside the requested league, then returns the athlete, named season stats, the last N games, and the splits ESPN publishes. Search for "josh jacobs" matches more than one player; `league=nfl` resolves to 4047365. An ambiguous name returns candidates. One block failing (stats, gamelog, or splits) leaves the others in the response. Recent-game stats are nested by category when ESPN repeats a label, so rushing and receiving yards both stay.
- `get_player_trends` averages and totals a player's Parquet game log by `home_away`, `opponent`, `month`, or `rest` (days since the previous game). NFL logs are still only passing, rushing, and receiving. Aggregated columns are the manifest's numeric stat columns.

## 0.6.0 — 2026-11-16

Keyless prediction-market prices next to the ESPN odds. No API key is read or sent. 40 tools.

### Added
- `get_kalshi_markets` for the fixed game series (NFL, NBA, MLB, NHL, college football, men's and women's college basketball), including NFL and NBA spreads and totals. Prices are the dollar fields. `includeBook` adds the top of book, where the yes ask is 1 minus the best no bid.
- `get_polymarket_markets` returns Polymarket global and Polymarket US, each labelled. The default market is the moneyline. Global prices are Gamma outcome prices unless `includeBook` requests the CLOB book. The US slug is `aec-` plus Gamma's `usId`.
- `get_market_odds` matches one ESPN game to Kalshi, Polymarket, and Polymarket US. Venues are side by side and are not averaged. A missing venue is `{ venue, status: "no market found" }`. One venue failing leaves the others in the response. `fetchedAt` and `matchedBy` say when the response was built and how the game was matched.
- Team-code aliases for the abbreviations that differ across ESPN, Kalshi, and Gamma (Wisconsin is `WIS` on Kalshi and `wisc` on Gamma). Postponed Kalshi games keep the original ticker date.

## 0.5.4 — 2026-11-16

Men's and women's college basketball schedules and scores now include every Division I game. The bare scoreboard is a short featured list.

### Fixed
- `get_scoreboard` and `get_slate` request group `50` and `limit=400` for `mens-college-basketball` and `womens-college-basketball`. On 2026-11-15 the bare men's scoreboard returned 6 of 44 Division I games and omitted Wisconsin (team 275). Group 50 returned all 44. Women's basketball had the same gap that day (12 of 72). A grouped scoreboard also stops at 100 events, so a busy Saturday needs the higher limit (155 men's games on 2026-02-07; group 50 alone returned 100).
- Optional `groups` overrides the Division I default. A date query still sends `limit=400` for those two leagues. A `week` query is unchanged, because opening week is about 470 games and the compact scoreboard for that many games exceeds the token budget. Other leagues are unchanged. College football already returns every FBS game.
- 37 tools.

## 0.5.3 — 2026-11-04

The public export no longer publishes `team_ratings`. This server drops that tool and treats a missing data set as a normal answer, not an audit failure.

### Removed
- `get_published_ratings`. The export is game, roster, injury, transaction, lineup, and weather data. 37 tools.

### Changed
- Asking for a data set the manifest does not include returns an error that names the data set and points at `get_data_status`.
- `npm run audit` checks the data sets in the live manifest. A data set with no tool is skipped. A data set that is gone is not a failure.
- `SPORTSLEADER_DATA_MANIFEST_URL` and `SPORTSLEADER_DATA_BASE_URL` are the preferred overrides. `BAYES_DATA_MANIFEST_URL` and `BAYES_DATA_BASE_URL` still work; the new name wins when both are set. The default manifest URL is unchanged.

## 0.5.2 — 2026-11-02

User-facing text for the historical export names the GitHub Releases manifest. It no longer describes the retired site directory as the source.

### Changed
- All 13 data-tool descriptions name `https://github.com/WalrusQuant/bayesratings-data/releases/download/manifest/manifest.json`, `BAYES_DATA_MANIFEST_URL` as the manifest override, and `BAYES_DATA_BASE_URL` as the optional directory mirror (`{base}/manifest.json`, and `{base}/<path>` only when a file has no `url`).
- README, docs, Smithery, and the package description match that. Caching text still says release downloads 302 to a short-lived CDN URL and that a file stays cached while its sha256 matches the manifest. `get_data_status` still flags current-season files older than 36 hours.

## 0.5.1 — 2026-10-31

The historical export moved from `bayesratings.com/data/v1` to GitHub Releases on [bayesratings-data](https://github.com/WalrusQuant/bayesratings-data).

### Changed
- Default manifest is `https://github.com/WalrusQuant/bayesratings-data/releases/download/manifest/manifest.json`. Each file is downloaded from the `url` in the manifest (`releases/download/<league>_<dataset>/<season>.parquet`), not from a path joined onto one directory.
- `BAYES_DATA_MANIFEST_URL` overrides that manifest. `BAYES_DATA_BASE_URL` still selects a directory mirror (`{base}/manifest.json`, and `{base}/<path>` only when a file has no `url`).
- Release downloads 302 to a CDN and do not return 304 on the GitHub hop. Cached parquet is reused while its sha256 matches the manifest, so unauthenticated GitHub requests stay at the manifest check (at most every 4 hours) plus a download when a file actually changes. A `429` or a rate-limit `403` is reported as such.
- `get_data_status` still flags current-season files older than 36 hours, and now includes `manifestUrl`.

## 0.5.0 — 2026-10-31

Historical Parquet export for MLB, NBA, NFL, and NHL. The existing 25 ESPN tools are unchanged.

### Added
- `get_games`, `get_team_box_scores`, `get_team_game_stats`, `get_player_game_logs` (NBA player, NHL skater/goalie, MLB batting/pitching, NFL passing/rushing/receiving), `get_rosters`, `get_injury_reports`, `get_transaction_log`, `get_depth_charts`, `get_probables`, `get_lineups`, `get_weather`, `get_published_ratings`, and `get_data_status`.
- The export names `get_injury_reports` and `get_transaction_log` sit beside the live `get_injuries` and `get_transactions` tools.
- Public, keyless access. The default directory is `https://bayesratings.com/data/v1/` (apex; `www` redirects with a 301). `BAYES_DATA_BASE_URL` overrides it. There is no API key.
- Disk cache. The manifest is rechecked at most every 4 hours (`BAYES_DATA_REVALIDATE_MS`) and uses `ETag` when the host sends one. Parquet files are kept while their sha256 matches the manifest, so a host with no ETag (or a GitHub release 302 to a CDN) still validates. Past seasons are not re-downloaded. `get_data_status` flags a current-season file older than 36 hours.
- Queries go through DuckDB Neo (`@duckdb/node-api`), which publishes glibc and musl builds. Filters are bound parameters; column names are checked against the manifest.
- `npm run audit` runs the data tools against the public export with no API key. With no base URL those checks are skipped.

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
