#!/usr/bin/env node
/**
 * Live health check for sports-leader-mcp.
 *
 * Calls every tool against ESPN (compact output, output schemas included) for
 * the leagues the server is used for day to day, plus WNBA and Premier League.
 * Prints a pass/fail line per case and exits 1 if anything that should work
 * failed. Not part of `npm test` — ESPN changes, and this needs the network.
 *
 *   npm run audit
 *
 * MLB in late October / November is the offseason: today's scoreboard may be
 * empty or stuck on the last postseason game. The audit always rechecks MLB
 * on 2026-07-04.
 */

import { ALL_TOOLS, produce } from "../dist/server.js";
import { apiCache } from "../dist/client.js";
import { isDataExportConfigured } from "../dist/data/config.js";
import { DATASET_NAMES, DATA_TOOL_NAMES, auditCallForFile } from "../dist/data/tools.js";

const tools = new Map(ALL_TOOLS.map((tool) => [tool.name, tool]));
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
})
  .format(new Date())
  .replaceAll("-", "");

const LEAGUES = [
  { key: "nfl", sport: "football", league: "nfl", past: "20261018", athlete: "3139477", season: 2026 },
  { key: "nba", sport: "basketball", league: "nba", past: "20261028", athlete: "1966", season: 2027 },
  { key: "nhl", sport: "hockey", league: "nhl", past: "20261028", athlete: "3895074", season: 2027 },
  { key: "mlb", sport: "baseball", league: "mlb", past: "20260704", athlete: "39832", season: 2026, offseason: true },
  { key: "cfb", sport: "football", league: "college-football", past: "20261024", season: 2026 },
  { key: "cbb", sport: "basketball", league: "mens-college-basketball", past: "20260315", season: 2026 },
  { key: "wcbb", sport: "basketball", league: "womens-college-basketball", past: "20260315", season: 2026 },
  { key: "wnba", sport: "basketball", league: "wnba", past: "20260820", season: 2026 },
  { key: "epl", sport: "soccer", league: "eng.1", past: "20261025", season: 2025 },
];

const rows = [];

function line(status, tool, label, detail) {
  rows.push({ status, tool, label, detail });
  const tag = status === "pass" ? "PASS" : status === "skip" ? "SKIP" : "FAIL";
  console.log(`${tag}  ${tool.padEnd(26)} ${label.padEnd(32)} ${detail}`);
}

async function call(name, args) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`unknown tool ${name}`);
  const data = await produce(tool, args, true);
  if (data && typeof data === "object" && data.truncated === true) {
    throw new Error(`truncated at ~${data.estimatedTokens} tokens`);
  }
  if (tool.outputSchema) {
    const parsed = tool.outputSchema.safeParse(data);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .slice(0, 4)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new Error(`output schema: ${msg}`);
    }
  }
  return data;
}

async function check(tool, label, fn) {
  try {
    const detail = await fn();
    line("pass", tool, label, detail ?? "");
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    line("fail", tool, label, message.slice(0, 240));
    return false;
  }
}

function eventsOf(scoreboard) {
  return Array.isArray(scoreboard?.events) ? scoreboard.events : [];
}

function postEvent(scoreboard) {
  const events = eventsOf(scoreboard);
  return events.find((event) => event?.status?.state === "post") ?? events[0];
}

function teamIdOf(event) {
  for (const competitor of event?.competitors ?? []) {
    if (competitor?.team?.id) return String(competitor.team.id);
  }
  return undefined;
}

async function pool(jobs, width = 4) {
  const queue = [...jobs];
  const workers = Array.from({ length: width }, async () => {
    while (queue.length) {
      const job = queue.shift();
      await job();
    }
  });
  await Promise.all(workers);
}

console.log(`sports-leader-mcp live audit`);
console.log(`today (US Eastern) ${today}    tools ${ALL_TOOLS.length}`);
console.log("");

const boards = new Map();

