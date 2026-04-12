# Teams

Tools for listing teams in a league, fetching detailed team data across multiple views, and pulling a team's current injury report.

---

## get_teams

List all teams in a league. Returns team IDs, names, abbreviations, colors, and logos. Use the IDs returned here with `get_team`, `get_team_injuries`, and other team-scoped tools.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug (e.g. `basketball`, `football`) |
| `league` | string | Yes | League slug (e.g. `nba`, `nfl`) |

### Example

Get all NBA teams.

```json
{
  "sport": "basketball",
  "league": "nba"
}
```

### Response

```json
{
  "sport": "basketball",
  "league": "nba",
  "teams": [
    {
      "id": "1",
      "name": "Atlanta Hawks",
      "abbreviation": "ATL",
      "displayName": "Atlanta Hawks",
      "shortDisplayName": "Hawks",
      "location": "Atlanta",
      "color": "e03a3e",
      "alternateColor": "c1d32f",
      "logos": [
        {
          "href": "https://a.espncdn.com/i/teamlogos/nba/500/atl.png",
          "width": 500,
          "height": 500
        }
      ],
      "links": {
        "roster": "https://www.espn.com/nba/team/roster/_/name/atl"
      }
    },
    {
      "id": "2",
      "name": "Boston Celtics",
      "abbreviation": "BOS",
      "displayName": "Boston Celtics",
      "shortDisplayName": "Celtics",
      "location": "Boston",
      "color": "007a33",
      "alternateColor": "ba9653",
      "logos": [
        {
          "href": "https://a.espncdn.com/i/teamlogos/nba/500/bos.png",
          "width": 500,
          "height": 500
        }
      ]
    }
    // ... 28 more teams
  ],
  "count": 30
}
```

---

## get_team

Get detailed information about a single team. Control what data is returned using the `view` parameter — choose from team info, roster, schedule, record, depth charts, injuries, transactions, history, news, or statistical leaders.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug (e.g. `basketball`, `football`) |
| `league` | string | Yes | League slug (e.g. `nba`, `nfl`) |
| `teamId` | string | Yes | ESPN team ID. Use `get_teams` to look up IDs. |
| `view` | string | No | Data view to return. Defaults to `detail`. See options below. |

### View Options

| View | Description |
|------|-------------|
| `detail` | (default) Core team info — name, abbreviation, colors, logos, venue, social links, and coach. |
| `roster` | Full roster with player IDs, positions, jersey numbers, age, height, weight, and experience. |
| `schedule` | Season schedule including past results and upcoming games with dates, opponents, and scores. |
| `record` | Win/loss record broken down by home, away, conference, and division splits. |
| `depthcharts` | Positional depth chart showing starter and backup assignments. |
| `injuries` | Current injury report for the team — equivalent to `get_team_injuries`. |
| `transactions` | Recent roster moves: signings, trades, waivers, and releases. |
| `history` | Historical season-by-season records and championship finishes. |
| `news` | Latest news articles and headlines related to the team. |
| `leaders` | Current statistical leaders on the roster (points, rebounds, assists, etc.). |

### Example

Get the Lakers roster (`teamId` for the Los Angeles Lakers is `"13"`).

```json
{
  "sport": "basketball",
  "league": "nba",
  "teamId": "13",
  "view": "roster"
}
```

### Response

```json
{
  "team": {
    "id": "13",
    "name": "Los Angeles Lakers",
    "abbreviation": "LAL",
    "displayName": "Los Angeles Lakers",
    "shortDisplayName": "Lakers",
    "color": "552583",
    "alternateColor": "fdb927"
  },
  "view": "roster",
  "roster": {
    "athletes": [
      {
        "id": "1966",
        "fullName": "LeBron James",
        "displayName": "LeBron James",
        "shortName": "L. James",
        "jersey": "23",
        "position": {
          "abbreviation": "SF",
          "displayName": "Small Forward"
        },
        "age": 40,
        "height": 81,
        "weight": 250,
        "experience": {
          "years": 21
        },
        "status": {
          "type": "active",
          "name": "Active"
        }
      },
      {
        "id": "4251",
        "fullName": "Anthony Davis",
        "displayName": "Anthony Davis",
        "shortName": "A. Davis",
        "jersey": "3",
        "position": {
          "abbreviation": "C",
          "displayName": "Center"
        },
        "age": 31,
        "height": 82,
        "weight": 253,
        "experience": {
          "years": 12
        },
        "status": {
          "type": "active",
          "name": "Active"
        }
      }
      // ... remaining roster players
    ],
    "count": 17
  }
}
```

---

## get_team_injuries

Get the current injury report for a single team. Returns each injured player's name, position, injury type, body part, and availability status.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sport` | string | Yes | Sport slug (e.g. `football`, `basketball`) |
| `league` | string | Yes | League slug (e.g. `nfl`, `nba`) |
| `teamId` | string | Yes | ESPN team ID. Use `get_teams` to look up IDs. |

### Example

Get the Kansas City Chiefs injury report (`teamId` for the Chiefs is `"12"`).

```json
{
  "sport": "football",
  "league": "nfl",
  "teamId": "12"
}
```

### Response

```json
{
  "team": {
    "id": "12",
    "name": "Kansas City Chiefs",
    "abbreviation": "KC",
    "displayName": "Kansas City Chiefs"
  },
  "injuries": [
    {
      "athlete": {
        "id": "3139477",
        "fullName": "Patrick Mahomes",
        "displayName": "Patrick Mahomes",
        "position": {
          "abbreviation": "QB",
          "displayName": "Quarterback"
        },
        "jersey": "15"
      },
      "status": "Questionable",
      "date": "2026-01-08T00:00Z",
      "type": {
        "abbreviation": "ankle",
        "displayName": "Ankle"
      },
      "longComment": "Mahomes was limited in practice Wednesday with an ankle issue. Listed as questionable for Sunday.",
      "shortComment": "Limited practice Wednesday."
    },
    {
      "athlete": {
        "id": "3054211",
        "fullName": "Travis Kelce",
        "displayName": "Travis Kelce",
        "position": {
          "abbreviation": "TE",
          "displayName": "Tight End"
        },
        "jersey": "87"
      },
      "status": "Out",
      "date": "2026-01-06T00:00Z",
      "type": {
        "abbreviation": "knee",
        "displayName": "Knee"
      },
      "longComment": "Kelce did not practice and has been ruled out for this week.",
      "shortComment": "Did not practice. Ruled out."
    }
    // ... additional injured players
  ],
  "count": 6
}
```
