/**
 * Player prop v2 pipeline — orchestrates the audited decision flow.
 *
 * Additive on top of the existing scorecard. Does NOT replace
 * `buildPropDecisionScorecard`. Two ways to use it:
 *
 *   1. Standalone: feed a `PlayerPropPipelineInput`, get a decision
 *      object with full trace. Used by the new test runner and by
 *      future backtest analysis.
 *   2. Diagnostic: run alongside the existing scorecard, compare,
 *      and surface where v2 would PASS but v1 would PLAY (or vice
 *      versa).
 *
 * Pipeline:
 *   1.  Validate market data.
 *   2.  Build baseline normal-distribution probability.
 *   3.  Compute no-vig market baseline.
 *   4.  Resolve prop-specific config.
 *   5.  Detect role trend (if usage series supplied).
 *   6.  Collect and dedupe football-context signals.
 *   7.  Apply coaching uncertainty.
 *   8.  Apply weather + injury risk.
 *   9.  Compute raw model probability (market + capped adjustment).
 *  10. Apply market-anchored cap discipline.
 *  11. Compute line sensitivity.
 *  12. Compute confidence-adjusted + risk-adjusted edge.
 *  13. Classify market disagreement.
 *  14. Run centralized qualification.
 *  15. Build a v2 decision object with full debug trace.
 *
 * Important — no live API calls, no touchdown markets, no automated
 * betting, no Game Edge crossover. Pure CPU.
 */

import type { PropType, Recommendation } from "../types";
import type { Side } from "./model-scorecard";
import {
  capCombinedSignalImpact,
  type DedupSignal,
  type SignalDeduplicationResult,
} from "./signal-deduplication";
import {
  detectRoleTrend,
  type RoleTrendInput,
  type RoleTrendOutput,
} from "./role-change-detector";
import {
  calculateLineSensitivity,
  type LineSensitivityOutput,
} from "./line-sensitivity";
import {
  calculateConfidenceAdjustedEdge,
  type ConfidenceAdjustedEdgeOutput,
} from "./confidence-adjusted-edge";
import {
  calculateMarketDisagreement,
  type MarketDisagreementOutput,
} from "./market-disagreement";
import {
  qualifyProp,
  type PropQualificationOutput,
} from "./prop-qualification";
import {
  getPropModelConfig,
  type PropModelConfig,
} from "./prop-model-config";

export interface PlayerPropPipelineInput {
  scenarioName?: string;
  propId?: string;
  playerName?: string;
  propType: PropType;
  marketLine: number;
  overOdds: number;
  underOdds: number;
  projectedMean: number;
  projectedStdDev: number;

  /** 0..1 risk-bucket and quality scores. */
  dataQualityScore: number;
  roleStabilityScore: number;
  injuryContextScore: number;
  weatherEnvironmentScore: number;
  correlationExposureScore: number;

  /** Optional usage series for role-trend detection. */
  roleTrendInput?: RoleTrendInput;

  /**
   * Coaching uncertainty 0..100 penalty (matches coaching
   * transition framework).
   */
  coachingUncertaintyPenalty?: number;

  /** Confidence supplied by upstream models, 0..1. */
  matchupConfidence?: number;
  proxyConfidence?: number;

  /** Free-form list of football-context signals — get deduped. */
  signals?: DedupSignal[];
}

export interface PlayerPropDecisionTrace {
  step: string;
  inputSummary: string;
  outputSummary: string;
  notes: string[];
  warnings: string[];
}

export interface PlayerPropPipelineDecision {
  /** Inputs (echoed for the debug page). */
  propType: PropType;
  marketLine: number;
  selectedSide: Side;
  recommendation: Recommendation;
  qualified: boolean;

  /** Market baseline. */
  marketOverProbability: number;
  noVigOverProbability: number;

  /** Model probability (post-adjustment). */
  modelOverProbability: number;

  /** Football adjustment summary (post-dedup). */
  cappedAdjustmentPp: number;
  rawAdjustmentPp: number;
  signalDeduplication: SignalDeduplicationResult;

  /** Derived edges. */
  rawEdge: number;
  confidenceAdjustedEdge: number;
  riskAdjustedEdge: number;
  confidenceAdjusted: ConfidenceAdjustedEdgeOutput;

