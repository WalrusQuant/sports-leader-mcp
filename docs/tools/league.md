# League-wide tools

All tools return compact JSON by default and accept optional `raw: true`.

## `get_standings`

Returns standings grouped by conference/division. Each entry has compact team identity plus a named `stats` object instead of ESPN's repeated stat metadata.

Parameters: `sport`, `league`, optional `season`, and `raw`.

## `get_league_leaders`

Returns named statistical categories with ranked leader values for one season. Omit `season` to use the league's current season year (NBA/NHL/college basketball use the ending year, so 2026-27 is `2027`). ESPN's bare `/leaders` collection is all-time, ignores `season`, and returns 400/404 for college, the WNBA, and soccer. This tool calls `/seasons/{year}/types/{seasonType}/leaders` instead: type `2` (regular season), then type `1` (what soccer publishes). Athlete names are often missing; compact output extracts `athleteId` from Core references.

Parameters: `sport`, `league`, optional `season`, optional `seasonType` (`1`–`4`), and `raw`.

## `get_injuries`

Returns league injuries grouped by team. It filters `Active`/news-only records and keeps player, team, position, status, injury detail, return date, report date, and a note capped at 140 characters. Each team carries `teamId` and each entry `athleteId` so you can join with other tools. Publishes an MCP `outputSchema`; also readable as `espn://{sport}/{league}/injuries`.

Parameters: `sport`, `league`, and optional `raw`.

This endpoint is not available for every sport; ESPN commonly returns an upstream error for MMA, tennis, and golf.

## `get_transactions`

Returns ESPN's transaction structure after recursive removal of image/reference/UI fields. The exact shape varies by league.

Parameters: `sport`, `league`, and optional `raw`.

## `get_news`

Returns a compact headline list with ID, type, headline, description, publication time, source, keywords, and article link.

Parameters: optional `sport`, `league`, team abbreviation or team id as `team`, `limit`, and `raw`.

## `get_rankings`

College poll rankings. Each poll has ordered `ranks` with `rank`, `previous`, `points`, `firstPlaceVotes`, `trend`, `record`, and compact `team` identity. Works for college football, men's college basketball, and women's college basketball. Pro leagues return `polls: []` and `unavailable` (ESPN has no rankings document for them). Omit `season` and `week` for the latest poll.

Parameters: `sport`, `league`, optional `season`, optional `week`, and `raw`. Publishes an `outputSchema`.

## `get_power_index`

ESPN's team strength rating for a season. Basketball leagues (NBA, WNBA, men's college basketball) return BPI stats such as `bpi` and `bpirank`. Football (NFL, college football) returns FPI stats such as `fpi`, `fpirank`, and projected wins. Rows are sorted by rank. `teamId` is parsed from the Core reference; join `get_teams` for the name. The tool returns the full collection ESPN publishes for that season (college football was 138 teams on 2026-10-31; men's and women's college basketball were 25). NHL, MLB, and soccer are not published and return `teams: []` plus `unavailable`.

Parameters: `sport`, `league`, optional `season`, and `raw`. Publishes an `outputSchema`.

## `get_futures`

Season futures (championship, conference, awards). Each market lists a provider and outcomes with American `odds` plus `teamId` and/or `athleteId`. This Core document does not include names. At most 40 outcomes are returned per market, in ESPN's order (favorites first); `outcomeCount` is the full book. An empty `markets` list means nothing is posted for that season yet.

Parameters: `sport`, `league`, optional `season`, and `raw`. Publishes an `outputSchema`.