await pool(
  LEAGUES.flatMap((league) => [
    async () => {
      await check("get_scoreboard", `${league.key} today`, async () => {
        const data = await call("get_scoreboard", { sport: league.sport, league: league.league });
        boards.set(`${league.key}:today`, data);
        const n = eventsOf(data).length;
        if (!league.offseason && n === 0) throw new Error("empty scoreboard");
        return league.offseason ? `events=${n} (MLB offseason; empty or last postseason game is ok)` : `events=${n}`;
      });
    },
    async () => {
      await check("get_scoreboard", `${league.key} ${league.past}`, async () => {
        const data = await call("get_scoreboard", {
          sport: league.sport,
          league: league.league,
          date: league.past,
        });
        boards.set(`${league.key}:past`, data);
        const n = eventsOf(data).length;
        if (n === 0) throw new Error(`no games on ${league.past}`);
        return `events=${n}`;
      });
    },
  ]),
  4,
);

await check("get_scoreboard", "pga athlete", async () => {
  const data = await call("get_scoreboard", { sport: "golf", league: "pga" });
  const competitors = eventsOf(data).flatMap((event) => event.competitors ?? []);
  if (eventsOf(data).length === 0) return "no current tournament";
  const named = competitors.filter((competitor) => competitor.athlete?.name);
  if (named.length === 0) throw new Error("golf competitors have no athlete name");
  const sample = named[0];
  if (sample.order == null) throw new Error("golf competitor missing order");
  return `${sample.athlete.name} order=${sample.order} (${named.length} named)`;
});

await check("list_sports_and_leagues", "catalog", async () => {
  const data = await call("list_sports_and_leagues", {});
  if (data.count !== 30) throw new Error(`count ${data.count}`);
  return `leagues=${data.count}`;
});

await check("search", "LeBron James", async () => {
  const data = await call("search", { query: "LeBron James", sport: "basketball", limit: 5 });
  const hit = (data.groups ?? []).flatMap((group) => group.results ?? []).find((result) => result.id);
  if (!hit) throw new Error("no athlete id");
  return `${hit.name} id=${hit.id}`;
});

await check("espn_fetch", "nba league root", async () => {
  // A full raw scoreboard is over the token budget on purpose. This checks
  // the escape hatch against a small Core document instead.
  const data = await call("espn_fetch", {
    url: "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba",
  });
  if (!data || typeof data !== "object") throw new Error("not json");
  if (!data.season?.year) throw new Error("missing season.year");
  return `season=${data.season.year}`;
});

