/**
 * Backtest stage 3 — Probability engine.
 *
 * Takes a projection and a prop market and produces:
 *   - model over/under probability (normal CDF on the projection)
 *   - no-vig book probability from the posted odds
 *   - edge (signed: positive favors OVER)
 *   - expected value of the recommended side
 *   - recommendation (OVER | UNDER | PASS) with per-prop-type thresholds
 *   - qualification + structured pass reasons
 *
 * Pass triggers (any one of these forces PASS):
 *   - |edge| below the prop type's threshold
 *   - role uncertainty (from projection)
 *   - injury uncertainty (from projection)
 *   - malformed market data (passed in via features upstream)
 */

import type { PropType, Recommendation } from "../types";
import type { Projection } from "./projection-engine";

// --- per-prop-type edge thresholds -----------------------------------

/** Minimum |edge| to qualify a bet, by prop type. */
export const EDGE_THRESHOLDS: Record<PropType, number> = {
  PASSING_ATTEMPTS: 0.04,
  PASSING_COMPLETIONS: 0.04,
  RECEPTIONS: 0.05,
  RUSHING_ATTEMPTS: 0.05,
  PASSING_YARDS: 0.06,
  RUSHING_YARDS: 0.06,
  RECEIVING_YARDS: 0.07,
};

// --- math helpers ----------------------------------------------------

/** Standard normal CDF (Abramowitz & Stegun 26.2.17 — error < 7.5e-8). */
export function normalCdf(z: number): number {
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function decimalPayout(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

function expectedValue(modelProb: number, americanOdds: number): number {
  return modelProb * decimalPayout(americanOdds) - (1 - modelProb);
}

// --- inputs / outputs ------------------------------------------------

export interface ProbabilityInput {
  propType: PropType;
  line: number;
  overOdds: number;
  underOdds: number;
  marketWellFormed: boolean;
  projection: Projection;
}

export interface ProbabilityResult {
  modelOverProbability: number;
  modelUnderProbability: number;
  bookOverProbability: number;
  bookUnderProbability: number;
  /** signed; positive favors OVER. */
  edge: number;
  expectedValue: number;
  recommendation: Recommendation;
  qualified: boolean;
  /** confidence 0..1: blends edge magnitude and sigma/mean inverse. */
  confidence: number;
  /** reasons we chose to PASS (empty if recommendation is OVER or UNDER). */
  passReasons: string[];
  threshold: number;
}

// --- entry point -----------------------------------------------------

export function computeProbability(input: ProbabilityInput): ProbabilityResult {
  const { propType, line, overOdds, underOdds, projection } = input;
  const sigma = Math.max(0.001, projection.stddev);
  const z = (line - projection.mean) / sigma;
  const modelOver = 1 - normalCdf(z);
  const modelUnder = 1 - modelOver;

  const overImp = americanToImpliedProb(overOdds);
  const underImp = americanToImpliedProb(underOdds);
  const sum = overImp + underImp || 1;
  const bookOverNoVig = overImp / sum;
  const bookUnderNoVig = underImp / sum;

  const edge = modelOver - bookOverNoVig; // signed
  const threshold = EDGE_THRESHOLDS[propType];

  // Tentative side based on signed edge magnitude.
  let recommendation: Recommendation = "PASS";
  if (edge > threshold) recommendation = "OVER";
  else if (-edge > threshold) recommendation = "UNDER";

  // Pass-trigger checks (override the tentative recommendation).
  const passReasons: string[] = [];
  if (recommendation === "PASS" && Math.abs(edge) <= threshold) {
    passReasons.push(
      `|edge| ${(Math.abs(edge) * 100).toFixed(1)}% under ${(threshold * 100).toFixed(1)}% threshold`,
    );
  }
  if (!input.marketWellFormed) {
    passReasons.push("market data missing or malformed");
    recommendation = "PASS";
  }
  if (projection.roleUncertainty) {
    passReasons.push("role/sample uncertainty");
    recommendation = "PASS";
  }
  if (projection.injuryUncertainty) {
    passReasons.push("game-level injury uncertainty flag");
    recommendation = "PASS";
  }

  const qualified = recommendation !== "PASS";

  const recommendedOdds =
    recommendation === "UNDER" ? underOdds : overOdds;
  const recommendedProb =
    recommendation === "UNDER" ? modelUnder : modelOver;
  const ev = qualified ? expectedValue(recommendedProb, recommendedOdds) : 0;

  // Confidence: a soft blend of (edge over threshold) and inverse coefficient
  // of variation. Capped to [0, 1].
  const edgeFactor = Math.min(1, Math.abs(edge) / Math.max(threshold, 0.01));
  const cv =
    projection.mean !== 0 ? sigma / Math.abs(projection.mean) : 1;
  const cvFactor = Math.max(0, Math.min(1, 1 - cv / 1.5));
  const confidence = Math.max(0, Math.min(1, 0.5 * edgeFactor + 0.5 * cvFactor));

  return {
    modelOverProbability: modelOver,
    modelUnderProbability: modelUnder,
    bookOverProbability: bookOverNoVig,
    bookUnderProbability: bookUnderNoVig,
    edge,
    expectedValue: ev,
    recommendation,
    qualified,
    confidence,
    passReasons,
    threshold,
  };
}
