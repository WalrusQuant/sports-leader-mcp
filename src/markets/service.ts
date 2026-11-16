/**
 * Keyless Kalshi, Polymarket global, and Polymarket US prices.
 * Venues are returned side by side. Nothing here averages them.
 */

import { BASE } from "../endpoints.js";
import { UpstreamError, fetchJson } from "../client.js";
import { eventContext } from "../transforms.js";
import {
  type LeagueMarketConfig,
  kalshiCodesFor,
  resolveLeague,
  supportedLeagueList,
} from "./aliases.js";
import { marketFetch } from "./http.js";
import {
  type EspnSide,
  type OddsVenue,
  type OddsVenueChoice,
  type PolymarketVenueChoice,
  clobTopOfBook,
  decodeGammaStringList,
  dollarPrice,
  easternDate,
  gammaEventIsCurrent,
  gammaEventOnDate,
  isGammaGameSlug,
  isoDate,
  kalshiOutcomeCode,
  kalshiTopOfBook,
  lineFromTitle,
  normalizeMarketType,
  oddsVenues,
  parseKalshiEventTicker,
  polymarketUsSlug,
  polymarketVenues,
  sideMatches,
} from "./parse.js";

const KALSHI_ORIGIN = "https://api.elections.kalshi.com/trade-api/v2";
const GAMMA_ORIGIN = "https://gamma-api.polymarket.com";
const CLOB_ORIGIN = "https://clob.polymarket.com";
const US_ORIGIN = "https://gateway.polymarket.us/v1";

const PRICES_NOTE =
  "Venues are listed separately and are never averaged. Kalshi prices are the *_dollars fields (0 to 1). " +
  "Polymarket global prices are gamma_outcome_prices unless includeBook requested the CLOB book (clob_book). " +
  "Polymarket US prices are the keyless best bid/offer. A missing venue is status \"no market found\".";

export interface EspnGame {
  eventId: string;
  name: string;
  startUtc: string;
  easternDate: string;
  away: EspnSide & { id: string | null };
  home: EspnSide & { id: string | null };
}

interface KalshiSide {
  code: string;
  name: string;
}

interface KalshiEvent {
  eventTicker: string;
  scheduledDate: string | null;
  away: KalshiSide | null;
  home: KalshiSide | null;
  markets: KalshiMarket[];
}

interface KalshiMarket {
  ticker: string;
  outcome: string;
  title: string;
  yesBid: number | null;
  yesAsk: number | null;
  noBid: number | null;
  noAsk: number | null;
  last: number | null;
  line: number | null;
  priceSource: "dollars";
  book?: ReturnType<typeof kalshiTopOfBook> | { priceSource: "orderbook"; error: string };
}

interface GammaTeam {
  abbreviation?: string;
  alias?: string;
  name?: string;
  ordering?: string;
}

interface GammaEvent {
  slug?: string;
  title?: string;
  eventDate?: string | null;
  startTime?: string | null;
  usId?: string | null;
  teams?: GammaTeam[];
  markets?: unknown[];
}

type VenueResult = Record<string, unknown>;

