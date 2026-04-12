# Scoreboard & Games

Tools for retrieving live scores, game summaries, play-by-play data, betting odds, and win probability. Start with `get_scoreboard` to find event IDs, then pass those IDs into the other tools.

---

## get_scoreboard

Get live and scheduled games for a sport and league. Returns event IDs, scores, status, teams, start times, and venue. Use this as the entry point for finding games — other tools take the `eventId` returned here.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug, e.g. `basketball`, `football` |
| `league` | string | Yes | League slug, e.g. `nba`, `nfl` |
| `date` | string | No | Single date in `YYYYMMDD` format, e.g. `20250315` |
| `dateRange` | string | No | Date range in `YYYYMMDD-YYYYMMDD` format, e.g. `20250301-20250331` |
| `week` | number | No | Week number (football only) |
| `seasonType` | number | No | `1`=preseason, `2`=regular, `3`=postseason, `4`=offseason |

### Example

Get NBA scores for March 15, 2025:

```json
{
  "sport": "basketball",
  "league": "nba",
  "date": "20250315"
}
```

### Response Snippet

```json
{
  "events": [
    {
      "id": "401767856",
      "name": "Boston Celtics at Los Angeles Lakers",
      "shortName": "BOS @ LAL",
      "date": "2025-03-15T23:30Z",
      "status": {
        "type": {
          "name": "STATUS_FINAL",
          "description": "Final",
          "completed": true
        },
        "displayClock": "0:00",
        "period": 4
      },
      "competitions": [
        {
          "venue": {
            "fullName": "Crypto.com Arena",
            "city": "Los Angeles",
            "state": "CA"
          },
          "competitors": [
            {
              "id": "13",
              "team": { "abbreviation": "LAL", "displayName": "Los Angeles Lakers" },
              "homeAway": "home",
              "score": "114",
              "winner": true
            },
            {
              "id": "2",
              "team": { "abbreviation": "BOS", "displayName": "Boston Celtics" },
              "homeAway": "away",
              "score": "108",
              "winner": false
            }
          ],
          "broadcasts": [
            { "names": ["ESPN"] }
          ]
        }
      ]
    }
  ]
}
```

---

## get_game_summary

Full game summary — boxscore, plays, leaders, broadcasts, standings context, and win probability. The richest single-call view of one game.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug, e.g. `basketball`, `football` |
| `league` | string | Yes | League slug, e.g. `nba`, `nfl` |
| `eventId` | string | Yes | ESPN event ID returned by `get_scoreboard` |

### Example

Get the full summary for NBA event `401767856`:

```json
{
  "sport": "basketball",
  "league": "nba",
  "eventId": "401767856"
}
```

### Response Snippet

```json
{
  "boxscore": {
    "teams": [
      {
        "team": { "abbreviation": "LAL", "displayName": "Los Angeles Lakers" },
        "statistics": [
          { "name": "points", "displayValue": "114" },
          { "name": "rebounds", "displayValue": "44" },
          { "name": "assists", "displayValue": "27" },
          { "name": "fieldGoalPct", "displayValue": "49.4" },
          { "name": "threePointPct", "displayValue": "38.5" }
        ]
      }
    ],
    "players": [
      {
        "team": { "abbreviation": "LAL" },
        "statistics": [
          {
            "athletes": [
              {
                "athlete": { "displayName": "LeBron James", "id": "1966" },
                "stats": ["28", "8", "10", "2", "1", "+12"]
              }
            ],
            "labels": ["PTS", "REB", "AST", "STL", "BLK", "+/-"]
          }
        ]
      }
    ]
  },
  "leaders": [
    {
      "team": { "abbreviation": "LAL" },
      "leaders": [
        {
          "name": "points",
          "leaders": [
            {
              "displayValue": "28 PTS",
              "athlete": { "displayName": "LeBron James" }
            }
          ]
        }
      ]
    }
  ],
  "broadcasts": [
    { "market": "National", "names": ["ESPN"] }
  ],
  "winprobability": [
    { "tiePercentage": 0, "homeWinPercentage": 0.712, "awayWinPercentage": 0.288, "playId": "4017678561450" }
  ],
  "standings": {
    "groups": [
      {
        "standings": {
          "entries": [
            {
              "team": "Los Angeles Lakers",
              "stats": [
                { "name": "wins", "displayValue": "43" },
                { "name": "losses", "displayValue": "28" },
                { "name": "gamesBehind", "displayValue": "4.5" }
              ]
            }
          ]
        }
      }
    ]
  }
}
```

---

## get_game_plays

Full play-by-play data from the Core API. For long games pass a high `limit` (e.g. `400`) to ensure you receive all plays.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug, e.g. `basketball`, `football` |
| `league` | string | Yes | League slug, e.g. `nba`, `nfl` |
| `eventId` | string | Yes | ESPN event ID returned by `get_scoreboard` |
| `limit` | number | No | Max plays to return. Default `400`. |

