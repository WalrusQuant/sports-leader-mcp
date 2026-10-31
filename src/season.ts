import { BASE } from "./endpoints.js";
import { UpstreamError, fetchJson } from "./client.js";

/** Message from an ESPN error body, when the response is JSON. */
export function upstreamDetail(err: unknown): string {
  if (!(err instanceof UpstreamError)) return err instanceof Error ? err.message : String(err);
  const body = err.body?.trim();
  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
      const msg = parsed.error?.message ?? parsed.message;
      if (typeof msg === "string" && msg) return msg;
    } catch {
      return body;
    }
  }
  return err.message;
}

/**
 * Current season year from the Core league document (`season.year` is inline).
 * NBA/NHL/college basketball use the ending year (2026-27 → 2027). NFL, college
 * football, and MLB use the starting or calendar year.
 */
export async function leagueSeasonYear(sport: string, league: string): Promise<number> {
  const data = (await fetchJson(`${BASE.core}/${sport}/leagues/${league}`)) as {
    season?: { year?: number };
  };
  const year = Number(data?.season?.year);
  if (!Number.isInteger(year)) {
    throw new Error(`ESPN did not return a current season year for ${sport}/${league}`);
  }
  return year;
}

/**
 * Season-scoped Core leaders URLs.
 * Type 2 is the regular season for NFL/NBA/NHL/MLB/college.
 * Type 1 is what soccer actually publishes (type 2 404s).
 * Callers that pass `seasonType` get only that type.
 */
export function seasonLeadersPaths(
  sport: string,
  league: string,
  year: number,
  opts?: { seasonType?: number; teamId?: string },
): string[] {
  const types = opts?.seasonType !== undefined ? [opts.seasonType] : [2, 1];
  const tail = opts?.teamId ? `/teams/${opts.teamId}/leaders` : "/leaders";
  return types.map(
    (seasonType) => `${BASE.core}/${sport}/leagues/${league}/seasons/${year}/types/${seasonType}${tail}`,
  );
}

/** Try URLs in order. 400 and 404 move on; anything else throws. */
export async function fetchFirstOk(urls: string[]): Promise<unknown> {
  let last: unknown;
  for (const url of urls) {
    try {
      return await fetchJson(url);
    } catch (err) {
      last = err;
      if (err instanceof UpstreamError && (err.status === 400 || err.status === 404)) continue;
      throw err;
    }
  }
  throw last instanceof Error ? last : new Error("No ESPN endpoint succeeded");
}

/**
 * Core collection endpoints page. `limit` is honored up to a few hundred; if
 * `count` is larger, follow `page` until the collection is exhausted. A repeated
 * first row means the server ignored `page`, so stop rather than duplicating.
 */
export async function fetchPagedItems(
  url: string,
  limit = 200,
): Promise<{ count: number; items: unknown[] }> {
  const items: unknown[] = [];
  let count = 0;
  let firstSig: string | undefined;
  for (let page = 1; page <= 8; page++) {
    const data = (await fetchJson(url, { params: { limit, page } })) as {
      count?: number;
      items?: unknown[];
    };
    const batch = Array.isArray(data.items) ? data.items : [];
    count = Number(data.count ?? count);
    if (batch.length === 0) break;
    const sig = JSON.stringify(batch[0]).slice(0, 180);
    if (page > 1 && sig === firstSig) break;
    if (page === 1) firstSig = sig;
    items.push(...batch);
    if (count && items.length >= count) break;
    if (batch.length < limit) break;
  }
  return { count: count || items.length, items };
}
