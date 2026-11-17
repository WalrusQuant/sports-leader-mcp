import { z } from "zod";

import { BASE } from "../endpoints.js";
import { UpstreamError, fetchJson } from "../client.js";
import { requireDataConfig } from "../data/config.js";
import { DataExportError } from "../data/errors.js";
import { defaultDeps } from "../data/http.js";
import { queryDataset } from "../data/query.js";
import { defineTool } from "../tool.js";
import { dateSchema, eventIdSchema, leagueSchema, sportSchema } from "../schemas.js";
import { previewOutput } from "../output-schemas.js";
import { codesEqual, resolveLeague } from "../markets/aliases.js";
import { getMarketOdds } from "../markets/service.js";
import { easternDate, teamHits } from "../markets/parse.js";
import { fetchScoreboard as fetchLeagueScoreboard } from "./scoreboard.js";

/**
 * One game: injuries and weather from the ESPN summary, probable pitchers or
 * goalies from the scoreboard, announced lineups from the Parquet export, and
 * Kalshi / Polymarket US winner prices from the existing get_market_odds matcher.
 * No sportsbook lines. A block that fails is named in `errors`; the rest stay.
 */

const BLOCKS = ["injuries", "probables", "lineups", "weather", "markets"] as const;
type Block = (typeof BLOCKS)[number];

const PROBABLE_LEAGUES = new Set(["mlb", "nhl"]);
const LINEUP_LEAGUES = new Set(["mlb", "nba", "nhl"]);

/**
 * AccuWeather icon ids, which is what ESPN puts in gameInfo.weather.conditionId.
 * The published weather-icons table covers 1–44 and leaves 9, 10, 27, and 28 unused.
 * Labels stay in this title-case wording ("with", "Thunderstorms"). Code 8 is
 * Dreary (Overcast). Night 36–38 are Intermittent Clouds, Hazy Moonlight, Mostly Cloudy.
 */
const CONDITION_BY_ID: Record<string, string> = {
  "1": "Sunny",
  "2": "Mostly Sunny",
  "3": "Partly Sunny",
  "4": "Intermittent Clouds",
  "5": "Hazy Sunshine",
  "6": "Mostly Cloudy",
  "7": "Cloudy",
  "8": "Dreary (Overcast)",
  "11": "Fog",
  "12": "Showers",
  "13": "Mostly Cloudy with Showers",
  "14": "Partly Sunny with Showers",
  "15": "Thunderstorms",
  "16": "Mostly Cloudy with Thunderstorms",
  "17": "Partly Sunny with Thunderstorms",
  "18": "Rain",
  "19": "Flurries",
  "20": "Mostly Cloudy with Flurries",
  "21": "Partly Sunny with Flurries",
  "22": "Snow",
  "23": "Mostly Cloudy with Snow",
  "24": "Ice",
  "25": "Sleet",
  "26": "Freezing Rain",
  "29": "Rain and Snow",
  "30": "Hot",
  "31": "Cold",
  "32": "Windy",
  "33": "Clear",
  "34": "Mostly Clear",
  "35": "Partly Cloudy",
  "36": "Intermittent Clouds",
  "37": "Hazy Moonlight",
  "38": "Mostly Cloudy",
  "39": "Partly Cloudy with Showers",
  "40": "Mostly Cloudy with Showers",
  "41": "Partly Cloudy with Thunderstorms",
  "42": "Mostly Cloudy with Thunderstorms",
  "43": "Mostly Cloudy with Flurries",
  "44": "Mostly Cloudy with Snow",
};

const NON_INJURY = new Set(["Active", "Normal Service"]);

interface Side {
  id: string;
  abbr: string;
  location: string;
  name: string;
  displayName: string;
}

interface Probable {
  player: string;
  role: string;
  status: string;
}

interface VenueInfo {
  name: string | null;
  indoor: boolean | null;
}

interface ParsedGame {
  id: string;
  startUtc: string;
  venue: VenueInfo;
  home: Side;
  away: Side;
  probables: { home: Probable | null; away: Probable | null } | null;
}

interface InjuryRow {
  player: string;
  status: string;
  detail: string | null;
}

interface LineupRow {
  player: string;
  position?: string;
  slot?: string;
  role?: string;
  status?: string;
}

