# Changelog

All notable changes to sports-leader-mcp. Dates are US Central.


## Unreleased

### Added
- ML lab foundations under `lab/`. `sports-leader-lab` is a second stdio server (`python -m sports_leader_lab`) with a ping tool. It reads the public sportsleader-data manifest, caches Parquet outside the repo after a sha256 check, and registers DuckDB views such as `nhl_games`. Feature families declare `known_at`: shifted rolling and EWMA form, rest and travel from the schedule, home and neutral site, as-of Elo, MLB probable counts, and injury counts at start time. Splits are walk-forward by season or by date, with an embargo. The lab is research software and does not report a betting edge. The Node server is unchanged. Modeling tools are not in this change.
- Lab review fixes: injury and probable counts stay null before the snapshot's first row; rest skips postponed, cancelled, and suspended-without-play games and nulls gaps over 21 days; venue change uses the venue name; an embargo of N full days differs from N-1; SQL features run with external access off; `build_features` carries postgame filter and target columns.
- ML lab core tools: `inspect_data`, `query_data`, `build_dataset`, `train_classifier`, `train_regressor`, and `predict`. User-facing SQL is SELECT-only on a locked connection with a timeout and a row cap. Custom SQL features cannot see postgame columns. Date folds default to 50 training rows. Elo regresses one third of the way to 1500 between seasons and warns which season was a cold start. `predict` is as of US Central and can show a caller-supplied current price without storing it. The lab remains research software and does not report a betting edge. The Node server version is unchanged.
- ML lab review fixes: a one-class training fold is skipped by fold number instead of raising; run and dataset ids must match `run_` or `dataset_` plus 12 hex digits and cannot resolve outside the run store; custom SQL sees as-of snapshot views (`nfl_injuries_asof`) and cannot read the raw snapshot; a negative-binomial fit that does not converge is an error, and a dispersion at its bound is a warning; classifier predictions omit the null implied-win field. `ruff` and `mypy` check the lab in CI. The Node server version is unchanged.
- ML lab guardrails: `audit_features` runs the same leakage checks as `build_dataset` and does not save. Target copies, scores, same-game box stats, timestamps after start, and raw snapshot references fail, including a double-quoted name such as `"nfl_injuries"` or `"main"."nfl_injuries"`. A single feature with a very high AUC is a warning. `list_runs`, `compare_runs`, and `model_card` read the run record. Each run stores the lab version, feature list, params, split spec, seeds, and manifest sha256, and writes `folds.json` plus `predictions.csv`. The Node server version is unchanged.
- ML lab guardrail review: a feature that matches a score, the target, or the margin on at least 90% of rows (or on every row of a shorter frame) is a hard failure, including a scaled or shifted margin. Run timestamps keep microseconds, and `list_runs` breaks ties with a monotonic sequence then the run id. The model card adds an approval-history section, records feature family names next to the column list, checksums `predictions.parquet`, and re-renders to the same bytes as the saved card. The Node server version is unchanged.


## 0.9.0 — 2026-11-17

Older scoreboard days come from the games export in one query. 43 tools.

### Added
- `get_scoreboard` and `get_slate` read `games` for a day that is strictly older than the games file and strictly older than today and the previous 2 US-Eastern days. Freshness is the earlier of that file's `updated_at` and the manifest `generated_at`. One query covers every such day in the range, including a full season. `mlb`, `nba`, `nfl`, `nhl`, `cfb` (college football, FBS), and `cbb` (men's college basketball, Division I) are published from the 2021 season through today. The current season is rebuilt nightly, around 4:15 AM CT. NBA, NHL, and `cbb` are named by the year the season ends. NFL, MLB, and `cfb` are named by the year the season starts. `college-football` maps to `cfb` and `mens-college-basketball` maps to `cbb`. `game_id` is the ESPN event id.
- NHL lineups in the export come from the official NHL API. Starting goalies are ESPN probables before the game and the NHL box score after it. Lines and pairs come from the official shift charts. Daily Faceoff is not a source.
- The compact response adds `source` (`data`, `espn`, or `mixed`), `sourceNote`, and `days` (each date, its source, and its full game count) when any requested day is not a live or future ESPN day. A live-only response is unchanged. Games from the export omit period scores, records, odds, and broadcasts. On a slate those odds fields are null, `keyInjuries` is null, and the current injury report is not fetched when every game came from the export. A mixed slate still fetches that report once and applies it only to ESPN games.
- A compact scoreboard or slate that would exceed the token budget returns a `page` and a note. `offset` returns the next slice. `days` still counts every game on every requested date. `raw=true` can still hit the truncation envelope.
- The data tools accept `cfb` and `cbb`. College football player logs use the same passing, rushing, and receiving groups as the NFL. Men's college basketball uses the player group. A league or season the manifest does not have is still an error from those tools.

