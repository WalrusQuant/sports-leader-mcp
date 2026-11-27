---
name: espn-api
description: Query ESPN's public API for live scores, standings, rosters, player stats, odds, play-by-play, injuries, transactions, news, and more across 30 verified leagues across 11 sports. Use when the user needs sports data from ESPN, wants to build a sports app, fetch scores or schedules, look up player or team stats, get betting odds, or pull any structured sports data. Triggers on mentions of ESPN, sports scores, standings, box scores, player stats, game data, or league data.
license: MIT
metadata:
  author: sejaldua
  version: "1.0"
  source: https://github.com/pseudo-r/Public-ESPN-API
compatibility: Requires network access to ESPN API endpoints. Works with any language that can make HTTP requests (curl, Python, JavaScript, etc.).
---

# ESPN Public API Skill

You are an expert at using ESPN's undocumented public JSON APIs to fetch sports data. These APIs power espn.com and the ESPN mobile app. They require no authentication and return JSON.

**Important:** These are unofficial, undocumented APIs. They may change without notice. Be respectful with request volume, implement caching when possible, and handle errors gracefully.

## How to Use This Skill

1. **Identify what the user needs** (scores, standings, player stats, odds, etc.)
2. **Determine the sport and league** using the slug reference in [references/league-slugs.md](references/league-slugs.md)
3. **Pick the right API domain and endpoint** from [references/endpoints.md](references/endpoints.md)
4. **Construct the URL** and fetch the data
5. **Parse the JSON response** using patterns from [references/response-schemas.md](references/response-schemas.md)
6. **Watch for common pitfalls** documented in [references/gotchas.md](references/gotchas.md)

## API Domains

There are six ESPN API domains. Choose based on your data need:

| Domain | Base URL | Use For |
|--------|----------|---------|
| **Site API** | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/` | Scores, teams, rosters, news, injuries, game summaries |
| **Site API v2** | `https://site.api.espn.com/apis/v2/sports/{sport}/{league}/` | Standings only (the site/v2 path returns a stub for standings) |
| **Core API v2** | `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/` | Athletes, detailed stats, odds, play-by-play, venues, coaches |
| **Core API v3** | `https://sports.core.api.espn.com/v3/sports/{sport}/{league}/` | Dead as of 2026-10-31 (404). Use Web API v3 for athlete stats and Core API v2 `/seasons/{year}/types/{type}/leaders` for leaders. |
| **Web API v3** | `https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/` | Player season stats, gamelogs, splits, leaderboards |
| **CDN** | `https://cdn.espn.com/core/{league-abbrev}/` | Full game packages (boxscore + plays + win prob). Requires `?xhr=1` |
| **Now API** | `https://now.core.api.espn.com/v1/sports/news` | Real-time news feed |

## Quick Start Recipes

### Get today's scores for any league
```bash
curl "https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard"
# Example: NBA scores today
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
# Scores for a specific date
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20250315"
```

### Get standings
```bash
# IMPORTANT: Use /apis/v2/ NOT /apis/site/v2/ (the latter returns a stub)
curl "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings"
curl "https://site.api.espn.com/apis/v2/sports/football/nfl/standings"
```

### Get all teams
```bash
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams"
```

### Get a team's roster
```bash
# Team IDs: look them up from the teams endpoint first
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/13/roster"
```

### Get a full game summary (boxscore + plays + leaders)
```bash
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=401765432"
```

### Get player season stats
```bash
# Uses the Web API v3 domain. Works for NFL, NBA, NHL, MLB.
curl "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/3136776/stats"
```

### Get player game log
```bash
curl "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/3136776/gamelog"
```

### Get betting odds for a game
```bash
curl "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/events/{eventId}/competitions/{eventId}/odds"
```

### Get league-wide injury report
```bash
curl "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries"
```

### Get real-time news
```bash
curl "https://now.core.api.espn.com/v1/sports/news?sport=basketball&league=nba&limit=20"
```

### Get full game package via CDN (richest data)
```bash
# Returns gamepackageJSON with drives, plays, win probability, boxscore, odds
curl "https://cdn.espn.com/core/nba/game?xhr=1&gameId=401765432"
curl "https://cdn.espn.com/core/nfl/boxscore?xhr=1&gameId=401671793"
```

## Common Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `dates` | One calendar day, YYYYMMDD. A `YYYYMMDD-YYYYMMDD` range is HTTP 400 on every league scoreboard | `20250315` |
| `season` | Season year | `2025` |
| `seasontype` | 1=preseason, 2=regular, 3=postseason, 4=offseason | `2` |
| `week` | Week number | `1` |
| `limit` | Results per page | `100` |
| `page` | Page number | `1` |
| `groups` | Scoreboard group. Men's and women's college basketball Division I is `50` (with `limit=400`). Other ids are one conference | `50` |
| `xhr` | Required for CDN endpoints | `1` |
| `active` | Filter active athletes | `true` |

## Season Types

