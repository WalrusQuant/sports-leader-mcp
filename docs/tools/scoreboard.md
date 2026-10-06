# Scoreboard and game tools

All tools return compact JSON by default and accept optional `raw: true`. `get_scoreboard`, `get_game_summary`, `get_game_odds`, and `get_slate` publish an MCP `outputSchema`.

## `get_scoreboard`

Entry point for games. Returns event IDs, dates, status, teams, final/current scores, period scores, records, and venue. When ESPN lists odds for an event, it also includes an `odds` block (`markets` + `consensus`) using the normalized fields described under `get_game_odds`.

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

When ESPN lists odds (pickcenter), the summary also includes an `odds` block with the normalized fields described under `get_game_odds`. After the text block, the result carries `resource_link` items for `espn://{sport}/{league}/game/{eventId}/plays`, `/probabilities`, `/odds`, and `espn://{sport}/{league}/injuries`; reading one returns the same compact JSON as the matching tool. Links are omitted in `raw` mode and on truncation envelopes.

## `get_game_plays`

Returns compact play records with `id`, sequence, period, game clock, wall clock, type, text, scoring flag, running score, team ID, and participant IDs when supplied.

Parameters: `sport`, `league`, `eventId`, optional `limit` (default `400`), and `raw`.

## `get_game_odds`

Returns event identity plus one record per provider. Each record keeps the original fields (provider, details, spread, overUnder, prices, home/away, open/current) and adds normalized numbers for comparison with prediction-market prices.

Parameters: `sport`, `league`, `eventId`, optional `providerId`, and `raw`. Compact mode makes one extra small, cached core-API event call to get the start time and team abbreviations.

Compact shape (abridged):

```json
{
  "eventId": "401872980",
  "startUtc": "2026-10-09T00:15Z",
  "homeTeam": { "id": "6", "abbrev": "DAL" },
  "awayTeam": { "id": "27", "abbrev": "TB" },
  "consensus": { "providerCount": 1, "providers": ["Draft Kings"], "homeNoVigProb": 0.7958, "awayNoVigProb": 0.2042, "drawNoVigProb": null, "homeSpread": -9.5, "total": 47.5, "method": "...", "reason": null },
  "spreadConvention": "homeSpread is the home team's spread: negative means the home team is favored ...",
  "odds": [{
    "provider": "Draft Kings", "details": "DAL -9.5", "spread": -9.5, "overUnder": 47.5,
    "home": { "favorite": true, "moneyLine": -485 }, "away": { "favorite": false, "moneyLine": 370 },
    "providerId": "100", "threeWay": false,
    "homeMoneyLine": -485, "awayMoneyLine": 370, "drawMoneyLine": null,
    "homeImpliedProb": 0.8291, "awayImpliedProb": 0.2128,
    "homeNoVigProb": 0.7958, "awayNoVigProb": 0.2042, "overround": 0.0418,
    "noVigReason": null, "homeSpread": -9.5, "total": 47.5
  }]
}
```

Soccer markets are three-way: `drawMoneyLine`, `drawImpliedProb`, and `drawNoVigProb` are filled in, and the no-vig split covers all three outcomes. When a price is missing, the no-vig fields are `null` and `noVigReason` explains why.

Provider IDs are available at `sports://reference/betting-providers`.

## `get_game_probabilities`

Returns the full compact probability series as `{ playId, homeWinPct, awayWinPct }` records.

Parameters: `sport`, `league`, `eventId`, optional `limit` (default `200`), and `raw`.

## `get_slate`

One call per game day. Returns every game with `eventId`, `startUtc`, `name`, `status`, `neutralSite`, `home`/`away` (`id`, `abbrev`, `name`, `record`, `score` — `null` before start — `keyInjuries`, `otherInjuryCount`), and `odds` (consensus `homeNoVigProb`/`awayNoVigProb`/`drawNoVigProb`, first provider's moneylines, `homeSpread`, `total`, `reason` when there are no odds).

Parameters: `sport`, `league`, optional `date` (`YYYYMMDD`, ESPN's US-Eastern game day; omit for the current slate), optional `includeInjuries` (default `true`), and `raw`.

`keyInjuries` lists players marked `Out` or `Doubtful` (up to 12 per team). It is `null` when the injury report is unavailable, and `injuriesNote` explains why. ESPN returns empty injury reports for some leagues (for example EPL and NCAAF); `injuriesNote` flags that too. Upstream cost is two cached calls: the scoreboard and the league injury report.

`get_slate` adds a `resource_link` to `espn://{sport}/{league}/injuries`. The slate itself is also readable as `espn://{sport}/{league}/slate/{date}`.
