/**
 * Feature scoring — turns raw `*Inputs` bags into the UI-facing
 * `FeatureGroupResult` (score 0-100, impact label, explanation) for
 * each of the seven feature groups, plus the prop-level rollups
 * (data quality, risk score) and the qualification gate that consumes
 * them.
 *
 * V1 keeps the math simple. The goal here is structure — clean inputs
 * → outputs so the UI, mock data, and backtest foundation can all
 * agree on the shape. Each calculator is independent and pure so a
 * V2 swap (real signals replacing the mostly-null inputs) doesn't
 * change any call site.
 */

import type { PropType, Recommendation } from "../types";
import {
  type FeatureBadge,
  type FeatureGroupResult,
  type FeatureImpact,
  type PropFeatureSet,
  type RoleStabilityInputs,
  type GameScriptInputs,
  type PaceInputs,
  type MarketContextInputs,
  type WeatherInputs,
  type InjuryContextInputs,
  type CorrelationExposureInputs,
} from "./feature-framework";

// --- thresholds & constants ------------------------------------------

/** Edge thresholds by prop type — kept in sync with probability-engine. */
export const EDGE_THRESHOLDS: Record<PropType, number> = {
  PASSING_ATTEMPTS: 0.04,
  PASSING_COMPLETIONS: 0.04,
  RECEPTIONS: 0.05,
  RUSHING_ATTEMPTS: 0.05,
  PASSING_YARDS: 0.06,
  RUSHING_YARDS: 0.06,
  RECEIVING_YARDS: 0.07,
};

/** Feature score floors below which a prop is forced to PASS. */
export const QUALIFICATION_FLOORS = {
  roleStability: 40,
  injuryContext: 30,
  weatherEnvironment: 30,
  correlationExposure: 30,
  // V1 has sparse inputs by design — this floor is intentionally low.
  // As more signals come online, raise it (eventual target: 60).
  dataQuality: 20,
} as const;

// --- shared helpers --------------------------------------------------

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function impactFromScore(score: number): FeatureImpact {
  if (score >= 65) return "positive";
  if (score <= 35) return "negative";
  return "neutral";
}

function countNonNull(values: unknown[]): number {
  return values.filter((v) => v !== null && v !== undefined).length;
}

// =====================================================================
// 1. Role stability
// =====================================================================

export function calculateRoleStabilityScore(
  inputs: RoleStabilityInputs,
): FeatureGroupResult<RoleStabilityInputs> {
  let score = 50;
  const notes: string[] = [];

  const trends = [
    inputs.snapShareTrend,
    inputs.routeParticipationTrend,
    inputs.targetShareTrend,
    inputs.carryShareTrend,
  ].filter((x): x is number => typeof x === "number");

  if (trends.length > 0) {
    const avgTrend = trends.reduce((a, b) => a + b, 0) / trends.length;
    // ±5pp trend → ±10 points; clamp
    score += avgTrend * 200;
    if (avgTrend > 0.02) notes.push("usage trending up");
    else if (avgTrend < -0.02) notes.push("usage trending down");
  } else {
    notes.push("no snap / share data");
  }

  if (inputs.teammateAbsenceBoost) {
    score = Math.min(100, score + 18);
    notes.push("teammate absent — role boost");
  }
  if (inputs.teammateReturnPenalty) {
    score = Math.max(0, score - 18);
    notes.push("teammate returning — role may compress");
  }

  score = clamp(Math.round(score));
  return {
    inputs,
    score,
    impact: impactFromScore(score),
    explanation: notes.length > 0 ? notes.join("; ") : "stable baseline role",
  };
}

// =====================================================================
// 2. Game script
// =====================================================================

const PASSING_TYPES = new Set<PropType>([
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
]);
const RECEIVING_TYPES = new Set<PropType>(["RECEPTIONS", "RECEIVING_YARDS"]);
const RUSHING_TYPES = new Set<PropType>(["RUSHING_ATTEMPTS", "RUSHING_YARDS"]);

