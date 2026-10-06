import test from "node:test";
import assert from "node:assert/strict";

import {
  consensus,
  decimalToAmerican,
  fractionalToAmerican,
  impliedProb,
  noVig,
  normalizeMarket,
  parseAmerican,
  parseLine,
} from "./odds.js";

const close = (a: number | null, b: number, eps = 1e-4) => {
  assert.ok(a !== null, "expected a number, got null");
  assert.ok(Math.abs((a as number) - b) <= eps, `${a} !~ ${b}`);
};

test("parseAmerican handles numbers, signed strings, EVEN, and junk", () => {
  assert.equal(parseAmerican(185), 185);
  assert.equal(parseAmerican("+185"), 185);
  assert.equal(parseAmerican("-110"), -110);
  assert.equal(parseAmerican("EVEN"), 100);
  assert.equal(parseAmerican(""), null);
  assert.equal(parseAmerican("OFF"), null);
  assert.equal(parseAmerican(0), null);
  assert.equal(parseAmerican(undefined), null);
  assert.equal(parseAmerican(-50), null);
});

test("parseLine handles signed lines, PK, and o/u prefixes", () => {
  assert.equal(parseLine("-3.5"), -3.5);
  assert.equal(parseLine("+1.5"), 1.5);
  assert.equal(parseLine("PK"), 0);
  assert.equal(parseLine("o47.5"), 47.5);
  assert.equal(parseLine("u6"), 6);
  assert.equal(parseLine(""), null);
});

test("decimal and fractional prices convert to American", () => {
  assert.equal(decimalToAmerican(2.5), 150);
  assert.equal(decimalToAmerican(1.5), -200);
  assert.equal(decimalToAmerican(1), null);
  assert.equal(fractionalToAmerican("7/2"), 350);
  assert.equal(fractionalToAmerican("1/2"), -200);
  assert.equal(fractionalToAmerican("EVS"), 100);
  assert.equal(fractionalToAmerican("nope"), null);
});

test("implied probability matches the standard formulas", () => {
  close(impliedProb(-110), 110 / 210);
  close(impliedProb(150), 0.4);
  close(impliedProb(100), 0.5);
  assert.equal(impliedProb(null), null);
});

test("no-vig probabilities sum to 1 for two-way and three-way markets", () => {
  const two = noVig([impliedProb(-110), impliedProb(-110)]) as number[];
  close(two[0], 0.5);
  close(two[0] + two[1], 1, 1e-12);
  const three = noVig([impliedProb(-275), impliedProb(700), impliedProb(400)]) as number[];
  close(three.reduce((a, b) => a + b, 0), 1, 1e-12);
  assert.equal(noVig([0.5, null]), null);
});

test("core-API record: numbers, signed home spread, consensus", () => {
  // Shape of sports.core.api.espn.com .../odds items (trimmed).
  const m = normalizeMarket({
    provider: { id: "100", name: "Draft Kings" },
    details: "DAL -9.5",
    spread: -9.5,
    overUnder: 47.5,
    homeTeamOdds: { moneyLine: -485, current: { pointSpread: { american: "-9.5" } } },
    awayTeamOdds: { moneyLine: 370, current: { pointSpread: { american: "+9.5" } } },
  });
  assert.equal(m.homeMoneyLine, -485);
  assert.equal(m.awayMoneyLine, 370);
  assert.equal(m.homeSpread, -9.5, "negative homeSpread = home favored");
  assert.equal(m.threeWay, false);
  close((m.homeNoVigProb as number) + (m.awayNoVigProb as number), 1, 2e-4);
  assert.ok((m.homeNoVigProb as number) > 0.5);
  assert.ok((m.overround as number) > 0);
  assert.equal(m.noVigReason, null);
});

test("site-API record (scoreboard/pickcenter): string prices and home underdog spread", () => {
  const m = normalizeMarket({
    provider: { id: "100", name: "DraftKings" },
    details: "LAD -110",
    spread: 1.5,
    moneyline: { home: { close: { odds: "-109" } }, away: { close: { odds: "-110" } } },
    pointSpread: { home: { close: { line: "+1.5" } }, away: { close: { line: "-1.5" } } },
    total: { over: { close: { line: "o6" } } },
  });
  assert.equal(m.homeMoneyLine, -109);
  assert.equal(m.awayMoneyLine, -110);
  assert.equal(m.homeSpread, 1.5, "positive homeSpread = home is the underdog on the line");
  assert.equal(m.total, 6, "overUnder missing, so total falls back to the o/u line");
});

test("three-way soccer market includes the draw; missing draw yields null with a reason", () => {
  const full = normalizeMarket({
    provider: { name: "DraftKings" },
    homeTeamOdds: { moneyLine: -275 },
    awayTeamOdds: { moneyLine: 700 },
    drawOdds: { moneyLine: 400 },
  });
  assert.equal(full.threeWay, true);
  close(
    (full.homeNoVigProb as number) + (full.awayNoVigProb as number) + (full.drawNoVigProb as number),
    1,
    3e-4,
  );

  const noDraw = normalizeMarket(
    { provider: { name: "X" }, homeTeamOdds: { moneyLine: -275 }, awayTeamOdds: { moneyLine: 700 } },
    { threeWay: true },
  );
  assert.equal(noDraw.homeNoVigProb, null);
  assert.match(noDraw.noVigReason ?? "", /draw/);
  assert.notEqual(noDraw.homeImpliedProb, null, "implied probability is still reported");
});

test("missing or blank lines produce nulls and a reason, never NaN", () => {
  const blank = normalizeMarket({ provider: { name: "X" }, homeTeamOdds: { moneyLine: "" }, awayTeamOdds: {} });
  assert.equal(blank.homeMoneyLine, null);
  assert.equal(blank.homeNoVigProb, null);
  assert.equal(blank.noVigReason, "no moneyline posted");
  const half = normalizeMarket({ provider: { name: "X" }, homeTeamOdds: { moneyLine: -150 }, awayTeamOdds: {} });
  assert.equal(half.noVigReason, "missing away moneyline");
  assert.ok(!JSON.stringify(half).includes("NaN"));
});

test("consensus averages providers and stays normalized", () => {
  const a = normalizeMarket({ provider: { name: "A" }, homeTeamOdds: { moneyLine: -150 }, awayTeamOdds: { moneyLine: 130 }, spread: -3 });
  const b = normalizeMarket({ provider: { name: "B" }, homeTeamOdds: { moneyLine: -160 }, awayTeamOdds: { moneyLine: 140 }, spread: -3.5 });
  const empty = normalizeMarket({ provider: { name: "C" } });
  const c = consensus([a, b, empty]);
  assert.equal(c.providerCount, 2);
  assert.deepEqual(c.providers, ["A", "B"]);
  close((c.homeNoVigProb as number) + (c.awayNoVigProb as number), 1, 2e-4);
  assert.equal(c.homeSpread, -3.25);
  assert.equal(consensus([]).reason, "no odds available");
  assert.equal(consensus([empty]).reason, "no moneyline posted");
});
