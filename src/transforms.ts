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

  // Over budget: truncate the pretty-printed JSON and annotate.
  const maxChars = MAX_TOKENS * 4;
  const truncated = json.slice(0, maxChars);
  return (
    truncated +
    `\n\n...[TRUNCATED: response was ~${estTokens.toLocaleString()} tokens ` +
    `(budget: ${MAX_TOKENS.toLocaleString()}). ` +
    `Pass a narrower query, or if using raw=true, switch to compact mode ` +
    `(raw=false) for a curated view.]`
  );
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
          arr<AnyObj>(ls.linescores ?? ls.value).map((p) => String(p.value ?? "")),
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
 * Game summary: keep boxscore teams/stats, leaders, gameInfo, broadcasts.
 * Drop news, articles, seasonseries — those are fetchable separately.
 */
export function transformGameSummary(data: unknown): unknown {
  const root = d(data);
  // Boxscore: compact team stats
  const boxscoreTeams = arr<AnyObj>(d(d(root.boxscore).teams)).map((bt) => {
    const team = compactTeam(d(bt.team)) ?? {};
    const stats = arr<AnyObj>(bt.statistics).map((s) => ({
      label: String(s.label ?? s.name ?? ""),
      displayValue: String(s.displayValue ?? ""),
    }));
    return { team, stats };
  });

  // Leaders: flatten to category → {athlete, value}
  const leaders = arr<AnyObj>(d(root.leaders)).map((cat) => ({
    category: String(d(cat).displayName ?? d(cat).name ?? ""),
    leaders: arr<AnyObj>(d(cat).leaders).map((l) => ({
      athlete: String(d(l.athlete).displayName ?? ""),
      value: String(l.displayValue ?? ""),
    })),
  }));

  const gameInfo = stripRefs(d(root.gameInfo));
  const broadcasts = stripRefs(d(root.broadcasts));

  return {
    ...(boxscoreTeams.length ? { boxscore: { teams: boxscoreTeams } } : {}),
    ...(leaders.length ? { leaders } : {}),
    ...(Object.keys(gameInfo).length ? { gameInfo } : {}),
    ...(Object.keys(broadcasts).length ? { broadcasts } : {}),
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
        period: period.number ?? undefined,
        clock: item.clock?.displayValue ?? item.clock ?? undefined,
        text: String(item.text ?? ""),
        scoringPlay: item.scoringPlay ?? false,
        ...(item.scoreValue !== undefined ? { scoreValue: item.scoreValue } : {}),
        ...(item.team?.id ? { teamId: String(item.team.id) } : {}),
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
