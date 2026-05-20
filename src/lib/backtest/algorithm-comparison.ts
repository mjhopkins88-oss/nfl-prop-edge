/**
 * V1 vs V2 player-prop backtest comparison runner.
 *
 * Runs the existing `runBacktest` twice on the same fixtures —
 * once in V1_SCORECARD mode, once in V2_PIPELINE mode — and
 * produces a side-by-side comparison object plus a
 * recommendation-change ledger. Does not call any APIs, does not
 * change the live dashboard, and does not graduate the v2
 * pipeline to default. Pure CPU on stored / fixture data.
 *
 * Output shape:
 *   { v1Summary, v2Summary, deltaSummary, recommendationChangeSummary }
 *
 * The `recommendationChangeSummary` is keyed by change type so we
 * can answer "what did v2 actually change?" without re-walking the
 * raw arrays.
 */

import type {
  BacktestEvaluatedProp,
  BacktestPropTypeSummary,
  BacktestPerformanceBreakdown,
  BacktestEdgeBucketSummary,
  BacktestConfidenceBucketSummary,
  BacktestDisqualifierSummary,
  BacktestSummary,
  BacktestScope,
} from "./types";
import { runBacktest } from "./runner";
import type { V2BacktestMetadata } from "./v2-pipeline-adapter";
import { loadBacktestFixtures, type LoadedBacktestFixtures } from "./data-loader";

export type RecommendationChangeKind =
  | "SAME_BET"
  | "V1_BET_V2_PASS"
  | "V1_PASS_V2_BET"
  | "OPPOSITE_SIDE"
  | "SAME_PASS_DIFFERENT_REASON"
  | "SAME_RECOMMENDATION_DIFFERENT_CONFIDENCE";

export interface RecommendationChange {
  propMarketId: string;
  playerName: string;
  propType: string;
  marketLine: number;
  kind: RecommendationChangeKind;
  v1Recommendation: string;
  v2Recommendation: string;
  v1Qualified: boolean;
  v2Qualified: boolean;
  v1PrimaryDisqualifier?: string;
  v2PrimaryDisqualifier?: string;
  v1Edge: number;
  v2Edge: number;
  v2ConfidenceAdjustedEdge: number;
  v1Confidence: number;
  v2Confidence: number;
}

export interface RecommendationChangeSummary {
  totalEvaluated: number;
  counts: Record<RecommendationChangeKind, number>;
  v1OnlyBets: number;
  v2OnlyBets: number;
  oppositeSides: number;
  changes: RecommendationChange[];
  /**
   * Disqualifier text → how many props v2 PASSed that v1 would
   * have bet. Lets us see which new gate is "saving" us most.
   */
  topNewV2Disqualifiers: Array<{ disqualifier: string; count: number }>;
}

export interface AlgorithmDeltaSummary {
  evaluatedDelta: number;
  qualifiedBetsDelta: number;
  passesDelta: number;
  hitRateDelta: number;
  roiPctDelta: number;
  averageEdgeDelta: number;
  /**
   * Average v2 confidence-adjusted edge across v2 bets (no v1
   * counterpart — v1 does not compute conf-adj edge).
   */
  v2AverageConfidenceAdjustedEdge: number;
  winsDelta: number;
  lossesDelta: number;
  pushesDelta: number;
  profitUnitsDelta: number;
  brierScoreDelta: number;
  /** Per-prop-type ROI delta (v2 − v1). */
  byPropType: Array<{
    propType: string;
    v1Roi: number;
    v2Roi: number;
    delta: number;
  }>;
  /** Per-line-bucket ROI delta. */
  byLineBucket: Array<{ bucket: string; v1Roi: number; v2Roi: number; delta: number }>;
  /** Per-confidence-bucket ROI delta. */
  byConfidenceBucket: Array<{
    bucket: string;
    v1Roi: number;
    v2Roi: number;
    delta: number;
  }>;
  /** Per-edge-bucket ROI delta. */
  byEdgeBucket: Array<{
    bucket: string;
    v1Roi: number;
    v2Roi: number;
    delta: number;
  }>;
  /** Per-disqualifier delta (counts only — disqualifier names differ between v1 and v2). */
  byDisqualifier: Array<{
    disqualifier: string;
    v1Count: number;
    v2Count: number;
    delta: number;
  }>;
}

export interface BacktestComparisonResult {
  v1Summary: BacktestSummary;
  v2Summary: BacktestSummary;
  deltaSummary: AlgorithmDeltaSummary;
  recommendationChangeSummary: RecommendationChangeSummary;
  /** Echoed for the report renderer. */
  scope: BacktestScope;
  generatedAt: string;
}

export interface RunBacktestComparisonArgs {
  scope: BacktestScope;
  fixtures?: LoadedBacktestFixtures;
}

