/**
 * Backtest metrics & bucketed summaries.
 *
 * Pure math; no IO. Consumes `BacktestEvaluatedProp[]` and produces
 * the aggregates + slices the report and page show.
 */

import type { PropType } from "../types";
import type {
  BacktestCoachingUncertaintyBucketSummary,
  BacktestConfidenceBucketSummary,
  BacktestDisqualifierSummary,
  BacktestEdgeBucketSummary,
  BacktestEvaluatedProp,
  BacktestModelAuditSummary,
  BacktestPerformanceBreakdown,
  BacktestPropTypeSummary,
  BacktestWeatherRiskBucketSummary,
} from "./types";
import {
  getCoachingUncertaintyBucket,
  getLineBucket,
  getRiskBucket,
  getWeatherRiskBucket,
} from "./line-buckets";

const PROP_TYPES: PropType[] = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
];

const isBet = (r: BacktestEvaluatedProp) => r.qualified && r.recommendation !== "PASS";
const isDecided = (r: BacktestEvaluatedProp) =>
  r.result === "WIN" || r.result === "LOSS" || r.result === "PUSH";

export function calculateHitRate(
  results: BacktestEvaluatedProp[],
): number {
  const bets = results.filter(
    (r) => isBet(r) && r.result !== "PUSH" && r.result !== "NO_RESULT",
  );
  if (bets.length === 0) return 0;
  const wins = bets.filter((r) => r.result === "WIN").length;
  return wins / bets.length;
}

export function calculateROI(results: BacktestEvaluatedProp[]): number {
  const bets = results.filter(isBet);
  if (bets.length === 0) return 0;
  const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
  return profit / bets.length;
}

export function calculateAverageEdge(
  results: BacktestEvaluatedProp[],
): number {
  const bets = results.filter(isBet);
  if (bets.length === 0) return 0;
  return bets.reduce((acc, r) => acc + r.edge, 0) / bets.length;
}

export function calculateAverageExpectedValue(
  results: BacktestEvaluatedProp[],
): number {
  const bets = results.filter(isBet);
  if (bets.length === 0) return 0;
  let total = 0;
  for (const r of bets) {
    const modelProb =
      r.selectedSide === "OVER"
        ? r.modelOverProbability
        : r.modelUnderProbability;
    const payout = americanPayout(r.selectedOdds);
    total += modelProb * payout - (1 - modelProb);
  }
  return total / bets.length;
}

export function calculateBrierScore(
  results: BacktestEvaluatedProp[],
): number {
  const scored = results.filter((r) => isBet(r) && isDecided(r));
  if (scored.length === 0) return 0;
  let sum = 0;
  for (const r of scored) {
    const modelProb =
      r.selectedSide === "OVER"
        ? r.modelOverProbability
        : r.modelUnderProbability;
    const actual = r.result === "WIN" ? 1 : r.result === "PUSH" ? 0.5 : 0;
    sum += (modelProb - actual) ** 2;
  }
  return sum / scored.length;
}