await check("endpoint", "cdn nba scoreboard xhr=1", async () => {
  const res = await fetch("https://cdn.espn.com/core/nba/scoreboard?xhr=1", {
    headers: { "User-Agent": "sports-leader-mcp-audit/0.5.1", Accept: "application/json" },
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!type.includes("json")) throw new Error(`content-type ${type}`);
  return `HTTP ${res.status} ${type.split(";")[0]}`;
});

const gameJobs = [];
const leagueJobs = [];

for (const league of LEAGUES) {
  const past = boards.get(`${league.key}:past`);
  const event = postEvent(past);
  const eventId = event?.id ? String(event.id) : undefined;
  const teamId = teamIdOf(event);
  const base = { sport: league.sport, league: league.league };

  leagueJobs.push(async () => {
    await check("get_teams", league.key, async () => {
      const data = await call("get_teams", base);
      const n = data.teams?.length ?? 0;
      const min = league.key === "cfb" ? 400 : league.key === "cbb" || league.key === "wcbb" ? 300 : league.key === "epl" ? 18 : 12;
      if (n < min) throw new Error(`only ${n} teams (expected >= ${min})`);
      return `teams=${n}`;
    });
  });

  leagueJobs.push(async () => {
    await check("get_standings", league.key, async () => {
      const data = await call("get_standings", base);
      const entries = (data.standings ?? []).reduce((sum, group) => sum + (group.entries?.length ?? 0), 0);
      if (entries === 0) throw new Error("no standings entries");
      return `entries=${entries}`;
    });
  });

  leagueJobs.push(async () => {
    await check("get_league_leaders", league.key, async () => {
      const data = await call("get_league_leaders", { ...base, season: league.season });
      const n = data.categories?.length ?? 0;
      if (n === 0) throw new Error("no leader categories");
      if (data.season && data.season !== league.season) {
        throw new Error(`season ${data.season}, wanted ${league.season}`);
      }
      return `season=${data.season ?? "?"} categories=${n}`;
    });
  });

  leagueJobs.push(async () => {
    await check("get_injuries", league.key, async () => {
      const data = await call("get_injuries", base);
      const n = data.injuries?.length ?? 0;
      const required = ["nfl", "nba", "nhl", "mlb", "wnba"].includes(league.key);
      if (required && n === 0) throw new Error("empty injury report");
      return n === 0 ? "empty (ok for this league right now)" : `teams=${n}`;
    });
  });

  leagueJobs.push(async () => {
    await check("get_transactions", league.key, async () => {
      const data = await call("get_transactions", base);
      if (!data || typeof data !== "object") throw new Error("empty document");
      const n = data.transactions?.length ?? data.count ?? 0;
      return `transactions=${n}`;
    });
  });

  leagueJobs.push(async () => {
    await check("get_news", league.key, async () => {
      const data = await call("get_news", { ...base, limit: 5 });
      const n = data.headlines?.length ?? 0;
      if (n === 0) throw new Error("no headlines");
      return `headlines=${n}`;
    });
  });

  leagueJobs.push(async () => {
    await check("get_rankings", league.key, async () => {
      const data = await call("get_rankings", base);
      const polls = data.polls?.length ?? 0;
      const college = ["cfb", "cbb", "wcbb"].includes(league.key);
      if (college) {
        if (data.unavailable) throw new Error(data.unavailable);
        if (polls === 0) throw new Error("no polls");
        const top = data.polls[0]?.ranks?.[0];
        return `${data.polls[0].name} #1 ${top?.team?.abbrev ?? "?"} (${polls} polls)`;
      }
      if (!data.unavailable) throw new Error("expected unavailable for a pro league");
      return `unavailable (${String(data.unavailable).slice(0, 80)})`;
    });
  });

  leagueJobs.push(async () => {
    await check("get_power_index", league.key, async () => {
      const data = await call("get_power_index", { ...base, season: league.season });
      const n = data.teams?.length ?? 0;
      const supported = ["nfl", "nba", "cfb", "cbb", "wnba"].includes(league.key);
      if (supported) {
        if (data.unavailable) throw new Error(data.unavailable);
        if (n < 10) throw new Error(`only ${n} teams`);
        return `teams=${n} first=${data.teams[0].teamId}`;
      }
      if (!data.unavailable && n === 0) throw new Error("neither teams nor unavailable");
      return data.unavailable ? `unavailable (${String(data.unavailable).slice(0, 80)})` : `teams=${n}`;
    });
  });

  leagueJobs.push(async () => {
    await check("get_futures", league.key, async () => {
      const data = await call("get_futures", { ...base, season: league.season });
      const n = data.markets?.length ?? 0;
      const required = ["nfl", "nba", "nhl", "cfb"].includes(league.key);
      if (data.unavailable) return `unavailable (${String(data.unavailable).slice(0, 80)})`;
      if (required && n === 0) throw new Error("no futures markets");
      const sample = data.markets?.[0];
      return n === 0 ? "no markets posted" : `markets=${n} ${sample?.name ?? ""}`.trim();
    });
  });

  leagueJobs.push(async () => {
    await check("get_slate", `${league.key} ${league.past}`, async () => {
      const data = await call("get_slate", { ...base, date: league.past, includeInjuries: true });
      if ((data.gameCount ?? 0) === 0) throw new Error("no games");
      return `games=${data.gameCount}`;
    });
  });

  if (eventId) {
    gameJobs.push(async () => {
      await check("get_game_summary", `${league.key} ${eventId}`, async () => {
        const data = await call("get_game_summary", { ...base, eventId });
        if (!data.game?.id) throw new Error("missing game.id");
        const players = data.boxscore?.players?.length ?? 0;
        return `status=${data.game.status?.state ?? "?"} boxscorePlayers=${players}`;
      });
    });
    gameJobs.push(async () => {
      await check("get_game_plays", `${league.key} ${eventId}`, async () => {
        const data = await call("get_game_plays", { ...base, eventId, limit: 20 });
        const n = data.plays?.length ?? 0;
        if (event?.status?.state === "post" && n === 0 && !["wcbb"].includes(league.key)) {
          throw new Error("completed game returned no plays");
        }
        return `plays=${n}`;
      });
    });
    gameJobs.push(async () => {
      await check("get_game_odds", `${league.key} ${eventId}`, async () => {
        const data = await call("get_game_odds", { ...base, eventId });
        const n = data.odds?.length ?? 0;
        if (["nfl", "nba"].includes(league.key) && n === 0) throw new Error("no odds");
        return `books=${n} home=${data.homeTeam?.abbrev ?? data.homeTeam?.id ?? "?"}`;
      });
    });
    gameJobs.push(async () => {
      await check("get_game_probabilities", `${league.key} ${eventId}`, async () => {
        const data = await call("get_game_probabilities", { ...base, eventId, limit: 20 });
        const n = data.probabilities?.length ?? 0;
        const never = ["nhl", "epl"].includes(league.key);
        if (never) {
          if (!data.unavailable && n === 0) throw new Error("expected unavailable");
          return data.unavailable ? `unavailable (${String(data.unavailable).slice(0, 70)})` : `points=${n}`;
        }
        if (event?.status?.state === "post" && n === 0) {
          throw new Error(data.unavailable ? String(data.unavailable) : "no probability points");
        }
        return data.unavailable ? `unavailable (${String(data.unavailable).slice(0, 70)})` : `points=${n}`;
      });
    });
  } else {
    line("fail", "get_game_summary", league.key, "no event id from the past scoreboard");
  }

  if (teamId) {
    const views = ["detail", "roster", "schedule", "record", "depthcharts", "injuries", "transactions", "history", "news", "leaders"];
    for (const view of views) {
      leagueJobs.push(async () => {
        await check("get_team", `${league.key} ${view} ${teamId}`, async () => {
          const data = await call("get_team", { ...base, teamId, view });
          if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
            throw new Error("empty document");
          }
          if (view === "roster" && !(data.athletes?.length > 0)) throw new Error("no athletes");
          if (view === "schedule" && !(data.eventCount > 0)) throw new Error("no events");
          if (view === "history" && !data.note) throw new Error("missing history note");
          if (view === "leaders" && !(data.categories?.length > 0)) throw new Error("no leader categories");
          if (view === "news" && ["nba", "nfl"].includes(league.key) && !(data.headlines?.length > 0)) {
            throw new Error("no headlines");
          }
          if (view === "depthcharts" && ["nba", "nfl", "nhl"].includes(league.key) && !(data.formations?.length > 0)) {
            throw new Error("no formations");
          }
          if (view === "schedule") return `events=${data.eventCount}`;
          if (view === "roster") return `athletes=${data.athletes.length}`;
          if (view === "leaders") return `categories=${data.categories.length}`;
          if (view === "news") return `headlines=${data.headlines?.length ?? 0}`;
          if (view === "depthcharts") return `formations=${data.formations?.length ?? 0}`;
          return Object.keys(data).slice(0, 4).join(",");
        });
      });
    }
    leagueJobs.push(async () => {
      await check("get_team_injuries", `${league.key} ${teamId}`, async () => {
        const data = await call("get_team_injuries", { ...base, teamId });
        return `injuries=${data.injuries?.length ?? 0}`;
      });
    });
    leagueJobs.push(async () => {
      await check("get_team_stats", `${league.key} ${teamId}`, async () => {
        const data = await call("get_team_stats", { ...base, teamId, season: league.season });
        const n = data.categories?.length ?? 0;
        if (["nba", "nfl", "nhl", "mlb", "cfb"].includes(league.key) && n === 0) throw new Error("no stat categories");
        return `categories=${n} season=${data.season?.year ?? "?"}`;
      });
    });
  }

  if (league.athlete) {
    const athleteId = league.athlete;
    for (const [tool, extra] of [
      ["get_athlete_overview", {}],
      ["get_athlete_stats", { season: league.season }],
      ["get_athlete_gamelog", { season: league.season }],
      ["get_athlete_splits", { season: league.season }],
    ]) {
      leagueJobs.push(async () => {
        await check(tool, `${league.key} ${athleteId}`, async () => {
          const data = await call(tool, { ...base, athleteId, ...extra });
          if (!data || typeof data !== "object") throw new Error("empty");
          if (tool === "get_athlete_gamelog" && !(data.games?.length > 0)) throw new Error("no games");
          if (tool === "get_athlete_stats" && !(data.categories?.length > 0)) throw new Error("no categories");
          if (tool === "get_athlete_splits" && !(data.categories?.length > 0) && !data.splitCategories) {
            throw new Error("no splits");
          }
          return tool === "get_athlete_gamelog" ? `games=${data.games.length}` : `keys=${Object.keys(data).slice(0, 4).join(",")}`;
        });
      });
    }
  }
}

