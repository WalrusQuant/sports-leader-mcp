/**
 * Odds normalization shared by get_game_odds, get_scoreboard, get_game_summary,
 * and get_slate.
 *
 * ESPN ships betting markets in two shapes:
 *   - Core API (`sports.core.api.espn.com/.../odds`): `homeTeamOdds.moneyLine`
 *     as a number plus `current/open` blocks with `american` strings.
 *   - Site API (scoreboard `competitions[].odds`, summary `pickcenter`):
 *     `moneyline.home.close.odds` strings, `pointSpread.home.close.line`.
 *
 * `normalizeMarket` reads either shape and returns one flat, numeric record so
 * an agent can compare a sportsbook price with a prediction-market price
 * (e.g. Kalshi) without doing any odds math itself.
 *
 * Conventions (also exposed in tool output as `spreadConvention`):
 *   - Moneylines are American odds as numbers (+185, -225). EVEN → +100.
 *   - impliedProb = raw break-even probability of the price (includes vig).
 *   - noVigProb = impliedProb normalized so all outcomes sum to 1
 *     (proportional / multiplicative method). For three-way markets (soccer)
 *     the draw is included; if a draw is possible but unpriced, no-vig is null
 *     with a `noVigReason` instead of a biased two-way number.
 *   - homeSpread is the home team's point spread: negative = home favored.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

export const SPREAD_CONVENTION =
  "homeSpread is the home team's spread: negative means the home team is favored (e.g. -3.5 = home gives 3.5).";

export const NO_VIG_METHOD =
  "Proportional: each outcome's implied probability divided by the sum across all outcomes (draw included for three-way markets).";

export interface NormalizedMarket {
  provider: string;
  providerId: string | null;
  threeWay: boolean;
  homeMoneyLine: number | null;
  awayMoneyLine: number | null;
  drawMoneyLine: number | null;
  homeImpliedProb: number | null;
  awayImpliedProb: number | null;
  drawImpliedProb: number | null;
  homeNoVigProb: number | null;
  awayNoVigProb: number | null;
  drawNoVigProb: number | null;
  /** Sum of implied probabilities minus 1 (the bookmaker margin). */
  overround: number | null;
  noVigReason: string | null;
  homeSpread: number | null;
  total: number | null;
}

export interface Consensus {
  providerCount: number;
  providers: string[];
  homeNoVigProb: number | null;
  awayNoVigProb: number | null;
  drawNoVigProb: number | null;
  homeSpread: number | null;
  total: number | null;
  method: string;
  reason: string | null;
}

function d(v: unknown): AnyObj {
  return v !== null && typeof v === "object" ? (v as AnyObj) : {};
}

export function round(n: number, dp = 4): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Parse an American price from a number or string ("+185", "-110", "EVEN").
 * Returns null for blanks, "OFF", NaN, and values with |x| < 100 (not a valid
 * American price — ESPN occasionally ships 0 for a pulled line).
 */
export function parseAmerican(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else {
    const s = String(value).trim().toUpperCase();
    if (s === "") return null;
    if (s === "EVEN" || s === "EV" || s === "EVN") return 100;
    n = Number(s.replace(/^\+/, ""));
  }
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return n;
}

/** Parse a spread/total line ("-3.5", "+1.5", "PK", "o47.5", "u6"). */
export function parseLine(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value).trim().toUpperCase();
  if (s === "") return null;
  if (s === "PK" || s === "PICK" || s === "EVEN") return 0;
  const n = Number(s.replace(/^[OU]/, "").replace(/^\+/, ""));
  return Number.isFinite(n) ? n : null;
}

/** Break-even probability of an American price (includes the vig). */
export function impliedProb(american: number | null): number | null {
  if (american === null) return null;
  return american < 0 ? -american / (-american + 100) : 100 / (american + 100);
}

/**
 * Remove the vig proportionally. Returns null when any probability is missing.
 * The returned probabilities sum to 1 before rounding.
 */
export function noVig(probs: Array<number | null>): number[] | null {
  if (probs.some((p) => p === null || !Number.isFinite(p) || p <= 0)) return null;
  const sum = (probs as number[]).reduce((a, b) => a + b, 0);
  return (probs as number[]).map((p) => p / sum);
}

function firstNonNull<T>(...vals: Array<T | null>): T | null {
  for (const v of vals) if (v !== null) return v;
  return null;
}

export interface NormalizeOptions {
  /** Force three-way handling (e.g. sport === "soccer") even if no draw price is listed. */
  threeWay?: boolean;
}

