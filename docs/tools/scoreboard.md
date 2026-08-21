# Scoreboard and game tools

All tools return compact JSON by default and accept optional `raw: true`.

## `get_scoreboard`

Entry point for games. Returns event IDs, dates, status, teams, final/current scores, period scores, records, and venue.

Parameters: `sport`, `league`, optional `date` (`YYYYMMDD`), `dateRange` (`YYYYMMDD-YYYYMMDD`), `week`, `seasonType`, and `raw`.

Compact shape:

```json
{
  "date": "20260821",
  "events": [{
    "id": "401873285",
    "date": "2026-08-21T02:00Z",
    "name": "SF @ LAC",
    "status": { "state": "post", "detail": "Final" },
    "competitors": [{
      "homeAway": "home",
      "team": { "id": "24", "abbrev": "LAC", "name": "Chargers" },
      "score": "17",
      "linescores": ["0", "3", "6", "8"]
    }]
  }]
}
```

## `get_game_summary`

The richest compact single-game call. Returns:

- Game ID, date, status, competitors, scores, and period scores
- Team statistics and player box-score categories
- Leaders grouped by team and category
- All scoring plays plus the 20 most recent plays
- Up to 25 sampled win-probability points
- Venue/game information, broadcasts, and standings context when ESPN supplies them

Parameters: `sport`, `league`, `eventId`, and optional `raw`.

Use `get_game_plays` for every play and `get_game_probabilities` for the full probability timeline.

## `get_game_plays`

Returns compact play records with `id`, sequence, period, game clock, wall clock, type, text, scoring flag, running score, team ID, and participant IDs when supplied.

Parameters: `sport`, `league`, `eventId`, optional `limit` (default `400`), and `raw`.

## `get_game_odds`

Returns one compact record per provider: provider, favorite, spread, total, moneylines, prices, and available open/current line fields.

Parameters: `sport`, `league`, `eventId`, optional `providerId`, and `raw`.

Provider IDs are available at `sports://reference/betting-providers`.

## `get_game_probabilities`

Returns the full compact probability series as `{ playId, homeWinPct, awayWinPct }` records.

Parameters: `sport`, `league`, `eventId`, optional `limit` (default `200`), and `raw`.
