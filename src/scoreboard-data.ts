/**
 * Decide which scoreboard days come from the games export and which stay on
 * ESPN, and turn games rows into the scoreboard event shape the transforms
 * already compact.
 *
 * A day is served from the export when it is strictly older than the games
 * file (the earlier of that file's updated_at and the manifest generated_at)
 * and strictly older than today and the previous two US-Eastern days. Those
 * three days, and every future day, stay on live ESPN. game_id is the ESPN
 * event id.
 */
import type { DataLeague } from "./data/datasets.js";
import type { Manifest, ManifestFile } from "./data/manifest.js";

/** Today and the previous two Eastern days stay on ESPN even when the file is current. */
export const LIVE_ESPN_LOOKBACK_DAYS = 2;
export const ESPN_RANGE_DAY_CAP = 14;

const END_YEAR = new Set<DataLeague>(["nba", "nhl", "cbb"]);

export type DayReason = "export" | "live" | "future" | "stale" | "missing-season" | "groups" | "unavailable";

export interface DayPlan {
  date: string;
  source: "data" | "espn";
  reason: DayReason;
  season: number | null;
}

export interface ScoreboardPlan {
  days: DayPlan[];
  dataDays: string[];
  espnDays: string[];
  seasons: number[];
}

export function dataLeagueFor(sport: string, league: string): DataLeague | null {
  if (sport === "basketball" && league === "nba") return "nba";
  if (sport === "basketball" && league === "mens-college-basketball") return "cbb";
  if (sport === "football" && league === "nfl") return "nfl";
  if (sport === "football" && league === "college-football") return "cfb";
  if (sport === "baseball" && league === "mlb") return "mlb";
  if (sport === "hockey" && league === "nhl") return "nhl";
  return null;
}

/**
 * Men's college basketball group 50 is the Division I set the export publishes.
 * Any other group, including a conference id, is not a column in the file.
 */
export function groupsBlockData(dataLeague: DataLeague, groups: string | undefined): boolean {
  if (!groups) return false;
  return !(dataLeague === "cbb" && groups === "50");
}

export function easternYmd(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");
}

