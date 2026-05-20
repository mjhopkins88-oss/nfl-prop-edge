/**
 * Backtest grading.
 *
 * Compare scorecard recommendation against the actual stat the player
 * produced in the test week. PASS rows still count as evaluated but
 * are not bets — no profit/loss is assigned.
 *
 * Flat staking: 1 unit risk per qualified bet. American odds → payout
 * on a WIN, -1 unit on a LOSS, 0 on PUSH/PASS.
 */

import type { PropType } from "../types";
import type {
  BacktestCandidate,
  BacktestGradedResult,
  BacktestOutcome,
  BacktestPlayerWeekStat,
} from "./types";
import { getPrimaryDisqualifier } from "../model/model-scorecard";
import { selectedEdge } from "../model/prop-opportunity";

const STAT_KEY_BY_PROP_TYPE: Record<PropType, keyof BacktestPlayerWeekStat> = {
  PASSING_ATTEMPTS: "passingAttempts",
  PASSING_COMPLETIONS: "passingCompletions",
  PASSING_YARDS: "passingYards",
  RECEPTIONS: "receptions",
  RECEIVING_YARDS: "receivingYards",
  RUSHING_ATTEMPTS: "rushingAttempts",
  RUSHING_YARDS: "rushingYards",
};

export function getActualStatForProp(args: {
  playerId: string;
  propType: PropType;
  season: number;
  week: number;
  playerWeekStats: BacktestPlayerWeekStat[];
}): number | null {
  const row = args.playerWeekStats.find(
    (r) =>
      r.playerId === args.playerId &&
      r.season === args.season &&
      r.week === args.week,
  );
  if (!row) return null;
  const key = STAT_KEY_BY_PROP_TYPE[args.propType];
  const value = row[key];
  return typeof value === "number" ? value : null;
}

function americanPayoutMultiplier(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

export function gradeBacktestCandidate(args: {
  candidate: BacktestCandidate;
  playerWeekStats: BacktestPlayerWeekStat[];
}): BacktestGradedResult {
  const { candidate } = args;
  const sc = candidate.scorecard;
  const actual = getActualStatForProp({
    playerId: candidate.playerId,
    propType: candidate.propType,
    season: candidate.season,
    week: candidate.week,
    playerWeekStats: args.playerWeekStats,
  });

  let outcome: BacktestOutcome = "NO_RESULT";
  let profitLossUnits = 0;
  const bet = sc.qualified && sc.recommendation !== "PASS";

  if (!bet) {
    outcome = "PASS";
  } else if (actual === null) {
    outcome = "NO_RESULT";
  } else if (actual === sc.marketLine) {
    outcome = "PUSH";
  } else {
    const overWins = actual > sc.marketLine;
    const win =
      (sc.recommendation === "OVER" && overWins) ||
      (sc.recommendation === "UNDER" && !overWins);
    if (win) {
      outcome = "WIN";
      const odds =
        sc.recommendation === "OVER" ? candidate.scorecard.overOdds : candidate.scorecard.underOdds;
      profitLossUnits = americanPayoutMultiplier(odds);
    } else {
      outcome = "LOSS";
      profitLossUnits = -1;
    }
  }

  return {
    candidate,
    recommendation: sc.recommendation,
    qualified: sc.qualified,
    bet,
    actualStat: actual,
    outcome,
    profitLossUnits,
    edgeAtRecommendation: selectedEdge(sc),
    primaryDisqualifier: getPrimaryDisqualifier(sc) ?? undefined,
  };
}

export function gradeBacktestResults(args: {
  candidates: BacktestCandidate[];
  playerWeekStats: BacktestPlayerWeekStat[];
}): BacktestGradedResult[] {
  return args.candidates.map((candidate) =>
    gradeBacktestCandidate({
      candidate,
      playerWeekStats: args.playerWeekStats,
    }),
  );
}
