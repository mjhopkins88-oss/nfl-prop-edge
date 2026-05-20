/**
 * Market-anchored probability layer.
 *
 * Treats the no-vig market probability as the BASELINE. Football
 * context (role stability, game script, pace, injury risk, weather,
 * coaching uncertainty, matchup intelligence, proxy features, data
 * quality, correlation) provides CAPPED adjustments around that
 * baseline. The framework never overrides recommendations on its
 * own — its job is to keep the model from overreacting to weak or
 * conflicting football signals and to surface a more disciplined
 * "confidence-adjusted edge" that downstream consumers can trust.
 *
 * Why anchor on the market?
 *   - The market already aggregates sharp opinion. Walking too far
 *     from it without strong, agreeing signals is a classic
 *     overconfidence trap.
 *   - Capping by confidence + risk + data quality means thin or
 *     noisy signals can only nudge — they can't override.
 *
 * Integration:
 *   - Standalone module. The existing scorecard's recommendation
 *     math is unchanged.
 *   - `ScorecardInput` accepts an optional `marketAnchoredProbability`
 *     passthrough field that the builder copies into the output for
 *     downstream display. No decision math depends on it (yet).
 */

import type { PropType } from "../types";

// --- types ----------------------------------------------------------

export type DisagreementClassification =
  | "MARKET_ALIGNED"
  | "SMALL_EDGE"
  | "HEALTHY_DISAGREEMENT"
  | "DANGEROUS_DISAGREEMENT"
  | "LIKELY_OVERCONFIDENT";

export interface FootballAdjustmentComponent {
  /** Stable identifier — e.g. "role_stability", "matchup_intel", "weather". */
  name: string;
  /** Signed probability delta in percentage points. Positive = lifts model probability above market. */
  deltaPp: number;
  /** Confidence in this individual component, 0..1. */
  confidence: number;
  /**
   * Whether this signal is independent from the others. Multiple
   * agreeing INDEPENDENT signals are what unlock the higher cap.
   * Correlated signals (e.g., "matchup says deep WR is good" plus
   * "proxy says deep WR profile") share alpha and don't count
   * twice.
   */
  independent: boolean;
  /** Optional human-readable note. */
  explanation?: string;
}

export interface MarketAnchoredProbabilityInput {
  propType: PropType;
  /** No-vig market probability for the selected side, 0..1. */
  marketProbability: number;
  components: FootballAdjustmentComponent[];
  /** Overall scorecard confidence, 0..1. */
  confidence: number;
  /** Composite risk score, 0..1 (1 = clean). */
  riskScore: number;
  /** Data quality, 0..1. */
  dataQualityScore: number;
}

export interface MarketAnchoredProbabilityOutput {
  marketBaselineProbability: number;
  /** Sum of confidence-weighted component deltas, in pp. Uncapped. */
  rawFootballAdjustmentPp: number;
  /** After cap rules applied. */
  cappedFootballAdjustmentPp: number;
  /** marketBaseline + capped/100. Clamped to [0, 1]. */
  finalModelProbability: number;
  /** finalModelProbability − marketBaselineProbability, in pp. */
  rawEdgePp: number;
  /** rawEdge × confidence × risk factor — the disciplined edge. */
  confidenceAdjustedEdgePp: number;
  /** |cappedFootballAdjustmentPp|. Used by UIs that want a scalar. */
  disagreementScore: number;
  disagreementClassification: DisagreementClassification;
  /** Human-readable reason a cap was applied (when one was). */
  capAppliedReason?: string;
  reasons: string[];
  risks: string[];
}

// --- constants ------------------------------------------------------

const YARDAGE_PROPS = new Set<PropType>([
  "PASSING_YARDS",
  "RECEIVING_YARDS",
  "RUSHING_YARDS",
]);

const LOW_DATA_QUALITY_THRESHOLD = 0.55;
const HIGH_RISK_THRESHOLD = 0.55;
const LOW_DQ_CAP_PP = 2;
const HIGH_RISK_CAP_PP = 3;
const VOLUME_DEFAULT_CAP_PP = 8;
const YARDAGE_DEFAULT_CAP_PP = 5;
const VOLUME_MAX_CAP_PP = 12;
const YARDAGE_MAX_CAP_PP = 10;
const OVERCONFIDENCE_THRESHOLD_PP = 12;

const STRONG_COMPONENT_MIN_CONFIDENCE = 0.55;

