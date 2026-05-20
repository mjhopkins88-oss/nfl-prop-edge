/**
 * Backtest metrics & bucketed summaries.
 *
 * Pure math; no IO. Consumes `BacktestGradedResult[]` and produces
 * aggregates plus the per-bucket slices that the report / page show.
 */

import type { PropType } from "../types";
import type {
  BacktestCoachingUncertaintyBucketSummary,
  BacktestConfidenceBucketSummary,
  BacktestDisqualifierSummary,
  BacktestEdgeBucketSummary,
  BacktestGradedResult,
  BacktestPropTypeSummary,
  BacktestWeatherRiskBucketSummary,
} from "./types";

const PROP_TYPES: PropType[] = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
];

export function calculateHitRate(results: BacktestGradedResult[]): number {
  const bets = results.filter((r) => r.bet && r.outcome !== "PUSH" && r.outcome !== "NO_RESULT");
  if (bets.length === 0) return 0;
  const wins = bets.filter((r) => r.outcome === "WIN").length;
  return wins / bets.length;
}

export function calculateROI(results: BacktestGradedResult[]): number {
  const bets = results.filter((r) => r.bet);
  if (bets.length === 0) return 0;
  const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
  return profit / bets.length;
}

export function calculateAverageEdge(results: BacktestGradedResult[]): number {
  const bets = results.filter((r) => r.bet);
  if (bets.length === 0) return 0;
  return bets.reduce((acc, r) => acc + r.edgeAtRecommendation, 0) / bets.length;
}

export function calculateAverageExpectedValue(
  results: BacktestGradedResult[],
): number {
  // EV per unit = modelProb * payout - (1 - modelProb) (i.e. lose 1u).
  // We approximate modelProb from the scorecard.
  const bets = results.filter((r) => r.bet);
  if (bets.length === 0) return 0;
  let total = 0;
  for (const r of bets) {
    const sc = r.candidate.scorecard;
    const modelProb =
      sc.recommendation === "OVER"
        ? sc.modelOverProbability
        : sc.modelUnderProbability;
    const odds =
      sc.recommendation === "OVER" ? sc.overOdds : sc.underOdds;
    const payout = odds > 0 ? odds / 100 : 100 / -odds;
    total += modelProb * payout - (1 - modelProb);
  }
  return total / bets.length;
}

export function calculateBrierScore(results: BacktestGradedResult[]): number {
  // Brier across qualified bets with a graded outcome.
  const scored = results.filter(
    (r) =>
      r.bet &&
      (r.outcome === "WIN" || r.outcome === "LOSS" || r.outcome === "PUSH"),
  );
  if (scored.length === 0) return 0;
  let sum = 0;
  for (const r of scored) {
    const sc = r.candidate.scorecard;
    const modelProb =
      sc.recommendation === "OVER"
        ? sc.modelOverProbability
        : sc.modelUnderProbability;
    const actual = r.outcome === "WIN" ? 1 : r.outcome === "PUSH" ? 0.5 : 0;
    sum += (modelProb - actual) ** 2;
  }
  return sum / scored.length;
}

export function calculateMaxDrawdown(results: BacktestGradedResult[]): number {
  const bets = results.filter((r) => r.bet);
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

function summarizeBets(bets: BacktestGradedResult[]) {
  const wins = bets.filter((r) => r.outcome === "WIN").length;
  const losses = bets.filter((r) => r.outcome === "LOSS").length;
  const pushes = bets.filter((r) => r.outcome === "PUSH").length;
  const decided = wins + losses + pushes;
  const profit = bets.reduce((acc, r) => acc + r.profitLossUnits, 0);
  const decidedNoPush = wins + losses;
  return {
    bets: bets.length,
    wins,
    losses,
    pushes,
    profitUnits: profit,
    roiPct: bets.length > 0 ? (profit / bets.length) * 100 : 0,
    hitRate: decidedNoPush > 0 ? wins / decidedNoPush : 0,
    decided,
  };
}

export function summarizeByPropType(
  results: BacktestGradedResult[],
): BacktestPropTypeSummary[] {
  return PROP_TYPES.map((pt) => {
    const evaluated = results.filter((r) => r.candidate.propType === pt);
    const bets = evaluated.filter((r) => r.bet);
    const s = summarizeBets(bets);
    return {
      propType: pt,
      evaluated: evaluated.length,
      bets: s.bets,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      hitRate: s.hitRate,
      roiPct: s.roiPct,
      profitUnits: s.profitUnits,
    };
  }).filter((s) => s.evaluated > 0);
}

export function summarizeByPrimaryDisqualifier(
  results: BacktestGradedResult[],
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
  // Collapse score values so "Edge of +3.5% on OVER below 4.0% threshold"
  // groups with "Edge of +2.5% on OVER below 4.0% threshold".
  if (raw.toLowerCase().startsWith("edge of")) return "Edge below threshold";
  // "Injury context score 0.30 below 0.55 gate" → "Injury context gate"
  const m = raw.match(/^([A-Za-z\s/]+?)\s+score\s+\d/i);
  if (m) return `${m[1].trim()} gate`;
  return raw;
}

const EDGE_BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: "< 0%", lo: -Infinity, hi: 0 },
  { label: "0–2%", lo: 0, hi: 0.02 },
  { label: "2–4%", lo: 0.02, hi: 0.04 },
  { label: "4–6%", lo: 0.04, hi: 0.06 },
  { label: "6–10%", lo: 0.06, hi: 0.10 },
  { label: "≥ 10%", lo: 0.10, hi: Infinity },
];

