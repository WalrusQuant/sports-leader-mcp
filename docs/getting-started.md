# Getting Started

## Installation

### Via Smithery

```bash
npx -y @smithery/cli install @wickwireadam-o0nh/sports-leader-mcp --client claude
```

The scoped Smithery identifier above is a hosted registry/install identifier; it is not the npm package name in this repository.

### Manual configuration from a source checkout

Add to your MCP client's config file:

```json
{
  "mcpServers": {
    "sports-leader": {
      "command": "node",
      "args": ["/absolute/path/to/sports-leader-mcp/dist/index.js"]
    }
  }
}
```

### From Source

```bash
git clone https://github.com/WalrusQuant/sports-leader-mcp.git
cd sports-leader-mcp
npm install
npm run build
npm start
```

To run as an HTTP service instead of stdio, set `PORT`:

```bash
PORT=3000 npm start
```

This enables session management, built-in caching, rate limiting, and monitoring endpoints. See the [Self-Hosting Guide](self-hosting.md) for full configuration options.

## Your First Queries

Once connected, try these with your AI agent:

### Get today's NBA scores

> "What NBA games are on today?"

The agent will call `get_scoreboard` with `sport: "basketball"` and `league: "nba"`.

### Look up NFL standings

> "Show me the current NFL standings"

The agent will call `get_standings` with `sport: "football"` and `league: "nfl"`.

### Search for a player

> "Find LeBron James and show me his stats"

The agent will call `search` with `query: "LeBron James"`, then use the returned `athleteId` to call `get_athlete_stats`.

### Get betting odds for a game

> "What are the odds for tonight's Lakers game?"

The agent will call `get_scoreboard` to find the event, then `get_game_odds` with the `eventId`.

## Common Parameters

Most tools take a `sport` and `league` slug. Here are the most common ones:

| Sport | League | Slug |
|-------|--------|------|
| Basketball | NBA | `basketball` / `nba` |
| Basketball | WNBA | `basketball` / `wnba` |
| Basketball | NCAA Men's | `basketball` / `mens-college-basketball` |
| Football | NFL | `football` / `nfl` |
| Football | NCAA | `football` / `college-football` |
| Baseball | MLB | `baseball` / `mlb` |
| Hockey | NHL | `hockey` / `nhl` |
| Soccer | Premier League | `soccer` / `eng.1` |
| Soccer | MLS | `soccer` / `usa.1` |
| Soccer | La Liga | `soccer` / `esp.1` |
| MMA | UFC | `mma` / `ufc` |
| Golf | PGA Tour | `golf` / `pga` |

Don't know the slug? Call `list_sports_and_leagues` to discover all valid values.

The tool and `sports://leagues` return a curated catalog verified against the public endpoints. The broader [League & Sport Slugs](../references/league-slugs.md) file includes less-common values that may not work across every tool.

## Compact and raw mode

All tools accept `raw`:

- Omit it or pass `false` for compact, agent-safe output.
- Pass `true` only when you need a specific field removed by compaction.
- If any output exceeds `SPORTS_LEADER_MAX_TOKENS`, the result is a valid JSON envelope with `truncated: true`, estimated size, budget, and root-shape metadata. Narrow the request instead of treating that envelope as sports data.

## Season Types

Several tools accept a `seasonType` parameter:

| Value | Meaning |
|-------|---------|
| `1` | Preseason |
| `2` | Regular season |
| `3` | Postseason / playoffs |
| `4` | Off season |

## Date Formats

- **Single date:** `YYYYMMDD` (e.g. `20250315`)
- **Date range:** `YYYYMMDD-YYYYMMDD` (e.g. `20250301-20250331`)

## Betting Provider IDs

When filtering odds by sportsbook:

| Provider | ID |
|----------|----|
| Caesars | `38` |
| FanDuel | `37` |
| DraftKings | `41` |
| BetMGM | `58` |
| ESPN BET | `68` |
| Bet365 | `2000` |

## Next Steps

- Browse the [Tools](tools/) to see all 20 tools with parameters and examples
- Read the [Self-Hosting Guide](self-hosting.md) if running as an HTTP service
- Check the [API Endpoints](../references/endpoints.md) reference for the raw ESPN API catalog
- Read [Gotchas & Pitfalls](../references/gotchas.md) to avoid common mistakes
