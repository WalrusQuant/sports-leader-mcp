# League-wide tools

All tools return compact JSON by default and accept optional `raw: true`.

## `get_standings`

Returns standings grouped by conference/division. Each entry has compact team identity plus a named `stats` object instead of ESPN's repeated stat metadata.

Parameters: `sport`, `league`, optional `season`, and `raw`.

## `get_league_leaders`

Returns named statistical categories with ranked leader values. ESPN Core sometimes provides athlete references without names; compact output extracts `athleteId` from those references so the caller can use athlete tools to resolve details.

Parameters: `sport`, `league`, optional `season`, and `raw`.

## `get_injuries`

Returns league injuries grouped by team. It filters `Active`/news-only records and keeps player, team, position, status, injury detail, return date, report date, and a note capped at 140 characters.

Parameters: `sport`, `league`, and optional `raw`.

This endpoint is not available for every sport; ESPN commonly returns an upstream error for MMA, tennis, and golf.

## `get_transactions`

Returns ESPN's transaction structure after recursive removal of image/reference/UI fields. The exact shape varies by league.

Parameters: `sport`, `league`, and optional `raw`.

## `get_news`

Returns a compact headline list with ID, type, headline, description, publication time, source, keywords, and article link.

Parameters: optional `sport`, `league`, team abbreviation as `team`, `limit`, and `raw`.
