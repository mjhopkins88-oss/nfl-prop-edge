/**
 * Experimental Correlated Parlay Model — types.
 *
 * SEPARATE from the player prop scorecard and the Game Edge model.
 * Lives at /parlays. Does NOT feed back into player prop or
 * game-edge recommendations. Does NOT place bets.
 *
 * V1 scope: 2-leg parlays of V1 player prop markets only. 3-leg
 * parlays are scaffolded but gated behind explicit opt-in.
 */

import type { PropType } from "../types";

export type ParlayLegSide = "OVER" | "UNDER";

export type ParlayType =
  | "QB_RECEIVER_YARDS"
  | "QB_COMPLETIONS_RECEIVER_RECEPTIONS"
  | "PASS_VOLUME_STACK"
  | "RB_GAME_SCRIPT_STACK"
  | "NEGATIVE_PASSING_STACK"
  | "WEATHER_UNDER_STACK"
  | "PRESSURE_QUICK_GAME_STACK"
  | "CUSTOM";

export type CorrelationType =
  | "POSITIVE"
  | "NEGATIVE"
  | "WEAK"
  | "CONFLICTING"
  | "UNKNOWN";

export type ParlayRecommendation =
  | "STRONG_PARLAY_VALUE"
  | "PLAYABLE_PARLAY_VALUE"
  | "CORRELATED_WATCH"
  | "PASS_LOW_EV"
  | "PASS_TOO_MUCH_RISK"
  | "PASS_BAD_CORRELATION"
  | "PASS_LEG_NOT_QUALIFIED"
  | "PASS_TOO_FRAGILE";

export type ParlayPlayerRole =
  | "QB"
  | "RB_BELLCOW"
  | "RB_COMMITTEE"
  | "WR_ALPHA"
  | "WR_SECONDARY"
  | "WR_SLOT"
  | "WR_DEEP"
  | "TE";

export interface ParlayLeg {
  id: string;
  playerName: string;
  team: string;
  opponent: string;
  gameId: string;
  propType: PropType;
  side: ParlayLegSide;
  line: number;
  odds: number;
  /** 0..1 — implied probability of the chosen side from the book. */
  marketProbability: number;
  /** 0..1 — modelled probability of the chosen side. */
  modelProbability: number;
  /** modelProbability − no-vig market, in probability points. */
  rawEdge: number;
  /** rawEdge after confidence shrinkage. */
  confidenceAdjustedEdge: number;
  /** 0..1 — model confidence in this leg. */
  confidence: number;
  /** 0..1 — composite risk score (1 = clean). */
  riskScore: number;
  /** 0..1 — leg data quality. */
  dataQualityScore: number;
  /** OVER / UNDER / PASS recommendation from the leg's own model. */
  recommendation: "OVER" | "UNDER" | "PASS";
  qualified: boolean;
  primaryDisqualifier?: string;
  /** Player role hint, used by correlation classification. */
  playerRole?: ParlayPlayerRole;
  /**
   * Game environment context. Optional — used by correlation +
   * weather-stack logic when present.
   */
  weatherRiskScore?: number;
  pressureRiskScore?: number;
  /** Projected team plays (volume hint). */
  projectedTeamPlays?: number;
  /** Projected team pass rate. */
  projectedPassRate?: number;
  /** Is the team favored / projected to lead this game? */
  favoritePosture?: "FAVORITE" | "UNDERDOG" | "TOSSUP";
  /** Per-leg line fragility from the v2 pipeline if available (0..1, higher = more fragile). */
  lineFragilityScore?: number;
  reasons: string[];
  risks: string[];
}

export interface ParlayCorrelationResult {
  /** -1..+1 — signed correlation magnitude. */
  correlationScore: number;
  correlationType: CorrelationType;
  /** Human-readable explanation of why this correlation exists / fails. */
  correlationExplanation: string;
  /** Used by ev module + ranking. */
  overstackingRisk: boolean;
  conflictingScript: boolean;
  /** Same gameId for every leg? */
  sameGame: boolean;
}

