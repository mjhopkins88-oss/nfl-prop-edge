/**
 * Matchup intelligence types.
 *
 * Static, code-first football-knowledge layer. The framework is
 * intentionally OPTIONAL and SUPPLEMENTAL to the scorecard. It
 * cannot, by itself, qualify a non-qualifying bet — see
 * `matchup-intelligence.ts` for the integration contract.
 */

import type { PropType } from "../types";

export type ImpactLabel =
  | "STRONG_POSITIVE"
  | "POSITIVE"
  | "NEUTRAL"
  | "NEGATIVE"
  | "STRONG_NEGATIVE"
  | "UNCERTAIN";

export type DefensiveArchetypeKey =
  | "PASS_FUNNEL_ZONE"
  | "RUN_FUNNEL_LIGHT_BOX"
  | "TWO_HIGH_DEEP_SUPPRESSION"
  | "PRESSURE_WITH_FOUR"
  | "BLITZ_HEAVY"
  | "MAN_HEAVY"
  | "ZONE_HEAVY_UNDERNEATH"
  | "STRONG_RUN_DEFENSE"
  | "WEAK_SECONDARY_EXPLOSIVE"
  | "BALANCED_NEUTRAL";

export type PlayerRoleArchetypeKey =
  | "SLOT_VOLUME_WR"
  | "OUTSIDE_DEEP_WR"
  | "POSSESSION_WR"
  | "RECEIVING_TE"
  | "BLOCKING_TE"
  | "RECEIVING_RB"
  | "EARLY_DOWN_RB"
  | "BELL_COW_RB"
  | "MOBILE_QB"
  | "POCKET_QB";

export type WeatherArchetypeKey =
  | "DOME_NEUTRAL"
  | "WINDY_OUTDOOR"
  | "COLD_WINDY"
  | "RAINY"
  | "EXTREME_WEATHER"
  | "WARM_FAST_TRACK";

export type MatchupArchetype =
  | DefensiveArchetypeKey
  | PlayerRoleArchetypeKey
  | WeatherArchetypeKey;

export interface DefensiveFunnelProfile {
  passFunnel: number;
  runFunnel: number;
  slotFunnel: number;
  teFunnel: number;
  rbReceivingFunnel: number;
  deepPassSuppression: number;
  lightBoxTendency: number;
  stackedBoxTendency: number;
}

export interface CoverageProfile {
  manRate: number;
  zoneRate: number;
  twoHighRate: number;
  singleHighRate: number;
  quartersMatchRate: number;
  blitzRate: number;
  pressureWithoutBlitzRate: number;
}

export interface PressureProfile {
  defensePressureRate: number;
  defensePressureWithoutBlitzRate: number;
  offensePressureAllowedRate: number;
  oLineContinuityRisk: number;
  qbPressureSensitivity: number;
  qbPressureToSackRate: number;
  quickGameOutletBoost: number;
}

export interface ReceiverRoleProfile {
  archetype: PlayerRoleArchetypeKey;
  separatorRating: number;
  deepThreatRating: number;
  shortAreaRating: number;
}

export interface RunGameMatchupProfile {
  offenseRunTendency: number;
  rushingAttemptStability: number;
  rbCarryShareStability: number;
  defenseLightBoxRate: number;
  defenseRunSuccessAllowed: number;
  gameScriptRushingSupport: number;
  weatherRushingSupport: number;
  qbRushingCannibalization: number;
}

export interface WeatherStyleProfile {
  archetype: WeatherArchetypeKey;
  isDome: boolean;
  windMph: number;
  precipitationMm: number;
  snowfallCm: number;
  temperatureF: number;
}

export interface MatchupIntelligenceInput {
  propType: PropType;
  playerRole: ReceiverRoleProfile;
  defensiveArchetype: DefensiveArchetypeKey;
  defensiveFunnel: DefensiveFunnelProfile;
  coverage: CoverageProfile;
  pressure: PressureProfile;
  runGame: RunGameMatchupProfile;
  weather: WeatherStyleProfile;
  /** Pulled from the scorecard's risk scores. */
  dataQualityScore: number;
  roleStabilityScore: number;
  /** Positive = team likely leading; -1..+1. */
  gameScript: number;
  /** Team spread; negative = favorite. */
  spreadFavor: number;
}

export type PropImpactMap = Record<PropType, ImpactLabel>;

export interface MatchupAdjustmentOutput {
  /**
   * Suggested mean shift. Reported for transparency only — the
   * scorecard does NOT apply this to its qualification math (would
   * violate "matchup should not force bets"). UI / explanation layer
   * can display it.
   */
  projectedMeanMultiplier: number;
  /**
   * σ widening multiplier; >= 1.0. The scorecard *does* apply this to
   * its projection σ, so strong matchup negatives can push a thin
   * edge below threshold but cannot push a thin edge over it.
   */
  projectedStdDevMultiplier: number;
  /** -0.2..+0.05 — applied to scorecard confidence. */
  confidenceAdjustment: number;
  /** -0.10..+0.05 — applied to data-quality score (capped low). */
  dataQualityAdjustment: number;
  /** 0..+0.30 — added to risk score on the scorecard side. */
  riskAdjustment: number;
  reasons: string[];
  risks: string[];
  propImpacts: PropImpactMap;
  matchupTags: string[];
}

export interface MatchupScorecardComponent {
  defensiveArchetype: DefensiveArchetypeKey;
  playerRole: PlayerRoleArchetypeKey;
  weatherArchetype: WeatherArchetypeKey;
  /** Reported mean shift, σ widening, etc. */
  projectedMeanMultiplier: number;
  projectedStdDevMultiplier: number;
  confidenceAdjustment: number;
  propImpacts: PropImpactMap;
  reasons: string[];
  risks: string[];
  matchupTags: string[];
  summary: string;
}