export function calculateMaxDrawdown(
  results: BacktestEvaluatedProp[],
): number {
  const bets = results.filter(isBet);
  let running = 0;
  let peak = 0;
  let maxDd = 0;
  for (const r of bets) {
    running += r.profitLossUnits;
    if (running > peak) peak = running;
    const dd = peak - running;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

// --- generic per-bucket aggregator -----------------------------------

function aggregate(
  bucketLabel: string,
  evaluated: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown {
  const bets = evaluated.filter(isBet);
  const wins = bets.filter((r) => r.result === "WIN").length;
  const losses = bets.filter((r) => r.result === "LOSS").length;
  const pushes = bets.filter((r) => r.result === "PUSH").length;
  const passes = evaluated.filter((r) => !isBet(r)).length;
  const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
  const decided = wins + losses;
  const averageEdge =
    evaluated.length > 0
      ? evaluated.reduce((acc, r) => acc + r.edge, 0) / evaluated.length
      : 0;
  const averageEvUnits =
    bets.length > 0
      ? bets.reduce((acc, r) => {
          const p =
            r.selectedSide === "OVER"
              ? r.modelOverProbability
              : r.modelUnderProbability;
          return acc + (p * americanPayout(r.selectedOdds) - (1 - p));
        }, 0) / bets.length
      : 0;
  const averageProfitLossUnits =
    bets.length > 0 ? profit / bets.length : 0;
  const averageModelProbability =
    evaluated.length > 0
      ? evaluated.reduce((acc, r) => {
          const p =
            r.selectedSide === "OVER"
              ? r.modelOverProbability
              : r.modelUnderProbability;
          return acc + p;
        }, 0) / evaluated.length
      : 0;
  const averageMarketProbability =
    evaluated.length > 0
      ? evaluated.reduce((acc, r) => {
          const noVigOver =
            r.marketOverProbability /
            (r.marketOverProbability + r.marketUnderProbability || 1);
          const p =
            r.selectedSide === "OVER" ? noVigOver : 1 - noVigOver;
          return acc + p;
        }, 0) / evaluated.length
      : 0;
  return {
    bucketLabel,
    evaluated: evaluated.length,
    bets: bets.length,
    wins,
    losses,
    pushes,
    passes,
    hitRate: decided > 0 ? wins / decided : 0,
    roiPct: bets.length > 0 ? (profit / bets.length) * 100 : 0,
    averageEdge,
    averageEvUnits,
    averageProfitLossUnits,
    averageModelProbability,
    averageMarketProbability,
    profitUnits: profit,
  };
}

function americanPayout(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

// --- legacy-shape summaries (kept for backwards compatibility) -------

export function summarizeByPropType(
  results: BacktestEvaluatedProp[],
): BacktestPropTypeSummary[] {
  return PROP_TYPES.map((pt) => {
    const evaluated = results.filter((r) => r.propType === pt);
    const bets = evaluated.filter(isBet);
    const wins = bets.filter((r) => r.result === "WIN").length;
    const losses = bets.filter((r) => r.result === "LOSS").length;
    const pushes = bets.filter((r) => r.result === "PUSH").length;
    const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
    const decided = wins + losses;
    return {
      propType: pt,
      evaluated: evaluated.length,
      bets: bets.length,
      wins,
      losses,
      pushes,
      hitRate: decided > 0 ? wins / decided : 0,
      roiPct: bets.length > 0 ? (profit / bets.length) * 100 : 0,
      profitUnits: profit,
    };
  }).filter((s) => s.evaluated > 0);
}

export function summarizeByPrimaryDisqualifier(
  results: BacktestEvaluatedProp[],
): BacktestDisqualifierSummary[] {
  const counts = new Map<string, number>();
  for (const r of results) {
    if (!r.primaryDisqualifier) continue;
    const key = simplifyDisqualifier(r.primaryDisqualifier);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([disqualifier, count]) => ({ disqualifier, count }))
    .sort((a, b) => b.count - a.count);
}

function simplifyDisqualifier(raw: string): string {
  if (raw.toLowerCase().startsWith("edge of")) return "Edge below threshold";
  const m = raw.match(/^([A-Za-z\s/]+?)\s+score\s+\d/i);
  if (m) return `${m[1].trim()} gate`;
  return raw;
}

const EDGE_BUCKETS_LEGACY: Array<{ label: string; lo: number; hi: number }> = [
  { label: "< 0%", lo: -Infinity, hi: 0 },
  { label: "0–2%", lo: 0, hi: 0.02 },
  { label: "2–4%", lo: 0.02, hi: 0.04 },
  { label: "4–6%", lo: 0.04, hi: 0.06 },
  { label: "6–10%", lo: 0.06, hi: 0.1 },
  { label: "≥ 10%", lo: 0.1, hi: Infinity },
];

export function summarizeByEdgeBucket(
  results: BacktestEvaluatedProp[],
): BacktestEdgeBucketSummary[] {
  return EDGE_BUCKETS_LEGACY.map((b) => {
    const inBucket = results.filter(
      (r) => r.edge >= b.lo && r.edge < b.hi,
    );
    const bets = inBucket.filter(isBet);
    const wins = bets.filter((r) => r.result === "WIN").length;
    const losses = bets.filter((r) => r.result === "LOSS").length;
    const pushes = bets.filter((r) => r.result === "PUSH").length;
    const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
    const decided = wins + losses;
    return {
      label: b.label,
      loEdge: b.lo === -Infinity ? -1 : b.lo,
      hiEdge: b.hi === Infinity ? 1 : b.hi,
      bets: bets.length,
      wins,
      losses,
      pushes,
      hitRate: decided > 0 ? wins / decided : 0,
      roiPct: bets.length > 0 ? (profit / bets.length) * 100 : 0,
      profitUnits: profit,
    };
  }).filter((s) => s.bets > 0 || s.wins > 0 || s.losses > 0);
}

export function summarizeByConfidenceBucket(
  results: BacktestEvaluatedProp[],
): BacktestConfidenceBucketSummary[] {
  const tiers: Array<"High" | "Medium" | "Low"> = ["High", "Medium", "Low"];
  return tiers.map((tier) => {
    const bets = results.filter(
      (r) => isBet(r) && r.confidenceBucket === tier,
    );
    const wins = bets.filter((r) => r.result === "WIN").length;
    const losses = bets.filter((r) => r.result === "LOSS").length;
    const pushes = bets.filter((r) => r.result === "PUSH").length;
    const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
    const decided = wins + losses;
    return {
      label: tier,
      bets: bets.length,
      wins,
      losses,
      pushes,
      hitRate: decided > 0 ? wins / decided : 0,
      roiPct: bets.length > 0 ? (profit / bets.length) * 100 : 0,
      profitUnits: profit,
    };
  });
}

const COACHING_BUCKETS_LEGACY: Array<{ label: string; lo: number; hi: number }> = [
  { label: "None / low (< 20)", lo: 0, hi: 20 },
  { label: "Mild (20–39)", lo: 20, hi: 40 },
  { label: "Moderate (40–59)", lo: 40, hi: 60 },
  { label: "High (60–74)", lo: 60, hi: 75 },
  { label: "Severe (75+)", lo: 75, hi: 101 },
];

export function summarizeByCoachingUncertaintyBucket(
  results: BacktestEvaluatedProp[],
): BacktestCoachingUncertaintyBucketSummary[] {
  return COACHING_BUCKETS_LEGACY.map((b) => {
    const bets = results.filter(
      (r) =>
        isBet(r) &&
        r.coachingUncertaintyScore >= b.lo &&
        r.coachingUncertaintyScore < b.hi,
    );
    const wins = bets.filter((r) => r.result === "WIN").length;
    const losses = bets.filter((r) => r.result === "LOSS").length;
    const pushes = bets.filter((r) => r.result === "PUSH").length;
    const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
    const decided = wins + losses;
    return {
      label: b.label,
      loPenalty: b.lo,
      hiPenalty: b.hi,
      bets: bets.length,
      wins,
      losses,
      pushes,
      hitRate: decided > 0 ? wins / decided : 0,
      roiPct: bets.length > 0 ? (profit / bets.length) * 100 : 0,
      profitUnits: profit,
    };
  }).filter((b) => b.bets > 0);
}

const WEATHER_BUCKETS_LEGACY: Array<{ label: string; lo: number; hi: number }> = [
  { label: "Risk (< 0.50)", lo: 0, hi: 0.5 },
  { label: "Borderline (0.50–0.74)", lo: 0.5, hi: 0.75 },
  { label: "Clean (≥ 0.75)", lo: 0.75, hi: 1.01 },
];

export function summarizeByWeatherRiskBucket(
  results: BacktestEvaluatedProp[],
): BacktestWeatherRiskBucketSummary[] {
  return WEATHER_BUCKETS_LEGACY.map((b) => {
    const bets = results.filter(
      (r) =>
        isBet(r) &&
        r.weatherRiskScore >= b.lo &&
        r.weatherRiskScore < b.hi,
    );
    const wins = bets.filter((r) => r.result === "WIN").length;
    const losses = bets.filter((r) => r.result === "LOSS").length;
    const pushes = bets.filter((r) => r.result === "PUSH").length;
    const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
    const decided = wins + losses;
    return {
      label: b.label,
      loScore: b.lo,
      hiScore: b.hi,
      bets: bets.length,
      wins,
      losses,
      pushes,
      hitRate: decided > 0 ? wins / decided : 0,
      roiPct: bets.length > 0 ? (profit / bets.length) * 100 : 0,
      profitUnits: profit,
    };
  }).filter((b) => b.bets > 0);
}

// --- extended-shape breakdowns ---------------------------------------

export function summarizeByLineBucket(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const buckets = new Map<string, BacktestEvaluatedProp[]>();
  for (const r of results) {
    const key = `${r.propType} · ${r.lineBucket}`;
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([label, group]) => aggregate(label, group))
    .sort((a, b) => b.evaluated - a.evaluated);
}

export function summarizeByPostmortem(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const buckets = new Map<string, BacktestEvaluatedProp[]>();
  for (const r of results) {
    for (const tag of r.postmortemTags) {
      const arr = buckets.get(tag) ?? [];
      arr.push(r);
      buckets.set(tag, arr);
    }
  }
  return Array.from(buckets.entries())
    .map(([label, group]) => aggregate(label, group))
    .sort((a, b) => b.evaluated - a.evaluated);
}

export function summarizeByRecommendationSide(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const sides: Array<"OVER" | "UNDER"> = ["OVER", "UNDER"];
  return sides
    .map((s) =>
      aggregate(
        s,
        results.filter((r) => r.selectedSide === s),
      ),
    )
    .filter((b) => b.evaluated > 0);
}

export function summarizeByRoleStability(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const buckets = new Map<string, BacktestEvaluatedProp[]>();
  for (const r of results) {
    const key = getRiskBucket(r.roleStabilityScore);
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([label, group]) => aggregate(label, group))
    .sort((a, b) => b.evaluated - a.evaluated);
}

export function summarizeByQualifiedVsPassed(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const qualified = results.filter(isBet);
  const passed = results.filter((r) => !isBet(r));
  return [
    aggregate("Qualified bets", qualified),
    aggregate("Passed (not bet)", passed),
  ];
}

// --- new bucket helpers wrapping the rich aggregator ------------------

export function summarizeByPropTypeRich(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  return PROP_TYPES.map((pt) =>
    aggregate(
      pt,
      results.filter((r) => r.propType === pt),
    ),
  ).filter((b) => b.evaluated > 0);
}

export function summarizeByEdgeBucketRich(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  return EDGE_BUCKETS_LEGACY.map((b) =>
    aggregate(
      b.label,
      results.filter((r) => r.edge >= b.lo && r.edge < b.hi),
    ),
  ).filter((b) => b.evaluated > 0);
}

export function summarizeByConfidenceBucketRich(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const tiers: Array<"High" | "Medium" | "Low"> = ["High", "Medium", "Low"];
  return tiers.map((tier) =>
    aggregate(
      tier,
      results.filter((r) => r.confidenceBucket === tier),
    ),
  );
}

export function summarizeByDisqualifierRich(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const buckets = new Map<string, BacktestEvaluatedProp[]>();
  for (const r of results) {
    if (!r.primaryDisqualifier) continue;
    const key = simplifyDisqualifier(r.primaryDisqualifier);
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([label, group]) => aggregate(label, group))
    .sort((a, b) => b.evaluated - a.evaluated);
}

export function summarizeByCoachingUncertaintyRich(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const buckets = new Map<string, BacktestEvaluatedProp[]>();
  for (const r of results) {
    const key = getCoachingUncertaintyBucket(r.coachingUncertaintyScore);
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([label, group]) => aggregate(label, group))
    .sort((a, b) => b.evaluated - a.evaluated);
}

export function summarizeByWeatherRiskRich(
  results: BacktestEvaluatedProp[],
): BacktestPerformanceBreakdown[] {
  const buckets = new Map<string, BacktestEvaluatedProp[]>();
  for (const r of results) {
    const key = getWeatherRiskBucket(r.weatherRiskScore);
    const arr = buckets.get(key) ?? [];
    arr.push(r);
    buckets.set(key, arr);
  }
  return Array.from(buckets.entries())
    .map(([label, group]) => aggregate(label, group))
    .sort((a, b) => b.evaluated - a.evaluated);
}

// --- model audit -----------------------------------------------------

export function buildModelAuditSummary(
  results: BacktestEvaluatedProp[],
  byPropType: BacktestPropTypeSummary[],
  byLineBucket: BacktestPerformanceBreakdown[],
  byEdgeBucket: BacktestEdgeBucketSummary[],
  byConfidence: BacktestConfidenceBucketSummary[],
  byPostmortem: BacktestPerformanceBreakdown[],
): BacktestModelAuditSummary {
  const notes: string[] = [];
  const propTypeWithBets = byPropType.filter((s) => s.bets >= 1);
  const bestPropType = propTypeWithBets.sort(
    (a, b) => b.roiPct - a.roiPct,
  )[0]?.propType;
  const worstPropType = propTypeWithBets.sort(
    (a, b) => a.roiPct - b.roiPct,
  )[0]?.propType;
  const lineBucketWithBets = byLineBucket.filter((b) => b.bets >= 1);
  const bestLineBucket = lineBucketWithBets.sort(
    (a, b) => b.roiPct - a.roiPct,
  )[0]?.bucketLabel;
  const worstLineBucket = lineBucketWithBets.sort(
    (a, b) => a.roiPct - b.roiPct,
  )[0]?.bucketLabel;
  const edgeWithBets = byEdgeBucket.filter((b) => b.bets >= 1);
  const highestRoiEdgeBucket = edgeWithBets.sort(
    (a, b) => b.roiPct - a.roiPct,
  )[0]?.label;
  const lowestRoiEdgeBucket = edgeWithBets.sort(
    (a, b) => a.roiPct - b.roiPct,
  )[0]?.label;
  const confWithBets = byConfidence.filter((b) => b.bets >= 1);
  const bestConfidenceTier = confWithBets.sort(
    (a, b) => b.roiPct - a.roiPct,
  )[0]?.label;

  // Filter signal interpretation: which postmortem tags fired most?
  const filterCorrectlyAvoided = byPostmortem.find(
    (b) => b.bucketLabel === "FILTER_CORRECTLY_AVOIDED",
  );
  const filterTooConservative = byPostmortem.find(
    (b) => b.bucketLabel === "FILTER_TOO_CONSERVATIVE",
  );
  if (filterCorrectlyAvoided) {
    notes.push(
      `Filters correctly avoided ${filterCorrectlyAvoided.evaluated} prop${filterCorrectlyAvoided.evaluated === 1 ? "" : "s"} that would have lost.`,
    );
  }
  if (filterTooConservative) {
    notes.push(
      `Filters may have been too conservative on ${filterTooConservative.evaluated} prop${filterTooConservative.evaluated === 1 ? "" : "s"} the model leaned toward correctly.`,
    );
  }

  const passes = results.filter((r) => r.result === "PASS");
  const passWins = passes.filter(
    (r) => r.counterfactualResult === "WIN",
  ).length;
  const passDecided = passes.filter(
    (r) =>
      r.counterfactualResult === "WIN" || r.counterfactualResult === "LOSS",
  ).length;
  const passCounterfactualHitRate =
    passDecided > 0 ? passWins / passDecided : undefined;

  return {
    bestPropType,
    worstPropType,
    bestLineBucket,
    worstLineBucket,
    bestConfidenceTier,
    filterSavedMostLosses: filterCorrectlyAvoided?.bucketLabel,
    filterTooConservative: filterTooConservative?.bucketLabel,
    highestRoiEdgeBucket,
    lowestRoiEdgeBucket,
    passCounterfactualHitRate,
    notes,
  };
}
