import { BASE } from "../endpoints.js";
import { UpstreamError, fetchJson } from "../client.js";
import { requireDataConfig } from "../data/config.js";
import { defaultDeps } from "../data/http.js";
import { loadManifest } from "../data/cache.js";
import { queryGamesByDate } from "../data/query.js";
import type { Manifest } from "../data/manifest.js";
import { upstreamDetail } from "../season.js";
import {
  ESPN_RANGE_DAY_CAP,
  addDays,
  coverageMeta,
  dataLeagueFor,
  datesAreBeforeLiveWindow,
  easternYmd,
  eventsFromGames,
  groupsBlockData,
  planNeedsSourceNote,
  planScoreboardDays,
  ymdToIso,
  type ScoreboardPlan,
} from "../scoreboard-data.js";
import { defineTool } from "../tool.js";
import {
  transformScoreboard,
  transformGameSummary,
  transformGamePlays,
  transformGameProbabilities,
  transformGameOdds,
} from "../transforms.js";
import {
  dateRangeSchema,
  dateSchema,
  eventIdSchema,
  groupsSchema,
  leagueSchema,
  limitSchema,
  offsetSchema,
  providerIdSchema,
  seasonTypeSchema,
  sportSchema,
  weekSchema,
} from "../schemas.js";
import { summaryLinks } from "../links.js";
import { gameOddsOutput, gameSummaryOutput, scoreboardOutput } from "../output-schemas.js";

/**
 * ESPN's college-basketball scoreboard with no `groups` is a short featured
 * list, not Division I. Group 50 is every Division I game for both the men's
 * and women's leagues. A grouped scoreboard returns 100 events unless `limit`
 * is set, and a Saturday is often past that (155 men's games on 2026-02-07).
 * 400 covers any single date.
 *
 * A `week` query is left on ESPN's own page. Opening week is about 470 games,
 * and the compact scoreboard for that many games exceeds the token budget.
 */
const DIVISION_I_BASKETBALL = new Set(["mens-college-basketball", "womens-college-basketball"]);
const DIVISION_I_GROUP = "50";
const DIVISION_I_SCOREBOARD_LIMIT = 400;
/** ESPN returns 400 for dates=YYYYMMDD-YYYYMMDD on every league scoreboard. */
const SCOREBOARD_RANGE_CONCURRENCY = 4;

let nowOverride: (() => Date) | null = null;

/** Pin "today" in tests. Production always uses the real clock. */
export function setScoreboardNowForTests(now: (() => Date) | null): void {
  nowOverride = now;
}

function scoreboardNow(): Date {
  return nowOverride ? nowOverride() : new Date();
}

export function scoreboardQuery(
  sport: string,
  league: string,
  input: { dates?: string; week?: number; seasontype?: number; groups?: string },
): Record<string, string | number | undefined> {
  const divisionOne = sport === "basketball" && DIVISION_I_BASKETBALL.has(league);
  const weekly = input.week != null;
  return {
    dates: input.dates,
    week: input.week,
    seasontype: input.seasontype,
    groups: input.groups ?? (divisionOne && !weekly ? DIVISION_I_GROUP : undefined),
    limit: divisionOne && !weekly ? DIVISION_I_SCOREBOARD_LIMIT : undefined,
  };
}

function ymdToUtc(ymd: string): number {
  return Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
}

