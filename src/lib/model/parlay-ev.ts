/**
 * Parlay expected-value math + classification.
 *
 * Pure functions. Consumed by the builder and the test runner.
 *
 *   EV = correlationAdjustedJointProbability × combinedDecimalOdds − 1
 *
 * Confidence-adjusted EV multiplies EV by shrinkage factors for low
 * leg confidence, low data quality, high risk, unknown correlation,
 * overstacking, line fragility, and same-game exposure. The shrinkage
 * can only ever pull EV closer to zero — it never inflates.
 */

import {
  DEFAULT_TARGET_ROI,
  TARGET_HIT_RATE_HIGH,
  TARGET_HIT_RATE_LOW,
} from "./parlay-config";
import { calculateRequiredHitRate } from "./parlay-probability";
import type {
  CorrelationType,
  ParlayLeg,
  ParlayRecommendation,
} from "./parlay-types";

export interface ParlayValueClassification {
  recommendation: ParlayRecommendation;
  qualifies: boolean;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function calculateParlayExpectedValue(args: {
  correlationAdjustedJointProbability: number;
  combinedDecimalOdds: number;
}): number {
  return args.correlationAdjustedJointProbability * args.combinedDecimalOdds - 1;
}

/**
 * Confidence-adjusted EV. We always shrink toward zero — never
 * inflate. Multipliers stack but are individually clamped.
 */
export function calculateConfidenceAdjustedParlayEV(args: {
  expectedValue: number;
  legs: ParlayLeg[];
  correlationType: CorrelationType;
  overstackingRisk: boolean;
  conflictingScript: boolean;
  sameGameLegs: number;
}): number {
  const ev = args.expectedValue;
  // Aggregate per-leg quality signals.
  const avgConfidence =
    args.legs.reduce((a, l) => a + l.confidence, 0) / args.legs.length;
  const avgDataQuality =
    args.legs.reduce((a, l) => a + l.dataQualityScore, 0) / args.legs.length;
  const avgRisk =
    args.legs.reduce((a, l) => a + l.riskScore, 0) / args.legs.length;
  const maxFragility = args.legs.reduce(
    (m, l) => Math.max(m, l.lineFragilityScore ?? 0),
    0,
  );

  const confMul = clamp(avgConfidence / 0.7, 0.3, 1.0);
  const dqMul = clamp(avgDataQuality / 0.7, 0.4, 1.0);
  const riskMul = clamp(avgRisk / 0.7, 0.5, 1.0);
  const fragilityMul = clamp(1 - maxFragility * 0.6, 0.4, 1.0);
  const correlationMul =
    args.correlationType === "POSITIVE"
      ? 1.0
      : args.correlationType === "WEAK"
        ? 0.9
        : args.correlationType === "NEGATIVE"
          ? 0.65
          : args.correlationType === "CONFLICTING"
            ? 0.4
            : 0.75; // UNKNOWN
  const overstackMul = args.overstackingRisk ? 0.65 : 1.0;
  const conflictMul = args.conflictingScript ? 0.7 : 1.0;
  // Same-game exposure: 2 legs is fine; 3+ in one game shrinks more.
  const sameGameMul =
    args.sameGameLegs >= 3 ? 0.85 : 1.0;

  const shrinkage =
    confMul *
    dqMul *
    riskMul *
    fragilityMul *
    correlationMul *
    overstackMul *
    conflictMul *
    sameGameMul;
  return ev * shrinkage;
}

/**
 * Classify a parlay based on its EV / confidence-adjusted EV /
 * hit-rate spread + a few hard fail-modes. The builder calls this
 * after running every other check so the final label is the
 * decisive one.
 */
export function classifyParlayValue(args: {
  expectedValue: number;
  confidenceAdjustedExpectedValue: number;
  projectedHitRate: number;
  requiredHitRate: number;
  correlationType: CorrelationType;
  conflictingScript: boolean;
  overstackingRisk: boolean;
  anyLegNotQualified: boolean;
  anyLegFragile: boolean;
  averageRisk: number;
  averageConfidence: number;
}): ParlayValueClassification {
  if (args.anyLegNotQualified) {
    return { recommendation: "PASS_LEG_NOT_QUALIFIED", qualifies: false };
  }
  if (args.conflictingScript || args.correlationType === "CONFLICTING") {
    return { recommendation: "PASS_BAD_CORRELATION", qualifies: false };
  }
  if (args.anyLegFragile) {
    return { recommendation: "PASS_TOO_FRAGILE", qualifies: false };
  }
  if (args.expectedValue <= 0 || args.confidenceAdjustedExpectedValue <= 0) {
    return { recommendation: "PASS_LOW_EV", qualifies: false };
  }
  if (args.projectedHitRate < args.requiredHitRate) {
    return { recommendation: "PASS_LOW_EV", qualifies: false };
  }
  if (args.averageRisk < 0.45 || args.averageConfidence < 0.5) {
    return { recommendation: "PASS_TOO_MUCH_RISK", qualifies: false };
  }
  // Watchlist when correlation is unknown or only weak.
  if (
    args.correlationType === "UNKNOWN" ||
    args.correlationType === "WEAK"
  ) {
    return { recommendation: "CORRELATED_WATCH", qualifies: false };
  }
  if (args.confidenceAdjustedExpectedValue >= 0.18) {
    return { recommendation: "STRONG_PARLAY_VALUE", qualifies: true };
  }
  return { recommendation: "PLAYABLE_PARLAY_VALUE", qualifies: true };
}

/** The target-batch math the dashboard surfaces. */
export function calculateTargetBatchMath(args: {
  targetRoi?: number;
  lowHitRate?: number;
  highHitRate?: number;
}): {
  targetRoi: number;
  lowHitRate: number;
  highHitRate: number;
  requiredPayoutLow: number;
  requiredPayoutHigh: number;
  requiredPayoutMidpoint: number;
} {
  const targetRoi = args.targetRoi ?? DEFAULT_TARGET_ROI;
  const lowHit = args.lowHitRate ?? TARGET_HIT_RATE_LOW;
  const highHit = args.highHitRate ?? TARGET_HIT_RATE_HIGH;
  const requiredAtLow = (1 + targetRoi) / lowHit;
  const requiredAtHigh = (1 + targetRoi) / highHit;
  const requiredAtMid = (1 + targetRoi) / ((lowHit + highHit) / 2);
  return {
    targetRoi,
    lowHitRate: lowHit,
    highHitRate: highHit,
    requiredPayoutLow: requiredAtLow,
    requiredPayoutHigh: requiredAtHigh,
    requiredPayoutMidpoint: requiredAtMid,
  };
}

/** Per-parlay break-even hit rate (no ROI buffer). */
export function calculateBreakEvenHitRate(payoutMultiplier: number): number {
  if (payoutMultiplier <= 0) return 1;
  return Math.min(1, 1 / payoutMultiplier);
}

export { calculateRequiredHitRate };
