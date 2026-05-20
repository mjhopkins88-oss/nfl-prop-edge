/**
 * Proxy accuracy validation.
 *
 * Consumes `BacktestEvaluatedProp[]` (each carrying an optional
 * `proxies: AllFootballProxies`) and produces per-proxy performance
 * breakdowns, lift vs baseline, and false-positive / false-negative
 * examples.
 *
 * The framework does NOT touch model recommendations. It is pure
 * post-hoc analysis: given the proxy outputs already attached to
 * graded props, compute whether each proxy correlates with actual
 * outcomes.
 */

import type { PropType, Recommendation } from "../types";
import type {
  AllFootballProxies,
  ProxyResult,
} from "../model/proxy-football-feature-types";
import type { BacktestBetResult, BacktestEvaluatedProp } from "./types";

// --- buckets ---------------------------------------------------------

export type ProxyBucket = "LOW" | "MEDIUM" | "HIGH";

export interface ProxyBucketThresholds {
  low: number;
  high: number;
}

export const DEFAULT_PROXY_THRESHOLDS: ProxyBucketThresholds = {
  low: 0.35,
  high: 0.65,
};

export function bucketProxyValue(
  value: number,
  thresholds: ProxyBucketThresholds = DEFAULT_PROXY_THRESHOLDS,
): ProxyBucket {
  if (value < thresholds.low) return "LOW";
  if (value > thresholds.high) return "HIGH";
  return "MEDIUM";
}

export function bucketProxyConfidence(
  confidence: number,
  thresholds: ProxyBucketThresholds = DEFAULT_PROXY_THRESHOLDS,
): ProxyBucket {
  if (confidence < thresholds.low) return "LOW";
  if (confidence > thresholds.high) return "HIGH";
  return "MEDIUM";
}

// --- proxy name → relevant prop types --------------------------------

export type ProxyName =
  | "slotRoleProxy"
  | "deepReceiverProxy"
  | "possessionReceiverProxy"
  | "rbReceivingRoleProxy"
  | "teReceivingRoleProxy"
  | "targetShareStabilityProxy"
  | "passFunnelProxy"
  | "runFunnelProxy"
  | "deepPassSuppressionProxy"
  | "pressureRiskProxy"
  | "quickGameProxy"
  | "rushingVolumeStabilityProxy";

export const PROXY_NAMES: readonly ProxyName[] = [
  "slotRoleProxy",
  "deepReceiverProxy",
  "possessionReceiverProxy",
  "rbReceivingRoleProxy",
  "teReceivingRoleProxy",
  "targetShareStabilityProxy",
  "passFunnelProxy",
  "runFunnelProxy",
  "deepPassSuppressionProxy",
  "pressureRiskProxy",
  "quickGameProxy",
  "rushingVolumeStabilityProxy",
] as const;

export const RELEVANT_PROP_TYPES_BY_PROXY: Record<ProxyName, PropType[]> = {
  slotRoleProxy: ["RECEPTIONS"],
  deepReceiverProxy: ["RECEIVING_YARDS"],
  possessionReceiverProxy: ["RECEPTIONS"],
  rbReceivingRoleProxy: ["RECEPTIONS", "RECEIVING_YARDS"],
  teReceivingRoleProxy: ["RECEPTIONS", "RECEIVING_YARDS"],
  targetShareStabilityProxy: ["RECEPTIONS"],
  passFunnelProxy: ["PASSING_ATTEMPTS", "PASSING_COMPLETIONS", "RECEPTIONS"],
  runFunnelProxy: ["RUSHING_ATTEMPTS", "RUSHING_YARDS"],
  deepPassSuppressionProxy: ["RECEIVING_YARDS", "PASSING_YARDS"],
  pressureRiskProxy: ["PASSING_YARDS", "RECEIVING_YARDS"],
  quickGameProxy: ["PASSING_COMPLETIONS", "RECEPTIONS"],
  rushingVolumeStabilityProxy: ["RUSHING_ATTEMPTS"],
};

