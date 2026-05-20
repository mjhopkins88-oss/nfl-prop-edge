/**
 * Target-batch / hit-rate / payout math consolidated for the
 * parlay layer.
 *
 * Pure functions. No model state. Deterministic. Used by the UI's
 * strategy-health panel and by the audit test runner.
 */

import {
  DEFAULT_TARGET_ROI,
  calculateRequiredPayoutMultiplier,
} from "./parlay-config";
import type {
  ParlayBatchSimulation,
  ParlayCandidate,
} from "./parlay-types";

export type PayoutHitRateFit =
  | "WELL_PAID"
  | "ADEQUATE"
  | "MARGINAL"
  | "UNDERPAID"
  | "OVERPAID_TRAP";

export function calculateRequiredHitRateForROI(args: {
  payoutMultiplier: number;
  targetRoi?: number;
}): number {
  const roi = args.targetRoi ?? DEFAULT_TARGET_ROI;
  if (args.payoutMultiplier <= 0) return 1;
  return Math.min(1, (1 + roi) / args.payoutMultiplier);
}

export function calculateRequiredPayoutForTargetROI(args: {
  expectedHitRate: number;
  targetRoi?: number;
}): number {
  return calculateRequiredPayoutMultiplier(args);
}

/**
 * Projected ROI for a single parlay, given its
 * `correlationAdjustedJointProbability` and `payoutMultiplier`.
 *
 *   expectedReturn = hitRate × payoutMultiplier
 *   profit         = expectedReturn − 1
 *   ROI            = profit
 */
export function calculateProjectedROI(args: {
  projectedHitRate: number;
  payoutMultiplier: number;
}): number {
  return args.projectedHitRate * args.payoutMultiplier - 1;
}

/**
 * Classify a parlay's payout/hit-rate fit against the configured
 * target ROI. UNDERPAID = payout doesn't compensate for variance.
 * OVERPAID_TRAP = payout looks good but projected hit rate is so
 * low that EV is fragile to small modeling errors.
 */
export function classifyPayoutHitRateFit(args: {
  payoutMultiplier: number;
  projectedHitRate: number;
  targetRoi?: number;
}): PayoutHitRateFit {
  const roi = args.targetRoi ?? DEFAULT_TARGET_ROI;
  const required = calculateRequiredHitRateForROI({
    payoutMultiplier: args.payoutMultiplier,
    targetRoi: roi,
  });
  const projectedROI = calculateProjectedROI({
    projectedHitRate: args.projectedHitRate,
    payoutMultiplier: args.payoutMultiplier,
  });

  if (
    args.payoutMultiplier >= 8 &&
    args.projectedHitRate < required * 1.15
  ) {
    return "OVERPAID_TRAP";
  }
  if (projectedROI < 0) return "UNDERPAID";
  if (projectedROI < roi * 0.5) return "MARGINAL";
  if (projectedROI < roi * 1.5) return "ADEQUATE";
  return "WELL_PAID";
}

/**
 * Deterministic simulation of a batch of identical parlays at
 * (hit rate, payout, batch size). No randomness — returns expected
 * outcomes. Used by the strategy-health panel and the audit tests
 * so we can render the "what does a 100-parlay batch look like"
 * box without depending on a PRNG.
 */
export function simulateParlayBatch(args: {
  projectedHitRate: number;
  averagePayoutMultiplier: number;
  batchSize?: number;
}): ParlayBatchSimulation {
  const batchSize = args.batchSize ?? 100;
  const expectedHits = batchSize * args.projectedHitRate;
  const expectedReturnUnits = expectedHits * args.averagePayoutMultiplier;
  const expectedProfitUnits = expectedReturnUnits - batchSize;
  const expectedROI = batchSize === 0 ? 0 : expectedProfitUnits / batchSize;
  const breakEvenHitRate =
    args.averagePayoutMultiplier > 0
      ? 1 / args.averagePayoutMultiplier
      : 1;
  return {
    batchSize,
    projectedHitRate: args.projectedHitRate,
    averagePayoutMultiplier: args.averagePayoutMultiplier,
    expectedHits,
    expectedReturnUnits,
    expectedProfitUnits,
    expectedROI,
    breakEvenHitRate,
  };
}

/**
 * Simulate a batch derived from a set of parlay candidates.
 * Average payout + average projected hit rate are used as the
 * batch inputs. Useful for the strategy-health panel.
 */
export function simulateParlayCandidateBatch(args: {
  candidates: ParlayCandidate[];
  batchSize?: number;
}): ParlayBatchSimulation {
  const candidates = args.candidates;
  if (candidates.length === 0) {
    return simulateParlayBatch({
      projectedHitRate: 0,
      averagePayoutMultiplier: 0,
      batchSize: args.batchSize ?? 100,
    });
  }
  const avgHit =
    candidates.reduce((a, c) => a + c.projectedHitRate, 0) /
    candidates.length;
  const avgPayout =
    candidates.reduce((a, c) => a + c.payoutMultiplier, 0) /
    candidates.length;
  return simulateParlayBatch({
    projectedHitRate: avgHit,
    averagePayoutMultiplier: avgPayout,
    batchSize: args.batchSize ?? 100,
  });
}

/** Re-export so consumers don't need a second import. */
export {
  calculateRequiredPayoutMultiplier,
  DEFAULT_TARGET_ROI,
};
