# Getting Started

## Installation

### Via Smithery (recommended)

```bash
npx -y @smithery/cli install @wickwireadam-o0nh/sports-leader-mcp --client claude
```

### Manual Configuration

Add to your MCP client's config file:

```json
{
  "mcpServers": {
    "sports-leader": {
      "command": "npx",
      "args": ["-y", "@wickwireadam-o0nh/sports-leader-mcp"]
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

For the full list of 139 leagues, see the [League & Sport Slugs](reference/league-slugs.md) reference.

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
- Check the [API Endpoints](reference/endpoints.md) reference for the raw ESPN API catalog
- Read [Gotchas & Pitfalls](reference/gotchas.md) to avoid common mistakes