export function runBacktestComparison(
  args: RunBacktestComparisonArgs,
): BacktestComparisonResult {
  const fixtures = args.fixtures ?? loadBacktestFixtures();
  const v1 = runBacktest({
    scope: args.scope,
    fixtures,
    algorithmMode: "V1_SCORECARD",
  });
  const v2 = runBacktest({
    scope: args.scope,
    fixtures,
    algorithmMode: "V2_PIPELINE",
  });

  const recommendationChangeSummary = classifyRecommendationChanges({
    v1Results: v1.results,
    v2Results: v2.results,
    v2Metadata: v2.v2Metadata ?? {},
  });

  const deltaSummary = compareBacktestSummaries({
    v1Summary: v1.summary,
    v2Summary: v2.summary,
    v1Results: v1.results,
    v2Results: v2.results,
    v2Metadata: v2.v2Metadata ?? {},
  });

  return {
    v1Summary: v1.summary,
    v2Summary: v2.summary,
    deltaSummary,
    recommendationChangeSummary,
    scope: args.scope,
    generatedAt: new Date().toISOString(),
  };
}

export function compareBacktestSummaries(args: {
  v1Summary: BacktestSummary;
  v2Summary: BacktestSummary;
  v1Results: BacktestEvaluatedProp[];
  v2Results: BacktestEvaluatedProp[];
  v2Metadata: Record<string, V2BacktestMetadata>;
}): AlgorithmDeltaSummary {
  const { v1Summary, v2Summary } = args;
  const v2BetIds = new Set<string>(
    args.v2Results
      .filter((r) => r.qualified && r.recommendation !== "PASS")
      .map((r) => r.id),
  );
  // We need the per-prop v2 metadata to compute average conf-adj
  // edge across v2 bets. The metadata is keyed by propMarketId,
  // not the evaluated `id` ("season-wW-propMarketId").
  let confAdjSum = 0;
  let confAdjCount = 0;
  for (const r of args.v2Results) {
    if (!v2BetIds.has(r.id)) continue;
    const propMarketId = r.id.split("-w")[1]?.split("-").slice(1).join("-");
    const meta = args.v2Metadata[propMarketId ?? ""];
    if (!meta) continue;
    confAdjSum += Math.abs(meta.confidenceAdjustedEdge);
    confAdjCount += 1;
  }
  const v2AverageConfidenceAdjustedEdge =
    confAdjCount === 0 ? 0 : confAdjSum / confAdjCount;

  return {
    evaluatedDelta: v2Summary.evaluated - v1Summary.evaluated,
    qualifiedBetsDelta: v2Summary.qualifiedBets - v1Summary.qualifiedBets,
    passesDelta: v2Summary.passes - v1Summary.passes,
    hitRateDelta: v2Summary.hitRate - v1Summary.hitRate,
    roiPctDelta: v2Summary.roiPct - v1Summary.roiPct,
    averageEdgeDelta: v2Summary.averageEdge - v1Summary.averageEdge,
    v2AverageConfidenceAdjustedEdge,
    winsDelta: v2Summary.wins - v1Summary.wins,
    lossesDelta: v2Summary.losses - v1Summary.losses,
    pushesDelta: v2Summary.pushes - v1Summary.pushes,
    profitUnitsDelta: v2Summary.profitUnits - v1Summary.profitUnits,
    brierScoreDelta: v2Summary.brierScore - v1Summary.brierScore,
    byPropType: pairBy<BacktestPropTypeSummary, "propType">(
      v1Summary.byPropType,
      v2Summary.byPropType,
      "propType",
    ).map(([v1, v2]) => ({
      propType: (v1?.propType ?? v2?.propType) as string,
      v1Roi: v1?.roiPct ?? 0,
      v2Roi: v2?.roiPct ?? 0,
      delta: (v2?.roiPct ?? 0) - (v1?.roiPct ?? 0),
    })),
    byLineBucket: pairBreakdownsByBucket(
      v1Summary.byLineBucket,
      v2Summary.byLineBucket,
    ),
    byConfidenceBucket: pairConfidenceBuckets(
      v1Summary.byConfidence,
      v2Summary.byConfidence,
    ),
    byEdgeBucket: pairEdgeBuckets(
      v1Summary.byEdgeBucket,
      v2Summary.byEdgeBucket,
    ),
    byDisqualifier: pairDisqualifiers(
      v1Summary.byDisqualifier,
      v2Summary.byDisqualifier,
    ),
  };
}

