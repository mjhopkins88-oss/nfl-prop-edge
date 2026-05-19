// Data layer — backtest performance summary.
//
// V1: reads a hand-crafted snapshot from `src/lib/mock-data.ts`.
// FUTURE: aggregate over a settled-results table once graded props
// start flowing into the database — see the inline `FUTURE` comment
// below for the rough Prisma shape.

import { backtestMockSummary } from "../mock-data";
import type { BacktestSummary } from "../types";

export function getBacktestSummary(): BacktestSummary {
  // FUTURE: replace with something like
  //   const byMarket = await prisma.propResult.groupBy({
  //     by: ["propType"],
  //     _count: { _all: true },
  //     _sum: { profitUnits: true, stakedUnits: true },
  //     where: { settledAt: { gte: windowStart } },
  //   });
  //   const totals = await prisma.propResult.aggregate({ ... });
  //   return rollUp(totals, byMarket);
  return backtestMockSummary;
}
