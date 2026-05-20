import type { PropType, Recommendation } from "../types";
import { americanOddsToImpliedProb } from "../prop-utils";
import { edgeThresholdBumpFromPenalty } from "./coaching-transition";
import type { CoachingTransitionScorecard } from "./coaching-transition-types";

export type Side = "OVER" | "UNDER";

export type VolatilityLevel = "low" | "medium" | "high";

export const DEFAULT_EDGE_THRESHOLD = 0.04;

const GATE_THRESHOLDS = {
  dataQuality: 0.55,
  roleStability: 0.55,
  injuryContext: 0.55,
  correlationExposure: 0.5,
  weatherEnvironment: 0.5,
  gameScript: 0.45,
  pace: 0.45,
  marketContext: 0.45,
} as const;

const RISK_WARN_THRESHOLD = 0.65;

const RISK_BUCKET_LABELS = {
  dataQuality: "data quality",
  roleStability: "role stability",
  injuryContext: "injury context",
  correlationExposure: "correlation exposure",
  weatherEnvironment: "weather / environment",
  gameScript: "game script",
  pace: "pace",
  marketContext: "market context",
} as const;

type RiskKey = keyof typeof GATE_THRESHOLDS;

export interface ScorecardInput {
  scenarioName?: string;
  propId?: string;
  playerName?: string;
  propType: PropType;
  marketLine: number;
  overOdds: number;
  underOdds: number;
  projectedMean: number;
  projectedStdDev: number;
  dataQualityScore: number;
  roleStabilityScore: number;
  gameScriptScore: number;
  paceScore: number;
  marketContextScore: number;
  weatherEnvironmentScore: number;
  injuryContextScore: number;
  correlationExposureScore: number;
  edgeThreshold?: number;
  coachingTransition?: CoachingTransitionScorecard;
}

export interface PropDecisionScorecard {
  scenarioName?: string;
  propId?: string;
  playerName?: string;
  propType: PropType;
  marketLine: number;
  overOdds: number;
  underOdds: number;
  marketOverProbability: number;
  marketUnderProbability: number;
  noVigOverProbability: number;
  noVigUnderProbability: number;
  projectedMean: number;
  projectedStdDev: number;
  modelOverProbability: number;
  modelUnderProbability: number;
  edgeOver: number;
  edgeUnder: number;
  selectedSide: Side;
  edgeThreshold: number;
  recommendation: Recommendation;
  qualified: boolean;
  confidence: number;
  volatilityLevel: VolatilityLevel;
  dataQualityScore: number;
  riskScore: number;
  roleStabilityScore: number;
  gameScriptScore: number;
  paceScore: number;
  marketContextScore: number;
  weatherEnvironmentScore: number;
  injuryContextScore: number;
  correlationExposureScore: number;
  passReasons: string[];
  failReasons: string[];
  reasons: string[];
  risks: string[];
  disqualifiers: string[];
  finalExplanation: string;
  coachingTransition?: CoachingTransitionScorecard;
}

export interface ScorecardSummary {
  identifier: string;
  playerName?: string;
  propType: PropType;
  line: number;
  selectedSide: Side;
  recommendation: Recommendation;
  qualified: boolean;
  edgeLabel: string;
  thresholdLabel: string;
  confidence: number;
  confidenceLabel: "High" | "Medium" | "Low";
  volatilityLevel: VolatilityLevel;
  primaryDisqualifier?: string;
  topReasons: string[];
  topRisks: string[];
  finalExplanation: string;
}

