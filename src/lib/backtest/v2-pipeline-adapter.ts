/**
 * V2 player-prop pipeline → backtest candidate adapter.
 *
 * Lets the existing backtest runner replay history using the v2
 * pipeline (`runPlayerPropPipeline`) without changing the
 * downstream grading / metrics path. We do that by synthesizing
 * a `PropDecisionScorecard` from the v2 decision so
 * `gradeBacktestCandidate` accepts it unchanged, and by carrying
 * v2-specific fields on a separate sidecar object the
 * comparison runner can consume.
 *
 * No new APIs are called. No paid network calls. Pure CPU on
 * fixture data.
 */

import type { Recommendation } from "../types";
import type {
  PropDecisionScorecard,
  ScorecardInput,
  Side,
} from "../model/model-scorecard";
import { runPlayerPropPipeline } from "../model/player-prop-pipeline";
import type {
  PlayerPropPipelineDecision,
  PlayerPropPipelineInput,
} from "../model/player-prop-pipeline";
import type {
  BacktestCandidate,
  BacktestFeatureRow,
} from "./types";
import type { EdgeQualityClassification } from "../model/confidence-adjusted-edge";
import type { LineSensitivityLabel } from "../model/line-sensitivity";
import type { MarketDisagreementClassification } from "../model/market-disagreement";
import type { RoleTrendClassification } from "../model/role-change-detector";
import type { PlayerPropDecisionTrace } from "../model/player-prop-pipeline";
import type { DedupSignal } from "../model/signal-deduplication";

export interface V2BacktestMetadata {
  /** Raw edge as reported by the pipeline (probability points). */
  rawEdge: number;
  /** Confidence-adjusted edge (the v2 qualification gate). */
  confidenceAdjustedEdge: number;
  /** Risk-adjusted edge (diagnostic). */
  riskAdjustedEdge: number;
  /** Disagreement bucket between model and no-vig market. */
  marketDisagreementClassification: MarketDisagreementClassification;
  /** Line fragility / key-line risk. */
  lineSensitivityLabel: LineSensitivityLabel;
  edgeFragilityScore: number;
  keyLineRisk: boolean;
  /** Role-trend classification (UNKNOWN if no series provided). */
  roleTrendClassification: RoleTrendClassification;
  roleStabilityScore: number;
  /** Edge quality bucket. */
  edgeQualityClassification: EdgeQualityClassification;
  /** First gate that failed if v2 PASSes. */
  primaryDisqualifier?: string;
  /** Reasons / risks / disqualifiers aggregated by the pipeline. */
  reasons: string[];
  risks: string[];
  disqualifiers: string[];
  /** Pipeline trace for the diagnostic UI / debug output. */
  debugTrace: PlayerPropDecisionTrace[];
}

export interface V2BacktestCandidate extends BacktestCandidate {
  v2: V2BacktestMetadata;
}

/**
 * Build a `BacktestCandidate` whose embedded `scorecard` reflects
 * the v2 pipeline's decision (recommendation, qualified flag,
 * edges, probabilities), plus a v2 sidecar with the new
 * disciplines. Grading + metrics consume the standard scorecard;
 * the v2 sidecar feeds the comparison runner.
 */
export function buildV2BacktestCandidate(
  featureRow: BacktestFeatureRow,
): V2BacktestCandidate {
  const decision = runPlayerPropPipeline(
    featureRowToPipelineInput(featureRow),
  );

  const scorecard = synthesizeScorecardFromV2(featureRow, decision);

  const v2: V2BacktestMetadata = {
    rawEdge: decision.rawEdge,
    confidenceAdjustedEdge: decision.confidenceAdjustedEdge,
    riskAdjustedEdge: decision.riskAdjustedEdge,
    marketDisagreementClassification: decision.marketDisagreement.classification,
    lineSensitivityLabel: decision.lineSensitivity.lineSensitivityLabel,
    edgeFragilityScore: decision.lineSensitivity.edgeFragilityScore,
    keyLineRisk: decision.lineSensitivity.keyLineRisk,
    roleTrendClassification:
      decision.roleTrend?.classification ?? "UNKNOWN_ROLE",
    roleStabilityScore:
      decision.roleTrend?.roleStabilityScore ?? featureRow.roleStabilityScore,
    edgeQualityClassification:
      decision.confidenceAdjusted.edgeQualityClassification,
    primaryDisqualifier: decision.qualification.primaryDisqualifier,
    reasons: decision.reasons,
    risks: decision.risks,
    disqualifiers: decision.disqualifiers,
    debugTrace: decision.trace,
  };

  return {
    propMarketId: featureRow.propMarketId,
    gameId: featureRow.gameId,
    playerId: featureRow.playerId,
    playerName: featureRow.playerName,
    teamAbbr: featureRow.teamAbbr,
    opponentAbbr: featureRow.opponentAbbr,
    propType: featureRow.propType,
    season: featureRow.season,
    week: featureRow.week,
    marketLine: featureRow.marketLine,
    scorecard,
    v2,
  };
}

