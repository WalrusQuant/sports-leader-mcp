import { z } from "zod";
import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { transformSlate, type SlateRaw } from "../transforms.js";
import { dateRangeSchema, dateSchema, groupsSchema, leagueSchema, offsetSchema, sportSchema } from "../schemas.js";
import { slateOutput } from "../output-schemas.js";
import { slateLinks } from "../links.js";
import { assertScoreboardRange, fetchScoreboard, scoreboardMayBeExportOnly } from "./scoreboard.js";

export const getSlate = defineTool({
  name: "get_slate",
  title: "Get daily slate",
  description:
    "One call for a day's games: eventId, startUtc, home/away team IDs and abbreviations, status and score, consensus no-vig win probabilities (home/away/draw), moneylines, signed homeSpread (negative = home favored), total, and key Out/Doubtful injuries for both teams. date is ESPN's game day (US Eastern), YYYYMMDD; omit for the current slate. Days older than the games export's updated_at, and older than today and the previous 2 US-Eastern days, come from the public Parquet games file in one query for mlb, nba, nfl, nhl, college-football (cfb), and mens-college-basketball (cbb). game_id is the ESPN event id. Those games omit odds (the odds fields are null) and do not use the current injury report. source is data, espn, or mixed. Today, the previous 2 days, future days, a missing season, and any other league stay on ESPN, one day at a time (at most 14 of those days) because ESPN rejects a range. A season-length range is allowed when the export covers it. Pass offset when the page note says the slate was shortened to stay within the token budget. Men's and women's college basketball ESPN days default to every Division I game (group 50, limit 400). The injury report is the current league report, fetched once, and is applied only to ESPN days. Use get_game_odds for every sportsbook's line.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    date: dateSchema,
    dateRange: dateRangeSchema,
    groups: groupsSchema,
    offset: offsetSchema,
    includeInjuries: z
      .boolean()
      .optional()
      .describe("Include key Out/Doubtful injuries for ESPN days (one extra cached ESPN call). Default true. Days served from the games export do not use this report."),
  },
  outputSchema: slateOutput,
  handler: async ({ sport, league, date, dateRange, groups, includeInjuries }): Promise<SlateRaw> => {
    const dates = dateRange ?? date;
    assertScoreboardRange(dates);
    const scoreboardP = fetchScoreboard(sport, league, { dates, groups });
    if (includeInjuries === false) {
      return { scoreboard: await scoreboardP, injuriesError: "not requested (includeInjuries=false)" };
    }
    const exportOnly = scoreboardMayBeExportOnly(sport, league, dates, groups);
    if (exportOnly) {
      const scoreboard = await scoreboardP;
      const source = scoreboard && typeof scoreboard === "object" && !Array.isArray(scoreboard)
        ? (scoreboard as { source?: string }).source
        : undefined;
      if (source === "data") {
        return {
          scoreboard,
          injuriesError: "not requested (these games are from the historical games export, which has no injury report)",
        };
      }
      try {
        return { scoreboard, injuries: await fetchJson(`${BASE.site}/${sport}/${league}/injuries`) };
      } catch (err) {
        return { scoreboard, injuriesError: err instanceof Error ? err.message : String(err) };
      }
    }
    const [scoreboard, injuries] = await Promise.allSettled([
      scoreboardP,
      fetchJson(`${BASE.site}/${sport}/${league}/injuries`),
    ]);
    if (scoreboard.status === "rejected") throw scoreboard.reason;
    if (injuries.status === "rejected") {
      const err = injuries.reason;
      return {
        scoreboard: scoreboard.value,
        injuriesError: err instanceof Error ? err.message : String(err),
      };
    }
    return { scoreboard: scoreboard.value, injuries: injuries.value };
  },
  transform: transformSlate,
  links: slateLinks,
});

export const slateTools = [getSlate];
