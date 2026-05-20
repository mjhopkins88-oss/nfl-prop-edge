/**
 * Parlay postmortem tagging.
 *
 * Research-only. Designed to tag historical outcomes when the
 * backtest runner lands, so we can answer "why did this parlay
 * fail?" beyond just win/loss. Currently no caller produces tags
 * — this module defines the vocabulary + a deterministic tagger
 * that operates on a tag-input shape.
 *
 * The tagger is intentionally narrow: it only fires tags when the
 * input clearly supports them. Ambiguous cases get no tag rather
 * than guessing.
 */

import type {
  ParlayCandidate,
  ParlayPostmortemTag,
  ParlayRiskProfile,
} from "./parlay-types";
import { classifyParlayRiskProfile } from "./parlay-risk-profile";

/**
 * Minimum input shape needed to tag a parlay outcome. We don't
 * require the full historical leg outcomes yet — the optional
 * fields can be filled in once the backtest runner exists.
 */
export interface ParlayPostmortemInput {
  candidate: ParlayCandidate;
  /** Did all legs hit? `null` when no historical outcome is set. */
  allLegsHit: boolean | null;
  /**
   * Indexed by `leg.id` — true if the leg hit, false if it didn't.
   * Lets the tagger fire ONE_LEG_ANCHOR_FAILED when most legs
   * cleared.
   */
  legResults?: Map<string, boolean>;
  /** Optional game-script signal (for GAME_SCRIPT_FAILED tagging). */
  actualWasTrailing?: boolean;
  /** Optional weather signal (for WEATHER_READ_FAILED tagging). */
  actualWeatherWasMild?: boolean;
}

export function assignParlayPostmortemTags(
  input: ParlayPostmortemInput,
): ParlayPostmortemTag[] {
  const tags: ParlayPostmortemTag[] = [];
  const c = input.candidate;
  const profile: ParlayRiskProfile = classifyParlayRiskProfile(c);

  // Filter outcomes: even if there's no historical outcome yet,
  // we can mark cases the filters "correctly avoided" / "were too
  // conservative on" so the backtester can score the gates.
  if (!c.qualified && c.disqualifiers.length > 0) {
    if (input.allLegsHit === false) {
      tags.push("FILTER_CORRECTLY_AVOIDED");
    } else if (input.allLegsHit === true) {
      tags.push("FILTER_TOO_CONSERVATIVE");
    }
  }

  if (input.allLegsHit === false) {
    // One-leg-anchor-failed: most legs hit but one missed.
    if (input.legResults) {
      const hits = [...input.legResults.values()].filter(Boolean).length;
      const total = input.legResults.size;
      if (total >= 2 && hits === total - 1) {
        tags.push("ONE_LEG_ANCHOR_FAILED");
      }
    }

    // Variance signal: the parlay was qualified but lost.
    if (c.qualified && tags.length === 0) {
      tags.push("GOOD_READ_BAD_VARIANCE");
    }

    // Correlation overestimated: relevant when the correlation was
    // POSITIVE / NEGATIVE / CONFLICTING but the parlay missed.
    if (
      c.qualified &&
      (c.correlationType === "POSITIVE" ||
        c.correlationType === "NEGATIVE")
    ) {
      tags.push("CORRELATION_OVERESTIMATED");
    }

    // Risk-profile-driven explanations.
    if (profile === "FRAGILE_LINES") tags.push("LINE_TOO_FRAGILE");
    if (profile === "HIGH_PAYOUT_LONGSHOT") tags.push("HIGH_PAYOUT_TRAP");
    if (profile === "OVERSTACKED") tags.push("OVERSTACKED_FAILURE");

    // Game-script / weather / role-assumption tagging when callers
    // provide the historical signal.
    if (input.actualWasTrailing === true) tags.push("GAME_SCRIPT_FAILED");
    if (input.actualWeatherWasMild === true) tags.push("WEATHER_READ_FAILED");

    // Role assumption: the parlay relied on STABLE_ROLE legs but
    // some legs missed. Approximation — we don't have per-leg role
    // truth yet.
    if (
      c.legs.some((l) => l.playerRole === "WR_DEEP") &&
      tags.length === 0
    ) {
      tags.push("ROLE_ASSUMPTION_FAILED");
    }
  }

  // Payout-too-low: didn't qualify because EV was thin even though
  // every leg hit.
  if (
    !c.qualified &&
    input.allLegsHit === true &&
    c.disqualifiers.some((d) => d.toLowerCase().includes("expected value"))
  ) {
    tags.push("PAYOUT_TOO_LOW");
  }

  return Array.from(new Set(tags));
}

/**
 * Convenience description for the UI / docs.
 */
export const POSTMORTEM_TAG_DESCRIPTIONS: Record<
  ParlayPostmortemTag,
  string
> = {
  GOOD_READ_BAD_VARIANCE:
    "Parlay was qualified on the model's reading, but the joint outcome missed despite reasonable inputs.",
  CORRELATION_OVERESTIMATED:
    "Positive / negative correlation was assumed but didn't manifest in the outcome.",
  ONE_LEG_ANCHOR_FAILED:
    "All but one leg hit — single-leg variance ended the parlay.",
  GAME_SCRIPT_FAILED:
    "Game-script assumption (favorite leading / trailing) didn't hold.",
  WEATHER_READ_FAILED:
    "Forecast suggested suppressed passing, actual weather was mild.",
  ROLE_ASSUMPTION_FAILED:
    "Player role / usage didn't match the projection.",
  LINE_TOO_FRAGILE:
    "Fragile line — half-point shift made the parlay's hit-rate model wrong.",
  PAYOUT_TOO_LOW: "All legs hit but the parlay was correctly skipped for low EV.",
  HIGH_PAYOUT_TRAP:
    "Long-payout candidate; loss was expected variance.",
  OVERSTACKED_FAILURE:
    "Same-team receiver overstacking — one of the receivers absorbed the targets.",
  FILTER_CORRECTLY_AVOIDED:
    "Parlay was disqualified by a gate that turned out to be right.",
  FILTER_TOO_CONSERVATIVE:
    "Parlay was disqualified but all legs hit — gate may be too strict.",
};
