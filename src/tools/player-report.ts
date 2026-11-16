import { z } from "zod";

import { BASE } from "../endpoints.js";
import { UpstreamError, fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { playerReportOutput } from "../output-schemas.js";
import { leagueSchema, seasonSchema, sportSchema } from "../schemas.js";
import { transformAthleteSplits, transformGamelog } from "../transforms.js";

/**
 * One call for "how has this player looked lately?": league-scoped name
 * resolution, then season stats, the last N games, and the splits ESPN
 * publishes. A single block failing leaves the others in the response.
 */

const includeSchema = z
  .array(z.enum(["season", "recent", "splits"]))
  .max(3)
  .optional()
  .describe(
    "Blocks to fetch. Default is season, recent, and splits. A block that fails is named in errors; the others are still returned.",
  );

const playerSchema = z
  .string()
  .min(1)
  .max(80)
  .describe(
    "Player name or ESPN athlete id. A name is resolved with search and kept inside this league. More than one match in the league returns candidates instead of a guess.",
  );

const lastNSchema = z
  .number()
  .int()
  .min(1)
  .max(30)
  .optional()
  .describe("How many recent games to return, most recent first. Default 5.");

export interface AthleteCandidate {
  id: string;
  name: string;
  team?: string;
  league?: string;
  sport?: string;
  position?: string;
}

export interface GamelogGame {
  eventId: string;
  date?: string;
  opponent: string;
  homeAway: "H" | "A";
  result?: string;
  score?: string;
  stats: Record<string, string>;
}

export interface SeasonCategory {
  name: string;
  team?: { id?: string; abbrev?: string; name?: string; displayName?: string };
  position?: string;
  stats: Record<string, string>;
}

export interface SeasonBlock {
  year?: number;
  categories: SeasonCategory[];
}

interface ReportSource {
  block: string;
  path: string;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Lowercase, drop punctuation, collapse whitespace. "Josh Jacobs" and "josh jacobs" match. */
export function normalizePlayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function athleteIdFromItem(item: Record<string, unknown>): string | undefined {
  const fromUid = String(item.uid ?? "").match(/~a:(\d+)/)?.[1];
  if (fromUid) return fromUid;
  return /^\d+$/.test(String(item.id ?? "")) ? String(item.id) : undefined;
}

function isPlayerItem(item: Record<string, unknown>, groupType: string): boolean {
  const type = String(item.type ?? groupType).toLowerCase();
  if (type === "player" || type === "athlete") return true;
  return /~a:\d+/.test(String(item.uid ?? ""));
}

/** Player hits from a raw ESPN search document. Articles and teams are dropped. */
export function candidatesFromSearch(data: unknown): AthleteCandidate[] {
  const groups = asArray(record(data)?.results);
  const out: AthleteCandidate[] = [];
  const seen = new Set<string>();
  for (const groupRaw of groups) {
    const group = record(groupRaw);
    if (!group) continue;
    const groupType = String(group.type ?? "");
    for (const itemRaw of asArray(group.contents)) {
      const item = record(itemRaw);
      if (!item || !isPlayerItem(item, groupType)) continue;
      const id = athleteIdFromItem(item);
      const name = text(item.displayName) ?? text(item.fullName) ?? text(item.name);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      const league = text(item.defaultLeagueSlug);
      const sport = text(item.sport);
      const team = text(item.subtitle);
      out.push({
        id,
        name,
        ...(team ? { team } : {}),
        ...(league ? { league } : {}),
        ...(sport ? { sport } : {}),
      });
    }
  }
  return out;
}

export type ResolveResult =
  | { resolved: true; athlete: AthleteCandidate }
  | { resolved: false; reason: "ambiguous" | "not_found"; candidates: AthleteCandidate[] };

/**
 * Keep the name inside the requested league. One exact name wins. One player
 * in the league wins. Two or more, with no single exact name, are candidates.
 */
export function resolvePlayer(candidates: AthleteCandidate[], league: string, query: string): ResolveResult {
  const wantedLeague = league.toLowerCase();
  const wantedName = normalizePlayerName(query);
  const inLeague = candidates.filter((candidate) => (candidate.league ?? "").toLowerCase() === wantedLeague);
  if (inLeague.length === 0) {
    return { resolved: false, reason: "not_found", candidates };
  }
  const exact = inLeague.filter((candidate) => normalizePlayerName(candidate.name) === wantedName);
  if (exact.length === 1) return { resolved: true, athlete: exact[0]! };
  if (exact.length > 1) return { resolved: false, reason: "ambiguous", candidates: exact };
  if (inLeague.length === 1) return { resolved: true, athlete: inLeague[0]! };
  return { resolved: false, reason: "ambiguous", candidates: inLeague };
}

function seasonYears(season: unknown): number[] {
  const obj = record(season);
  const years: number[] = [];
  if (obj && typeof obj.year === "number" && Number.isInteger(obj.year)) years.push(obj.year);
  const label = text(obj?.displayName) ?? text(season);
  if (!label) return [...new Set(years)];
  for (const match of label.matchAll(/\d{4}/g)) years.push(Number(match[0]));
  const short = label.match(/(\d{4})\s*[-/]\s*(\d{2})\b/);
  if (short) {
    const start = Number(short[1]);
    const end = Math.floor(start / 100) * 100 + Number(short[2]);
    years.push(end < start ? end + 100 : end);
  }
  return [...new Set(years)];
}

function zipLabels(labels: unknown[], values: unknown[]): Record<string, string> {
  const stats: Record<string, string> = {};
  for (let i = 0; i < labels.length && i < values.length; i++) {
    stats[String(labels[i] ?? `col${i}`)] = String(values[i] ?? "");
  }
  return stats;
}

function teamOf(row: Record<string, unknown>, teams: Record<string, unknown>): SeasonCategory["team"] | undefined {
  const slug = text(row.teamSlug);
  const fromMap = slug ? record(teams[slug]) : undefined;
  const source = record(row.team) ?? fromMap;
  if (!source) return undefined;
  const id = text(source.id) ?? (source.id !== undefined && source.id !== null ? String(source.id) : undefined);
  const abbrev = text(source.abbreviation);
  const name = text(source.displayName) ?? text(source.name);
  if (!id && !abbrev && !name) return undefined;
  return {
    ...(id ? { id } : {}),
    ...(abbrev ? { abbrev } : {}),
    ...(name ? { name } : {}),
    ...(text(source.displayName) ? { displayName: text(source.displayName) } : {}),
  };
}

function positionOf(value: unknown): string | undefined {
  if (typeof value === "string") return text(value);
  return text(record(value)?.abbreviation) ?? text(record(value)?.displayName);
}

/**
 * Named season stats for one year. `season` picks that year (a "2026-27"
 * display name matches 2026 and 2027). Omit it for the latest year in the document.
 */
export function namedSeasonStats(data: unknown, season?: number): SeasonBlock {
  const root = record(data) ?? {};
  const teams = record(root.teams) ?? {};
  const collected: { name: string; years: number[]; category: SeasonCategory }[] = [];
  for (const catRaw of asArray(root.categories)) {
    const cat = record(catRaw);
    if (!cat) continue;
    const name = text(cat.name) ?? text(cat.displayName) ?? "";
    const labels = asArray(cat.labels).length ? asArray(cat.labels) : asArray(cat.names);
    for (const rowRaw of asArray(cat.statistics)) {
      const row = record(rowRaw);
      if (!row) continue;
      const years = seasonYears(row.season);
      const team = teamOf(row, teams);
      const position = positionOf(row.position);
      collected.push({
        name,
        years,
        category: {
          name,
          ...(team ? { team } : {}),
          ...(position ? { position } : {}),
          stats: zipLabels(labels, asArray(row.stats)),
        },
      });
    }
  }
  const known = collected.flatMap((row) => row.years);
  const year = season ?? (known.length ? Math.max(...known) : undefined);
  const categories = collected
    .filter((row) => year === undefined || row.years.includes(year))
    .map((row) => row.category);
  return { ...(year !== undefined ? { year } : {}), categories };
}

export function recentGames(gamelog: { games?: GamelogGame[] } | null | undefined, lastN: number): GamelogGame[] {
  const games = Array.isArray(gamelog?.games) ? [...gamelog.games] : [];
  const stamp = (game: GamelogGame) => {
    const parsed = game.date ? Date.parse(game.date) : Number.NaN;
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  games.sort((a, b) => {
    const byDate = stamp(b) - stamp(a);
    if (byDate !== 0) return byDate;
    return String(b.eventId).localeCompare(String(a.eventId));
  });
  const n = Number.isInteger(lastN) && lastN > 0 ? lastN : 5;
  return games.slice(0, n);
}

export function athleteIdentity(
  data: unknown,
  fallbackId: string,
  fallback?: { name?: string; team?: string },
): { id: string; name?: string; team?: string; position?: string } {
  const root = record(data) ?? {};
  const athlete = record(root.athlete) ?? root;
  const position = record(athlete.position);
  const team = record(athlete.team);
  const name = text(athlete.displayName) ?? text(athlete.fullName) ?? fallback?.name;
  const teamLabel = text(team?.abbreviation) ?? text(team?.displayName) ?? fallback?.team;
  const pos = text(position?.abbreviation) ?? text(position?.displayName);
  return {
    id: text(athlete.id) ?? (athlete.id !== undefined && athlete.id !== null ? String(athlete.id) : fallbackId),
    ...(name ? { name } : {}),
    ...(teamLabel ? { team: teamLabel } : {}),
    ...(pos ? { position: pos } : {}),
  };
}

function blockError(block: string, err: unknown): string {
  if (err instanceof UpstreamError) return `${block} unavailable (upstream ${err.status})`;
  const message = err instanceof Error ? err.message : String(err);
  return `${block} unavailable (${message.replace(/\s+/g, " ").slice(0, 180)})`;
}

function athletePath(sport: string, league: string, athleteId: string, suffix = ""): string {
  return `/apis/common/v3/sports/${sport}/${league}/athletes/${athleteId}${suffix}`;
}

async function loadBlock<T>(errorKey: string, sourceBlock: string, path: string, load: () => Promise<T>): Promise<
  { ok: true; value: T; source: ReportSource } | { ok: false; error: string; errorKey: string; source: ReportSource }
> {
  const source = { block: sourceBlock, path };
  try {
    return { ok: true, value: await load(), source };
  } catch (err) {
    return { ok: false, error: blockError(errorKey, err), errorKey, source };
  }
}

export const getPlayerReport = defineTool({
  name: "get_player_report",
  title: "Get player report",
  description:
    "One call for how a player has looked lately in MLB, NBA, NFL, NHL, and any other league with an ESPN athlete page. " +
    "player is a name or an ESPN athlete id. A name is resolved with search and kept inside league: one match is used, and more than one match returns candidates instead of a guess (search for 'josh jacobs' hits more than one player; league=nfl resolves to the NFL player). " +
    "season is named stats for that year (omit it for the latest year in the document). recent is the last lastN gamelog rows, most recent first (default 5). splits is the split list ESPN publishes, with named stat fields. " +
    "include limits the blocks. One block failing leaves the others in the response and names the failure in errors. sources lists the ESPN documents that were requested.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    player: playerSchema,
    season: seasonSchema,
    lastN: lastNSchema,
    include: includeSchema,
  },
  outputSchema: playerReportOutput,
  handler: async ({ sport, league, player, season, lastN, include }) => {
    const blocks = new Set(include ?? ["season", "recent", "splits"]);
    const gamesWanted = lastN ?? 5;
    const query = player.trim();
    const sources: ReportSource[] = [];

    let athleteId = query;
    let fallback: { name?: string; team?: string } | undefined;
    if (!/^\d+$/.test(query)) {
      const searchPath = "/apis/search/v2";
      let found: ReturnType<typeof resolvePlayer>;
      try {
        const raw = await fetchJson(BASE.search, { params: { query, sport, limit: 20 } });
        sources.push({ block: "search", path: searchPath });
        found = resolvePlayer(candidatesFromSearch(raw), league, query);
      } catch (err) {
        sources.push({ block: "search", path: searchPath });
        return {
          resolved: false,
          reason: "not_found",
          query,
          sport,
          league,
          candidates: [],
          errors: { search: blockError("search", err) },
          sources,
        };
      }
      if (!found.resolved) {
        return { resolved: false, reason: found.reason, query, sport, league, candidates: found.candidates, sources };
      }
      athleteId = found.athlete.id;
      fallback = { name: found.athlete.name, team: found.athlete.team };
    }

    const profilePath = athletePath(sport, league, athleteId);
    const statsPath = athletePath(sport, league, athleteId, "/stats");
    const gamelogPath = athletePath(sport, league, athleteId, "/gamelog");
    const splitsPath = athletePath(sport, league, athleteId, "/splits");
    const params = { season };

    const [profile, stats, gamelog, splits] = await Promise.all([
      loadBlock("athlete", "athlete", profilePath, () => fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}`)),
      blocks.has("season")
        ? loadBlock("season", "stats", statsPath, () =>
            fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}/stats`, { params }),
          )
        : undefined,
      blocks.has("recent")
        ? loadBlock("recent", "gamelog", gamelogPath, () =>
            fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}/gamelog`, { params }),
          )
        : undefined,
      blocks.has("splits")
        ? loadBlock("splits", "splits", splitsPath, () =>
            fetchJson(`${BASE.web}/${sport}/${league}/athletes/${athleteId}/splits`, { params }),
          )
        : undefined,
    ]);

    const errors: Record<string, string> = {};
    let athlete = athleteIdentity(undefined, athleteId, fallback);
    if (profile?.ok) {
      sources.push(profile.source);
      athlete = athleteIdentity(profile.value, athleteId, fallback);
    } else if (profile) {
      sources.push(profile.source);
      errors[profile.errorKey] = profile.error;
    }

    const out: Record<string, unknown> = { resolved: true, athlete, sources };
    if (stats?.ok) {
      sources.push(stats.source);
      out.season = namedSeasonStats(stats.value, season);
    } else if (stats) {
      sources.push(stats.source);
      errors[stats.errorKey] = stats.error;
    }
    if (gamelog?.ok) {
      sources.push(gamelog.source);
      out.recent = recentGames(transformGamelog(gamelog.value) as { games?: GamelogGame[] }, gamesWanted);
    } else if (gamelog) {
      sources.push(gamelog.source);
      errors[gamelog.errorKey] = gamelog.error;
    }
    if (splits?.ok) {
      sources.push(splits.source);
      out.splits = transformAthleteSplits(splits.value);
    } else if (splits) {
      sources.push(splits.source);
      errors[splits.errorKey] = splits.error;
    }
    if (Object.keys(errors).length) out.errors = errors;
    return out;
  },
});
