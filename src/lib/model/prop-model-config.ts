/**
 * Per-prop-type model configuration.
 *
 * The original scorecard treats all 7 V1 prop types with mostly the
 * same edge logic, weather model, and risk gates. That hides
 * meaningful differences:
 *   - receptions reward role stability; receiving yards reward
 *     efficiency and aDOT
 *   - passing attempts are driven by game script, passing yards by
 *     efficiency
 *   - rushing yards are more volatile than rushing attempts
 *
 * This config table is consumed by the v2 player-prop pipeline.
 * It is additive — the existing scorecard ignores it. Backtesting
 * decides whether these values stay or get tuned.
 */

import type { PropType } from "../types";

export type VolatilityLevel = "low" | "medium" | "high";
export type SensitivityLevel = "none" | "low" | "medium" | "high";

/**
 * Signal category tags used for deduplication, weighting, and
 * UI grouping. Keep this small and stable — it must match
 * `signal-deduplication.ts`.
 */
export type SignalCategory =
  | "ROLE"
  | "VOLUME"
  | "EFFICIENCY"
  | "WEATHER"
  | "COACHING"
  | "MATCHUP"
  | "MARKET"
  | "CORRELATION";

export interface PropModelConfig {
  propType: PropType;
  /** Floor edge (in probability points, e.g., 0.04 = 4pp). */
  baseEdgeThreshold: number;
  /**
   * Max cap on the football-context adjustment to market-anchored
   * probability, in percentage points. Volume props (attempts /
   * completions / receptions / rushing attempts) get a tighter
   * cap; yardage props can move further because efficiency adds
   * variance the market can't fully price in.
   */
  maxMarketAdjustmentPp: number;
  defaultVolatilityLevel: VolatilityLevel;
  /** Signal categories that push this prop type the most. */
  preferredSignals: SignalCategory[];
  /** Categories that should be watched but never dominate. */
  riskySignals: SignalCategory[];
  /** Auto-PASS if any of these gates fail (score key below the bar). */
  hardDisqualifiers: PropQualifierKey[];
  /** Add risk + threshold bump but do not auto-PASS. */
  softDisqualifiers: PropQualifierKey[];
  /** Floor confidence required for a qualified bet (0..1). */
  confidenceRequired: number;
  /** Floor data quality required (0..1). */
  dataQualityRequired: number;
  /** How sensitive the edge is to weather risk score < 1.0. */
  weatherSensitivity: SensitivityLevel;
  injurySensitivity: SensitivityLevel;
  coachingSensitivity: SensitivityLevel;
  matchupSensitivity: SensitivityLevel;
  proxySensitivity: SensitivityLevel;
  /** How fragile is the edge to a ±1 line move? */
  lineSensitivity: SensitivityLevel;
  /** How worried we are about same-game correlation. */
  correlationSensitivity: SensitivityLevel;
}

export type PropQualifierKey =
  | "roleStability"
  | "dataQuality"
  | "injuryContext"
  | "weatherEnvironment"
  | "coachingUncertainty"
  | "matchupConfidence"
  | "proxyConfidence"
  | "marketDisagreement"
  | "lineFragility"
  | "correlationExposure";