// --- result types ---------------------------------------------------

export interface ProxyBucketSummary {
  evaluated: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  averageEdge: number;
  averageModelProbability: number;
  averageMarketProbability: number;
  averageConfidence: number;
  profitUnits: number;
}

export interface ProxyPerformanceSummary {
  proxyName: ProxyName;
  relevantPropTypes: PropType[];
  evaluated: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  averageEdge: number;
  averageModelProbability: number;
  averageMarketProbability: number;
  averageProxyValue: number;
  averageProxyConfidence: number;
  byValueBucket: Record<ProxyBucket, ProxyBucketSummary>;
  byConfidenceBucket: Record<ProxyBucket, ProxyBucketSummary>;
  whenBothHigh: ProxyBucketSummary;
}

export type ProxyLiftRecommendation = "KEEP" | "RECALIBRATE" | "RETIRE";

export interface ProxyLiftEntry {
  proxyName: ProxyName;
  baselineBets: number;
  baselineRoiPct: number;
  highValueBets: number;
  highValueRoiPct: number;
  highConfidenceBets: number;
  highConfidenceRoiPct: number;
  highBothBets: number;
  highBothRoiPct: number;
  /** Lift = highBoth ROI − baseline ROI (in percentage points). */
  liftVsBaselinePp: number;
  recommendation: ProxyLiftRecommendation;
  notes: string[];
}

export interface ProxyFalseExample {
  propId: string;
  player: string;
  team: string;
  opponent: string;
  propType: PropType;
  line: number;
  proxyName: ProxyName;
  proxyValue: number;
  proxyConfidence: number;
  recommendation: Recommendation;
  result: BacktestBetResult;
  actualStat: number | null;
  edge: number;
  explanation: string;
}

export type ProxyFalsePositive = ProxyFalseExample;
export type ProxyFalseNegative = ProxyFalseExample;

export interface ProxyAccuracyReport {
  generatedAt: string;
  totalEvaluatedProps: number;
  propsWithProxies: number;
  bestProxy?: ProxyName;
  worstProxy?: ProxyName;
  performance: Record<ProxyName, ProxyPerformanceSummary>;
  lift: ProxyLiftEntry[];
  falsePositives: ProxyFalsePositive[];
  falseNegatives: ProxyFalseNegative[];
  comparison: ProxyComparisonResult;
}

export interface ProxyComparisonResult {
  proxySupported: ProxyBucketSummary;
  proxyUnsupported: ProxyBucketSummary;
  hitRateDeltaPp: number;
  roiDeltaPp: number;
}

// --- helpers --------------------------------------------------------

function isBet(p: BacktestEvaluatedProp): boolean {
  return p.qualified && p.recommendation !== "PASS";
}

