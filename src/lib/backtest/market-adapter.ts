import type { BacktestPropMarket, BacktestPropQuote } from "./types";

export function normalizeAmericanOdds(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export interface MarketSnapshot {
  marketId: string;
  line: number;
  overOdds: number;
  underOdds: number;
  sportsbook: string;
  /** Quotes that were considered (the chosen one is always included). */
  quotesConsidered: BacktestPropQuote[];
}

/**
 * Pick the most player-friendly quote for the chosen side. For an OVER
 * lean we want the highest `overOdds`; for an UNDER lean we want the
 * highest `underOdds`. With no side preference we maximize total
 * implied value (lowest combined no-vig overround).
 */
export function getBestAvailableQuote(
  market: BacktestPropMarket,
  quotes: BacktestPropQuote[],
  preferredSide: "OVER" | "UNDER" | undefined = undefined,
): MarketSnapshot {
  const relevant = quotes.filter((q) => q.marketId === market.id);
  const pool: BacktestPropQuote[] =
    relevant.length > 0
      ? relevant
      : [
          {
            marketId: market.id,
            sportsbook: market.sportsbook,
            line: market.line,
            overOdds: market.overOdds,
            underOdds: market.underOdds,
          },
        ];

  let chosen: BacktestPropQuote = pool[0];
  for (const q of pool) {
    if (preferredSide === "OVER") {
      if (q.overOdds > chosen.overOdds) chosen = q;
    } else if (preferredSide === "UNDER") {
      if (q.underOdds > chosen.underOdds) chosen = q;
    } else {
      // No side preference yet — pick the line+odds combination with
      // the lowest overround (best no-vig market).
      const chosenOverround =
        normalizeAmericanOdds(chosen.overOdds) +
          normalizeAmericanOdds(chosen.underOdds);
      const qOverround =
        normalizeAmericanOdds(q.overOdds) +
          normalizeAmericanOdds(q.underOdds);
      if (qOverround < chosenOverround) chosen = q;
    }
  }
  return {
    marketId: market.id,
    line: chosen.line,
    overOdds: chosen.overOdds,
    underOdds: chosen.underOdds,
    sportsbook: chosen.sportsbook,
    quotesConsidered: pool,
  };
}

export function calculateNoVigMarketProbability(
  overOdds: number,
  underOdds: number,
): { noVigOver: number; noVigUnder: number } {
  const o = normalizeAmericanOdds(overOdds);
  const u = normalizeAmericanOdds(underOdds);
  const total = o + u;
  if (total <= 0) return { noVigOver: 0.5, noVigUnder: 0.5 };
  const noVigOver = o / total;
  return { noVigOver, noVigUnder: 1 - noVigOver };
}

export function buildMarketSnapshotForBacktest(
  market: BacktestPropMarket,
  quotes: BacktestPropQuote[],
): MarketSnapshot {
  return getBestAvailableQuote(market, quotes, undefined);
}
