/**
 * Backtest projection adapter.
 *
 * Translates a `BacktestFeatureRow` into the existing model
 * scorecard's `ScorecardInput` shape. The scorecard then decides
 * qualified/edge/recommendation/etc. — there is intentionally no
 * second decision path here.
 */

import type { ScorecardInput } from "../model/model-scorecard";
import type { BacktestFeatureRow } from "./types";

export function buildScorecardInputFromFeatureRow(
  row: BacktestFeatureRow,
): ScorecardInput {
  return {
    scenarioName: `bt-${row.season}-w${row.week}-${row.propMarketId}`,
    propId: row.propMarketId,
    playerName: row.playerName,
    propType: row.propType,
    marketLine: row.marketLine,
    overOdds: row.overOdds,
    underOdds: row.underOdds,
    projectedMean: row.projectionMean,
    projectedStdDev: row.projectionStdDev,
    dataQualityScore: row.dataQualityScore,
    roleStabilityScore: row.roleStabilityScore,
    gameScriptScore: row.gameScriptScore,
    paceScore: row.paceScore,
    marketContextScore: row.marketContextScore,
    weatherEnvironmentScore: row.weatherEnvironmentScore,
    injuryContextScore: row.injuryContextScore,
    correlationExposureScore: row.correlationExposureScore,
    coachingTransition: row.coachingTransition,
  };
}