export function summarizeAlgorithmDelta(
  result: BacktestComparisonResult,
): string[] {
  const lines: string[] = [];
  const { v1Summary, v2Summary, deltaSummary, recommendationChangeSummary } =
    result;
  lines.push(
    `evaluated: v1=${v1Summary.evaluated} v2=${v2Summary.evaluated} Δ=${deltaSummary.evaluatedDelta}`,
  );
  lines.push(
    `qualified bets: v1=${v1Summary.qualifiedBets} v2=${v2Summary.qualifiedBets} Δ=${deltaSummary.qualifiedBetsDelta}`,
  );
  lines.push(
    `hit rate: v1=${(v1Summary.hitRate * 100).toFixed(1)}% v2=${(v2Summary.hitRate * 100).toFixed(1)}% Δ=${(deltaSummary.hitRateDelta * 100).toFixed(1)}pp`,
  );
  lines.push(
    `ROI: v1=${v1Summary.roiPct.toFixed(1)}% v2=${v2Summary.roiPct.toFixed(1)}% Δ=${deltaSummary.roiPctDelta.toFixed(1)}pp`,
  );
  lines.push(
    `profit (units): v1=${v1Summary.profitUnits.toFixed(2)} v2=${v2Summary.profitUnits.toFixed(2)} Δ=${deltaSummary.profitUnitsDelta.toFixed(2)}`,
  );
  lines.push(
    `avg edge: v1=${(v1Summary.averageEdge * 100).toFixed(1)}% v2=${(v2Summary.averageEdge * 100).toFixed(1)}%; v2 avg conf-adj edge=${(deltaSummary.v2AverageConfidenceAdjustedEdge * 100).toFixed(1)}pp`,
  );
  lines.push(
    `recommendation changes: ${recommendationChangeSummary.totalEvaluated} props, ` +
      `${recommendationChangeSummary.v1OnlyBets} v1-only bets, ` +
      `${recommendationChangeSummary.v2OnlyBets} v2-only bets, ` +
      `${recommendationChangeSummary.oppositeSides} opposite side`,
  );
  if (recommendationChangeSummary.topNewV2Disqualifiers.length > 0) {
    lines.push(
      `top new v2 disqualifiers: ${recommendationChangeSummary.topNewV2Disqualifiers
        .slice(0, 3)
        .map((d) => `${d.disqualifier} (×${d.count})`)
        .join("; ")}`,
    );
  }
  return lines;
}

