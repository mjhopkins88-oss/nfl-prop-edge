/**
 * Centralized qualification logic for the v2 player prop pipeline.
 *
 * A prop qualifies only if EVERY gate clears:
 *   1. recommendation side exists (raw edge points to a side)
 *   2. raw edge ≥ prop-specific threshold
 *   3. confidence-adjusted edge ≥ 0.6 × prop-specific threshold
 *   4. data quality ≥ config.dataQualityRequired
 *   5. role stability ≥ 0.55 (or category-specific floor)
 *   6. injury context ≥ 0.55
 *   7. weather risk acceptable for the prop type
 *   8. coaching uncertainty does not overwhelm edge
 *   9. correlation risk ≥ 0.5
 *  10. line fragility not "EVAPORATES" / "FRAGILE_EDGE" for yardage
 *  11. market disagreement not LIKELY_MODEL_OVERCONFIDENCE
 *  12. prop-specific hard disqualifiers all pass
 *
 * Disqualifier priority (first match wins):
 *   1. invalid market data
 *   2. edge below threshold
 *   3. confidence-adjusted edge below threshold
 *   4. data quality below floor
 *   5. role instability
 *   6. injury uncertainty
 *   7. weather risk
 *   8. coaching uncertainty
 *   9. suspicious market disagreement
 *  10. line fragility
 *  11. correlation risk
 *  12. prop-specific disqualifier
 */

import type { PropType, Recommendation } from "../types";
import type { Side } from "./model-scorecard";
import type { EdgeQualityClassification } from "./confidence-adjusted-edge";
import type { LineSensitivityLabel } from "./line-sensitivity";
import type { MarketDisagreementClassification } from "./market-disagreement";
import type { RoleTrendClassification } from "./role-change-detector";
import {
  getPropModelConfig,
  isYardageProp,
  type PropQualifierKey,
} from "./prop-model-config";

export interface PropQualificationInput {
  propType: PropType;
  marketLine: number;
  marketOverProbability?: number;
  noVigOverProbability?: number;
  rawEdge: number;
  confidenceAdjustedEdge: number;
  riskAdjustedEdge: number;
  side: Side;
  confidence: number;
  dataQuality: number;
  riskScore: number;
  roleStability: number;
  injuryContextScore: number;
  weatherEnvironmentScore: number;
  coachingUncertaintyPenalty: number;
  correlationExposureScore: number;
  edgeQuality: EdgeQualityClassification;
  lineSensitivityLabel: LineSensitivityLabel;
  edgeFragilityScore: number;
  marketDisagreement: MarketDisagreementClassification;
  roleTrend: RoleTrendClassification;
  hasIndependentSignals?: boolean;
  /** Optional manual overrides for per-prop floors. */
  overrideDataQualityFloor?: number;
  overrideConfidenceFloor?: number;
}

export interface PropQualificationOutput {
  qualified: boolean;
  recommendation: Recommendation;
  selectedSide?: Side;
  primaryDisqualifier?: string;
  primaryDisqualifierKey?: PropQualifierKey | "edgeBelowThreshold" | "marketData" | "edgeQuality";
  disqualifiers: string[];
  passReasons: string[];
  failReasons: string[];
  reasons: string[];
  risks: string[];
  finalExplanation: string;
  edgeThresholdUsed: number;
  confidenceAdjustedThresholdUsed: number;
}

interface Disqualifier {
  key: PropQualificationOutput["primaryDisqualifierKey"];
  text: string;
}

const COACHING_PENALTY_THRESHOLD = 55; // matches edgeThresholdBumpFromPenalty top tiers
const WEATHER_FLOOR_BY_PROP: Record<PropType, number> = {
  PASSING_ATTEMPTS: 0.4,
  PASSING_COMPLETIONS: 0.45,
  PASSING_YARDS: 0.55,
  RECEPTIONS: 0.45,
  RECEIVING_YARDS: 0.55,
  RUSHING_ATTEMPTS: 0.4,
  RUSHING_YARDS: 0.45,
};

function fmtPp(value: number): string {
  return `${(value * 100).toFixed(1)}pp`;
}

