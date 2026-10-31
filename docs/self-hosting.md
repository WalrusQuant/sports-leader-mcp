# Self-Hosting

How to run sports-leader-mcp as a hosted HTTP service (e.g. on Railway, Fly.io, or any container platform).

---

## Quick Start

```bash
git clone https://github.com/WalrusQuant/sports-leader-mcp.git
cd sports-leader-mcp
npm install
npm run build
PORT=3000 npm start
```

Setting `PORT` switches the server from stdio mode (for local MCP clients) to HTTP mode with caching, rate limiting, and monitoring. HTTP serving is stateless (see [Protocol versions](#protocol-versions-and-stateless-http)).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | *(unset)* | Set to enable HTTP mode (e.g. `3000`) |
| `SPORTS_LEADER_TIMEOUT` | `30000` | Timeout in ms for upstream ESPN API calls |
| `KILL_SWITCH` | *(unset)* | Set to `1` or `true` to return 503 on all `/mcp` endpoints |
| `RATE_LIMIT_PER_MIN` | `60` | Max requests per IP per minute |
| `RATE_LIMIT_PER_DAY` | `1000` | Max requests per IP per day |
| `SPORTS_LEADER_MAX_TOKENS` | `50000` | Estimated-token ceiling for one MCP result; oversized results become valid truncation metadata |
| `CACHE_MAX_ENTRIES` | `250` | Maximum raw ESPN responses retained in the in-memory LRU/TTL cache |
| `CACHE_MAX_BYTES` | `67108864` | Approximate maximum cache bytes (64 MiB by default) |

---

## Protocol versions and stateless HTTP

The server is built on MCP TypeScript SDK v2 and speaks two protocol eras on the same `/mcp` endpoint and the same stdio binary:

- **2026-07-28** (stateless MCP): no `initialize` handshake and no `Mcp-Session-Id`; each request carries its own protocol version. List results (`tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, `server/discover`) carry `ttlMs: 3600000, cacheScope: "public"`; static resources 24 h; `espn://` template reads 30 s (slate), 60 s (game data) or 5 min (injuries).
- **2025-11-25 and older** (2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07): the classic `initialize` handshake still works. Over HTTP it is served statelessly: every POST is answered by a fresh server instance, no `Mcp-Session-Id` is issued, and `GET`/`DELETE /mcp` return `405`. Clients that follow the spec treat a missing session id as "stateless server" and need no changes. Over stdio the connection is pinned to one instance, exactly as before.

There is no session map to size, so `MAX_SESSIONS` is gone. Every POST builds a fresh server, so any replica can serve any request and you can scale horizontally without sticky sessions.

Cancellation: if a client cancels a call (2026-07-28: by closing the request; 2025-era stdio: `notifications/cancelled`; any HTTP client: dropping the connection), the in-flight ESPN fetches are aborted rather than left to time out. Over stateless 2025-era HTTP, a `notifications/cancelled` POST cannot reach the running call; only closing the connection cancels it.

---

## Caching

All upstream ESPN API responses are cached in-memory with TTLs tuned to how frequently each data type changes. Caching happens at the fetch layer, so both HTTP and stdio modes benefit.

### TTL Tiers

| Data Type | TTL | Endpoints |
|-----------|-----|-----------|
| Live scoreboards | 30 seconds | `get_scoreboard` |
| In-progress game data | 60 seconds | `get_game_summary`, `get_game_plays`, `get_game_odds`, `get_game_probabilities` |
| Semi-live data | 5 minutes | `get_injuries` (league-wide), `get_transactions`, `get_news`, `search` |
| Standings and league data | 1 hour | `get_standings`, `get_league_leaders`, `get_teams`, `get_team`, `get_team_injuries` |
| Historical and reference | 24 hours | `get_athlete_overview`, `get_athlete_stats`, `get_athlete_gamelog`, `get_athlete_splits`, `list_sports_and_leagues` |
| Default (incl. `espn_fetch`) | 5 minutes | Any URL not matching the above patterns |

### How It Works

- **Cache key** is the fully resolved URL including query parameters
- Only successful responses are cached (errors and timeouts are never cached)
- Expired entries are evicted lazily on access and via a background sweep every 60 seconds
- No external dependencies (Redis, Memcached, etc.) required

### Cache sizing

The cache stores raw upstream objects before compact transforms run. Some ESPN payloads are multiple megabytes, especially league injuries, athlete gamelogs, and custom `espn_fetch` URLs. It is bounded by both entry count and approximate serialized bytes. Expired entries and least-recently-used entries are evicted as needed. A single object larger than the byte ceiling is not cached.

Because the cache key is the complete URL, `espn_fetch` and broad date/query combinations can create many distinct entries.

---

## Rate Limiting

Rate limiting is applied to `/mcp` endpoints in HTTP mode only. It does not affect stdio mode, `/health`, or `/stats`.

### Limits

| Limit | Default | Env Var |
|-------|---------|---------|
| Per-IP per minute | 60 requests | `RATE_LIMIT_PER_MIN` |
| Per-IP per day | 1,000 requests | `RATE_LIMIT_PER_DAY` |

### Behavior

- When a limit is exceeded, the server returns **HTTP 429** with a `Retry-After` header (seconds until the client can retry)
- Per-minute uses a sliding window (not fixed buckets), so limits are smooth
- Daily quotas reset at midnight UTC
- Stale IP tracking entries are cleaned up every 5 minutes to prevent memory growth

### Extracting Client IP

The server sets `trust proxy` so that `req.ip` reflects the real client IP from `X-Forwarded-For` headers. This is required behind reverse proxies (Railway, Fly.io, Cloudflare, etc.). Make sure your platform does not allow clients to spoof this header directly.

---

## Kill Switch

Set `KILL_SWITCH=1` (or `true`) to immediately reject all `/mcp` requests with **HTTP 503**. The `/health` and `/stats` endpoints remain accessible for monitoring.

The kill switch is checked on every request (reads `process.env` dynamically), so on platforms that support hot env var updates you can flip it without a redeploy.

### When to Use It

- Upstream ESPN API is returning errors and you want to stop retries
- You're hitting your platform spend cap and need to stop traffic immediately
- You need to do maintenance without taking down health checks

---

## Monitoring

### `GET /health`

Basic liveness check. Always responds, even when the kill switch is active.

```json
{
  "status": "ok",
  "version": "0.4.0",
  "uptime": 3621.5,
  "tools": 25,
  "stateless": true,
  "protocolVersions": {
    "modern": ["2026-07-28"],
    "legacy": ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"]
  }
}
```

### `GET /stats`

Detailed operational metrics. Always responds, even when the kill switch is active.

```json
{
  "cache": {
    "hits": 1482,
    "misses": 237,
    "size": 84,
    "evictions": 153,
    "hitRatePercent": "86.2"
  },
  "rateLimit": {
    "trackedIps": 12,
    "dailyTrackedIps": 45,
    "limits": {
      "perMinute": 60,
      "perDay": 1000
    }
  },
  "uptime": 3621.5,
  "killSwitch": false
}
```

**Key metrics to watch:**

- **`cache.hitRatePercent`** — Should stabilize above 50% under normal usage. Low hit rates mean clients are requesting many unique URLs or TTLs are too short.
- **`cache.size`** — Number of entries currently in cache. If this grows unexpectedly large, investigate what URLs are being cached.
- **`rateLimit.trackedIps`** — Number of unique IPs with recent activity. A sudden spike may indicate bot traffic.

---

## Platform Tips

### Railway

- Set a **spend cap** in the Railway dashboard (Settings > Usage Limits) as a last line of defense
- Use Railway's env var UI to set `KILL_SWITCH`, rate limits, etc. without redeploying
- The included `Dockerfile` exposes port 3000 and is ready to deploy as-is

### Docker

```bash
docker build -t sports-leader-mcp .
docker run -p 3000:3000 \
  -e PORT=3000 \
  -e RATE_LIMIT_PER_MIN=60 \
  -e RATE_LIMIT_PER_DAY=1000 \
  sports-leader-mcp
```

---

## Next Steps

- Browse the [Tools](tools/) to see all 25 tools with parameters and examples
- Run `npm run audit` from a checkout to hit every tool against live ESPN and print a pass/fail report
- Read [Gotchas & Pitfalls](../references/gotchas.md) for ESPN API quirks
- Check the [API Endpoints](../references/endpoints.md) reference for the raw ESPN API catalog