export interface ParlayProbabilityResult {
  independentJointProbability: number;
  correlationAdjustedJointProbability: number;
  /** Implied joint probability from the parlay's combined no-vig odds. */
  marketJointProbability: number;
  /** Decimal form of combined odds (used for EV). */
  combinedOddsDecimal: number;
  /** American form of combined odds (display). */
  combinedOddsAmerican: number;
  /** total payout multiplier = combinedOddsDecimal. */
  payoutMultiplier: number;
  /** Hit rate the parlay needs to clear at the given payout to break even. */
  breakEvenHitRate: number;
}

export interface ParlayEvaluation {
  /** Raw EV = correlationAdjustedJointProbability × decimalOdds − 1. */
  expectedValue: number;
  /** EV after confidence / risk shrinkage. */
  confidenceAdjustedExpectedValue: number;
  /** Edge vs no-vig market joint probability (percentage points). */
  parlayEdge: number;
  /** Required hit rate for a 10% ROI batch at this parlay's payout. */
  requiredHitRate: number;
  /** Projected hit rate of this parlay (= correlationAdjustedJointProbability). */
  projectedHitRate: number;
}

export interface ParlayCandidate {
  id: string;
  legs: ParlayLeg[];
  parlayType: ParlayType;
  /** Game ids represented; size 1 for same-game parlays, ≥2 otherwise. */
  gameIds: string[];
  /** Display teams (size depends on legs / games). */
  teams: string[];
  legCount: number;
  /** Convenience copies of the probability + EV outputs. */
  combinedOddsAmerican: number;
  combinedOddsDecimal: number;
  independentJointProbability: number;
  correlationAdjustedJointProbability: number;
  marketJointProbability: number;
  parlayEdge: number;
  expectedValue: number;
  confidenceAdjustedExpectedValue: number;
  correlationScore: number;
  correlationType: CorrelationType;
  correlationExplanation: string;
  /** 0..1 (1 = clean). */
  riskScore: number;
  /** 0..1 (1 = best). */
  dataQualityScore: number;
  payoutMultiplier: number;
  requiredHitRate: number;
  projectedHitRate: number;
  recommendation: ParlayRecommendation;
  qualified: boolean;
  primaryDisqualifier?: string;
  disqualifiers: string[];
  reasons: string[];
  risks: string[];
  scorecard: ParlayScorecard;
}

export interface ParlayScorecard {
  parlayId: string;
  parlayType: ParlayType;
  recommendation: ParlayRecommendation;
  qualified: boolean;
  legSummaries: Array<{
    playerName: string;
    propType: PropType;
    side: ParlayLegSide;
    line: number;
    odds: number;
    legEdgePp: number;
    legConfidenceAdjustedEdgePp: number;
    confidence: number;
    qualified: boolean;
    primaryDisqualifier?: string;
    reasons: string[];
    risks: string[];
  }>;
  combinedOddsAmerican: number;
  combinedOddsDecimal: number;
  independentJointProbability: number;
  correlationAdjustedJointProbability: number;
  marketJointProbability: number;
  requiredHitRate: number;
  projectedHitRate: number;
  expectedValue: number;
  confidenceAdjustedExpectedValue: number;
  payoutMultiplier: number;
  correlationScore: number;
  correlationType: CorrelationType;
  correlationExplanation: string;
  riskScore: number;
  dataQualityScore: number;
  reasons: string[];
  risks: string[];
  disqualifiers: string[];
  finalExplanation: string;
}

/**
 * Reserved backtest row shape — defined now so backtesting can land
 * later without a schema change. Not yet consumed.
 */
export interface ParlayBacktestResult {
  parlayId: string;
  season: number;
  week: number;
  /** Same game for same-game parlays, otherwise an array. */
  gameIds: string[];
  legs: Array<{
    legId: string;
    propType: PropType;
    side: ParlayLegSide;
    line: number;
    odds: number;
    actualValue: number | null;
    hit: boolean | null;
  }>;
  combinedOddsAmerican: number;
  combinedOddsDecimal: number;
  projectedHitRate: number;
  requiredHitRate: number;
  expectedValue: number;
  confidenceAdjustedExpectedValue: number;
  recommendation: ParlayRecommendation;
  qualified: boolean;
  allLegsHit: boolean | null;
  profitLossUnits: number | null;
  result: "WIN" | "LOSS" | "PUSH" | "NO_RESULT";
  correlationType: CorrelationType;
  parlayType: ParlayType;
}
