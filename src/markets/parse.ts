/**
 * Pure parsing for Kalshi tickers, Gamma's JSON-string fields, order books,
 * and the UTC-date slug vs local-date usId split. No network.
 */

import { codesEqual } from "./aliases.js";

const MONTHS: Record<string, string> = {
  JAN: "01",
  FEB: "02",
  MAR: "03",
  APR: "04",
  MAY: "05",
  JUN: "06",
  JUL: "07",
  AUG: "08",
  SEP: "09",
  OCT: "10",
  NOV: "11",
  DEC: "12",
};

export interface ParsedKalshiTicker {
  series: string;
  /** Original scheduled date from the ticker, YYYY-MM-DD. Postponed games keep this date. */
  scheduledDate: string;
  awayCode: string;
  homeCode: string;
}

export interface EspnSide {
  abbrev: string;
  location: string;
  name: string;
  displayName: string;
}

/** True for a real YYYY-MM-DD calendar day. 2026-13-99 and 2026-02-31 are not. */
export function isCalendarDate(ymd: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * YYYYMMDD or YYYY-MM-DD to YYYY-MM-DD.
 * Throws when the day is not on the calendar (month 13, February 31).
 */
export function isoDate(input: string): string {
  const ymd = /^\d{8}$/.test(input) ? `${input.slice(0, 4)}-${input.slice(4, 6)}-${input.slice(6, 8)}` : input;
  if (!isCalendarDate(ymd)) {
    throw new Error(`Invalid date "${input}". Use a real calendar day as YYYYMMDD, for example 20261117.`);
  }
  return ymd;
}

/** US Eastern calendar date for an ISO timestamp. Kalshi tickers use this date, not UTC. */
export function easternDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** UTC calendar date. Polymarket global slugs use this, which can be the next day. */
export function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function polymarketGameSlug(sport: string, away: string, home: string, startUtc: string): string {
  return `${sport.toLowerCase()}-${away.toLowerCase()}-${home.toLowerCase()}-${utcDate(startUtc)}`;
}

/** Game slugs are `{sport}-{away}-{home}-{utc date}`. Prop and special events add another suffix. */
export function isGammaGameSlug(sport: string, slug: string | undefined): boolean {
  if (!slug) return false;
  return new RegExp(`^${sport.toLowerCase()}-[a-z0-9]+-[a-z0-9]+-\\d{4}-\\d{2}-\\d{2}$`).test(slug);
}

/** Polymarket US slug. `usId` already carries the local date; do not rebuild it from UTC. */
export function polymarketUsSlug(usId: string): string {
  return usId.startsWith("aec-") ? usId : `aec-${usId}`;
}

/**
 * Split AWAY+HOME. Longer codes win, so LAC is not read as LA.
 * Returns null when the blob is not an ordered pair of known codes.
 */
export function splitTeamBlob(blob: string, codes: readonly string[]): { away: string; home: string } | null {
  const known = new Set(codes.map((code) => code.toUpperCase()));
  const ordered = [...known].sort((a, b) => b.length - a.length || a.localeCompare(b));
  for (const away of ordered) {
    if (!blob.startsWith(away)) continue;
    const home = blob.slice(away.length);
    if (home && known.has(home)) return { away, home };
  }
  return null;
}

/** `KXNFLGAME-26NOV15MINGB` -> series, original date, away, home. */
export function parseKalshiEventTicker(eventTicker: string, codes: readonly string[]): ParsedKalshiTicker | null {
  const match = eventTicker.match(/^([A-Z0-9]+)-(\d{2})([A-Z]{3})(\d{2})([A-Z0-9]+)$/);
  if (!match) return null;
  const series = match[1] ?? "";
  const year = match[2] ?? "";
  const month = MONTHS[match[3] ?? ""];
  const day = match[4] ?? "";
  const blob = (match[5] ?? "").replace(/\d+$/, "");
  if (!month) return null;
  const teams = splitTeamBlob(blob, codes);
  if (!teams) return null;
  return {
    series,
    scheduledDate: `20${year}-${month}-${day}`,
    awayCode: teams.away,
    homeCode: teams.home,
  };
}

export function kalshiOutcomeCode(eventTicker: string, marketTicker: string): string {
  const prefix = `${eventTicker}-`;
  return marketTicker.startsWith(prefix) ? marketTicker.slice(prefix.length) : "";
}

/** Dollar string or number to a 0-1 price. Blank and non-numeric become null. */
export function dollarPrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 10000) / 10000;
}