export function summarizeByEdgeBucket(
  results: BacktestGradedResult[],
): BacktestEdgeBucketSummary[] {
  return EDGE_BUCKETS.map((b) => {
    const inBucket = results.filter(
      (r) => r.edgeAtRecommendation >= b.lo && r.edgeAtRecommendation < b.hi,
    );
    const bets = inBucket.filter((r) => r.bet);
    const s = summarizeBets(bets);
    return {
      label: b.label,
      loEdge: b.lo === -Infinity ? -1 : b.lo,
      hiEdge: b.hi === Infinity ? 1 : b.hi,
      bets: s.bets,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      hitRate: s.hitRate,
      roiPct: s.roiPct,
      profitUnits: s.profitUnits,
    };
  }).filter((s) => s.bets > 0 || s.wins > 0 || s.losses > 0);
}

export function summarizeByConfidenceBucket(
  results: BacktestGradedResult[],
): BacktestConfidenceBucketSummary[] {
  const tiers: Array<"High" | "Medium" | "Low"> = ["High", "Medium", "Low"];
  return tiers.map((tier) => {
    const bets = results.filter((r) => {
      if (!r.bet) return false;
      const c = r.candidate.scorecard.confidence;
      if (tier === "High") return c >= 0.8;
      if (tier === "Medium") return c >= 0.6 && c < 0.8;
      return c < 0.6;
    });
    const s = summarizeBets(bets);
    return {
      label: tier,
      bets: s.bets,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      hitRate: s.hitRate,
      roiPct: s.roiPct,
      profitUnits: s.profitUnits,
    };
  });
}

const COACHING_BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: "None / low (< 20)", lo: 0, hi: 20 },
  { label: "Mild (20–39)", lo: 20, hi: 40 },
  { label: "Moderate (40–59)", lo: 40, hi: 60 },
  { label: "High (60–74)", lo: 60, hi: 75 },
  { label: "Severe (75+)", lo: 75, hi: 101 },
];

export function summarizeByCoachingUncertaintyBucket(
  results: BacktestGradedResult[],
): BacktestCoachingUncertaintyBucketSummary[] {
  return COACHING_BUCKETS.map((b) => {
    const bets = results.filter((r) => {
      if (!r.bet) return false;
      const ct = r.candidate.scorecard.coachingTransition;
      const penalty = ct?.scores.coachingUncertaintyPenalty ?? 0;
      return penalty >= b.lo && penalty < b.hi;
    });
    const s = summarizeBets(bets);
    return {
      label: b.label,
      loPenalty: b.lo,
      hiPenalty: b.hi,
      bets: s.bets,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      hitRate: s.hitRate,
      roiPct: s.roiPct,
      profitUnits: s.profitUnits,
    };
  }).filter((b) => b.bets > 0);
}

const WEATHER_BUCKETS: Array<{ label: string; lo: number; hi: number }> = [
  { label: "Risk (< 0.50)", lo: 0, hi: 0.5 },
  { label: "Borderline (0.50–0.74)", lo: 0.5, hi: 0.75 },
  { label: "Clean (≥ 0.75)", lo: 0.75, hi: 1.01 },
];

export function summarizeByWeatherRiskBucket(
  results: BacktestGradedResult[],
): BacktestWeatherRiskBucketSummary[] {
  return WEATHER_BUCKETS.map((b) => {
    const bets = results.filter((r) => {
      if (!r.bet) return false;
      const w = r.candidate.scorecard.weatherEnvironmentScore;
      return w >= b.lo && w < b.hi;
    });
    const s = summarizeBets(bets);
    return {
      label: b.label,
      loScore: b.lo,
      hiScore: b.hi,
      bets: s.bets,
      wins: s.wins,
      losses: s.losses,
      pushes: s.pushes,
      hitRate: s.hitRate,
      roiPct: s.roiPct,
      profitUnits: s.profitUnits,
    };
  }).filter((b) => b.bets > 0);
}