function utcToYmd(time: number): string {
  const date = new Date(time);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

/**
 * Inclusive calendar days for a YYYYMMDD-YYYYMMDD range. Throws when the end
 * is before the start. Length is not capped here: days the games export can
 * serve are one query, and only the days that still go to ESPN are capped.
 */
export function scoreboardRangeDays(dateRange: string): string[] {
  const start = dateRange.slice(0, 8);
  const end = dateRange.slice(9);
  const startUtc = ymdToUtc(start);
  const endUtc = ymdToUtc(end);
  if (endUtc < startUtc) {
    throw new Error(`dateRange ${dateRange} ends before it starts.`);
  }
  const days: string[] = [];
  for (let time = startUtc; time <= endUtc; time += 86_400_000) {
    days.push(utcToYmd(time));
  }
  return days;
}

function tooManyEspnDays(dateRange: string, count: number): Error {
  return new Error(
    `dateRange ${dateRange} is ${count} days. ESPN rejects a date range on every scoreboard, so each day is requested separately, and a range can be at most ${ESPN_RANGE_DAY_CAP} days.`,
  );
}

function isDateRange(dates?: string): dates is string {
  return Boolean(dates && dates.includes("-"));
}

/** Throws before any fetch when a scoreboard range is reversed. */
export function assertScoreboardRange(dates?: string): void {
  if (isDateRange(dates)) scoreboardRangeDays(dates);
}

/**
 * True when every requested day is old enough to come from the games export,
 * so get_slate can wait for the scoreboard before deciding on the injury report.
 */
export function scoreboardMayBeExportOnly(
  sport: string,
  league: string,
  dates: string | undefined,
  groups: string | undefined,
): boolean {
  if (!dates) return false;
  const dataLeague = dataLeagueFor(sport, league);
  if (!dataLeague || groupsBlockData(dataLeague, groups)) return false;
  const days = isDateRange(dates) ? scoreboardRangeDays(dates) : [dates];
  return datesAreBeforeLiveWindow(days, scoreboardNow());
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

function eventStart(event: Record<string, unknown>): string {
  if (typeof event.date === "string" && event.date) return event.date;
  const competitions = Array.isArray(event.competitions) ? event.competitions : [];
  const first = competitions[0];
  if (first && typeof first === "object" && !Array.isArray(first)) {
    const date = (first as Record<string, unknown>).date;
    if (typeof date === "string") return date;
  }
  return "";
}

/** One scoreboard document. Later days overwrite the same event id, then events are sorted by start. */
export function mergeScoreboards(boards: unknown[]): Record<string, unknown> {
  const byId = new Map<string, Record<string, unknown>>();
  const withoutId: Record<string, unknown>[] = [];
  let shell: Record<string, unknown> | undefined;
  for (const board of boards) {
    if (!board || typeof board !== "object" || Array.isArray(board)) continue;
    const doc = board as Record<string, unknown>;
    if (!shell) shell = doc;
    const events = Array.isArray(doc.events) ? doc.events : [];
    for (const item of events) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const event = item as Record<string, unknown>;
      const id = event.id == null ? "" : String(event.id);
      if (!id) {
        withoutId.push(event);
        continue;
      }
      byId.set(id, event);
    }
  }
  const events = [...byId.values(), ...withoutId].sort((a, b) => {
    const byStart = eventStart(a).localeCompare(eventStart(b));
    if (byStart !== 0) return byStart;
    return String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
  return { ...(shell ?? {}), events };
}

function tagBoard(board: unknown, day: string): Record<string, unknown> {
  if (!board || typeof board !== "object" || Array.isArray(board)) return { events: [] };
  const doc = board as Record<string, unknown>;
  const events = Array.isArray(doc.events) ? doc.events : [];
  return {
    ...doc,
    events: events.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      return { ...(item as Record<string, unknown>), coverage: "espn", coverageDay: day };
    }),
  };
}

async function fetchEspnDays(
  sport: string,
  league: string,
  input: { dates?: string; week?: number; seasontype?: number; groups?: string },
  days: string[],
  tag: boolean,
): Promise<unknown> {
  const url = `${BASE.site}/${sport}/${league}/scoreboard`;
  if (days.length > ESPN_RANGE_DAY_CAP) throw tooManyEspnDays(input.dates ?? days.join("-"), days.length);
  if (days.length === 1 && !isDateRange(input.dates)) {
    const board = await fetchJson(url, { params: scoreboardQuery(sport, league, { ...input, dates: days[0] }) });
    return tag ? tagBoard(board, days[0]!) : board;
  }
  const boards = await mapLimit(days, SCOREBOARD_RANGE_CONCURRENCY, async (day) => {
    const board = await fetchJson(url, { params: scoreboardQuery(sport, league, { ...input, dates: day }) });
    return tag ? tagBoard(board, day) : board;
  });
  return mergeScoreboards(boards);
}

function applyCoverage(
  board: unknown,
  plan: ScoreboardPlan,
  files: { updated_at: string }[],
  generatedAt: string | null,
): unknown {
  const doc = board && typeof board === "object" && !Array.isArray(board)
    ? (board as Record<string, unknown>)
    : { events: [] };
  const events = Array.isArray(doc.events) ? doc.events as { coverageDay?: string }[] : [];
  const meta = coverageMeta(plan, events, files, generatedAt);
  if (!meta) return doc;
  const first = plan.days[0]?.date;
  const last = plan.days[plan.days.length - 1]?.date;
  return {
    ...doc,
    day: plan.days.length === 1 ? (doc.day ?? first) : `${first}-${last}`,
    source: meta.source,
    sourceNote: meta.sourceNote,
    days: meta.days,
  };
}

function unavailablePlan(plan: ScoreboardPlan): ScoreboardPlan {
  const days = plan.days.map((day) =>
    day.source === "data" ? { ...day, source: "espn" as const, reason: "unavailable" as const } : day,
  );
  return {
    days,
    dataDays: [],
    espnDays: days.filter((day) => day.source === "espn").map((day) => day.date),
    seasons: [],
  };
}

/**
 * A dateRange is one scoreboard per day on ESPN when that day is today, one of
 * the previous two US-Eastern days, in the future, or not in the games export.
 * Older days for mlb, nba, nfl, nhl, college football, and men's college
 * basketball are one games query. Events are deduped by id and sorted by start.
 * A week query, an omitted date, and a single live day are one ESPN request.
 * College basketball still gets group 50 and limit 400, except on a week query.
 */
export async function fetchScoreboard(
  sport: string,
  league: string,
  input: { dates?: string; week?: number; seasontype?: number; groups?: string },
): Promise<unknown> {
  const url = `${BASE.site}/${sport}/${league}/scoreboard`;
  if (input.week != null || !input.dates) {
    return fetchJson(url, { params: scoreboardQuery(sport, league, input) });
  }
  const days = isDateRange(input.dates) ? scoreboardRangeDays(input.dates) : [input.dates];
  const dataLeague = dataLeagueFor(sport, league);
  const now = scoreboardNow();
  const liveStart = addDays(easternYmd(now), -2);
  const olderThanLive = days.some((day) => day < liveStart);
  if (!dataLeague || !olderThanLive) {
    if (days.length > ESPN_RANGE_DAY_CAP) throw tooManyEspnDays(input.dates, days.length);
    return fetchEspnDays(sport, league, input, days, false);
  }
  if (groupsBlockData(dataLeague, input.groups)) {
    if (days.length > ESPN_RANGE_DAY_CAP) throw tooManyEspnDays(input.dates, days.length);
    const grouped = planScoreboardDays({ days, dataLeague, now, manifest: null, groups: input.groups });
    const board = await fetchEspnDays(sport, league, input, days, true);
    return applyCoverage(board, grouped, [], null);
  }

  let manifest: Manifest | null = null;
  try {
    manifest = await loadManifest(requireDataConfig(), defaultDeps());
  } catch {
    manifest = null;
  }
  let plan = planScoreboardDays({
    days,
    dataLeague: dataLeague!,
    now,
    manifest,
    groups: input.groups,
  });
  if (plan.espnDays.length > ESPN_RANGE_DAY_CAP) throw tooManyEspnDays(input.dates, plan.espnDays.length);

  let dataEvents: Record<string, unknown>[] = [];
  let files: { updated_at: string }[] = manifest
    ? manifest.files.filter((file) => file.dataset === "games" && file.league === dataLeague && plan.seasons.includes(file.season))
    : [];
  let generatedAt = manifest?.generated_at ?? null;
  if (plan.dataDays.length > 0) {
    try {
      const queried = await queryGamesByDate(
        requireDataConfig(),
        dataLeague!,
        plan.seasons,
        ymdToIso(plan.dataDays[0]!),
        ymdToIso(plan.dataDays[plan.dataDays.length - 1]!),
        defaultDeps(),
      );
      dataEvents = eventsFromGames(queried.rows, new Set(plan.dataDays));
      files = queried.files;
      generatedAt = queried.generated_at;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      plan = unavailablePlan(plan);
      if (plan.espnDays.length > ESPN_RANGE_DAY_CAP) {
        throw new Error(`Historical games export could not be read (${message}). ${tooManyEspnDays(input.dates, plan.espnDays.length).message}`);
      }
      const board = await fetchEspnDays(sport, league, input, plan.espnDays, true);
      return applyCoverage(board, plan, [], generatedAt);
    }
  }

  const tagEspn = planNeedsSourceNote(plan);
  const espnBoard = plan.espnDays.length
    ? await fetchEspnDays(sport, league, input, plan.espnDays, tagEspn)
    : { events: [] };
  const rangeLabel = days.length === 1 ? days[0] : `${days[0]}-${days[days.length - 1]}`;
  const merged = dataEvents.length
    ? mergeScoreboards([{ day: rangeLabel, events: dataEvents }, espnBoard])
    : espnBoard;
  return applyCoverage(merged, plan, files, generatedAt);
}

export const getScoreboard = defineTool({
  name: "get_scoreboard",
  title: "Get scoreboard",
  description:
    "Entry point for live, completed, and scheduled games. Returns eventId, start time, state/detail, competitors with team IDs, current/final and period scores, records, and venue, plus normalized odds (numeric moneylines, implied and no-vig probabilities, signed homeSpread) when ESPN lists them. Individual sports (golf, tennis, racing) include competitor.athlete (name, id) and order. Men's and women's college basketball default to every Division I game (group 50, limit 400); pass groups to request one conference. A week query (NFL and college football included) is one ESPN request and does not add that Division I group. Days older than the games export's updated_at, and older than today and the previous 2 US-Eastern days, are read in one query from the public Parquet games file for mlb, nba, nfl, nhl, college-football (cfb), and mens-college-basketball (cbb). game_id is the ESPN event id. Period scores, records, odds, and broadcasts are omitted on those days. source is data, espn, or mixed, and days lists each date. Today, the previous 2 days, future days, a missing season, and any other league stay on ESPN, one day at a time (at most 14 of those days, four at a time) because ESPN rejects YYYYMMDD-YYYYMMDD. A season-length range is allowed when the export covers it. A result that would exceed the token budget returns a page and a page note; pass offset for the next page. A groups value other than 50 on men's college basketball stays on ESPN. Events are deduped and sorted by start time. Pass eventId to the other game tools; use get_slate for a one-call daily view with injuries.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    date: dateSchema,
    dateRange: dateRangeSchema,
    week: weekSchema,
    seasonType: seasonTypeSchema,
    groups: groupsSchema,
    offset: offsetSchema,
  },
  handler: async ({ sport, league, date, dateRange, week, seasonType, groups }) => {
    const dates = dateRange ?? date;
    assertScoreboardRange(dates);
    return fetchScoreboard(sport, league, {
      dates,
      week,
      seasontype: seasonType,
      groups,
    });
  },
  outputSchema: scoreboardOutput,
  transform: transformScoreboard,
});