function americanPayout(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

function selectedSideMarketProbability(p: BacktestEvaluatedProp): number {
  const noVigOver =
    p.marketOverProbability /
    (p.marketOverProbability + p.marketUnderProbability || 1);
  return p.selectedSide === "OVER" ? noVigOver : 1 - noVigOver;
}

function emptyBucketSummary(): ProxyBucketSummary {
  return {
    evaluated: 0,
    bets: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    hitRate: 0,
    roiPct: 0,
    averageEdge: 0,
    averageModelProbability: 0,
    averageMarketProbability: 0,
    averageConfidence: 0,
    profitUnits: 0,
  };
}

function aggregateBucket(
  evaluated: BacktestEvaluatedProp[],
  proxyName?: ProxyName,
): ProxyBucketSummary {
  const bets = evaluated.filter(isBet);
  const wins = bets.filter((p) => p.result === "WIN").length;
  const losses = bets.filter((p) => p.result === "LOSS").length;
  const pushes = bets.filter((p) => p.result === "PUSH").length;
  const profit = bets.reduce((acc, p) => acc + p.profitLossUnits, 0);
  const decided = wins + losses;
  const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const modelProbs = evaluated.map((p) =>
    p.selectedSide === "OVER" ? p.modelOverProbability : p.modelUnderProbability,
  );
  const marketProbs = evaluated.map(selectedSideMarketProbability);
  const edges = evaluated.map((p) => p.edge);
  const confidences = proxyName
    ? evaluated
        .map((p) => readProxyResult(p.proxies, proxyName)?.confidence)
        .filter((c): c is number => typeof c === "number")
    : evaluated.map((p) => p.confidence);
  return {
    evaluated: evaluated.length,
    bets: bets.length,
    wins,
    losses,
    pushes,
    hitRate: decided > 0 ? wins / decided : 0,
    roiPct: bets.length > 0 ? (profit / bets.length) * 100 : 0,
    averageEdge: avg(edges),
    averageModelProbability: avg(modelProbs),
    averageMarketProbability: avg(marketProbs),
    averageConfidence: avg(confidences),
    profitUnits: profit,
  };
}

export function readProxyResult(
  proxies: AllFootballProxies | undefined,
  name: ProxyName,
): ProxyResult | undefined {
  if (!proxies) return undefined;
  switch (name) {
    case "slotRoleProxy":
      return proxies.player.slotRoleProxy;
    case "deepReceiverProxy":
      return proxies.player.deepReceiverProxy;
    case "possessionReceiverProxy":
      return proxies.player.possessionReceiverProxy;
    case "rbReceivingRoleProxy":
      return proxies.player.rbReceivingRoleProxy;
    case "teReceivingRoleProxy":
      return proxies.player.teReceivingRoleProxy;
    case "targetShareStabilityProxy":
      return proxies.player.targetShareStabilityProxy;
    case "passFunnelProxy":
      return proxies.defense.passFunnelProxy;
    case "runFunnelProxy":
      return proxies.defense.runFunnelProxy;
    case "deepPassSuppressionProxy":
      return proxies.defense.deepPassSuppressionProxy;
    case "pressureRiskProxy":
      return proxies.offense.pressureRiskProxy;
    case "quickGameProxy":
      return proxies.offense.quickGameProxy;
    case "rushingVolumeStabilityProxy":
      return proxies.offense.rushingVolumeStabilityProxy;
  }
}

// --- per-proxy summary ----------------------------------------------

function relevantPropsFor(
  props: BacktestEvaluatedProp[],
  proxyName: ProxyName,
): BacktestEvaluatedProp[] {
  const relevant = new Set<PropType>(RELEVANT_PROP_TYPES_BY_PROXY[proxyName]);
  return props.filter(
    (p) => relevant.has(p.propType) && readProxyResult(p.proxies, proxyName) !== undefined,
  );
}

function summarizeProxyOne(
  props: BacktestEvaluatedProp[],
  proxyName: ProxyName,
  thresholds: ProxyBucketThresholds,
): ProxyPerformanceSummary {
  const relevant = relevantPropsFor(props, proxyName);
  const byValueBucket: Record<ProxyBucket, ProxyBucketSummary> = {
    LOW: emptyBucketSummary(),
    MEDIUM: emptyBucketSummary(),
    HIGH: emptyBucketSummary(),
  };
  const byConfidenceBucket: Record<ProxyBucket, ProxyBucketSummary> = {
    LOW: emptyBucketSummary(),
    MEDIUM: emptyBucketSummary(),
    HIGH: emptyBucketSummary(),
  };

  const valueBuckets = new Map<ProxyBucket, BacktestEvaluatedProp[]>();
  const confidenceBuckets = new Map<ProxyBucket, BacktestEvaluatedProp[]>();
  const bothHigh: BacktestEvaluatedProp[] = [];
  let totalValue = 0;
  let totalConfidence = 0;

  for (const p of relevant) {
    const r = readProxyResult(p.proxies, proxyName);
    if (!r) continue;
    const vBucket = bucketProxyValue(r.value, thresholds);
    const cBucket = bucketProxyConfidence(r.confidence, thresholds);
    if (!valueBuckets.has(vBucket)) valueBuckets.set(vBucket, []);
    valueBuckets.get(vBucket)!.push(p);
    if (!confidenceBuckets.has(cBucket)) confidenceBuckets.set(cBucket, []);
    confidenceBuckets.get(cBucket)!.push(p);
    if (vBucket === "HIGH" && cBucket === "HIGH") bothHigh.push(p);
    totalValue += r.value;
    totalConfidence += r.confidence;
  }

  for (const bucket of ["LOW", "MEDIUM", "HIGH"] as ProxyBucket[]) {
    byValueBucket[bucket] = aggregateBucket(
      valueBuckets.get(bucket) ?? [],
      proxyName,
    );
    byConfidenceBucket[bucket] = aggregateBucket(
      confidenceBuckets.get(bucket) ?? [],
      proxyName,
    );
  }

  const overall = aggregateBucket(relevant, proxyName);
  return {
    proxyName,
    relevantPropTypes: RELEVANT_PROP_TYPES_BY_PROXY[proxyName],
    evaluated: overall.evaluated,
    bets: overall.bets,
    wins: overall.wins,
    losses: overall.losses,
    pushes: overall.pushes,
    hitRate: overall.hitRate,
    roiPct: overall.roiPct,
    averageEdge: overall.averageEdge,
    averageModelProbability: overall.averageModelProbability,
    averageMarketProbability: overall.averageMarketProbability,
    averageProxyValue: relevant.length > 0 ? totalValue / relevant.length : 0,
    averageProxyConfidence:
      relevant.length > 0 ? totalConfidence / relevant.length : 0,
    byValueBucket,
    byConfidenceBucket,
    whenBothHigh: aggregateBucket(bothHigh, proxyName),
  };
}

export function summarizeProxyPerformance(
  props: BacktestEvaluatedProp[],
  thresholds: ProxyBucketThresholds = DEFAULT_PROXY_THRESHOLDS,
): Record<ProxyName, ProxyPerformanceSummary> {
  const out = {} as Record<ProxyName, ProxyPerformanceSummary>;
  for (const name of PROXY_NAMES) {
    out[name] = summarizeProxyOne(props, name, thresholds);
  }
  return out;
}

// --- lift -----------------------------------------------------------

const LIFT_KEEP_THRESHOLD_PP = 5;
const LIFT_RETIRE_THRESHOLD_PP = 0;

export function calculateProxyLift(
  props: BacktestEvaluatedProp[],
  thresholds: ProxyBucketThresholds = DEFAULT_PROXY_THRESHOLDS,
): ProxyLiftEntry[] {
  return PROXY_NAMES.map((name) => {
    const relevant = relevantPropsFor(props, name);
    const baseline = relevant.filter((p) => {
      const r = readProxyResult(p.proxies, name);
      if (!r) return false;
      return (
        bucketProxyValue(r.value, thresholds) === "LOW" ||
        bucketProxyConfidence(r.confidence, thresholds) === "LOW"
      );
    });
    const highValue = relevant.filter((p) => {
      const r = readProxyResult(p.proxies, name);
      return r && bucketProxyValue(r.value, thresholds) === "HIGH";
    });
    const highConfidence = relevant.filter((p) => {
      const r = readProxyResult(p.proxies, name);
      return r && bucketProxyConfidence(r.confidence, thresholds) === "HIGH";
    });
    const highBoth = relevant.filter((p) => {
      const r = readProxyResult(p.proxies, name);
      return (
        r &&
        bucketProxyValue(r.value, thresholds) === "HIGH" &&
        bucketProxyConfidence(r.confidence, thresholds) === "HIGH"
      );
    });

    const baselineAgg = aggregateBucket(baseline, name);
    const highValueAgg = aggregateBucket(highValue, name);
    const highConfidenceAgg = aggregateBucket(highConfidence, name);
    const highBothAgg = aggregateBucket(highBoth, name);

    const liftVsBaselinePp = highBothAgg.roiPct - baselineAgg.roiPct;
    let recommendation: ProxyLiftRecommendation;
    const notes: string[] = [];
    if (highBothAgg.bets < 3 || baselineAgg.bets < 3) {
      recommendation = "RECALIBRATE";
      notes.push("Insufficient bet sample — recommendation provisional");
    } else if (liftVsBaselinePp >= LIFT_KEEP_THRESHOLD_PP) {
      recommendation = "KEEP";
    } else if (liftVsBaselinePp < LIFT_RETIRE_THRESHOLD_PP) {
      recommendation = "RETIRE";
      notes.push("High-both performs worse than baseline");
    } else {
      recommendation = "RECALIBRATE";
      notes.push("Lift positive but below KEEP threshold");
    }
    return {
      proxyName: name,
      baselineBets: baselineAgg.bets,
      baselineRoiPct: baselineAgg.roiPct,
      highValueBets: highValueAgg.bets,
      highValueRoiPct: highValueAgg.roiPct,
      highConfidenceBets: highConfidenceAgg.bets,
      highConfidenceRoiPct: highConfidenceAgg.roiPct,
      highBothBets: highBothAgg.bets,
      highBothRoiPct: highBothAgg.roiPct,
      liftVsBaselinePp,
      recommendation,
      notes,
    };
  });
}

// --- false positive / false negative -------------------------------

const FP_VALUE_FLOOR = 0.65;
const FP_CONFIDENCE_FLOOR = 0.5;
const FN_VALUE_CEILING = 0.35;
const FN_CONFIDENCE_CEILING = 0.5;

function buildExample(
  prop: BacktestEvaluatedProp,
  proxyName: ProxyName,
  r: ProxyResult,
  explanation: string,
): ProxyFalseExample {
  return {
    propId: prop.id,
    player: prop.playerName,
    team: prop.team,
    opponent: prop.opponent,
    propType: prop.propType,
    line: prop.line,
    proxyName,
    proxyValue: r.value,
    proxyConfidence: r.confidence,
    recommendation: prop.recommendation,
    result: prop.result,
    actualStat: prop.actualStat,
    edge: prop.edge,
    explanation,
  };
}

export function findProxyFalsePositives(
  props: BacktestEvaluatedProp[],
  options?: { valueFloor?: number; confidenceFloor?: number },
): ProxyFalsePositive[] {
  const valueFloor = options?.valueFloor ?? FP_VALUE_FLOOR;
  const confidenceFloor = options?.confidenceFloor ?? FP_CONFIDENCE_FLOOR;
  const out: ProxyFalsePositive[] = [];
  for (const name of PROXY_NAMES) {
    const relevant = relevantPropsFor(props, name);
    for (const p of relevant) {
      const r = readProxyResult(p.proxies, name);
      if (!r) continue;
      // False positive: proxy fired strongly AND the actual graded
      // result lost (i.e., proxy implied "support this side" but the
      // bet went the other way).
      const proxyFiredStrongly =
        r.value >= valueFloor && r.confidence >= confidenceFloor;
      const adverseOutcome =
        (p.result === "LOSS" && isBet(p)) ||
        (p.result === "PASS" && p.counterfactualResult === "LOSS");
      if (proxyFiredStrongly && adverseOutcome) {
        out.push(
          buildExample(
            p,
            name,
            r,
            `Proxy ${name} fired at value ${r.value.toFixed(2)} / confidence ${r.confidence.toFixed(2)} but ${name === "deepPassSuppressionProxy" || name === "pressureRiskProxy" ? "the related bet still lost" : "the prop did not hit"}`,
          ),
        );
      }
    }
  }
  return out;
}

export function findProxyFalseNegatives(
  props: BacktestEvaluatedProp[],
  options?: { valueCeiling?: number; confidenceCeiling?: number },
): ProxyFalseNegative[] {
  const valueCeiling = options?.valueCeiling ?? FN_VALUE_CEILING;
  const confidenceCeiling = options?.confidenceCeiling ?? FN_CONFIDENCE_CEILING;
  const out: ProxyFalseNegative[] = [];
  for (const name of PROXY_NAMES) {
    const relevant = relevantPropsFor(props, name);
    for (const p of relevant) {
      const r = readProxyResult(p.proxies, name);
      if (!r) continue;
      // False negative: proxy was weak / unsure AND the related bet
      // actually hit (we should have leaned in / the model would have
      // benefited if it leaned in).
      const proxyWeak =
        r.value <= valueCeiling || r.confidence <= confidenceCeiling;
      const goodOutcome =
        (p.result === "WIN" && isBet(p)) ||
        (p.result === "PASS" && p.counterfactualResult === "WIN");
      if (proxyWeak && goodOutcome) {
        out.push(
          buildExample(
            p,
            name,
            r,
            `Proxy ${name} weak (value ${r.value.toFixed(2)} / confidence ${r.confidence.toFixed(2)}) yet ${p.result === "PASS" ? "the model-leaning side would have hit" : "the bet won"}`,
          ),
        );
      }
    }
  }
  return out;
}

// --- with vs without proxies ----------------------------------------

function hasAnyProxySupport(
  prop: BacktestEvaluatedProp,
  thresholds: ProxyBucketThresholds,
): boolean {
  if (!prop.proxies) return false;
  for (const name of PROXY_NAMES) {
    const relevant = RELEVANT_PROP_TYPES_BY_PROXY[name];
    if (!relevant.includes(prop.propType)) continue;
    const r = readProxyResult(prop.proxies, name);
    if (!r) continue;
    if (
      bucketProxyValue(r.value, thresholds) === "HIGH" &&
      bucketProxyConfidence(r.confidence, thresholds) === "HIGH"
    ) {
      return true;
    }
  }
  return false;
}

export function compareModelWithAndWithoutProxies(
  props: BacktestEvaluatedProp[],
  thresholds: ProxyBucketThresholds = DEFAULT_PROXY_THRESHOLDS,
): ProxyComparisonResult {
  const supported = props.filter((p) => hasAnyProxySupport(p, thresholds));
  const unsupported = props.filter((p) => !hasAnyProxySupport(p, thresholds));
  const supportedAgg = aggregateBucket(supported);
  const unsupportedAgg = aggregateBucket(unsupported);
  return {
    proxySupported: supportedAgg,
    proxyUnsupported: unsupportedAgg,
    hitRateDeltaPp: (supportedAgg.hitRate - unsupportedAgg.hitRate) * 100,
    roiDeltaPp: supportedAgg.roiPct - unsupportedAgg.roiPct,
  };
}

// --- top-level report builder ---------------------------------------

export function buildProxyAccuracyReport(
  props: BacktestEvaluatedProp[],
  thresholds: ProxyBucketThresholds = DEFAULT_PROXY_THRESHOLDS,
): ProxyAccuracyReport {
  const performance = summarizeProxyPerformance(props, thresholds);
  const lift = calculateProxyLift(props, thresholds);
  const falsePositives = findProxyFalsePositives(props);
  const falseNegatives = findProxyFalseNegatives(props);
  const comparison = compareModelWithAndWithoutProxies(props, thresholds);

  // best / worst proxy by lift (only proxies with bet samples >= 3 on both sides).
  const ranked = [...lift].sort((a, b) => b.liftVsBaselinePp - a.liftVsBaselinePp);
  const eligible = ranked.filter(
    (l) => l.highBothBets >= 3 && l.baselineBets >= 3,
  );
  const bestProxy = (eligible[0] ?? ranked[0])?.proxyName;
  const worstProxy = (eligible[eligible.length - 1] ?? ranked[ranked.length - 1])?.proxyName;

  return {
    generatedAt: new Date().toISOString(),
    totalEvaluatedProps: props.length,
    propsWithProxies: props.filter((p) => p.proxies !== undefined).length,
    bestProxy,
    worstProxy,
    performance,
    lift,
    falsePositives,
    falseNegatives,
    comparison,
  };
}