function errorText(err: unknown): string {
  if (err instanceof UpstreamError) {
    return `Upstream error ${err.status} from ${err.url}: ${err.message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

function unavailable(venue: string, err: unknown): VenueResult {
  return { venue, status: "error", matchedBy: null, error: errorText(err) };
}

function noneFound(venue: string): VenueResult {
  return { venue, status: "no market found", matchedBy: null };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.map(asRecord);
  const record = asRecord(value);
  if (Array.isArray(record.events)) return record.events.map(asRecord);
  if (Array.isArray(record.markets)) return record.markets.map(asRecord);
  if (Object.keys(record).length) return [record];
  return [];
}

function requireLeague(input: string): LeagueMarketConfig {
  const league = resolveLeague(input);
  if (!league) {
    throw new Error(`No prediction-market series for league "${input}". Supported: ${supportedLeagueList()}.`);
  }
  return league;
}

export async function loadEspnGame(args: {
  sport: string;
  league: string;
  eventId?: string;
  team?: string;
  date?: string;
}): Promise<{ game: EspnGame; matchedBy: string }> {
  const league = requireLeague(args.league);
  if (args.sport !== league.sport) {
    throw new Error(`League ${league.league} is a ${league.sport} league.`);
  }
  const board = asRecord(
    await fetchJson(`${BASE.site}/${league.sport}/${league.league}/scoreboard`, {
      params: { dates: args.date },
    }),
  );
  const events = Array.isArray(board.events) ? board.events : [];
  let matchedBy = "first scoreboard game";
  let chosen = events;
  if (args.eventId) {
    chosen = events.filter((event) => String(asRecord(event).id ?? "") === args.eventId);
    matchedBy = "eventId";
  } else if (args.team) {
    chosen = events.filter((event) => scoreboardHasTeam(event, args.team ?? ""));
    matchedBy = "team";
  }
  const fromBoard = chosen.map(scoreboardGame).find((game): game is EspnGame => game !== null);
  if (fromBoard) return { game: fromBoard, matchedBy };

  if (args.eventId) {
    const raw = await fetchJson(`${BASE.core}/${league.sport}/leagues/${league.league}/events/${args.eventId}`);
    const fromCore = coreGame(raw);
    if (fromCore) return { game: fromCore, matchedBy: "eventId" };
  }
  throw new Error(
    args.eventId
      ? `No ESPN game ${args.eventId} on the ${league.league} scoreboard.`
      : `No ESPN game matched for ${league.league}.`,
  );
}

function scoreboardHasTeam(event: unknown, team: string): boolean {
  const comp = asRecord(asList(asRecord(event).competitions)[0]);
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const needle = team.trim().toLowerCase();
  return competitors.some((competitor) => {
    const side = asRecord(asRecord(competitor).team);
    const fields = [side.abbreviation, side.location, side.name, side.displayName, side.shortDisplayName]
      .filter((value) => typeof value === "string")
      .map((value) => String(value).toLowerCase());
    return fields.some((value) => value === needle || value.includes(needle));
  });
}

function scoreboardGame(event: unknown): EspnGame | null {
  const root = asRecord(event);
  const comp = asRecord((Array.isArray(root.competitions) ? root.competitions : [])[0]);
  const competitors = Array.isArray(comp.competitors) ? comp.competitors : [];
  const side = (homeAway: "home" | "away") => {
    const competitor = competitors.map(asRecord).find((row) => row.homeAway === homeAway);
    const team = asRecord(competitor?.team);
    const abbrev = String(team.abbreviation ?? "");
    if (!abbrev) return null;
    return {
      id: team.id != null ? String(team.id) : null,
      abbrev,
      location: String(team.location ?? ""),
      name: String(team.name ?? ""),
      displayName: String(team.displayName ?? ""),
    };
  };
  const home = side("home");
  const away = side("away");
  const startUtc = String(comp.date ?? root.date ?? "");
  if (!home || !away || !startUtc || root.id == null) return null;
  return {
    eventId: String(root.id),
    name: String(root.name ?? ""),
    startUtc,
    easternDate: easternDate(startUtc),
    home,
    away,
  };
}

function coreGame(raw: unknown): EspnGame | null {
  const ctx = eventContext(raw);
  if (!ctx.id || !ctx.startUtc || !ctx.home?.abbrev || !ctx.away?.abbrev) return null;
  const name = String(asRecord(raw).name ?? "");
  const parts = name.split(/\s+(?:at|@|vs\.?)\s+/i);
  const side = (full: string, abbrev: string, id: string): EspnGame["home"] => ({
    id,
    abbrev,
    location: "",
    name: "",
    displayName: full,
  });
  return {
    eventId: ctx.id,
    name,
    startUtc: ctx.startUtc,
    easternDate: easternDate(ctx.startUtc),
    away: side(parts[0] ?? "", ctx.away.abbrev, ctx.away.id),
    home: side(parts[1] ?? "", ctx.home.abbrev, ctx.home.id),
  };
}

async function fetchKalshiMarkets(series: string): Promise<Record<string, unknown>[]> {
  const markets: Record<string, unknown>[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const url = new URL(`${KALSHI_ORIGIN}/markets`);
    url.searchParams.set("series_ticker", series);
    url.searchParams.set("status", "open");
    url.searchParams.set("limit", "200");
    if (cursor) url.searchParams.set("cursor", cursor);
    const data = asRecord(await marketFetch(url.toString()));
    const batch = Array.isArray(data.markets) ? data.markets.map(asRecord) : [];
    markets.push(...batch);
    cursor = typeof data.cursor === "string" ? data.cursor : "";
    if (!cursor || batch.length === 0) break;
  }
  return markets;
}

function buildKalshiEvents(rows: Record<string, unknown>[], league: string): KalshiEvent[] {
  const grouped = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const eventTicker = String(row.event_ticker ?? "");
    if (!eventTicker) continue;
    const list = grouped.get(eventTicker) ?? [];
    list.push(row);
    grouped.set(eventTicker, list);
  }
  const codes = new Set(kalshiCodesFor(league));
  for (const [eventTicker, group] of grouped) {
    for (const row of group) {
      const suffix = kalshiOutcomeCode(eventTicker, String(row.ticker ?? ""));
      if (/^[A-Z]+$/.test(suffix)) codes.add(suffix);
    }
  }
  const events: KalshiEvent[] = [];
  for (const [eventTicker, group] of grouped) {
    const parsed = parseKalshiEventTicker(eventTicker, [...codes]);
    const markets = group.map((row) => kalshiMarket(eventTicker, row));
    const nameFor = (code: string) => {
      const row = group.find((item) => kalshiOutcomeCode(eventTicker, String(item.ticker ?? "")) === code);
      return typeof row?.yes_sub_title === "string" && row.yes_sub_title ? row.yes_sub_title : code;
    };
    events.push({
      eventTicker,
      scheduledDate: parsed?.scheduledDate ?? null,
      away: parsed ? { code: parsed.awayCode, name: nameFor(parsed.awayCode) } : null,
      home: parsed ? { code: parsed.homeCode, name: nameFor(parsed.homeCode) } : null,
      markets,
    });
  }
  events.sort((a, b) => (a.scheduledDate ?? "").localeCompare(b.scheduledDate ?? "") || a.eventTicker.localeCompare(b.eventTicker));
  return events;
}

function kalshiMarket(eventTicker: string, row: Record<string, unknown>): KalshiMarket {
  const title = String(row.title ?? row.yes_sub_title ?? "");
  return {
    ticker: String(row.ticker ?? ""),
    outcome: kalshiOutcomeCode(eventTicker, String(row.ticker ?? "")),
    title,
    yesBid: dollarPrice(row.yes_bid_dollars),
    yesAsk: dollarPrice(row.yes_ask_dollars),
    noBid: dollarPrice(row.no_bid_dollars),
    noAsk: dollarPrice(row.no_ask_dollars),
    last: dollarPrice(row.last_price_dollars),
    line: lineFromTitle(title),
    priceSource: "dollars",
  };
}

async function attachKalshiBooks(events: KalshiEvent[]): Promise<void> {
  const markets = events.flatMap((event) => event.markets);
  await Promise.all(
    markets.map(async (market) => {
      try {
        const book = await marketFetch(`${KALSHI_ORIGIN}/markets/${encodeURIComponent(market.ticker)}/orderbook`);
        market.book = kalshiTopOfBook(book);
      } catch (err) {
        market.book = { priceSource: "orderbook", error: errorText(err) };
      }
    }),
  );
}

function kalshiSideOk(league: string, team: EspnSide, side: KalshiSide | null): boolean {
  if (!side) return false;
  return sideMatches(league, team, side.code, [side.name, side.code]);
}

function matchKalshi(events: KalshiEvent[], game: EspnGame, league: string): { event: KalshiEvent; matchedBy: string } | null {
  const hits = events.flatMap((event) => {
    if (!kalshiSideOk(league, game.away, event.away) || !kalshiSideOk(league, game.home, event.home)) return [];
    const matchedBy =
      event.scheduledDate === game.easternDate
        ? "teams+scheduledDate"
        : `teams (Kalshi ticker date ${event.scheduledDate ?? "unknown"}; postponed games keep the original scheduled date)`;
    return [{ event, matchedBy }];
  });
  if (!hits.length) return null;
  const exact = hits.find((hit) => hit.matchedBy === "teams+scheduledDate");
  if (exact) return exact;
  hits.sort((a, b) => (a.event.scheduledDate ?? "").localeCompare(b.event.scheduledDate ?? ""));
  return hits[hits.length - 1] ?? null;
}

function publicKalshiEvent(event: KalshiEvent): Record<string, unknown> {
  return {
    eventTicker: event.eventTicker,
    scheduledDate: event.scheduledDate,
    away: event.away,
    home: event.home,
    markets: event.markets,
  };
}

export async function getKalshiMarkets(args: {
  league: string;
  date?: string;
  team?: string;
  market?: "winner" | "spread" | "total";
  includeBook?: boolean;
}): Promise<Record<string, unknown>> {
  const league = requireLeague(args.league);
  const market = args.market ?? "winner";
  const fetchedAt = new Date().toISOString();
  const series = league.kalshi[market];
  if (!series) {
    return {
      league: league.league,
      market,
      fetchedAt,
      averaged: false,
      note: `No Kalshi ${market} series is configured for ${league.league}.`,
      pricesNote: PRICES_NOTE,
      events: [],
    };
  }
  const events = buildKalshiEvents(await fetchKalshiMarkets(series), league.league);
  const date = args.date ? isoDate(args.date) : undefined;
  const filtered = events.filter((event) => {
    if (date && event.scheduledDate !== date) return false;
    if (!args.team) return true;
    const team = args.team;
    return [event.away, event.home].some((side) => {
      if (!side) return false;
      if (side.code.toLowerCase() === team.toLowerCase() || side.name.toLowerCase().includes(team.toLowerCase())) return true;
      return sideMatches(league.league, { abbrev: team.toUpperCase(), location: team, name: team, displayName: team }, side.code, [side.name]);
    });
  });
  if (args.includeBook) await attachKalshiBooks(filtered);
  return {
    league: league.league,
    market,
    fetchedAt,
    averaged: false,
    pricesNote: PRICES_NOTE,
    events: filtered.map(publicKalshiEvent),
  };
}

async function fetchGammaEvents(seriesId: string, date?: string): Promise<GammaEvent[]> {
  const events: GammaEvent[] = [];
  for (let page = 0; page < 4; page++) {
    const url = new URL(`${GAMMA_ORIGIN}/events`);
    url.searchParams.set("series_id", seriesId);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", "100");
    url.searchParams.set("include_markets", "false");
    url.searchParams.set("offset", String(page * 100));
    if (date) url.searchParams.set("end_date_min", date);
    const batch = asList(await marketFetch(url.toString())) as GammaEvent[];
    events.push(...batch);
    if (batch.length < 100) break;
  }
  return events;
}

function gammaTeams(event: GammaEvent): { away: GammaTeam; home: GammaTeam } | null {
  const teams = event.teams ?? [];
  const away = teams.find((team) => team.ordering === "away") ?? teams[0];
  const home = teams.find((team) => team.ordering === "home") ?? teams[1];
  if (!away || !home) return null;
  return { away, home };
}

function codesDiffer(league: string, espnAbbrev: string, other: string): boolean {
  return espnAbbrev.toUpperCase() !== other.toUpperCase() && sideMatches(league, blankSide(espnAbbrev), other, []);
}

function blankSide(abbrev: string): EspnSide {
  return { abbrev, location: "", name: "", displayName: "" };
}

function gammaMatch(event: GammaEvent, game: EspnGame, league: string): string | null {
  const teams = gammaTeams(event);
  if (!teams) return null;
  const awayOk = sideMatches(league, game.away, teams.away.abbreviation, [teams.away.alias, teams.away.name, teams.away.abbreviation]);
  const homeOk = sideMatches(league, game.home, teams.home.abbreviation, [teams.home.alias, teams.home.name, teams.home.abbreviation]);
  if (!awayOk || !homeOk) return null;
  const usedAlias = [teams.away.abbreviation, teams.home.abbreviation].some(
    (code, index) =>
      Boolean(code) &&
      codesDiffer(league, index === 0 ? game.away.abbrev : game.home.abbrev, code ?? ""),
  );
  const how = usedAlias ? "alias" : "teams";
  if (event.eventDate && event.eventDate === game.easternDate) return `${how}+eventDate`;
  if (event.startTime) return `${how}+startTime`;
  return how;
}

function filterGammaEvents(events: GammaEvent[], sport: string, date: string | undefined, now: Date): GammaEvent[] {
  return events.filter((event) => {
    if (!isGammaGameSlug(sport, event.slug) || !(event.teams && event.teams.length >= 2)) return false;
    if (date) return gammaEventOnDate(event, date);
    return gammaEventIsCurrent(event, now);
  });
}

async function gammaMarketsFor(slug: string, gammaType: string): Promise<Record<string, unknown>[]> {
  if (gammaType === "moneyline") {
    const url = new URL(`${GAMMA_ORIGIN}/markets`);
    url.searchParams.set("slug", slug);
    return asList(await marketFetch(url.toString())).filter((market) => {
      const kind = String(market.sportsMarketType ?? "moneyline");
      return kind === "moneyline" && market.closed !== true;
    });
  }
  const event = asRecord(await marketFetch(`${GAMMA_ORIGIN}/events/slug/${encodeURIComponent(slug)}`));
  const markets = Array.isArray(event.markets) ? event.markets.map(asRecord) : [];
  return markets.filter((market) => String(market.sportsMarketType ?? "") === gammaType && market.closed !== true);
}

function compactGammaMarket(market: Record<string, unknown>, bookByToken: Map<string, ReturnType<typeof clobTopOfBook>>): Record<string, unknown> {
  const names = decodeGammaStringList(market.outcomes);
  const tokenIds = decodeGammaStringList(market.clobTokenIds);
  const prices = decodeGammaStringList(market.outcomePrices);
  const outcomes = names.map((name, index) => {
    const tokenId = tokenIds[index] ?? null;
    const book = tokenId ? bookByToken.get(tokenId) : undefined;
    if (book) {
      return {
        name,
        tokenId,
        gammaPrice: dollarPrice(prices[index]),
        bid: book.bid,
        ask: book.ask,
        mid: book.mid,
        priceSource: "clob_book" as const,
      };
    }
    return {
      name,
      tokenId,
      price: dollarPrice(prices[index]),
      priceSource: "gamma_outcome_prices" as const,
    };
  });
  return {
    slug: market.slug ?? null,
    question: market.question ?? null,
    sportsMarketType: market.sportsMarketType ?? null,
    line: typeof market.line === "number" ? market.line : null,
    outcomes,
    priceSource: bookByToken.size ? "clob_book" : "gamma_outcome_prices",
  };
}

async function booksFor(tokenIds: string[]): Promise<Map<string, ReturnType<typeof clobTopOfBook>>> {
  const map = new Map<string, ReturnType<typeof clobTopOfBook>>();
  const unique = [...new Set(tokenIds.filter(Boolean))];
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const data = await marketFetch(`${CLOB_ORIGIN}/books`, {
      method: "POST",
      body: JSON.stringify(chunk.map((token_id) => ({ token_id }))),
    });
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const book = clobTopOfBook(row);
      const id = String(asRecord(row).asset_id ?? "");
      if (id) map.set(id, book);
    }
  }
  return map;
}

function publicGammaEvent(event: GammaEvent, markets: Record<string, unknown>[]): Record<string, unknown> {
  const teams = gammaTeams(event);
  return {
    venue: "polymarket",
    slug: event.slug ?? null,
    title: event.title ?? null,
    eventDate: event.eventDate ?? null,
    startTime: event.startTime ?? null,
    usId: event.usId ?? null,
    away: teams
      ? { code: teams.away.abbreviation ?? null, name: teams.away.name ?? teams.away.alias ?? null }
      : null,
    home: teams
      ? { code: teams.home.abbreviation ?? null, name: teams.home.name ?? teams.home.alias ?? null }
      : null,
    markets,
  };
}

async function polymarketGlobal(
  events: Array<{ event: GammaEvent; matchedBy: string }>,
  gammaType: string,
  includeBook: boolean,
): Promise<VenueResult> {
  if (!events.length) return noneFound("polymarket");
  const built = [];
  for (const item of events) {
    const slug = item.event.slug;
    if (!slug) continue;
    const markets = await gammaMarketsFor(slug, gammaType);
    let books = new Map<string, ReturnType<typeof clobTopOfBook>>();
    if (includeBook) {
      const tokenIds = markets.flatMap((market) => decodeGammaStringList(market.clobTokenIds));
      books = await booksFor(tokenIds);
    }
    built.push({
      ...publicGammaEvent(item.event, markets.map((market) => compactGammaMarket(market, books))),
      matchedBy: item.matchedBy,
    });
  }
  if (!built.length) return noneFound("polymarket");
  return { venue: "polymarket", status: "ok", matchedBy: built.map((event) => event.matchedBy).join("; "), events: built };
}

function money(value: unknown): number | null {
  const record = asRecord(value);
  return dollarPrice(record.value ?? value);
}

async function polymarketUs(events: Array<{ event: GammaEvent; matchedBy: string }>): Promise<VenueResult> {
  if (!events.length) return noneFound("polymarket_us");
  const built = [];
  for (const item of events) {
    const usId = item.event.usId;
    if (!usId) continue;
    const slug = polymarketUsSlug(usId);
    let data: unknown;
    try {
      data = await marketFetch(`${US_ORIGIN}/markets/${encodeURIComponent(slug)}/bbo`);
    } catch (err) {
      if (err instanceof UpstreamError && err.status === 404) continue;
      throw err;
    }
    const quote = asRecord(asRecord(data).marketData);
    const teams = gammaTeams(item.event);
    built.push({
      venue: "polymarket_us",
      slug,
      usId,
      priceSource: "bbo",
      matchedBy: `${item.matchedBy}+usId`,
      long: {
        side: teams?.away.ordering ?? "away",
        code: teams?.away.abbreviation ?? null,
        name: teams?.away.name ?? teams?.away.alias ?? null,
        bid: money(quote.bestBid),
        ask: money(quote.bestAsk),
        last: money(quote.lastTradePx),
        current: money(quote.currentPx),
        quote: money(quote.longQuote),
        priceSource: "bbo",
      },
      short: {
        side: teams?.home.ordering ?? "home",
        code: teams?.home.abbreviation ?? null,
        name: teams?.home.name ?? teams?.home.alias ?? null,
        quote: money(quote.shortQuote),
        priceSource: "bbo",
      },
    });
  }
  if (!built.length) return noneFound("polymarket_us");
  const first = built[0];
  return {
    venue: "polymarket_us",
    status: "ok",
    matchedBy: built.map((event) => event.matchedBy).join("; "),
    slug: first?.slug ?? null,
    usId: first?.usId ?? null,
    priceSource: "bbo",
    events: built,
  };
}

function closestGamma(
  hits: Array<{ event: GammaEvent; matchedBy: string }>,
  game: EspnGame,
): Array<{ event: GammaEvent; matchedBy: string }> {
  if (!hits.length) return [];
  const kick = new Date(game.startUtc).getTime();
  const ranked = [...hits].sort((a, b) => {
    const da = Math.abs(new Date(a.event.startTime ?? 0).getTime() - kick);
    const db = Math.abs(new Date(b.event.startTime ?? 0).getTime() - kick);
    return da - db;
  });
  const best = ranked[0];
  if (!best?.event.startTime) return [];
  const delta = Math.abs(new Date(best.event.startTime).getTime() - kick);
  if (!Number.isFinite(delta) || delta > 3 * 24 * 60 * 60 * 1000) return [];
  const matchedBy = best.matchedBy.includes("postponed")
    ? best.matchedBy
    : `${best.matchedBy} (startTime is off the ESPN date; postponed games can move)`;
  return [{ event: best.event, matchedBy }];
}

async function safeVenue(venue: string, fn: () => Promise<VenueResult>): Promise<VenueResult> {
  try {
    return await fn();
  } catch (err) {
    return unavailable(venue, err);
  }
}

export async function getPolymarketMarkets(args: {
  league: string;
  date?: string;
  team?: string;
  marketType?: string;
  venue?: PolymarketVenueChoice;
  includeBook?: boolean;
}): Promise<Record<string, unknown>> {
  const league = requireLeague(args.league);
  const market = normalizeMarketType(args.marketType);
  const wanted = polymarketVenues(args.venue ?? "both");
  const fetchedAt = new Date().toISOString();
  const date = args.date ? isoDate(args.date) : undefined;
  const now = new Date();
  let events: GammaEvent[] = [];
  let listError: unknown;
  try {
    events = filterGammaEvents(await fetchGammaEvents(league.gammaSeriesId, date), league.gammaSport, date, now);
    if (args.team) {
      const team = args.team.toLowerCase();
      events = events.filter((event) =>
        (event.teams ?? []).some((side) =>
          [side.abbreviation, side.alias, side.name].some((value) => String(value ?? "").toLowerCase().includes(team)),
        ),
      );
    }
  } catch (err) {
    listError = err;
  }
  const tagged = events.map((event) => ({ event, matchedBy: date ? "eventDate" : "startTime" }));
  const venues: VenueResult[] = [];
  if (wanted.includes("polymarket")) {
    venues.push(
      listError
        ? unavailable("polymarket", listError)
        : await safeVenue("polymarket", () => polymarketGlobal(tagged, market.gamma, args.includeBook === true)),
    );
  }
  if (wanted.includes("polymarket_us")) {
    venues.push(
      listError ? unavailable("polymarket_us", listError) : await safeVenue("polymarket_us", () => polymarketUs(tagged)),
    );
  }
  return {
    league: league.league,
    marketType: market.gamma,
    fetchedAt,
    averaged: false,
    pricesNote: PRICES_NOTE,
    venues,
  };
}

export async function getMarketOdds(args: {
  sport: string;
  league: string;
  eventId?: string;
  team?: string;
  date?: string;
  venue?: OddsVenueChoice;
}): Promise<Record<string, unknown>> {
  const league = requireLeague(args.league);
  const { game, matchedBy } = await loadEspnGame(args);
  const wanted = oddsVenues(args.venue ?? "all");
  const fetchedAt = new Date().toISOString();
  const venues: VenueResult[] = [];

  if (wanted.includes("kalshi")) {
    venues.push(
      await safeVenue("kalshi", async () => {
        const series = league.kalshi.winner;
        const events = buildKalshiEvents(await fetchKalshiMarkets(series), league.league);
        const hit = matchKalshi(events, game, league.league);
        if (!hit) return noneFound("kalshi");
        return {
          venue: "kalshi",
          status: "ok",
          matchedBy: hit.matchedBy,
          events: [publicKalshiEvent(hit.event)],
        };
      }),
    );
  }

  const wantGlobal = wanted.includes("polymarket");
  const wantUs = wanted.includes("polymarket_us");
  if (wantGlobal || wantUs) {
    let tagged: Array<{ event: GammaEvent; matchedBy: string }> = [];
    let listError: unknown;
    try {
      const listed = await fetchGammaEvents(league.gammaSeriesId, game.easternDate);
      const hits = listed.filter((event) => isGammaGameSlug(league.gammaSport, event.slug)).flatMap((event) => {
        const why = gammaMatch(event, game, league.league);
        return why ? [{ event, matchedBy: why }] : [];
      });
      const sameDay = hits.filter(
        (hit) =>
          hit.event.eventDate === game.easternDate ||
          (hit.event.startTime ? easternDate(hit.event.startTime) === game.easternDate : false),
      );
      tagged = sameDay.length ? sameDay : closestGamma(hits, game);
    } catch (err) {
      listError = err;
    }
    if (wantGlobal) {
      venues.push(
        listError
          ? unavailable("polymarket", listError)
          : await safeVenue("polymarket", () => polymarketGlobal(tagged, "moneyline", false)),
      );
    }
    if (wantUs) {
      venues.push(
        listError ? unavailable("polymarket_us", listError) : await safeVenue("polymarket_us", () => polymarketUs(tagged)),
      );
    }
  }

  return {
    sport: league.sport,
    league: league.league,
    eventId: game.eventId,
    fetchedAt,
    matchedBy,
    averaged: false,
    pricesNote: PRICES_NOTE,
    game: {
      name: game.name,
      startUtc: game.startUtc,
      easternDate: game.easternDate,
      away: { id: game.away.id, abbrev: game.away.abbrev, location: game.away.location, name: game.away.name, displayName: game.away.displayName },
      home: { id: game.home.id, abbrev: game.home.abbrev, location: game.home.location, name: game.home.name, displayName: game.home.displayName },
    },
    venues,
  };
}

export function venueNames(choice: OddsVenueChoice): OddsVenue[] {
  return oddsVenues(choice);
}