### Example

Get all plays for NBA event `401767856`:

```json
{
  "sport": "basketball",
  "league": "nba",
  "eventId": "401767856",
  "limit": 400
}
```

### Response Snippet

```json
{
  "count": 387,
  "pageIndex": 1,
  "pageSize": 400,
  "items": [
    {
      "id": "4017678560001",
      "sequenceNumber": "1",
      "type": { "id": "574", "text": "Jump Ball" },
      "text": "LeBron James vs. Jayson Tatum (Anthony Davis gains possession)",
      "awayScore": 0,
      "homeScore": 0,
      "period": { "number": 1, "displayValue": "1st" },
      "clock": { "displayValue": "12:00" },
      "wallclock": "2025-03-15T23:31:04Z",
      "participants": [
        { "athlete": { "id": "1966", "displayName": "LeBron James" }, "type": "jumper" }
      ]
    },
    {
      "id": "4017678560012",
      "sequenceNumber": "12",
      "type": { "id": "558", "text": "Three Point Jumper" },
      "text": "Austin Reaves makes three point jumper",
      "awayScore": 0,
      "homeScore": 3,
      "period": { "number": 1, "displayValue": "1st" },
      "clock": { "displayValue": "11:14" },
      "scoringPlay": true,
      "participants": [
        { "athlete": { "id": "4432174", "displayName": "Austin Reaves" }, "type": "shooter" }
      ]
    }
  ]
}
```

---

## get_game_odds

Betting odds for a game — spread, moneyline, and over/under. Optionally filter by sportsbook using a `providerId`.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug, e.g. `basketball`, `football` |
| `league` | string | Yes | League slug, e.g. `nba`, `nfl` |
| `eventId` | string | Yes | ESPN event ID returned by `get_scoreboard` |
| `providerId` | number | No | Filter to a specific sportsbook: `38`=Caesars, `37`=FanDuel, `41`=DraftKings, `58`=BetMGM, `68`=ESPN BET, `2000`=Bet365 |

### Example

Get DraftKings odds for NBA event `401767856`:

```json
{
  "sport": "basketball",
  "league": "nba",
  "eventId": "401767856",
  "providerId": 41
}
```

### Response Snippet

```json
{
  "items": [
    {
      "provider": {
        "id": "41",
        "name": "DraftKings",
        "priority": 1
      },
      "details": "-4.5",
      "overUnder": 224.5,
      "spread": 4.5,
      "awayTeamOdds": {
        "favorite": false,
        "underdog": true,
        "moneyLine": 165,
        "spreadOdds": -110,
        "team": { "abbreviation": "BOS", "displayName": "Boston Celtics" }
      },
      "homeTeamOdds": {
        "favorite": true,
        "underdog": false,
        "moneyLine": -195,
        "spreadOdds": -110,
        "team": { "abbreviation": "LAL", "displayName": "Los Angeles Lakers" }
      },
      "overOdds": -110,
      "underOdds": -110,
      "open": {
        "over": { "value": 223.5, "displayValue": "o223.5 -110" },
        "under": { "value": 223.5, "displayValue": "u223.5 -110" },
        "spread": { "value": -5.5, "displayValue": "-5.5 -110" }
      }
    }
  ]
}
```

---

## get_game_probabilities

Win probability timeline showing each team's probability of winning at each play throughout the game.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug, e.g. `basketball`, `football` |
| `league` | string | Yes | League slug, e.g. `nba`, `nfl` |
| `eventId` | string | Yes | ESPN event ID returned by `get_scoreboard` |
| `limit` | number | No | Max data points to return. Default `200`. |

### Example

Get win probability data for NBA event `401767856`:

```json
{
  "sport": "basketball",
  "league": "nba",
  "eventId": "401767856",
  "limit": 200
}
```

### Response Snippet

```json
{
  "count": 387,
  "pageIndex": 1,
  "pageSize": 200,
  "items": [
    {
      "playId": "4017678560001",
      "sequenceNumber": "1",
      "homeWinPercentage": 0.523,
      "awayWinPercentage": 0.477,
      "tiePercentage": 0,
      "lastModified": "2025-03-15T23:31:04Z"
    },
    {
      "playId": "4017678561200",
      "sequenceNumber": "200",
      "homeWinPercentage": 0.681,
      "awayWinPercentage": 0.319,
      "tiePercentage": 0,
      "lastModified": "2025-03-16T00:14:22Z"
    },
    {
      "playId": "4017678561450",
      "sequenceNumber": "387",
      "homeWinPercentage": 1.0,
      "awayWinPercentage": 0.0,
      "tiePercentage": 0,
      "lastModified": "2025-03-16T01:42:08Z"
    }
  ]
}
```
