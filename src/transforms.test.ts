import test from "node:test";
import assert from "node:assert/strict";

import {
  applyBudget,
  transformDepthChart,
  transformFutures,
  transformGameProbabilities,
  transformGameSummary,
  transformPowerIndex,
  transformRankings,
  transformScoreboard,
  transformStandings,
  transformSearch,
  transformSportsAndLeagues,
  transformTeam,
  transformTeamStats,
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

test("standings keep the overall record when later splits reuse stat names", () => {
  const output = transformStandings({
    children: [{
      name: "America East",
      standings: {
        entries: [{
          team: { id: "2066", abbreviation: "BING", displayName: "Binghamton Bearcats" },
          stats: [
            { name: "wins", displayValue: "8" },
            { name: "losses", displayValue: "23" },
            { name: "overall", displayValue: "8-23" },
            { name: "wins", displayValue: "7" },
            { name: "Home", displayValue: "7-8" },
          ],
        }],
      },
    }],
  }) as any;
  assert.equal(output.standings[0].entries[0].stats.wins, "8");
  assert.equal(output.standings[0].entries[0].stats.losses, "23");
  assert.equal(output.standings[0].entries[0].stats.Home, "7-8");
});

test("scoreboard keeps athlete name and order for individual sports", () => {
  const output = transformScoreboard({
    events: [{
      id: "golf-1",
      name: "Mexico Open",
      competitions: [{
        competitors: [
          { id: "11332", order: 1, athlete: { displayName: "Andrew Novak" }, score: "-14" },
          { id: "9", order: 0, homeAway: "home", team: { id: "9", abbreviation: "GB", displayName: "Packers" }, score: "10" },
        ],
      }],
    }],
  }) as any;
  assert.deepEqual(output.events[0].competitors[0].athlete, { id: "11332", name: "Andrew Novak" });
  assert.equal(output.events[0].competitors[0].order, 1);
  assert.equal(output.events[0].competitors[1].athlete, undefined);
  assert.equal(output.events[0].competitors[1].order, undefined);
  assert.equal(output.events[0].competitors[1].team.abbrev, "GB");
});

test("win probability transform surfaces an unavailable reason", () => {
  const output = transformGameProbabilities({
    count: 0,
    items: [],
    unavailable: "Probabilities are not supported for sport: hockey",
  }) as any;
  assert.equal(output.count, 0);
  assert.equal(output.probabilities.length, 0);
  assert.match(output.unavailable, /hockey/);
});

test("rankings, power index, futures, and team stats compact to named fields", () => {
  const rankings = transformRankings({
    latestSeason: { year: 2026 },
    latestWeek: { number: 10 },
    rankings: [{
      name: "AP Top 25",
      shortName: "AP Poll",
      ranks: [{ current: 1, previous: 2, points: 1500, firstPlaceVotes: 40, trend: "+1", recordSummary: "8-0", team: { id: "2390", abbreviation: "MIA", displayName: "Miami Hurricanes" } }],
    }],
  }) as any;
  assert.equal(rankings.season, 2026);
  assert.equal(rankings.week, 10);
  assert.equal(rankings.polls[0].ranks[0].team.abbrev, "MIA");
  assert.equal(rankings.polls[0].ranks[0].rank, 1);

  const power = transformPowerIndex({
    season: 2026,
    items: [
      { team: { $ref: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/12" }, predictives: [{ name: "fpi", displayValue: "5.9" }, { name: "fpirank", displayValue: "1st" }] },
      { team: { $ref: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/25" }, predictives: [{ name: "fpi", displayValue: "1.2" }, { name: "fpirank", displayValue: "8th" }] },
    ],
  }) as any;
  assert.equal(power.teams[0].teamId, "12");
  assert.equal(power.teams[0].stats.fpirank, "1st");
  assert.equal(power.teams[1].teamId, "25");

  const futures = transformFutures({
    season: 2026,
    items: [{
      id: 1208,
      displayName: "Regular Season MVP",
      futures: [{
        provider: { name: "DraftKings" },
        books: [
          { athlete: { $ref: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/3139477" }, value: "+170" },
          { team: { $ref: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/teams/12" }, value: "+290" },
        ],
      }],
    }],
  }) as any;
  assert.equal(futures.markets[0].name, "Regular Season MVP");
  assert.equal(futures.markets[0].outcomes[0].athleteId, "3139477");
  assert.equal(futures.markets[0].outcomes[1].teamId, "12");
  assert.equal(futures.markets[0].outcomeCount, 2);

  const stats = transformTeamStats({
    season: { year: 2027, displayName: "2026-27", name: "Regular Season" },
    team: { id: "13", abbreviation: "LAL", displayName: "Los Angeles Lakers" },
    results: {
      stats: { categories: [{ name: "general", displayName: "General", stats: [{ abbreviation: "REB", displayValue: "39.2" }] }] },
      splits: { categories: [{ name: "ignored", stats: [{ abbreviation: "NO", displayValue: "1" }] }] },
    },
  }) as any;
  assert.equal(stats.team.abbrev, "LAL");
  assert.equal(stats.categories.length, 1);
  assert.equal(stats.categories[0].stats.REB, "39.2");
  assert.equal(JSON.stringify(stats).includes("ignored"), false);
});

test("team schedule and depth chart views drop link payloads", () => {
  const schedule = transformTeam({
    season: { year: 2027, type: 2, displayName: "2026-27" },
    team: { id: "130", abbreviation: "MICH", displayName: "Michigan Wolverines" },
    events: [{
      id: "401920982",
      date: "2026-11-01T14:30Z",
      shortName: "ND VS VILL",
      competitions: [{
        competitors: [
          { homeAway: "home", score: "", team: { id: "2226", abbreviation: "ND" } },
        ],
      }],
    }],
  }, { args: { view: "schedule" } }) as any;
  assert.equal(schedule.eventCount, 1);
  assert.equal(schedule.events[0].competitors[0].team.abbrev, "ND");
  assert.equal(schedule.events[0].links, undefined);

  const depth = transformDepthChart({
    season: { year: 2026, name: "Regular Season" },
    team: { id: "12", abbreviation: "KC", displayName: "Kansas City Chiefs" },
    depthchart: {
      0: {
        name: "Base 4-3 D",
        positions: {
          lde: { athletes: [{ id: "4426659", displayName: "George Karlaftis", links: [{ href: "https://www.espn.com/nfl/player" }] }] },
        },
      },
    },
  }) as any;
  assert.equal(depth.formations[0].positions[0].athletes[0].name, "George Karlaftis");
  assert.equal(depth.formations[0].positions[0].athletes[0].links, undefined);

  const empty = transformTeam({ team: { id: "87", abbreviation: "ND" }, season: { year: 2026 } }, { args: { view: "depthcharts" } }) as any;
  assert.equal(empty.formations.length, 0);
  assert.match(empty.note, /no depth chart/);
});

test("articleHasTeam matches team-tagged articles by abbreviation or ID only", async () => {
  const { articleHasTeam } = await import("./tools/league.js");
  const gb = { categories: [{ type: "league", description: "NFL" }, { type: "team", teamId: 9, team: { id: 9, abbreviation: "GB" } }] };
  const cfb = { categories: [{ type: "league", description: "NCAA Football" }, { type: "team", teamId: 130, team: { id: 130, abbreviation: "MICH" } }] };
  assert.equal(articleHasTeam(gb, "GB"), true);
  assert.equal(articleHasTeam(gb, "gb"), true);
  assert.equal(articleHasTeam(gb, "9"), true);
  assert.equal(articleHasTeam(cfb, "GB"), false);
  assert.equal(articleHasTeam({}, "GB"), false);
});
