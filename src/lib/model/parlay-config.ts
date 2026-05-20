/**
 * Experimental Correlated Parlay Model — configuration.
 *
 * Thresholds, caps, and the target-batch math used by the parlay
 * builder + the educational math panel. All values are hypotheses
 * to be validated by backtesting; nothing here decides what the
 * dashboard publishes today.
 */

/** Default + maximum leg counts. */
export const MAX_LEGS_DEFAULT = 2;
export const MAX_LEGS_ALLOWED = 3;

/** Per-leg quality floors. */
export const MIN_LEG_CONFIDENCE = 0.55;
export const MIN_LEG_DATA_QUALITY = 0.55;
/** Each leg must have at least this confidence-adjusted edge (in pp). */
export const MIN_LEG_CONFIDENCE_ADJUSTED_EDGE = 0.025;

/** Parlay-level qualification floors. */
export const MIN_PARLAY_EV = 0.04;
export const MIN_CONFIDENCE_ADJUSTED_EV = 0.02;
export const MIN_CORRELATION_SCORE = -0.15;
export const MAX_RISK_SCORE = 0.55;

/** Stack-control rails. */
export const MAX_SAME_TEAM_PASS_VOLUME_EXPOSURE = 2;
export const MAX_PARLAYS_PER_GAME = 4;

/** Target-batch math used by the educational panel + qualification. */
export const DEFAULT_TARGET_ROI = 0.1;
export const TARGET_BATCH_SIZE = 100;
export const TARGET_HIT_RATE_LOW = 0.15;
export const TARGET_HIT_RATE_HIGH = 0.2;

/** Correlation adjustment caps (relative to independent joint probability). */
export const MAX_POSITIVE_CORRELATION_RELATIVE_LIFT = 0.15;
export const MAX_NEGATIVE_CORRELATION_RELATIVE_DRAG = 0.2;

/** Line-fragility tolerance per leg (0..1). */
export const MAX_LEG_LINE_FRAGILITY = 0.85;

/**
 * Required payout multiplier (total return per unit risked, includes
 * stake) so that a batch of `expectedHitRate` parlays produces the
 * `targetRoi` ROI overall.
 *
 *   requiredPayoutMultiplier = (1 + targetRoi) / expectedHitRate
 *
 * Examples (ROI = 10%):
 *   hitRate=15.0% → 7.33x
 *   hitRate=17.5% → 6.29x
 *   hitRate=20.0% → 5.50x
 */
export function calculateRequiredPayoutMultiplier(args: {
  targetRoi?: number;
  expectedHitRate: number;
}): number {
  const roi = args.targetRoi ?? DEFAULT_TARGET_ROI;
  if (args.expectedHitRate <= 0) return Infinity;
  return (1 + roi) / args.expectedHitRate;
}

/**
 * Convenience: the average payout multiplier required across a
 * given target-hit-rate band. Used by the dashboard's
 * "Required payout for 10% ROI" stat.
 */
export function calculateTargetPayoutBand(args: {
  targetRoi?: number;
  lowHitRate?: number;
  highHitRate?: number;
}): { low: number; high: number; midpoint: number } {
  const lowHit = args.lowHitRate ?? TARGET_HIT_RATE_LOW;
  const highHit = args.highHitRate ?? TARGET_HIT_RATE_HIGH;
  const high = calculateRequiredPayoutMultiplier({
    targetRoi: args.targetRoi,
    expectedHitRate: lowHit,
  });
  const low = calculateRequiredPayoutMultiplier({
    targetRoi: args.targetRoi,
    expectedHitRate: highHit,
  });
  const mid = calculateRequiredPayoutMultiplier({
    targetRoi: args.targetRoi,
    expectedHitRate: (lowHit + highHit) / 2,
  });
  return { low, high, midpoint: mid };
}
