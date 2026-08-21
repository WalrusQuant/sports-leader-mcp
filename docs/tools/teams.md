# Team tools

All tools return compact JSON by default and accept optional `raw: true`.

## `get_teams`

Lists teams as compact identity records. Fields can include `id`, `abbrev`, `name`, `displayName`, `location`, and `venue`. Images, colors, and navigation links are removed.

Parameters: `sport`, `league`, and optional `raw`.

Use the returned `id` as `teamId` in team-scoped tools.

## `get_team`

Fetches one team view.

Parameters:

- `sport`, `league`, `teamId`
- `view`: `detail`, `roster`, `schedule`, `record`, `depthcharts`, `injuries`, `transactions`, `history`, `news`, or `leaders`
- `raw` (optional)

The compact transform removes ESPN references, image variants, and UI metadata. Roster athletes are normalized to `id`, `name`, `position`, and `jersey`. Other views preserve their ESPN structure after reference stripping, so their exact fields vary by sport.

Prefer `get_team_injuries` over `get_team(view="injuries")` when you need the normalized injury shape.

## `get_team_injuries`

Returns actual injury entries for one team and filters ESPN's `Active` news-only records. Fields can include player, position, status, injury detail, return date, report date, and a capped note.

Parameters: `sport`, `league`, `teamId`, and optional `raw`.
