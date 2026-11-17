# Prediction markets

Keyless prices from Kalshi, Polymarket (global), and Polymarket US. No API key is read or sent. All three tools return compact JSON, accept `raw`, and publish an MCP `outputSchema`.

Venues are listed side by side and are never averaged. A venue with no listing is `{ "venue": "...", "status": "no market found" }`. If one venue returns an error, the others are still returned. `fetchedAt` is when the response was built. `matchedBy` says how a game was tied to a venue. `averaged` is always `false`.

## `get_kalshi_markets`

Open markets for one league.

Parameters: `league`, optional `date` (`YYYYMMDD`), optional `team`, optional `market` (`winner` default, `spread`, `total`), optional `includeBook`, and `raw`.

`winner` uses the game series (`KXNFLGAME`, `KXNBAGAME`, `KXMLBGAME`, `KXNHLGAME`, `KXNCAAFGAME`, `KXNCAAMBGAME`, `KXNCAAWBGAME`). Spreads and totals are the NFL and NBA series (`KXNFLSPREAD`, `KXNFLTOTAL`, `KXNBASPREAD`, `KXNBATOTAL`). The series list is fixed. The tool does not call Kalshi's sports series catalog.

Prices are the `*_dollars` fields and are labelled `priceSource: "dollars"`. `includeBook` adds the top of book. Kalshi's book is bids only, so the yes ask is `1 - best no bid`, labelled `priceSource: "orderbook"`.

Event tickers look like `KXNFLGAME-26NOV15MINGB`: the original scheduled date, then the away code, then the home code. A spread or total suffix can end in the line (`NOP9`). The date still comes from the ticker. A postponed game keeps that original date, so a date filter uses the ticker date. Each side includes the team name, not only the code.

## `get_polymarket_markets`

Polymarket global (Gamma + CLOB) and Polymarket US.

Parameters: `league`, optional `date`, optional `team`, optional `marketType` (default `moneyline`; `winner`, `spread`/`spreads`, and `total`/`totals` are accepted), optional `venue` (`both` default, `polymarket`, or `polymarket_us`), optional `includeBook`, and `raw`.

`venue=both` returns two labelled entries. Gamma `outcomes` and `clobTokenIds` are JSON strings and are decoded. Default prices are `gamma_outcome_prices`. `includeBook` uses the CLOB book and labels those prices `clob_book`. The buy-side `/price` endpoint is not used as an ask.

Global slugs use the UTC date (`nfl-pit-cin-2026-11-17`). Gamma `eventDate` and `usId` use the local date. When `eventDate` is present, a date filter uses only that date, so a previous night's game whose UTC date has already rolled over stays on its own day. The US slug is `aec-` plus `usId` when Gamma sends one. When `usId` is missing, it is `aec-{sport}-{away}-{home}-{eventDate}`, trying Gamma and ESPN codes and the swapped order. Past events can still arrive with `active=true`; they are dropped using `eventDate` and `startTime`. A team filter is an exact code, alias, or name.

## `get_market_odds`

Match one ESPN game to every venue.

Parameters: `sport`, `league`, optional `eventId`, optional `team`, optional `date`, optional `venue` (`all` default, or one of `kalshi`, `polymarket`, `polymarket_us`), and `raw`.

With no `eventId` and no `team`, the first game on the scoreboard is used. A team that matches more than one game returns an error asking for `eventId`. Matching uses team codes through the alias table and team names, and accepts either home/away order. Prices stay attached to the team. Men's and women's college basketball use the Division I scoreboard. Kalshi can match when the ticker date is the original date and ESPN has moved the game. Polymarket can match on `eventDate` even when the slug date is the UTC date.

The winner/moneyline is the market compared here.

```json
{
  "sport": "football",
  "league": "nfl",
  "eventId": "401772959",
  "fetchedAt": "2026-11-16T21:40:00.000Z",
  "matchedBy": "eventId",
  "averaged": false,
  "game": {
    "name": "Philadelphia Eagles at Jacksonville Jaguars",
    "startUtc": "2026-10-11T13:30Z",
    "easternDate": "2026-10-11",
    "away": { "abbrev": "PHI" },
    "home": { "abbrev": "JAX" }
  },
  "venues": [
    { "venue": "kalshi", "status": "ok", "matchedBy": "teams+scheduledDate" },
    { "venue": "polymarket", "status": "ok", "matchedBy": "teams+eventDate" },
    { "venue": "polymarket_us", "status": "ok", "matchedBy": "teams+eventDate+usId", "slug": "aec-nfl-phi-jax-2026-10-11", "usId": "nfl-phi-jax-2026-10-11" }
  ]
}
```

## Team codes

ESPN, Kalshi, and Gamma do not share abbreviations. Identity is the default. The alias table covers the ones that differ, including:

| ESPN | Kalshi | Gamma |
|------|--------|-------|
| JAX | JAC | jax |
| LAR | LA | la |
| WSH (NFL) | WAS | was |
| GS | GSW | gsw |
| NO | NOP | nop |
| NY | NYK | nyk |
| SA | SAS | sas |
| UTAH (NBA) | UTA | uta |
| MTL | MTL | mon |
| WIS | WIS | wisc |

College teams also match on the school name when the code is not in the table.