function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const a = Math.abs(x);
  const t = 1.0 / (1.0 + 0.3275911 * a);
  const y =
    1.0 -
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

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function formatPct(value: number): string {
  const pct = value * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

function formatUnsignedPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function classifyVolatility(mean: number, stdDev: number): VolatilityLevel {
  if (mean <= 0 || stdDev <= 0) return "high";
  const cv = stdDev / mean;
  if (cv < 0.18) return "low";
  if (cv < 0.35) return "medium";
  return "high";
}

interface RiskFinding {
  key: RiskKey;
  label: string;
  score: number;
  gate: number;
  severity: number;
  isDisqualifier: boolean;
  isWarning: boolean;
}

function evaluateRisks(input: ScorecardInput): RiskFinding[] {
  const scoresByKey: Record<RiskKey, number> = {
    dataQuality: input.dataQualityScore,
    roleStability: input.roleStabilityScore,
    injuryContext: input.injuryContextScore,
    correlationExposure: input.correlationExposureScore,
    weatherEnvironment: input.weatherEnvironmentScore,
    gameScript: input.gameScriptScore,
    pace: input.paceScore,
    marketContext: input.marketContextScore,
  };

  const findings: RiskFinding[] = [];
  for (const key of Object.keys(scoresByKey) as RiskKey[]) {
    const score = scoresByKey[key];
    const gate = GATE_THRESHOLDS[key];
    const isDisqualifier = score < gate;
    const isWarning = !isDisqualifier && score < RISK_WARN_THRESHOLD;
    findings.push({
      key,
      label: RISK_BUCKET_LABELS[key],
      score,
      gate,
      severity: gate - score,
      isDisqualifier,
      isWarning,
    });
  }
  return findings;
}

export function buildPropDecisionScorecard(
  input: ScorecardInput,
): PropDecisionScorecard {
  const baseEdgeThreshold = input.edgeThreshold ?? DEFAULT_EDGE_THRESHOLD;
  const coachingTransition = input.coachingTransition;
  const coachingThresholdBumpPp = coachingTransition
    ? edgeThresholdBumpFromPenalty(
        coachingTransition.scores.coachingUncertaintyPenalty,
      )
    : 0;
  const edgeThreshold = baseEdgeThreshold + coachingThresholdBumpPp / 100;

  const marketOverProbability = americanOddsToImpliedProb(input.overOdds);
  const marketUnderProbability = americanOddsToImpliedProb(input.underOdds);
  const overround = marketOverProbability + marketUnderProbability;
  const noVigOverProbability =
    overround > 0 ? marketOverProbability / overround : 0.5;
  const noVigUnderProbability = 1 - noVigOverProbability;

  const std = Math.max(input.projectedStdDev, 1e-6);
  const z = (input.marketLine - input.projectedMean) / std;
  const modelUnderProbability = clamp(normalCdf(z), 0, 1);
  const modelOverProbability = 1 - modelUnderProbability;

  const edgeOver = modelOverProbability - noVigOverProbability;
  const edgeUnder = modelUnderProbability - noVigUnderProbability;
  const selectedSide: Side = edgeOver >= edgeUnder ? "OVER" : "UNDER";
  const selectedEdge = selectedSide === "OVER" ? edgeOver : edgeUnder;

  const riskFindings = evaluateRisks(input);
  const riskScore =
    riskFindings.reduce((acc, f) => acc + f.score, 0) / riskFindings.length;

  const edgeBelowThreshold = selectedEdge < edgeThreshold;
  const failingGates = riskFindings
    .filter((f) => f.isDisqualifier)
    .sort((a, b) => b.severity - a.severity);
  const warningGates = riskFindings
    .filter((f) => f.isWarning)
    .sort((a, b) => a.score - b.score);

  const disqualifiers: string[] = [];
  if (edgeBelowThreshold) {
    disqualifiers.push(
      `Edge of ${formatPct(selectedEdge)} on ${selectedSide} below ${formatUnsignedPct(edgeThreshold)} threshold`,
    );
  }
  for (const f of failingGates) {
    disqualifiers.push(
      `${capitalize(f.label)} score ${f.score.toFixed(2)} below ${f.gate.toFixed(2)} gate`,
    );
  }

  const qualified = disqualifiers.length === 0;
  const recommendation: Recommendation = qualified ? selectedSide : "PASS";

  const passReasons: string[] = [];
  const failReasons: string[] = [];
  const risks: string[] = [];

  if (!edgeBelowThreshold) {
    passReasons.push(
      `Model edge of ${formatPct(selectedEdge)} on ${selectedSide} clears ${formatUnsignedPct(edgeThreshold)} threshold`,
    );
    passReasons.push(
      `Model projects ${formatUnsignedPct(selectedSide === "OVER" ? modelOverProbability : modelUnderProbability)} hit rate vs no-vig ${formatUnsignedPct(selectedSide === "OVER" ? noVigOverProbability : noVigUnderProbability)}`,
    );
  } else {
    failReasons.push(
      `Edge of ${formatPct(selectedEdge)} on ${selectedSide} below ${formatUnsignedPct(edgeThreshold)} threshold`,
    );
  }

  if (failingGates.length === 0) {
    passReasons.push(
      `Composite risk score ${riskScore.toFixed(2)} clears all gates`,
    );
  } else {
    for (const f of failingGates) {
      failReasons.push(
        `${capitalize(f.label)} ${f.score.toFixed(2)} below ${f.gate.toFixed(2)} gate`,
      );
    }
  }

  for (const f of warningGates) {
    risks.push(
      `${capitalize(f.label)} ${f.score.toFixed(2)} (above ${f.gate.toFixed(2)} gate but below ${RISK_WARN_THRESHOLD.toFixed(2)} comfort zone)`,
    );
  }
  for (const f of failingGates) {
    risks.push(
      `${capitalize(f.label)} ${f.score.toFixed(2)} below ${f.gate.toFixed(2)} gate`,
    );
  }

  const volatilityLevel = classifyVolatility(
    input.projectedMean,
    input.projectedStdDev,
  );
  if (volatilityLevel === "high") {
    risks.push(
      `High projection variance (σ ${input.projectedStdDev.toFixed(1)} on μ ${input.projectedMean.toFixed(1)})`,
    );
  }

  if (coachingTransition) {
    if (coachingThresholdBumpPp > 0) {
      const bumpReason = `Edge threshold bumped to ${formatUnsignedPct(edgeThreshold)} for coaching uncertainty (penalty ${coachingTransition.scores.coachingUncertaintyPenalty})`;
      if (qualified) passReasons.push(bumpReason);
      else failReasons.push(bumpReason);
    }
    for (const w of coachingTransition.warnings) risks.push(w);
    if (qualified) passReasons.push(coachingTransition.summary);
  }

  const reasons = qualified ? [...passReasons] : [...failReasons];

  const edgeMagnitude = Math.abs(selectedEdge);
  const edgeStrength = clamp(edgeMagnitude / 0.2, 0, 1);
  const coachingConfidenceDrag = coachingTransition
    ? (coachingTransition.scores.coachingUncertaintyPenalty / 100) * 0.5
    : 0;
  const confidence = qualified
    ? clamp(
        0.5 + 0.3 * edgeStrength + 0.2 * riskScore - coachingConfidenceDrag,
        0.5,
        0.98,
      )
    : clamp(
        0.15 + 0.2 * edgeStrength + 0.2 * riskScore - coachingConfidenceDrag,
        0.05,
        0.55,
      );

  const finalExplanation = buildFinalExplanation({
    qualified,
    selectedSide,
    selectedEdge,
    edgeThreshold,
    edgeBelowThreshold,
    failingGates,
    riskScore,
    propType: input.propType,
    marketLine: input.marketLine,
    playerName: input.playerName,
  });

  return {
    scenarioName: input.scenarioName,
    propId: input.propId,
    playerName: input.playerName,
    propType: input.propType,
    marketLine: input.marketLine,
    overOdds: input.overOdds,
    underOdds: input.underOdds,
    marketOverProbability,
    marketUnderProbability,
    noVigOverProbability,
    noVigUnderProbability,
    projectedMean: input.projectedMean,
    projectedStdDev: input.projectedStdDev,
    modelOverProbability,
    modelUnderProbability,
    edgeOver,
    edgeUnder,
    selectedSide,
    edgeThreshold,
    recommendation,
    qualified,
    confidence,
    volatilityLevel,
    dataQualityScore: input.dataQualityScore,
    riskScore,
    roleStabilityScore: input.roleStabilityScore,
    gameScriptScore: input.gameScriptScore,
    paceScore: input.paceScore,
    marketContextScore: input.marketContextScore,
    weatherEnvironmentScore: input.weatherEnvironmentScore,
    injuryContextScore: input.injuryContextScore,
    correlationExposureScore: input.correlationExposureScore,
    passReasons,
    failReasons,
    reasons,
    risks,
    disqualifiers,
    finalExplanation,
    coachingTransition,
  };
}

function buildFinalExplanation(args: {
  qualified: boolean;
  selectedSide: Side;
  selectedEdge: number;
  edgeThreshold: number;
  edgeBelowThreshold: boolean;
  failingGates: RiskFinding[];
  riskScore: number;
  propType: PropType;
  marketLine: number;
  playerName?: string;
}): string {
  const who = args.playerName ? `${args.playerName} ` : "";
  const subject = `${who}${args.propType} ${args.marketLine}`;

  if (args.qualified) {
    return `${args.selectedSide} qualifies on ${subject}: model edge of ${formatPct(args.selectedEdge)} clears ${formatUnsignedPct(args.edgeThreshold)} threshold and all risk gates pass (composite ${args.riskScore.toFixed(2)}).`;
  }

  if (args.edgeBelowThreshold && args.failingGates.length === 0) {
    return `PASS on ${subject}: edge of ${formatPct(args.selectedEdge)} on ${args.selectedSide} is below the ${formatUnsignedPct(args.edgeThreshold)} threshold.`;
  }

  if (!args.edgeBelowThreshold && args.failingGates.length > 0) {
    const primary = args.failingGates[0];
    const extra =
      args.failingGates.length > 1
        ? ` Additional gate failures: ${args.failingGates
            .slice(1)
            .map((f) => f.label)
            .join(", ")}.`
        : "";
    return `PASS on ${subject}: ${args.selectedSide} edge of ${formatPct(args.selectedEdge)} would qualify, but ${primary.label} score ${primary.score.toFixed(2)} is below the ${primary.gate.toFixed(2)} gate.${extra}`;
  }

  const primary = args.failingGates[0];
  return `PASS on ${subject}: edge of ${formatPct(args.selectedEdge)} on ${args.selectedSide} is below the ${formatUnsignedPct(args.edgeThreshold)} threshold, and ${primary.label} score ${primary.score.toFixed(2)} is below its ${primary.gate.toFixed(2)} gate.`;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function getPrimaryDisqualifier(
  scorecard: PropDecisionScorecard,
): string | undefined {
  return scorecard.disqualifiers[0];
}

export function getTopReasons(
  scorecard: PropDecisionScorecard,
  n = 3,
): string[] {
  return scorecard.reasons.slice(0, n);
}

export function getTopRisks(
  scorecard: PropDecisionScorecard,
  n = 3,
): string[] {
  return scorecard.risks.slice(0, n);
}

function confidenceLabelOf(confidence: number): "High" | "Medium" | "Low" {
  if (confidence >= 0.75) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

export function summarizeScorecardForUI(
  scorecard: PropDecisionScorecard,
): ScorecardSummary {
  const identifier =
    scorecard.scenarioName ?? scorecard.propId ?? "(unidentified prop)";
  const selectedEdge =
    scorecard.selectedSide === "OVER" ? scorecard.edgeOver : scorecard.edgeUnder;
  return {
    identifier,
    playerName: scorecard.playerName,
    propType: scorecard.propType,
    line: scorecard.marketLine,
    selectedSide: scorecard.selectedSide,
    recommendation: scorecard.recommendation,
    qualified: scorecard.qualified,
    edgeLabel: formatPct(selectedEdge),
    thresholdLabel: formatUnsignedPct(scorecard.edgeThreshold),
    confidence: scorecard.confidence,
    confidenceLabel: confidenceLabelOf(scorecard.confidence),
    volatilityLevel: scorecard.volatilityLevel,
    primaryDisqualifier: getPrimaryDisqualifier(scorecard),
    topReasons: getTopReasons(scorecard),
    topRisks: getTopRisks(scorecard),
    finalExplanation: scorecard.finalExplanation,
  };
}