export const getGameSummary = defineTool({
  name: "get_game_summary",
  title: "Get game summary",
  description:
    "Get a compact full-game view: event identity and score, team/player box scores, correctly grouped leaders, scoring and recent plays, sampled win probability, venue, broadcasts, standings context, and normalized pick-center odds (no-vig probabilities, signed homeSpread) when ESPN supplies them.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
  },
  handler: async ({ sport, league, eventId }) => {
    return fetchJson(`${BASE.site}/${sport}/${league}/summary`, {
      params: { event: eventId },
    });
  },
  outputSchema: gameSummaryOutput,
  transform: transformGameSummary,
  links: summaryLinks,
});

export const getGamePlays = defineTool({
  name: "get_game_plays",
  title: "Get game play-by-play",
  description:
    "Get compact play-by-play for a game. Returns play ID, period, clock, text, score value, scoring flag, and team ID. Use limit to bound long games.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
    limit: limitSchema,
  },
  handler: async ({ sport, league, eventId, limit }) => {
    return fetchJson(
      `${BASE.core}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/plays`,
      { params: { limit: limit ?? 400 } },
    );
  },
  transform: transformGamePlays,
});

export const getGameOdds = defineTool({
  name: "get_game_odds",
  title: "Get game betting odds",
  description:
    "Get compact betting markets by provider for one game, ready to compare with prediction-market prices: eventId, startUtc, home/away team IDs and abbreviations, numeric American moneylines, implied and no-vig probabilities (draw included for soccer), overround, signed homeSpread (negative = home favored), total, open/current lines, and a cross-provider consensus. Optionally filter by providerId from sports://reference/betting-providers.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
    providerId: providerIdSchema,
  },
  handler: async ({ sport, league, eventId, providerId }) => {
    return fetchJson(
      `${BASE.core}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/odds`,
      { params: { "provider.priority": providerId } },
    );
  },
  outputSchema: gameOddsOutput,
  // Event identity (start time, home/away team IDs and abbreviations) is not
  // in the odds document; one small cached core-API event fetch supplies it.
  context: async ({ sport, league, eventId }) =>
    fetchJson(`${BASE.core}/${sport}/leagues/${league}/events/${eventId}`),
  transform: transformGameOdds,
});

export const getGameProbabilities = defineTool({
  name: "get_game_probabilities",
  title: "Get game win probabilities",
  description:
    "Get the full compact win-probability timeline keyed by playId with homeWinPct and awayWinPct. Use get_game_summary when sampled probability points are sufficient. Hockey, soccer, and games that have not started return count 0 plus unavailable instead of an error — ESPN answers those with HTTP 400.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema,
    limit: limitSchema,
  },
  handler: async ({ sport, league, eventId, limit }) => {
    try {
      return await fetchJson(
        `${BASE.core}/${sport}/leagues/${league}/events/${eventId}/competitions/${eventId}/probabilities`,
        { params: { limit: limit ?? 200 } },
      );
    } catch (err) {
      // 400 = not published (NHL and soccer never; college football before kickoff).
      // 404 still means a bad event id and is returned as a tool error.
      if (err instanceof UpstreamError && err.status === 400) {
        return { count: 0, items: [], unavailable: upstreamDetail(err) };
      }
      throw err;
    }
  },
  transform: transformGameProbabilities,
});

export const scoreboardTools = [
  getScoreboard,
  getGameSummary,
  getGamePlays,
  getGameOdds,
  getGameProbabilities,
];
