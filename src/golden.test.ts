/**
 * Golden-file tests over raw ESPN fixtures in test/fixtures/<league>/.
 *
 * Each compact transform output is compared with test/golden/<league>/<tool>.json
 * and validated against the tool's outputSchema. Regenerate goldens after an
 * intentional output change with:  UPDATE_GOLDEN=1 npm test
 * Recapture fixtures with:         node scripts/capture-fixtures.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

import {
  transformGameOdds,
  transformGameSummary,
  transformGamelog,
  transformInjuries,
  transformScoreboard,
  transformSlate,
} from "./transforms.js";
import {
  gameOddsOutput,
  gameSummaryOutput,
  gamelogOutput,
  injuriesOutput,
  playerReportOutput,
  scoreboardOutput,
  slateOutput,
} from "./output-schemas.js";
import { recentGames, type GamelogGame } from "./tools/player-report.js";
import type { NormalizedMarket } from "./odds.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = join(ROOT, "test", "fixtures");
const GOLDEN = join(ROOT, "test", "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

export const SPORT_BY_LEAGUE: Record<string, string> = {
  nfl: "football",
  "college-football": "football",
  mlb: "baseball",
  nba: "basketball",
  wnba: "basketball",
  nhl: "hockey",
  "eng.1": "soccer",
  "mens-college-basketball": "basketball",
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function load(league: string, name: string): any | undefined {
  const file = join(FIXTURES, league, `${name}.json`);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
}

function golden(league: string, tool: string, actual: unknown): void {
  const file = join(GOLDEN, league, `${tool}.json`);
  const normalized = JSON.parse(JSON.stringify(actual));
  if (UPDATE || !existsSync(file)) {
    mkdirSync(join(GOLDEN, league), { recursive: true });
    writeFileSync(file, JSON.stringify(normalized, null, 1) + "\n");
    if (!UPDATE) assert.fail(`golden file ${league}/${tool}.json was missing and has been written; re-run`);
    return;
  }
  assert.deepEqual(normalized, JSON.parse(readFileSync(file, "utf8")), `${league}/${tool} differs from golden`);
}

function validates(schema: z.ZodTypeAny, value: unknown, label: string): void {
  const r = schema.safeParse(JSON.parse(JSON.stringify(value)));
  assert.ok(r.success, `${label} failed outputSchema: ${r.success ? "" : JSON.stringify(r.error.issues.slice(0, 3))}`);
}

function collectMarkets(v: unknown, out: NormalizedMarket[] = []): NormalizedMarket[] {
  if (Array.isArray(v)) v.forEach((x) => collectMarkets(x, out));
  else if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("homeNoVigProb" in o && "overround" in o) out.push(o as unknown as NormalizedMarket);
    Object.values(o).forEach((x) => collectMarkets(x, out));
  }
  return out;
}

const leagues = readdirSync(FIXTURES).filter((l) => SPORT_BY_LEAGUE[l]).sort();

test("fixtures exist for the required leagues", () => {
  for (const l of ["nfl", "mlb", "nba", "nhl", "eng.1", "college-football", "mens-college-basketball"]) {
    assert.ok(leagues.includes(l), `missing fixtures for ${l}`);
    assert.ok(load(l, "scoreboard"), `missing ${l}/scoreboard.json`);
  }
});

test("mens college basketball scoreboard fixture is the Division I slate", () => {
  const sb = load("mens-college-basketball", "scoreboard");
  const events = sb?.events ?? [];
  const ids = new Set();
  for (const event of events) {
    for (const competitor of event.competitions?.[0]?.competitors ?? []) {
      if (competitor?.team?.id) ids.add(String(competitor.team.id));
    }
  }
  assert.ok(events.length >= 30, `only ${events.length} games`);
  assert.ok(ids.has("275"), "Wisconsin (team 275) missing");
});

for (const league of leagues) {
  const sport = SPORT_BY_LEAGUE[league];
  const outputs: unknown[] = [];

  test(`${league}: transforms match golden files and outputSchemas`, () => {
    const sb = load(league, "scoreboard");
    if (sb) {
      const out = transformScoreboard(sb, { args: { sport, league } });
      validates(scoreboardOutput, out, `${league} scoreboard`);
      golden(league, "get_scoreboard", out);
      outputs.push(out);
    }
    const summary = load(league, "summary");
    if (summary) {
      const out = transformGameSummary(summary, { args: { sport, league } });
      validates(gameSummaryOutput, out, `${league} summary`);
      golden(league, "get_game_summary", out);
      outputs.push(out);
    }
    const odds = load(league, "odds");
    if (odds) {
      const event = load(league, "event");
      const out = transformGameOdds(odds, { args: { sport, league, eventId: event?.id }, context: event }) as any;
      validates(gameOddsOutput, out, `${league} odds`);
      golden(league, "get_game_odds", out);
      outputs.push(out);
      // Identity fields Rocky needs to line a game up with a Kalshi market.
      assert.match(out.eventId, /^\d+$/);
      assert.match(out.startUtc, /^\d{4}-\d{2}-\d{2}T/);
      for (const side of [out.homeTeam, out.awayTeam]) {
        assert.match(side.id, /^\d+$/);
        assert.ok(side.abbrev, `${league} odds team abbrev`);
      }
    }
    const injuries = load(league, "injuries");
    if (injuries) {
      const out = transformInjuries(injuries) as any;
      validates(injuriesOutput, out, `${league} injuries`);
      golden(league, "get_injuries", out);
      for (const team of out.injuries) {
        assert.ok(team.injuries.every((i: any) => i.status !== "Active"), "Active news entries are filtered");
      }
    }
    const gamelog = load(league, "gamelog");
    if (gamelog) {
      const out = transformGamelog(gamelog);
      validates(gamelogOutput, out, `${league} gamelog`);
      golden(league, "get_athlete_gamelog", out);
      const recent = recentGames(out as { games?: GamelogGame[] }, 5);
      validates(playerReportOutput, {
        resolved: true,
        athlete: { id: "1" },
        recent,
        sources: [{ block: "gamelog", path: `/apis/common/v3/sports/${sport}/${league}/athletes/1/gamelog` }],
      }, `${league} player report`);
      const saved = JSON.parse(readFileSync(join(GOLDEN, league, "get_athlete_gamelog.json"), "utf8"));
      const latest = [...(saved.games ?? [])].sort((a: { date?: string; eventId: string }, b: { date?: string; eventId: string }) => {
        const dt = Date.parse(b.date ?? "") - Date.parse(a.date ?? "");
        if (dt !== 0 && !Number.isNaN(dt)) return dt;
        return String(b.eventId).localeCompare(String(a.eventId));
      }).slice(0, 5);
      assert.deepEqual(recent.map((game) => game.eventId), latest.map((game: { eventId: string }) => game.eventId), `${league} recent games`);
      for (let i = 1; i < recent.length; i++) {
        assert.ok(Date.parse(recent[i - 1]?.date ?? "") >= Date.parse(recent[i]?.date ?? ""), `${league} recent order`);
      }
    }
    if (sb) {
      const out = transformSlate(
        { scoreboard: sb, ...(injuries ? { injuries } : { injuriesError: "fixture missing" }) },
        { args: { sport, league } },
      ) as any;
      validates(slateOutput, out, `${league} slate`);
      golden(league, "get_slate", out);
      outputs.push(out);
      assert.equal(out.gameCount, (sb.events ?? []).length);
      for (const g of out.games) {
        assert.match(g.eventId, /^\d+$/);
        assert.ok(g.home.id && g.away.id, "team IDs present");
        if (g.status.state === "pre") assert.equal(g.home.score, null);
        if (injuries) {
          for (const inj of [...g.home.keyInjuries, ...g.away.keyInjuries]) {
            assert.match(inj.status, /^(out|doubtful)$/i);
          }
        }
      }
    }
  });

  test(`${league}: every normalized market obeys the odds invariants`, () => {
    const markets = collectMarkets(outputs);
    for (const m of markets) {
      if (m.homeNoVigProb !== null) {
        const sum = (m.homeNoVigProb ?? 0) + (m.awayNoVigProb ?? 0) + (m.drawNoVigProb ?? 0);
        assert.ok(Math.abs(sum - 1) <= 3e-4, `${league} ${m.provider}: no-vig sums to ${sum}`);
        assert.ok((m.overround as number) > -0.01, `${league} ${m.provider}: overround ${m.overround}`);
      } else {
        assert.ok(m.noVigReason, `${league} ${m.provider}: null no-vig needs a reason`);
      }
      if (m.threeWay) assert.equal(sport, "soccer", "only soccer markets are three-way");
      // Sign convention: negative homeSpread means the home side is favored, so
      // it must agree with the moneyline favorite (skip pick'em and near-coinflips).
      if (
        m.homeSpread !== null && m.homeSpread !== 0 &&
        m.homeImpliedProb !== null && m.awayImpliedProb !== null &&
        Math.abs(m.homeImpliedProb - m.awayImpliedProb) > 0.02
      ) {
        assert.equal(
          m.homeSpread < 0,
          m.homeImpliedProb > m.awayImpliedProb,
          `${league} ${m.provider}: homeSpread ${m.homeSpread} disagrees with moneylines ${m.homeMoneyLine}/${m.awayMoneyLine}`,
        );
      }
    }
    if (load(league, "odds")) assert.ok(markets.length > 0, `${league}: expected normalized markets`);
  });
}
