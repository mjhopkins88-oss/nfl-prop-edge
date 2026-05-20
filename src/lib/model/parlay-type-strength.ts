/**
 * Strength + audit notes per parlay type.
 *
 * Used to communicate to users which parlay structures the model
 * considers genuinely actionable vs. likely already priced by
 * books vs. waiting on data we don't have yet. Read-only — does
 * not change qualification.
 *
 * "Book-priced" = same-game parlay markets that books already
 * correlate in their pricing. We can still play them, but our
 * raw EV needs to be larger because the book's SGP price is
 * already correlation-aware.
 */

import type { ParlayType } from "./parlay-types";

export type ParlayTypeStrengthBand =
  | "STRONG"
  | "MODERATE"
  | "EXPLORATORY"
  | "RESEARCH_ONLY";

export interface ParlayTypeStrengthBundle {
  parlayType: ParlayType;
  strengthScore: number; // 0..1
  band: ParlayTypeStrengthBand;
  riskNotes: string[];
  dataRequirements: string[];
}

interface ParlayTypeEntry {
  strengthScore: number;
  band: ParlayTypeStrengthBand;
  riskNotes: string[];
  dataRequirements: string[];
}

/**
 * Per-type entries. Numbers are hypotheses — backtesting will
 * refine which structures actually carry edge.
 */
