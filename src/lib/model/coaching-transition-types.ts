import type { PropType } from "../types";

export type CoachingSourceConfidence = "HIGH" | "MEDIUM" | "LOW";

export type SeasonPhase = "WEEKS_1_4" | "WEEKS_5_8" | "WEEKS_9_PLUS";

export type BlendProfileKey =
  | "high_continuity"
  | "new_oc_same_hc"
  | "new_hc_new_oc"
  | "new_hc_new_oc_unstable_qb";

export interface BlendWeights {
  priorTeam: number;
  coachProfile: number;
  leagueAverage: number;
  currentSeasonObserved: number;
}

export interface CoachingScoreSet {
  coachingContinuityScore: number;
  offensivePlayCallerChangeScore: number;
  defensivePlayCallerChangeScore: number;
  teamTendencyTrustScore: number;
  offensiveIdentityShiftScore: number;
  defensiveIdentityShiftScore: number;
  playCallerConfidenceScore: number;
  coachingUncertaintyPenalty: number;
}

export type PropImpactMap = Record<PropType, string>;

export interface TeamCoachingTransition {
  team: string;
  season: number;
  blendProfile: BlendProfileKey;
  scores: CoachingScoreSet;
  notes: string[];
  offenseDeltas: string[];
  defenseDeltas: string[];
  propImpacts: PropImpactMap;
  sourceConfidence: CoachingSourceConfidence;
  assumptionNotes: string[];
  lastVerified: string;
  appliesToWeeks: string;
}

export interface CoachTendencyProfile {
  key: string;
  description: string;
  signatureNotes: string[];
}

export interface CoachingTransitionScorecard {
  team: string;
  season: number;
  scores: CoachingScoreSet;
  blendWeights: BlendWeights;
  offensiveNotes: string[];
  defensiveNotes: string[];
  propImpacts: PropImpactMap;
  warnings: string[];
  summary: string;
}
