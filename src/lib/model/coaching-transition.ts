/**
 * Coaching transition framework
 *
 * Models how staff changes (HC / OC / DC, position coaches, play
 * callers) and quarterback transitions degrade our trust in prior-
 * season team and coach tendency data, and how much extra projection
 * uncertainty to carry into the prop model.
 *
 * Mental model
 * ------------
 * Sportsbooks lag at re-pricing tendencies after a coaching change —
 * for the first ~6 weeks they're mostly extrapolating from last year's
 * team rates plus preseason whispers. The model's edge comes from
 * recognising when the team's prior tendencies are no longer
 * predictive AND blending in the new coach's historical fingerprint
 * (if we have one).
 *
 * Per-prop sensitivity
 * --------------------
 * - PASSING_ATTEMPTS:   Most sensitive to OC and offensive play caller
 *                       changes. Pass rate over expectation (PROE) is
 *                       a coach-level signature — Shanahan tree trends
 *                       run-heavy, McVay tree trends pass-heavy. New
 *                       OC means PA projection needs wider σ until
 *                       enough sample (≥ 6 starts) accumulates.
 * - PASSING_COMPLETIONS:Same drivers as PA plus QB-OC chemistry —
 *                       completion rate dips early in new OC's tenure
 *                       even with the same QB while protections and
 *                       audible language reset.
 * - PASSING_YARDS:      Composite of PA + completion% + air-yards
 *                       philosophy. Aggressive vertical OC vs short-
 *                       quick-game OC produces very different PY
 *                       distributions for the same attempts. New HC
 *                       who calls offense flips this almost entirely.
 * - RECEPTIONS:         Target distribution shifts when OC changes,
 *                       but the alpha WR1 usually keeps target share.
 *                       Slot / TE receptions are far more volatile
 *                       under a new OC. WR coach change is a smaller
 *                       but real signal for route concepts.
 * - RECEIVING_YARDS:    Highly scheme-dependent. YAC-heavy systems
 *                       (Shanahan / Reid tree) inflate the high-end
 *                       of the distribution; isolation / pure-route
 *                       systems compress it. Pass game coordinator
 *                       change is a bigger deal here than for REC.
 * - RUSHING_ATTEMPTS:   HC philosophy + run game coordinator drive
 *                       this. New HC who calls offense can swing rush
 *                       share by 5+% in either direction. RB coach
 *                       change matters mostly via committee usage.
 * - RUSHING_YARDS:      OL coach change is the silent killer here —
 *                       blocking scheme transitions (zone ↔ gap)
 *                       compress RB efficiency for 4-6 weeks. Run game
 *                       coordinator change shifts inside vs outside
 *                       carry mix.
 *
 * Outputs
 * -------
 * All scores are 0..1 where 1 = full continuity / maximum trust and 0
 * = total overhaul / no trust. Penalties (uncertainty) are 0..0.40 and
 * are applied as a σ inflator on the prop projection. Trend
 * adjustments are bounded -0.15..+0.15 and shift the projected mean
 * relative to the team-tendency baseline.
 */

export type CoachRole =
  | "HC"
  | "OC"
  | "DC"
  | "OL_COACH"
  | "RB_COACH"
  | "WR_COACH"
  | "QB_COACH"
  | "PASS_GAME_COORDINATOR"
  | "RUN_GAME_COORDINATOR";

export type CoachChangeType =
  | "RETAINED"
  | "INTERNAL_PROMOTION"
  | "NEW_HIRE_FAMILIAR_SYSTEM"
  | "NEW_HIRE_NEW_SYSTEM"
  | "INTERIM";

export interface CoachingContinuityInput {
  headCoachChange: CoachChangeType;
  offensiveCoordinatorChange: CoachChangeType;
  defensiveCoordinatorChange: CoachChangeType;
  offensivePlayCaller: CoachRole;
  offensivePlayCallerChange: CoachChangeType;
  defensivePlayCallerChange: CoachChangeType;
  qbCoachChange: CoachChangeType;
  olCoachChange?: CoachChangeType;
  runGameCoordinatorChange?: CoachChangeType;
  passGameCoordinatorChange?: CoachChangeType;
  wrCoachChange?: CoachChangeType;
  rbCoachChange?: CoachChangeType;
  weeksUnderNewStaff: number;
  preseasonGamesUnderNewStaff: number;
  startingQbChange: boolean;
}