### Removed
- Smithery. The listing is gone, and the package is not published to npm. Clone the repository, run `npm ci` and `npm run build`, and point the MCP client at `node /path/to/sports-leader-mcp/dist/index.js`.

### Changed
- ESPN still rejects `dates=YYYYMMDD-YYYYMMDD` on every league. Today, the previous 2 Eastern days, future days, a week query, a missing season, a file that is not yet current through that day, and every league outside the export stay on ESPN, one day at a time, four at a time, at most 14 of those days. A `groups` value other than omitted, or `50` for men's college basketball, stays on ESPN. Women's college basketball is not in the export. If the manifest or the file cannot be read, the tool uses ESPN when that is 14 days or fewer and errors, with the export failure named, instead of requesting a longer range one day at a time. Preview and market lookups use the same scoreboard fetch for a single date.
- The live contract check walks later Gamma events when the first slug has an empty markets list or the Polymarket US book has null `bestBid` and `bestAsk` (a just-settled game can stay `active` with `MARKET_STATE_EXPIRED`). A response that omits those keys still fails. The data-export trend check uses a positive `player_id`; college logs also publish a team-total row with a negative id.

## 0.8.4 — 2026-11-17

CI runs the offline test suite, and the live audit checks the upstream contracts the scoreboard and market tools depend on. 43 tools.

### Added
- `.github/workflows/ci.yml` runs on pull requests and on pushes to `main`. It uses Node 22 (the LTS line this repo typechecks against; `engines` is `>=20`), then `npm ci`, `npm run build`, `npm run typecheck`, and `npm test`. There is no lint script. The suite stays on fixtures. The stdio compatibility test's live `list_sports_and_leagues` call is behind `SPORTSLEADER_LIVE=1`, so CI does not call ESPN, Kalshi, or Polymarket.
- `npm run audit` prints a `contract` section after the tool checks. Each line is pass, fail, skip, or info, and names the endpoint. Single-date scoreboards must return events for every league. `dates=YYYYMMDD-YYYYMMDD` must stay HTTP 400, including men's college basketball with `groups=50&limit=400`. If ESPN accepts a range again, that line is INFO and the audit still passes. Men's college basketball on 2026-11-15 must return more games for `groups=50&limit=400` than the default scoreboard. An NFL summary must still include `injuries` and `gameInfo.venue`. A sampled NFL or college football summary must still include `gameInfo.weather`. NHL and MLB scoreboards must still put probable goalies and pitchers on `competitors[].probables` with `athlete.displayName`. Josh Jacobs' NFL gamelog must still partition `labels` with `categories` and repeat `YDS` across categories, and `seasonTypes[].categories[].events[]` must still carry `eventId` and `stats`. Kalshi `trade-api/v2/markets` must still send `yes_bid_dollars` and `yes_ask_dollars`. Polymarket Gamma events must still have `slug`, `teams[].abbreviation`, and `eventDate` or `startTime`, and the moneyline must still have `outcomes`, `outcomePrices`, and `clobTokenIds`. The Polymarket US gateway `bbo` must still be `marketData.bestBid` and `marketData.bestAsk`. An offseason league with no games is SKIP with a note. MLB and the WNBA are offseason in November.
- `.github/workflows/contract.yml` runs `npm run audit` from `workflow_dispatch` only. It has no schedule.