const ENTRIES: Record<ParlayType, ParlayTypeEntry> = {
  QB_RECEIVER_YARDS: {
    strengthScore: 0.55,
    band: "MODERATE",
    riskNotes: [
      "Same-game QB + alpha WR is already priced by books — raw EV needs to beat the SGP discount.",
      "Yardage-on-yardage stacks are exposed to wider variance than completion-on-reception stacks.",
    ],
    dataRequirements: [
      "Same-game parlay (SGP) pricing for the matchup, not just two straight props.",
    ],
  },
  QB_COMPLETIONS_RECEIVER_RECEPTIONS: {
    strengthScore: 0.65,
    band: "STRONG",
    riskNotes: [
      "Completion / target correlation is robust and easier to reason about than yardage variance.",
      "Books still correlate these — verify raw EV against SGP price when data is available.",
    ],
    dataRequirements: [
      "Target / reception game logs are sufficient for V1.",
    ],
  },
  PASS_VOLUME_STACK: {
    strengthScore: 0.6,
    band: "MODERATE",
    riskNotes: [
      "Attempts → receptions tracks well in expected pass volume, but distribution to a single receiver is noisy.",
      "Quick-game tag would tighten this.",
    ],
    dataRequirements: [
      "Route / alignment tag for the receiver would push this from MODERATE to STRONG.",
    ],
  },
  RB_GAME_SCRIPT_STACK: {
    strengthScore: 0.7,
    band: "STRONG",
    riskNotes: [
      "Same-player attempts + yards is fundamentally a yards-per-carry play — backtest carefully.",
      "Underdog committee backs are a trap; require strong role / favorite posture.",
    ],
    dataRequirements: [
      "Snap share / carry share recent + season baseline (already available).",
    ],
  },
  NEGATIVE_PASSING_STACK: {
    strengthScore: 0.5,
    band: "MODERATE",
    riskNotes: [
      "UNDER stacks survive bad environments well, but need explicit weather / pressure justification.",
    ],
    dataRequirements: [
      "Weather risk + pressure proxy needed to validate the UNDER thesis.",
    ],
  },
  WEATHER_UNDER_STACK: {
    strengthScore: 0.55,
    band: "MODERATE",
    riskNotes: [
      "Books adjust pass-game totals when wind / precip forecast is severe — verify the UNDERs aren't already shaded.",
    ],
    dataRequirements: [
      "Weather snapshot (already in fixtures).",
    ],
  },
  PRESSURE_QUICK_GAME_STACK: {
    strengthScore: 0.55,
    band: "MODERATE",
    riskNotes: [
      "Pressure-induced checkdown rate is QB-specific; a uniform correlation bump overstates the effect for some QBs.",
    ],
    dataRequirements: [
      "Pressure proxy at the QB level + RB target-share recent average.",
    ],
  },
  QB_COMPLETIONS_RB_RECEPTIONS: {
    strengthScore: 0.55,
    band: "MODERATE",
    riskNotes: [
      "Books price RB receptions tighter when checkdown risk is elevated — raw EV needs to beat that.",
    ],
    dataRequirements: [
      "Pressure proxy + RB recent target share.",
    ],
  },
  QB_ATTEMPTS_SHORT_AREA_RECEPTIONS: {
    strengthScore: 0.5,
    band: "EXPLORATORY",
    riskNotes: [
      "Short-area / route tags are not in fixtures yet; without them this collapses to PASS_VOLUME_STACK.",
    ],
    dataRequirements: [
      "Route / alignment data so we can flag short-area receivers.",
    ],
  },
  QB_UNDER_RB_OVER_GAME_SCRIPT: {
    strengthScore: 0.55,
    band: "MODERATE",
    riskNotes: [
      "Requires confidence in the favored-team / low-total game script.",
    ],
    dataRequirements: [
      "Spread / total / projected pass rate (partial in fixtures).",
    ],
  },
  TE_FUNNEL_STACK: {
    strengthScore: 0.45,
    band: "EXPLORATORY",
    riskNotes: [
      "TE-funnel defenses are real but small sample; effect can be noisy week-to-week.",
    ],
    dataRequirements: [
      "Opponent TE EPA / TE-target allowance proxy.",
    ],
  },
  PRESSURE_CHECKDOWN_STACK: {
    strengthScore: 0.55,
    band: "MODERATE",
    riskNotes: [
      "Same as PRESSURE_QUICK_GAME_STACK with the checkdown receiver explicit.",
    ],
    dataRequirements: [
      "Pressure proxy + checkdown-target receiver role.",
    ],
  },
  NON_CORRELATED_EV_PAIR: {
    strengthScore: 0.5,
    band: "MODERATE",
    riskNotes: [
      "Different-game pair — joint hit rate is the pure product. Big payouts hide low joint hit rates.",
      "Use only when both legs are independently strong V1 plays.",
    ],
    dataRequirements: [
      "Independent leg evaluations from the V2 pipeline (already available).",
    ],
  },
  ALT_LINE_CANDIDATE: {
    strengthScore: 0.4,
    band: "RESEARCH_ONLY",
    riskNotes: [
      "Requires alt-line market data we do not have yet.",
    ],
    dataRequirements: [
      "Alt-line tables per market per book.",
    ],
  },
  ANTI_PUBLIC_FADE_STACK: {
    strengthScore: 0.35,
    band: "RESEARCH_ONLY",
    riskNotes: [
      "Requires public betting % data we do not have yet.",
      "Anti-public reads are noisy on small samples.",
    ],
    dataRequirements: [
      "Sportsbook ticket / handle %.",
    ],
  },
  CUSTOM: {
    strengthScore: 0.4,
    band: "EXPLORATORY",
    riskNotes: [
      "Type was auto-classified as CUSTOM — no specific structural support.",
    ],
    dataRequirements: [
      "Tag the parlay with an explicit type to get better risk notes.",
    ],
  },
};

export function scoreParlayTypeStrength(type: ParlayType): number {
  return ENTRIES[type].strengthScore;
}

export function getParlayTypeStrengthBand(
  type: ParlayType,
): ParlayTypeStrengthBand {
  return ENTRIES[type].band;
}

export function getParlayTypeRiskNotes(type: ParlayType): string[] {
  return ENTRIES[type].riskNotes;
}

export function getParlayTypeDataRequirements(type: ParlayType): string[] {
  return ENTRIES[type].dataRequirements;
}

export function buildParlayTypeStrengthBundle(
  type: ParlayType,
): ParlayTypeStrengthBundle {
  const entry = ENTRIES[type];
  return {
    parlayType: type,
    strengthScore: entry.strengthScore,
    band: entry.band,
    riskNotes: entry.riskNotes,
    dataRequirements: entry.dataRequirements,
  };
}
