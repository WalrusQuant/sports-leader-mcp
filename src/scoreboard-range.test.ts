/**
 * Every league scoreboard rejects dates=YYYYMMDD-YYYYMMDD.
 * A requested range is one day at a time, then merged. Week queries stay one request.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { apiCache } from "./client.js";
import { getScoreboard } from "./tools/scoreboard.js";
import { getSlate } from "./tools/slate.js";
import { transformScoreboard, transformSlate } from "./transforms.js";

const FIXTURES = join(fileURLToPath(new URL("..", import.meta.url)), "test", "fixtures", "mens-college-basketball");

function dayFixture(ymd: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, `range-${ymd}.json`), "utf8"));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(handler: (url: string) => Promise<Response> | Response) {
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      return await handler(url);
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
  return {
    calls,
    maxInFlight: () => maxInFlight,
    restore() {
      globalThis.fetch = original;
    },
  };
}

describe("college basketball date ranges", { concurrency: 1 }, () => {
test.beforeEach(() => apiCache.clear());

test("college basketball dateRange fetches each day, dedupes, and sorts by start", async () => {
  const stub = stubFetch(async (url) => {
    const dates = new URL(url).searchParams.get("dates") ?? "";
    await new Promise((resolve) => setTimeout(resolve, 15));
    return jsonResponse(dayFixture(dates));
  });
  try {
    const raw = await getScoreboard.handler({
      sport: "basketball",
      league: "mens-college-basketball",
      dateRange: "20261115-20261117",
    }) as { events: Array<{ id: string; status?: { type?: { shortDetail?: string } } }> };

    assert.equal(stub.calls.length, 3);
    assert.equal(stub.maxInFlight(), 3);
    const dates = stub.calls.map((url) => new URL(url).searchParams.get("dates"));
    assert.deepEqual(dates, ["20261115", "20261116", "20261117"]);
    for (const url of stub.calls) {
      const params = new URL(url).searchParams;
      assert.match(url, /\/basketball\/mens-college-basketball\/scoreboard/);
      assert.equal(params.get("groups"), "50");
      assert.equal(params.get("limit"), "400");
      assert.equal(params.get("dates")?.includes("-"), false);
    }
    assert.deepEqual(raw.events.map((event) => event.id), ["401000002", "401920896", "401000003"]);
    assert.equal(raw.events[0].status?.type?.shortDetail, "Final");

    const compact = transformScoreboard(raw) as {
      events: Array<{ id: string; name: string; competitors: Array<{ team: { id?: string; abbrev?: string } }> }>;
    };
    const wisconsin = compact.events.find((event) => event.id === "401920896");
    assert.equal(wisconsin?.name, "CCU @ WIS");
    assert.equal(wisconsin?.competitors.find((side) => side.team.abbrev === "WIS")?.team.id, "275");
  } finally {
    stub.restore();
  }
});

test("a college basketball range stays at four requests in flight", async () => {
  const stub = stubFetch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    return jsonResponse({ events: [] });
  });
  try {
    await getScoreboard.handler({
      sport: "basketball",
      league: "womens-college-basketball",
      dateRange: "20261115-20261122",
      groups: "8",
    });
    assert.equal(stub.calls.length, 8);
    assert.equal(stub.maxInFlight(), 4);
    for (const url of stub.calls) {
      const params = new URL(url).searchParams;
      assert.match(url, /\/basketball\/womens-college-basketball\/scoreboard/);
      assert.equal(params.get("groups"), "8");
      assert.equal(params.get("limit"), "400");
      assert.equal(params.get("dates")?.includes("-"), false);
    }
  } finally {
    stub.restore();
  }
});

test("a college basketball range longer than 14 days errors before any fetch", async () => {
  const stub = stubFetch(() => jsonResponse({ events: [] }));
  try {
    await getScoreboard.handler({
      sport: "basketball",
      league: "mens-college-basketball",
      dateRange: "20261101-20261114",
    });
    assert.equal(stub.calls.length, 14);
    await assert.rejects(
      () => getScoreboard.handler({
        sport: "basketball",
        league: "mens-college-basketball",
        dateRange: "20261101-20261115",
      }),
      /15 days/,
    );
    await assert.rejects(
      () => getSlate.handler({
        sport: "basketball",
        league: "womens-college-basketball",
        dateRange: "20261116-20261115",
        includeInjuries: true,
      }),
      /ends before it starts/,
    );
    assert.equal(stub.calls.length, 14);
  } finally {
    stub.restore();
  }
});

test("every league splits a dateRange, and NFL and college football weeks stay one request", async () => {
  const stub = stubFetch(async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    return jsonResponse({ events: [] });
  });
  try {
    await getScoreboard.handler({
      sport: "football",
      league: "nfl",
      dateRange: "20261117-20261119",
    });
    assert.deepEqual(
      stub.calls.map((url) => new URL(url).searchParams.get("dates")),
      ["20261117", "20261118", "20261119"],
    );
    assert.equal(stub.maxInFlight(), 3);
    for (const url of stub.calls) {
      const params = new URL(url).searchParams;
      assert.match(url, /\/football\/nfl\/scoreboard/);
      assert.equal(params.get("dates")?.includes("-"), false);
      assert.equal(params.get("groups"), null);
      assert.equal(params.get("limit"), null);
      assert.equal(params.get("week"), null);
    }

    const weekStart = stub.calls.length;
    await getScoreboard.handler({ sport: "football", league: "nfl", week: 11, seasonType: 2 });
    await getScoreboard.handler({ sport: "football", league: "college-football", week: 12, seasonType: 2 });
    assert.equal(stub.calls.length, weekStart + 2);
    const nflWeek = new URL(stub.calls[weekStart]);
    assert.equal(nflWeek.searchParams.get("week"), "11");
    assert.equal(nflWeek.searchParams.get("seasontype"), "2");
    assert.equal(nflWeek.searchParams.get("dates"), null);
    assert.equal(nflWeek.searchParams.get("groups"), null);
    assert.equal(nflWeek.searchParams.get("limit"), null);
    const cfbWeek = new URL(stub.calls[weekStart + 1]);
    assert.match(cfbWeek.pathname, /\/football\/college-football\/scoreboard$/);
    assert.equal(cfbWeek.searchParams.get("week"), "12");
    assert.equal(cfbWeek.searchParams.get("seasontype"), "2");
    assert.equal(cfbWeek.searchParams.get("dates"), null);
    assert.equal(cfbWeek.searchParams.get("groups"), null);
    assert.equal(cfbWeek.searchParams.get("limit"), null);

    await assert.rejects(
      () => getSlate.handler({
        sport: "basketball",
        league: "nba",
        dateRange: "20261101-20261120",
        includeInjuries: true,
      }),
      /20 days/,
    );
    await assert.rejects(
      () => getScoreboard.handler({
        sport: "hockey",
        league: "nhl",
        dateRange: "20261119-20261117",
      }),
      /ends before it starts/,
    );
    assert.equal(stub.calls.length, weekStart + 2);
  } finally {
    stub.restore();
  }
});

test("get_slate splits an NBA range and still fetches injuries once", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("/injuries")) return jsonResponse({ injuries: [] });
    return jsonResponse({ events: [{ id: "1", date: "2026-11-18T00:00Z", competitions: [] }] });
  });
  try {
    const raw = await getSlate.handler({
      sport: "basketball",
      league: "nba",
      dateRange: "20261117-20261119",
    });
    const boards = stub.calls.filter((url) => url.includes("/scoreboard"));
    const injuries = stub.calls.filter((url) => url.includes("/injuries"));
    assert.deepEqual(
      boards.map((url) => new URL(url).searchParams.get("dates")),
      ["20261117", "20261118", "20261119"],
    );
    for (const url of boards) {
      const params = new URL(url).searchParams;
      assert.equal(params.get("groups"), null);
      assert.equal(params.get("limit"), null);
      assert.equal(params.get("dates")?.includes("-"), false);
    }
    assert.equal(injuries.length, 1);
    const slate = transformSlate(raw) as { games: Array<{ eventId: string }> };
    assert.deepEqual(slate.games.map((game) => game.eventId), ["1"]);
  } finally {
    stub.restore();
  }
});

test("get_slate merges the college basketball range and still fetches injuries once", async () => {
  const stub = stubFetch((url) => {
    if (url.includes("/injuries")) return jsonResponse({ injuries: [] });
    const dates = new URL(url).searchParams.get("dates") ?? "";
    return jsonResponse(dayFixture(dates));
  });
  try {
    const raw = await getSlate.handler({
      sport: "basketball",
      league: "mens-college-basketball",
      dateRange: "20261115-20261117",
    });
    const scoreboardCalls = stub.calls.filter((url) => url.includes("/scoreboard"));
    const injuryCalls = stub.calls.filter((url) => url.includes("/injuries"));
    assert.deepEqual(
      scoreboardCalls.map((url) => new URL(url).searchParams.get("dates")),
      ["20261115", "20261116", "20261117"],
    );
    assert.equal(injuryCalls.length, 1);
    const slate = transformSlate(raw) as { games: Array<{ eventId: string; home: { abbrev: string } }> };
    assert.deepEqual(slate.games.map((game) => game.eventId), ["401000002", "401920896", "401000003"]);
    assert.equal(slate.games[1].home.abbrev, "WIS");
  } finally {
    stub.restore();
  }
});
});