// --- helpers --------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function isYardageProp(propType: PropType): boolean {
  return YARDAGE_PROPS.has(propType);
}

function strongAgreementCount(
  components: FootballAdjustmentComponent[],
  rawDirection: "positive" | "negative",
): number {
  // Count INDEPENDENT components that agree with the dominant signed
  // direction AND have confidence ≥ the strong-signal threshold.
  return components.filter(
    (c) =>
      c.independent &&
      c.confidence >= STRONG_COMPONENT_MIN_CONFIDENCE &&
      ((rawDirection === "positive" && c.deltaPp > 0) ||
        (rawDirection === "negative" && c.deltaPp < 0)),
  ).length;
}

// --- public API -----------------------------------------------------

export function calculateRawFootballAdjustment(
  components: FootballAdjustmentComponent[],
): number {
  return components.reduce(
    (acc, c) => acc + c.deltaPp * clamp(c.confidence, 0, 1),
    0,
  );
}

export interface CapFootballAdjustmentArgs {
  propType: PropType;
  confidence: number;
  riskScore: number;
  dataQualityScore: number;
  components: FootballAdjustmentComponent[];
}

export interface CapResult {
  appliedCapPp: number;
  cappedPp: number;
  reason?: string;
}

export function capFootballAdjustment(
  rawAdjustmentPp: number,
  args: CapFootballAdjustmentArgs,
): CapResult {
  const direction: "positive" | "negative" =
    rawAdjustmentPp >= 0 ? "positive" : "negative";
  const yardage = isYardageProp(args.propType);
  const defaultCap = yardage
    ? YARDAGE_DEFAULT_CAP_PP
    : VOLUME_DEFAULT_CAP_PP;
  const maxCap = yardage ? YARDAGE_MAX_CAP_PP : VOLUME_MAX_CAP_PP;

  let cap = defaultCap;
  const strongAgree = strongAgreementCount(args.components, direction);

  // Multiple independent agreeing signals at strong confidence + overall
  // high confidence → unlock the higher cap. Yardage caps remain
  // tighter than volume even when "high agreement" applies, per spec
  // rule 7.
  if (args.confidence >= 0.75 && strongAgree >= 3) {
    cap = maxCap;
  } else if (args.confidence >= 0.65 && strongAgree >= 2) {
    cap = yardage ? 8 : 10;
  }

  // Override caps for low data quality / high risk. Both override
  // independently and the lowest cap wins.
  let appliedReason: string | undefined;
  if (args.dataQualityScore < LOW_DATA_QUALITY_THRESHOLD) {
    if (cap > LOW_DQ_CAP_PP) {
      cap = LOW_DQ_CAP_PP;
      appliedReason = `Data quality ${args.dataQualityScore.toFixed(2)} < ${LOW_DATA_QUALITY_THRESHOLD} — capped at ${LOW_DQ_CAP_PP}pp`;
    }
  }
  if (args.riskScore < HIGH_RISK_THRESHOLD) {
    if (cap > HIGH_RISK_CAP_PP) {
      cap = HIGH_RISK_CAP_PP;
      appliedReason = `Risk score ${args.riskScore.toFixed(2)} < ${HIGH_RISK_THRESHOLD} — capped at ${HIGH_RISK_CAP_PP}pp`;
    }
  }

  const cappedPp = clamp(rawAdjustmentPp, -cap, cap);
  const wasCapped = Math.abs(cappedPp - rawAdjustmentPp) > 1e-9;
  if (!appliedReason && wasCapped) {
    appliedReason = `${direction === "positive" ? "Positive" : "Negative"} football signal capped at ${cap}pp`;
  }
  return { appliedCapPp: cap, cappedPp, reason: appliedReason };
}

export function calculateConfidenceAdjustedEdge(
  rawEdgePp: number,
  args: { confidence: number; riskScore: number },
): number {
  // Both factors are floored at 0.4 so the disciplined edge never
  // disappears entirely — it shrinks proportionally to risk and
  // confidence weakness.
  const confidenceMul = clamp(args.confidence / 0.7, 0.4, 1.0);
  const riskMul = clamp(args.riskScore / 0.7, 0.5, 1.0);
  return rawEdgePp * confidenceMul * riskMul;
}

export function calculateDisagreementScore(cappedAdjPp: number): number {
  return Math.abs(cappedAdjPp);
}

