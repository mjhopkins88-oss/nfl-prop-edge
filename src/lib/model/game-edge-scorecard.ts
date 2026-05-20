/**
 * Display helpers for the experimental Game Edge scorecard.
 *
 * The scorecard itself is built inside `buildGameEdge` in
 * `game-edge-model.ts`. This module re-exports the scorecard type
 * and provides UI-side helpers (label colors, "selected market"
 * pretty names, primary disqualifier picker, top-N reason/risk
 * formatters). It mirrors the role of `model-scorecard`'s display
 * helpers — never adds new decision logic, never recomputes anything.
 *
 * Keep this layer SEPARATE from the player prop scorecard. Game-level
 * recommendations must not leak into prop UI components.
 */

import { buildGameEdge } from "./game-edge-model";
import type {
  GameEdgeInput,
  GameEdgeOutput,
  GameEdgeScorecard,
  GameRecommendation,
  GameRecommendationLabel,
  GameSide,
} from "./game-edge-types";

export type {
  GameEdgeInput,
  GameEdgeOutput,
  GameEdgeScorecard,
  GameRecommendation,
  GameRecommendationLabel,
  GameSide,
};

/**
 * Build a full Game Edge result and return its scorecard alongside
 * the raw output. The output is the source-of-truth for any
 * numeric/decision consumer; the scorecard is the display object.
 */
export function buildGameEdgeScorecard(input: GameEdgeInput): {
  output: GameEdgeOutput;
  scorecard: GameEdgeScorecard;
} {
  const output = buildGameEdge(input);
  return { output, scorecard: output.scorecard };
}

/** Map a recommendation label to a Tailwind color family. */
export function recommendationLabelTone(
  label: GameRecommendationLabel,
): "play" | "watch" | "pass" {
  switch (label) {
    case "Strong ML Value":
    case "Playable ML Value":
    case "Spread Value":
      return "play";
    case "Upset Watch":
    case "Cover Watch":
      return "watch";
    case "Pass / No Edge":
    case "Pass / Too Much Uncertainty":
      return "pass";
  }
}

export function recommendationLabelClasses(
  label: GameRecommendationLabel,
): string {
  const tone = recommendationLabelTone(label);
  if (tone === "play") return "bg-sea-50 text-sea-800 ring-sea-300/60";
  if (tone === "watch") return "bg-amber-50 text-amber-900 ring-amber-300/60";
  return "bg-cream-200 text-ink-700 ring-ink-300/60";
}

export function selectedMarketLabel(
  recommendation: GameRecommendation,
): string {
  switch (recommendation) {
    case "HOME_MONEYLINE":
      return "Home Moneyline";
    case "AWAY_MONEYLINE":
      return "Away Moneyline";
    case "HOME_SPREAD":
      return "Home Spread";
    case "AWAY_SPREAD":
      return "Away Spread";
    case "PASS":
      return "Pass";
  }
}

/** Convert a SIDE to the corresponding team name from the scorecard. */
export function sideToTeam(
  scorecard: GameEdgeScorecard,
  side: GameSide | undefined,
): string | undefined {
  if (!side) return undefined;
  return side === "HOME" ? scorecard.homeTeam : scorecard.awayTeam;
}

export function getPrimaryDisqualifier(
  scorecard: GameEdgeScorecard,
): string | undefined {
  return scorecard.disqualifiers[0];
}

export function getTopReasons(
  scorecard: GameEdgeScorecard,
  n = 3,
): string[] {
  return scorecard.reasons.slice(0, n);
}

export function getTopRisks(
  scorecard: GameEdgeScorecard,
  n = 3,
): string[] {
  return scorecard.risks.slice(0, n);
}

/** Format an edge (in percentage-points) for display. */
export function formatEdgePp(edgePp: number): string {
  const sign = edgePp > 0 ? "+" : "";
  return `${sign}${edgePp.toFixed(1)}pp`;
}

export function formatProbability(prob: number): string {
  return `${(prob * 100).toFixed(0)}%`;
}

export function formatAmericanOdds(odds: number): string {
  if (odds > 0) return `+${odds}`;
  return `${odds}`;
}

export function formatSpread(spread: number): string {
  if (spread > 0) return `+${spread}`;
  return `${spread}`;
}

export function upsetScoreTone(score: number): "high" | "medium" | "low" {
  if (score >= 55) return "high";
  if (score >= 35) return "medium";
  return "low";
}

export function upsetScoreClasses(score: number): string {
  const tone = upsetScoreTone(score);
  if (tone === "high") return "bg-rose-50 text-coral-700 ring-coral-300/60";
  if (tone === "medium") return "bg-amber-50 text-amber-900 ring-amber-300/60";
  return "bg-cream-200 text-ink-700 ring-ink-300/60";
}
