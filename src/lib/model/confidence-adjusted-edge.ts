/**
 * Confidence-adjusted and risk-adjusted edge for V1 player props.
 *
 * The existing scorecard computes a raw `modelOverProbability -
 * noVigOverProbability` edge and gates on it directly. That treats
 * a 6pp edge with 0.30 confidence the same as 6pp at 0.85
 * confidence. This module produces the disciplined edge that the
 * v2 pipeline gates on.
 *
 * Formula (intentionally simple, easy to tune from backtests):
 *
 *   confidenceMultiplier = clamp(confidence / 0.7, 0.3, 1.0)
 *   riskMultiplier       = clamp(riskScore  / 0.7, 0.5, 1.0)
 *   dqMultiplier         = clamp(dataQuality / 0.7, 0.5, 1.0)
 *   roleMultiplier       = clamp(roleStability / 0.65, 0.55, 1.0)
 *   propVolatilityMult   = volume → 1.0; medium → 0.9; high → 0.8
 *
 *   confidenceAdjustedEdge = rawEdge × confidenceMultiplier
 *   riskAdjustedEdge      = rawEdge × confidenceMultiplier ×
 *                            riskMultiplier × dqMultiplier ×
 *                            roleMultiplier × propVolatilityMult
 *
 * Quality classification:
 *   |raw| < 2pp                    → NO_EDGE
 *   raw >> conf-adj (>40% gap)     → SUSPICIOUS_EDGE
 *   conf-adj < 3pp                 → THIN_EDGE
 *   conf-adj < 6pp                 → USABLE_EDGE
 *   else                           → STRONG_EDGE
 */

import type { PropType } from "../types";
import {
  getPropModelConfig,
  type VolatilityLevel,
} from "./prop-model-config";

export type EdgeQualityClassification =
  | "NO_EDGE"
  | "THIN_EDGE"
  | "USABLE_EDGE"
  | "STRONG_EDGE"
  | "SUSPICIOUS_EDGE";

export interface ConfidenceAdjustedEdgeInput {
  propType: PropType;
  /** rawEdge in probability points (e.g., 0.062 = 6.2pp). */
  rawEdge: number;
  /** 0..1 model confidence. */
  confidence: number;
  /** 0..1 data quality. */
  dataQuality: number;
  /** 0..1 risk score (1 = clean). */
  riskScore: number;
  roleStability: number;
  propVolatility?: VolatilityLevel;
  /** Optional helper context for SUSPICIOUS classification. */
  matchupConfidence?: number;
  proxyConfidence?: number;
  coachingUncertaintyPenalty?: number;
  weatherRiskScore?: number;
  injuryRiskScore?: number;
}

export interface ConfidenceAdjustedEdgeOutput {
  rawEdge: number;
  confidenceAdjustedEdge: number;
  riskAdjustedEdge: number;
  edgeQualityClassification: EdgeQualityClassification;
  /** Multipliers used to compute the adjusted edges (for trace). */
  multipliers: {
    confidence: number;
    risk: number;
    dataQuality: number;
    role: number;
    volatility: number;
  };
  reasons: string[];
  risks: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function volatilityMultiplier(level: VolatilityLevel): number {
  if (level === "low") return 1.0;
  if (level === "medium") return 0.9;
  return 0.8;
}

export function calculateConfidenceAdjustedEdge(
  input: ConfidenceAdjustedEdgeInput,
): ConfidenceAdjustedEdgeOutput {
  const reasons: string[] = [];
  const risks: string[] = [];
  const config = getPropModelConfig(input.propType);
  const volatility = input.propVolatility ?? config.defaultVolatilityLevel;

  const confMul = clamp(input.confidence / 0.7, 0.3, 1.0);
  const riskMul = clamp(input.riskScore / 0.7, 0.5, 1.0);
  const dqMul = clamp(input.dataQuality / 0.7, 0.5, 1.0);
  const roleMul = clamp(input.roleStability / 0.65, 0.55, 1.0);
  const volMul = volatilityMultiplier(volatility);

  const rawEdge = input.rawEdge;
  const confAdj = rawEdge * confMul;
  const riskAdj = rawEdge * confMul * riskMul * dqMul * roleMul * volMul;

  const absRaw = Math.abs(rawEdge);
  const absConfAdj = Math.abs(confAdj);

  let classification: EdgeQualityClassification;
  if (absRaw < 0.02) {
    classification = "NO_EDGE";
  } else if (absConfAdj < 0.03) {
    classification = "THIN_EDGE";
    risks.push(
      `Confidence-adjusted edge ${(absConfAdj * 100).toFixed(1)}pp below 3pp — not a usable edge`,
    );
  } else if (
    absRaw >= 0.075 &&
    absConfAdj / absRaw < 0.5 &&
    input.confidence < 0.55
  ) {
    classification = "SUSPICIOUS_EDGE";
    risks.push(
      `Raw edge ${(absRaw * 100).toFixed(1)}pp but confidence-adjusted only ${(absConfAdj * 100).toFixed(1)}pp at confidence ${(input.confidence * 100).toFixed(0)}% — overconfidence risk`,
    );
  } else if (absConfAdj < 0.06) {
    classification = "USABLE_EDGE";
    reasons.push(
      `Confidence-adjusted edge ${(absConfAdj * 100).toFixed(1)}pp clears thin threshold`,
    );
  } else {
    classification = "STRONG_EDGE";
    reasons.push(
      `Confidence-adjusted edge ${(absConfAdj * 100).toFixed(1)}pp — strong`,
    );
  }

  // Additional SUSPICIOUS triggers — proxy-only or matchup-only
  // disagreement at high raw edge.
  if (
    classification !== "SUSPICIOUS_EDGE" &&
    absRaw >= 0.075 &&
    input.confidence < 0.5
  ) {
    classification = "SUSPICIOUS_EDGE";
    risks.push(
      `High raw edge ${(absRaw * 100).toFixed(1)}pp with low confidence ${(input.confidence * 100).toFixed(0)}% — flag for review`,
    );
  }

  if (riskAdj < confAdj * 0.7) {
    risks.push(
      `Risk-adjusted edge ${(riskAdj * 100).toFixed(1)}pp materially below confidence-adjusted edge — risk drag is significant`,
    );
  }

  return {
    rawEdge,
    confidenceAdjustedEdge: confAdj,
    riskAdjustedEdge: riskAdj,
    edgeQualityClassification: classification,
    multipliers: {
      confidence: confMul,
      risk: riskMul,
      dataQuality: dqMul,
      role: roleMul,
      volatility: volMul,
    },
    reasons,
    risks,
  };
}

/** Convenience: only the confidence-adjusted edge value. */
export function confidenceAdjustedEdge(
  input: ConfidenceAdjustedEdgeInput,
): number {
  return calculateConfidenceAdjustedEdge(input).confidenceAdjustedEdge;
}

/** Convenience: only the risk-adjusted edge value. */
export function riskAdjustedEdge(input: ConfidenceAdjustedEdgeInput): number {
  return calculateConfidenceAdjustedEdge(input).riskAdjustedEdge;
}

export function classifyEdgeQuality(
  input: ConfidenceAdjustedEdgeInput,
): EdgeQualityClassification {
  return calculateConfidenceAdjustedEdge(input).edgeQualityClassification;
}