## 0.8.3 — 2026-11-17

Game preview weather reports sustained wind and gusts separately, condition labels match the AccuWeather icon table, and every league's date range is fetched one day at a time. 43 tools.

### Fixed
- `get_game_preview` copied `gameInfo.weather.gust` into `windMph` whenever sustained wind was missing. Wisconsin at Purdue (401858533, Nov 21, Ross-Ade) is 61°F and Mostly Cloudy with a 17 mph gust and no sustained wind; the preview reported `windMph: 17`. `windMph` is sustained wind only (`windSpeed`, a `NW 12 mph` string, or a nested wind speed) and is null when ESPN does not send one. Gusts are `gustMph`, including 0. A gust is never copied into `windMph`.
- AccuWeather icon codes 1–44 (ESPN `conditionId`) were checked against the published weather-icons table. Code 37 was "Hazy" and is "Hazy Moonlight". Code 8 was "Overcast" and is "Dreary (Overcast)". Night codes 36 and 38 were already "Intermittent Clouds" and "Mostly Cloudy". The other codes already named the same conditions. Labels stay title case, with "with" and "Thunderstorms" spelled out. Codes 9, 10, 27, and 28 are unused and stay unlabeled.
- `get_scoreboard` and `get_slate` sent `dates=YYYYMMDD-YYYYMMDD` straight through. ESPN returns HTTP 400 for that form on every league scoreboard (NBA, NHL, NFL, college football, MLB, and both college basketball leagues), with or without `groups` and `limit`. A `dateRange` is now one day at a time for every league, four days at a time, then deduped by id and sorted by start time. A range longer than 14 days, or one that ends before it starts, is an error before any request. Men's and women's college basketball days still use group 50 and limit 400 (or the `groups` you passed). An NFL or college football `week` query stays one ESPN request and does not add that group. The slate injury report stays the one current league report. Team schedule is a season document and does not send a scoreboard range. Preview and market lookups send one YYYYMMDD and use the same scoreboard fetch, so a range cannot be forwarded as a single `dates` value. Nov 15–22, 2026 men's college basketball is 409 games, including Coastal Carolina at Wisconsin and Seton Hall vs Wisconsin. That compact scoreboard is about 55,000 tokens, so the default 50,000 token budget replaces it with the truncation envelope.

## 0.8.2 — 2026-11-17

Player trends no longer sum rate and max stats, and recent games no longer mix in preseason. 43 tools.

### Fixed
- `get_player_trends` summed every numeric column. Igor Shesterkin's October save percentage was `total.save_pct: 3.715` (four games of about 0.929). Jordan Love's home line summed to `total.qbr: 317.6` and `total.passer_rating: 479.7`. Receiving `longest` was added up. Rate stats stay out of `total`. Save percentage is saves / shots against (81 / 87 = 0.931, not the mean of the per-game rates). Passer rating is recomputed from completions, attempts, yards, touchdowns, and interceptions. QBR is the mean weighted by attempts, or omitted when attempts are missing. `longest` and `long` use the maximum.
- A goalie queried as a skater came back `resolved: true` with `reason: not_found`. A player who is in a different stat group now returns `resolved: false`, `reason: wrong_group`, and the `statGroup` to pass. A player in none of the logs returns `resolved: false` and `reason: not_found`.
- `get_player_report` for Giannis (3032977) with `lastN: 30` returned 16 games, three of them preseason (Oct 3 TOR, Oct 8 NO, Oct 14 BKN), while the regular-season total was 13. `get_athlete_gamelog` now tags each game with `seasonType` and sorts by date, newest first. `recent` leaves preseason out unless `includePreseason` is true.
- `get_player_report` includes the current injury from the ESPN athlete page when one is listed. Josh Jacobs is Out, Right Finger Surgery.

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