export function calculateGameScriptScore(
  inputs: GameScriptInputs,
  propType: PropType,
): FeatureGroupResult<GameScriptInputs> {
  let score = 50;
  const notes: string[] = [];

  const isPassing = PASSING_TYPES.has(propType) || RECEIVING_TYPES.has(propType);
  const isRushing = RUSHING_TYPES.has(propType);

  if (inputs.trailingPassVolumeBoost != null && isPassing) {
    score += Math.min(20, inputs.trailingPassVolumeBoost * 4);
    if (inputs.trailingPassVolumeBoost > 1) notes.push("trailing-pass volume boost");
  }
  if (inputs.spread != null) {
    if (isRushing && inputs.spread <= -5) {
      score += 12;
      notes.push("team favored — positive rush script");
    }
    if (isPassing && inputs.spread >= 5) {
      score += 10;
      notes.push("team dog — likely trailing pass volume");
    }
  }
  if (inputs.total != null) {
    if (inputs.total >= 48) {
      score += 6;
      notes.push("high game total");
    } else if (inputs.total <= 39) {
      score -= 6;
      notes.push("low game total");
    }
  }
  if (inputs.blowoutRisk != null && inputs.blowoutRisk >= 0.35) {
    score -= 12;
    notes.push("blowout risk could compress volume");
  }
  if (countNonNull(Object.values(inputs)) === 0) {
    notes.push("no game-script signals available");
  }

  score = clamp(Math.round(score));
  return {
    inputs,
    score,
    impact: impactFromScore(score),
    explanation: notes.length > 0 ? notes.join("; ") : "neutral game script",
  };
}

// =====================================================================
// 3. Pace
// =====================================================================

const LEAGUE_AVG_PLAYS = 64;

export function calculatePaceScore(
  inputs: PaceInputs,
): FeatureGroupResult<PaceInputs> {
  let score = 50;
  const notes: string[] = [];

  if (inputs.projectedTotalPlays != null) {
    const delta = inputs.projectedTotalPlays - LEAGUE_AVG_PLAYS;
    score += delta * 1.2; // +1 play ≈ +1.2 points
    if (delta >= 4) notes.push("fast-paced matchup");
    else if (delta <= -4) notes.push("slow-paced matchup");
  } else if (inputs.opponentPlaysAllowed != null) {
    score += (inputs.opponentPlaysAllowed - LEAGUE_AVG_PLAYS) * 0.6;
  }
  if (inputs.secondsPerPlay != null && inputs.secondsPerPlay <= 26) {
    score += 4;
    notes.push("uptempo offense");
  }
  if (countNonNull(Object.values(inputs)) === 0) {
    notes.push("no pace data");
  }

  score = clamp(Math.round(score));
  return {
    inputs,
    score,
    impact: impactFromScore(score),
    explanation: notes.length > 0 ? notes.join("; ") : "league-average pace",
  };
}

// =====================================================================
// 4. Market context
// =====================================================================

export function calculateMarketContextScore(
  inputs: MarketContextInputs,
  ourSide?: Recommendation,
): FeatureGroupResult<MarketContextInputs> {
  let score = 50;
  const notes: string[] = [];

  if (inputs.lineMovement != null && Math.abs(inputs.lineMovement) >= 0.5) {
    // If we recommend OVER and line moved up (against us) → negative
    const against =
      (ourSide === "OVER" && inputs.lineMovement > 0) ||
      (ourSide === "UNDER" && inputs.lineMovement < 0);
    if (against) {
      score -= 18;
      notes.push("line moved against the model");
    } else {
      score += 8;
      notes.push("line moved with the model");
    }
  }
  if (inputs.bookOutlierScore != null && inputs.bookOutlierScore >= 0.7) {
    score += 12;
    notes.push("focal book is an outlier vs consensus");
  }
  if (
    inputs.liquiditySpreadPenalty != null &&
    inputs.liquiditySpreadPenalty >= 0.5
  ) {
    score -= 18;
    notes.push("thin Kalshi liquidity / wide spread");
  }
  if (countNonNull(Object.values(inputs)) === 0) {
    notes.push("single-snapshot market — movement unknown");
  }

  score = clamp(Math.round(score));
  return {
    inputs,
    score,
    impact: impactFromScore(score),
    explanation: notes.length > 0 ? notes.join("; ") : "market context neutral",
  };
}

// =====================================================================
// 5. Weather / environment
// =====================================================================