await check("get_news", "nba team LAL", async () => {
  const data = await call("get_news", { sport: "basketball", league: "nba", team: "LAL", limit: 5 });
  const n = data.headlines?.length ?? 0;
  if (n === 0) throw new Error("team filter returned nothing");
  return `headlines=${n} ${data.headlines[0].headline?.slice(0, 60) ?? ""}`;
});

// Clear nothing: produce() benefits from the scoreboard cache within a case,
// and each case uses its own URLs. The cache is process-local.
apiCache.clear();

await pool([...gameJobs, ...leagueJobs], 4);

await auditDataExport();

const failed = rows.filter((row) => row.status === "fail");
const skipped = rows.filter((row) => row.status === "skip");
const passed = rows.filter((row) => row.status === "pass");
console.log("");
console.log(`${passed.length} passed, ${failed.length} failed, ${skipped.length} skipped, ${rows.length} total`);
if (failed.length) {
  console.log("Failures:");
  for (const row of failed) console.log(`  ${row.tool}  ${row.label}  ${row.detail}`);
  process.exit(1);
}

/**
 * Historical Parquet export on GitHub Releases. No API key. A cleared
 * manifest default with both BAYES_DATA_MANIFEST_URL and BAYES_DATA_BASE_URL
 * unset is a skip, not a failure. One file per data set.
 */