const CONFIG: Record<PropType, PropModelConfig> = {
  PASSING_ATTEMPTS: {
    propType: "PASSING_ATTEMPTS",
    baseEdgeThreshold: 0.04,
    maxMarketAdjustmentPp: 8,
    defaultVolatilityLevel: "low",
    preferredSignals: ["VOLUME", "COACHING", "MATCHUP"],
    riskySignals: ["WEATHER", "CORRELATION"],
    hardDisqualifiers: ["dataQuality", "marketDisagreement"],
    softDisqualifiers: [
      "coachingUncertainty",
      "weatherEnvironment",
      "lineFragility",
    ],
    confidenceRequired: 0.55,
    dataQualityRequired: 0.55,
    weatherSensitivity: "low",
    injurySensitivity: "medium",
    coachingSensitivity: "high",
    matchupSensitivity: "medium",
    proxySensitivity: "medium",
    lineSensitivity: "low",
    correlationSensitivity: "low",
  },
  PASSING_COMPLETIONS: {
    propType: "PASSING_COMPLETIONS",
    baseEdgeThreshold: 0.045,
    maxMarketAdjustmentPp: 8,
    defaultVolatilityLevel: "low",
    preferredSignals: ["VOLUME", "MATCHUP", "EFFICIENCY"],
    riskySignals: ["WEATHER"],
    hardDisqualifiers: ["dataQuality", "marketDisagreement"],
    softDisqualifiers: [
      "coachingUncertainty",
      "weatherEnvironment",
      "lineFragility",
    ],
    confidenceRequired: 0.55,
    dataQualityRequired: 0.55,
    weatherSensitivity: "medium",
    injurySensitivity: "medium",
    coachingSensitivity: "medium",
    matchupSensitivity: "medium",
    proxySensitivity: "medium",
    lineSensitivity: "medium",
    correlationSensitivity: "low",
  },
  PASSING_YARDS: {
    propType: "PASSING_YARDS",
    baseEdgeThreshold: 0.06,
    maxMarketAdjustmentPp: 10,
    defaultVolatilityLevel: "high",
    preferredSignals: ["EFFICIENCY", "MATCHUP", "VOLUME"],
    riskySignals: ["WEATHER", "MATCHUP"],
    hardDisqualifiers: [
      "dataQuality",
      "marketDisagreement",
      "lineFragility",
    ],
    softDisqualifiers: [
      "weatherEnvironment",
      "coachingUncertainty",
      "injuryContext",
    ],
    confidenceRequired: 0.6,
    dataQualityRequired: 0.6,
    weatherSensitivity: "high",
    injurySensitivity: "high",
    coachingSensitivity: "medium",
    matchupSensitivity: "high",
    proxySensitivity: "medium",
    lineSensitivity: "high",
    correlationSensitivity: "medium",
  },
  RECEPTIONS: {
    propType: "RECEPTIONS",
    baseEdgeThreshold: 0.05,
    maxMarketAdjustmentPp: 9,
    defaultVolatilityLevel: "medium",
    preferredSignals: ["ROLE", "VOLUME", "MATCHUP"],
    riskySignals: ["CORRELATION", "WEATHER"],
    hardDisqualifiers: [
      "dataQuality",
      "roleStability",
      "marketDisagreement",
    ],
    softDisqualifiers: ["injuryContext", "lineFragility"],
    confidenceRequired: 0.55,
    dataQualityRequired: 0.55,
    weatherSensitivity: "medium",
    injurySensitivity: "high",
    coachingSensitivity: "low",
    matchupSensitivity: "medium",
    proxySensitivity: "medium",
    lineSensitivity: "medium",
    correlationSensitivity: "medium",
  },
  RECEIVING_YARDS: {
    propType: "RECEIVING_YARDS",
    baseEdgeThreshold: 0.065,
    maxMarketAdjustmentPp: 10,
    defaultVolatilityLevel: "high",
    preferredSignals: ["EFFICIENCY", "ROLE", "MATCHUP"],
    riskySignals: ["WEATHER", "CORRELATION"],
    hardDisqualifiers: [
      "dataQuality",
      "roleStability",
      "marketDisagreement",
      "lineFragility",
    ],
    softDisqualifiers: ["weatherEnvironment", "injuryContext"],
    confidenceRequired: 0.6,
    dataQualityRequired: 0.6,
    weatherSensitivity: "high",
    injurySensitivity: "high",
    coachingSensitivity: "low",
    matchupSensitivity: "high",
    proxySensitivity: "medium",
    lineSensitivity: "high",
    correlationSensitivity: "medium",
  },
  RUSHING_ATTEMPTS: {
    propType: "RUSHING_ATTEMPTS",
    baseEdgeThreshold: 0.045,
    maxMarketAdjustmentPp: 8,
    defaultVolatilityLevel: "medium",
    preferredSignals: ["VOLUME", "ROLE", "COACHING"],
    riskySignals: ["CORRELATION"],
    hardDisqualifiers: [
      "dataQuality",
      "roleStability",
      "marketDisagreement",
    ],
    softDisqualifiers: ["injuryContext", "coachingUncertainty"],
    confidenceRequired: 0.55,
    dataQualityRequired: 0.55,
    weatherSensitivity: "low",
    injurySensitivity: "high",
    coachingSensitivity: "high",
    matchupSensitivity: "medium",
    proxySensitivity: "medium",
    lineSensitivity: "medium",
    correlationSensitivity: "high",
  },
  RUSHING_YARDS: {
    propType: "RUSHING_YARDS",
    baseEdgeThreshold: 0.06,
    maxMarketAdjustmentPp: 10,
    defaultVolatilityLevel: "high",
    preferredSignals: ["EFFICIENCY", "VOLUME", "MATCHUP"],
    riskySignals: ["MATCHUP", "CORRELATION"],
    hardDisqualifiers: [
      "dataQuality",
      "roleStability",
      "marketDisagreement",
      "lineFragility",
    ],
    softDisqualifiers: ["injuryContext", "matchupConfidence"],
    confidenceRequired: 0.6,
    dataQualityRequired: 0.6,
    weatherSensitivity: "medium",
    injurySensitivity: "high",
    coachingSensitivity: "medium",
    matchupSensitivity: "high",
    proxySensitivity: "medium",
    lineSensitivity: "high",
    correlationSensitivity: "high",
  },
};

export function getPropModelConfig(propType: PropType): PropModelConfig {
  return CONFIG[propType];
}

/** Volume props (attempts/completions/receptions/rushing-attempts). */
export function isVolumeProp(propType: PropType): boolean {
  return (
    propType === "PASSING_ATTEMPTS" ||
    propType === "PASSING_COMPLETIONS" ||
    propType === "RECEPTIONS" ||
    propType === "RUSHING_ATTEMPTS"
  );
}

/** Yardage props (passing/receiving/rushing yards). */
export function isYardageProp(propType: PropType): boolean {
  return (
    propType === "PASSING_YARDS" ||
    propType === "RECEIVING_YARDS" ||
    propType === "RUSHING_YARDS"
  );
}

/** Sensitivity → multiplier used by qualification math (0..1.5). */
export function sensitivityMultiplier(level: SensitivityLevel): number {
  switch (level) {
    case "none":
      return 0;
    case "low":
      return 0.5;
    case "medium":
      return 1;
    case "high":
      return 1.5;
  }
}