/** Normalize one ESPN odds record (core or site shape) into a NormalizedMarket. */
export function normalizeMarket(item: unknown, opts: NormalizeOptions = {}): NormalizedMarket {
  const it = d(item);
  const home = d(it.homeTeamOdds);
  const away = d(it.awayTeamOdds);
  const ml = d(it.moneyline);
  const ps = d(it.pointSpread);
  const total = d(it.total);

  const homeMoneyLine = firstNonNull(
    parseAmerican(home.moneyLine),
    parseAmerican(d(d(home.current).moneyLine).american),
    parseAmerican(d(d(ml.home).close).odds),
  );
  const awayMoneyLine = firstNonNull(
    parseAmerican(away.moneyLine),
    parseAmerican(d(d(away.current).moneyLine).american),
    parseAmerican(d(d(ml.away).close).odds),
  );
  const drawMoneyLine = firstNonNull(
    parseAmerican(d(it.drawOdds).moneyLine),
    parseAmerican(d(d(d(it.drawOdds).current).moneyLine).american),
    parseAmerican(d(d(ml.draw).close).odds),
  );

  const threeWay = drawMoneyLine !== null || opts.threeWay === true;

  const hp = impliedProb(homeMoneyLine);
  const ap = impliedProb(awayMoneyLine);
  const dp = threeWay ? impliedProb(drawMoneyLine) : null;

  let reason: string | null = null;
  let fair: number[] | null = null;
  if (homeMoneyLine === null && awayMoneyLine === null) {
    reason = "no moneyline posted";
  } else if (homeMoneyLine === null) {
    reason = "missing home moneyline";
  } else if (awayMoneyLine === null) {
    reason = "missing away moneyline";
  } else if (threeWay && drawMoneyLine === null) {
    reason = "draw is possible but no draw price is posted; two-way no-vig would be biased";
  } else {
    fair = noVig(threeWay ? [hp, ap, dp] : [hp, ap]);
    if (!fair) reason = "invalid prices";
  }

  const impliedSum = fair ? (hp as number) + (ap as number) + (threeWay ? (dp as number) : 0) : null;

  // ESPN's top-level `spread` is home-relative in both shapes (verified against
  // pointSpread.home lines in the fixtures), so it is the last-resort fallback.
  const homeSpread = firstNonNull(
    parseLine(d(d(home.current).pointSpread).american),
    parseLine(d(d(ps.home).close).line),
    typeof it.spread === "number" && Number.isFinite(it.spread) ? it.spread : null,
  );

  const totalLine = firstNonNull(
    typeof it.overUnder === "number" && Number.isFinite(it.overUnder) ? it.overUnder : null,
    parseLine(d(d(total.over).close).line),
  );

  return {
    provider: String(d(it.provider).name ?? d(it.provider).displayName ?? d(it.provider).id ?? ""),
    providerId: d(it.provider).id !== undefined ? String(d(it.provider).id) : null,
    threeWay,
    homeMoneyLine,
    awayMoneyLine,
    drawMoneyLine: threeWay ? drawMoneyLine : null,
    homeImpliedProb: hp === null ? null : round(hp),
    awayImpliedProb: ap === null ? null : round(ap),
    drawImpliedProb: dp === null ? null : round(dp),
    homeNoVigProb: fair ? round(fair[0]) : null,
    awayNoVigProb: fair ? round(fair[1]) : null,
    drawNoVigProb: fair && threeWay ? round(fair[2]) : null,
    overround: impliedSum === null ? null : round(impliedSum - 1),
    noVigReason: reason,
    homeSpread,
    total: totalLine,
  };
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Consensus across providers: mean of each provider's no-vig probabilities
 * (re-normalized so they still sum to 1), median spread and total.
 */
export function consensus(markets: NormalizedMarket[]): Consensus {
  const priced = markets.filter((m) => m.homeNoVigProb !== null && m.awayNoVigProb !== null);
  const threeWay = priced.some((m) => m.threeWay);
  const usable = threeWay ? priced.filter((m) => m.drawNoVigProb !== null) : priced;

  let home: number | null = null;
  let away: number | null = null;
  let draw: number | null = null;
  let reason: string | null = null;
  if (usable.length) {
    const mean = (k: "homeNoVigProb" | "awayNoVigProb" | "drawNoVigProb") =>
      usable.reduce((a, m) => a + (m[k] as number), 0) / usable.length;
    const parts = threeWay ? [mean("homeNoVigProb"), mean("awayNoVigProb"), mean("drawNoVigProb")] : [mean("homeNoVigProb"), mean("awayNoVigProb")];
    const fair = noVig(parts) as number[];
    home = round(fair[0]);
    away = round(fair[1]);
    draw = threeWay ? round(fair[2]) : null;
  } else {
    reason = markets.length
      ? markets.find((m) => m.noVigReason)?.noVigReason ?? "no provider has a complete moneyline"
      : "no odds available";
  }

  return {
    providerCount: usable.length,
    providers: usable.map((m) => m.provider),
    homeNoVigProb: home,
    awayNoVigProb: away,
    drawNoVigProb: draw,
    homeSpread: median(markets.map((m) => m.homeSpread).filter((x): x is number => x !== null)),
    total: median(markets.map((m) => m.total).filter((x): x is number => x !== null)),
    method: "Mean of per-provider no-vig probabilities, re-normalized; median homeSpread and total.",
    reason,
  };
}
