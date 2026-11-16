import test from "node:test";
import assert from "node:assert/strict";

import {
  candidatesFromSearch,
  namedSeasonStats,
  normalizePlayerName,
  recentGames,
  recentGamesFromGamelog,
  resolvePlayer,
  type AthleteCandidate,
  type GamelogGame,
} from "./tools/player-report.js";

const JACOBS_NFL: AthleteCandidate = {
  id: "4047365",
  name: "Josh Jacobs",
  team: "Green Bay Packers",
  league: "nfl",
  sport: "football",
};

const JACOBS_NCAAM: AthleteCandidate = {
  id: "8277",
  name: "Josh Jacobs",
  team: "Little Rock Trojans",
  league: "mens-college-basketball",
  sport: "basketball",
};

const JACOBS_JR: AthleteCandidate = {
  id: "999",
  name: "Josh Jacobs Jr.",
  league: "nfl",
  sport: "football",
};

const SEARCH = {
  results: [
    {
      type: "player",
      contents: [
        {
          uid: "s:20~l:28~a:4047365",
          type: "player",
          displayName: "Josh Jacobs",
          sport: "football",
          defaultLeagueSlug: "nfl",
          subtitle: "Green Bay Packers",
        },
        {
          uid: "s:40~l:41~a:8277",
          type: "player",
          displayName: "Josh Jacobs",
          sport: "basketball",
          defaultLeagueSlug: "mens-college-basketball",
          subtitle: "Little Rock Trojans",
        },
        {
          uid: "s:20~l:23~a:173587",
          type: "player",
          displayName: "Josh Jacobson",
          sport: "football",
          defaultLeagueSlug: "college-football",
          subtitle: "Eastern Washington Eagles",
        },
      ],
    },
    {
      type: "article",
      contents: [{ type: "story", displayName: "Packers' Josh Jacobs needs surgery" }],
    },
  ],
};

test("search for josh jacobs keeps both players, and nfl resolves to 4047365", () => {
  assert.equal(normalizePlayerName("  Josh Jacobs "), "josh jacobs");
  const candidates = candidatesFromSearch(SEARCH);
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["4047365", "8277", "173587"]);
  const resolved = resolvePlayer(candidates, "nfl", "josh jacobs");
  assert.equal(resolved.resolved, true);
  if (resolved.resolved) assert.equal(resolved.athlete.id, "4047365");
});

test("two players in the same league are candidates, not a guess", () => {
  const tied = resolvePlayer([JACOBS_NFL, { ...JACOBS_NFL, id: "111", team: "Las Vegas Raiders" }], "nfl", "Josh Jacobs");
  assert.equal(tied.resolved, false);
  if (!tied.resolved) {
    assert.equal(tied.reason, "ambiguous");
    assert.deepEqual(tied.candidates.map((candidate) => candidate.id).sort(), ["111", "4047365"]);
  }
  const exact = resolvePlayer([JACOBS_NFL, JACOBS_JR], "nfl", "josh jacobs");
  assert.equal(exact.resolved, true);
  if (exact.resolved) assert.equal(exact.athlete.id, "4047365");
  const missing = resolvePlayer([JACOBS_NCAAM], "nfl", "josh jacobs");
  assert.equal(missing.resolved, false);
  if (!missing.resolved) {
    assert.equal(missing.reason, "not_found");
    assert.equal(missing.candidates[0]?.id, "8277");
  }
});

test("named season stats keep one year and a 2026-27 label matches both years", () => {
  const raw = {
    categories: [
      {
        name: "rushing",
        labels: ["CAR", "YDS"],
        statistics: [
          { season: { year: 2026, displayName: "2026" }, position: "RB", stats: ["36", "80"], team: { id: "9", abbreviation: "GB", displayName: "Packers" } },
          { season: { year: 2025, displayName: "2025" }, position: "RB", stats: ["234", "929"] },
        ],
      },
    ],
  };
  const latest = namedSeasonStats(raw);
  assert.equal(latest.year, 2026);
  assert.equal(latest.categories.length, 1);
  assert.equal(latest.categories[0]?.stats.CAR, "36");
  assert.equal(latest.categories[0]?.team?.abbrev, "GB");
  assert.equal(namedSeasonStats(raw, 2025).categories[0]?.stats.YDS, "929");

  const spanned = namedSeasonStats({
    categories: [{
      name: "general",
      labels: ["PTS"],
      statistics: [{ season: { year: 2026, displayName: "2026-27" }, stats: ["28"] }],
    }],
  }, 2027);
  assert.equal(spanned.year, 2027);
  assert.equal(spanned.categories[0]?.stats.PTS, "28");
});

test("Jacobs Detroit row keeps rushing and receiving yards", () => {
  // ESPN gamelog for 2026-10-25 at DET. labels repeat YDS, AVG, TD, and LNG.
  const raw = {
    categories: [
      { name: "rushing", displayName: "Rushing", count: 5 },
      { name: "receiving", displayName: "Receiving", count: 6 },
      { name: "fumbles", displayName: "Fumbles", count: 4 },
    ],
    labels: ["CAR", "YDS", "AVG", "TD", "LNG", "REC", "TGTS", "YDS", "AVG", "TD", "LNG", "FUM", "LST", "FF", "KB"],
    names: [
      "rushingAttempts", "rushingYards", "yardsPerRushAttempt", "rushingTouchdowns", "longRushing",
      "receptions", "receivingTargets", "receivingYards", "yardsPerReception", "receivingTouchdowns", "longReception",
      "fumbles", "fumblesLost", "fumblesForced", "kicksBlocked",
    ],
    events: {
      "401873020": {
        id: "401873020",
        gameDate: "2026-10-25T20:25:00.000+00:00",
        score: "20-17",
        homeTeamId: "8",
        gameResult: "L",
        opponent: { abbreviation: "DET", displayName: "Detroit Lions" },
        team: { id: "9", abbreviation: "GB" },
      },
    },
    seasonTypes: [{
      displayName: "2026 Regular Season",
      categories: [{
        displayName: "Regular Season Stats",
        events: [{
          eventId: "401873020",
          stats: ["11", "36", "3.3", "0", "10", "5", "7", "55", "11.0", "1", "25", "0", "0", "-", "-"],
        }],
      }],
    }],
  };
  const [game] = recentGamesFromGamelog(raw, 5);
  assert.equal(game?.eventId, "401873020");
  assert.equal(game?.opponent, "DET");
  assert.equal(game?.homeAway, "A");
  const rushing = game?.stats.rushing as Record<string, string>;
  const receiving = game?.stats.receiving as Record<string, string>;
  assert.equal(rushing.CAR, "11");
  assert.equal(rushing.YDS, "36");
  assert.equal(rushing.TD, "0");
  assert.equal(receiving.REC, "5");
  assert.equal(receiving.TGTS, "7");
  assert.equal(receiving.YDS, "55");
  assert.equal(receiving.TD, "1");
  assert.equal(receiving.LNG, "25");
});

test("recent games are the latest rows, most recent first", () => {
  const games: GamelogGame[] = [
    { eventId: "1", date: "2026-10-01T00:00:00Z", opponent: "A", homeAway: "H", stats: { YDS: "1" } },
    { eventId: "2", date: "2026-10-20T00:00:00Z", opponent: "B", homeAway: "A", stats: { YDS: "2" } },
    { eventId: "3", date: "2026-10-10T00:00:00Z", opponent: "C", homeAway: "H", stats: { YDS: "3" } },
  ];
  assert.deepEqual(recentGames({ games }, 2).map((game) => game.eventId), ["2", "3"]);
});
