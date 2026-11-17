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

Requires Node.js 20 or newer.

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

This enables stateless HTTP serving (MCP 2026-07-28 plus every 2025-era client), built-in caching, rate limiting, and monitoring endpoints. See the [Self-Hosting Guide](self-hosting.md) for full configuration options.

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

The agent will call `get_player_report` with `sport: "basketball"`, `league: "nba"`, and `player: "LeBron James"`. That one call resolves the name inside the NBA and returns season stats, the last 5 games, and splits.

### Get tonight's slate in one call

> "What's on the MLB slate today, with odds and key injuries?"

The agent will call `get_slate` with `sport: "baseball"` and `league: "mlb"`, which returns every game with team IDs, status/score, consensus no-vig probabilities, and Out/Doubtful injuries.

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

The tool and `sports://leagues` return a curated catalog verified against the public endpoints. The broader [League & Sport Slugs](reference/league-slugs.md) file includes less-common values that may not work across every tool.

## Compact and raw mode

All tools accept `raw`:

- Omit it or pass `false` for compact, agent-safe output.
- Pass `true` only when you need a specific field removed by compaction. The text block is then the untouched ESPN JSON; tools with an `outputSchema` return `structuredContent` as `{ "raw": true, "response": ... }`.
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
- **Date range:** `YYYYMMDD-YYYYMMDD` (e.g. `20250301-20250331`). ESPN rejects that form, so `get_scoreboard` and `get_slate` do not send it as one `dates` value. Days older than the games file, and older than today and the previous 2 US-Eastern days, come from the games export for MLB, NBA, NFL, NHL, college football, and men's college basketball (every one of those leagues from the 2021 season through today). Today, the previous 2 Eastern days, and future days stay on ESPN, one day at a time, at most 14 of those days. `source` is `data`, `espn`, or `mixed`. A result past the token budget returns a `page`; pass `offset` for the next slice.

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

- Browse the [Tools](tools/) to see all 43 tools with parameters and examples
- Read the [Self-Hosting Guide](self-hosting.md) if running as an HTTP service
- Check the [API Endpoints](reference/endpoints.md) reference for the raw ESPN API catalog
- Read [Gotchas & Pitfalls](reference/gotchas.md) to avoid common mistakes
