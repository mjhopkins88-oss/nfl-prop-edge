/**
 * Line sensitivity / edge fragility for player props.
 *
 * Treats the projection as a normal distribution (mean ± σ) and
 * recomputes the OVER probability at the current line, line - 1,
 * and line + 1. A "fragile" edge collapses when the line moves by
 * 1 unit. Half-lines (4.5) are handled correctly — the integer
 * neighbors are 3.5 and 5.5 (i.e., ±1 unit).
 *
 * No qualification decision is made here. The output feeds the v2
 * pipeline's qualification step, which gates yardage props more
 * strictly than volume props.
 */

import type { PropType } from "../types";
import { isYardageProp } from "./prop-model-config";

export interface LineSensitivityInput {
  propType: PropType;
  marketLine: number;
  projectedMean: number;
  projectedStdDev: number;
  /** OVER probability at the current line, supplied by upstream model. */
  modelOverProbability: number;
  /** No-vig OVER probability at the current line. */
  noVigOverProbability?: number;
}

export type LineSensitivityLabel =
  | "STABLE_EDGE"
  | "MILDLY_SENSITIVE"
  | "FRAGILE_EDGE"
  | "EVAPORATES_ON_MOVE"
  | "INSUFFICIENT_DATA";

export interface NearbyLineProbabilities {
  currentLine: number;
  currentOverProbability: number;
  minusOneLine: number;
  minusOneOverProbability: number;
  plusOneLine: number;
  plusOneOverProbability: number;
}

