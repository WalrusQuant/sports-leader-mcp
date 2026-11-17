/**
 * Offline verdicts for the live contract section. Fixtures only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  eventCount,
  gamelogVerdict,
  gammaEventVerdict,
  gammaMarketVerdict,
  groupsVerdict,
  kalshiVerdict,
  probablesVerdict,
  rangeVerdict,
  singleDateVerdict,
  summaryFields,
  usBboVerdict,
} from "./contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), "utf8"));

test("single-date and range verdicts", () => {
  assert.equal(singleDateVerdict(200, 12).status, "pass");
  assert.equal(singleDateVerdict(200, 0).status, "empty");
  assert.equal(singleDateVerdict(400, null).status, "fail");
  assert.match(singleDateVerdict(400, null).detail, /expected 200/);

  const rejected = rangeVerdict(400, null, "20261018-20261019", "Failed to get events endpoint.");
  assert.equal(rejected.status, "pass");
  assert.match(rejected.detail, /still rejected/);

  const accepted = rangeVerdict(200, 8, "20261018-20261019");
  assert.equal(accepted.status, "info");
  assert.match(accepted.detail, /was HTTP 400/);
  assert.match(accepted.detail, /events=8/);

  assert.equal(rangeVerdict(500, null, "20261018-20261019").status, "fail");
});

test("college basketball group 50 must return more games than the default", () => {
  assert.equal(groupsVerdict(6, 44).status, "pass");
  assert.match(groupsVerdict(6, 44).detail, /44 > default events=6/);
  assert.equal(groupsVerdict(44, 44).status, "fail");
  assert.equal(groupsVerdict(10, 4).status, "fail");
  assert.equal(groupsVerdict(null, 44).status, "fail");
});

test("summary fields and probables shape", () => {
  const live = summaryFields({
    injuries: [{ team: { id: "1" }, injuries: [] }],
    gameInfo: {
      venue: { fullName: "M&T Bank Stadium" },
      weather: { temperature: 48, conditionId: "Clear", gust: 7, precipitation: 0 },
    },
  });
  assert.equal(live.injuries, true);
  assert.equal(live.venueName, "M&T Bank Stadium");
  assert.ok(live.weatherKeys.includes("temperature"));
  assert.ok(live.weatherKeys.includes("gust"));

  const noWeather = summaryFields({ injuries: [], gameInfo: { venue: { fullName: "Highmark Stadium" } } });
  assert.equal(noWeather.weatherKeys.length, 0);
  assert.equal(noWeather.venueName, "Highmark Stadium");

  const nhl = probablesVerdict({
    events: [
      {
        competitions: [
          {
            competitors: [
              {
                probables: [
                  {
                    name: "probableStartingGoalie",
                    displayName: "Probable Starting Goalie",
                    athlete: { displayName: "Jeremy Swayman" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(nhl.status, "pass");
  assert.match(nhl.detail, /Jeremy Swayman/);

  const missing = probablesVerdict({
    events: [{ competitions: [{ competitors: [{ team: { id: "1" } }] }] }],
  });
  assert.equal(missing.status, "fail");
  assert.match(missing.detail, /probables missing/);
  assert.equal(probablesVerdict({ events: [] }).status, "empty");
  assert.equal(eventCount({ events: [] }), 0);
  assert.equal(eventCount({}), null);
});

test("NFL gamelog fixture keeps category counts and repeated labels", () => {
  const verdict = gamelogVerdict(read("test/fixtures/nfl/gamelog.json"));
  assert.equal(verdict.status, "pass");
  assert.match(verdict.detail, /passing\+rushing/);
  assert.match(verdict.detail, /YDS/);
});

test("Kalshi, Gamma, and Polymarket US fixtures", () => {
  const kalshi = kalshiVerdict(read("test/fixtures/nfl/kalshi-markets.json"));
  assert.equal(kalshi.status, "pass");
  assert.match(kalshi.detail, /yes_bid_dollars=/);
  assert.equal(kalshiVerdict({ markets: [] }).status, "empty");
  assert.equal(kalshiVerdict({ markets: [{ ticker: "X", yes_bid: 40, yes_ask: 42 }] }).status, "fail");

  const gamma = gammaEventVerdict(read("test/fixtures/nfl/polymarket-events.json"));
  assert.equal(gamma.status, "pass");
  assert.equal(gamma.event.slug, "nfl-phi-jax-2026-10-11");
  assert.equal(gammaEventVerdict([]).status, "empty");

  const market = gammaMarketVerdict([
    {
      slug: "nfl-phi-jax-2026-10-11",
      sportsMarketType: "moneyline",
      outcomes: '["Eagles","Jaguars"]',
      outcomePrices: '["0.55","0.45"]',
      clobTokenIds: '["1","2"]',
    },
  ]);
  assert.equal(market.status, "pass");
  assert.equal(gammaMarketVerdict([{ sportsMarketType: "moneyline", outcomes: "[]" }]).status, "fail");
  assert.equal(gammaMarketVerdict([]).status, "empty");

  const bbo = usBboVerdict(read("test/fixtures/nfl/polymarket-us.json"));
  assert.equal(bbo.status, "pass");
  assert.match(bbo.detail, /bestBid=0.4100/);
  assert.match(bbo.detail, /bestAsk=0.4300/);
  assert.equal(usBboVerdict({ price: 0.5 }).status, "fail");
  assert.equal(usBboVerdict({ marketData: { bestBid: null, bestAsk: null, state: "MARKET_STATE_EXPIRED" } }).status, "empty");
});
