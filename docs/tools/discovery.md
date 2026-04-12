# Discovery & Search

Tools for finding the right slugs, IDs, and data before calling other tools.

## list_sports_and_leagues

Discover all valid sport and league slugs. Returns ESPN's full ontology of sports and leagues. Call this first when you don't know the right `sport` or `league` slug to pass to other tools.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | No | Max number of results to return. Default `500`. |

### Example

Call with no parameters to retrieve the complete list of leagues:

```json
{}
```

### Response

```json
[
  {
    "name": "NFL",
    "slug": "nfl",
    "sport": "football"
  },
  {
    "name": "NBA",
    "slug": "nba",
    "sport": "basketball"
  },
  {
    "name": "MLB",
    "slug": "mlb",
    "sport": "baseball"
  },
  {
    "name": "NHL",
    "slug": "nhl",
    "sport": "hockey"
  },
  {
    "name": "Premier League",
    "slug": "eng.1",
    "sport": "soccer"
  },
  "... 134 more leagues"
]
```

---

## search

Global ESPN search for athletes, teams, news, and articles. Returns mixed results with IDs you can pass to other tools such as `get_athlete_overview` or `get_team`.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query. Examples: `"LeBron James"`, `"Chiefs"`, `"Super Bowl"`. |
| `sport` | string | No | Sport slug to scope results (e.g. `"football"`, `"basketball"`). Omit to search all sports. |
| `limit` | number | No | Max number of results to return. |

### Example

Search for Patrick Mahomes:

```json
{
  "query": "Patrick Mahomes"
}
```

### Response

```json
{
  "results": [
    {
      "type": "athlete",
      "id": "3139477",
      "name": "Patrick Mahomes",
      "team": "Kansas City Chiefs",
      "teamId": "12",
      "sport": "football",
      "league": "nfl",
      "position": "QB"
    },
    {
      "type": "article",
      "id": "42891034",
      "headline": "Mahomes leads Chiefs to comeback win",
      "published": "2025-01-19T22:31:00Z",
      "url": "https://www.espn.com/nfl/story/_/id/42891034/..."
    },
    "... more results"
  ]
}
```

---

## espn_fetch

Escape hatch — fetch any ESPN URL and return its raw JSON. Locked to known ESPN hostnames. Use this for endpoints not covered by dedicated tools, or to resolve article URLs returned by `get_news`.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `url` | string | Yes | Full ESPN API URL to fetch. Must begin with `https://` and use an allowed ESPN hostname (see below). |

**Allowed hostnames:**

- `site.api.espn.com`
- `sports.core.api.espn.com`
- `site.web.api.espn.com`
- `cdn.espn.com`
- `now.core.api.espn.com`
- `fantasy.espn.com`

### Example

Fetch QBR leader data directly from the ESPN API:

```json
{
  "url": "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2024/types/2/athletes/statistics/0?limit=10"
}
```

Or fetch a CDN game package:

```json
{
  "url": "https://cdn.espn.com/core/nfl/game?xhr=1&gameId=401671793"
}
```

### Response

Returns the raw JSON payload from ESPN exactly as received. Structure varies by endpoint.

```json
{
  "count": 32,
  "pageIndex": 1,
  "pageSize": 10,
  "pageCount": 4,
  "items": [
    {
      "athlete": {
        "$ref": "http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2024/athletes/3139477"
      },
      "categories": [
        {
          "name": "qbr",
          "displayName": "Total QBR",
          "stats": [
            { "name": "totalQBR", "value": 77.4 }
          ]
        }
      ]
    },
    "... more items"
  ]
}
```