function classifyRecommendationChanges(args: {
  v1Results: BacktestEvaluatedProp[];
  v2Results: BacktestEvaluatedProp[];
  v2Metadata: Record<string, V2BacktestMetadata>;
}): RecommendationChangeSummary {
  const v1ById = new Map<string, BacktestEvaluatedProp>();
  for (const r of args.v1Results) v1ById.set(r.id, r);

  const changes: RecommendationChange[] = [];
  const counts: Record<RecommendationChangeKind, number> = {
    SAME_BET: 0,
    V1_BET_V2_PASS: 0,
    V1_PASS_V2_BET: 0,
    OPPOSITE_SIDE: 0,
    SAME_PASS_DIFFERENT_REASON: 0,
    SAME_RECOMMENDATION_DIFFERENT_CONFIDENCE: 0,
  };
  const newV2DisqCounts = new Map<string, number>();

  for (const v2 of args.v2Results) {
    const v1 = v1ById.get(v2.id);
    if (!v1) continue;
    const propMarketId = v2.id.split("-w")[1]?.split("-").slice(1).join("-");
    const meta = args.v2Metadata[propMarketId ?? ""];
    const v1IsBet = v1.qualified && v1.recommendation !== "PASS";
    const v2IsBet = v2.qualified && v2.recommendation !== "PASS";
    let kind: RecommendationChangeKind;
    if (v1IsBet && v2IsBet) {
      if (v1.recommendation !== v2.recommendation) {
        kind = "OPPOSITE_SIDE";
      } else if (
        Math.abs(v1.confidence - v2.confidence) > 0.05 ||
        Math.abs(v1.edge - v2.edge) > 0.01
      ) {
        kind = "SAME_RECOMMENDATION_DIFFERENT_CONFIDENCE";
      } else {
        kind = "SAME_BET";
      }
    } else if (v1IsBet && !v2IsBet) {
      kind = "V1_BET_V2_PASS";
      if (v2.primaryDisqualifier) {
        newV2DisqCounts.set(
          v2.primaryDisqualifier,
          (newV2DisqCounts.get(v2.primaryDisqualifier) ?? 0) + 1,
        );
      }
    } else if (!v1IsBet && v2IsBet) {
      kind = "V1_PASS_V2_BET";
    } else {
      // Both PASS — same outcome or different reason.
      if (v1.primaryDisqualifier === v2.primaryDisqualifier) {
        kind = "SAME_BET";
      } else {
        kind = "SAME_PASS_DIFFERENT_REASON";
      }
    }
    counts[kind] += 1;
    changes.push({
      propMarketId: v2.id,
      playerName: v2.playerName,
      propType: v2.propType,
      marketLine: v2.line,
      kind,
      v1Recommendation: v1.recommendation,
      v2Recommendation: v2.recommendation,
      v1Qualified: v1.qualified,
      v2Qualified: v2.qualified,
      v1PrimaryDisqualifier: v1.primaryDisqualifier,
      v2PrimaryDisqualifier: v2.primaryDisqualifier,
      v1Edge: v1.edge,
      v2Edge: v2.edge,
      v2ConfidenceAdjustedEdge: meta?.confidenceAdjustedEdge ?? 0,
      v1Confidence: v1.confidence,
      v2Confidence: v2.confidence,
    });
  }

  const topNewV2Disqualifiers = Array.from(newV2DisqCounts.entries())
    .map(([disqualifier, count]) => ({ disqualifier, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalEvaluated: changes.length,
    counts,
    v1OnlyBets: counts.V1_BET_V2_PASS,
    v2OnlyBets: counts.V1_PASS_V2_BET,
    oppositeSides: counts.OPPOSITE_SIDE,
    changes,
    topNewV2Disqualifiers,
  };
}

function pairBy<T, K extends keyof T>(
  a: T[],
  b: T[],
  key: K,
): Array<[T | undefined, T | undefined]> {
  const map = new Map<unknown, [T | undefined, T | undefined]>();
  for (const x of a) {
    const k = x[key];
    map.set(k, [x, undefined]);
  }
  for (const y of b) {
    const k = y[key];
    const pair = map.get(k);
    if (pair) pair[1] = y;
    else map.set(k, [undefined, y]);
  }
  return Array.from(map.values());
}

function pairBreakdownsByBucket(
  a: BacktestPerformanceBreakdown[],
  b: BacktestPerformanceBreakdown[],
): Array<{ bucket: string; v1Roi: number; v2Roi: number; delta: number }> {
  const out: Array<{
    bucket: string;
    v1Roi: number;
    v2Roi: number;
    delta: number;
  }> = [];
  for (const [v1, v2] of pairBy(a, b, "bucketLabel")) {
    const bucket = (v1?.bucketLabel ?? v2?.bucketLabel) as string;
    const v1Roi = v1?.roiPct ?? 0;
    const v2Roi = v2?.roiPct ?? 0;
    out.push({ bucket, v1Roi, v2Roi, delta: v2Roi - v1Roi });
  }
  return out;
}

function pairConfidenceBuckets(
  a: BacktestConfidenceBucketSummary[],
  b: BacktestConfidenceBucketSummary[],
): Array<{ bucket: string; v1Roi: number; v2Roi: number; delta: number }> {
  const out: Array<{
    bucket: string;
    v1Roi: number;
    v2Roi: number;
    delta: number;
  }> = [];
  for (const [v1, v2] of pairBy(a, b, "label")) {
    const bucket = (v1?.label ?? v2?.label) as string;
    const v1Roi = v1?.roiPct ?? 0;
    const v2Roi = v2?.roiPct ?? 0;
    out.push({ bucket, v1Roi, v2Roi, delta: v2Roi - v1Roi });
  }
  return out;
}

function pairEdgeBuckets(
  a: BacktestEdgeBucketSummary[],
  b: BacktestEdgeBucketSummary[],
): Array<{ bucket: string; v1Roi: number; v2Roi: number; delta: number }> {
  const out: Array<{
    bucket: string;
    v1Roi: number;
    v2Roi: number;
    delta: number;
  }> = [];
  for (const [v1, v2] of pairBy(a, b, "label")) {
    const bucket = (v1?.label ?? v2?.label) as string;
    const v1Roi = v1?.roiPct ?? 0;
    const v2Roi = v2?.roiPct ?? 0;
    out.push({ bucket, v1Roi, v2Roi, delta: v2Roi - v1Roi });
  }
  return out;
}

function pairDisqualifiers(
  a: BacktestDisqualifierSummary[],
  b: BacktestDisqualifierSummary[],
): Array<{ disqualifier: string; v1Count: number; v2Count: number; delta: number }> {
  const out: Array<{
    disqualifier: string;
    v1Count: number;
    v2Count: number;
    delta: number;
  }> = [];
  for (const [v1, v2] of pairBy(a, b, "disqualifier")) {
    const disqualifier = (v1?.disqualifier ?? v2?.disqualifier) as string;
    const v1Count = v1?.count ?? 0;
    const v2Count = v2?.count ?? 0;
    out.push({ disqualifier, v1Count, v2Count, delta: v2Count - v1Count });
  }
  return out;
}
