/**
 * Curated transforms that compact raw ESPN API responses into dense shapes
 * suitable for agent context windows. Each transform is a pure function:
 * raw ESPN JSON in, compact object out.
 *
 * Design notes:
 * - The dominant waste across ESPN endpoints is the `links` array (6-16 entries
 *   per entity, each ~8 keys) and `logos`/`images` (16+ size variants). Stripping
 *   these alone cuts 60-90% of bytes.
 * - ESPN uses a "parallel array" pattern for stats: header labels + positional
 *   value arrays. `zipStats` converts these to keyed objects.
 * - Every transform must handle missing fields gracefully (ESPN responses vary
 *   by sport/league/season state).
 */

import { LEAGUE_CATALOG } from "./catalog.js";

// ─── Types ────────────────────────────────────────────────────────────────────

// ESPN responses are untyped JSON of varying shape. We traverse them with an
// internal `any`-typed alias (ESPN's field shapes vary by sport/season state,
// so a precise type would be a fiction). Public transform signatures stay
// `unknown` → `unknown` so callers stay honest.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyObj = Record<string, any>;

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Keys that are pure references/UI chrome — URLs, images, tracking IDs. */
const REF_KEYS = new Set([
  "links", "link", "logo", "logos", "headshot", "headshots", "images",
  "posterImages", "ref", "$ref", "href", "related", "thumbnail", "preview",
  "media", "video", "broadcasts", // handled separately where useful
]);

/** Low-value identity/audit fields that carry no agent-useful info. */
const BOILER_KEYS = new Set([
  "uid", "guid", "slug", "shortDisplayName", "shortName", "color",
  "alternateColor", "nowId", "contentKey", "dataSourceIdentifier",
  "isExternal", "isPremium", "language", "isActive", "isAllStar",
]);

/**
 * Recursively strip reference and boilerplate keys from an arbitrary object.
 * This is the workhorse — a single pass removes 60-90% of bytes on most
 * ESPN responses. Returns a deep copy (never mutates input).
 */
export function stripRefs<T>(obj: T): T {
  return walk(obj) as T;

  function walk(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      const out: AnyObj = {};
      for (const [k, val] of Object.entries(v as AnyObj)) {
        if (REF_KEYS.has(k) || BOILER_KEYS.has(k)) continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  }
}

/** Compact a team object to its identity fields. */
function compactTeam(team: AnyObj | undefined): { id: string; abbrev: string; name: string; displayName?: string } | undefined {
  if (!team) return undefined;
  return {
    id: String(team.id ?? ""),
    abbrev: String(team.abbreviation ?? ""),
    name: String(team.name ?? team.displayName ?? ""),
    displayName: team.displayName ? String(team.displayName) : undefined,
  };
}

/** Zip ESPN's parallel-array stats (labels + positional values) into a keyed object. */
function zipStats(labels: any[] | undefined, values: any[] | undefined): Record<string, string> {
  if (!labels || !values) return {};
  const out: Record<string, string> = {};
  for (let i = 0; i < labels.length && i < values.length; i++) {
    const label = String(labels[i] ?? `col${i}`);
    out[label] = String(values[i] ?? "");
  }
  return out;
}

/** Extract the two useful fields from ESPN's nested status object. */
function compactStatus(status: AnyObj | undefined): { state: string; detail: string } {
  const t = (status?.type as AnyObj) ?? {};
  return {
    state: String(t.state ?? ""),
    detail: String(t.shortDetail ?? t.detail ?? ""),
  };
}

/** Safely coerce to array. */
function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? v : [];
}

/** Safely get a nested object. */
function d(v: unknown): AnyObj {
  return (v !== null && typeof v === "object") ? (v as AnyObj) : {};
}

/** Truncate a string to maxLen chars, appending an ellipsis if cut. */
function truncate(s: string | undefined, maxLen: number): string | undefined {
  if (s === undefined) return undefined;
  return s.length > maxLen ? s.slice(0, maxLen - 1) + "…" : s;
}

