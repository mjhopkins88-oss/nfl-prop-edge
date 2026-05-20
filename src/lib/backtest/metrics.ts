/**
 * Backtest stage 5 — Metrics aggregation.
 *
 * Takes the array of graded predictions and computes the headline
 * numbers plus the slice-by-X breakdowns that get persisted as
 * `BacktestResult` rows and shipped to the dashboard.
 *
 * What we track today:
 *   - plays, wins, losses, pushes, no-bets
 *   - hit rate (over wins+losses; pushes excluded)
 *   - ROI (return − stake) / stake
 *   - units staked / returned
 *   - average edge (signed, over bet candidates only)
 *   - Brier score (mean over graded predictions, qualified or not)
 *   - CLV placeholder (null — closing-line ingestion not wired in)
 *
 * Slices:
 *   - by prop type
 *   - by confidence tier (High / Medium / Low)
 *   - by edge bucket (4–6 / 6–8 / 8–10 / 10+ %)
 *   - by week
 */

import type { PropType } from "../types";
import type { BetResult } from "@prisma/client";

export type ConfidenceTier = "High" | "Medium" | "Low";

export interface GradedPrediction {
  season: number;
  week: number;
  propType: PropType;
  recommendation: "OVER" | "UNDER" | "PASS";
  qualified: boolean;
  edge: number;
  confidence: number;
  unitsStaked: number;
  unitsReturned: number;
  result: BetResult;
  brierComponent: number | null;
}

export interface MetricsBlock {
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noBets: number;
  hitRate: number;
  unitsStaked: number;
  unitsReturned: number;
  roiPct: number;
  averageEdge: number;
}

export interface BacktestMetrics extends MetricsBlock {
  brierScore: number | null;
  clvCentsAverage: number | null;
  byPropType: Array<MetricsBlock & { propType: PropType }>;
  byConfidence: Array<MetricsBlock & { tier: ConfidenceTier }>;
  byEdgeBucket: Array<MetricsBlock & { bucket: string }>;
  byWeek: Array<MetricsBlock & { season: number; week: number }>;
}

// --- helpers ----------------------------------------------------------

function tierForConfidence(c: number): ConfidenceTier {
  if (c >= 0.75) return "High";
  if (c >= 0.55) return "Medium";
  return "Low";
}

function bucketForEdge(edge: number): string {
  const e = Math.abs(edge) * 100;
  if (e >= 10) return "10%+";
  if (e >= 8) return "8–10%";
  if (e >= 6) return "6–8%";
  if (e >= 4) return "4–6%";
  return "<4%";
}

function rollUp(graded: GradedPrediction[]): MetricsBlock {
  let plays = 0,
    wins = 0,
    losses = 0,
    pushes = 0,
    noBets = 0,
    staked = 0,
    returned = 0,
    edgeSum = 0,
    edgeN = 0;
  for (const g of graded) {
    switch (g.result) {
      case "WIN":
        wins++;
        plays++;
        break;
      case "LOSS":
        losses++;
        plays++;
        break;
      case "PUSH":
        pushes++;
        plays++;
        break;
      case "NO_BET":
        noBets++;
        break;
    }
    staked += g.unitsStaked;
    returned += g.unitsReturned;
    if (g.qualified) {
      edgeSum += g.edge;
      edgeN++;
    }
  }
  const decided = wins + losses;
  const hitRate = decided > 0 ? wins / decided : 0;
  const roiPct = staked > 0 ? ((returned - staked) / staked) * 100 : 0;
  return {
    plays,
    wins,
    losses,
    pushes,
    noBets,
    hitRate,
    unitsStaked: staked,
    unitsReturned: returned,
    roiPct,
    averageEdge: edgeN > 0 ? edgeSum / edgeN : 0,
  };
}

// --- entry point ------------------------------------------------------

export function aggregateMetrics(graded: GradedPrediction[]): BacktestMetrics {
  const overall = rollUp(graded);

  const brierComponents = graded
    .map((g) => g.brierComponent)
    .filter((b): b is number => typeof b === "number");
  const brierScore =
    brierComponents.length > 0
      ? brierComponents.reduce((a, b) => a + b, 0) / brierComponents.length
      : null;

  // Slice helpers
  const groupBy = <K extends string>(
    keyFn: (g: GradedPrediction) => K,
  ): Map<K, GradedPrediction[]> => {
    const out = new Map<K, GradedPrediction[]>();
    for (const g of graded) {
      const k = keyFn(g);
      const arr = out.get(k) ?? [];
      arr.push(g);
      out.set(k, arr);
    }
    return out;
  };

  const propTypeGroups = groupBy<PropType>((g) => g.propType);
  const byPropType = Array.from(propTypeGroups.entries())
    .map(([propType, items]) => ({ propType, ...rollUp(items) }))
    .sort((a, b) => b.roiPct - a.roiPct);

  const confGroups = groupBy<ConfidenceTier>((g) =>
    tierForConfidence(g.confidence),
  );
  const byConfidence: Array<MetricsBlock & { tier: ConfidenceTier }> = (
    ["High", "Medium", "Low"] as const
  )
    .filter((t) => confGroups.has(t))
    .map((tier) => ({ tier, ...rollUp(confGroups.get(tier)!) }));

  const edgeBucketGroups = groupBy<string>((g) => bucketForEdge(g.edge));
  const byEdgeBucket: Array<MetricsBlock & { bucket: string }> = (
    ["<4%", "4–6%", "6–8%", "8–10%", "10%+"] as const
  )
    .filter((b) => edgeBucketGroups.has(b))
    .map((bucket) => ({ bucket, ...rollUp(edgeBucketGroups.get(bucket)!) }));

  const weekGroups = groupBy<string>((g) => `${g.season}-${g.week}`);
  const byWeek = Array.from(weekGroups.entries())
    .map(([key, items]) => {
      const [s, w] = key.split("-").map(Number);
      return { season: s, week: w, ...rollUp(items) };
    })
    .sort((a, b) =>
      a.season !== b.season ? a.season - b.season : a.week - b.week,
    );

  return {
    ...overall,
    brierScore,
    clvCentsAverage: null, // requires closing-line ingestion (not yet)
    byPropType,
    byConfidence,
    byEdgeBucket,
    byWeek,
  };
}
