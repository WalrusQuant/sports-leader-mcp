/**
 * Live upstream contracts for `npm run audit`.
 *
 * These are the raw responses the tools depend on, not the compact tool output.
 * A shape that changed is FAIL and names the endpoint. A date range that ESPN
 * starts accepting again is INFO (the tools already request one day at a time).
 * An offseason league with no games is SKIP. Pure verdicts are unit-tested
 * offline from scripts/contract.test.mjs; this file's network calls run only
 * from the audit.
 *
 * Series ids match src/markets/aliases.ts. Scoreboard paths match src/endpoints.ts.
 */

const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2/markets";
const GAMMA = "https://gamma-api.polymarket.com";
const US_GATEWAY = "https://gateway.polymarket.us/v1/markets";

/** Men's college basketball Sunday whose bare scoreboard is a short featured list. */
const CBB_SLATE = "20261115";

/**
 * NFL skill player whose log repeats YDS, AVG, TD, and LNG across categories.
 * Josh Jacobs, 2026. Same id the player-report notes use.
 */
const NFL_GAMELOG_ATHLETE = "4047365";
const NFL_GAMELOG_SEASON = "2026";

/** In-season sample used when today's MLB board is empty. */
const MLB_PROBABLES_DATE = "20260704";

const MARKET_SERIES = [
  { key: "nfl", kalshi: "KXNFLGAME", gamma: "12185", sport: "nfl", offseason: false },
  { key: "nba", kalshi: "KXNBAGAME", gamma: "10345", sport: "nba", offseason: false },
  { key: "nhl", kalshi: "KXNHLGAME", gamma: "10346", sport: "nhl", offseason: false },
  { key: "cfb", kalshi: "KXNCAAFGAME", gamma: "12756", sport: "cfb", offseason: false },
  { key: "cbb", kalshi: "KXNCAAMBGAME", gamma: "10470", sport: "cbb", offseason: false },
  { key: "mlb", kalshi: "KXMLBGAME", gamma: "3", sport: "mlb", offseason: true },
];

const WEATHER_KEYS = ["temperature", "highTemperature", "conditionId", "displayValue", "gust", "windSpeed", "precipitation"];