export function addDays(ymd: string, days: number): string {
  const utc = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
  const shifted = new Date(utc + days * 86_400_000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}${month}${day}`;
}

export function ymdToIso(ymd: string): string {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

/** NBA, NHL, and men's college basketball are named by the year they end. */
export function seasonForDate(league: DataLeague, ymd: string): number {
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  if (END_YEAR.has(league)) return month >= 8 ? year + 1 : year;
  if (league === "mlb") return year;
  return month <= 2 ? year - 1 : year;
}

/** UTC calendar day of an ISO timestamp, or null when it does not parse. */
export function freshnessDay(iso: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");
}

function cutoffDay(updatedAt: string, generatedAt: string): string | null {
  const stamps = [updatedAt, generatedAt].map((value) => Date.parse(value)).filter((ms) => !Number.isNaN(ms));
  if (stamps.length === 0) return null;
  return new Date(Math.min(...stamps)).toISOString().slice(0, 10).replaceAll("-", "");
}

export function planScoreboardDays(input: {
  days: string[];
  dataLeague: DataLeague;
  now: Date;
  manifest: Manifest | null;
  groups?: string;
}): ScoreboardPlan {
  const today = easternYmd(input.now);
  const liveStart = addDays(today, -LIVE_ESPN_LOOKBACK_DAYS);
  const games = input.manifest?.files.filter((file) => file.dataset === "games" && file.league === input.dataLeague) ?? [];
  const bySeason = new Map<number, ManifestFile>();
  for (const file of games) bySeason.set(file.season, file);
  const generatedAt = input.manifest?.generated_at ?? "";

  const days: DayPlan[] = input.days.map((date) => {
    const season = seasonForDate(input.dataLeague, date);
    if (date >= liveStart) {
      return { date, source: "espn", reason: date > today ? "future" : "live", season };
    }
    if (input.groups && groupsBlockData(input.dataLeague, input.groups)) {
      return { date, source: "espn", reason: "groups", season };
    }
    if (!input.manifest) {
      return { date, source: "espn", reason: "unavailable", season };
    }
    const file = bySeason.get(season);
    if (!file) return { date, source: "espn", reason: "missing-season", season };
    const cutoff = cutoffDay(file.updated_at, generatedAt);
    if (!cutoff || !(date < cutoff)) return { date, source: "espn", reason: "stale", season };
    return { date, source: "data", reason: "export", season };
  });

  const dataDays = days.filter((day) => day.source === "data").map((day) => day.date);
  const seasons = [...new Set(days.filter((day) => day.source === "data" && day.season != null).map((day) => day.season!))].sort(
    (a, b) => a - b,
  );
  return {
    days,
    dataDays,
    espnDays: days.filter((day) => day.source === "espn").map((day) => day.date),
    seasons,
  };
}

/** Every requested day is before the live ESPN window (today and the previous two Eastern days). */
export function datesAreBeforeLiveWindow(days: string[], now: Date): boolean {
  if (days.length === 0) return false;
  const liveStart = addDays(easternYmd(now), -LIVE_ESPN_LOOKBACK_DAYS);
  return days.every((day) => day < liveStart);
}

/** True when the response should say where the days came from. Live-only slates stay as they are. */
export function planNeedsSourceNote(plan: ScoreboardPlan): boolean {
  return plan.days.some((day) => day.reason !== "live" && day.reason !== "future");
}

export function spanLabel(dates: string[]): string {
  if (dates.length === 0) return "";
  const sorted = [...dates].sort();
  const ranges: string[] = [];
  let start = sorted[0]!;
  let prev = sorted[0]!;
  for (const date of sorted.slice(1)) {
    if (addDays(prev, 1) === date) {
      prev = date;
      continue;
    }
    ranges.push(start === prev ? start : `${start}–${prev}`);
    start = prev = date;
  }
  ranges.push(start === prev ? start : `${start}–${prev}`);
  return ranges.join(", ");
}

export function sourceNoteFor(
  plan: ScoreboardPlan,
  files: { updated_at: string }[],
  generatedAt: string | null,
): string {
  const dataDates = plan.days.filter((day) => day.source === "data").map((day) => day.date);
  const espnDates = plan.days.filter((day) => day.source === "espn").map((day) => day.date);
  const parts: string[] = [];
  if (dataDates.length) {
    const updated = files
      .map((file) => file.updated_at)
      .filter(Boolean)
      .sort()[0];
    const when = [
      updated ? `file updated ${updated}` : "",
      generatedAt ? `manifest ${generatedAt}` : "",
    ].filter(Boolean).join(", ");
    parts.push(
      `${spanLabel(dataDates)} from the historical games export${when ? ` (${when})` : ""}. Period scores, records, odds, and broadcasts are not in that export.`,
    );
  }
  const reasons = new Set(plan.days.filter((day) => day.source === "espn").map((day) => day.reason));
  const espnHistorical = plan.days.some((day) => day.source === "espn" && day.reason !== "live" && day.reason !== "future");
  if (dataDates.length && espnDates.length) {
    parts.push(`${spanLabel(espnDates)} from ESPN.`);
  } else if (espnHistorical) {
    if (reasons.has("unavailable")) {
      parts.push("The historical games export could not be read, so these days were requested from ESPN one day at a time.");
    }
    if (reasons.has("missing-season")) {
      parts.push("Days whose season is not in the games export were requested from ESPN one day at a time.");
    }
    if (reasons.has("stale")) {
      parts.push("Days that are not older than the games file were requested from ESPN one day at a time.");
    }
    if (reasons.has("groups")) {
      parts.push("This groups filter is not in the games export, so these days were requested from ESPN one day at a time.");
    }
  }
  return parts.join(" ");
}

export interface CoverageDay {
  date: string;
  source: "data" | "espn";
  games: number;
}

export function coverageMeta(
  plan: ScoreboardPlan,
  events: { coverageDay?: string }[],
  files: { updated_at: string }[],
  generatedAt: string | null,
): { source: "data" | "espn" | "mixed"; sourceNote: string; days: CoverageDay[] } | null {
  if (!planNeedsSourceNote(plan)) return null;
  const counts = new Map<string, number>();
  for (const event of events) {
    if (!event.coverageDay) continue;
    counts.set(event.coverageDay, (counts.get(event.coverageDay) ?? 0) + 1);
  }
  const kinds = new Set(plan.days.map((day) => day.source));
  const source = kinds.size === 1 ? ([...kinds][0] as "data" | "espn") : "mixed";
  return {
    source,
    sourceNote: sourceNoteFor(plan, files, generatedAt),
    days: plan.days.map((day) => ({
      date: day.date,
      source: day.source,
      games: counts.get(day.date) ?? 0,
    })),
  };
}

interface GameRow {
  game_id?: unknown;
  game_date?: unknown;
  start_time?: unknown;
  status?: unknown;
  completed?: unknown;
  ending?: unknown;
  neutral_site?: unknown;
  home_team_id?: unknown;
  home_team_abbr?: unknown;
  home_team_name?: unknown;
  away_team_id?: unknown;
  away_team_abbr?: unknown;
  away_team_name?: unknown;
  home_score?: unknown;
  away_score?: unknown;
  venue?: unknown;
  venue_city?: unknown;
}

function text(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : null;
  }
  if (typeof value === "string" && value.trim() && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

function dayKey(value: unknown): string {
  const raw = text(value).slice(0, 10);
  return raw.replaceAll("-", "");
}

/** DuckDB timestamp text or ISO, normalized to UTC with a Z suffix. */
export function startUtc(value: unknown, gameDate: string): string {
  const raw = text(value);
  if (raw) {
    let normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
    if (/[+-]\d{2}$/.test(normalized)) normalized = `${normalized}:00`;
    if (!/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)) normalized = `${normalized}Z`;
    const ms = Date.parse(normalized);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString().replace(".000Z", "Z");
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return `${gameDate}T00:00:00Z`;
  if (/^\d{8}$/.test(gameDate)) return `${ymdToIso(gameDate)}T00:00:00Z`;
  return "";
}

function statusFor(row: GameRow): { state: string; detail: string } {
  const status = text(row.status).toLowerCase();
  const ending = text(row.ending);
  const completed = row.completed === true || status === "final" || status === "closed";
  if (completed) {
    if (ending && !/^final$/i.test(ending)) return { state: "post", detail: `Final/${ending}` };
    return { state: "post", detail: "Final" };
  }
  if (status === "in" || status === "in_progress" || status === "live") return { state: "in", detail: "In Progress" };
  if (status === "postponed") return { state: "pre", detail: "Postponed" };
  if (status === "delayed") return { state: "pre", detail: "Delayed" };
  if (status === "suspended") return { state: "pre", detail: "Suspended" };
  if (status === "canceled" || status === "cancelled") return { state: "post", detail: "Canceled" };
  return { state: "pre", detail: status ? status.charAt(0).toUpperCase() + status.slice(1) : "Scheduled" };
}

function competitor(
  homeAway: "home" | "away",
  id: unknown,
  abbr: unknown,
  name: unknown,
  score: number | null,
  winner: boolean | undefined,
): Record<string, unknown> {
  const full = text(name);
  return {
    homeAway,
    ...(winner === undefined ? {} : { winner }),
    team: {
      id: id == null || text(id) === "" ? "" : String(num(id) ?? text(id)),
      abbreviation: text(abbr),
      displayName: full,
      name: full,
    },
    ...(score == null ? {} : { score: String(score) }),
  };
}

/** One ESPN-shaped event. Linescores, records, odds, and broadcasts are absent. */
export function eventFromGame(row: GameRow): Record<string, unknown> | null {
  const id = num(row.game_id);
  if (id == null) return null;
  const gameDate = text(row.game_date).slice(0, 10);
  const date = startUtc(row.start_time, gameDate);
  const status = statusFor(row);
  const completed = status.state === "post" && status.detail !== "Canceled";
  const homeScore = num(row.home_score);
  const awayScore = num(row.away_score);
  const scored = homeScore != null && awayScore != null && (completed || status.state === "in");
  const neutral = row.neutral_site === true;
  const awayAbbr = text(row.away_team_abbr);
  const homeAbbr = text(row.home_team_abbr);
  const name = awayAbbr && homeAbbr
    ? `${awayAbbr} ${neutral ? "VS" : "@"} ${homeAbbr}`
    : `${text(row.away_team_name)} @ ${text(row.home_team_name)}`.trim();
  const venue = text(row.venue);
  const city = text(row.venue_city);
  return {
    id: String(id),
    date,
    name,
    shortName: name,
    coverage: "data",
    coverageDay: dayKey(gameDate),
    status: { type: { state: status.state, completed, detail: status.detail, shortDetail: status.detail } },
    competitions: [
      {
        date,
        neutralSite: neutral,
        ...(venue
          ? { venue: { fullName: venue, ...(city ? { address: { city } } : {}) } }
          : {}),
        competitors: [
          competitor("home", row.home_team_id, row.home_team_abbr, row.home_team_name, scored ? homeScore : null, scored ? homeScore! > awayScore! : undefined),
          competitor("away", row.away_team_id, row.away_team_abbr, row.away_team_name, scored ? awayScore : null, scored ? awayScore! > homeScore! : undefined),
        ],
      },
    ],
  };
}

export function eventsFromGames(rows: Record<string, unknown>[], dates: ReadonlySet<string>): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const row of rows) {
    const event = eventFromGame(row);
    if (!event) continue;
    if (!dates.has(String(event.coverageDay ?? ""))) continue;
    events.push(event);
  }
  return events;
}