export function calculateWeatherEnvironmentScore(
  inputs: WeatherInputs,
  propType: PropType,
): FeatureGroupResult<WeatherInputs> {
  let score = 50;
  const notes: string[] = [];

  if (inputs.domeRoofFlag || !inputs.weatherImpactEligible) {
    score = 70;
    notes.push("dome / closed roof — weather neutral");
    return {
      inputs,
      score,
      impact: impactFromScore(score),
      explanation: notes.join("; "),
    };
  }

  const wind = inputs.windSpeed ?? 0;
  const precip = inputs.precipitation ?? 0;
  const isPassing = PASSING_TYPES.has(propType) || RECEIVING_TYPES.has(propType);
  const isRushing = RUSHING_TYPES.has(propType);

  if (isPassing) {
    if (wind >= 20) {
      score -= 25;
      notes.push("high wind — passing risk");
    } else if (wind >= 15) {
      score -= 12;
      notes.push("moderate wind — modest passing risk");
    }
    if (precip >= 0.05) {
      score -= 8;
      notes.push("precipitation — efficiency drag");
    }
  }
  if (isRushing) {
    if (wind >= 20 || precip >= 0.05) {
      score += 8;
      notes.push("wet/windy script favors rushing volume");
    }
  }
  if (
    inputs.weatherUncertainty != null &&
    inputs.weatherUncertainty < 0.5
  ) {
    score -= 6;
    notes.push("forecast uncertainty elevated");
  }
  if (countNonNull(Object.values(inputs)) === 0) {
    notes.push("no weather data");
  }

  score = clamp(Math.round(score));
  return {
    inputs,
    score,
    impact: impactFromScore(score),
    explanation:
      notes.length > 0 ? notes.join("; ") : "weather unlikely to affect this market",
  };
}

// =====================================================================
// 6. Injury / role context
// =====================================================================

export function calculateInjuryContextScore(
  inputs: InjuryContextInputs,
  propType: PropType,
): FeatureGroupResult<InjuryContextInputs> {
  let score = 50;
  const notes: string[] = [];

  if (inputs.playerInjuryUncertainty != null) {
    const u = inputs.playerInjuryUncertainty; // 0..1, higher = more uncertain
    score -= u * 60;
    if (u >= 0.6) notes.push("player injury uncertainty high");
    else if (u >= 0.3) notes.push("minor injury concern");
  }
  if (inputs.teammateInjuryRoleBoost != null && inputs.teammateInjuryRoleBoost > 0) {
    score += Math.min(20, inputs.teammateInjuryRoleBoost * 15);
    notes.push("teammate injury role boost");
  }
  if (inputs.offensiveLineInjuryScore != null && inputs.offensiveLineInjuryScore >= 0.5) {
    if (PASSING_TYPES.has(propType)) {
      score -= 10;
      notes.push("own OL depleted — passing risk");
    } else if (RUSHING_TYPES.has(propType)) {
      score -= 6;
      notes.push("own OL depleted — minor rushing drag");
    }
  }
  if (
    inputs.defensiveBackInjuryScore != null &&
    inputs.defensiveBackInjuryScore >= 0.5
  ) {
    if (RECEIVING_TYPES.has(propType)) {
      score += 12;
      notes.push("opposing DBs depleted — receiving boost");
    } else if (PASSING_TYPES.has(propType)) {
      score += 8;
      notes.push("opposing DBs depleted — passing boost");
    }
  }
  if (countNonNull(Object.values(inputs)) === 0) {
    notes.push("no injury flags");
  }

  score = clamp(Math.round(score));
  return {
    inputs,
    score,
    impact: impactFromScore(score),
    explanation: notes.length > 0 ? notes.join("; ") : "no injury concerns",
  };
}

// =====================================================================
// 7. Correlation / exposure
// =====================================================================

export function calculateCorrelationExposureScore(
  inputs: CorrelationExposureInputs,
): FeatureGroupResult<CorrelationExposureInputs> {
  let score = 70; // default: no exposure → favorable
  const notes: string[] = [];

  const cap = inputs.maxBetsPerGame || 3;
  if (inputs.sameGameExposure >= cap) {
    score = 10;
    notes.push("same-game exposure cap reached");
  } else if (inputs.sameGameExposure >= cap - 1) {
    score -= 30;
    notes.push("near same-game exposure cap");
  } else if (inputs.sameGameExposure >= 1) {
    score -= 10;
    notes.push("some same-game exposure");
  }
  if (inputs.sameTeamPassVolumeExposure >= 2) {
    score -= 20;
    notes.push("correlated pass-volume exposure on this team");
  }
  if (inputs.sameGameExposure === 0 && inputs.sameTeamPassVolumeExposure === 0) {
    notes.push("no existing exposure on this game");
  }

  score = clamp(Math.round(score));
  return {
    inputs,
    score,
    impact: impactFromScore(score),
    explanation: notes.join("; "),
  };
}

// =====================================================================
// Prop-level rollups
// =====================================================================

/**
 * Data quality — fraction of feature-group input fields that are populated.
 * Returns 0..100. A fully populated PropFeatureSet scores ~95; an
 * all-null one scores ~10 (since correlation-exposure inputs are always set).
 */