export interface CoachHistoricalTendencyProfile {
  coachName: string;
  role: CoachRole;
  seasonsSampled: number;
  passRateOverExpectation: number;
  rushRateOverExpectation: number;
  pacePlaysPerGameDelta: number;
  redZoneRushRate: number;
  passingAttemptsMultiplier: number;
  passingCompletionsMultiplier: number;
  passingYardsMultiplier: number;
  receptionsMultiplier: number;
  receivingYardsMultiplier: number;
  rushingAttemptsMultiplier: number;
  rushingYardsMultiplier: number;
}

export interface CoachingTransitionScorecard {
  coachingContinuityScore: number;
  offensivePlayCallerChangeScore: number;
  defensivePlayCallerChangeScore: number;
  teamTendencyTrustScore: number;
  offensiveIdentityShiftScore: number;
  defensiveIdentityShiftScore: number;
  playCallerConfidenceScore: number;
  coachTrendAdjustment: number;
  coachingUncertaintyPenalty: number;
  reasons: string[];
  risks: string[];
}

export interface CoachingAdjustmentOutput {
  meanMultiplier: number;
  stdDevMultiplier: number;
  reasons: string[];
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function changeFactor(change: CoachChangeType): number {
  switch (change) {
    case "RETAINED":
      return 1.0;
    case "INTERNAL_PROMOTION":
      return 0.8;
    case "NEW_HIRE_FAMILIAR_SYSTEM":
      return 0.55;
    case "INTERIM":
      return 0.4;
    case "NEW_HIRE_NEW_SYSTEM":
      return 0.25;
  }
}

function changeLabel(change: CoachChangeType): string {
  switch (change) {
    case "RETAINED":
      return "retained";
    case "INTERNAL_PROMOTION":
      return "internally promoted";
    case "NEW_HIRE_FAMILIAR_SYSTEM":
      return "new hire (familiar system)";
    case "INTERIM":
      return "interim";
    case "NEW_HIRE_NEW_SYSTEM":
      return "new hire (new system)";
  }
}

function sampleAdjustment(weeks: number, cap = 0.2): number {
  return clamp(weeks * 0.025, 0, cap);
}

const ROLE_WEIGHTS = {
  HC: 0.25,
  OC: 0.3,
  DC: 0.1,
  OFF_PLAY_CALLER: 0.15,
  DEF_PLAY_CALLER: 0.05,
  QB_COACH: 0.05,
  STARTING_QB: 0.1,
} as const;

export function calculateCoachingContinuityScore(
  input: CoachingContinuityInput,
): number {
  const hc = changeFactor(input.headCoachChange);
  const oc = changeFactor(input.offensiveCoordinatorChange);
  const dc = changeFactor(input.defensiveCoordinatorChange);
  const offCaller = changeFactor(input.offensivePlayCallerChange);
  const defCaller = changeFactor(input.defensivePlayCallerChange);
  const qbCoach = changeFactor(input.qbCoachChange);
  const qbStability = input.startingQbChange ? 0.4 : 1.0;

  const weighted =
    ROLE_WEIGHTS.HC * hc +
    ROLE_WEIGHTS.OC * oc +
    ROLE_WEIGHTS.DC * dc +
    ROLE_WEIGHTS.OFF_PLAY_CALLER * offCaller +
    ROLE_WEIGHTS.DEF_PLAY_CALLER * defCaller +
    ROLE_WEIGHTS.QB_COACH * qbCoach +
    ROLE_WEIGHTS.STARTING_QB * qbStability;

  const sampleBonus = sampleAdjustment(input.weeksUnderNewStaff, 0.15);
  return clamp(weighted + sampleBonus, 0, 1);
}

export function calculateTeamTendencyTrustScore(
  input: CoachingContinuityInput,
): number {
  // Tendency data carries forward most strongly when the OC and the
  // offensive play caller are intact. HC plays a secondary role.
  const oc = changeFactor(input.offensiveCoordinatorChange);
  const hc = changeFactor(input.headCoachChange);
  const playCaller = changeFactor(input.offensivePlayCallerChange);
  const qbFactor = input.startingQbChange ? 0.7 : 1.0;

  const base = 0.55 * oc + 0.25 * hc + 0.2 * playCaller;
  const adjusted = base * qbFactor;
  const sample = sampleAdjustment(input.weeksUnderNewStaff, 0.15);
  return clamp(adjusted + sample, 0, 1);
}

export function blendTeamAndCoachTendencies(
  team: CoachHistoricalTendencyProfile,
  coach: CoachHistoricalTendencyProfile,
  trustScore: number,
): CoachHistoricalTendencyProfile {
  const t = clamp(trustScore, 0, 1);
  const mix = (a: number, b: number) => t * a + (1 - t) * b;
  return {
    coachName: `${team.coachName} ⊕ ${coach.coachName}`,
    role: coach.role,
    seasonsSampled: Math.min(team.seasonsSampled, coach.seasonsSampled),
    passRateOverExpectation: mix(
      team.passRateOverExpectation,
      coach.passRateOverExpectation,
    ),
    rushRateOverExpectation: mix(
      team.rushRateOverExpectation,
      coach.rushRateOverExpectation,
    ),
    pacePlaysPerGameDelta: mix(
      team.pacePlaysPerGameDelta,
      coach.pacePlaysPerGameDelta,
    ),
    redZoneRushRate: mix(team.redZoneRushRate, coach.redZoneRushRate),
    passingAttemptsMultiplier: mix(
      team.passingAttemptsMultiplier,
      coach.passingAttemptsMultiplier,
    ),
    passingCompletionsMultiplier: mix(
      team.passingCompletionsMultiplier,
      coach.passingCompletionsMultiplier,
    ),
    passingYardsMultiplier: mix(
      team.passingYardsMultiplier,
      coach.passingYardsMultiplier,
    ),
    receptionsMultiplier: mix(
      team.receptionsMultiplier,
      coach.receptionsMultiplier,
    ),
    receivingYardsMultiplier: mix(
      team.receivingYardsMultiplier,
      coach.receivingYardsMultiplier,
    ),
    rushingAttemptsMultiplier: mix(
      team.rushingAttemptsMultiplier,
      coach.rushingAttemptsMultiplier,
    ),
    rushingYardsMultiplier: mix(
      team.rushingYardsMultiplier,
      coach.rushingYardsMultiplier,
    ),
  };
}

export function calculateCoachingUncertaintyPenalty(
  input: CoachingContinuityInput,
): number {
  // Penalty represents extra σ to layer onto the per-prop projection.
  // Caps at 0.40 — even the worst case (full staff overhaul + new QB)
  // shouldn't double our σ.
  const hcGap = 1 - changeFactor(input.headCoachChange);
  const ocGap = 1 - changeFactor(input.offensiveCoordinatorChange);
  const dcGap = 1 - changeFactor(input.defensiveCoordinatorChange);
  const offCallerGap = 1 - changeFactor(input.offensivePlayCallerChange);
  const qbCoachGap = 1 - changeFactor(input.qbCoachChange);
  const olGap = input.olCoachChange
    ? 1 - changeFactor(input.olCoachChange)
    : 0;
  const runGameGap = input.runGameCoordinatorChange
    ? 1 - changeFactor(input.runGameCoordinatorChange)
    : 0;
  const passGameGap = input.passGameCoordinatorChange
    ? 1 - changeFactor(input.passGameCoordinatorChange)
    : 0;

  let penalty =
    0.1 * hcGap +
    0.15 * ocGap +
    0.03 * dcGap +
    0.1 * offCallerGap +
    0.03 * qbCoachGap +
    0.05 * olGap +
    0.04 * runGameGap +
    0.04 * passGameGap;

  if (input.startingQbChange) penalty += 0.1;

  // Observing the new staff for several weeks shrinks the penalty but
  // never to zero — installations keep evolving through the year.
  const decay = clamp(1 - input.weeksUnderNewStaff * 0.04, 0.4, 1);
  return clamp(penalty * decay, 0, 0.4);
}

function calculateTrendAdjustment(
  blended: CoachHistoricalTendencyProfile | undefined,
): number {
  if (!blended) return 0;
  // Net offensive volume direction: positive = trend favors more
  // offensive opportunities for skill players (faster pace + higher
  // pass rate); negative = run-heavy / slower-pace lean.
  const paceComponent = blended.pacePlaysPerGameDelta / 80; // -0.1..+0.1
  const passComponent = blended.passRateOverExpectation / 2; // -0.05..+0.05
  return clamp(paceComponent + passComponent, -0.15, 0.15);
}

export function buildCoachingTransitionScorecard(
  input: CoachingContinuityInput,
  coach?: CoachHistoricalTendencyProfile,
  team?: CoachHistoricalTendencyProfile,
): CoachingTransitionScorecard {
  const continuity = calculateCoachingContinuityScore(input);
  const offPlayCaller = changeFactor(input.offensivePlayCallerChange);
  const defPlayCaller = changeFactor(input.defensivePlayCallerChange);
  const teamTendencyTrust = calculateTeamTendencyTrustScore(input);
  const offIdentity =
    0.55 * changeFactor(input.offensiveCoordinatorChange) +
    0.45 * offPlayCaller;
  const defIdentity =
    0.55 * changeFactor(input.defensiveCoordinatorChange) +
    0.45 * defPlayCaller;
  const qbFactor = input.startingQbChange ? 0.7 : 1.0;
  const playCallerConfidence = clamp(offPlayCaller * qbFactor, 0, 1);
  const uncertaintyPenalty = calculateCoachingUncertaintyPenalty(input);

  const blended =
    coach && team
      ? blendTeamAndCoachTendencies(team, coach, teamTendencyTrust)
      : (coach ?? team);
  const trendAdjustment = calculateTrendAdjustment(blended);

  const reasons: string[] = [];
  const risks: string[] = [];

  if (input.headCoachChange !== "RETAINED") {
    risks.push(
      `Head coach ${changeLabel(input.headCoachChange)} — team identity in transition`,
    );
  } else {
    reasons.push("Head coach retained — team identity stable");
  }
  if (input.offensiveCoordinatorChange !== "RETAINED") {
    risks.push(
      `Offensive coordinator ${changeLabel(input.offensiveCoordinatorChange)} — pass / run rate may diverge from last season`,
    );
  } else {
    reasons.push("Offensive coordinator retained — pass / run tendencies trustworthy");
  }
  if (input.defensiveCoordinatorChange !== "RETAINED") {
    risks.push(
      `Defensive coordinator ${changeLabel(input.defensiveCoordinatorChange)} — opponent game-script projections noisier`,
    );
  }
  if (input.offensivePlayCallerChange !== "RETAINED") {
    risks.push(
      `Offensive play caller ${changeLabel(input.offensivePlayCallerChange)} — situational play selection uncertain`,
    );
  }
  if (input.olCoachChange && input.olCoachChange !== "RETAINED") {
    risks.push(
      `OL coach ${changeLabel(input.olCoachChange)} — rushing efficiency at risk during scheme transition`,
    );
  }
  if (input.runGameCoordinatorChange && input.runGameCoordinatorChange !== "RETAINED") {
    risks.push(
      `Run game coordinator ${changeLabel(input.runGameCoordinatorChange)} — rushing carry distribution may shift`,
    );
  }
  if (input.passGameCoordinatorChange && input.passGameCoordinatorChange !== "RETAINED") {
    risks.push(
      `Pass game coordinator ${changeLabel(input.passGameCoordinatorChange)} — target tree and route concepts in flux`,
    );
  }
  if (input.startingQbChange) {
    risks.push("Starting quarterback change — passing tendencies likely to swing");
  }
  if (input.weeksUnderNewStaff >= 6) {
    reasons.push(
      `${input.weeksUnderNewStaff} weeks of in-season data with new staff — sample is meaningful`,
    );
  } else if (input.weeksUnderNewStaff > 0) {
    risks.push(
      `Only ${input.weeksUnderNewStaff} week${input.weeksUnderNewStaff === 1 ? "" : "s"} of in-season data with new staff — small sample`,
    );
  }

  return {
    coachingContinuityScore: continuity,
    offensivePlayCallerChangeScore: offPlayCaller,
    defensivePlayCallerChangeScore: defPlayCaller,
    teamTendencyTrustScore: teamTendencyTrust,
    offensiveIdentityShiftScore: offIdentity,
    defensiveIdentityShiftScore: defIdentity,
    playCallerConfidenceScore: playCallerConfidence,
    coachTrendAdjustment: trendAdjustment,
    coachingUncertaintyPenalty: uncertaintyPenalty,
    reasons,
    risks,
  };
}

/**
 * Per-prop adjustment derived from a coaching transition scorecard.
 * Returns multipliers the projection layer can apply to a baseline
 * mean / σ. Mean multiplier defaults to 1.0 when no coach profile is
 * present (we only inflate uncertainty, not bias).
 */
export function applyCoachingAdjustmentToProp(
  propType: import("../types").PropType,
  scorecard: CoachingTransitionScorecard,
  coach?: CoachHistoricalTendencyProfile,
): CoachingAdjustmentOutput {
  const stdDevMultiplier = 1 + scorecard.coachingUncertaintyPenalty;
  let meanMultiplier = 1;
  const reasons: string[] = [];

  if (coach) {
    switch (propType) {
      case "PASSING_ATTEMPTS":
        meanMultiplier = coach.passingAttemptsMultiplier;
        break;
      case "PASSING_COMPLETIONS":
        meanMultiplier = coach.passingCompletionsMultiplier;
        break;
      case "PASSING_YARDS":
        meanMultiplier = coach.passingYardsMultiplier;
        break;
      case "RECEPTIONS":
        meanMultiplier = coach.receptionsMultiplier;
        break;
      case "RECEIVING_YARDS":
        meanMultiplier = coach.receivingYardsMultiplier;
        break;
      case "RUSHING_ATTEMPTS":
        meanMultiplier = coach.rushingAttemptsMultiplier;
        break;
      case "RUSHING_YARDS":
        meanMultiplier = coach.rushingYardsMultiplier;
        break;
    }
    // Blend the coach multiplier with the trust score: low trust =
    // keep multiplier closer to 1.0.
    const trust = scorecard.teamTendencyTrustScore;
    meanMultiplier = 1 + (meanMultiplier - 1) * (1 - trust);
    reasons.push(
      `Applied ${(meanMultiplier * 100 - 100).toFixed(1)}% coach-trend mean shift for ${propType}`,
    );
  }

  if (scorecard.coachingUncertaintyPenalty > 0.05) {
    reasons.push(
      `Inflated σ by ${(scorecard.coachingUncertaintyPenalty * 100).toFixed(0)}% for coaching uncertainty`,
    );
  }

  return { meanMultiplier, stdDevMultiplier, reasons };
}

// ---------------------------------------------------------------------
// Mock coaching transition examples for the demo / synthetic suite
// ---------------------------------------------------------------------

/** 1. Same staff, third year together. Highest possible continuity. */
export const SAMPLE_SAME_STAFF: CoachingContinuityInput = {
  headCoachChange: "RETAINED",
  offensiveCoordinatorChange: "RETAINED",
  defensiveCoordinatorChange: "RETAINED",
  offensivePlayCaller: "OC",
  offensivePlayCallerChange: "RETAINED",
  defensivePlayCallerChange: "RETAINED",
  qbCoachChange: "RETAINED",
  olCoachChange: "RETAINED",
  runGameCoordinatorChange: "RETAINED",
  passGameCoordinatorChange: "RETAINED",
  weeksUnderNewStaff: 0,
  preseasonGamesUnderNewStaff: 0,
  startingQbChange: false,
};

/** 2. New OC but same HC and QB. Identity continuity, scheme tweak. */
export const SAMPLE_NEW_OC_SAME_HC: CoachingContinuityInput = {
  headCoachChange: "RETAINED",
  offensiveCoordinatorChange: "NEW_HIRE_FAMILIAR_SYSTEM",
  defensiveCoordinatorChange: "RETAINED",
  offensivePlayCaller: "OC",
  offensivePlayCallerChange: "NEW_HIRE_FAMILIAR_SYSTEM",
  defensivePlayCallerChange: "RETAINED",
  qbCoachChange: "RETAINED",
  olCoachChange: "RETAINED",
  runGameCoordinatorChange: "RETAINED",
  passGameCoordinatorChange: "INTERNAL_PROMOTION",
  weeksUnderNewStaff: 5,
  preseasonGamesUnderNewStaff: 3,
  startingQbChange: false,
};

/** 3. New HC who calls the offense himself — full identity reset. */
export const SAMPLE_NEW_HC_CALLS_OFFENSE: CoachingContinuityInput = {
  headCoachChange: "NEW_HIRE_NEW_SYSTEM",
  offensiveCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  defensiveCoordinatorChange: "NEW_HIRE_FAMILIAR_SYSTEM",
  offensivePlayCaller: "HC",
  offensivePlayCallerChange: "NEW_HIRE_NEW_SYSTEM",
  defensivePlayCallerChange: "NEW_HIRE_FAMILIAR_SYSTEM",
  qbCoachChange: "NEW_HIRE_FAMILIAR_SYSTEM",
  olCoachChange: "NEW_HIRE_NEW_SYSTEM",
  runGameCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  passGameCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  weeksUnderNewStaff: 4,
  preseasonGamesUnderNewStaff: 3,
  startingQbChange: false,
};

/** 4. New HC + new OC + new starting QB. Maximum projection chaos. */
export const SAMPLE_NEW_HC_OC_QB: CoachingContinuityInput = {
  headCoachChange: "NEW_HIRE_NEW_SYSTEM",
  offensiveCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  defensiveCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  offensivePlayCaller: "OC",
  offensivePlayCallerChange: "NEW_HIRE_NEW_SYSTEM",
  defensivePlayCallerChange: "NEW_HIRE_NEW_SYSTEM",
  qbCoachChange: "NEW_HIRE_NEW_SYSTEM",
  olCoachChange: "NEW_HIRE_NEW_SYSTEM",
  runGameCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  passGameCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  weeksUnderNewStaff: 3,
  preseasonGamesUnderNewStaff: 3,
  startingQbChange: true,
};

/** 5. New DC with major scheme overhaul (3-4 → 4-3 / man → zone). */
export const SAMPLE_NEW_DC_IDENTITY_SHIFT: CoachingContinuityInput = {
  headCoachChange: "RETAINED",
  offensiveCoordinatorChange: "RETAINED",
  defensiveCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  offensivePlayCaller: "OC",
  offensivePlayCallerChange: "RETAINED",
  defensivePlayCallerChange: "NEW_HIRE_NEW_SYSTEM",
  qbCoachChange: "RETAINED",
  olCoachChange: "RETAINED",
  runGameCoordinatorChange: "RETAINED",
  passGameCoordinatorChange: "RETAINED",
  weeksUnderNewStaff: 6,
  preseasonGamesUnderNewStaff: 3,
  startingQbChange: false,
};

/** 6. New OL coach + new run game coordinator. Hits rushing props. */
export const SAMPLE_NEW_OL_COACH_RUN_GAME: CoachingContinuityInput = {
  headCoachChange: "RETAINED",
  offensiveCoordinatorChange: "RETAINED",
  defensiveCoordinatorChange: "RETAINED",
  offensivePlayCaller: "OC",
  offensivePlayCallerChange: "RETAINED",
  defensivePlayCallerChange: "RETAINED",
  qbCoachChange: "RETAINED",
  olCoachChange: "NEW_HIRE_NEW_SYSTEM",
  runGameCoordinatorChange: "NEW_HIRE_NEW_SYSTEM",
  passGameCoordinatorChange: "RETAINED",
  weeksUnderNewStaff: 4,
  preseasonGamesUnderNewStaff: 3,
  startingQbChange: false,
};

export const COACHING_TRANSITION_SAMPLES = {
  sameStaff: SAMPLE_SAME_STAFF,
  newOcSameHc: SAMPLE_NEW_OC_SAME_HC,
  newHcCallsOffense: SAMPLE_NEW_HC_CALLS_OFFENSE,
  newHcOcQb: SAMPLE_NEW_HC_OC_QB,
  newDcIdentityShift: SAMPLE_NEW_DC_IDENTITY_SHIFT,
  newOlCoachRunGame: SAMPLE_NEW_OL_COACH_RUN_GAME,
} as const;