| Type | Value | Description |
|------|-------|-------------|
| Preseason | `1` | Exhibition/preseason games |
| Regular Season | `2` | Regular season |
| Postseason | `3` | Playoffs/postseason |
| Off Season | `4` | Off season |

## Betting Provider IDs

When filtering odds by provider:

| Provider | ID |
|----------|----|
| Caesars | 38 |
| FanDuel | 37 |
| DraftKings | 41 |
| BetMGM | 58 |
| ESPN BET | 68 |
| Bet365 | 2000 |

## Writing Code

When the user wants to write code that calls the ESPN API:

### Python (requests or httpx)
```python
import requests

def get_nba_scoreboard(date=None):
    url = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
    params = {}
    if date:
        params["dates"] = date  # YYYYMMDD format
    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    return data["events"]
```

### JavaScript/TypeScript (fetch)
```typescript
async function getNBAScoreboard(date?: string) {
  const url = new URL("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard");
  if (date) url.searchParams.set("dates", date);
  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`ESPN API error: ${resp.status}`);
  const data = await resp.json();
  return data.events;
}
```

### Best practices for ESPN API code
- Always set a timeout (30s recommended)
- Implement caching for data that does not change frequently (teams, standings, rosters)
- Handle 404s gracefully (invalid IDs, offseason endpoints)
- Handle 429s (rate limiting) with exponential backoff
- The API is undocumented, so always validate response shape before accessing nested fields
- Use `User-Agent` header to identify your app

## Using the sports-leader MCP server instead of raw URLs

If the sports-leader MCP server is connected (v0.9.0, 43 tools), prefer its tools over hand-built URLs. They return compact JSON and validate slugs. `raw: true` on any tool returns the untouched ESPN response.

- `get_slate(sport, league, date?)` and `get_scoreboard`: start here for a day of games. Men's and women's college basketball default to every Division I game (`groups=50`, `limit=400`). Pass `groups` only to narrow to one conference.
- A `dateRange` (`YYYYMMDD-YYYYMMDD`) is not sent to ESPN as one range. ESPN rejects that form. Today and the previous 2 US-Eastern days, plus future days, stay on ESPN, one day at a time, at most 14 of those days. Older days for `mlb`, `nba`, `nfl`, `nhl`, `college-football`, and `mens-college-basketball` come from the games export in one query. The response `source` is `data`, `espn`, or `mixed`. `days` lists each date. A result that would exceed the token budget returns a `page`; pass `offset` for the next slice.
- `get_game_odds(sport, league, eventId)`: per-book numeric American moneylines, `*ImpliedProb` (vig included), `*NoVigProb` (normalized to 1; three-way for soccer), `homeSpread` (**negative = home team favored**), `total`, and a `consensus`.
- `get_game_preview`: one game's injuries, probable pitchers or goalies, lineups, weather, and Kalshi and Polymarket US winner prices. `windMph` is sustained wind and is null when ESPN does not send one. `gustMph` is the gust. A gust is never copied into `windMph`. `condition` is the AccuWeather label for `conditionId` (codes 1–44; code 8 is Dreary (Overcast), code 37 is Hazy Moonlight).
- `get_player_report`: one call for a name or id inside the league, then season stats, recent games, and splits. Recent games leave preseason out unless `includePreseason` is true, and include a current injury when ESPN lists one. `get_player_trends` groups the Parquet log by home/away, opponent, month, or rest. Rate stats are recomputed (save percentage, passer rating, QBR). `longest` is a maximum. A player queried in the wrong stat group returns `reason: "wrong_group"`.
- NHL lineups in the export, and in `get_game_preview`, come from the official NHL API. Starting goalies are ESPN probables before the game and the NHL box score after it. Lines and pairs come from the official shift charts.
- `get_game_summary`: box score, leaders, key plays, plus `resource_link` items to `espn://` resources for full plays, probabilities, odds, and injuries.

## Historical export

