/**
 * Prop projection rules — the declarative spec for every V1 prop type.
 *
 * Each rule lives in one place so the engine, the UI, and code reviewers
 * read the same source. Edit a rule here, see the change reflected in
 * the engine's adjustments, the dashboard's reasons / risks panel, and
 * the qualification gate's thresholds.
 *
 * V1 covers lower-variance markets only — no TDs:
 *   PASSING_ATTEMPTS, PASSING_COMPLETIONS, PASSING_YARDS,
 *   RECEPTIONS, RECEIVING_YARDS,
 *   RUSHING_ATTEMPTS, RUSHING_YARDS
 *
 * Each rule captures, per the spec:
 *   1. requiredInputs        signals the projection formula consumes
 *   2. baselineFormula       plain-text formula description
 *   3. positiveFactors       things that push the projection up
 *   4. negativeFactors       things that push it down
 *   5. volatilityLevel       LOW | MEDIUM | HIGH plus a σ multiplier
 *   6. minEdgeThreshold      kept in sync with feature-scoring.ts
 *   7. qualificationRules    plain-text policy
 *   8. uiReasons             template reasons surfaced to the UI
 *   9. uiRisks               template risks surfaced to the UI
 *
 * The engine generates per-call reasons / risks dynamically based on
 * which adjustments fired. The strings here are the canonical list a
 * reviewer can check against.
 */

import type { PropType } from "../types";

export type VolatilityLevel = "LOW" | "MEDIUM" | "HIGH";

export interface PropProjectionRule {
  propType: PropType;
  requiredInputs: string[];
  baselineFormula: string;
  positiveFactors: string[];
  negativeFactors: string[];
  volatilityLevel: VolatilityLevel;
  /** σ multiplier the engine applies on top of the recent-stat stddev. */
  volatilityMultiplier: number;
  /** Kept in sync with EDGE_THRESHOLDS in feature-scoring.ts. */
  minEdgeThreshold: number;
  qualificationRules: string[];
  uiReasons: string[];
  uiRisks: string[];
}

