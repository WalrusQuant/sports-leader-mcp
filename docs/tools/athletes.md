# Athletes

Tools for retrieving player data — overviews, season stats, game logs, and statistical splits. All four tools work best with **NFL, NBA, NHL, and MLB**. Coverage for other leagues varies depending on what ESPN exposes for that sport.

To find an `athleteId`, use [`search`](tools/discovery.md#search) with a player's name, or pull a roster via [`get_team`](tools/teams.md#get_team).

---

## get_athlete_overview

The best single-call view of a player. Returns a snapshot that combines season stats, next scheduled game, Rotowire injury/availability notes, and recent news headlines. Use this when you want a complete picture without making multiple tool calls.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug, e.g. `basketball`, `football` |
| `league` | string | Yes | League slug, e.g. `nba`, `nfl` |
| `athleteId` | string | Yes | ESPN athlete ID. Find via `search` or a team roster. |

### Example

Get an overview of Jayson Tatum (NBA):

```json
{
  "tool": "get_athlete_overview",
  "arguments": {
    "sport": "basketball",
    "league": "nba",
    "athleteId": "4065648"
  }
}
```

### Response

```json
{
  "athlete": {
    "id": "4065648",
    "fullName": "Jayson Tatum",
    "displayName": "Jayson Tatum",
    "shortName": "J. Tatum",
    "position": { "abbreviation": "SF" },
    "team": {
      "id": "2",
      "displayName": "Boston Celtics",
      "abbreviation": "BOS"
    },
    "jersey": "0",
    "age": 27,
    "birthPlace": { "city": "St. Louis", "state": "MO" },
    "experience": { "years": 8 },
    "status": { "type": "active", "name": "Active" }
  },
  "stats": {
    "season": 2025,
    "seasonType": 2,
    "categories": [
      {
        "name": "General",
        "labels": ["PTS", "REB", "AST", "STL", "BLK", "FG%", "3P%", "FT%"],
        "values": [27.4, 8.5, 4.9, 1.2, 0.6, 0.471, 0.374, 0.832]
      }
    ]
  },
  "nextGame": {
    "id": "401771824",
    "date": "2025-04-12T17:30Z",
    "name": "Boston Celtics at Miami Heat",
    "odds": {
      "spread": "-6.5",
      "overUnder": "218.5"
    }
  },
  "rotowire": {
    "status": "Active",
    "injury": null,
    "note": "Tatum is listed as probable with left ankle soreness but is expected to play Saturday."
  },
  "news": [
    {
      "headline": "Tatum drops 34 in win over Knicks",
      "published": "2025-04-10T22:15Z",
      "link": "https://www.espn.com/nba/story/_/id/..."
    },
    {
      "headline": "Celtics look to clinch division title this week",
      "published": "2025-04-09T18:00Z",
      "link": "https://www.espn.com/nba/story/_/id/..."
    }
  ]
}
```

---

## get_athlete_stats

Full season statistics for a player, organized into categories with human-readable labels and a glossary. Supports filtering by season year and season type. Works best for **NFL, NBA, NHL, MLB**.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug |
| `league` | string | Yes | League slug |
| `athleteId` | string | Yes | ESPN athlete ID |
| `season` | number | No | Season year, e.g. `2025`. Defaults to current season. |
| `seasonType` | number | No | `1` preseason, `2` regular season, `3` postseason, `4` offseason |

### Example

Get Jayson Tatum's 2025 regular-season stats:

```json
{
  "tool": "get_athlete_stats",
  "arguments": {
    "sport": "basketball",
    "league": "nba",
    "athleteId": "4065648",
    "season": 2025,
    "seasonType": 2
  }
}
```

### Response

```json
{
  "athlete": {
    "id": "4065648",
    "fullName": "Jayson Tatum"
  },
  "season": 2025,
  "seasonType": 2,
  "gamesPlayed": 74,
  "categories": [
    {
      "name": "Scoring",
      "labels": ["PTS", "FGM", "FGA", "FG%", "3PM", "3PA", "3P%", "FTM", "FTA", "FT%"],
      "values": [27.4, 9.8, 20.8, 0.471, 3.4, 9.1, 0.374, 4.4, 5.3, 0.832]
    },
    {
      "name": "Rebounding",
      "labels": ["REB", "OREB", "DREB"],
      "values": [8.5, 1.1, 7.4]
    },
    {
      "name": "Playmaking",
      "labels": ["AST", "TOV", "AST/TOV"],
      "values": [4.9, 2.8, 1.75]
    },
    {
      "name": "Defense",
      "labels": ["STL", "BLK", "PF"],
      "values": [1.2, 0.6, 2.1]
    },
    {
      "name": "Miscellaneous",
      "labels": ["MIN", "+/-", "PER", "TS%"],
      "values": [36.1, 5.2, 27.3, 0.598]
    }
  ],
  "glossary": {
    "PTS": "Points per game",
    "FGM": "Field goals made",
    "FGA": "Field goals attempted",
    "FG%": "Field goal percentage",
    "3PM": "Three-pointers made",
    "3PA": "Three-pointers attempted",
    "3P%": "Three-point percentage",
    "FTM": "Free throws made",
    "FTA": "Free throws attempted",
    "FT%": "Free throw percentage",
    "REB": "Rebounds per game",
    "OREB": "Offensive rebounds",
    "DREB": "Defensive rebounds",
    "AST": "Assists per game",
    "TOV": "Turnovers per game",
    "STL": "Steals per game",
    "BLK": "Blocks per game",
    "MIN": "Minutes per game",
    "PER": "Player efficiency rating",
    "TS%": "True shooting percentage"
  }
}
```

---

## get_athlete_gamelog

Game-by-game statistics for a player across a full season. Each entry in the log corresponds to one game with that game's raw stat line. Useful for spotting streaks, hot/cold stretches, or situational performance.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug |
| `league` | string | Yes | League slug |
| `athleteId` | string | Yes | ESPN athlete ID |
| `season` | number | No | Season year. Defaults to current season. |

### Example

Get a player's game log for the current season:

```json
{
  "tool": "get_athlete_gamelog",
  "arguments": {
    "sport": "basketball",
    "league": "nba",
    "athleteId": "4065648"
  }
}
```

### Response

```json
{
  "athlete": {
    "id": "4065648",
    "fullName": "Jayson Tatum"
  },
  "season": 2025,
  "labels": ["DATE", "OPP", "RESULT", "MIN", "PTS", "REB", "AST", "STL", "BLK", "FGM-FGA", "3PM-3PA", "FTM-FTA", "+/-"],
  "games": [
    {
      "gameId": "401771812",
      "date": "2025-04-08",
      "opponent": "vs NYK",
      "result": "W 114-103",
      "stats": [36, 34, 9, 6, 2, 1, "13-24", "4-9", "4-5", 11]
    },
    {
      "gameId": "401771798",
      "date": "2025-04-05",
      "opponent": "@ MIL",
      "result": "L 108-112",
      "stats": [38, 21, 7, 5, 0, 0, "8-22", "2-8", "3-4", -4]
    },
    {
      "gameId": "401771784",
      "date": "2025-04-03",
      "opponent": "vs PHI",
      "result": "W 121-99",
      "stats": [33, 29, 11, 3, 1, 2, "11-19", "3-7", "4-4", 18]
    }
  ],
  "totals": {
    "gamesPlayed": 74,
    "gamesStarted": 74,
    "avgMinutes": 36.1
  }
}
```

---

## get_athlete_splits

Statistical splits break down a player's performance by context — home vs. away, by month, by opponent conference, by win/loss, and more. Useful for identifying situational strengths and weaknesses.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug |
| `league` | string | Yes | League slug |
| `athleteId` | string | Yes | ESPN athlete ID |
| `season` | number | No | Season year. Defaults to current season. |
| `seasonType` | number | No | `1` preseason, `2` regular season, `3` postseason, `4` offseason |

### Example

Get home/away and situational splits for the current season:

```json
{
  "tool": "get_athlete_splits",
  "arguments": {
    "sport": "basketball",
    "league": "nba",
    "athleteId": "4065648",
    "season": 2025,
    "seasonType": 2
  }
}
```

### Response

```json
{
  "athlete": {
    "id": "4065648",
    "fullName": "Jayson Tatum"
  },
  "season": 2025,
  "seasonType": 2,
  "labels": ["GP", "PTS", "REB", "AST", "FG%", "3P%", "FT%"],
  "splitCategories": [
    {
      "name": "Home/Away",
      "splits": [
        {
          "name": "Home",
          "values": [37, 28.9, 8.8, 5.1, 0.483, 0.391, 0.841]
        },
        {
          "name": "Away",
          "values": [37, 25.9, 8.2, 4.7, 0.459, 0.357, 0.823]
        }
      ]
    },
    {
      "name": "Win/Loss",
      "splits": [
        {
          "name": "Wins",
          "values": [48, 29.1, 8.9, 5.3, 0.488, 0.392, 0.845]
        },
        {
          "name": "Losses",
          "values": [26, 24.2, 7.8, 4.2, 0.440, 0.341, 0.811]
        }
      ]
    },
    {
      "name": "By Month",
      "splits": [
        {
          "name": "October",
          "values": [6, 24.5, 7.9, 4.5, 0.451, 0.360, 0.810]
        },
        {
          "name": "November",
          "values": [14, 26.8, 8.1, 4.8, 0.465, 0.372, 0.828]
        },
        {
          "name": "December",
          "values": [15, 27.2, 8.6, 5.0, 0.472, 0.378, 0.835]
        },
        {
          "name": "January",
          "values": [13, 28.0, 8.7, 5.2, 0.478, 0.382, 0.840]
        },
        {
          "name": "February",
          "values": [11, 27.9, 8.4, 4.9, 0.474, 0.370, 0.830]
        },
        {
          "name": "March/April",
          "values": [15, 28.8, 9.1, 5.1, 0.481, 0.388, 0.838]
        }
      ]
    },
    {
      "name": "By Opponent Conference",
      "splits": [
        {
          "name": "vs. Eastern Conference",
          "values": [42, 27.1, 8.3, 4.8, 0.470, 0.373, 0.831]
        },
        {
          "name": "vs. Western Conference",
          "values": [32, 27.8, 8.8, 5.1, 0.473, 0.376, 0.834]
        }
      ]
    }
  ]
}
```
