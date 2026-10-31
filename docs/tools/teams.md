# Team tools

All tools return compact JSON by default and accept optional `raw: true`.

## `get_teams`

Lists teams as compact identity records. Fields can include `id`, `abbrev`, `name`, `displayName`, `location`, and `venue`. Images, colors, and navigation links are removed.

Parameters: `sport`, `league`, and optional `raw`.

The Site teams endpoint defaults to 50 rows. That is a full NBA or NFL list and only the first page of college football and college basketball, so this tool requests `limit=1000`.

Use the returned `id` as `teamId` in team-scoped tools.

## `get_team`

Fetches one team view.

Parameters:

- `sport`, `league`, `teamId`
- `view`: `detail`, `roster`, `schedule`, `record`, `depthcharts`, `injuries`, `transactions`, `history`, `news`, or `leaders`
- optional `season` (used by `schedule` and `leaders`)
- `raw` (optional)

Roster athletes are `id`, `name`, `position`, and `jersey`. Schedule is one row per game (`eventCount`, `events`). Depth charts are formation → position → ordered athletes. Several Site sub-resources return an empty document (`{}`); those views are served from endpoints that still have data:

| view | Source |
|------|--------|
| `record` | `record` on the team detail document |
| `injuries` | League injury report, filtered to this team |
| `news` | League news feed, kept when the article is tagged with this team |
| `transactions` | League transactions with `team={teamId}` |
| `leaders` | Core `/seasons/{year}/types/{type}/teams/{teamId}/leaders` |
| `history` | Core franchise identity plus the current record. ESPN's `/history` path is empty, and season-by-season franchise history is not on the public API. The response includes a `note`. |
| `schedule` | Site schedule. An empty document (college basketball preseason, or an MLB postseason the team is not in) is retried as the regular season (`seasontype=2`). |

Prefer `get_team_injuries` over `get_team(view="injuries")` when you need the normalized injury shape. Prefer `get_team_stats` for the team stat line; `leaders` is the top player in each category.

## `get_team_stats`

Team season totals. Splits (home/away, month, and the rest) are omitted — that document is hundreds of kilobytes for MLB. Categories and abbreviations vary by sport. Soccer's Site statistics document is often an empty `results` object; standings and `get_athlete_stats` are the useful sources there.

Parameters: `sport`, `league`, `teamId`, optional `season`, and `raw`. Publishes an `outputSchema`.

## `get_team_injuries`

Returns actual injury entries for one team and filters ESPN's `Active` news-only records. Fields can include player, position, status, injury detail, return date, report date, and a capped note.

Parameters: `sport`, `league`, `teamId`, and optional `raw`.

ESPN's per-team injuries URL returns `{}`. This tool filters the league injury report by `teamId` instead, and drops `Active` news-only rows. An empty `injuries` list means the league report has no qualifying rows for that team.