export function calculateOverallDataQualityScore(
  featureSet: PropFeatureSet,
): number {
  const allInputs = [
    featureSet.roleStability.inputs.snapShareTrend,
    featureSet.roleStability.inputs.routeParticipationTrend,
    featureSet.roleStability.inputs.targetShareTrend,
    featureSet.roleStability.inputs.carryShareTrend,
    featureSet.gameScript.inputs.spread,
    featureSet.gameScript.inputs.total,
    featureSet.gameScript.inputs.projectedTeamPlays,
    featureSet.gameScript.inputs.projectedPassRate,
    featureSet.gameScript.inputs.blowoutRisk,
    featureSet.gameScript.inputs.trailingPassVolumeBoost,
    featureSet.pace.inputs.secondsPerPlay,
    featureSet.pace.inputs.neutralPace,
    featureSet.pace.inputs.opponentPlaysAllowed,
    featureSet.pace.inputs.projectedTotalPlays,
    featureSet.marketContext.inputs.openingLine,
    featureSet.marketContext.inputs.currentLine,
    featureSet.marketContext.inputs.lineMovement,
    featureSet.marketContext.inputs.bookOutlierScore,
    featureSet.weatherEnvironment.inputs.windSpeed,
    featureSet.weatherEnvironment.inputs.windGust,
    featureSet.weatherEnvironment.inputs.temperature,
    featureSet.weatherEnvironment.inputs.precipitation,
    featureSet.weatherEnvironment.inputs.weatherUncertainty,
    featureSet.injuryContext.inputs.playerInjuryUncertainty,
    featureSet.injuryContext.inputs.teammateInjuryRoleBoost,
    featureSet.injuryContext.inputs.offensiveLineInjuryScore,
    featureSet.injuryContext.inputs.defensiveBackInjuryScore,
  ];
  const filled = countNonNull(allInputs);
  return Math.round((filled / allInputs.length) * 100);
}

/**
 * Risk score 0..100 — higher = more risk. Inverts the worst group
 * scores so a low-stability, high-injury prop reads as high-risk
 * regardless of edge.
 */
export function calculateRiskScore(featureSet: PropFeatureSet): number {
  // Inversion: each group contributes its "distance below 50".
  const groups = [
    featureSet.roleStability,
    featureSet.injuryContext,
    featureSet.weatherEnvironment,
    featureSet.correlationExposure,
    featureSet.marketContext,
  ];
  const negatives = groups.map((g) => Math.max(0, 50 - g.score));
  const avgNegative = negatives.reduce((a, b) => a + b, 0) / negatives.length;
  // 0 (no negative scores) -> 20; 50 (every group at 0) -> 100
  return Math.round(clamp(20 + avgNegative * 1.6));
}

// =====================================================================
// Qualification gate
// =====================================================================

export interface QualificationInput {
  propType: PropType;
  edge: number; // signed; positive favors OVER
  featureSet: PropFeatureSet;
}

export interface QualificationResult {
  qualified: boolean;
  recommendation: Recommendation;
  passReasons: string[];
  threshold: number;
  dataQuality: number;
  riskScore: number;
}

/**
 * Decide whether to bet this prop based on edge + feature gates.
 *
 * A prop is qualified ONLY if:
 *   - |edge| ≥ EDGE_THRESHOLDS[propType]
 *   - roleStability.score ≥ QUALIFICATION_FLOORS.roleStability
 *   - injuryContext.score ≥ QUALIFICATION_FLOORS.injuryContext
 *   - weatherEnvironment.score ≥ QUALIFICATION_FLOORS.weatherEnvironment
 *   - correlationExposure.score ≥ QUALIFICATION_FLOORS.correlationExposure
 *   - dataQuality ≥ QUALIFICATION_FLOORS.dataQuality
 *
 * If qualified, side is OVER when edge > 0, UNDER otherwise.
 */