/**
 * Translate a fixture feature row into the v2 pipeline's input shape.
 * Missing optional inputs → neutral defaults and the role-trend
 * stream is built from the available recent/season shares.
 */
function featureRowToPipelineInput(
  row: BacktestFeatureRow,
): PlayerPropPipelineInput {
  // Synthesize a weekly-share series from the available recent /
  // season averages. We do not have per-week historicals in the
  // fixture, so we approximate with a 5-week sequence whose
  // recent half tracks the recent average and whose early half
  // tracks the season average.
  const buildWeeklySeries = (recent: number, season: number): number[] => {
    return [
      season,
      season,
      (season + recent) / 2,
      recent,
      recent,
    ].map((v) => Math.max(0, Math.min(1, v)));
  };

  const roleTrendInput =
    row.recentTargetShare > 0 ||
    row.recentCarryShare > 0 ||
    row.recentSnapShare > 0
      ? {
          weeklySnapShare: buildWeeklySeries(
            row.recentSnapShare,
            row.seasonSnapShare,
          ),
          weeklyTargetShare: buildWeeklySeries(
            row.recentTargetShare,
            row.seasonTargetShare,
          ),
          weeklyCarryShare: buildWeeklySeries(
            row.recentCarryShare,
            row.seasonCarryShare,
          ),
          seasonBaselineSnapShare: row.seasonSnapShare,
          seasonBaselineTargetShare: row.seasonTargetShare,
          seasonBaselineCarryShare: row.seasonCarryShare,
        }
      : undefined;

  // Coaching uncertainty penalty (0..100). Falls back to 0 when
  // the feature row carries no coaching transition.
  const coachingUncertaintyPenalty =
    row.coachingTransition?.scores.coachingUncertaintyPenalty ?? 0;

  // Matchup confidence: when matchup-intelligence is plumbed we
  // translate its (small, signed) confidence adjustment into a
  // [0..1] level; otherwise leave undefined so the pipeline
  // derives confidence from data quality + role.
  const matchupConfidence =
    row.matchupAdjustment !== undefined
      ? Math.min(
          1,
          Math.max(0, 0.65 + row.matchupAdjustment.confidenceAdjustment),
        )
      : undefined;

  // Signal extraction is intentionally lean here: the v2 pipeline
  // already folds the projection's market-relative lift in as its
  // primary signal. Add matchup intelligence as a single
  // catch-all signal when present so qualified PASSes are
  // documented in trace.
  const signals: DedupSignal[] = [];
  if (row.matchupAdjustment && matchupConfidence !== undefined) {
    // Reasons-only matchup contribution — no mean delta from
    // matchup module since the v1 scorecard documents matchup
    // mean as informational, not applied.
    signals.push({
      name: "matchup_intelligence_summary",
      category: "MATCHUP",
      deltaPp: 0,
      confidence: matchupConfidence,
      independent: true,
      explanation: "Matchup intelligence summary (informational)",
    });
  }

  return {
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
    injuryContextScore: row.injuryContextScore,
    weatherEnvironmentScore: row.weatherEnvironmentScore,
    correlationExposureScore: row.correlationExposureScore,
    coachingUncertaintyPenalty,
    matchupConfidence,
    roleTrendInput,
    signals,
  };
}

/**
 * Construct a `PropDecisionScorecard` whose decision fields
 * reflect the v2 pipeline. Risk-score / score fields fall back to
 * the feature row so downstream metrics (which slice on these)
 * still get sensible values.
 */