export interface BookLevel {
  price: number;
  size: number;
}

/**
 * Kalshi books are bids only. The yes ask is 1 minus the best (highest) no bid.
 * Levels may arrive in either order; the best bid is the max price, not level 0.
 */
export function kalshiTopOfBook(orderbook: unknown): {
  priceSource: "orderbook";
  bestYesBid: number | null;
  bestNoBid: number | null;
  yesAsk: number | null;
  noAsk: number | null;
  yesBidSize: number | null;
  noBidSize: number | null;
} {
  const root = asRecord(orderbook);
  const fp = asRecord(root.orderbook_fp);
  const legacy = asRecord(root.orderbook);
  const yes = levels(fp.yes_dollars, false) ?? levels(legacy.yes, true) ?? [];
  const no = levels(fp.no_dollars, false) ?? levels(legacy.no, true) ?? [];
  const bestYes = bestLevel(yes);
  const bestNo = bestLevel(no);
  return {
    priceSource: "orderbook",
    bestYesBid: bestYes?.price ?? null,
    bestNoBid: bestNo?.price ?? null,
    yesAsk: bestNo ? dollarPrice(1 - bestNo.price) : null,
    noAsk: bestYes ? dollarPrice(1 - bestYes.price) : null,
    yesBidSize: bestYes?.size ?? null,
    noBidSize: bestNo?.size ?? null,
  };
}

/**
 * CLOB `/book` bids are worst-first in practice. Best bid is the highest bid
 * and best ask is the lowest ask. Mid is labelled as taken from this book.
 */
export function clobTopOfBook(book: unknown): {
  priceSource: "clob_book";
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  mid: number | null;
} {
  const root = asRecord(book);
  const bids = levels(root.bids, false) ?? [];
  const asks = levels(root.asks, false) ?? [];
  const bid = bestLevel(bids);
  const ask = asks.reduce<BookLevel | null>((best, level) => (best === null || level.price < best.price ? level : best), null);
  const mid = bid && ask ? dollarPrice((bid.price + ask.price) / 2) : null;
  return {
    priceSource: "clob_book",
    bid: bid?.price ?? null,
    ask: ask?.price ?? null,
    bidSize: bid?.size ?? null,
    askSize: ask?.size ?? null,
    mid,
  };
}

/** Gamma sends `outcomes` and `clobTokenIds` as JSON strings, sometimes as arrays. */
export function decodeGammaStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value !== "string") return [];
  const text = value.trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeMarketType(input?: string): { key: "winner" | "spread" | "total" | "other"; gamma: string } {
  const value = (input ?? "moneyline").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (value === "winner" || value === "moneyline" || value === "ml" || value === "h2h") {
    return { key: "winner", gamma: "moneyline" };
  }
  if (value === "spread" || value === "spreads") return { key: "spread", gamma: "spreads" };
  if (value === "total" || value === "totals") return { key: "total", gamma: "totals" };
  return { key: "other", gamma: value };
}

export type OddsVenue = "kalshi" | "polymarket" | "polymarket_us";
export type PolymarketVenueChoice = "both" | "polymarket" | "polymarket_us";
export type OddsVenueChoice = "all" | OddsVenue;

export function polymarketVenues(choice: PolymarketVenueChoice = "both"): Array<"polymarket" | "polymarket_us"> {
  if (choice === "polymarket") return ["polymarket"];
  if (choice === "polymarket_us") return ["polymarket_us"];
  return ["polymarket", "polymarket_us"];
}

export function oddsVenues(choice: OddsVenueChoice = "all"): OddsVenue[] {
  if (choice === "all") return ["kalshi", "polymarket", "polymarket_us"];
  return [choice];
}

