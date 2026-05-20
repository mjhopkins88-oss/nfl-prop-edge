/**
 * Parlay probability + odds math.
 *
 * Pure functions. No model state. Used by `parlay-builder` and the
 * test runner.
 *
 *   americanToDecimal       — +150 → 2.50, -120 → 1.833
 *   decimalToAmerican       — inverse
 *   impliedProbabilityFromAmerican
 *   combineDecimalOdds      — product of decimals
 *   calculateIndependentJointProbability — product of leg probabilities
 *   calculateCorrelationAdjustedJointProbability — applies a capped
 *     up/down adjustment based on correlation score + confidence
 *   capCorrelationAdjustment — guard for the runner / future callers
 *   calculateRequiredHitRate — 1 / payoutMultiplier × (1 + targetROI)
 */

import {
  MAX_NEGATIVE_CORRELATION_RELATIVE_DRAG,
  MAX_POSITIVE_CORRELATION_RELATIVE_LIFT,
  DEFAULT_TARGET_ROI,
} from "./parlay-config";
import type { ParlayLeg } from "./parlay-types";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function americanToDecimal(odds: number): number {
  if (odds === 0) return 1;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

export function decimalToAmerican(decimal: number): number {
  if (decimal <= 1) return 0;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function impliedProbabilityFromAmerican(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function combineDecimalOdds(decimals: number[]): number {
  return decimals.reduce((acc, d) => acc * d, 1);
}

export function calculateIndependentJointProbability(
  legs: Pick<ParlayLeg, "modelProbability">[],
): number {
  return legs.reduce((acc, l) => acc * clamp(l.modelProbability, 0, 1), 1);
}

/**
 * Apply a correlation adjustment to the independent joint probability.
 *   - Positive correlation lifts joint probability (capped at
 *     `MAX_POSITIVE_CORRELATION_RELATIVE_LIFT`).
 *   - Negative correlation drags it down (capped at
 *     `MAX_NEGATIVE_CORRELATION_RELATIVE_DRAG`).
 *   - Unknown / weak correlation produces near-zero adjustment.
 *
 * The adjustment is further shrunk by the per-parlay confidence
 * argument so we never make a high-correlation claim on thin
 * evidence. Confidence ≥ 0.85 keeps the full cap; lower confidence
 * scales the cap toward zero.
 */
export function calculateCorrelationAdjustedJointProbability(args: {
  independentJointProbability: number;
  correlationScore: number;
  confidence: number;
}): number {
  const indep = clamp(args.independentJointProbability, 0, 1);
  const conf = clamp(args.confidence, 0, 1);
  const confidenceShrinkage = clamp(conf / 0.85, 0.3, 1.0);
  const capped = capCorrelationAdjustment({
    correlationScore: args.correlationScore,
  });
  const adjustment = capped * confidenceShrinkage;
  return clamp(indep * (1 + adjustment), 0.001, 0.999);
}

/**
 * Map a -1..+1 correlation score onto a bounded relative
 * adjustment (-MAX_NEGATIVE..+MAX_POSITIVE).
 */
export function capCorrelationAdjustment(args: {
  correlationScore: number;
}): number {
  const c = clamp(args.correlationScore, -1, 1);
  if (c >= 0) return c * MAX_POSITIVE_CORRELATION_RELATIVE_LIFT;
  return c * MAX_NEGATIVE_CORRELATION_RELATIVE_DRAG;
}

/**
 * Hit rate required to clear `targetRoi` ROI at the given payout
 * multiplier. payoutMultiplier is the total payout (stake +
 * profit), so requiredHitRate = (1 + targetRoi) / payoutMultiplier.
 */
export function calculateRequiredHitRate(args: {
  payoutMultiplier: number;
  targetRoi?: number;
}): number {
  const roi = args.targetRoi ?? DEFAULT_TARGET_ROI;
  if (args.payoutMultiplier <= 0) return 1;
  return Math.min(1, (1 + roi) / args.payoutMultiplier);
}