export function qualifyWithFeatures(args: QualificationInput): QualificationResult {
  const { propType, edge, featureSet } = args;
  const threshold = EDGE_THRESHOLDS[propType];
  const dataQuality = calculateOverallDataQualityScore(featureSet);
  const riskScore = calculateRiskScore(featureSet);
  const passReasons: string[] = [];

  if (Math.abs(edge) < threshold) {
    passReasons.push(
      `Edge ${(Math.abs(edge) * 100).toFixed(1)}% is below ${(threshold * 100).toFixed(1)}% threshold`,
    );
  }
  if (featureSet.roleStability.score < QUALIFICATION_FLOORS.roleStability) {
    passReasons.push(
      `Role stability ${featureSet.roleStability.score} below floor ${QUALIFICATION_FLOORS.roleStability}`,
    );
  }
  if (featureSet.injuryContext.score < QUALIFICATION_FLOORS.injuryContext) {
    passReasons.push(
      `Injury uncertainty too high (score ${featureSet.injuryContext.score})`,
    );
  }
  if (
    featureSet.weatherEnvironment.score < QUALIFICATION_FLOORS.weatherEnvironment
  ) {
    passReasons.push(
      `Weather risk too high (score ${featureSet.weatherEnvironment.score})`,
    );
  }
  if (
    featureSet.correlationExposure.score < QUALIFICATION_FLOORS.correlationExposure
  ) {
    passReasons.push(
      `Correlation exposure too high (score ${featureSet.correlationExposure.score})`,
    );
  }
  if (dataQuality < QUALIFICATION_FLOORS.dataQuality) {
    passReasons.push(`Data quality ${dataQuality} below floor ${QUALIFICATION_FLOORS.dataQuality}`);
  }

  const qualified = passReasons.length === 0;
  const recommendation: Recommendation = qualified
    ? edge >= 0
      ? "OVER"
      : "UNDER"
    : "PASS";

  return {
    qualified,
    recommendation,
    passReasons,
    threshold,
    dataQuality,
    riskScore,
  };
}

// =====================================================================
// Badges + reasons / risks derivation
// =====================================================================

/** Pick the badges that apply to this prop's feature set. */
export function deriveBadges(
  featureSet: PropFeatureSet,
  ourSide: Recommendation,
): FeatureBadge[] {
  const badges: FeatureBadge[] = [];
  if (featureSet.roleStability.score >= 65) badges.push("ROLE_STABLE");
  if (featureSet.gameScript.impact === "positive") badges.push("SCRIPT_BOOST");
  if (
    featureSet.weatherEnvironment.score < 40 &&
    featureSet.weatherEnvironment.inputs.weatherImpactEligible
  ) {
    badges.push("WEATHER_RISK");
  }
  if (featureSet.injuryContext.score < 40) badges.push("INJURY_RISK");
  if (
    featureSet.marketContext.inputs.lineMovement != null &&
    Math.abs(featureSet.marketContext.inputs.lineMovement) >= 0.5
  ) {
    badges.push("LINE_MOVED");
  }
  void ourSide; // reserved for future side-aware badges
  if (featureSet.correlationExposure.score < 40)
    badges.push("CORRELATION_RISK");
  return badges;
}

/** Human-readable label for a badge. */
export const BADGE_LABEL: Record<FeatureBadge, string> = {
  ROLE_STABLE: "Role Stable",
  SCRIPT_BOOST: "Script Boost",
  WEATHER_RISK: "Weather Risk",
  INJURY_RISK: "Injury Risk",
  LINE_MOVED: "Line Moved",
  CORRELATION_RISK: "Correlation Risk",
};

/** Tone bucket the UI uses for badge styling. */
export function badgeTone(badge: FeatureBadge): "positive" | "negative" {
  return badge === "ROLE_STABLE" || badge === "SCRIPT_BOOST"
    ? "positive"
    : "negative";
}

/**
 * Convert a PropFeatureSet into model-driven reason/risk sentences,
 * skipping neutral / unknown groups. The data layer concatenates these
 * with any hand-crafted matchup notes.
 */
export function deriveFeatureReasons(featureSet: PropFeatureSet): string[] {
  const out: string[] = [];
  const groups: Array<[string, FeatureGroupResult]> = [
    ["Role stability", featureSet.roleStability],
    ["Game script", featureSet.gameScript],
    ["Pace", featureSet.pace],
    ["Market context", featureSet.marketContext],
    ["Weather", featureSet.weatherEnvironment],
    ["Injury context", featureSet.injuryContext],
  ];
  for (const [label, g] of groups) {
    if (g.impact === "positive") {
      out.push(`${label}: ${g.explanation}`);
    }
  }
  return out;
}

export function deriveFeatureRisks(featureSet: PropFeatureSet): string[] {
  const out: string[] = [];
  const groups: Array<[string, FeatureGroupResult]> = [
    ["Role stability", featureSet.roleStability],
    ["Game script", featureSet.gameScript],
    ["Market context", featureSet.marketContext],
    ["Weather", featureSet.weatherEnvironment],
    ["Injury context", featureSet.injuryContext],
    ["Correlation exposure", featureSet.correlationExposure],
  ];
  for (const [label, g] of groups) {
    if (g.impact === "negative") {
      out.push(`${label}: ${g.explanation}`);
    }
  }
  return out;
}