async function auditDataExport() {
  console.log("");
  console.log("data export");
  if (!isDataExportConfigured()) {
    const reason = "skipped (no manifest URL: set BAYES_DATA_MANIFEST_URL or BAYES_DATA_BASE_URL)";
    for (const name of DATA_TOOL_NAMES) line("skip", name, "data export", reason);
    return;
  }

  let files = [];
  const manifestOk = await check("get_data_status", "manifest", async () => {
    const data = await call("get_data_status", {});
    if (!data?.generated_at) throw new Error("missing generated_at");
    files = Array.isArray(data.files) ? data.files : [];
    if (files.length === 0) throw new Error("manifest has no files");
    const datasets = new Set(files.map((file) => file.dataset));
    return `files=${files.length} datasets=${datasets.size} stale=${data.stale?.length ?? 0} generated=${data.generated_at}`;
  });
  if (!manifestOk) {
    for (const dataset of DATASET_NAMES) line("fail", "data export", dataset, "manifest check failed");
    return;
  }

  for (const dataset of DATASET_NAMES) {
    const file = files.find((item) => item.dataset === dataset);
    if (!file) {
      line("fail", "data export", dataset, "missing from manifest");
      continue;
    }
    let spec;
    try {
      spec = auditCallForFile(file);
    } catch (err) {
      line("fail", "data export", dataset, err instanceof Error ? err.message : String(err));
      continue;
    }
    await check(spec.tool, `${dataset} ${file.league} ${file.season}`, async () => {
      const data = await call(spec.tool, spec.args);
      if (data?.dataset !== dataset) throw new Error(`dataset ${data?.dataset ?? "?"}`);
      if (!data.updated_at) throw new Error("missing updated_at");
      return `rows=${data.rowCount} updated_at=${data.updated_at}`;
    });
  }
}
