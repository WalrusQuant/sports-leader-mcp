import { z } from "zod";
import { defineTool } from "../tool.js";
import { dateSchema, eventIdSchema, leagueSchema, sportSchema } from "../schemas.js";
import { kalshiMarketsOutput, marketOddsOutput, polymarketMarketsOutput } from "../output-schemas.js";
import { supportedLeagueList } from "../markets/aliases.js";
import { getKalshiMarkets, getMarketOdds, getPolymarketMarkets } from "../markets/service.js";

const leagueParam = z
  .string()
  .min(1)
  .describe(
    `League slug with a fixed Kalshi series and Polymarket series id: ${supportedLeagueList()}. ` +
      "Short keys cfb, cbb, and cwbb are accepted. Team codes differ across ESPN, Kalshi, and Polymarket; matching uses the alias table.",
  );

const teamParam = z
  .string()
  .min(1)
  .optional()
  .describe("Team abbreviation or name. ESPN, Kalshi, and Polymarket codes are matched through the alias table.");

const bookParam = z
  .boolean()
  .optional()
  .describe(
    "Include the top of book. Kalshi yes ask is 1 minus the best no bid and is labelled orderbook. " +
      "Polymarket uses the CLOB /book (labelled clob_book), not /price?side=buy. Default false.",
  );

export const getKalshiMarketsTool = defineTool({
  name: "get_kalshi_markets",
  title: "Get Kalshi markets",
  description:
    "Keyless Kalshi prices for one league. No API key. market is winner (default), spread, or total. " +
    "Prices are the *_dollars fields. Event tickers encode the original scheduled date plus away and home codes; postponed games keep that date. " +
    "Spread suffixes may end in the line (NOP9). Team names and nicknames are returned with the codes. " +
    "Pass includeBook for the top of book, where the yes ask is 1 minus the best no bid.",
  inputShape: {
    league: leagueParam,
    date: dateSchema,
    team: teamParam,
    market: z.enum(["winner", "spread", "total"]).optional().describe("winner (moneyline, default), spread, or total."),
    includeBook: bookParam,
  },
  outputSchema: kalshiMarketsOutput,
  handler: (args) => getKalshiMarkets(args),
});

export const getPolymarketMarketsTool = defineTool({
  name: "get_polymarket_markets",
  title: "Get Polymarket markets",
  description:
    "Keyless Polymarket prices for one league. No API key. venue=both (default) returns polymarket and polymarket_us, each labelled and never averaged. " +
    "marketType defaults to moneyline (winner). outcomes and clobTokenIds are decoded from Gamma's JSON strings. " +
    "Global prices are gamma_outcome_prices unless includeBook requests the CLOB book (clob_book). " +
    "The US slug is aec- plus Gamma usId when Gamma sends one. When usId is missing it is aec-{sport}-{away}-{home}-{eventDate}, trying Gamma and ESPN codes and the swapped order. " +
    "A date filter uses eventDate alone when Gamma sends it, so the previous night's late tip is not included.",
  inputShape: {
    league: leagueParam,
    date: dateSchema,
    team: teamParam,
    marketType: z
      .string()
      .min(1)
      .optional()
      .describe("Gamma sportsMarketType. moneyline (default), spreads, totals, or another type such as first_half_moneyline. winner/spread/total are accepted."),
    venue: z
      .enum(["both", "polymarket", "polymarket_us"])
      .optional()
      .describe("both (default) labels polymarket and polymarket_us separately. One venue failing does not drop the other."),
    includeBook: bookParam,
  },
  outputSchema: polymarketMarketsOutput,
  handler: (args) => getPolymarketMarkets(args),
});

export const getMarketOddsTool = defineTool({
  name: "get_market_odds",
  title: "Get prediction-market odds for an ESPN game",
  description:
    "Match one ESPN game to Kalshi, Polymarket, and Polymarket US. No API key. Venues sit side by side and are never averaged. " +
    "venue defaults to all. A venue with no listing is { venue, status: \"no market found\" }. One venue failing does not drop the others. " +
    "fetchedAt is when the response was built. matchedBy says how the ESPN game and each venue were matched. " +
    "Pass eventId from get_scoreboard, or team and date. A team must match one game; more than one match asks for eventId. " +
    "Home and away may be listed in either order (neutral sites). Prices stay on the team, not the side. " +
    "The US slug is aec- plus Gamma usId, or a constructed aec-{sport}-{away}-{home}-{eventDate} when usId is missing.",
  inputShape: {
    sport: sportSchema,
    league: leagueSchema,
    eventId: eventIdSchema.optional(),
    team: teamParam,
    date: dateSchema,
    venue: z
      .enum(["all", "kalshi", "polymarket", "polymarket_us"])
      .optional()
      .describe("all (default) returns every venue, labelled. A missing venue does not remove the others."),
  },
  outputSchema: marketOddsOutput,
  handler: (args) => getMarketOdds(args),
});

export const marketTools = [getKalshiMarketsTool, getPolymarketMarketsTool, getMarketOddsTool];
