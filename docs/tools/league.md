# League-Wide

Tools for league-wide data: standings, statistical leaders, injuries, transactions, and news.

## get_standings

Get league standings. Uses the correct `/apis/v2/` path (the `/site/v2/` path returns a stub — this is a known gotcha the server handles for you).

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug (e.g. `"basketball"`, `"football"`). |
| `league` | string | Yes | League slug (e.g. `"nba"`, `"nfl"`). |
| `season` | number | No | Season year (e.g. `2025`). Defaults to the current season. |

### Example

Get 2025 NBA standings:

```json
{
  "sport": "basketball",
  "league": "nba",
  "season": 2025
}
```

### Response

```json
{
  "season": 2025,
  "league": "nba",
  "groups": [
    {
      "name": "Eastern Conference",
      "standings": [
        {
          "team": "Cleveland Cavaliers",
          "abbreviation": "CLE",
          "wins": 64,
          "losses": 18,
          "winPercent": 0.78,
          "gamesBehind": 0,
          "conferenceRecord": "34-6",
          "homeRecord": "33-8",
          "awayRecord": "31-10",
          "streak": "W3"
        },
        {
          "team": "Boston Celtics",
          "abbreviation": "BOS",
          "wins": 61,
          "losses": 21,
          "winPercent": 0.744,
          "gamesBehind": 3,
          "conferenceRecord": "32-8",
          "homeRecord": "32-9",
          "awayRecord": "29-12",
          "streak": "L1"
        },
        "... more teams"
      ]
    },
    {
      "name": "Western Conference",
      "standings": [
        {
          "team": "Oklahoma City Thunder",
          "abbreviation": "OKC",
          "wins": 68,
          "losses": 14,
          "winPercent": 0.829,
          "gamesBehind": 0,
          "conferenceRecord": "37-3",
          "homeRecord": "35-6",
          "awayRecord": "33-8",
          "streak": "W6"
        },
        "... more teams"
      ]
    }
  ]
}
```

---

## get_league_leaders

League-wide statistical leaders (points, rebounds, passing yards, etc. — varies by sport).

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug (e.g. `"basketball"`, `"football"`). |
| `league` | string | Yes | League slug (e.g. `"nba"`, `"nfl"`). |
| `season` | number | No | Season year (e.g. `2025`). Defaults to the current season. |

### Example

Get NBA scoring leaders:

```json
{
  "sport": "basketball",
  "league": "nba"
}
```

### Response

```json
{
  "season": 2025,
  "league": "nba",
  "categories": [
    {
      "name": "Points Per Game",
      "abbreviation": "PPG",
      "leaders": [
        {
          "rank": 1,
          "athlete": {
            "id": "3945274",
            "name": "Shai Gilgeous-Alexander",
            "team": "Oklahoma City Thunder",
            "teamAbbreviation": "OKC",
            "position": "PG"
          },
          "value": 32.7
        },
        {
          "rank": 2,
          "athlete": {
            "id": "6450",
            "name": "Giannis Antetokounmpo",
            "team": "Milwaukee Bucks",
            "teamAbbreviation": "MIL",
            "position": "PF"
          },
          "value": 30.4
        },
        "... more leaders"
      ]
    },
    {
      "name": "Rebounds Per Game",
      "abbreviation": "RPG",
      "leaders": [
        {
          "rank": 1,
          "athlete": {
            "id": "6450",
            "name": "Giannis Antetokounmpo",
            "team": "Milwaukee Bucks",
            "teamAbbreviation": "MIL",
            "position": "PF"
          },
          "value": 12.1
        },
        "... more leaders"
      ]
    },
    "... more categories"
  ]
}
```

---

## get_injuries

League-wide injury report covering all teams. Works for NBA, NFL, NHL, MLB, and Soccer. Returns a 500 error for MMA, Tennis, and Golf.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug (e.g. `"football"`, `"basketball"`). |
| `league` | string | Yes | League slug (e.g. `"nfl"`, `"nba"`). |

### Example

Get NFL injury report:

```json
{
  "sport": "football",
  "league": "nfl"
}
```

### Response