/**
 * Strip undefined values from an object so they don't appear as `null` in JSON.
 * Used after mapping transforms that conditionally omit fields.
 */
function prune(o: AnyObj): AnyObj {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)),
  );
}

function idFromRef(value: unknown, segment: string): string | undefined {
  const ref = String(d(value).$ref ?? d(value).ref ?? "");
  const match = ref.match(new RegExp(`/${segment}/([^/?]+)`));
  return match?.[1];
}

// ─── Token budget backstop ────────────────────────────────────────────────────

const MAX_TOKENS = readPositiveInt(process.env.SPORTS_LEADER_MAX_TOKENS, 50_000);

function readPositiveInt(value: string | undefined, fallback: number): number {
  const n = parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * Universal safety net. If a JSON-serialized result exceeds the token budget,
 * return a truncated string with a notice instead of blowing the context window.
 * Under-budget data passes through unchanged.
 */
export function applyBudget(data: unknown): unknown {
  const json = JSON.stringify(data, null, 2);
  if (json === undefined) return data;
  const estTokens = Math.ceil(json.length / 4);
  if (estTokens <= MAX_TOKENS) return data;

  // Never cut serialized JSON mid-token. An over-budget response is replaced
  // by a small, valid JSON envelope that an MCP client can always parse.
  return {
    truncated: true,
    estimatedTokens: estTokens,
    budgetTokens: MAX_TOKENS,
    message:
      "Response exceeded the configured token budget. Use a narrower query or " +
      "the dedicated compact tool output (raw=false).",
    dataSummary: summarizeShape(data),
  };
}

function summarizeShape(data: unknown): AnyObj {
  if (Array.isArray(data)) return { type: "array", itemCount: data.length };
  if (data !== null && typeof data === "object") {
    return { type: "object", keys: Object.keys(data as AnyObj).slice(0, 30) };
  }
  return { type: typeof data };
}

// ─── Per-tool transforms ──────────────────────────────────────────────────────

/**
 * Scoreboard: events[] → dense game list.
 * Strips links (5/event), logos, boilerplate. Keeps scores, status, venue.
 */
export function transformScoreboard(data: unknown): unknown {
  const root = d(data);
  const events = arr<AnyObj>(root.events);
  return {
    date: root.day,
    events: events.map((ev) => {
      const comp = d(arr<AnyObj>(ev.competitions)[0]);
      const venue = d(comp.venue);
      const competitors = arr<AnyObj>(comp.competitors).map((c) => {
        const team = compactTeam(d(c.team)) ?? {};
        const linescores = arr<AnyObj>(c.linescores).map((ls) =>
          String(ls.displayValue ?? ls.value ?? ""),
        );
        const records = arr<AnyObj>(c.records);
        return {
          homeAway: String(c.homeAway ?? ""),
          winner: c.winner ?? undefined,
          team,
          score: String(c.score ?? ""),
          ...(linescores.length ? { linescores } : {}),
          ...(records.length ? { record: String(records[0]?.displayValue ?? "") } : {}),
        };
      });
      return {
        id: String(ev.id ?? ""),
        date: String(ev.date ?? ""),
        name: String(ev.shortName ?? ev.name ?? ""),
        status: compactStatus(d(ev.status)),
        venue: venue.fullName ? { name: String(venue.fullName), city: d(venue.address).city } : undefined,
        competitors,
      };
    }),
  };
}

/**
 * Game summary: a bounded but complete game view. Keeps identity/final score,
 * team and player box scores, leaders, scoring/recent plays, win probability,
 * venue/attendance, broadcasts, and compact standings context.
 */
export function transformGameSummary(data: unknown): unknown {
  const root = d(data);
  const header = d(root.header);
  const competition = d(arr<AnyObj>(header.competitions)[0]);
  const competitors = arr<AnyObj>(competition.competitors).map((c) => prune({
    homeAway: String(c.homeAway ?? ""),
    winner: c.winner,
    team: compactTeam(d(c.team)),
    score: String(c.score ?? ""),
    linescores: arr<AnyObj>(c.linescores).map((ls) => String(ls.displayValue ?? ls.value ?? "")),
    record: arr<AnyObj>(c.records)[0]?.displayValue ?? arr<AnyObj>(c.records)[0]?.summary,
  }));

  const game = prune({
    id: String(header.id ?? competition.id ?? ""),
    date: competition.date ? String(competition.date) : undefined,
    status: compactStatus(d(competition.status)),
    competitors,
  });

  // Boxscore: compact team stats
  const boxscore = d(root.boxscore);
  const boxscoreTeams = arr<AnyObj>(boxscore.teams).map((bt) => {
    const team = compactTeam(d(bt.team)) ?? {};
    const stats = arr<AnyObj>(bt.statistics).map((s) => ({
      label: String(s.label ?? s.name ?? ""),
      displayValue: String(s.displayValue ?? ""),
    }));
    return { team, stats };
  });

  const boxscorePlayers = arr<AnyObj>(boxscore.players).map((group) => ({
    team: compactTeam(d(group.team)),
    categories: arr<AnyObj>(group.statistics).map((category) => {
      const labels = arr<any>(category.labels);
      return {
        name: String(category.name ?? category.text ?? ""),
        athletes: arr<AnyObj>(category.athletes).map((row) => {
          const athlete = d(row.athlete);
          return prune({
            id: String(athlete.id ?? ""),
            name: String(athlete.displayName ?? athlete.fullName ?? ""),
            jersey: athlete.jersey ? String(athlete.jersey) : undefined,
            stats: zipStats(labels, arr<any>(row.stats)),
          });
        }),
        totals: zipStats(labels, arr<any>(category.totals)),
      };
    }),
  }));

  // ESPN summary leaders are grouped by team, then category.
  const leaders = arr<AnyObj>(root.leaders).map((teamGroup) => ({
    team: compactTeam(d(teamGroup.team)),
    categories: arr<AnyObj>(teamGroup.leaders).map((cat) => ({
      name: String(cat.name ?? ""),
      displayName: String(cat.displayName ?? cat.name ?? ""),
      leaders: arr<AnyObj>(cat.leaders).map((leader) => ({
        athleteId: String(d(leader.athlete).id ?? ""),
        athlete: String(d(leader.athlete).displayName ?? d(leader.athlete).fullName ?? ""),
        value: String(leader.displayValue ?? leader.value ?? ""),
      })),
    })),
  }));

  const plays = arr<AnyObj>(root.plays);
  const compactPlay = (play: AnyObj) => prune({
    id: String(play.id ?? ""),
    period: d(play.period).number,
    clock: d(play.clock).displayValue ?? play.clock,
    text: String(play.text ?? ""),
    scoringPlay: play.scoringPlay ?? false,
    homeScore: play.homeScore !== undefined ? String(play.homeScore) : undefined,
    awayScore: play.awayScore !== undefined ? String(play.awayScore) : undefined,
    teamId: d(play.team).id ? String(d(play.team).id) : undefined,
  });
  const scoringPlays = plays.filter((p) => p.scoringPlay).map(compactPlay);
  const recentPlays = plays.slice(-20).map(compactPlay);

  const winProbability = arr<AnyObj>(root.winprobability).map((point) => prune({
    playId: String(point.playId ?? ""),
    homeWinPercentage: point.homeWinPercentage,
    awayWinPercentage: point.awayWinPercentage,
  }));
  const probabilitySamples = winProbability.length <= 25
    ? winProbability
    : winProbability.filter((_, index) => index === 0 || index === winProbability.length - 1 || index % Math.ceil(winProbability.length / 23) === 0);

  const gameInfo = stripRefs(d(root.gameInfo));
  const broadcasts = stripRefs(d(root.broadcasts));
  const standings = stripRefs(d(root.standings));

  return {
    game,
    ...(boxscoreTeams.length || boxscorePlayers.length
      ? { boxscore: { teams: boxscoreTeams, players: boxscorePlayers } }
      : {}),
    ...(leaders.length ? { leaders } : {}),
    ...(plays.length ? { plays: { count: plays.length, scoring: scoringPlays, recent: recentPlays } } : {}),
    ...(winProbability.length ? { winProbability: { count: winProbability.length, samples: probabilitySamples } } : {}),
    ...(Object.keys(gameInfo).length ? { gameInfo } : {}),
    ...(Object.keys(broadcasts).length ? { broadcasts } : {}),
    ...(Object.keys(standings).length ? { standings } : {}),
  };
}

/**
 * Game plays: items[] → compact play list.
 * Strips $ref, media, alternativeText.
 */
export function transformGamePlays(data: unknown): unknown {
  const root = d(data);
  const items = arr<AnyObj>(root.items);
  return {
    count: root.count,
    pageCount: root.pageCount,
    plays: items.map((item) => {
      const period = d(item.period);
      return {
        id: String(item.id ?? ""),
        sequence: item.sequenceNumber ?? item.sequence,
        period: period.number ?? undefined,
        clock: item.clock?.displayValue ?? item.clock ?? undefined,
        wallClock: item.wallclock ?? item.wallClock ?? undefined,
        type: d(item.type).text ?? d(item.type).name ?? undefined,
        text: String(item.text ?? ""),
        scoringPlay: item.scoringPlay ?? false,
        ...(item.scoreValue !== undefined ? { scoreValue: item.scoreValue } : {}),
        ...(item.homeScore !== undefined ? { homeScore: String(item.homeScore) } : {}),
        ...(item.awayScore !== undefined ? { awayScore: String(item.awayScore) } : {}),
        ...(item.team?.id ? { teamId: String(item.team.id) } : {}),
        ...(Array.isArray(item.participants)
          ? { participantIds: item.participants.map((p: AnyObj) => String(d(p.athlete).id ?? p.id ?? "")).filter(Boolean) }
          : {}),
      };
    }),
  };
}

/**
 * Game probabilities: items[] → flat probability series.
 */
export function transformGameProbabilities(data: unknown): unknown {
  const root = d(data);
  const items = arr<AnyObj>(root.items);
  return {
    count: root.count,
    probabilities: items.map((item) => ({
      playId: String(item.playId ?? ""),
      homeWinPct: item.homeWinPercentage ?? undefined,
      awayWinPct: item.awayWinPercentage ?? undefined,
    })),
  };
}

/** Betting odds: one concise record per provider, including open/current lines. */
export function transformGameOdds(data: unknown): unknown {
  const root = d(data);
  return {
    count: root.count,
    odds: arr<AnyObj>(root.items).map((item) => {
      const home = d(item.homeTeamOdds);
      const away = d(item.awayTeamOdds);
      return prune({
        provider: String(d(item.provider).name ?? d(item.provider).id ?? ""),
        details: item.details ? String(item.details) : undefined,
        spread: item.spread,
        overUnder: item.overUnder,
        overOdds: item.overOdds,
        underOdds: item.underOdds,
        home: prune({ favorite: home.favorite, moneyLine: home.moneyLine, spreadOdds: home.spreadOdds }),
        away: prune({ favorite: away.favorite, moneyLine: away.moneyLine, spreadOdds: away.spreadOdds }),
        open: prune({
          total: d(d(item.open).total).alternateDisplayValue ?? d(d(item.open).total).american,
          homeSpread: d(d(home.open).pointSpread).alternateDisplayValue,
          homeMoneyLine: d(d(home.open).moneyLine).alternateDisplayValue,
          awaySpread: d(d(away.open).pointSpread).alternateDisplayValue,
          awayMoneyLine: d(d(away.open).moneyLine).alternateDisplayValue,
        }),
        current: prune({
          total: d(d(item.current).total).alternateDisplayValue ?? d(d(item.current).total).american,
          homeSpread: d(d(home.current).pointSpread).alternateDisplayValue,
          homeMoneyLine: d(d(home.current).moneyLine).alternateDisplayValue,
          awaySpread: d(d(away.current).pointSpread).alternateDisplayValue,
          awayMoneyLine: d(d(away.current).moneyLine).alternateDisplayValue,
        }),
      });
    }),
  };
}

/** Search: remove image variants and return IDs/slugs needed by later tools. */
export function transformSearch(data: unknown): unknown {
  const root = d(data);
  const groups = arr<AnyObj>(root.results);
  return {
    totalFound: root.totalFound,
    groups: groups.map((group) => ({
      type: String(group.type ?? ""),
      totalFound: group.totalFound,
      results: arr<AnyObj>(group.contents).map((item) => {
        const uid = String(item.uid ?? "");
        const uidId = uid.match(/~(?:a|t):(\d+)/)?.[1];
        return prune({
          id: uidId ?? (item.id ? String(item.id) : undefined),
          type: String(item.type ?? group.type ?? ""),
          name: String(item.displayName ?? item.name ?? ""),
          description: item.description ? String(item.description) : undefined,
          subtitle: item.subtitle ? String(item.subtitle) : undefined,
          sport: item.sport ? String(item.sport) : undefined,
          league: item.defaultLeagueSlug ? String(item.defaultLeagueSlug) : undefined,
          url: d(item.link).web ? String(d(item.link).web) : undefined,
        });
      }),
    })),
  };
}

/** Curated discovery list. The upstream ontology contains unresolved $refs. */
export function transformSportsAndLeagues(_data: unknown): unknown {
  return {
    count: LEAGUE_CATALOG.length,
    leagues: LEAGUE_CATALOG,
    note: "Curated public-endpoint slug pairs. Use raw=true only to inspect ESPN's unresolved ontology references.",
  };
}

/** League leaders: normalize categories and extract athlete IDs from Core refs. */
export function transformLeagueLeaders(data: unknown): unknown {
  const root = d(data);
  return {
    scope: prune({ id: root.id ? String(root.id) : undefined, name: root.name, type: root.type }),
    categories: arr<AnyObj>(root.categories).map((category) => ({
      name: String(category.name ?? ""),
      displayName: String(category.displayName ?? category.name ?? ""),
      leaders: arr<AnyObj>(category.leaders).map((leader, index) => prune({
        rank: index + 1,
        athleteId: d(leader.athlete).id ? String(d(leader.athlete).id) : idFromRef(leader.athlete, "athletes"),
        athlete: d(leader.athlete).displayName ?? d(leader.athlete).fullName,
        value: leader.displayValue ?? leader.value,
        active: leader.active,
      })),
    })),
  };
}

/**
 * Teams list: strip to identity fields. Drops 16 logos + 6 links per team.
 */
export function transformTeams(data: unknown): unknown {
  const root = d(data);
  const sports = arr<AnyObj>(root.sports);
  const league = d(d(sports[0]).leagues)[0] ?? {};
  const teams = arr<AnyObj>(d(league).teams ?? d(league).entries);
  return {
    teams: teams
      .map((wrapper) => d(wrapper.team ?? wrapper))
      .map((team) => {
        const venue = d(team.venue);
        return {
          id: String(team.id ?? ""),
          abbrev: String(team.abbreviation ?? ""),
          name: String(team.name ?? team.displayName ?? ""),
          displayName: team.displayName ? String(team.displayName) : undefined,
          location: team.location ? String(team.location) : undefined,
          ...(venue.fullName ? { venue: String(venue.fullName) } : {}),
        };
      })
      .map(prune),
  };
}

/**
 * Team detail: pass through stripRefs for the profile, but compact roster.
 */
export function transformTeam(data: unknown): unknown {
  const root = stripRefs(d(data));
  // If roster present, compact each athlete
  const roster = arr<AnyObj>((root as AnyObj).athletes);
  if (roster.length) {
    (root as AnyObj).athletes = roster.map((a) => ({
      id: String(a.id ?? ""),
      name: String(a.fullName ?? a.displayName ?? ""),
      position: d(a.position).abbreviation ?? undefined,
      jersey: a.jersey ?? undefined,
      headshot: undefined, // stripped by stripRefs already
    }));
  }
  return root;
}

/**
 * Standings: zip the 23-element stats[] arrays into keyed objects.
 */
export function transformStandings(data: unknown): unknown {
  const root = d(data);
  const conferences = arr<AnyObj>(root.children);
  return {
    season: root.season,
    standings: conferences.map((conf) => {
      const entries = arr<AnyObj>(d(d(conf.standings).entries));
      return {
        conference: String(conf.name ?? ""),
        entries: entries.map((entry) => {
          const team = compactTeam(d(entry.team)) ?? {};
          const statsArr = arr<AnyObj>(entry.stats);
          const stats: Record<string, string> = {};
          for (const s of statsArr) {
            const name = String(s.name ?? s.abbreviation ?? "");
            if (name) stats[name] = String(s.displayValue ?? s.value ?? "");
          }
          return { team, stats };
        }),
      };
    }),
  };
}

// Max length for free-text injury/news notes. ESPN's rotowire commentary can
// run to multi-paragraph essays; the agent doesn't need the full prose to
// report "Player X — Knee, Questionable, expected back Week 5".
const NOTE_MAX_LEN = 140;

// Statuses that indicate an actual injury (vs. "Active" entries which are just
// rotowire news blurbs). NFL returns ~800 "injury" entries but ~83% are Active
// players with news notes — filtering them yields the real injury report.
const NON_INJURY_STATUSES = new Set(["Active", "Normal Service"]);

/**
 * League-wide injuries (the 4.5M-token catastrophe).
 * Strips athlete.links (12 entries each), headshots, logos, duplicate enums.
 * Filters out "Active" news entries (not actual injuries). Keeps player, team,
 * status, injury detail, return date, and a capped note.
 */
export function transformInjuries(data: unknown): unknown {
  const root = d(data);
  const teams = arr<AnyObj>(root.injuries);
  return {
    timestamp: root.timestamp,
    season: root.season,
    injuries: teams
      .map((bucket) => {
        const teamName = String(bucket.displayName ?? "");
        const teamInjuries = arr<AnyObj>(bucket.injuries)
          .filter((inj) => !NON_INJURY_STATUSES.has(String(inj.status ?? "")))
          .map((inj) => {
            const athlete = d(inj.athlete);
            const details = d(inj.details);
            const team = d(athlete.team);
            return prune({
              player: String(athlete.displayName ?? ""),
              position: d(athlete.position).abbreviation ?? undefined,
              team: team.abbreviation ? String(team.abbreviation) : teamName,
              status: String(inj.status ?? ""),
              injury: details.detail ? String(details.detail) : undefined,
              returnDate: details.returnDate ? String(details.returnDate) : undefined,
              date: inj.date ? String(inj.date) : undefined,
              note: truncate(inj.shortComment ? String(inj.shortComment) : undefined, NOTE_MAX_LEN),
            });
          });
        return { team: teamName, injuries: teamInjuries };
      })
      // drop teams with no real injuries
      .filter((t) => t.injuries.length > 0),
  };
}

/**
 * Team injuries: same shape as league injuries but single-team scope.
 * Also filters out "Active" news entries.
 */
export function transformTeamInjuries(data: unknown): unknown {
  const root = d(data);
  // Single-team injury endpoint returns similar structure
  const items = arr<AnyObj>(root.injuries ?? [root])
    .filter((inj) => !NON_INJURY_STATUSES.has(String(inj.status ?? "")));
  return {
    injuries: items.map((inj) => {
      const athlete = d(inj.athlete);
      const details = d(inj.details);
      return prune({
        player: String(athlete.displayName ?? ""),
        position: d(athlete.position).abbreviation ?? undefined,
        status: String(inj.status ?? ""),
        injury: details.detail ? String(details.detail) : undefined,
        returnDate: details.returnDate ? String(details.returnDate) : undefined,
        date: inj.date ? String(inj.date) : undefined,
        note: truncate(inj.shortComment ? String(inj.shortComment) : undefined, NOTE_MAX_LEN),
      });
    }),
  };
}

/**
 * Athlete stats: zip parallel-array labels with positional stat values.
 */
export function transformAthleteStats(data: unknown): unknown {
  const root = d(data);
  const categories = arr<AnyObj>(root.categories);
  return {
    categories: categories.map((cat) => {
      const labels = arr<any>(cat.labels);
      const rows = arr<AnyObj>(cat.statistics);
      return {
        name: String(cat.name ?? cat.displayName ?? ""),
        labels,
        seasons: rows.map((row) => {
          const season = d(row.season);
          const team = compactTeam(d(row.team));
          return {
            season: season.displayName ?? season.year ?? undefined,
            team,
            position: row.position ?? undefined,
            stats: zipStats(labels, arr<any>(row.stats)),
          };
        }),
      };
    }),
  };
}

/**
 * Athlete gamelog (the 392k-token monster).
 * Joins events[gameId] metadata with seasonTypes stats on eventId.
 */
export function transformGamelog(data: unknown): unknown {
  const root = d(data);
  const labels = arr<any>(root.labels);
  // Build eventId → stats lookup from seasonTypes
  const statsByEventId = new Map<string, any[]>();
  const seasonTypes = arr<AnyObj>(root.seasonTypes);
  for (const st of seasonTypes) {
    for (const cat of arr<AnyObj>(st.categories)) {
      for (const ev of arr<AnyObj>(cat.events)) {
        const eid = String(ev.eventId ?? "");
        if (eid) statsByEventId.set(eid, arr<any>(ev.stats));
      }
    }
  }
  // events is a dict keyed by gameId
  const events = d(root.events);
  const games = Object.entries(events)
    .map(([gameId, evRaw]) => {
      const ev = d(evRaw);
      const opponent = d(ev.opponent);
      const team = d(ev.team);
      const stats = statsByEventId.get(String(ev.id ?? gameId)) ?? [];
      return {
        date: ev.gameDate ? String(ev.gameDate) : undefined,
        opponent: opponent.abbreviation ? String(opponent.abbreviation) : String(opponent.displayName ?? ""),
        homeAway: team.id && ev.homeTeamId && String(team.id) === String(ev.homeTeamId) ? "H" : "A",
        result: ev.gameResult ? String(ev.gameResult) : undefined,
        score: ev.score ? String(ev.score) : undefined,
        stats: zipStats(labels, stats),
      };
    })
    .filter((g) => g.date !== undefined);

  return { labels, games };
}

/**
 * Athlete splits. Structure: splitCategories[].splits[].stats (positional array
 * indexed by the top-level `labels`/`names`). Zips stats into keyed objects.
 */
export function transformAthleteSplits(data: unknown): unknown {
  const root = d(data);
  const labels = arr<any>(root.labels);
  const names = arr<any>(root.names);
  const splitCats = arr<AnyObj>(root.splitCategories);
  if (!splitCats.length) {
    // Fallback: stripRefs for safety if the structure differs
    return stripRefs(root);
  }
  return {
    labels,
    categories: splitCats.map((cat) => ({
      name: String(cat.displayName ?? cat.name ?? ""),
      splits: arr<AnyObj>(cat.splits).map((sp) => ({
        label: String(sp.displayName ?? ""),
        stats: zipStats(names.length ? names : labels, arr<any>(sp.stats)),
      })),
    })),
  };
}

/**
 * News: strip video (32-key objects), images, categories, links.
 */
export function transformNews(data: unknown): unknown {
  const root = d(data);
  const headlines = arr<AnyObj>(root.headlines);
  return {
    resultsCount: root.resultsCount,
    headlines: headlines.map((h) => {
      const links = d(h.links);
      const webLink = d(links.web);
      return {
        id: String(h.id ?? ""),
        type: h.type ? String(h.type) : undefined,
        headline: String(h.headline ?? ""),
        description: h.description ? String(h.description) : undefined,
        published: h.published ? String(h.published) : undefined,
        source: h.source ? String(h.source) : undefined,
        keywords: arr<any>(h.keywords),
        link: webLink.href ? String(webLink.href) : undefined,
      };
    }).map(prune),
  };
}
