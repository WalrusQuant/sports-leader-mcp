#!/usr/bin/env node
/**
 * Capture raw ESPN responses as golden-test fixtures.
 *
 *   node scripts/capture-fixtures.mjs            # capture into test/fixtures
 *   UPDATE_GOLDEN=1 npm test                     # then regenerate test/golden
 *
 * Fixtures are *raw* upstream JSON, scrubbed and trimmed so the repo stays
 * small: UI/link/media keys are removed (transforms drop them anyway; this also
 * drops sportsbook deep links and tracking), and very long arrays (plays, win
 * probability, injury lists) are capped. `$ref` is kept because transforms
 * read team IDs from it.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures");
const SITE = "https://site.api.espn.com/apis/site/v2/sports";
const CORE = "https://sports.core.api.espn.com/v2/sports";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports";

// sport, league, a game day with posted odds, a recent game day with finals.
const LEAGUES = [
  ["football", "nfl", "20261011", "20261004"],
  ["baseball", "mlb", "20261006", "20261005"],
  ["basketball", "nba", "20261006", "20261005"],
  ["hockey", "nhl", "20261006", "20261005"],
  ["soccer", "eng.1", "20261010", null],
  ["football", "college-football", "20261008", "20261003"],
  ["basketball", "wnba", "20261007", "20261004"],
];

const DROP_KEYS = new Set([
  "links", "link", "tracking", "headshot", "headshots", "logo", "logos", "images",
  "videos", "video", "article", "news", "ticketsInfo", "tickets", "header_logo",
  "footer", "media", "posterImages", "thumbnail", "alternateIds",
  // sportsbook affiliate deep links and jersey renders
  "betSlipUrl", "deepLinkUrl", "jerseyImage",
]);
const CAP = { plays: 80, winprobability: 80, items: 120 };

function scrub(v, key = "") {
  if (Array.isArray(v)) {
    const cap = CAP[key];
    return (cap ? v.slice(0, cap) : v).map((x) => scrub(x));
  }
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (DROP_KEYS.has(k)) continue;
      // Sportsbook widget chrome: { header: { logo, text } }.
      if (k === "header" && x && typeof x === "object" && "logo" in x && "text" in x) continue;
      out[k] = scrub(x, k);
    }
    return out;
  }
  return v;
}

/**
 * League injuries: keep the teams on the captured scoreboard; per team keep up
 * to 12 entries, Out/Doubtful first, then other statuses, plus 2 "Active"
 * news-only entries so the Active filter stays under test.
 */
function trimInjuries(raw, teamIds) {
  const keep = new Set(teamIds);
  const rank = (s) => (/^(out|doubtful)$/i.test(s) ? 0 : s === "Active" ? 2 : 1);
  const buckets = (raw.injuries ?? []).filter((b) => keep.has(String(b.id)));
  for (const b of buckets) {
    const all = [...(b.injuries ?? [])].sort((x, y) => rank(x.status) - rank(y.status));
    const nonActive = all.filter((i) => i.status !== "Active").slice(0, 10);
    const active = all.filter((i) => i.status === "Active").slice(0, 2);
    b.injuries = [...nonActive, ...active];
  }
  return { ...raw, injuries: buckets };
}

/** Summary: keep only the sections the compact transform reads. */
const SUMMARY_KEYS = ["header", "boxscore", "leaders", "plays", "winprobability", "gameInfo", "broadcasts", "standings", "pickcenter", "odds", "injuries"];
function trimSummary(raw) {
  return Object.fromEntries(Object.entries(raw).filter(([k]) => SUMMARY_KEYS.includes(k)));
}

async function get(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return { __status: res.status };
  return res.json();
}

async function save(league, name, data) {
  const file = join(ROOT, league, `${name}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data) + "\n");
  console.log(`  ${league}/${name}.json ${Buffer.byteLength(JSON.stringify(data))} bytes`);
}

for (const [sport, league, oddsDay, finalDay] of LEAGUES) {
  console.log(`${sport}/${league}`);
  const sb = await get(`${SITE}/${sport}/${league}/scoreboard?dates=${oddsDay}`);
  await save(league, "scoreboard", scrub(sb));

  const withOdds = (sb.events ?? []).find((e) => e.competitions?.[0]?.odds);
  if (withOdds) {
    const id = withOdds.id;
    await save(league, "odds", scrub(await get(`${CORE}/${sport}/leagues/${league}/events/${id}/competitions/${id}/odds`)));
    await save(league, "event", scrub(await get(`${CORE}/${sport}/leagues/${league}/events/${id}`)));
  }

  let summaryId = withOdds?.id;
  if (finalDay) {
    const fin = await get(`${SITE}/${sport}/${league}/scoreboard?dates=${finalDay}`);
    summaryId = (fin.events ?? []).find((e) => e.status?.type?.state === "post")?.id ?? summaryId;
  }
  let athleteId;
  if (summaryId) {
    const summary = await get(`${SITE}/${sport}/${league}/summary?event=${summaryId}`);
    await save(league, "summary", scrub(trimSummary(summary)));
    athleteId =
      summary.leaders?.[0]?.leaders?.[0]?.leaders?.[0]?.athlete?.id ??
      summary.boxscore?.players?.[0]?.statistics?.[0]?.athletes?.[0]?.athlete?.id;
  }

  const injuries = await get(`${SITE}/${sport}/${league}/injuries`);
  if (!injuries.__status) {
    const teamIds = (sb.events ?? []).flatMap((e) => (e.competitions?.[0]?.competitors ?? []).map((c) => String(c.team?.id ?? c.id)));
    await save(league, "injuries", scrub(trimInjuries(injuries, teamIds)));
  } else {
    console.log(`  injuries: HTTP ${injuries.__status} (not captured)`);
  }

  if (athleteId) {
    const gl = await get(`${WEB}/${sport}/${league}/athletes/${athleteId}/gamelog`);
    if (!gl.__status) await save(league, "gamelog", scrub(gl));
    else console.log(`  gamelog ${athleteId}: HTTP ${gl.__status}`);
  }
}