export interface LineSensitivityOutput {
  nearby: NearbyLineProbabilities;
  /** Worst-case |Δ probability| over the ±1 neighborhood. */
  maxNeighborProbabilityShift: number;
  /** 0..1; higher = more fragile. */
  edgeFragilityScore: number;
  keyLineRisk: boolean;
  lineSensitivityLabel: LineSensitivityLabel;
  reasons: string[];
  risks: string[];
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function overProbability(line: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) return mean > line ? 1 : mean === line ? 0.5 : 0;
  const z = (line - mean) / stdDev;
  return 1 - normalCdf(z);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Key prop lines for receiving / rushing markets that tend to
 * cluster more tightly than the underlying continuous variable
 * would suggest (e.g., a 4.5-reception line sits on a high-density
 * integer outcome).
 */
function nearestKeyLine(
  propType: PropType,
  line: number,
): { onKey: boolean; key?: number } {
  const integers: Partial<Record<PropType, number[]>> = {
    RECEPTIONS: [3, 4, 5, 6, 7],
    RUSHING_ATTEMPTS: [10, 12, 14, 16, 18, 20],
    PASSING_ATTEMPTS: [25, 28, 30, 32, 35, 38, 40],
    PASSING_COMPLETIONS: [16, 18, 20, 22, 24, 26],
  };
  const list = integers[propType] ?? [];
  for (const k of list) {
    if (Math.abs(line - k) <= 0.25) return { onKey: true, key: k };
  }
  return { onKey: false };
}

export function getNearbyLineProbabilities(
  input: LineSensitivityInput,
): NearbyLineProbabilities {
  const mean = input.projectedMean;
  const sd = input.projectedStdDev;
  return {
    currentLine: input.marketLine,
    currentOverProbability: input.modelOverProbability,
    minusOneLine: input.marketLine - 1,
    minusOneOverProbability: overProbability(input.marketLine - 1, mean, sd),
    plusOneLine: input.marketLine + 1,
    plusOneOverProbability: overProbability(input.marketLine + 1, mean, sd),
  };
}

export function calculateLineSensitivity(
  input: LineSensitivityInput,
): LineSensitivityOutput {
  const reasons: string[] = [];
  const risks: string[] = [];
  if (input.projectedStdDev <= 0) {
    return {
      nearby: {
        currentLine: input.marketLine,
        currentOverProbability: input.modelOverProbability,
        minusOneLine: input.marketLine - 1,
        minusOneOverProbability: input.modelOverProbability,
        plusOneLine: input.marketLine + 1,
        plusOneOverProbability: input.modelOverProbability,
      },
      maxNeighborProbabilityShift: 0,
      edgeFragilityScore: 0.5,
      keyLineRisk: false,
      lineSensitivityLabel: "INSUFFICIENT_DATA",
      reasons,
      risks: ["Projection σ unavailable — cannot evaluate line sensitivity"],
    };
  }

  const nearby = getNearbyLineProbabilities(input);
  const shiftDown = Math.abs(
    nearby.minusOneOverProbability - nearby.currentOverProbability,
  );
  const shiftUp = Math.abs(
    nearby.plusOneOverProbability - nearby.currentOverProbability,
  );
  // We use the SMALLER of the two neighbor shifts — the line is more
  // likely to drift in the direction the market thinks softens, and a
  // robust edge survives the smaller drift. Yardage props use the
  // average shift because both directions are realistic moves.
  const yardage = isYardageProp(input.propType);
  const maxShift = yardage
    ? (shiftDown + shiftUp) / 2
    : Math.min(shiftDown, shiftUp);

  const currentEdge =
    input.modelOverProbability - (input.noVigOverProbability ?? 0.5);
  const edgeAbs = Math.abs(currentEdge);
  // Edge fragility — does a 1-line move collapse the edge?
  // Use absolute shift magnitude, prop-aware thresholds: yardage props
  // tolerate more (since 1 yard is small relative to the projection's
  // σ) while volume props treat large probability shifts as risk.
  const fragility = clamp(maxShift / Math.max(edgeAbs, 0.04), 0, 1);

  const { onKey, key } = nearestKeyLine(input.propType, input.marketLine);
  if (onKey) {
    risks.push(
      `Market line ${input.marketLine} sits on key prop integer ${key} — line moves change probability sharply`,
    );
  }

  // Absolute shift-based classification — keeps "STABLE" semantically
  // tied to "the projection's nearby probability is similar to current",
  // independent of edge magnitude. The edge-magnitude check is done in
  // qualification, where it can be paired with confidence.
  let label: LineSensitivityLabel;
  if (maxShift < 0.1) {
    label = "STABLE_EDGE";
    reasons.push(
      `Projection robust across ±1 line move (max neighbor shift ${(maxShift * 100).toFixed(1)}pp)`,
    );
  } else if (maxShift < 0.2) {
    label = "MILDLY_SENSITIVE";
    risks.push(
      `Projection probability sensitive to ±1 line move (${(maxShift * 100).toFixed(1)}pp swing)`,
    );
  } else if (maxShift < 0.35) {
    label = "FRAGILE_EDGE";
    risks.push(
      `Projection probability shifts ${(maxShift * 100).toFixed(1)}pp across ±1 line — confirm edge survives`,
    );
  } else {
    label = "EVAPORATES_ON_MOVE";
    risks.push(
      `Projection probability shifts ${(maxShift * 100).toFixed(1)}pp across ±1 line — edge highly dependent on the exact line`,
    );
  }

  // Yardage prop bonus risk if the edge depends on a single bin.
  if (yardage && fragility >= 0.6) {
    risks.push(
      `Yardage prop with fragile edge — backtests punish these`,
    );
  }

  return {
    nearby,
    maxNeighborProbabilityShift: maxShift,
    edgeFragilityScore: fragility,
    keyLineRisk: onKey,
    lineSensitivityLabel: label,
    reasons,
    risks,
  };
}

/** Convenience: returns just the fragility score. */
export function calculateEdgeFragility(input: LineSensitivityInput): number {
  return calculateLineSensitivity(input).edgeFragilityScore;
}

/** Convenience: returns the key-line risk flag + key value. */
export function classifyKeyLineRisk(
  propType: PropType,
  line: number,
): { onKey: boolean; key?: number } {
  return nearestKeyLine(propType, line);
}