function synthesizeScorecardFromV2(
  featureRow: BacktestFeatureRow,
  decision: PlayerPropPipelineDecision,
): PropDecisionScorecard {
  const overOdds = featureRow.overOdds;
  const underOdds = featureRow.underOdds;
  const marketOverImplied = americanToImpliedProbability(overOdds);
  const marketUnderImplied = americanToImpliedProbability(underOdds);
  const modelOver = decision.modelOverProbability;
  const modelUnder = 1 - modelOver;
  const noVigOver = decision.noVigOverProbability;
  const noVigUnder = 1 - noVigOver;
  const edgeOver = modelOver - noVigOver;
  const edgeUnder = modelUnder - noVigUnder;
  const selectedSide: Side = decision.selectedSide;
  const recommendation: Recommendation = decision.recommendation;

  // Volatility classification — borrows the same CV bands the
  // existing scorecard uses.
  const cv =
    featureRow.projectionMean > 0
      ? featureRow.projectionStdDev / featureRow.projectionMean
      : 1;
  const volatilityLevel =
    cv < 0.18 ? "low" : cv < 0.35 ? "medium" : "high";

  const passReasons = decision.qualification.passReasons;
  const failReasons = decision.qualification.failReasons;
  const reasons = decision.reasons;
  const risks = decision.risks;
  const disqualifiers = decision.disqualifiers;
  const finalExplanation = decision.finalExplanation;

  const dummyInput: ScorecardInput = {
    propId: featureRow.propMarketId,
    playerName: featureRow.playerName,
    propType: featureRow.propType,
    marketLine: featureRow.marketLine,
    overOdds,
    underOdds,
    projectedMean: featureRow.projectionMean,
    projectedStdDev: featureRow.projectionStdDev,
    dataQualityScore: featureRow.dataQualityScore,
    roleStabilityScore: featureRow.roleStabilityScore,
    gameScriptScore: featureRow.gameScriptScore,
    paceScore: featureRow.paceScore,
    marketContextScore: featureRow.marketContextScore,
    weatherEnvironmentScore: featureRow.weatherEnvironmentScore,
    injuryContextScore: featureRow.injuryContextScore,
    correlationExposureScore: featureRow.correlationExposureScore,
    coachingTransition: featureRow.coachingTransition,
    matchupAdjustment: featureRow.matchupAdjustment,
    matchupComponent: featureRow.matchupComponent,
  };
  // Reference dummyInput to satisfy `noUnusedLocals` — used by
  // future enhancements that want the original input echoed
  // alongside the synthesized scorecard.
  void dummyInput;

  return {
    propId: featureRow.propMarketId,
    playerName: featureRow.playerName,
    propType: featureRow.propType,
    marketLine: featureRow.marketLine,
    overOdds,
    underOdds,
    marketOverProbability: marketOverImplied,
    marketUnderProbability: marketUnderImplied,
    noVigOverProbability: noVigOver,
    noVigUnderProbability: noVigUnder,
    projectedMean: featureRow.projectionMean,
    projectedStdDev: featureRow.projectionStdDev,
    modelOverProbability: modelOver,
    modelUnderProbability: modelUnder,
    edgeOver,
    edgeUnder,
    selectedSide,
    edgeThreshold: decision.qualification.edgeThresholdUsed,
    recommendation,
    qualified: decision.qualified,
    confidence: decision.confidence,
    volatilityLevel,
    dataQualityScore: featureRow.dataQualityScore,
    riskScore: decision.riskScore,
    roleStabilityScore: featureRow.roleStabilityScore,
    gameScriptScore: featureRow.gameScriptScore,
    paceScore: featureRow.paceScore,
    marketContextScore: featureRow.marketContextScore,
    weatherEnvironmentScore: featureRow.weatherEnvironmentScore,
    injuryContextScore: featureRow.injuryContextScore,
    correlationExposureScore: featureRow.correlationExposureScore,
    passReasons,
    failReasons,
    reasons,
    risks,
    disqualifiers,
    finalExplanation,
    coachingTransition: featureRow.coachingTransition,
    matchupComponent: featureRow.matchupComponent,
  };
}

function americanToImpliedProbability(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}
