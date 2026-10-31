/**
 * Handler-level tests for the 2026-10-31 ESPN fixes. These stub global fetch
 * (and do not install the fixture router) so they can assert which URL is
 * called when an endpoint 400s or returns an empty document.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { apiCache } from "./client.js";
import { seasonLeadersPaths } from "./season.js";
import { getLeagueLeaders } from "./tools/league.js";
import { getGameProbabilities } from "./tools/scoreboard.js";
import { getTeam, getTeams } from "./tools/teams.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(handler: (url: string) => Response) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return handler(url);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

describe("espn endpoint fixes", { concurrency: 1 }, () => {
test.beforeEach(() => apiCache.clear());

test("season leaders prefer regular season, then soccer's type 1", () => {
  const paths = seasonLeadersPaths("soccer", "eng.1", 2025);
  assert.equal(paths.length, 2);
  assert.match(paths[0], /\/seasons\/2025\/types\/2\/leaders$/);
  assert.match(paths[1], /\/seasons\/2025\/types\/1\/leaders$/);
  const only = seasonLeadersPaths("basketball", "nba", 2027, { seasonType: 3, teamId: "13" });
  assert.equal(only.length, 1);
  assert.match(only[0], /\/seasons\/2027\/types\/3\/teams\/13\/leaders$/);
});

test("get_league_leaders uses the season path and skips all-time when that works", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("/seasons/2027/types/2/leaders")) {
      return jsonResponse(200, { $ref: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2027/types/2/leaders", categories: [] });
    }
    if (url.endsWith("/leagues/nba")) {
      return jsonResponse(200, { season: { year: 2027 } });
    }
    return jsonResponse(404, { error: { message: "no", code: 404 } });
  });
  try {
    const data = await getLeagueLeaders.handler({ sport: "basketball", league: "nba" }) as { categories: unknown[] };
    assert.ok(Array.isArray(data.categories));
    assert.ok(stub.calls.some((url) => url.includes("/seasons/2027/types/2/leaders")));
    assert.equal(stub.calls.some((url) => /\/leaders(\?|$)/.test(url) && !url.includes("/seasons/")), false);
  } finally {
    stub.restore();
  }
});

test("get_league_leaders falls through type 2 to type 1", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("/types/1/leaders")) return jsonResponse(200, { categories: [{ name: "goals" }] });
    if (url.endsWith("/leagues/eng.1")) return jsonResponse(200, { season: { year: 2025 } });
    return jsonResponse(404, { error: { message: "No stats found.", code: 404 } });
  });
  try {
    const data = await getLeagueLeaders.handler({ sport: "soccer", league: "eng.1", season: 2025 }) as { categories: Array<{ name: string }> };
    assert.equal(data.categories[0].name, "goals");
    assert.ok(stub.calls.some((url) => url.includes("/types/2/leaders")));
    assert.ok(stub.calls.some((url) => url.includes("/types/1/leaders")));
  } finally {
    stub.restore();
  }
});

test("get_teams asks for the full college list", async () => {
  const stub = stubFetch(() => jsonResponse(200, { sports: [{ leagues: [{ teams: [] }] }] }));
  try {
    await getTeams.handler({ sport: "football", league: "college-football" });
    assert.match(stub.calls[0], /\/football\/college-football\/teams\?limit=1000$/);
  } finally {
    stub.restore();
  }
});

test("get_game_probabilities turns a 400 into an empty timeline", async () => {
  const stub = stubFetch(() => jsonResponse(400, {
    error: { message: "Probabilities are not supported for sport: hockey, league: nhl", code: 400 },
  }));
  try {
    const data = await getGameProbabilities.handler({
      sport: "hockey",
      league: "nhl",
      eventId: "401892596",
    }) as { count: number; unavailable: string };
    assert.equal(data.count, 0);
    assert.match(data.unavailable, /not supported/);
  } finally {
    stub.restore();
  }
});

test("empty preseason schedule retries regular season", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("seasontype=2")) {
      return jsonResponse(200, { season: { year: 2027, type: 2 }, events: [{ id: "401920982" }] });
    }
    return jsonResponse(200, { season: { year: 2027, type: 1, name: "Preseason" }, events: [] });
  });
  try {
    const data = await getTeam.handler({
      sport: "basketball",
      league: "mens-college-basketball",
      teamId: "130",
      view: "schedule",
    }) as { events: Array<{ id: string }> };
    assert.equal(data.events[0].id, "401920982");
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test("team news, transactions, and leaders do not call the empty sub-resources", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("/news")) {
      return jsonResponse(200, {
        articles: [{
          headline: "Lakers win",
          categories: [{ type: "team", team: { id: "13", abbreviation: "LAL" }, description: "Lakers" }],
        }],
      });
    }
    if (url.includes("/transactions")) return jsonResponse(200, { transactions: [{ description: "Signed a player." }] });
    if (url.includes("/teams/13/leaders")) return jsonResponse(200, { categories: [{ name: "pointsPerGame" }] });
    if (url.endsWith("/leagues/nba")) return jsonResponse(200, { season: { year: 2027 } });
    return jsonResponse(200, {});
  });
  try {
    const news = await getTeam.handler({ sport: "basketball", league: "nba", teamId: "13", view: "news" }) as { headlines: unknown[] };
    assert.equal(news.headlines.length, 1);
    const tx = await getTeam.handler({ sport: "basketball", league: "nba", teamId: "13", view: "transactions" }) as { transactions: unknown[] };
    assert.equal(tx.transactions.length, 1);
    const leaders = await getTeam.handler({ sport: "basketball", league: "nba", teamId: "13", view: "leaders", season: 2027 }) as { categories: unknown[] };
    assert.equal(leaders.categories.length, 1);
    assert.equal(
      stub.calls.some((url) => /\/site\/v2\/sports\/[^/]+\/[^/]+\/teams\/13\/(news|transactions|leaders)/.test(url)),
      false,
    );
    assert.ok(stub.calls.some((url) => url.includes("/seasons/2027/types/2/teams/13/leaders")));
  } finally {
    stub.restore();
  }
});
});
