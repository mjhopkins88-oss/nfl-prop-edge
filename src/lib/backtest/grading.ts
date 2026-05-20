/**
 * Backtest stage 4 — Grading.
 *
 * Given a recommendation + odds + the actual stat value, produce a
 * win/loss/push label, units staked + returned, and a Brier-score
 * component for downstream calibration.
 *
 * Settlement convention:
 *   OVER  : win if actual > line, push if actual == line, loss if <
 *   UNDER : win if actual < line, push if actual == line, loss if >
 *   PASS  : no bet, no stake, no return
 *
 * Units: V1 always stakes 1 unit per bet. Returned units = stake * (1 + payout)
 * on a win, refunded on a push, zero on a loss.
 */

import type { Recommendation } from "../types";
import type { BetResult } from "@prisma/client";

export interface GradingInput {
  recommendation: Recommendation;
  line: number;
  overOdds: number;
  underOdds: number;
  /** Null if we don't have an actual stat yet (live prediction, not backtest). */
  actualValue: number | null;
  modelOverProbability: number;
}

export interface GradeResult {
  result: BetResult;
  unitsStaked: number;
  unitsReturned: number;
  /** Squared error of model OVER probability vs the realized OVER outcome. */
  brierComponent: number | null;
}

function decimalPayout(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

export function gradePrediction(input: GradingInput): GradeResult {
  // No actual value -> can't grade. (Used by live predictions.)
  if (input.actualValue === null) {
    return {
      result: input.recommendation === "PASS" ? "NO_BET" : "NO_BET",
      unitsStaked: 0,
      unitsReturned: 0,
      brierComponent: null,
    };
  }

  // Brier component is well-defined whether we bet or not — calibration
  // doesn't care about whether we acted. Excludes pushes (treated as
  // half-credit), see classifyOverHit.
  const overHit =
    input.actualValue > input.line ? 1 : input.actualValue < input.line ? 0 : 0.5;
  const brierComponent = (input.modelOverProbability - overHit) ** 2;

  if (input.recommendation === "PASS") {
    return {
      result: "NO_BET",
      unitsStaked: 0,
      unitsReturned: 0,
      brierComponent,
    };
  }

  const stake = 1;
  let result: BetResult;
  let returned = 0;

  if (input.recommendation === "OVER") {
    if (input.actualValue > input.line) {
      result = "WIN";
      returned = stake * (1 + decimalPayout(input.overOdds));
    } else if (input.actualValue === input.line) {
      result = "PUSH";
      returned = stake;
    } else {
      result = "LOSS";
      returned = 0;
    }
  } else {
    // UNDER
    if (input.actualValue < input.line) {
      result = "WIN";
      returned = stake * (1 + decimalPayout(input.underOdds));
    } else if (input.actualValue === input.line) {
      result = "PUSH";
      returned = stake;
    } else {
      result = "LOSS";
      returned = 0;
    }
  }

  return {
    result,
    unitsStaked: stake,
    unitsReturned: returned,
    brierComponent,
  };
}
