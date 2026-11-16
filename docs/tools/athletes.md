# Athlete tools

Resolve `athleteId` with `search`, then call the narrowest tool. All tools accept optional `raw: true`.

## `get_athlete_overview`

Player snapshot containing ESPN's available current stats, next game, notes, and news after recursive removal of references, images, and UI metadata. The remaining shape varies by sport.

Parameters: `sport`, `league`, `athleteId`, and optional `raw`.

## `get_athlete_stats`

Season statistics normalized from ESPN's positional arrays into named `stats` objects.

Parameters: `sport`, `league`, `athleteId`, optional `season`, `seasonType`, and `raw`.

Compact shape:

```json
{
  "categories": [{
    "name": "passing",
    "labels": ["CMP", "ATT", "YDS"],
    "seasons": [{
      "season": "2025",
      "team": { "id": "12", "abbrev": "GB", "name": "Packers" },
      "stats": { "CMP": "350", "ATT": "520", "YDS": "4100" }
    }]
  }]
}
```

## `get_athlete_gamelog`

Returns compact game records containing date, opponent, home/away, result, score, and named statistics. Each record carries `eventId` for joining with game tools. It removes the large duplicate event/reference structures from ESPN's response. Publishes an MCP `outputSchema`.

Parameters: `sport`, `league`, `athleteId`, optional `season`, and `raw`.

## `get_athlete_splits`

Returns available split categories with labels and named statistics. Split availability varies significantly by sport and player.

Parameters: `sport`, `league`, `athleteId`, optional `season`, `seasonType`, and `raw`.

## `get_player_report`

One call for how a player has looked lately. `player` is a name or an ESPN athlete id. A name is resolved with search and kept inside `league`. One match is used. More than one match in that league returns `candidates` and does not guess. Search for "josh jacobs" returns more than one player; `league=nfl` resolves to athlete `4047365`.

`include` defaults to `season`, `recent`, and `splits`. `season` is named stats for `season` (or the latest year in the document). `recent` is the last `lastN` gamelog rows, most recent first (default 5). `splits` is the split list ESPN publishes, with named stat fields. One of those blocks failing is reported in `errors` and the others are still returned. `sources` names the documents that were requested. Publishes an MCP `outputSchema`.

Parameters: `sport`, `league`, `player`, optional `season`, `lastN`, `include`, and `raw`.

```json
{
  "resolved": true,
  "athlete": { "id": "4047365", "name": "Josh Jacobs", "team": "GB", "position": "RB" },
  "season": { "year": 2026, "categories": [{ "name": "rushing", "stats": { "CAR": "36", "YDS": "80" } }] },
  "recent": [{ "eventId": "401873049", "date": "2026-11-08T21:25:00.000+00:00", "opponent": "NE", "homeAway": "A", "result": "W", "score": "45-27", "stats": { "CAR": "12" } }],
  "splits": { "categories": [{ "name": "Location", "splits": [{ "label": "Home", "stats": { "CAR": "20" } }] }] },
  "sources": [{ "block": "gamelog", "path": "/apis/common/v3/sports/football/nfl/athletes/4047365/gamelog" }]
}
```