export function classifyMarketDisagreement(args: {
  rawAdjustmentPp: number;
  cappedAdjustmentPp: number;
  confidence: number;
}): DisagreementClassification {
  // Overconfidence test fires when the RAW (pre-cap) signal blew past
  // the threshold — even though the cap protects the final number,
  // the underlying mismatch is worth surfacing.
  if (Math.abs(args.rawAdjustmentPp) > OVERCONFIDENCE_THRESHOLD_PP) {
    return "LIKELY_OVERCONFIDENT";
  }
  const absCapped = Math.abs(args.cappedAdjustmentPp);
  if (absCapped < 1) return "MARKET_ALIGNED";
  if (absCapped < 4) return "SMALL_EDGE";
  if (args.confidence < 0.55) return "DANGEROUS_DISAGREEMENT";
  return "HEALTHY_DISAGREEMENT";
}

export function buildMarketAnchoredProbability(
  input: MarketAnchoredProbabilityInput,
): MarketAnchoredProbabilityOutput {
  const marketBaselineProbability = clamp(input.marketProbability, 0, 1);
  const rawAdjustmentPp = calculateRawFootballAdjustment(input.components);
  const capResult = capFootballAdjustment(rawAdjustmentPp, {
    propType: input.propType,
    confidence: input.confidence,
    riskScore: input.riskScore,
    dataQualityScore: input.dataQualityScore,
    components: input.components,
  });
  const cappedFootballAdjustmentPp = capResult.cappedPp;
  const finalModelProbability = clamp(
    marketBaselineProbability + cappedFootballAdjustmentPp / 100,
    0,
    1,
  );
  const rawEdgePp = (finalModelProbability - marketBaselineProbability) * 100;
  const confidenceAdjustedEdgePp = calculateConfidenceAdjustedEdge(rawEdgePp, {
    confidence: input.confidence,
    riskScore: input.riskScore,
  });
  const disagreementScore = calculateDisagreementScore(
    cappedFootballAdjustmentPp,
  );
  const disagreementClassification = classifyMarketDisagreement({
    rawAdjustmentPp,
    cappedAdjustmentPp: cappedFootballAdjustmentPp,
    confidence: input.confidence,
  });

  // Build reasons / risks.
  const reasons: string[] = [];
  const risks: string[] = [];
  // Include any per-component explanations.
  for (const c of input.components) {
    if (!c.explanation) continue;
    const isContrarian =
      (cappedFootballAdjustmentPp > 0 && c.deltaPp < 0) ||
      (cappedFootballAdjustmentPp < 0 && c.deltaPp > 0);
    if (isContrarian) {
      risks.push(`${c.name}: ${c.explanation}`);
    } else {
      reasons.push(`${c.name}: ${c.explanation}`);
    }
  }
  if (capResult.reason) {
    risks.push(capResult.reason);
  }
  if (disagreementClassification === "LIKELY_OVERCONFIDENT") {
    risks.push(
      `Overconfidence warning: raw football adjustment ${rawAdjustmentPp.toFixed(1)}pp exceeds ${OVERCONFIDENCE_THRESHOLD_PP}pp — final probability has been capped`,
    );
  } else if (disagreementClassification === "DANGEROUS_DISAGREEMENT") {
    risks.push(
      `Market disagreement ${disagreementScore.toFixed(1)}pp at confidence ${(input.confidence * 100).toFixed(0)}% — treat as approximation`,
    );
  } else if (disagreementClassification === "HEALTHY_DISAGREEMENT") {
    reasons.push(
      `Market disagreement ${disagreementScore.toFixed(1)}pp with confidence ${(input.confidence * 100).toFixed(0)}% — football context supports the move`,
    );
  } else if (disagreementClassification === "MARKET_ALIGNED") {
    reasons.push(
      `Market-aligned: football signals net to ${cappedFootballAdjustmentPp.toFixed(1)}pp around baseline ${(marketBaselineProbability * 100).toFixed(1)}%`,
    );
  }

  return {
    marketBaselineProbability,
    rawFootballAdjustmentPp: rawAdjustmentPp,
    cappedFootballAdjustmentPp,
    finalModelProbability,
    rawEdgePp,
    confidenceAdjustedEdgePp,
    disagreementScore,
    disagreementClassification,
    capAppliedReason: capResult.reason,
    reasons,
    risks,
  };
}
