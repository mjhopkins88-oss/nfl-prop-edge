/**
 * Display helpers for the Experimental Correlated Parlay Model.
 *
 * Mirrors the role of `game-edge-scorecard.ts` in the Game Edge
 * track — no new decision logic, no recomputation. Pure formatting
 * + presentational tags for the UI.
 *
 * Strictly separate from the player prop and Game Edge scorecards.
 */

import type {
  CorrelationType,
  ParlayCandidate,
  ParlayRecommendation,
  ParlayScorecard,
  ParlayType,
} from "./parlay-types";
import { buildParlayCandidates } from "./parlay-builder";
import {
  PARLAY_LEG_FIXTURES,
  PARLAY_CANDIDATE_FIXTURES,
} from "./parlay-data";
import { calculateTargetBatchMath } from "./parlay-ev";

export type {
  ParlayCandidate,
  ParlayRecommendation,
  ParlayScorecard,
  ParlayType,
  CorrelationType,
};

/** Build every fixture candidate and return them ranked. */
export function buildAllFixtureParlayCandidates(): ParlayCandidate[] {
  return buildParlayCandidates({
    legs: PARLAY_LEG_FIXTURES,
    candidateSpecs: PARLAY_CANDIDATE_FIXTURES.map((f) => ({
      legIds: f.legIds,
      parlayType: f.parlayType,
    })),
  });
}

/** Look up a fixture candidate by its synthesized parlay id. */
export function getFixtureParlayById(
  parlayId: string,
): ParlayCandidate | undefined {
  return buildAllFixtureParlayCandidates().find((c) => c.id === parlayId);
}

export function recommendationLabel(
  rec: ParlayRecommendation,
): string {
  switch (rec) {
    case "STRONG_PARLAY_VALUE":
      return "Strong Parlay Value";
    case "PLAYABLE_PARLAY_VALUE":
      return "Playable Parlay Value";
    case "CORRELATED_WATCH":
      return "Correlated Watch";
    case "PASS_LOW_EV":
      return "Pass / Low EV";
    case "PASS_TOO_MUCH_RISK":
      return "Pass / Too Much Risk";
    case "PASS_BAD_CORRELATION":
      return "Pass / Bad Correlation";
    case "PASS_LEG_NOT_QUALIFIED":
      return "Pass / Leg Not Qualified";
    case "PASS_TOO_FRAGILE":
      return "Pass / Too Fragile";
  }
}

export type RecommendationTone = "play" | "watch" | "pass";

export function recommendationTone(
  rec: ParlayRecommendation,
): RecommendationTone {
  if (rec === "STRONG_PARLAY_VALUE" || rec === "PLAYABLE_PARLAY_VALUE")
    return "play";
  if (rec === "CORRELATED_WATCH") return "watch";
  return "pass";
}

export function recommendationLabelClasses(
  rec: ParlayRecommendation,
): string {
  const tone = recommendationTone(rec);
  if (tone === "play") return "bg-sea-50 text-sea-800 ring-sea-300/60";
  if (tone === "watch") return "bg-amber-50 text-amber-900 ring-amber-300/60";
  return "bg-cream-200 text-ink-700 ring-ink-300/60";
}

export function correlationTypeClasses(type: CorrelationType): string {
  switch (type) {
    case "POSITIVE":
      return "bg-sea-50 text-sea-800 ring-sea-300/60";
    case "NEGATIVE":
      return "bg-rose-50 text-coral-700 ring-coral-300/60";
    case "CONFLICTING":
      return "bg-rose-50 text-coral-700 ring-coral-300/60";
    case "WEAK":
      return "bg-amber-50 text-amber-900 ring-amber-300/60";
    case "UNKNOWN":
      return "bg-cream-200 text-ink-700 ring-ink-300/60";
  }
}

export function parlayTypeLabel(type: ParlayType): string {
  switch (type) {
    case "QB_RECEIVER_YARDS":
      return "QB / WR yards stack";
    case "QB_COMPLETIONS_RECEIVER_RECEPTIONS":
      return "Completions / receptions stack";
    case "PASS_VOLUME_STACK":
      return "Pass-volume stack";
    case "RB_GAME_SCRIPT_STACK":
      return "RB game-script stack";
    case "NEGATIVE_PASSING_STACK":
      return "Negative passing stack";
    case "WEATHER_UNDER_STACK":
      return "Weather UNDER stack";
    case "PRESSURE_QUICK_GAME_STACK":
      return "Pressure / quick-game stack";
    case "QB_COMPLETIONS_RB_RECEPTIONS":
      return "Completions / RB receptions stack";
    case "QB_ATTEMPTS_SHORT_AREA_RECEPTIONS":
      return "Attempts / short-area receptions stack";
    case "QB_UNDER_RB_OVER_GAME_SCRIPT":
      return "Clock-control game-script stack";
    case "TE_FUNNEL_STACK":
      return "TE-funnel stack";
    case "PRESSURE_CHECKDOWN_STACK":
      return "Pressure / checkdown stack";
    case "NON_CORRELATED_EV_PAIR":
      return "Non-correlated EV pair (different games)";
    case "ALT_LINE_CANDIDATE":
      return "Alt-line candidate (research only)";
    case "ANTI_PUBLIC_FADE_STACK":
      return "Anti-public fade stack (research only)";
    case "CUSTOM":
      return "Custom";
  }
}

export function formatAmericanOdds(odds: number): string {
  if (odds > 0) return `+${odds}`;
  return `${odds}`;
}

export function formatDecimalOdds(decimal: number): string {
  return `${decimal.toFixed(2)}x`;
}

export function formatEv(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(1)}%`;
}

export function formatProbability(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

/** Summary metrics shown on the parlay dashboard. */
export interface ParlayDashboardSummary {
  evaluated: number;
  qualified: number;
  correlatedWatch: number;
  passes: number;
  averageProjectedHitRate: number;
  averagePayoutMultiplier: number;
  averageConfidenceAdjustedEv: number;
  targetHitRateLow: number;
  targetHitRateHigh: number;
  requiredPayoutAtLow: number;
  requiredPayoutAtHigh: number;
  requiredPayoutAtMid: number;
}

export function summarizeParlays(
  candidates: ParlayCandidate[],
): ParlayDashboardSummary {
  const evaluated = candidates.length;
  const qualified = candidates.filter((c) => c.qualified).length;
  const correlatedWatch = candidates.filter(
    (c) => c.recommendation === "CORRELATED_WATCH",
  ).length;
  const passes = candidates.filter(
    (c) =>
      !c.qualified &&
      c.recommendation !== "CORRELATED_WATCH",
  ).length;
  const avg = (xs: number[]) =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  const projectedHits = candidates.map((c) => c.projectedHitRate);
  const payouts = candidates.map((c) => c.payoutMultiplier);
  const evs = candidates.map((c) => c.confidenceAdjustedExpectedValue);
  const math = calculateTargetBatchMath({});
  return {
    evaluated,
    qualified,
    correlatedWatch,
    passes,
    averageProjectedHitRate: avg(projectedHits),
    averagePayoutMultiplier: avg(payouts),
    averageConfidenceAdjustedEv: avg(evs),
    targetHitRateLow: math.lowHitRate,
    targetHitRateHigh: math.highHitRate,
    requiredPayoutAtLow: math.requiredPayoutLow,
    requiredPayoutAtHigh: math.requiredPayoutHigh,
    requiredPayoutAtMid: math.requiredPayoutMidpoint,
  };
}
