/**
 * Coaching transition framework — 2026 edition.
 *
 * Static, code-first knowledge layer for NFL coaching/play-calling
 * changes. The framework intentionally does NOT directly force OVER
 * or UNDER recommendations. It supplies four levers that the main
 * model scorecard can optionally apply:
 *
 *   1. Trust adjustment for prior-year team tendencies
 *      (lower `teamTendencyTrustScore` → less weight on last year's
 *       team rates).
 *   2. A projection-blending layer
 *      (`getBlendWeights` returns priorTeam / coachProfile /
 *       leagueAverage / currentSeasonObserved weights that the
 *       projection step should respect when forming the mean).
 *   3. An uncertainty penalty
 *      (`coachingUncertaintyPenalty` 0..100; high values mean wider
 *       projection σ or higher required edge).
 *   4. A possible edge-threshold bump
 *      (`edgeThresholdBumpFromPenalty` returns percentage points to
 *       add to the qualifier's threshold).
 *
 * Per-prop sensitivity (V1 lower-variance markets only):
 *
 *   PASSING_ATTEMPTS    most sensitive to OC + offensive play-caller
 *                       changes; pass-rate-over-expectation is a
 *                       coach-level signature.
 *   PASSING_COMPLETIONS same drivers as PA plus QB-OC chemistry; new
 *                       OC dips completion% even with the same QB.
 *   PASSING_YARDS       composite of PA × completion% × air-yards
 *                       philosophy; new HC who calls plays flips
 *                       this nearly entirely.
 *   RECEPTIONS          target distribution shifts with new OC, but
 *                       WR1 usually keeps target share; slot / TE
 *                       receptions move most under new offense.
 *   RECEIVING_YARDS     scheme-dependent (YAC vs vertical); pass
 *                       game coordinator change matters more here
 *                       than for raw receptions.
 *   RUSHING_ATTEMPTS    HC philosophy + run game coordinator drive
 *                       this; RB coach change matters via committee
 *                       splits.
 *   RUSHING_YARDS       OL coach change is the silent killer —
 *                       blocking scheme transitions compress RB
 *                       efficiency for 4-6 weeks.
 *
 * The coaching layer should support, never overrule, the scorecard's
 * decision. A coaching note alone cannot qualify a bet.
 */

import type {
  BlendWeights,
  CoachingTransitionScorecard,
  SeasonPhase,
  TeamCoachingTransition,
} from "./coaching-transition-types";
import { BLEND_PROFILES } from "./coaching-transition-data";

export type {
  BlendProfileKey,
  BlendWeights,
  CoachTendencyProfile,
  CoachingScoreSet,
  CoachingSourceConfidence,
  CoachingTransitionScorecard,
  PropImpactMap,
  SeasonPhase,
  TeamCoachingTransition,
} from "./coaching-transition-types";

export function getSeasonPhase(week: number): SeasonPhase {
  if (week >= 9) return "WEEKS_9_PLUS";
  if (week >= 5) return "WEEKS_5_8";
  return "WEEKS_1_4";
}

const PLAY_CALLER_CONFIDENCE_FLOOR = 70;

export function getBlendWeights(
  record: TeamCoachingTransition,
  week: number,
): BlendWeights {
  const phase = getSeasonPhase(week);
  const base = BLEND_PROFILES[record.blendProfile][phase];
  const playCallerConfidence = record.scores.playCallerConfidenceScore;

  if (playCallerConfidence >= PLAY_CALLER_CONFIDENCE_FLOOR) {
    return { ...base };
  }
  // Cap coach-history weight to confidence; redistribute the leftover
  // 50/50 to league average and current-season observed (observed
  // is zero in WEEKS_1_4 — that's intentional, leagueAverage absorbs
  // the early-season share).
  const cap = Math.max(0, playCallerConfidence / 100);
  const cappedCoach = base.coachProfile * cap;
  const leftover = base.coachProfile - cappedCoach;
  return {
    priorTeam: base.priorTeam,
    coachProfile: cappedCoach,
    leagueAverage: base.leagueAverage + leftover / 2,
    currentSeasonObserved: base.currentSeasonObserved + leftover / 2,
  };
}

export function edgeThresholdBumpFromPenalty(penalty: number): number {
  if (penalty >= 75) return 2.0;
  if (penalty >= 60) return 1.5;
  if (penalty >= 40) return 1.0;
  if (penalty >= 20) return 0.5;
  return 0;
}

export interface ShouldPassDueToCoachingArgs {
  rawEdgePct: number;
  baseThresholdPct: number;
  coachingUncertaintyPenalty: number;
}

export function shouldPassDueToCoachingUncertainty(
  args: ShouldPassDueToCoachingArgs,
): boolean {
  const bump = edgeThresholdBumpFromPenalty(args.coachingUncertaintyPenalty);
  return args.rawEdgePct < args.baseThresholdPct + bump;
}

function phaseLabel(phase: SeasonPhase): string {
  if (phase === "WEEKS_1_4") return "Weeks 1-4";
  if (phase === "WEEKS_5_8") return "Weeks 5-8";
  return "Week 9+";
}

function dominantBlendSource(w: BlendWeights): string {
  const entries: Array<[string, number]> = [
    ["prior-year team", w.priorTeam],
    ["coach archetype", w.coachProfile],
    ["league average", w.leagueAverage],
    ["current-season observed", w.currentSeasonObserved],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function buildCoachingTransitionScorecard(
  record: TeamCoachingTransition,
  week: number,
): CoachingTransitionScorecard {
  const blendWeights = getBlendWeights(record, week);
  const phase = getSeasonPhase(week);
  const warnings: string[] = [];

  if (record.scores.coachingUncertaintyPenalty >= 60) {
    warnings.push(
      `High coaching uncertainty (penalty ${record.scores.coachingUncertaintyPenalty}); raise edge threshold by ${edgeThresholdBumpFromPenalty(record.scores.coachingUncertaintyPenalty)} pp`,
    );
  }
  if (record.scores.playCallerConfidenceScore < PLAY_CALLER_CONFIDENCE_FLOOR) {
    warnings.push(
      `Low play-caller confidence (${record.scores.playCallerConfidenceScore}) — capped coach-history weight in blend`,
    );
  }
  if (record.scores.coachingContinuityScore < 35) {
    warnings.push(
      `Major coaching reset (continuity ${record.scores.coachingContinuityScore}) — prior-year team tendencies have low trust`,
    );
  }
  if (record.scores.coachingUncertaintyPenalty < 20) {
    warnings.length === 0 &&
      warnings.push("Low coaching uncertainty — context informational only");
  }

  const dominant = dominantBlendSource(blendWeights);
  const topSummary = record.assumptionNotes[0] ?? record.notes[0] ?? "";
  const summary = `${record.team} ${record.season} (${phaseLabel(phase)}): blend favors ${dominant} (${Math.max(blendWeights.priorTeam, blendWeights.coachProfile, blendWeights.leagueAverage, blendWeights.currentSeasonObserved)}%). Continuity ${record.scores.coachingContinuityScore}, uncertainty penalty ${record.scores.coachingUncertaintyPenalty}. ${topSummary}`.trim();

  return {
    team: record.team,
    season: record.season,
    scores: record.scores,
    blendWeights,
    offensiveNotes: record.offenseDeltas,
    defensiveNotes: record.defenseDeltas,
    propImpacts: record.propImpacts,
    warnings,
    summary,
  };
}
