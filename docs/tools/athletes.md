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

ESPN's gamelog is one flat label list. Football publishes the same abbreviation under more than one category (`YDS`, `AVG`, `TD`, and `LNG` for rushing and receiving, and the same four for passing and rushing). Those stats are nested by category so both values stay. `categories` names each group and the keys inside it. `labels` is still ESPN's flat header, duplicates included.

A log with no category counts stays a flat `stats` map. Checked 2026-11-16: MLB batting and pitching are separate documents, each with unique labels; NBA box lines and NHL skater and goalie lines are unique too. A label repeated inside one category gets a `_2` suffix. `get_player_report`'s `recent` games use this same stat shape.

Parameters: `sport`, `league`, `athleteId`, optional `season`, and `raw`.

Josh Jacobs (NFL id `4047365`) at Detroit on 2026-10-25:

```json
{
  "labels": ["CAR", "YDS", "AVG", "TD", "LNG", "REC", "TGTS", "YDS", "AVG", "TD", "LNG", "FUM", "LST", "FF", "KB"],
  "categories": [
    { "name": "rushing", "displayName": "Rushing", "labels": ["CAR", "YDS", "AVG", "TD", "LNG"] },
    { "name": "receiving", "displayName": "Receiving", "labels": ["REC", "TGTS", "YDS", "AVG", "TD", "LNG"] },
    { "name": "fumbles", "displayName": "Fumbles", "labels": ["FUM", "LST", "FF", "KB"] }
  ],
  "games": [{
    "eventId": "401873020",
    "date": "2026-10-25T20:25:00.000+00:00",
    "opponent": "DET",
    "homeAway": "A",
    "result": "L",
    "score": "20-17",
    "stats": {
      "rushing": { "CAR": "11", "YDS": "36", "AVG": "3.3", "TD": "0", "LNG": "10" },
      "receiving": { "REC": "5", "TGTS": "7", "YDS": "55", "AVG": "11.0", "TD": "1", "LNG": "25" },
      "fumbles": { "FUM": "0", "LST": "0", "FF": "-", "KB": "-" }
    }
  }]
}
```

## `get_athlete_splits`

Returns available split categories with labels and named statistics. Split availability varies significantly by sport and player.

Parameters: `sport`, `league`, `athleteId`, optional `season`, `seasonType`, and `raw`.

## `get_player_report`

One call for how a player has looked lately. `player` is a name or an ESPN athlete id. A name is resolved with search and kept inside `league`. One match is used. More than one match in that league returns `candidates` and does not guess. Search for "josh jacobs" returns more than one player; `league=nfl` resolves to athlete `4047365`.

`include` defaults to `season`, `recent`, and `splits`. `season` is the season stat line ESPN publishes for that year (or the latest year in the document). `recent` is the last `lastN` gamelog rows, most recent first (default 5), with the same stat shape as [`get_athlete_gamelog`](#get_athlete_gamelog). A label ESPN repeats, such as `YDS` for rushing and receiving, is nested under its category so both values stay. `splits` is the split list ESPN publishes, with named stat fields. One of those blocks failing is reported in `errors` and the others are still returned. `sources` names the documents that were requested. Publishes an MCP `outputSchema`.

Parameters: `sport`, `league`, `player`, optional `season`, `lastN`, `include`, and `raw`.

```json
{
  "resolved": true,
  "athlete": { "id": "4047365", "name": "Josh Jacobs", "team": "GB", "position": "RB" },
  "season": { "year": 2026, "categories": [{ "name": "rushing", "stats": { "CAR": "36", "YDS": "80" } }] },
  "recent": [{
    "eventId": "401873020",
    "date": "2026-10-25T20:25:00.000+00:00",
    "opponent": "DET",
    "homeAway": "A",
    "result": "L",
    "score": "20-17",
    "stats": {
      "rushing": { "CAR": "11", "YDS": "36", "TD": "0" },
      "receiving": { "REC": "5", "TGTS": "7", "YDS": "55", "TD": "1" }
    }
  }],
  "splits": { "categories": [{ "name": "Location", "splits": [{ "label": "Home", "stats": { "CAR": "20" } }] }] },
  "sources": [{ "block": "gamelog", "path": "/apis/common/v3/sports/football/nfl/athletes/4047365/gamelog" }]
}
```

The 2026 rushing line above is ESPN's regular-season total: 3 games, 36 carries, 80 yards. The 2025 line on the same document is 15 games, 234 carries, 929 yards. ESPN also publishes a projected pace; the report uses the regular-season row.
