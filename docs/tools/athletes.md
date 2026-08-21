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

Returns compact game records containing date, opponent, home/away, result, score, and named statistics. It removes the large duplicate event/reference structures from ESPN's response.

Parameters: `sport`, `league`, `athleteId`, optional `season`, and `raw`.

## `get_athlete_splits`

Returns available split categories with labels and named statistics. Split availability varies significantly by sport and player.

Parameters: `sport`, `league`, `athleteId`, optional `season`, `seasonType`, and `raw`.