type OutdoorWeather = {
  tempF: number | null;
  condition: string | null;
  windMph: number | null;
  gustMph: number | null;
  precipPct: number | null;
};

type Weather = { indoor: true } | OutdoorWeather;

interface KalshiPrice {
  ticker: string;
  team: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
}

interface PolyPrice {
  slug: string;
  team: string;
  mid: number | null;
  label?: "mid";
}

/** Today as YYYYMMDD in America/Chicago. ESPN game days for a team lookup use this when date is omitted. */
export function chicagoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .replaceAll("-", "");
}

function errorText(err: unknown): string {
  if (err instanceof UpstreamError) {
    return `Upstream error ${err.status} from ${err.url}: ${err.message}`;
  }
  if (err instanceof DataExportError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function list(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => record(item) ?? {});
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function sideFrom(team: Record<string, unknown> | undefined): Side | null {
  if (!team) return null;
  const abbr = text(team.abbreviation);
  const id = team.id == null ? "" : String(team.id);
  if (!abbr || !id) return null;
  return {
    id,
    abbr,
    location: text(team.location),
    name: text(team.name),
    displayName: text(team.displayName) || text(team.name),
  };
}

function venueFrom(raw: unknown): VenueInfo {
  const venue = record(raw);
  if (!venue) return { name: null, indoor: null };
  const name = text(venue.fullName) || text(venue.shortName) || null;
  const indoor = typeof venue.indoor === "boolean" ? venue.indoor : null;
  return { name, indoor };
}

function probableFrom(competitor: Record<string, unknown>): Probable | null {
  const rows = list(competitor.probables);
  const row =
    rows.find((item) => /pitcher|goalie/i.test(`${item.name ?? ""} ${item.displayName ?? ""}`)) ?? rows[0];
  if (!row) return null;
  const athlete = record(row.athlete);
  const player = text(athlete?.displayName) || text(athlete?.fullName);
  if (!player) return null;
  const statusRecord = record(row.status);
  const status = text(statusRecord?.name) || text(statusRecord?.abbreviation) || "probable";
  const role = text(row.displayName) || text(row.abbreviation) || text(row.name) || "probable";
  return { player, role, status };
}

function gameFromScoreboardEvent(event: unknown): ParsedGame | null {
  const root = record(event);
  if (!root || root.id == null) return null;
  const competition = record(list(root.competitions)[0]);
  if (!competition) return null;
  const competitors = list(competition.competitors);
  const homeRow = competitors.find((row) => row.homeAway === "home");
  const awayRow = competitors.find((row) => row.homeAway === "away");
  const home = sideFrom(record(homeRow?.team));
  const away = sideFrom(record(awayRow?.team));
  const startUtc = text(competition.date) || text(root.date);
  if (!home || !away || !startUtc) return null;
  const homeProbable = homeRow ? probableFrom(homeRow) : null;
  const awayProbable = awayRow ? probableFrom(awayRow) : null;
  return {
    id: String(root.id),
    startUtc,
    venue: venueFrom(competition.venue),
    home,
    away,
    probables: homeProbable || awayProbable ? { home: homeProbable, away: awayProbable } : null,
  };
}

function gameFromSummary(raw: unknown): ParsedGame | null {
  const root = record(raw);
  const header = record(root?.header);
  const competition = record(list(header?.competitions)[0]);
  if (!header || !competition || header.id == null) return null;
  const competitors = list(competition.competitors);
  const home = sideFrom(record(competitors.find((row) => row.homeAway === "home")?.team));
  const away = sideFrom(record(competitors.find((row) => row.homeAway === "away")?.team));
  const startUtc = text(competition.date) || text(header.date);
  if (!home || !away || !startUtc) return null;
  const info = record(root?.gameInfo);
  return {
    id: String(header.id),
    startUtc,
    venue: venueFrom(info?.venue),
    home,
    away,
    probables: null,
  };
}

function injuryDetail(row: Record<string, unknown>): string | null {
  const details = record(row.details);
  const parts = [text(details?.side), text(details?.type), text(details?.detail)].filter(Boolean);
  if (parts.length) return parts.join(" ");
  const comment = text(row.shortComment);
  return comment || null;
}

function injuriesFor(raw: unknown, home: Side, away: Side): { home: InjuryRow[]; away: InjuryRow[] } {
  const buckets = list(record(raw)?.injuries);
  const forSide = (side: Side): InjuryRow[] => {
    const bucket = buckets.find((item) => {
      const team = record(item.team);
      const id = team?.id == null ? "" : String(team.id);
      const abbr = text(team?.abbreviation);
      return id === side.id || (abbr && abbr.toUpperCase() === side.abbr.toUpperCase());
    });
    return list(bucket?.injuries)
      .filter((row) => !NON_INJURY.has(text(row.status)))
      .map((row) => {
        const athlete = record(row.athlete);
        return {
          player: text(athlete?.displayName) || text(athlete?.fullName),
          status: text(row.status),
          detail: injuryDetail(row),
        };
      })
      .filter((row) => row.player && row.status);
  };
  return { home: forSide(home), away: forSide(away) };
}

/** AccuWeather label for an ESPN conditionId. Null when the id is unused or unknown. */
export function conditionLabel(conditionId: unknown): string | null {
  if (conditionId == null || conditionId === "") return null;
  return CONDITION_BY_ID[String(conditionId)] ?? null;
}

/**
 * Sustained wind only. A gust is a different field and must not fill this in.
 * ESPN's current summary often sends gust and no sustained speed at all.
 */
function sustainedMph(weather: Record<string, unknown>): number | null {
  const speed = num(weather.windSpeed);
  if (speed != null) return speed;
  const wind = weather.wind;
  if (wind && typeof wind === "object" && !Array.isArray(wind)) {
    const nested = wind as Record<string, unknown>;
    return num(nested.speed) ?? num(nested.displayValue);
  }
  return num(wind);
}

/**
 * ESPN's current summary weather is temperature, conditionId, gust, and
 * precipitation. Older documents also send displayValue, windSpeed, or a
 * "NW 12 mph" wind string. windMph is sustained wind and stays null when
 * that is missing. gustMph is the gust, including 0.
 */
export function parseOutdoorWeather(raw: unknown): OutdoorWeather | null {
  const weather = record(raw);
  if (!weather) return null;
  const display = text(weather.displayValue);
  const condition =
    display && display.toLowerCase() !== "weather" ? display : conditionLabel(weather.conditionId);
  const tempF = num(weather.temperature) ?? num(weather.highTemperature);
  const windMph = sustainedMph(weather);
  const gustMph = num(weather.gust);
  const precipPct = num(weather.precipitation) ?? num(weather.precipitationProbability);
  if (tempF == null && condition == null && windMph == null && gustMph == null && precipPct == null) return null;
  return { tempF, condition, windMph, gustMph, precipPct };
}

function mergedVenue(summary: VenueInfo | undefined, board: VenueInfo | undefined): VenueInfo {
  return {
    name: summary?.name ?? board?.name ?? null,
    indoor: summary?.indoor ?? board?.indoor ?? null,
  };
}

async function fetchScoreboard(sport: string, league: string, date?: string): Promise<ParsedGame[]> {
  const data = await fetchLeagueScoreboard(sport, league, { dates: date });
  return list(record(data)?.events)
    .map(gameFromScoreboardEvent)
    .filter((game): game is ParsedGame => game !== null);
}

async function fetchSummary(sport: string, league: string, eventId: string): Promise<unknown> {
  return fetchJson(`${BASE.site}/${sport}/${league}/summary`, { params: { event: eventId } });
}

function ymdFromIso(iso: string): string {
  const eastern = easternDate(iso);
  return eastern.replaceAll("-", "");
}

interface LineupLoad {
  rows: Record<string, unknown>[];
  asOf: string | null;
}

async function loadLineupRows(league: string, eventId: string): Promise<LineupLoad | null> {
  if (!LINEUP_LEAGUES.has(league)) return null;
  const query = {
    dataset: "lineups",
    league,
    gameId: eventId,
    limit: 250,
  };
  let result;
  try {
    result = await queryDataset(requireDataConfig(), { ...query, sort: "last_seen", order: "desc" }, defaultDeps());
  } catch (err) {
    if (err instanceof DataExportError && /unknown sort column/.test(err.message)) {
      result = await queryDataset(requireDataConfig(), query, defaultDeps());
    } else {
      throw err;
    }
  }
  if (!result.rows.length) return null;
  return { rows: result.rows, asOf: result.updated_at || null };
}

function latestSnapshot(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const current = rows.filter((row) => row.valid_to == null || row.valid_to === "");
  const pool = current.length ? current : rows;
  const stamp = (row: Record<string, unknown>) => String(row.last_seen ?? row.valid_from ?? "");
  const max = pool.reduce((best, row) => (stamp(row) > best ? stamp(row) : best), "");
  if (!max) return pool;
  const latest = pool.filter((row) => stamp(row) === max);
  return latest.length ? latest : pool;
}

function lineupPlayers(rows: Record<string, unknown>[], side: Side): LineupRow[] {
  const matched = rows.filter((row) => {
    const id = row.team_id == null ? "" : String(row.team_id);
    const abbr = text(row.team_abbr).toUpperCase();
    return id === side.id || abbr === side.abbr.toUpperCase();
  });
  const latest = latestSnapshot(matched);
  return latest
    .map((row) => {
      const player = text(row.player_name);
      if (!player) return null;
      const position = text(row.position);
      const slot = text(row.slot);
      const role = text(row.role);
      const status = text(row.status);
      return {
        player,
        ...(position ? { position } : {}),
        ...(slot ? { slot } : {}),
        ...(role ? { role } : {}),
        ...(status ? { status } : {}),
      };
    })
    .filter((row): row is LineupRow => row !== null);
}

function lineupAsOf(rows: Record<string, unknown>[], fallback: string | null): string | null {
  const stamps = rows
    .map((row) => text(row.last_seen) || text(row.valid_from))
    .filter(Boolean)
    .sort();
  return stamps.at(-1) ?? fallback;
}

function teamLabel(league: string, code: string, labels: string[], home: Side, away: Side): string {
  for (const side of [away, home]) {
    if (code && codesEqual(league, side.abbr, code)) return side.abbr;
    if (labels.some((label) => label && teamHits(league, side, label))) return side.abbr;
  }
  return (code || labels.find(Boolean) || "").toUpperCase();
}

function kalshiPrices(venue: Record<string, unknown>, league: string, home: Side, away: Side): KalshiPrice[] {
  const event = list(venue.events)[0];
  return list(event?.markets).flatMap((market) => {
    const ticker = text(market.ticker);
    if (!ticker) return [];
    const code = text(market.outcome);
    const labels = [text(market.title), text(market.yes_sub_title)].filter(Boolean);
    return [
      {
        ticker,
        team: teamLabel(league, code, labels, home, away),
        bid: num(market.yesBid),
        ask: num(market.yesAsk),
        last: num(market.last),
      },
    ];
  });
}

function polyPrices(venue: Record<string, unknown>, league: string, home: Side, away: Side): PolyPrice[] {
  const event = list(venue.events)[0];
  const slug = text(event?.slug) || text(venue.slug);
  if (!slug || !event) return [];
  const long = record(event.long);
  const short = record(event.short);
  const prices: PolyPrice[] = [];
  const longBid = num(long?.bid);
  const longAsk = num(long?.ask);
  const longMid =
    longBid != null && longAsk != null ? round4((longBid + longAsk) / 2) : num(long?.mid);
  if (long) {
    prices.push({
      slug,
      team: teamLabel(league, text(long.code), [text(long.name)], home, away),
      mid: longMid,
      label: "mid" as const,
    });
  }
  if (short) {
    const shortBid = num(short.bid);
    const shortAsk = num(short.ask);
    const mid =
      shortBid != null && shortAsk != null
        ? round4((shortBid + shortAsk) / 2)
        : longMid != null
          ? round4(1 - longMid)
          : num(short.mid);
    prices.push({
      slug,
      team: teamLabel(league, text(short.code), [text(short.name)], home, away),
      mid,
      label: "mid" as const,
    });
  }
  return prices.filter((price) => price.team);
}

function marketsFromOdds(
  raw: Record<string, unknown>,
  league: string,
  home: Side,
  away: Side,
): { markets: { kalshi: KalshiPrice[] | "no market found"; polymarketUS: PolyPrice[] | "no market found" } | "no market found"; error?: string } {
  const venues = list(raw.venues);
  const problems: string[] = [];
  const read = (name: string) => venues.find((venue) => venue.venue === name);

  const kalshiVenue = read("kalshi");
  const polyVenue = read("polymarket_us");
  let kalshi: KalshiPrice[] | "no market found" = "no market found";
  let polymarketUS: PolyPrice[] | "no market found" = "no market found";

  if (!kalshiVenue) problems.push("kalshi: missing from get_market_odds");
  else if (kalshiVenue.status === "error") problems.push(`kalshi: ${text(kalshiVenue.error) || "error"}`);
  else if (kalshiVenue.status === "ok") {
    const prices = kalshiPrices(kalshiVenue, league, home, away);
    if (prices.length) kalshi = prices;
  }

  if (!polyVenue) problems.push("polymarketUS: missing from get_market_odds");
  else if (polyVenue.status === "error") problems.push(`polymarketUS: ${text(polyVenue.error) || "error"}`);
  else if (polyVenue.status === "ok") {
    const prices = polyPrices(polyVenue, league, home, away);
    if (prices.length) polymarketUS = prices;
  }

  const found = Array.isArray(kalshi) || Array.isArray(polymarketUS);
  return {
    markets: found ? { kalshi, polymarketUS } : "no market found",
    ...(problems.length ? { error: problems.join("; ") } : {}),
  };
}

function shellFromOdds(raw: Record<string, unknown>): ParsedGame | null {
  const game = record(raw.game);
  if (!game) return null;
  const home = sideFrom({
    id: record(game.home)?.id,
    abbreviation: record(game.home)?.abbrev,
    displayName: record(game.home)?.displayName,
    location: record(game.home)?.location,
    name: record(game.home)?.name,
  });
  const away = sideFrom({
    id: record(game.away)?.id,
    abbreviation: record(game.away)?.abbrev,
    displayName: record(game.away)?.displayName,
    location: record(game.away)?.location,
    name: record(game.away)?.name,
  });
  const startUtc = text(game.startUtc);
  const id = raw.eventId == null ? "" : String(raw.eventId);
  if (!home || !away || !startUtc || !id) return null;
  return { id, startUtc, venue: { name: null, indoor: null }, home, away, probables: null };
}

const SOURCE_SUMMARY = "espn summary";
const SOURCE_SCOREBOARD = "espn scoreboard";
const SOURCE_LINEUPS = "parquet lineups";
const SOURCE_KALSHI = "kalshi trade-api/v2";
const SOURCE_POLY = "polymarket.us gateway";

export const getGamePreview = defineTool({
  name: "get_game_preview",
  title: "Get game preview",
  description:
    "One game in one call: injuries, probable pitchers (MLB) or goalies (NHL), announced lineups (NBA, MLB, NHL), weather, and Kalshi and Polymarket US winner prices. " +
    "No sportsbook lines. Pass eventId, or team plus an optional date (YYYYMMDD, default today in America/Chicago). The team must match one game. " +
    "include defaults to injuries, probables, lineups, weather, and markets. Only listed blocks are fetched. " +
    "Injuries, weather, and venue come from the ESPN summary (gameInfo.weather and gameInfo.venue). An indoor venue is { indoor: true }; the scoreboard venue flag is used when the summary omits indoor. " +
    "Outdoor condition is the AccuWeather label for conditionId. windMph is sustained wind and is null when ESPN does not send one; gusts are gustMph and are never copied into windMph. " +
    "Probables are scoreboard competitors[].probables. Lineups are the latest Parquet rows for that game, the same path as get_lineups. " +
    "Markets reuse get_market_odds (Kalshi trade-api v2 and the Polymarket US gateway, keyless). Prices are not averaged. " +
    "Polymarket US mid is the bid/ask midpoint for the slug's first team and one minus that midpoint for the other team, labelled mid. " +
    "A game with neither venue listed is \"no market found\". Postponed games keep the original date in the Kalshi ticker. " +
    "If eventId and team are both passed, they must name the same game. " +
    "One block failing leaves the others in the response and puts its message on errors.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema.optional().describe("ESPN event id. Pass this or team."),
    team: z
      .string()
      .min(1)
      .optional()
      .describe("Team abbreviation or name, when eventId is omitted. Must match exactly one game on that date."),
    date: dateSchema.describe(
      "Scoreboard date YYYYMMDD. With team and no date, today in America/Chicago. With eventId, limits the scoreboard lookup.",
    ),
    include: z
      .array(z.enum(BLOCKS))
      .max(BLOCKS.length)
      .optional()
      .describe(
        "Blocks to fetch. Default is injuries, probables, lineups, weather, and markets. A block that fails is named in errors.",
      ),
  },
  outputSchema: previewOutput,
  handler: async ({ sport, league, eventId, team, date, include }) => {
    if (!eventId && !team) {
      throw new Error("Pass eventId, or team. date defaults to today in America/Chicago.");
    }
    const known = resolveLeague(league);
    if (known && known.sport !== sport) {
      throw new Error(`League ${league} is a ${known.sport} league.`);
    }

    const wanted = new Set<Block>(include ?? BLOCKS);
    const errors: Record<string, string> = {};
    const sources: string[] = [];
    const resolvedDate = date ?? (eventId ? undefined : chicagoToday());

    let boardGame: ParsedGame | undefined;
    let id = eventId;

    if (!id) {
      let games: ParsedGame[];
      try {
        games = await fetchScoreboard(sport, league, resolvedDate);
        sources.push(SOURCE_SCOREBOARD);
      } catch (err) {
        throw new Error(`Could not resolve ${team} on ${league}: ${errorText(err)}`);
      }
      const matches = games.filter(
        (game) => teamHits(league, game.home, team ?? "") || teamHits(league, game.away, team ?? ""),
      );
      if (matches.length === 0) {
        throw new Error(`No ${team} game on the ${league} scoreboard for ${resolvedDate}.`);
      }
      if (matches.length > 1) {
        throw new Error(
          `${team} matches ${matches.length} ${league} games on ${resolvedDate} (${matches.map((game) => game.id).join(", ")}). Pass eventId.`,
        );
      }
      boardGame = matches[0];
      id = boardGame?.id;
    }
    if (!id) throw new Error("No game id.");

    const needBoard =
      !boardGame &&
      (wanted.has("weather") || (wanted.has("probables") && PROBABLE_LEAGUES.has(league)));

    const summaryP = fetchSummary(sport, league, id).then(
      (value) => ({ ok: true as const, value }),
      (err: unknown) => ({ ok: false as const, error: errorText(err) }),
    );
    const boardP = needBoard
      ? fetchScoreboard(sport, league, resolvedDate).then(
          (value) => ({ ok: true as const, value }),
          (err: unknown) => ({ ok: false as const, error: errorText(err) }),
        )
      : Promise.resolve(undefined);
    const lineupsP = wanted.has("lineups")
      ? loadLineupRows(league, id).then(
          (value) => ({ ok: true as const, value }),
          (err: unknown) => ({ ok: false as const, error: errorText(err) }),
        )
      : Promise.resolve(undefined);

    if (wanted.has("markets") && needBoard) await boardP;

    const marketsP = wanted.has("markets")
      ? getMarketOdds({
          sport,
          league,
          eventId: id,
          date: resolvedDate,
          venue: "all",
        }).then(
          (value) => ({ ok: true as const, value }),
          (err: unknown) => ({ ok: false as const, error: errorText(err) }),
        )
      : Promise.resolve(undefined);

    const [summaryR, boardR, lineupsR, marketsR] = await Promise.all([summaryP, boardP, lineupsP, marketsP]);

    if (boardR && !boardGame) {
      if (boardR.ok) {
        sources.push(SOURCE_SCOREBOARD);
        boardGame = boardR.value.find((game) => game.id === id);
      } else if (wanted.has("probables") && PROBABLE_LEAGUES.has(league)) {
        errors.probables = boardR.error;
      }
    }

    let summaryGame: ParsedGame | undefined;
    let summaryRaw: unknown;
    if (summaryR.ok) {
      const got = gameFromSummary(summaryR.value);
      if (got && got.id !== id) {
        const message = `ESPN summary was for event ${got.id}, not ${id}.`;
        if (wanted.has("injuries")) errors.injuries = message;
        if (wanted.has("weather")) errors.weather = message;
      } else if (got) {
        summaryGame = got;
        summaryRaw = summaryR.value;
        sources.push(SOURCE_SUMMARY);
      } else {
        const message = "ESPN summary did not include a home and away team.";
        if (wanted.has("injuries")) errors.injuries = message;
        if (wanted.has("weather")) errors.weather = message;
      }
    } else {
      if (wanted.has("injuries")) errors.injuries = summaryR.error;
      if (wanted.has("weather")) errors.weather = summaryR.error;
    }

    let oddsGame: ParsedGame | undefined;
    if (marketsR?.ok) oddsGame = shellFromOdds(marketsR.value) ?? undefined;

    const base = summaryGame ?? boardGame ?? oddsGame;
    if (!base || base.id !== id) {
      throw new Error(summaryR.ok ? `No ESPN game ${id} on the ${league} scoreboard or summary.` : summaryR.error);
    }

    if (
      !boardGame &&
      base.startUtc &&
      ((wanted.has("weather") && summaryGame?.venue.indoor == null) ||
        (wanted.has("probables") && PROBABLE_LEAGUES.has(league) && !errors.probables))
    ) {
      try {
        const dated = await fetchScoreboard(sport, league, resolvedDate ?? ymdFromIso(base.startUtc));
        if (!sources.includes(SOURCE_SCOREBOARD)) sources.push(SOURCE_SCOREBOARD);
        boardGame = dated.find((game) => game.id === id) ?? boardGame;
      } catch (err) {
        const message = errorText(err);
        if (wanted.has("weather") && summaryGame?.venue.indoor == null && !errors.weather) errors.weather = message;
        if (wanted.has("probables") && PROBABLE_LEAGUES.has(league) && !errors.probables) errors.probables = message;
      }
    }

    const venue = mergedVenue(summaryGame?.venue, boardGame?.venue);
    const home = summaryGame?.home ?? base.home;
    const away = summaryGame?.away ?? base.away;
    if (eventId && team && !teamHits(league, home, team) && !teamHits(league, away, team)) {
      throw new Error(`Team ${team} is not on event ${eventId} (${away.abbr} at ${home.abbr}).`);
    }

    const result: Record<string, unknown> = {
      event: {
        id,
        startUtc: summaryGame?.startUtc ?? base.startUtc,
        venue: venue.name,
        indoor: venue.indoor,
        home: { id: home.id, abbr: home.abbr },
        away: { id: away.id, abbr: away.abbr },
      },
    };

    if (wanted.has("injuries") && summaryRaw && !errors.injuries) {
      result.injuries = injuriesFor(summaryRaw, home, away);
    }

    if (wanted.has("probables")) {
      if (!PROBABLE_LEAGUES.has(league)) {
        result.probables = null;
      } else if (!errors.probables) {
        const fromBoard = boardGame?.probables ?? null;
        result.probables = fromBoard;
        if (!boardGame) errors.probables = `No ${id} on the ${league} scoreboard.`;
      }
    }

    if (wanted.has("lineups")) {
      if (!lineupsR) {
        result.lineups = null;
      } else if (!lineupsR.ok) {
        errors.lineups = lineupsR.error;
      } else if (!lineupsR.value) {
        result.lineups = null;
        if (LINEUP_LEAGUES.has(league)) sources.push(SOURCE_LINEUPS);
      } else {
        sources.push(SOURCE_LINEUPS);
        const rows = lineupsR.value.rows;
        result.lineups = {
          home: lineupPlayers(rows, home),
          away: lineupPlayers(rows, away),
          asOf: lineupAsOf(rows, lineupsR.value.asOf),
        };
      }
    }

    if (wanted.has("weather") && !errors.weather) {
      if (venue.indoor === true) {
        result.weather = { indoor: true };
      } else {
        result.weather = parseOutdoorWeather(record(record(summaryRaw)?.gameInfo)?.weather);
      }
    }

    if (wanted.has("markets")) {
      if (!marketsR) {
        result.markets = "no market found";
      } else if (!marketsR.ok) {
        errors.markets = marketsR.error;
        result.markets = "no market found";
      } else {
        sources.push(SOURCE_KALSHI, SOURCE_POLY);
        const shaped = marketsFromOdds(marketsR.value, league, home, away);
        result.markets = shaped.markets;
        if (shaped.error) errors.markets = shaped.error;
      }
    }

    if (Object.keys(errors).length) result.errors = errors;
    result.sources = sources;
    return result;
  },
});
