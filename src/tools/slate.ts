import { z } from "zod";
import { BASE } from "../endpoints.js";
import { fetchJson } from "../client.js";
import { defineTool } from "../tool.js";
import { transformSlate, type SlateRaw } from "../transforms.js";
import { dateRangeSchema, dateSchema, groupsSchema, leagueSchema, sportSchema } from "../schemas.js";
import { slateOutput } from "../output-schemas.js";
import { slateLinks } from "../links.js";
import { assertCollegeBasketballRange, fetchScoreboard } from "./scoreboard.js";

export const getSlate = defineTool({
  name: "get_slate",
  title: "Get daily slate",
  description:
    "One call for a day's games: eventId, startUtc, home/away team IDs and abbreviations, status and score, consensus no-vig win probabilities (home/away/draw), moneylines, signed homeSpread (negative = home favored), total, and key Out/Doubtful injuries for both teams. date is ESPN's game day (US Eastern), YYYYMMDD; omit for the current slate. dateRange (YYYYMMDD-YYYYMMDD) covers more than one day. Men's and women's college basketball default to every Division I game (group 50, limit 400); a dateRange for those leagues is one scoreboard request per day (at most 14) because ESPN rejects a range. Other leagues send the range in one request. The injury report is the current league report. A single day uses the scoreboard and that report (2 cached ESPN calls). Use get_game_odds for every sportsbook's line.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    date: dateSchema,
    dateRange: dateRangeSchema,
    groups: groupsSchema,
    includeInjuries: z
      .boolean()
      .optional()
      .describe("Include key Out/Doubtful injuries (one extra cached ESPN call). Default true."),
  },
  outputSchema: slateOutput,
  handler: async ({ sport, league, date, dateRange, groups, includeInjuries }): Promise<SlateRaw> => {
    const dates = dateRange ?? date;
    assertCollegeBasketballRange(sport, league, dates);
    const scoreboardP = fetchScoreboard(sport, league, { dates, groups });
    if (includeInjuries === false) {
      return { scoreboard: await scoreboardP, injuriesError: "not requested (includeInjuries=false)" };
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
