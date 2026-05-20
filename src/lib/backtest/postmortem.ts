/**
 * Deterministic postmortem tagger.
 *
 * Looks at the gap between the model's projection, the recommendation,
 * the risk scores, and the actual outcome. Multiple tags can apply to
 * one prop (e.g. a thin-edge loss can be both EDGE_TOO_THIN and
 * PROJECTION_TOO_AGGRESSIVE).
 *
 * Rules are intentionally simple and explainable — these are signals
 * for model iteration, not a separate decision engine.
 */

import type { BacktestEvaluatedProp, BacktestPostmortemTag } from "./types";

const SMALL_MISS_FRACTION = 0.05; // |actual - line| / max(line, 1) < 5%
const BAD_PROJECTION_FRACTION = 0.2;

export function assignPostmortemTags(
  prop: BacktestEvaluatedProp,
): BacktestPostmortemTag[] {
  const tags: BacktestPostmortemTag[] = [];
  const actual = prop.actualStat;
  if (actual == null) return tags;

  const lineDelta = actual - prop.line;
  const absLineDelta = Math.abs(lineDelta);
  const relMiss = absLineDelta / Math.max(prop.line, 1);
  const projection = prop.scorecardSnapshot.projectedMean;
  const projGap = actual - projection;
  const projGapRel = Math.abs(projGap) / Math.max(projection, 1);

  // --- QUALIFIED bet outcomes ----------------------------------------
  if (prop.qualified && prop.result === "LOSS") {
    if (relMiss < SMALL_MISS_FRACTION) {
      tags.push("GOOD_READ_BAD_VARIANCE");
    }
    if (
      prop.selectedSide === "OVER" &&
      projGap < -projection * BAD_PROJECTION_FRACTION
    ) {
      tags.push("PROJECTION_TOO_AGGRESSIVE");
    }
    if (
      prop.selectedSide === "UNDER" &&
      projGap > projection * BAD_PROJECTION_FRACTION
    ) {
      tags.push("PROJECTION_TOO_CONSERVATIVE");
    }
    if (prop.edge < 0.05) tags.push("EDGE_TOO_THIN");
    if (prop.coachingUncertaintyScore >= 40) {
      tags.push("COACHING_UNCERTAINTY_UNDERESTIMATED");
    }
    if (prop.weatherRiskScore < 0.7) tags.push("WEATHER_UNDERESTIMATED");
    if (prop.roleStabilityScore < 0.65) tags.push("ROLE_ASSUMPTION_FAILED");
    if (prop.injuryRiskScore < 0.7) tags.push("INJURY_USAGE_SURPRISE");
    if (prop.correlationRiskScore < 0.6) tags.push("CORRELATION_RISK");
    if (tags.length === 0) tags.push("MARKET_WAS_RIGHT");
  }

  // --- QUALIFIED bet WIN — small read confirmations -------------------
  if (prop.qualified && prop.result === "WIN") {
    if (relMiss < SMALL_MISS_FRACTION) tags.push("GOOD_READ_BAD_VARIANCE");
    if (
      prop.selectedSide === "OVER" &&
      projGap > projection * BAD_PROJECTION_FRACTION
    ) {
      tags.push("PROJECTION_TOO_CONSERVATIVE");
    }
    if (
      prop.selectedSide === "UNDER" &&
      projGap < -projection * BAD_PROJECTION_FRACTION
    ) {
      tags.push("PROJECTION_TOO_AGGRESSIVE");
    }
  }

  // --- PASS counterfactuals ------------------------------------------
  if (!prop.qualified) {
    const counterfactual = prop.counterfactualResult;
    if (counterfactual === "WIN") {
      const disq = prop.primaryDisqualifier?.toLowerCase() ?? "";
      if (disq.startsWith("edge of")) {
        tags.push("EDGE_TOO_THIN");
      } else {
        tags.push("FILTER_TOO_CONSERVATIVE");
      }
      if (disq.includes("role")) tags.push("ROLE_ASSUMPTION_FAILED");
      if (disq.includes("weather")) tags.push("WEATHER_UNDERESTIMATED");
      if (disq.includes("injury")) tags.push("INJURY_USAGE_SURPRISE");
      if (disq.includes("correlation")) tags.push("CORRELATION_RISK");
    } else if (counterfactual === "LOSS") {
      tags.push("FILTER_CORRECTLY_AVOIDED");
      if (prop.weatherRiskScore < 0.5) tags.push("WEATHER_UNDERESTIMATED");
      if (prop.coachingUncertaintyScore >= 60) {
        tags.push("COACHING_UNCERTAINTY_UNDERESTIMATED");
      }
    }
    // Note: PUSH or NO_RESULT counterfactuals get no tags.
  }

  // --- BAD_LINE_PRICE — overround signal that screams "shop your line"
  if (
    prop.qualified &&
    prop.marketOverProbability + prop.marketUnderProbability > 1.08 &&
    projGapRel < 0.05
  ) {
    tags.push("BAD_LINE_PRICE");
  }

  // --- GAME_SCRIPT_FAILED — projection-direction right but absolute miss
  // means the volume side of the model probably read the game wrong.
  if (
    prop.qualified &&
    prop.result === "LOSS" &&
    projGapRel >= BAD_PROJECTION_FRACTION
  ) {
    if (!tags.includes("GAME_SCRIPT_FAILED")) tags.push("GAME_SCRIPT_FAILED");
  }

  return tags;
}