export const PROP_PROJECTION_RULES: Record<PropType, PropProjectionRule> = {
  // --- PASSING ATTEMPTS ------------------------------------------------
  PASSING_ATTEMPTS: {
    propType: "PASSING_ATTEMPTS",
    requiredInputs: [
      "projectedTeamPlays",
      "projectedPassRate",
      "playerRecentMean (fallback)",
      "playerSeasonMean (fallback)",
    ],
    baselineFormula: "projectedTeamPlays × projectedPassRate",
    positiveFactors: [
      "Team trailing-script boost (spread ≥ +5 means more passing)",
      "High game total (more plays overall)",
      "Opposing DB depletion (offense leans on pass)",
    ],
    negativeFactors: [
      "Wind ≥ 15 mph (capped passing volume)",
      "Heavy precipitation",
      "Own offensive-line injuries (drives stall)",
      "Blowout-risk (running clock reduces 2H volume)",
    ],
    volatilityLevel: "LOW",
    volatilityMultiplier: 1.0,
    minEdgeThreshold: 0.04,
    qualificationRules: [
      "|edge| ≥ 4%",
      "Player not listed OUT / DOUBTFUL",
      "Snap-share trend stable",
    ],
    uiReasons: [
      "QB on track for full game; team has a stable attempt baseline",
      "Pass-heavy script projected from spread / total",
    ],
    uiRisks: [
      "Run-heavy script if team leads early",
      "Adverse weather can compress total attempts",
    ],
  },

  // --- PASSING COMPLETIONS ---------------------------------------------
  PASSING_COMPLETIONS: {
    propType: "PASSING_COMPLETIONS",
    requiredInputs: [
      "projectedTeamPlays",
      "projectedPassRate",
      "playerRecentMean (fallback)",
    ],
    baselineFormula:
      "(projectedTeamPlays × projectedPassRate) × completion_rate (default 0.65)",
    positiveFactors: [
      "QB accuracy trending up",
      "Soft secondary (DB injuries) — easier completions",
      "Indoor / dome game (clean conditions)",
    ],
    negativeFactors: [
      "Wind ≥ 15 mph reduces accuracy",
      "Precipitation reduces completion rate",
      "Own OL injuries → more pressure → fewer completions",
    ],
    volatilityLevel: "LOW",
    volatilityMultiplier: 1.0,
    minEdgeThreshold: 0.04,
    qualificationRules: [
      "|edge| ≥ 4%",
      "Player not listed OUT / DOUBTFUL",
      "Completion-rate sample reasonable (≥ 3 prior games)",
    ],
    uiReasons: [
      "Clean conditions favor accuracy",
      "Opposing secondary depleted",
    ],
    uiRisks: [
      "Weather risk for outdoor stadium",
      "Pressure rate up if OL injured",
    ],
  },

  // --- PASSING YARDS ---------------------------------------------------
  PASSING_YARDS: {
    propType: "PASSING_YARDS",
    requiredInputs: [
      "projectedTeamPlays",
      "projectedPassRate",
      "playerRecentMean",
    ],
    baselineFormula:
      "passingCompletions × yards_per_completion (default 11.0)",
    positiveFactors: [
      "Trailing-script (more attempts AND more deep shots)",
      "Opposing DB depletion (explosive plays available)",
      "High game total",
    ],
    negativeFactors: [
      "Wind ≥ 15 mph (cuts deep ball)",
      "Heavy precipitation",
      "Own OL injuries (pressure cuts YPA)",
      "Blowout risk (Q4 garbage time can swing either way; we lean down)",
    ],
    volatilityLevel: "HIGH",
    volatilityMultiplier: 1.25,
    minEdgeThreshold: 0.06,
    qualificationRules: [
      "|edge| ≥ 6%",
      "Volatility tolerance: σ_recent / mean < 0.35",
      "Player not listed OUT / DOUBTFUL",
    ],
    uiReasons: [
      "Trailing-script projects extra pass attempts",
      "Soft secondary creates yardage upside",
    ],
    uiRisks: [
      "Yardage outcomes are heavy-tailed — single drive swings the result",
      "Weather risk amplifies σ on this market",
    ],
  },

  // --- RECEPTIONS ------------------------------------------------------
  RECEPTIONS: {
    propType: "RECEPTIONS",
    requiredInputs: [
      "playerTargetShare",
      "projectedTeamPlays",
      "projectedPassRate",
      "playerRecentMean (fallback)",
    ],
    baselineFormula:
      "teamPassAttempts × playerTargetShare × catch_rate (default 0.65)",
    positiveFactors: [
      "Teammate absence boost (target share consolidates)",
      "Opposing slot/DB depletion (matchup edge)",
      "Trailing-script (team passes more)",
    ],
    negativeFactors: [
      "Player questionable / doubtful",
      "Wind or precipitation cuts completion %",
      "Game-script blowout (Q4 backups absorb targets)",
    ],
    volatilityLevel: "MEDIUM",
    volatilityMultiplier: 1.1,
    minEdgeThreshold: 0.05,
    qualificationRules: [
      "|edge| ≥ 5%",
      "Target share ≥ 15% over last 3 games (stable role)",
      "Teammate-return penalty inactive",
    ],
    uiReasons: [
      "Stable role — top-3 in team target share",
      "Teammate absence opens up additional looks",
    ],
    uiRisks: [
      "Target volatility can swing prop in one game",
      "Adverse weather caps completion-driven counts",
    ],
  },

  // --- RECEIVING YARDS -------------------------------------------------
  RECEIVING_YARDS: {
    propType: "RECEIVING_YARDS",
    requiredInputs: [
      "playerTargetShare",
      "projectedTeamPlays",
      "projectedPassRate",
      "playerRecentMean",
    ],
    baselineFormula: "receptions × yards_per_reception (default 12.0)",
    positiveFactors: [
      "Opposing DB depletion (explosive plays available)",
      "Teammate absence consolidates target share",
      "High game total",
    ],
    negativeFactors: [
      "Wind / precipitation (cuts YAC and deep balls)",
      "Own OL injuries (broken plays, fewer downfield shots)",
      "Player questionable / doubtful",
    ],
    volatilityLevel: "HIGH",
    volatilityMultiplier: 1.3,
    minEdgeThreshold: 0.07,
    qualificationRules: [
      "|edge| ≥ 7%",
      "Recent yards/target sample reasonable",
      "Player not listed OUT / DOUBTFUL",
    ],
    uiReasons: [
      "Matchup gives YPC and YAC upside",
      "Soft secondary creates downfield room",
    ],
    uiRisks: [
      "Fat-tailed market — one explosive play makes or breaks the result",
      "Adverse weather amplifies σ",
    ],
  },

  // --- RUSHING ATTEMPTS ------------------------------------------------
  RUSHING_ATTEMPTS: {
    propType: "RUSHING_ATTEMPTS",
    requiredInputs: [
      "playerCarryShare",
      "projectedTeamPlays",
      "projectedRushRate",
      "playerRecentMean (fallback)",
    ],
    baselineFormula:
      "(projectedTeamPlays × projectedRushRate) × playerCarryShare",
    positiveFactors: [
      "Team favored (spread ≤ -5) — leading script runs the ball",
      "Wet/windy game — offense leans run-heavy",
      "Backup RB out (carry share consolidates)",
    ],
    negativeFactors: [
      "Team is a dog (spread ≥ +5) — passing more",
      "Player questionable / doubtful",
      "Own OL injuries (less efficient runs, fewer drives sustained)",
    ],
    volatilityLevel: "MEDIUM",
    volatilityMultiplier: 1.05,
    minEdgeThreshold: 0.05,
    qualificationRules: [
      "|edge| ≥ 5%",
      "Carry share ≥ 50% recent (lead-back role stable)",
      "Player not listed OUT / DOUBTFUL",
    ],
    uiReasons: [
      "Favored game script projects above-average rushing volume",
      "Backfield consolidates around this player",
    ],
    uiRisks: [
      "Game-script flip (early deficit) compresses carry count",
      "Committee usage if backup RB returns",
    ],
  },

  // --- RUSHING YARDS ---------------------------------------------------
  RUSHING_YARDS: {
    propType: "RUSHING_YARDS",
    requiredInputs: [
      "playerCarryShare",
      "projectedTeamPlays",
      "projectedRushRate",
      "playerRecentMean",
    ],
    baselineFormula: "rushingAttempts × yards_per_carry (default 4.3)",
    positiveFactors: [
      "Favored script (more carries against tired defense)",
      "Soft run defense (placeholder until opponent splits land)",
      "Healthy OL maintains push",
    ],
    negativeFactors: [
      "Own OL injuries (cuts YPC and breakaway runs)",
      "Player questionable / doubtful",
      "Negative script eats into early-down rushing",
    ],
    volatilityLevel: "HIGH",
    volatilityMultiplier: 1.25,
    minEdgeThreshold: 0.06,
    qualificationRules: [
      "|edge| ≥ 6%",
      "Carry share ≥ 50% recent",
      "OL injury score low",
    ],
    uiReasons: [
      "Lead-back script projects volume and efficiency",
      "Healthy OL maintains push",
    ],
    uiRisks: [
      "One missed-tackle long carry can swing this prop",
      "OL injuries cap breakaway potential",
    ],
  },
};

/** Look up the rule for a prop type. */
export function getProjectionRule(propType: PropType): PropProjectionRule {
  return PROP_PROJECTION_RULES[propType];
}
