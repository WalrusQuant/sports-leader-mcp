import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBudget,
  transformGameSummary,
  transformScoreboard,
  transformSearch,
  transformSportsAndLeagues,
} from "./transforms.js";
import { TtlCache } from "./cache.js";

test("scoreboard linescores remain flat period values", () => {
  const output = transformScoreboard({
    events: [{
      id: "game-1",
      competitions: [{
        competitors: [{
          homeAway: "home",
          team: { id: "1", abbreviation: "GB", name: "Packers" },
          score: "10",
          linescores: [
            { value: 3, displayValue: "3", period: 1 },
            { value: 7, displayValue: "7", period: 2 },
          ],
        }],
      }],
    }],
  }) as { events: Array<{ competitors: Array<{ linescores: string[] }> }> };

  assert.deepEqual(output.events[0].competitors[0].linescores, ["3", "7"]);
});

test("game summary keeps score, player stats, correctly nested leaders, and bounded plays", () => {
  const output = transformGameSummary({
    header: {
      id: "game-1",
      competitions: [{
        id: "game-1",
        date: "2026-08-21T02:00Z",
        status: { type: { state: "post", shortDetail: "Final" } },
        competitors: [{
          homeAway: "home",
          score: "24",
          winner: true,
          team: { id: "1", abbreviation: "GB", displayName: "Green Bay Packers" },
          linescores: [{ displayValue: "7" }, { displayValue: "17" }],
        }],
      }],
    },
    boxscore: {
      players: [{
        team: { id: "1", abbreviation: "GB", displayName: "Green Bay Packers" },
        statistics: [{
          name: "passing",
          labels: ["C/ATT", "YDS"],
          athletes: [{ athlete: { id: "12", displayName: "QB One" }, stats: ["20/25", "250"] }],
        }],
      }],
    },
    leaders: [{
      team: { id: "1", abbreviation: "GB", displayName: "Green Bay Packers" },
      leaders: [{
        name: "passingYards",
        displayName: "Passing Yards",
        leaders: [{ athlete: { id: "12", displayName: "QB One" }, displayValue: "250 YDS" }],
      }],
    }],
    plays: [{ id: "p1", text: "Touchdown", scoringPlay: true, homeScore: 7, awayScore: 0 }],
    winprobability: [{ playId: "p1", homeWinPercentage: 0.75, awayWinPercentage: 0.25 }],
  }) as any;

  assert.equal(output.game.id, "game-1");
  assert.equal(output.game.competitors[0].score, "24");
  assert.deepEqual(output.game.competitors[0].linescores, ["7", "17"]);
  assert.equal(output.boxscore.players[0].categories[0].athletes[0].stats.YDS, "250");
  assert.equal(output.leaders[0].categories[0].leaders[0].athlete, "QB One");
  assert.equal(output.plays.scoring[0].homeScore, "7");
  assert.equal(output.winProbability.samples[0].homeWinPercentage, 0.75);
});

test("over-budget data returns valid structured JSON metadata", () => {
  const output = applyBudget({ rows: ["x".repeat(250_000)] }) as any;
  assert.equal(output.truncated, true);
  assert.equal(output.dataSummary.type, "object");
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(output)));
});

test("search strips image payloads and exposes usable athlete IDs", () => {
  const output = transformSearch({
    totalFound: 1,
    results: [{
      type: "player",
      totalFound: 1,
      contents: [{
        uid: "s:20~l:28~a:3139477",
        type: "player",
        displayName: "Patrick Mahomes",
        sport: "football",
        defaultLeagueSlug: "nfl",
        image: { default: "large-image-url" },
      }],
    }],
  }) as any;

  assert.equal(output.groups[0].results[0].id, "3139477");
  assert.equal(output.groups[0].results[0].image, undefined);
});

test("league discovery returns clean slug records instead of ontology refs", () => {
  const output = transformSportsAndLeagues({ items: [{ $ref: "unused" }] }) as any;
  assert.ok(output.count > 20);
  assert.deepEqual(output.leagues[0], { sport: "football", league: "nfl", name: "NFL" });
});

test("cache evicts least-recently-used entries at its entry limit", () => {
  const cache = new TtlCache(60_000, 2, 10_000);
  cache.set("a", { value: 1 }, 60_000);
  cache.set("b", { value: 2 }, 60_000);
  assert.deepEqual(cache.get("a"), { value: 1 });
  cache.set("c", { value: 3 }, 60_000);

  assert.equal(cache.get("b"), undefined);
  assert.deepEqual(cache.get("a"), { value: 1 });
  assert.deepEqual(cache.get("c"), { value: 3 });
  assert.equal(cache.stats().size, 2);
});

test("cache skips an item larger than its byte ceiling", () => {
  const cache = new TtlCache(60_000, 10, 20);
  cache.set("large", { value: "x".repeat(100) }, 60_000);
  assert.equal(cache.stats().size, 0);
});