function addDays(ymd, days) {
  const time = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))) + days * 86_400_000;
  const date = new Date(time);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}${month}${day}`;
}

function upcomingSaturday(ymd) {
  const time = Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8)));
  const delta = (6 - new Date(time).getUTCDay() + 7) % 7;
  return addDays(ymd, delta);
}

export function eventCount(body) {
  return body && Array.isArray(body.events) ? body.events.length : null;
}

function errorMessage(body) {
  if (body && typeof body === "object" && typeof body.message === "string") return body.message.slice(0, 140);
  if (typeof body === "string") return body.slice(0, 140);
  return "";
}

export function singleDateVerdict(status, count) {
  if (status !== 200) return { status: "fail", detail: `HTTP ${status} (single date expected 200)` };
  if (count == null) return { status: "fail", detail: "HTTP 200 but events is not an array" };
  if (count === 0) return { status: "empty", detail: "HTTP 200 events=0" };
  return { status: "pass", detail: `unchanged HTTP 200 events=${count}` };
}

export function rangeVerdict(status, count, dates, message = "") {
  const note = message ? `: ${message}` : "";
  if (status === 400) {
    return { status: "pass", detail: `unchanged HTTP 400 dates=${dates} still rejected${note}` };
  }
  if (status >= 200 && status < 300) {
    return {
      status: "info",
      detail: `ESPN accepted dates=${dates} (was HTTP 400) events=${count ?? "?"}${note}`,
    };
  }
  return { status: "fail", detail: `HTTP ${status} for dates=${dates} (expected 400)${note}` };
}

export function groupsVerdict(defaultCount, groupedCount) {
  if (defaultCount == null || groupedCount == null) {
    return {
      status: "fail",
      detail: `events missing (default=${defaultCount ?? "n/a"} grouped=${groupedCount ?? "n/a"})`,
    };
  }
  if (groupedCount > defaultCount) {
    return {
      status: "pass",
      detail: `unchanged groups=50&limit=400 events=${groupedCount} > default events=${defaultCount}`,
    };
  }
  return {
    status: "fail",
    detail: `groups=50&limit=400 events=${groupedCount} is not more than the default events=${defaultCount}`,
  };
}

export function summaryFields(body) {
  const injuries = Array.isArray(body?.injuries);
  const venue = body?.gameInfo?.venue;
  const venueName =
    venue && typeof venue === "object" ? venue.fullName || venue.shortName || venue.displayName || null : null;
  const weather = body?.gameInfo?.weather;
  const weatherKeys =
    weather && typeof weather === "object" && !Array.isArray(weather)
      ? WEATHER_KEYS.filter((key) => weather[key] != null && weather[key] !== "")
      : [];
  const gameInfoKeys =
    body?.gameInfo && typeof body.gameInfo === "object" ? Object.keys(body.gameInfo).slice(0, 8).join(",") : "missing";
  return { injuries, venueName, weatherKeys, gameInfoKeys };
}

export function probablesVerdict(body) {
  const events = body && Array.isArray(body.events) ? body.events : null;
  if (!events) return { status: "fail", detail: "events is not an array" };
  if (events.length === 0) return { status: "empty", detail: "no events" };
  const competitors = [];
  for (const event of events) {
    for (const competition of event?.competitions ?? []) {
      for (const competitor of competition?.competitors ?? []) competitors.push(competitor);
    }
  }
  if (competitors.length === 0) return { status: "fail", detail: `events=${events.length} but no competitions[].competitors` };
  let arrays = 0;
  let missing = 0;
  const announced = [];
  for (const competitor of competitors) {
    if (!competitor || typeof competitor !== "object") continue;
    if (!Object.prototype.hasOwnProperty.call(competitor, "probables") || competitor.probables == null) {
      missing += 1;
      continue;
    }
    if (!Array.isArray(competitor.probables)) {
      return { status: "fail", detail: `competitors[].probables is ${typeof competitor.probables}, expected an array` };
    }
    arrays += 1;
    for (const row of competitor.probables) {
      if (!row || typeof row !== "object") return { status: "fail", detail: "probables entry is not an object" };
      const athlete = row.athlete;
      const name = athlete && typeof athlete === "object" ? athlete.displayName || athlete.fullName : "";
      if (!name) {
        return {
          status: "fail",
          detail: `probable missing athlete.displayName (keys ${Object.keys(row).slice(0, 8).join(",")})`,
        };
      }
      const role = row.name || row.displayName || "";
      if (!/pitcher|goalie/i.test(String(role))) {
        return { status: "fail", detail: `probable role "${role}" is not a pitcher or goalie` };
      }
      announced.push(String(name));
    }
  }
  if (arrays === 0) {
    const keys = Object.keys(competitors[0] ?? {}).slice(0, 12).join(",");
    return { status: "fail", detail: `competitors[].probables missing (sample keys: ${keys})` };
  }
  if (announced.length === 0) {
    return { status: "pass", detail: `unchanged probables arrays on ${arrays} competitors, none announced` };
  }
  return {
    status: "pass",
    detail: `unchanged probables=${announced.length} sample=${announced[0]} athlete.displayName`,
  };
}

export function gamelogVerdict(body) {
  if (!body || typeof body !== "object") return { status: "fail", detail: "not a JSON object" };
  const categories = body.categories;
  const labels = body.labels;
  const seasonTypes = body.seasonTypes;
  const events = body.events;
  const problems = [];
  if (!Array.isArray(categories) || categories.length < 2) problems.push("categories (need at least two)");
  if (!Array.isArray(labels)) problems.push("labels");
  if (!Array.isArray(seasonTypes) || seasonTypes.length === 0) problems.push("seasonTypes");
  if (!events || typeof events !== "object" || Array.isArray(events)) problems.push("events object");
  if (problems.length) return { status: "fail", detail: `missing ${problems.join(", ")}` };
  if (categories.some((category) => !category || typeof category.name !== "string" || !Number.isInteger(category.count) || category.count < 0)) {
    return { status: "fail", detail: "categories need a string name and an integer count" };
  }
  const sum = categories.reduce((total, category) => total + category.count, 0);
  if (sum !== labels.length) {
    return { status: "fail", detail: `category counts sum to ${sum}, labels length is ${labels.length}` };
  }
  const seen = new Set();
  const repeated = [];
  let offset = 0;
  for (const category of categories) {
    for (const label of labels.slice(offset, offset + category.count)) {
      if (seen.has(label)) repeated.push(label);
      seen.add(label);
    }
    offset += category.count;
  }
  let rows = 0;
  for (const season of seasonTypes) {
    if (!Array.isArray(season?.categories)) return { status: "fail", detail: "seasonTypes[].categories missing" };
    for (const category of season.categories) {
      if (!Array.isArray(category?.events)) return { status: "fail", detail: "seasonTypes[].categories[].events missing" };
      for (const row of category.events) {
        if (row?.eventId == null || !Array.isArray(row.stats)) {
          return { status: "fail", detail: "gamelog event missing eventId or stats[]" };
        }
        rows += 1;
      }
    }
  }
  if (rows === 0) return { status: "fail", detail: "seasonTypes have no events" };
  const names = categories.map((category) => category.name).join("+");
  const unique = [...new Set(repeated)];
  if (!unique.includes("YDS")) {
    return {
      status: "fail",
      detail: `categories=${names} partition ${labels.length} labels but YDS is not repeated (repeated: ${unique.join(",") || "none"})`,
    };
  }
  return { status: "pass", detail: `unchanged categories=${names} repeated ${unique.join(",")} events=${rows}` };
}

export function kalshiVerdict(body) {
  const markets = body && Array.isArray(body.markets) ? body.markets : null;
  if (!markets) return { status: "fail", detail: "markets is not an array" };
  if (markets.length === 0) return { status: "empty", detail: "no markets" };
  const row = markets.find((market) => market && ("yes_bid_dollars" in market || "yes_ask_dollars" in market || "yes_bid" in market)) ?? markets[0];
  const missing = ["yes_bid_dollars", "yes_ask_dollars"].filter((key) => !(key in row));
  if (missing.length) {
    const saw = ["yes_bid", "yes_ask", "last_price", "yes_bid_dollars", "yes_ask_dollars"].filter((key) => key in row);
    return {
      status: "fail",
      detail: `missing ${missing.join(", ")} on ${row.ticker ?? "market"}; price keys: ${saw.join(",") || "none"}`,
    };
  }
  const bid = row.yes_bid_dollars;
  const ask = row.yes_ask_dollars;
  const numeric = (value) => value == null || value === "" || Number.isFinite(Number(value));
  if (!numeric(bid) || !numeric(ask)) {
    return { status: "fail", detail: `non-numeric yes_bid_dollars=${bid} yes_ask_dollars=${ask}` };
  }
  if (bid == null || bid === "" || ask == null || ask === "") {
    return { status: "pass", detail: `unchanged keys present on ${row.ticker ?? "market"} but quotes are empty` };
  }
  return { status: "pass", detail: `unchanged ${row.ticker} yes_bid_dollars=${bid} yes_ask_dollars=${ask}` };
}

export function gammaEventVerdict(payload) {
  const events = Array.isArray(payload) ? payload : payload && Array.isArray(payload.events) ? payload.events : null;
  if (!events) return { status: "fail", detail: "response is not an event list", event: null };
  if (events.length === 0) return { status: "empty", detail: "no events", event: null };
  const matches = events.filter((item) => item?.slug && Array.isArray(item.teams) && item.teams.length >= 2);
  const event = matches[0] ?? null;
  if (!event) {
    const keys = Object.keys(events[0] ?? {}).slice(0, 8).join(",");
    return { status: "fail", detail: `no event with slug and teams (first keys: ${keys || "none"})`, event: null, events: [] };
  }
  const problems = [];
  if (!event.teams.every((team) => team?.abbreviation)) problems.push("teams[].abbreviation");
  if (!event.eventDate && !event.startTime) problems.push("eventDate/startTime");
  if (problems.length) return { status: "fail", detail: `missing ${problems.join(", ")} on ${event.slug}`, event, events: [] };
  const usable = matches.filter((item) => item.teams.every((team) => team?.abbreviation) && (item.eventDate || item.startTime));
  const ordering = event.teams.map((team) => team.ordering || "none").join("/");
  return {
    status: "pass",
    detail: `unchanged ${event.slug} eventDate=${event.eventDate ?? "none"} usId=${event.usId ?? "null"} ordering=${ordering}`,
    event,
    events: usable,
  };
}

export function gammaMarketVerdict(payload) {
  const markets = Array.isArray(payload) ? payload : payload && Array.isArray(payload.markets) ? payload.markets : null;
  if (!markets) return { status: "fail", detail: "markets response is not a list" };
  if (markets.length === 0) return { status: "empty", detail: "markets list is empty" };
  const market = markets.find((item) => item && (item.sportsMarketType == null || item.sportsMarketType === "moneyline")) ?? markets[0];
  const missing = ["outcomes", "outcomePrices", "clobTokenIds"].filter((key) => market[key] == null || market[key] === "");
  if (missing.length) {
    return { status: "fail", detail: `missing ${missing.join(", ")} (keys ${Object.keys(market).slice(0, 12).join(",")})` };
  }
  return {
    status: "pass",
    detail: `unchanged sportsMarketType=${market.sportsMarketType ?? "unset"} outcomes, outcomePrices, clobTokenIds present`,
  };
}

function quoteValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value.value;
  return value;
}

export function usBboVerdict(body) {
  if (!body || typeof body !== "object") return { status: "fail", detail: "not a JSON object" };
  const data = body.marketData;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { status: "fail", detail: `marketData missing (top-level ${Object.keys(body).slice(0, 8).join(",") || "none"})` };
  }
  if (!("bestBid" in data) || !("bestAsk" in data)) {
    return { status: "fail", detail: `bestBid/bestAsk missing (marketData keys ${Object.keys(data).slice(0, 10).join(",")})` };
  }
  const bid = quoteValue(data.bestBid);
  const ask = quoteValue(data.bestAsk);
  if (bid == null || ask == null || !Number.isFinite(Number(bid)) || !Number.isFinite(Number(ask))) {
    return { status: "empty", detail: `no live book (bestBid=${bid ?? "null"} bestAsk=${ask ?? "null"} state=${data.state ?? "unset"})` };
  }
  const extras = ["lastTradePx", "currentPx", "longQuote", "shortQuote"].filter((key) => quoteValue(data[key]) == null);
  const extraNote = extras.length ? `; missing ${extras.join(",")}` : "";
  return { status: "pass", detail: `unchanged marketData.bestBid=${bid} bestAsk=${ask}${extraNote}` };
}

function scoreboardUrl(sport, league, dates, extra) {
  const url = new URL(`${SITE}/${sport}/${league}/scoreboard`);
  if (dates) url.searchParams.set("dates", dates);
  if (extra) {
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  }
  return url.toString();
}

function isOffseason(league) {
  return league.offseason === true || league.key === "wnba";
}

function statusName(event) {
  const competition = event?.competitions?.[0];
  const type = competition?.status?.type ?? event?.status?.type;
  return String(type?.name ?? type?.state ?? "");
}

function byLiveFirst(events) {
  const rank = (event) => {
    const name = statusName(event);
    if (name.includes("IN_PROGRESS") || name === "in") return 0;
    if (name.includes("SCHEDULED") || name.includes("PRE") || name === "pre") return 1;
    return 2;
  };
  return [...events].sort((a, b) => rank(a) - rank(b));
}

export async function auditContracts({ line, leagues, today, version }) {
  console.log("");
  console.log("contract");
  const userAgent = `sports-leader-mcp-audit/${version}`;

  async function getUrl(url) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json", "User-Agent": userAgent },
          signal: AbortSignal.timeout(20_000),
        });
        if ((response.status === 429 || response.status >= 500) && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
          continue;
        }
        const text = await response.text();
        let body = null;
        if (text) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text.slice(0, 160);
          }
        }
        return { status: response.status, body, url };
      } catch (err) {
        lastError = err;
        if (attempt === 3) break;
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  async function check(label, fn) {
    try {
      const result = await fn();
      line(result.status, "contract", label, result.detail);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      line("fail", "contract", label, message.slice(0, 300));
      return { status: "fail", detail: message };
    }
  }

  for (const league of leagues) {
    const pastUrl = scoreboardUrl(league.sport, league.league, league.past);
    await check(`${league.key} single date`, async () => {
      const res = await getUrl(pastUrl);
      const verdict = singleDateVerdict(res.status, eventCount(res.body));
      const detail = `${verdict.detail} dates=${league.past} ${pastUrl}`;
      if (verdict.status === "empty" && isOffseason(league)) {
        return { status: "skip", detail: `offseason; ${detail}` };
      }
      if (verdict.status === "empty") return { status: "fail", detail };
      return { status: verdict.status, detail };
    });

    if (isOffseason(league)) {
      const todayUrl = scoreboardUrl(league.sport, league.league, today);
      await check(`${league.key} today`, async () => {
        const res = await getUrl(todayUrl);
        const count = eventCount(res.body);
        if (res.status === 200 && count === 0) {
          return { status: "skip", detail: `offseason; no games on ${today} ${todayUrl}` };
        }
        if (res.status === 200 && count != null && count > 0) {
          return { status: "info", detail: `offseason flag but events=${count} on ${today} ${todayUrl}` };
        }
        const message = errorMessage(res.body);
        return { status: "fail", detail: `HTTP ${res.status}${message ? `: ${message}` : ""} ${todayUrl}` };
      });
    }

    const end = addDays(league.past, 1);
    const dates = `${league.past}-${end}`;
    const ranges = [{ label: `${league.key} date range`, dates, extra: undefined }];
    if (league.key === "cbb") {
      ranges.push({ label: "cbb range groups=50", dates, extra: { groups: "50", limit: "400" } });
    }
    for (const range of ranges) {
      const url = scoreboardUrl(league.sport, league.league, range.dates, range.extra);
      await check(range.label, async () => {
        const res = await getUrl(url);
        const verdict = rangeVerdict(res.status, eventCount(res.body), range.dates, errorMessage(res.body));
        return { status: verdict.status, detail: `${verdict.detail} ${url}` };
      });
    }
  }

  const defaultUrl = scoreboardUrl("basketball", "mens-college-basketball", CBB_SLATE);
  const groupedUrl = scoreboardUrl("basketball", "mens-college-basketball", CBB_SLATE, { groups: "50", limit: "400" });
  await check("cbb groups=50", async () => {
    const [plain, grouped] = await Promise.all([getUrl(defaultUrl), getUrl(groupedUrl)]);
    if (plain.status !== 200 || grouped.status !== 200) {
      return {
        status: "fail",
        detail: `HTTP default ${plain.status}, grouped ${grouped.status} ${groupedUrl}`,
      };
    }
    const verdict = groupsVerdict(eventCount(plain.body), eventCount(grouped.body));
    return { status: verdict.status, detail: `${verdict.detail} ${groupedUrl}` };
  });

  await auditSummary({ check, getUrl, today });
  await auditProbables({ check, getUrl, today });
  await auditGamelog({ check, getUrl });
  await auditMarkets({ check, getUrl, today });
}

async function auditSummary({ check, getUrl, today }) {
  const nflUrl = scoreboardUrl("football", "nfl");
  const nfl = await getUrl(nflUrl);
  const nflEvents = nfl.status === 200 && Array.isArray(nfl.body?.events) ? nfl.body.events : [];
  const injuryEvent = nflEvents[0];
  await check("nfl summary injuries+venue", async () => {
    if (!injuryEvent?.id) {
      return { status: "fail", detail: `no NFL event to summarize ${nflUrl}` };
    }
    const url = `${SITE}/football/nfl/summary?event=${injuryEvent.id}`;
    const res = await getUrl(url);
    if (res.status !== 200) return { status: "fail", detail: `HTTP ${res.status} ${url}` };
    const fields = summaryFields(res.body);
    const missing = [];
    if (!fields.injuries) missing.push("injuries");
    if (!fields.venueName) missing.push("gameInfo.venue");
    if (missing.length) {
      return { status: "fail", detail: `missing ${missing.join(", ")} (gameInfo: ${fields.gameInfoKeys}) ${url}` };
    }
    const weather = fields.weatherKeys.length ? ` weather=${fields.weatherKeys.join(",")}` : "";
    return { status: "pass", detail: `unchanged injuries venue=${fields.venueName}${weather} ${url}` };
  });

  await check("summary weather", async () => {
    const candidates = [];
    const upcoming = byLiveFirst(nflEvents).filter((event) => {
      const name = statusName(event);
      return name.includes("IN_PROGRESS") || name.includes("SCHEDULED") || name.includes("PRE") || name === "in" || name === "pre";
    });
    for (const event of upcoming.slice(0, 2)) {
      if (event?.id) candidates.push({ sport: "football", league: "nfl", id: String(event.id) });
    }
    const saturday = upcomingSaturday(today);
    const cfbDates = [saturday];
    for (let offset = 0; offset < 7; offset++) {
      const ymd = addDays(today, offset);
      if (!cfbDates.includes(ymd)) cfbDates.push(ymd);
    }
    let cfbGames = 0;
    for (const ymd of cfbDates) {
      if (candidates.filter((item) => item.league === "college-football").length >= 3) break;
      const boardUrl = scoreboardUrl("football", "college-football", ymd);
      const board = await getUrl(boardUrl);
      const events = board.status === 200 && Array.isArray(board.body?.events) ? board.body.events : [];
      cfbGames += events.length;
      for (const event of events.slice(0, 3)) {
        if (event?.id) candidates.push({ sport: "football", league: "college-football", id: String(event.id) });
      }
      if (events.length > 0) break;
    }
    if (candidates.length === 0) {
      const final = nflEvents.find((event) => event?.id);
      if (final?.id) candidates.push({ sport: "football", league: "nfl", id: String(final.id) });
    }
    const tried = [];
    for (const candidate of candidates.slice(0, 6)) {
      const url = `${SITE}/${candidate.sport}/${candidate.league}/summary?event=${candidate.id}`;
      const res = await getUrl(url);
      if (res.status !== 200) {
        tried.push(`HTTP ${res.status} ${url}`);
        continue;
      }
      const fields = summaryFields(res.body);
      if (fields.weatherKeys.length && fields.venueName) {
        return {
          status: "pass",
          detail: `unchanged gameInfo.weather ${fields.weatherKeys.join(",")} venue=${fields.venueName} ${url}`,
        };
      }
      tried.push(`gameInfo:${fields.gameInfoKeys} ${url}`);
      if (tried.length >= 6) break;
    }
    if (nflEvents.length === 0 && cfbGames === 0) {
      return { status: "skip", detail: `offseason; no NFL or college football game to read gameInfo.weather ${nflUrl}` };
    }
    return { status: "fail", detail: `gameInfo.weather missing; sampled ${tried.slice(0, 3).join(" | ")}` };
  });
}

async function auditProbables({ check, getUrl, today }) {
  await check("nhl probables", async () => {
    const todayUrl = scoreboardUrl("hockey", "nhl", today);
    const todayRes = await getUrl(todayUrl);
    if (todayRes.status !== 200) return { status: "fail", detail: `HTTP ${todayRes.status} ${todayUrl}` };
    const todayVerdict = probablesVerdict(todayRes.body);
    if (todayVerdict.status !== "empty") return { status: todayVerdict.status, detail: `${todayVerdict.detail} ${todayUrl}` };
    const pastUrl = scoreboardUrl("hockey", "nhl", "20261028");
    const past = await getUrl(pastUrl);
    if (past.status !== 200) return { status: "fail", detail: `HTTP ${past.status} ${pastUrl}` };
    const pastVerdict = probablesVerdict(past.body);
    if (pastVerdict.status === "empty") {
      return { status: "skip", detail: `no NHL games on ${today} or 20261028 ${todayUrl}` };
    }
    return { status: pastVerdict.status, detail: `${pastVerdict.detail} ${pastUrl}` };
  });

  await check("mlb probables", async () => {
    const url = scoreboardUrl("baseball", "mlb", MLB_PROBABLES_DATE);
    const res = await getUrl(url);
    if (res.status !== 200) return { status: "fail", detail: `HTTP ${res.status} ${url}` };
    const verdict = probablesVerdict(res.body);
    if (verdict.status === "empty") {
      return { status: "skip", detail: `offseason; no games on ${MLB_PROBABLES_DATE} to read competitors[].probables ${url}` };
    }
    return { status: verdict.status, detail: `${verdict.detail} ${url}` };
  });
}

async function auditGamelog({ check, getUrl }) {
  const url = `${WEB}/football/nfl/athletes/${NFL_GAMELOG_ATHLETE}/gamelog?season=${NFL_GAMELOG_SEASON}`;
  await check("nfl gamelog", async () => {
    const res = await getUrl(url);
    if (res.status !== 200) return { status: "fail", detail: `HTTP ${res.status} ${url}` };
    const verdict = gamelogVerdict(res.body);
    return { status: verdict.status, detail: `${verdict.detail} ${url}` };
  });
}

function usSlug(event, sport) {
  if (typeof event.usId === "string" && event.usId) {
    return event.usId.startsWith("aec-") ? event.usId : `aec-${event.usId}`;
  }
  const teams = event.teams ?? [];
  const away = teams.find((team) => team.ordering === "away") ?? teams[0];
  const home = teams.find((team) => team.ordering === "home") ?? teams[1];
  const date = event.eventDate;
  if (!away?.abbreviation || !home?.abbreviation || !date) return "";
  return `aec-${sport}-${String(away.abbreviation).toLowerCase()}-${String(home.abbreviation).toLowerCase()}-${date}`;
}

async function auditMarkets({ check, getUrl, today }) {
  const iso = `${today.slice(0, 4)}-${today.slice(4, 6)}-${today.slice(6, 8)}`;
  await check("kalshi dollars", async () => {
    const tried = [];
    for (const series of MARKET_SERIES) {
      const url = `${KALSHI}?series_ticker=${series.kalshi}&status=open&limit=5`;
      const res = await getUrl(url);
      if (res.status !== 200) return { status: "fail", detail: `HTTP ${res.status} ${url}` };
      const verdict = kalshiVerdict(res.body);
      if (verdict.status === "empty") {
        tried.push(series.kalshi);
        continue;
      }
      return { status: verdict.status, detail: `${verdict.detail} ${url}` };
    }
    const off = MARKET_SERIES.filter((series) => series.offseason).map((series) => series.key).join(",");
    return {
      status: "skip",
      detail: `no open markets (${tried.join(", ")}); offseason series include ${off}`,
    };
  });

  let gammaEvents = [];
  let gammaSport = "nfl";
  await check("gamma events", async () => {
    const tried = [];
    for (const series of MARKET_SERIES) {
      const url = new URL(`${GAMMA}/events`);
      url.searchParams.set("series_id", series.gamma);
      url.searchParams.set("active", "true");
      url.searchParams.set("closed", "false");
      url.searchParams.set("limit", "20");
      url.searchParams.set("include_markets", "false");
      url.searchParams.set("end_date_min", iso);
      const res = await getUrl(url.toString());
      if (res.status !== 200) return { status: "fail", detail: `HTTP ${res.status} ${url}` };
      const verdict = gammaEventVerdict(res.body);
      if (verdict.status === "empty") {
        tried.push(series.key);
        continue;
      }
      if (verdict.status === "pass") {
        gammaEvents = verdict.events?.length ? verdict.events : [verdict.event];
        gammaSport = series.sport;
      }
      return { status: verdict.status, detail: `${verdict.detail} ${url}` };
    }
    return { status: "skip", detail: `no current Gamma events (${tried.join(", ")}); offseason or unlisted` };
  });

  await check("gamma markets", async () => {
    if (!gammaEvents.length) return { status: "skip", detail: "no Gamma event from the events check" };
    const tried = [];
    for (const event of gammaEvents) {
      const url = `${GAMMA}/markets?slug=${encodeURIComponent(event.slug)}`;
      const res = await getUrl(url);
      if (res.status !== 200) return { status: "fail", detail: `HTTP ${res.status} ${url}` };
      const verdict = gammaMarketVerdict(res.body);
      if (verdict.status === "empty") {
        tried.push(event.slug);
        continue;
      }
      return { status: verdict.status, detail: `${verdict.detail} slug=${event.slug} ${url}` };
    }
    return { status: "skip", detail: `no listed markets (${tried.slice(0, 4).join(", ")})` };
  });

  await check("polymarket us bbo", async () => {
    if (!gammaEvents.length) return { status: "skip", detail: "no Gamma event to build a US slug" };
    const tried = [];
    for (const event of gammaEvents) {
      const slug = usSlug(event, gammaSport);
      if (!slug) {
        tried.push(event.slug);
        continue;
      }
      const url = `${US_GATEWAY}/${encodeURIComponent(slug)}/bbo`;
      const res = await getUrl(url);
      if (res.status === 404) {
        tried.push(slug);
        continue;
      }
      if (res.status !== 200) return { status: "fail", detail: `HTTP ${res.status} ${url}` };
      const verdict = usBboVerdict(res.body);
      if (verdict.status === "empty") {
        tried.push(`${slug} ${verdict.detail}`);
        continue;
      }
      return { status: verdict.status, detail: `${verdict.detail} ${url}` };
    }
    return { status: "skip", detail: `no live US book (${tried.slice(0, 2).join("; ")})` };
  });
}