The public Parquet export is [WalrusQuant/sportsleader-data](https://github.com/WalrusQuant/sportsleader-data). No API key. The manifest is `https://github.com/WalrusQuant/sportsleader-data/releases/download/manifest/manifest.json`. `SPORTSLEADER_DATA_MANIFEST_URL` overrides it. `BAYES_DATA_MANIFEST_URL` is the same setting. `SPORTSLEADER_DATA_BASE_URL` (`BAYES_DATA_BASE_URL` is the alias) is an optional directory mirror.

Six leagues are published from the 2021 season through today: `mlb`, `nba`, `nfl`, `nhl`, `cfb` (college football, FBS), and `cbb` (men's college basketball, Division I). The current season is rebuilt nightly, around 4:15 AM CT. NBA, NHL, and `cbb` are named by the year the season ends (2026-27 is `2027`). NFL, MLB, and `cfb` are named by the year the season starts (the 2026 NFL season is `2026`). Every league starts at 2021.

`get_games`, `get_player_game_logs`, `get_player_trends`, `get_lineups`, and `get_data_status` are the export tools. College football player logs use passing, rushing, and receiving. Men's college basketball uses the player group.

## Research lab (sports-leader-lab)

A second stdio server, separate from the 43-tool Node server. Start it with `cd lab && uv run python -m sports_leader_lab`. It reads the public sportsleader-data Parquet. It does not fetch odds and it has no Kalshi data. Current lab version is `0.1.0.dev0` until the next release.

Every tool result includes this line: a research estimate of fit against simple baselines, not a betting edge, not a pick, and not a recommendation to bet.

### Tools

- `ping`: health check. Returns the lab version and the disclaimer. Call it first.
- `inspect_data(league, dataset, seasons?)`: rows, date range, grain, null rates, and whether each column is pregame or postgame. `league` is `mlb`, `nba`, `nfl`, `nhl`, `cfb`, or `cbb`. Omit `seasons` for every published season.
- `query_data(sql, max_rows=500, seasons?)`: one SELECT on a view such as `nfl_games` or `mlb_team_game_stats`. No external file access. `max_rows` is 1 to 5000. The query stops at 20 seconds.
- `build_dataset(league, target, seasons, features?, sql_features?)`: pregame rows for `home_win`, `margin`, `total`, or `team_points` (home team's points). `features` names families: `site`, `elo`, `team_form`, `rest`, `injuries`, `probables` (MLB only). Saved only when the leakage audit passes.
- `audit_features(league, target, seasons, features?, sql_features?)`: the same leakage checks. Does not save. `ok: true` means REVIEW REQUIRED, never clean.
- `train_classifier(dataset_id, model="logistic", calibration="none", scheme="season", min_train_seasons=2, min_train_rows=50, embargo_days=0, test_days=14)`: walk-forward only. `model` is `logistic` or `lightgbm`. `calibration` is `none`, `platt`, or `isotonic`. `scheme` is `season` or `date`. Reports log loss against a constant rate, a home-field rate, and as-of Elo. A tie with Elo is not a win.
- `train_regressor(dataset_id, model="ridge", scheme="season", min_train_seasons=2, min_train_rows=50, embargo_days=0, test_days=14)`: `ridge`, `poisson`, `negbin`, or `lightgbm`. Poisson and negative binomial are refused for `margin`. Count targets are not compared to Elo. `scheme`, `min_train_rows`, and `test_days` default the same way as `train_classifier` (`season`, 50, 14).
- `predict(run_id, game_date?, game_ids?, market_prices?)`: scores as of now in `America/Chicago`. Each game has `home_team_abbr`, `away_team_abbr`, `estimate`, and `estimate_kind`. For `home_win`, `estimate` is P(home team wins) and `estimate_kind` is `home_win_probability`. GB at LAR with `estimate` 0.688 is P(LAR win) = 0.688, so P(GB win) is about 0.312. For `margin`, `total`, or `team_points`, `estimate` is that target and `estimate_kind` is the target name. Also returns `as_of`, `as_of_timezone`, and `start_time_ct`. A completed game is a research replay. A game with no start time is refused. `market_prices` is a list of `{game_id, home_implied_prob, source}` for this call only and is not stored.
- `list_runs(league, limit=20)`: newest first. `limit` is 1 to 100. Ties break on a monotonic sequence, then the run id.
- `compare_runs(run_ids)`: at least two runs. A different league or target is returned with a caveat, not as a ranking.
- `model_card(run_id)`: twelve sections rebuilt from the run record, byte-identical to the saved `model_card.md`. The card is not an approval.

### Guardrails

- Walk-forward only. Do not ask for a random split. It is not a parameter.
- Features must be known before the game: schedule, prior games, or as of start. Postgame columns are targets and filters, not features.
- The leakage audit hard-fails a copy of the target, the score, or the margin, a same-game box stat, a timestamp after start, and a raw snapshot name. A constant column is not a copy.
- Baselines are part of the training result. Do not drop them when you summarize a run.
- When you quote a `home_win` estimate, name the home team. `estimate` is P(home team wins), not the away team's chance. Repeat the no-edge disclaimer with that probability or margin.
- Compare a market only with prices from a live call in the same turn. Do not invent a closing line. The lab does not store the price.
- Nothing from Kalshi belongs in a lab call. Do not describe a lab estimate as an edge.

`SPORTSLEADER_LAB_LIVE=1 uv run pytest -m live` (from `lab/`) runs the frozen NHL 2023 and MLB 2023 goldens and a Brewers, Packers, and Bucks stdio pass. This repo has no Monday schedule. A weekly audit elsewhere should run `cd lab && uv run python scripts/smoke.py` (NFL build, train, predict).

## For Deeper Reference

- **Full endpoint catalog:** [references/endpoints.md](references/endpoints.md)
- **All sport and league slugs:** [references/league-slugs.md](references/league-slugs.md)
- **JSON response schemas with examples:** [references/response-schemas.md](references/response-schemas.md)
- **Common pitfalls and gotchas:** [references/gotchas.md](references/gotchas.md)
- **Python fetch helper:** [scripts/espn_fetch.py](scripts/espn_fetch.py)
- **Bash fetch helper:** [scripts/espn_fetch.sh](scripts/espn_fetch.sh)