export function normLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Name/code match for one side. A one-letter Kalshi suffix ("Los Angeles C") selects the nickname. */
export function labelMatchesTeam(team: EspnSide, label: string): boolean {
  const lab = normLabel(label);
  if (!lab) return false;
  const loc = normLabel(team.location);
  const nick = normLabel(team.name);
  const disp = normLabel(team.displayName);
  if (lab === loc || lab === nick || lab === disp) return true;
  if (loc && nick && (lab === `${loc} ${nick}` || lab === `${nick} ${loc}`)) return true;
  if (loc && lab.startsWith(`${loc} `)) {
    const rest = lab.slice(loc.length + 1);
    if (nick && (nick.startsWith(rest) || rest.startsWith(nick))) return true;
  }
  const stripped = lab.replace(/\b(st|state)\b/g, (word) => (word === "st" ? "state" : word)).trim();
  if (stripped !== lab && (stripped === loc || stripped === disp || stripped === `${loc} ${nick}`)) return true;
  return false;
}

export function sideMatches(
  league: string,
  team: EspnSide,
  code: string | undefined,
  labels: Array<string | undefined>,
): boolean {
  if (code && codesEqual(league, team.abbrev, code)) return true;
  return labels.some((label) => (label ? labelMatchesTeam(team, label) : false));
}

/**
 * Drop Gamma events `active=true` still returns after they have started.
 * When Gamma sends eventDate, that local date is the only match. A late
 * tip the same UTC day (POR@MIN at 01:00Z) stays on the previous eventDate.
 * Eastern and UTC dates are the fallback for an event with no eventDate.
 */
export function gammaEventOnDate(
  event: { eventDate?: string | null; startTime?: string | null },
  ymd: string,
): boolean {
  if (event.eventDate) return event.eventDate === ymd;
  if (!event.startTime) return false;
  return easternDate(event.startTime) === ymd || utcDate(event.startTime) === ymd;
}

/**
 * One team on a scoreboard or market. Codes go through the alias table.
 * A name match is exact, or a phrase that starts on a word boundary, so
 * "Kansas" matches Kansas and Kansas State and does not match Arkansas.
 */
export function teamHits(
  league: string,
  side: { abbr?: string; abbrev?: string; location?: string; name?: string; displayName?: string; shortDisplayName?: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  const abbr = side.abbr || side.abbrev || "";
  if (abbr && codesEqual(league, abbr, query)) return true;
  const fields = [side.location, side.name, side.displayName, side.shortDisplayName]
    .map((value) => (value ?? "").trim().toLowerCase())
    .filter(Boolean);
  if (fields.some((value) => value === needle)) return true;
  if (needle.length < 4) return false;
  return fields.some((value) => phraseAtWordStart(value, needle));
}

function phraseAtWordStart(field: string, needle: string): boolean {
  let from = 0;
  while (from <= field.length - needle.length) {
    const idx = field.indexOf(needle, from);
    if (idx < 0) return false;
    const beforeOk = idx === 0 || !/[a-z0-9]/i.test(field[idx - 1] ?? "");
    if (beforeOk) return true;
    from = idx + 1;
  }
  return false;
}

/** Keep live and upcoming events. Past events stay in the Gamma `active=true` feed. */
export function gammaEventIsCurrent(
  event: { eventDate?: string | null; startTime?: string | null },
  now: Date,
): boolean {
  if (event.startTime) {
    const start = new Date(event.startTime).getTime();
    if (Number.isFinite(start)) return start >= now.getTime() - 36 * 60 * 60 * 1000;
  }
  if (event.eventDate) return event.eventDate >= easternDate(now.toISOString());
  return false;
}

export function lineFromTitle(title: string): number | null {
  const match = title.match(/over\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!match?.[1]) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function levels(value: unknown, cents: boolean): BookLevel[] | null {
  if (!Array.isArray(value)) return null;
  const out: BookLevel[] = [];
  for (const row of value) {
    if (Array.isArray(row) && row.length >= 2) {
      const price = dollarPrice(cents ? Number(row[0]) / 100 : row[0]);
      const size = dollarPrice(row[1]);
      if (price !== null && size !== null) out.push({ price, size });
      continue;
    }
    const rec = asRecord(row);
    const price = dollarPrice(rec.price);
    const size = dollarPrice(rec.size);
    if (price !== null && size !== null) out.push({ price, size });
  }
  return out;
}

function bestLevel(levelsIn: BookLevel[]): BookLevel | null {
  return levelsIn.reduce<BookLevel | null>((best, level) => (best === null || level.price > best.price ? level : best), null);
}