  /** Per-component analyses. */
  roleTrend?: RoleTrendOutput;
  lineSensitivity: LineSensitivityOutput;
  marketDisagreement: MarketDisagreementOutput;

  /** Final qualification. */
  qualification: PropQualificationOutput;

  /** Per-prop model config (echoed for the trace UI). */
  config: PropModelConfig;

  /** Confidence + risk score (re-derived inside the pipeline). */
  confidence: number;
  riskScore: number;

  /** Full reasons / risks / disqualifiers. */
  reasons: string[];
  risks: string[];
  disqualifiers: string[];
  finalExplanation: string;

  /** Debug trace of each pipeline step. */
  trace: PlayerPropDecisionTrace[];
}

const ALLOWED_PROP_TYPES: ReadonlyArray<PropType> = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
];

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-a * a);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function americanToImpliedProbability(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function noVigPair(overOdds: number, underOdds: number): {
  noVigOver: number;
  noVigUnder: number;
  overImplied: number;
  underImplied: number;
} {
  const overImplied = americanToImpliedProbability(overOdds);
  const underImplied = americanToImpliedProbability(underOdds);
  const total = overImplied + underImplied;
  return {
    noVigOver: total > 0 ? overImplied / total : 0.5,
    noVigUnder: total > 0 ? underImplied / total : 0.5,
    overImplied,
    underImplied,
  };
}

function modelOverProbabilityFromNormal(
  line: number,
  mean: number,
  stdDev: number,
): number {
  if (stdDev <= 0) return mean > line ? 1 : mean === line ? 0.5 : 0;
  const z = (line - mean) / stdDev;
  return 1 - normalCdf(z);
}

function deriveConfidence(args: {
  dataQuality: number;
  riskScore: number;
  roleStability: number;
  matchupConfidence?: number;
  proxyConfidence?: number;
  coachingPenalty: number;
}): number {
  const supports: number[] = [
    args.dataQuality,
    args.roleStability,
    args.riskScore,
  ];
  if (args.matchupConfidence !== undefined) supports.push(args.matchupConfidence);
  if (args.proxyConfidence !== undefined) supports.push(args.proxyConfidence);
  const base = supports.reduce((a, b) => a + b, 0) / supports.length;
  const coachingDrag = clamp(args.coachingPenalty / 100, 0, 0.4) * 0.25;
  return clamp(base - coachingDrag, 0.2, 0.95);
}

function deriveRiskScore(args: {
  weatherEnvironmentScore: number;
  injuryContextScore: number;
  correlationExposureScore: number;
  coachingPenalty: number;
}): number {
  const components: number[] = [
    args.weatherEnvironmentScore,
    args.injuryContextScore,
    args.correlationExposureScore,
    clamp(1 - args.coachingPenalty / 100, 0, 1),
  ];
  return clamp(
    components.reduce((a, b) => a + b, 0) / components.length,
    0,
    1,
  );
}

export function runPlayerPropPipeline(
  input: PlayerPropPipelineInput,
): PlayerPropPipelineDecision {
  if (!ALLOWED_PROP_TYPES.includes(input.propType)) {
    throw new Error(
      `Unsupported propType ${input.propType} — V1 only allows the 7 lower-variance markets`,
    );
  }

  const trace: PlayerPropDecisionTrace[] = [];
  const config = getPropModelConfig(input.propType);
  const coachingPenalty = input.coachingUncertaintyPenalty ?? 0;

  // 1. Validate market data.
  const validMarket =
    Number.isFinite(input.overOdds) &&
    Number.isFinite(input.underOdds) &&
    input.overOdds !== 0 &&
    input.underOdds !== 0;
  trace.push({
    step: "validateMarket",
    inputSummary: `overOdds=${input.overOdds}, underOdds=${input.underOdds}`,
    outputSummary: validMarket ? "valid" : "invalid",
    notes: [],
    warnings: validMarket ? [] : ["Market odds invalid"],
  });

  // 2. Build baseline projection probability.
  const modelOverBaseline = modelOverProbabilityFromNormal(
    input.marketLine,
    input.projectedMean,
    input.projectedStdDev,
  );
  trace.push({
    step: "baselineProjection",
    inputSummary: `μ=${input.projectedMean.toFixed(2)}, σ=${input.projectedStdDev.toFixed(2)}, line=${input.marketLine}`,
    outputSummary: `OVER prob ${(modelOverBaseline * 100).toFixed(1)}%`,
    notes: [],
    warnings: [],
  });

  // 3. No-vig market baseline.
  const novig = noVigPair(input.overOdds, input.underOdds);
  trace.push({
    step: "noVigBaseline",
    inputSummary: `overOdds=${input.overOdds}, underOdds=${input.underOdds}`,
    outputSummary: `no-vig OVER ${(novig.noVigOver * 100).toFixed(1)}%`,
    notes: [],
    warnings: [],
  });

  // 4. Prop-specific config snapshot.
  trace.push({
    step: "propConfig",
    inputSummary: input.propType,
    outputSummary: `baseThreshold=${(config.baseEdgeThreshold * 100).toFixed(1)}pp, maxAdj=${config.maxMarketAdjustmentPp}pp, volatility=${config.defaultVolatilityLevel}`,
    notes: [],
    warnings: [],
  });

  // 5. Role trend.
  const roleTrend = input.roleTrendInput
    ? detectRoleTrend(input.roleTrendInput)
    : undefined;
  if (roleTrend) {
    trace.push({
      step: "roleTrend",
      inputSummary: "weekly usage series",
      outputSummary: `${roleTrend.classification} (stability ${roleTrend.roleStabilityScore.toFixed(2)})`,
      notes: roleTrend.reasons,
      warnings: roleTrend.risks,
    });
  }
  const roleStabilityEffective = roleTrend
    ? Math.min(input.roleStabilityScore, roleTrend.roleStabilityScore + 0.05)
    : input.roleStabilityScore;

  // 6. Signal deduplication (capped within-category).
  // Inject the projection's market-relative lift as a high-priority
  // signal — this is the model's primary "I see something the market
  // doesn't" claim, with confidence derived from data quality + role
  // stability + matchup confidence.
  const rawProjectionLiftPp = (modelOverBaseline - novig.noVigOver) * 100;
  const projectionLiftConfidence = clamp(
    (input.dataQualityScore +
      roleStabilityEffective +
      (input.matchupConfidence ?? input.dataQualityScore)) /
      3,
    0.2,
    0.9,
  );
  const projectionSignal: DedupSignal = {
    name: "projection_market_lift",
    category: "EFFICIENCY",
    deltaPp: rawProjectionLiftPp,
    confidence: projectionLiftConfidence,
    independent: true,
    explanation: `Projection μ=${input.projectedMean.toFixed(2)} σ=${input.projectedStdDev.toFixed(2)} vs line ${input.marketLine}`,
  };
  const allSignals: DedupSignal[] = [projectionSignal, ...(input.signals ?? [])];
  const dedup = capCombinedSignalImpact(allSignals);
  trace.push({
    step: "signalDeduplication",
    inputSummary: `${allSignals.length} signals (incl. projection lift ${rawProjectionLiftPp.toFixed(2)}pp @ conf ${projectionLiftConfidence.toFixed(2)})`,
    outputSummary: `raw=${dedup.totalRawAdjustmentPp.toFixed(2)}pp, capped=${dedup.totalCappedAdjustmentPp.toFixed(2)}pp`,
    notes: dedup.notes,
    warnings: [],
  });

  // 7. Apply coaching uncertainty drag (negative pp if penalty fires).
  const coachingDragPp =
    coachingPenalty >= 75
      ? -2.0
      : coachingPenalty >= 55
        ? -1.5
        : coachingPenalty >= 40
          ? -1.0
          : coachingPenalty >= 20
            ? -0.5
            : 0;
  trace.push({
    step: "coachingDrag",
    inputSummary: `penalty=${coachingPenalty}`,
    outputSummary: `coaching pp drag ${coachingDragPp.toFixed(2)}`,
    notes: [],
    warnings: coachingDragPp <= -1.0 ? ["Coaching uncertainty significant"] : [],
  });

  // 8. Weather + injury already encoded in the supplied signals (matchup /
  //    proxy modules feed them in). Here we just record a check.
  trace.push({
    step: "weatherInjuryCheck",
    inputSummary: `weather=${input.weatherEnvironmentScore.toFixed(2)} injury=${input.injuryContextScore.toFixed(2)}`,
    outputSummary: "passthrough (signals carry the magnitudes)",
    notes: [],
    warnings: [],
  });

  // 9. Raw model probability via market baseline + capped adjustment.
  //    Each signal's raw deltaPp is scaled by its confidence before
  //    being summed — a 10pp signal at 0.3 confidence contributes
  //    3pp to the market-anchored shift, not 10pp.
  const confidenceWeightedAdjustmentPp = allSignals.reduce(
    (acc, s) => acc + s.deltaPp * s.confidence,
    0,
  );
  const rawAdjustmentPp = confidenceWeightedAdjustmentPp + coachingDragPp;
  const cap = config.maxMarketAdjustmentPp;
  const cappedAdjustmentPp = clamp(rawAdjustmentPp, -cap, cap);
  const modelOver = clamp(
    novig.noVigOver + cappedAdjustmentPp / 100,
    0.02,
    0.98,
  );
  trace.push({
    step: "marketAnchoredAdjustment",
    inputSummary: `baseline ${(novig.noVigOver * 100).toFixed(1)}%, raw weighted pp ${rawAdjustmentPp.toFixed(2)}`,
    outputSummary: `capped ${cappedAdjustmentPp.toFixed(2)}pp → model OVER ${(modelOver * 100).toFixed(1)}%`,
    notes:
      Math.abs(rawAdjustmentPp) > cap
        ? [`Raw adjustment exceeded cap ${cap}pp — capped to ${cappedAdjustmentPp.toFixed(2)}pp`]
        : [],
    warnings:
      Math.abs(rawAdjustmentPp) > cap
        ? ["Football adjustment was capped — high model lift relative to market"]
        : [],
  });

  // 10. Pick the side from edge sign.
  const edgeOver = modelOver - novig.noVigOver;
  const edgeUnder = -edgeOver;
  const side: Side = edgeOver >= edgeUnder ? "OVER" : "UNDER";
  const rawEdge = side === "OVER" ? edgeOver : edgeUnder;
  trace.push({
    step: "selectSide",
    inputSummary: `edgeOver=${(edgeOver * 100).toFixed(2)}pp`,
    outputSummary: `side ${side} rawEdge ${(rawEdge * 100).toFixed(2)}pp`,
    notes: [],
    warnings: [],
  });

  // 11. Line sensitivity.
  const lineSens = calculateLineSensitivity({
    propType: input.propType,
    marketLine: input.marketLine,
    projectedMean: input.projectedMean,
    projectedStdDev: input.projectedStdDev,
    modelOverProbability: modelOver,
    noVigOverProbability: novig.noVigOver,
  });
  trace.push({
    step: "lineSensitivity",
    inputSummary: `line=${input.marketLine}`,
    outputSummary: `${lineSens.lineSensitivityLabel} (fragility ${lineSens.edgeFragilityScore.toFixed(2)})`,
    notes: lineSens.reasons,
    warnings: lineSens.risks,
  });

  // 12. Confidence + risk scores → confidence-adjusted edges.
  const riskScore = deriveRiskScore({
    weatherEnvironmentScore: input.weatherEnvironmentScore,
    injuryContextScore: input.injuryContextScore,
    correlationExposureScore: input.correlationExposureScore,
    coachingPenalty,
  });
  const confidence = deriveConfidence({
    dataQuality: input.dataQualityScore,
    riskScore,
    roleStability: roleStabilityEffective,
    matchupConfidence: input.matchupConfidence,
    proxyConfidence: input.proxyConfidence,
    coachingPenalty,
  });
  const confAdj = calculateConfidenceAdjustedEdge({
    propType: input.propType,
    rawEdge,
    confidence,
    dataQuality: input.dataQualityScore,
    riskScore,
    roleStability: roleStabilityEffective,
    propVolatility: config.defaultVolatilityLevel,
    matchupConfidence: input.matchupConfidence,
    proxyConfidence: input.proxyConfidence,
    coachingUncertaintyPenalty: coachingPenalty,
    weatherRiskScore: input.weatherEnvironmentScore,
    injuryRiskScore: input.injuryContextScore,
  });
  trace.push({
    step: "confidenceAdjustedEdge",
    inputSummary: `raw=${(rawEdge * 100).toFixed(2)}pp, conf=${(confidence * 100).toFixed(0)}%, risk=${riskScore.toFixed(2)}`,
    outputSummary: `${confAdj.edgeQualityClassification}: conf-adj ${(confAdj.confidenceAdjustedEdge * 100).toFixed(2)}pp, risk-adj ${(confAdj.riskAdjustedEdge * 100).toFixed(2)}pp`,
    notes: confAdj.reasons,
    warnings: confAdj.risks,
  });

  // 13. Market disagreement.
  const independentSignals = allSignals.filter(
    (s) => s.independent !== false && s.confidence >= 0.55,
  );
  const hasIndependent = independentSignals.length > 0;
  const disagreement = calculateMarketDisagreement({
    modelProbability: modelOver,
    noVigMarketProbability: novig.noVigOver,
    confidence,
    dataQuality: input.dataQualityScore,
    hasIndependentSignals: hasIndependent,
    independentSignalCount: independentSignals.length,
  });
  trace.push({
    step: "marketDisagreement",
    inputSummary: `model ${(modelOver * 100).toFixed(1)}% vs market ${(novig.noVigOver * 100).toFixed(1)}%`,
    outputSummary: `${disagreement.classification} (|Δ|=${disagreement.disagreementPp.toFixed(1)}pp)`,
    notes: disagreement.reasons,
    warnings: disagreement.risks,
  });

  // 14. Centralized qualification.
  const qualification = qualifyProp({
    propType: input.propType,
    marketLine: input.marketLine,
    marketOverProbability: novig.overImplied,
    noVigOverProbability: novig.noVigOver,
    rawEdge,
    confidenceAdjustedEdge: confAdj.confidenceAdjustedEdge,
    riskAdjustedEdge: confAdj.riskAdjustedEdge,
    side,
    confidence,
    dataQuality: input.dataQualityScore,
    riskScore,
    roleStability: roleStabilityEffective,
    injuryContextScore: input.injuryContextScore,
    weatherEnvironmentScore: input.weatherEnvironmentScore,
    coachingUncertaintyPenalty: coachingPenalty,
    correlationExposureScore: input.correlationExposureScore,
    edgeQuality: confAdj.edgeQualityClassification,
    lineSensitivityLabel: lineSens.lineSensitivityLabel,
    edgeFragilityScore: lineSens.edgeFragilityScore,
    marketDisagreement: disagreement.classification,
    roleTrend: roleTrend?.classification ?? "UNKNOWN_ROLE",
    hasIndependentSignals: hasIndependent,
  });
  trace.push({
    step: "qualification",
    inputSummary: "all gates",
    outputSummary: qualification.qualified
      ? `QUALIFIED ${qualification.recommendation}`
      : `PASS — ${qualification.primaryDisqualifier ?? "n/a"}`,
    notes: qualification.passReasons,
    warnings: qualification.failReasons,
  });

  // 15. Final aggregation.
  const reasons: string[] = [
    ...qualification.passReasons,
    ...confAdj.reasons,
    ...lineSens.reasons,
    ...disagreement.reasons,
    ...(roleTrend ? roleTrend.reasons : []),
  ];
  const risks: string[] = [
    ...qualification.risks,
    ...confAdj.risks,
    ...lineSens.risks,
    ...disagreement.risks,
    ...(roleTrend ? roleTrend.risks : []),
  ];

  return {
    propType: input.propType,
    marketLine: input.marketLine,
    selectedSide: side,
    recommendation: qualification.recommendation,
    qualified: qualification.qualified,
    marketOverProbability: novig.overImplied,
    noVigOverProbability: novig.noVigOver,
    modelOverProbability: modelOver,
    cappedAdjustmentPp,
    rawAdjustmentPp,
    signalDeduplication: dedup,
    rawEdge,
    confidenceAdjustedEdge: confAdj.confidenceAdjustedEdge,
    riskAdjustedEdge: confAdj.riskAdjustedEdge,
    confidenceAdjusted: confAdj,
    roleTrend,
    lineSensitivity: lineSens,
    marketDisagreement: disagreement,
    qualification,
    config,
    confidence,
    riskScore,
    reasons,
    risks,
    disqualifiers: qualification.disqualifiers,
    finalExplanation: qualification.finalExplanation,
    trace,
  };
}