export function qualifyProp(
  input: PropQualificationInput,
): PropQualificationOutput {
  const config = getPropModelConfig(input.propType);
  const passReasons: string[] = [];
  const failReasons: string[] = [];
  const disqualifiers: string[] = [];
  const reasons: string[] = [];
  const risks: string[] = [];

  // Coaching uncertainty bumps the edge threshold up to 2pp.
  let thresholdBumpPp = 0;
  if (input.coachingUncertaintyPenalty >= 75) thresholdBumpPp = 0.02;
  else if (input.coachingUncertaintyPenalty >= 55) thresholdBumpPp = 0.015;
  else if (input.coachingUncertaintyPenalty >= 40) thresholdBumpPp = 0.01;
  else if (input.coachingUncertaintyPenalty >= 20) thresholdBumpPp = 0.005;

  // Yardage props automatically take a +0.5pp bump.
  if (isYardageProp(input.propType)) thresholdBumpPp += 0.005;

  const edgeThresholdUsed = config.baseEdgeThreshold + thresholdBumpPp;
  const confidenceAdjustedThresholdUsed = edgeThresholdUsed * 0.6;

  const dqFloor =
    input.overrideDataQualityFloor ?? config.dataQualityRequired;
  const confidenceFloor =
    input.overrideConfidenceFloor ?? config.confidenceRequired;

  const reasonsList = (): Disqualifier[] => {
    const list: Disqualifier[] = [];

    // 1. Market data validity.
    if (
      input.marketOverProbability === undefined ||
      input.noVigOverProbability === undefined ||
      Number.isNaN(input.marketOverProbability) ||
      Number.isNaN(input.noVigOverProbability)
    ) {
      list.push({
        key: "marketData",
        text: "Missing or invalid market probability inputs",
      });
    }

    // 2. Raw edge below threshold.
    if (Math.abs(input.rawEdge) < edgeThresholdUsed) {
      list.push({
        key: "edgeBelowThreshold",
        text: `Raw edge ${fmtPp(input.rawEdge)} below ${fmtPp(edgeThresholdUsed)} threshold for ${input.propType}`,
      });
    }

    // 3. Confidence-adjusted edge below threshold.
    if (
      Math.abs(input.confidenceAdjustedEdge) < confidenceAdjustedThresholdUsed
    ) {
      list.push({
        key: "edgeQuality",
        text: `Confidence-adjusted edge ${fmtPp(input.confidenceAdjustedEdge)} below ${fmtPp(confidenceAdjustedThresholdUsed)} required for ${input.propType}`,
      });
    }
    if (
      input.edgeQuality === "SUSPICIOUS_EDGE" ||
      input.edgeQuality === "THIN_EDGE" ||
      input.edgeQuality === "NO_EDGE"
    ) {
      list.push({
        key: "edgeQuality",
        text: `Edge quality classified ${input.edgeQuality}`,
      });
    }

    // 4. Data quality.
    if (input.dataQuality < dqFloor) {
      list.push({
        key: "dataQuality",
        text: `Data quality ${input.dataQuality.toFixed(2)} below ${dqFloor.toFixed(2)} floor`,
      });
    }

    // Confidence floor — recorded as data-quality bucket since the
    // existing scorecard already treats confidence as derived.
    if (input.confidence < confidenceFloor) {
      list.push({
        key: "dataQuality",
        text: `Confidence ${(input.confidence * 100).toFixed(0)}% below ${(confidenceFloor * 100).toFixed(0)}% floor`,
      });
    }

    // 5. Role stability.
    if (input.roleStability < 0.55) {
      list.push({
        key: "roleStability",
        text: `Role stability ${input.roleStability.toFixed(2)} below 0.55 — role unreliable`,
      });
    }
    if (input.roleTrend === "VOLATILE_ROLE") {
      list.push({
        key: "roleStability",
        text: "Role trend classified VOLATILE_ROLE — recent usage swings too wide",
      });
    }
    if (
      input.roleTrend === "DECLINING_ROLE" &&
      (input.propType === "RECEPTIONS" ||
        input.propType === "RECEIVING_YARDS" ||
        input.propType === "RUSHING_ATTEMPTS" ||
        input.propType === "RUSHING_YARDS")
    ) {
      list.push({
        key: "roleStability",
        text: "Role trend classified DECLINING_ROLE — recent usage trending down",
      });
    }

    // 6. Injury context.
    if (input.injuryContextScore < 0.55) {
      list.push({
        key: "injuryContext",
        text: `Injury context ${input.injuryContextScore.toFixed(2)} below 0.55`,
      });
    }

    // 7. Weather.
    const weatherFloor = WEATHER_FLOOR_BY_PROP[input.propType];
    if (input.weatherEnvironmentScore < weatherFloor) {
      list.push({
        key: "weatherEnvironment",
        text: `Weather risk ${input.weatherEnvironmentScore.toFixed(2)} below ${weatherFloor.toFixed(2)} floor for ${input.propType}`,
      });
    }

    // 8. Coaching uncertainty (only blocks if very high AND edge is thin).
    if (
      input.coachingUncertaintyPenalty >= COACHING_PENALTY_THRESHOLD &&
      Math.abs(input.rawEdge) < edgeThresholdUsed + 0.02
    ) {
      list.push({
        key: "coachingUncertainty",
        text: `Coaching uncertainty penalty ${input.coachingUncertaintyPenalty} swamps thin edge`,
      });
    }

    // 9. Market disagreement.
    if (input.marketDisagreement === "LIKELY_MODEL_OVERCONFIDENCE") {
      list.push({
        key: "marketDisagreement",
        text: "Market disagreement classified LIKELY_MODEL_OVERCONFIDENCE",
      });
    } else if (
      input.marketDisagreement === "DANGEROUS_DISAGREEMENT" &&
      input.confidence < confidenceFloor + 0.05
    ) {
      list.push({
        key: "marketDisagreement",
        text: "DANGEROUS_DISAGREEMENT with low confidence",
      });
    }

    // 10. Line fragility (yardage props are stricter).
    //     Only treat fragility as a hard disqualifier when paired
    //     with a thin edge OR a yardage prop. A 9pp edge with a
    //     line-sensitive projection is still a viable bet.
    if (
      input.lineSensitivityLabel === "EVAPORATES_ON_MOVE" &&
      (isYardageProp(input.propType) ||
        Math.abs(input.confidenceAdjustedEdge) < 0.05 ||
        input.edgeFragilityScore >= 0.95)
    ) {
      list.push({
        key: "lineFragility",
        text: "Line sensitivity: edge evaporates with ±1 line move",
      });
    } else if (
      input.lineSensitivityLabel === "FRAGILE_EDGE" &&
      isYardageProp(input.propType) &&
      Math.abs(input.confidenceAdjustedEdge) < 0.07
    ) {
      list.push({
        key: "lineFragility",
        text: `Yardage prop with FRAGILE_EDGE — edge collapses on ±1 line move (fragility ${input.edgeFragilityScore.toFixed(2)})`,
      });
    }

    // 11. Correlation exposure.
    if (input.correlationExposureScore < 0.5) {
      list.push({
        key: "correlationExposure",
        text: `Correlation exposure ${input.correlationExposureScore.toFixed(2)} below 0.50 floor`,
      });
    }

    // 12. Prop-specific hard disqualifier handling — only if not already added.
    return list;
  };

  const list = reasonsList();
  for (const d of list) disqualifiers.push(d.text);

  const passes = list.length === 0;
  const recommendation: Recommendation = passes ? input.side : "PASS";
  const primary = list[0];

  if (passes) {
    passReasons.push(
      `Raw edge ${fmtPp(input.rawEdge)} clears ${fmtPp(edgeThresholdUsed)} threshold`,
    );
    passReasons.push(
      `Confidence-adjusted edge ${fmtPp(input.confidenceAdjustedEdge)} clears ${fmtPp(confidenceAdjustedThresholdUsed)} required`,
    );
    reasons.push(...passReasons);
  } else {
    failReasons.push(...disqualifiers);
  }

  // Soft warnings — recorded but do not flip qualification.
  if (input.marketDisagreement === "DANGEROUS_DISAGREEMENT" && passes) {
    risks.push("Market disagreement flagged DANGEROUS — handle with caution");
  }
  if (
    input.lineSensitivityLabel === "MILDLY_SENSITIVE" ||
    (input.lineSensitivityLabel === "FRAGILE_EDGE" &&
      !isYardageProp(input.propType))
  ) {
    risks.push("Edge sensitive to line movement — watch for line moves");
  }
  if (input.edgeQuality === "SUSPICIOUS_EDGE") {
    risks.push("Edge classified SUSPICIOUS — verify supporting evidence");
  }

  const finalExplanation = (() => {
    if (passes) {
      return `${recommendation} on ${input.propType}: raw edge ${fmtPp(input.rawEdge)} (conf-adj ${fmtPp(input.confidenceAdjustedEdge)}) clears ${fmtPp(edgeThresholdUsed)} threshold with no qualifying risk gates failing.`;
    }
    const primaryText = primary?.text ?? "no specific reason";
    return `PASS on ${input.propType}: ${primaryText}.`;
  })();

  return {
    qualified: passes,
    recommendation,
    selectedSide: passes ? input.side : undefined,
    primaryDisqualifier: primary?.text,
    primaryDisqualifierKey: primary?.key,
    disqualifiers,
    passReasons,
    failReasons,
    reasons,
    risks,
    finalExplanation,
    edgeThresholdUsed,
    confidenceAdjustedThresholdUsed,
  };
}