```json
{
  "league": "nfl",
  "injuries": [
    {
      "team": "Kansas City Chiefs",
      "teamAbbreviation": "KC",
      "injuries": [
        {
          "athlete": {
            "id": "3139477",
            "name": "Patrick Mahomes",
            "position": "QB"
          },
          "status": "Questionable",
          "type": "Ankle",
          "detail": "Right ankle soreness",
          "returnDate": null,
          "comment": "Limited in practice Wednesday and Thursday. Game-time decision."
        },
        {
          "athlete": {
            "id": "3054211",
            "name": "Travis Kelce",
            "position": "TE"
          },
          "status": "Probable",
          "type": "Knee",
          "detail": "Knee management",
          "returnDate": null,
          "comment": "Veteran rest, expected to play."
        }
      ]
    },
    {
      "team": "Philadelphia Eagles",
      "teamAbbreviation": "PHI",
      "injuries": [
        {
          "athlete": {
            "id": "4360310",
            "name": "Jalen Hurts",
            "position": "QB"
          },
          "status": "Active",
          "type": "Shoulder",
          "detail": "Right shoulder",
          "returnDate": null,
          "comment": "Full participant Thursday. No designation."
        }
      ]
    },
    "... more teams"
  ]
}
```

---

## get_transactions

Recent league transactions including signings, trades, and waiver moves.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug (e.g. `"baseball"`, `"football"`). |
| `league` | string | Yes | League slug (e.g. `"mlb"`, `"nfl"`). |

### Example

Get MLB transactions:

```json
{
  "sport": "baseball",
  "league": "mlb"
}
```

### Response

```json
{
  "league": "mlb",
  "transactions": [
    {
      "date": "2025-04-10T18:30:00Z",
      "team": "Los Angeles Dodgers",
      "teamAbbreviation": "LAD",
      "type": "Signing",
      "description": "Placed RHP Blake Treinen on the 15-day injured list (right shoulder inflammation). Recalled RHP Michael Grove from Triple-A Oklahoma City."
    },
    {
      "date": "2025-04-10T16:00:00Z",
      "team": "New York Yankees",
      "teamAbbreviation": "NYY",
      "type": "Transaction",
      "description": "Activated 1B Anthony Rizzo from the 10-day injured list. Optioned RHP Nick Burdi to Triple-A Scranton/Wilkes-Barre."
    },
    {
      "date": "2025-04-09T20:15:00Z",
      "team": "Atlanta Braves",
      "teamAbbreviation": "ATL",
      "type": "Trade",
      "description": "Acquired LHP Josh Hader from the Houston Astros in exchange for minor league RHP AJ Smith-Shawver and cash considerations."
    },
    "... more transactions"
  ]
}
```

---

## get_news

Real-time sports news from the Now API. Filter by sport, league, or team. Results include article URLs that can be fetched and summarized via `espn_fetch`.

All parameters are optional — call with no parameters to retrieve top sports news across all sports.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | No | Sport slug (e.g. `"basketball"`, `"football"`). |
| `league` | string | No | League slug (e.g. `"nba"`, `"nfl"`). |
| `team` | string | No | Team abbreviation (e.g. `"LAL"`, `"KC"`). |
| `limit` | number | No | Max number of articles to return. Default `20`. |

### Example

Get Lakers news:

```json
{
  "sport": "basketball",
  "league": "nba",
  "team": "LAL",
  "limit": 5
}
```

### Response

```json
{
  "articles": [
    {
      "id": "44102938",
      "headline": "LeBron James passes 50,000 career points milestone",
      "description": "LeBron James became the first player in NBA history to surpass 50,000 combined regular season and playoff points on Thursday night.",
      "published": "2025-04-10T23:45:00Z",
      "author": "Dave McMenamin",
      "url": "https://www.espn.com/nba/story/_/id/44102938/lebron-james-50000-career-points-milestone",
      "type": "Story",
      "teams": ["LAL"]
    },
    {
      "id": "44098711",
      "headline": "Anthony Davis listed as day-to-day with left knee soreness",
      "description": "Lakers center Anthony Davis left Wednesday's practice early and is considered day-to-day ahead of Friday's matchup against the Golden State Warriors.",
      "published": "2025-04-10T17:10:00Z",
      "author": "Ohm Youngmisuk",
      "url": "https://www.espn.com/nba/story/_/id/44098711/anthony-davis-day-to-day-left-knee-soreness",
      "type": "Story",
      "teams": ["LAL"]
    },
    "... more articles"
  ]
}
```

> **Tip:** Pass an article `url` to `espn_fetch` to retrieve and summarize the full article body.
