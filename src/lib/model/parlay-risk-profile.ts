/**
 * Parlay risk-profile classification + variance / fragility /
 * overstacking scoring.
 *
 * Read-only on the existing parlay candidate. Used by the UI's
 * "Why this could fail" panel, by the portfolio optimizer, and by
 * the audit test runner. Does not change qualification logic.
 */

import type {
  ParlayCandidate,
  ParlayLeg,
  ParlayRiskProfile,
} from "./parlay-types";

const YARDAGE_PROP_TYPES = new Set([
  "PASSING_YARDS",
  "RECEIVING_YARDS",
  "RUSHING_YARDS",
]);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function countYardageLegs(legs: ParlayLeg[]): number {
  return legs.filter((l) => YARDAGE_PROP_TYPES.has(l.propType)).length;
}

function deepReceiverHints(legs: ParlayLeg[]): number {
  return legs.filter(
    (l) =>
      l.playerRole === "WR_DEEP" ||
      (l.propType === "RECEIVING_YARDS" && (l.line ?? 0) >= 70),
  ).length;
}

/**
 * Aggregate variance score (0..1; higher = more variance).
 * Components:
 *   - 3-leg vs 2-leg base
 *   - share of yardage legs
 *   - deep WR hints
 *   - low data quality
 */
export function calculateParlayVarianceScore(
  candidate: ParlayCandidate,
): number {
  const legs = candidate.legs;
  const base = legs.length >= 3 ? 0.55 : 0.35;
  const yardageShare = countYardageLegs(legs) / legs.length;
  const deep = deepReceiverHints(legs) > 0 ? 0.1 : 0;
  const dqDrag = clamp(0.7 - candidate.dataQualityScore, 0, 0.3);
  return clamp(base + yardageShare * 0.3 + deep + dqDrag, 0, 1);
}

/**
 * Fragility score (0..1) — how much of the parlay's edge depends
 * on the exact line setting on individual legs. Max of leg-level
 * line fragility, with a small additive bump for yardage-heavy
 * mixes (which are more line-sensitive in practice).
 */
export function calculateParlayFragilityScore(
  candidate: ParlayCandidate,
): number {
  const maxLeg = candidate.legs.reduce(
    (m, l) => Math.max(m, l.lineFragilityScore ?? 0),
    0,
  );
  const yardageBump =
    countYardageLegs(candidate.legs) >= 2 ? 0.1 : 0;
  return clamp(maxLeg + yardageBump, 0, 1);
}

/**
 * Overstacking score (0..1) — how much same-team / same-game
 * exposure the parlay carries. The builder already disqualifies
 * 2+ same-team receiver OVERs; this helper assigns a softer
 * gradient (e.g., 2 legs same team but different prop types
 * still scores > 0).
 */
export function calculateOverstackingScore(
  candidate: ParlayCandidate,
): number {
  const legs = candidate.legs;
  const sameGame = candidate.gameIds.length === 1;
  if (!sameGame) return 0;
  // Same-team passing-game leg count (receiving OVERs are the
  // overstack vector).
  const teams = new Map<string, number>();
  for (const leg of legs) {
    if (
      (leg.propType === "RECEPTIONS" ||
        leg.propType === "RECEIVING_YARDS") &&
      leg.side === "OVER"
    ) {
      teams.set(leg.team, (teams.get(leg.team) ?? 0) + 1);
    }
  }
  let max = 0;
  for (const c of teams.values()) max = Math.max(max, c);
  if (max <= 1) return 0;
  if (max === 2) return 0.6;
  return 1.0;
}

/**
 * Classify the parlay into a single descriptive risk profile.
 * The first matching condition wins, so the order encodes our
 * "how to introduce this parlay to a human" priority.
 */
export function classifyParlayRiskProfile(
  candidate: ParlayCandidate,
): ParlayRiskProfile {
  const overstacking = calculateOverstackingScore(candidate);
  if (overstacking >= 0.6) return "OVERSTACKED";
  const fragility = calculateParlayFragilityScore(candidate);
  if (fragility >= 0.7) return "FRAGILE_LINES";
  if (candidate.correlationType === "UNKNOWN") return "UNKNOWN_CORRELATION";
  if (candidate.payoutMultiplier >= 8) return "HIGH_PAYOUT_LONGSHOT";
  const yardageHeavy =
    countYardageLegs(candidate.legs) >= 2 ||
    (candidate.legs.length >= 3 &&
      countYardageLegs(candidate.legs) >= 1);
  if (yardageHeavy && candidate.payoutMultiplier >= 4) {
    return "HIGH_VARIANCE_YARDAGE";
  }
  const variance = calculateParlayVarianceScore(candidate);
  return variance >= 0.55
    ? "MEDIUM_VARIANCE_CORRELATED"
    : "LOW_VARIANCE_CORRELATED";
}

/** Convenience bundle for the UI / audit tests. */
export interface ParlayRiskProfileBundle {
  profile: ParlayRiskProfile;
  varianceScore: number;
  fragilityScore: number;
  overstackingScore: number;
  whyCouldFail: string[];
}

export function buildParlayRiskProfileBundle(
  candidate: ParlayCandidate,
): ParlayRiskProfileBundle {
  const profile = classifyParlayRiskProfile(candidate);
  const varianceScore = calculateParlayVarianceScore(candidate);
  const fragilityScore = calculateParlayFragilityScore(candidate);
  const overstackingScore = calculateOverstackingScore(candidate);
  const whyCouldFail: string[] = [];
  if (profile === "OVERSTACKED") {
    whyCouldFail.push(
      "Multiple receiving OVERs from the same team — pass volume can't reliably feed every target.",
    );
  }
  if (profile === "FRAGILE_LINES" || fragilityScore >= 0.6) {
    whyCouldFail.push(
      `Line fragility ${fragilityScore.toFixed(2)} — a half-point line move could flip the joint hit-rate.`,
    );
  }
  if (profile === "UNKNOWN_CORRELATION") {
    whyCouldFail.push(
      "Correlation classified UNKNOWN — joint probability assumes independence, which may be wrong.",
    );
  }
  if (profile === "HIGH_PAYOUT_LONGSHOT") {
    whyCouldFail.push(
      "Big payout means the bar for projected hit rate is low — small modelling errors swing EV a lot.",
    );
  }
  if (profile === "HIGH_VARIANCE_YARDAGE") {
    whyCouldFail.push(
      "Yardage-heavy mix — outcomes are wider than volume props, so a normal model error costs more.",
    );
  }
  if (overstackingScore > 0 && overstackingScore < 0.6) {
    whyCouldFail.push(
      "Soft overstacking — multiple legs lean on the same game-script story.",
    );
  }
  if (varianceScore >= 0.7) {
    whyCouldFail.push(
      `Variance score ${varianceScore.toFixed(2)} — drawdowns are likely even with a good read.`,
    );
  }
  if (candidate.legs.length >= 3) {
    whyCouldFail.push(
      "Three-leg parlay — joint probability shrinks fast, payout has to compensate.",
    );
  }
  if (whyCouldFail.length === 0) {
    whyCouldFail.push(
      "No major risk profile concerns — but parlays are still higher variance than straight legs.",
    );
  }
  return {
    profile,
    varianceScore,
    fragilityScore,
    overstackingScore,
    whyCouldFail,
  };
}
