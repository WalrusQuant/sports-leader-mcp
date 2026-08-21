# Discovery tools

All tools return compact JSON by default. Every tool also accepts `raw: true`; use it only when a compact response omits a required field. Oversized responses are replaced with a valid `{ "truncated": true, ... }` envelope.

## `list_sports_and_leagues`

Returns the curated catalog of sport/league slug pairs verified for the server's public endpoints.

Parameters:

- `limit` (optional): applies only to the upstream ontology request used by `raw: true`.
- `raw` (optional, default `false`): return ESPN's live ontology response. That response is mostly unresolved `$ref` records and is intended for debugging, not normal agent discovery.

Compact shape:

```json
{
  "count": 30,
  "leagues": [{ "sport": "football", "league": "nfl", "name": "NFL" }],
  "note": "Curated public-endpoint slug pairs..."
}
```

The same curated catalog is available as the `sports://leagues` resource.

## `search`

Searches ESPN for athletes, teams, and articles. Use this to resolve IDs before calling athlete/team tools.

Parameters:

- `query` (required): search text.
- `sport` (optional): sport slug used to narrow results.
- `limit` (optional): per-group result limit.
- `raw` (optional, default `false`).

Compact shape:

```json
{
  "totalFound": 4,
  "groups": [{
    "type": "player",
    "totalFound": 1,
    "results": [{
      "id": "3139477",
      "type": "player",
      "name": "Patrick Mahomes",
      "sport": "football",
      "league": "nfl"
    }]
  }]
}
```

## `espn_fetch`

Escape hatch for an HTTPS ESPN JSON URL when no dedicated tool exists. ESPN hostnames are allowlisted. The response is uncurated and may be large; dedicated tools are safer for agent context.

Parameters:

- `url` (required): full `https://` URL on an ESPN hostname.
- `raw`: accepted for consistency but has no additional effect because this tool has no curated transform.

If the response exceeds `SPORTS_LEADER_MAX_TOKENS`, the server returns a valid truncation envelope containing the estimated size and root shape. It never returns partial JSON.
