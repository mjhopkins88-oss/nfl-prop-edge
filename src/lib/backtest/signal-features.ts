/**
 * Diagnostic mispricing features.
 *
 * Six per-candidate signal scores computed from STRICT-BEFORE
 * player history. Pure analysis surface — none of these scores
 * feed into the scorecard's qualification math. The admin
 * edge-slice diagnostic buckets candidates by each feature and
 * reports per-bucket hit rate / ROI / calibration error so the
 * operator can see which signals actually predict winning bets
 * BEFORE proposing any production-selection change.
 *
 * All inputs respect the strict-before discipline: feature
 * computation reads only rows with
 *   row.season < currentSeason
 *   OR (row.season == currentSeason AND row.week < currentWeek)
 * — never the target week itself. Future weeks are forbidden.
 *
 * No paid API. No mutation. No threshold or calibration change.
 */

import type { PropType } from "../types";
import type { NflPlayerWeekStat } from "../ingestion/nflverse-types";

export interface SignalFeatures {
  /** Spike in usage over the last 2 games vs the prior
   *  baseline. Positive = usage is rising. Bounded ~[-1, 1]. */
  roleChangeScore: number;
  /** Slope of usage over the last 3 games (per-game change in
   *  the share metric). Positive = increasing usage. Scaled so
   *  +0.10 = a 10pp/game rise in the share metric. */
  usageMomentumScore: number;
  /** Coefficient of variation (std dev / mean) of the prop's
   *  raw stat over recent history. Lower = more stable.
   *  Bucketed into low/medium/high by the analysis layer. */
  volatilityScore: number;
  /** Categorical bucket derived from `volatilityScore` so the
   *  audit can group candidates without re-normalizing. */
  volatilityBucket: "low" | "medium" | "high" | "unknown";
  /** Distribution shape: (median − mean) / mean. Negative =
   *  boom-bust right skew (mean pulled up by big games);
   *  positive = left skew (rare collapse weeks); ≈0 =
   *  symmetric. */
  distributionBiasScore: number;
  /** Difference between the prop's share metric when the
   *  team's homeAway==HOME vs AWAY, as a coarse script proxy.
   *  Positive = player gets more usage at home. Real
   *  lead/trail data isn't on NflPlayerWeekStat so this is
   *  the strongest signal we can derive without re-ingesting
   *  pbp. */
  scriptSensitivityScore: number;
  /** Market-resistance signal: large model edge against a
   *  TIGHT market overround. Tighter market → operator more
   *  confident → bigger surprise that the model disagrees.
   *  Score = edge × (1 − overround_distance_from_1.05). */
  marketResistanceScore: number;
  /** History row count the features were computed from. <3 →
   *  bucketed as "unknown" / treated as low-confidence by the
   *  audit layer. */
  historyRowsUsed: number;
  /** True when at least one feature defaulted because the
   *  upstream signal was unavailable (e.g., no homeAway
   *  variance in the player's history). Surfaces on the
   *  audit's signal-availability counter. */
  hasNeutralFallback: boolean;
}

const PROP_TO_SHARE_KEY: Record<PropType, keyof NflPlayerWeekStat> = {
  PASSING_ATTEMPTS: "snapShare",
  PASSING_COMPLETIONS: "snapShare",
  PASSING_YARDS: "snapShare",
  RECEPTIONS: "targetShare",
  RECEIVING_YARDS: "targetShare",
  RUSHING_ATTEMPTS: "carryShare",
  RUSHING_YARDS: "carryShare",
};

const PROP_TO_STAT_KEY: Record<PropType, keyof NflPlayerWeekStat> = {
  PASSING_ATTEMPTS: "passingAttempts",
  PASSING_COMPLETIONS: "passingCompletions",
  PASSING_YARDS: "passingYards",
  RECEPTIONS: "receptions",
  RECEIVING_YARDS: "receivingYards",
  RUSHING_ATTEMPTS: "rushingAttempts",
  RUSHING_YARDS: "rushingYards",
};

function numericValues(
  rows: ReadonlyArray<NflPlayerWeekStat>,
  key: keyof NflPlayerWeekStat,
): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (xs.length - 1));
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2;
  return sorted[mid];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function americanImpliedProb(odds: number): number {
  if (odds === 0) return 0.5;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

/** Strict-before filter — guards against the model peeking at
 *  the target week. Mirrors `buildPlayerFeatureContextFromNflHistory`. */
function strictBefore(
  rows: ReadonlyArray<NflPlayerWeekStat>,
  season: number,
  week: number,
): NflPlayerWeekStat[] {
  return rows.filter((r) => {
    if (r.season < season) return true;
    if (r.season === season && r.week < week) return true;
    return false;
  });
}

/**
 * Linear-regression slope of `ys` against the index 0..n-1.
 * Returns 0 when there's less than 2 points to fit.
 */
function slope(ys: number[]): number {
  if (ys.length < 2) return 0;
  const n = ys.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (ys[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function computeRoleChangeScore(
  history: NflPlayerWeekStat[],
  shareKey: keyof NflPlayerWeekStat,
): number {
  // Last 2 weeks vs the prior baseline. History is assumed
  // sorted oldest → newest by the caller.
  if (history.length < 4) return 0;
  const lastTwo = history.slice(-2);
  const prior = history.slice(0, -2);
  const recentVals = numericValues(lastTwo, shareKey);
  const priorVals = numericValues(prior, shareKey);
  if (recentVals.length < 2 || priorVals.length < 2) return 0;
  const recentMean = mean(recentVals);
  const priorMean = mean(priorVals);
  if (priorMean <= 0) return 0;
  return clamp((recentMean - priorMean) / priorMean, -1, 1);
}

function computeUsageMomentumScore(
  history: NflPlayerWeekStat[],
  shareKey: keyof NflPlayerWeekStat,
): number {
  if (history.length < 3) return 0;
  const lastThree = history.slice(-3);
  const ys = numericValues(lastThree, shareKey);
  if (ys.length < 2) return 0;
  // Slope expressed in share-units per game. Bounded so an
  // extreme one-game outlier doesn't dominate the score.
  return clamp(slope(ys), -1, 1);
}

function computeVolatility(
  history: NflPlayerWeekStat[],
  statKey: keyof NflPlayerWeekStat,
): { score: number; bucket: SignalFeatures["volatilityBucket"] } {
  if (history.length < 3) {
    return { score: 0, bucket: "unknown" };
  }
  const xs = numericValues(history, statKey);
  if (xs.length < 3) return { score: 0, bucket: "unknown" };
  const m = mean(xs);
  const sd = stddev(xs);
  if (m <= 0) return { score: 0, bucket: "unknown" };
  // Coefficient of variation; clamp the upper end so a single
  // zero-game doesn't blow the score out.
  const cv = clamp(sd / m, 0, 2);
  // Low CV (steady production) is better.
  const bucket: SignalFeatures["volatilityBucket"] =
    cv < 0.25 ? "low" : cv > 0.6 ? "high" : "medium";
  return { score: cv, bucket };
}

function computeDistributionBiasScore(
  history: NflPlayerWeekStat[],
  statKey: keyof NflPlayerWeekStat,
): number {
  if (history.length < 4) return 0;
  const xs = numericValues(history, statKey);
  if (xs.length < 4) return 0;
  const m = mean(xs);
  if (m <= 0) return 0;
  const med = median(xs);
  // Negative = mean > median (boom-bust right-skew).
  return clamp((med - m) / m, -1, 1);
}

function computeScriptSensitivityScore(
  history: NflPlayerWeekStat[],
  shareKey: keyof NflPlayerWeekStat,
): { score: number; usedFallback: boolean } {
  // Coarse proxy: HOME vs AWAY share gap. Real lead/trail data
  // would require pbp ingestion — we don't have it here, so
  // homeAway is the best signal available.
  const homeRows = history.filter((r) => r.homeAway === "HOME");
  const awayRows = history.filter((r) => r.homeAway === "AWAY");
  if (homeRows.length === 0 || awayRows.length === 0) {
    return { score: 0, usedFallback: true };
  }
  const homeMean = mean(numericValues(homeRows, shareKey));
  const awayMean = mean(numericValues(awayRows, shareKey));
  const denom = (homeMean + awayMean) / 2;
  if (denom <= 0) return { score: 0, usedFallback: true };
  return {
    score: clamp((homeMean - awayMean) / denom, -1, 1),
    usedFallback: false,
  };
}

function computeMarketResistanceScore(args: {
  overOdds: number;
  underOdds: number;
  modelEdge: number;
}): number {
  // Market overround as a tightness proxy. A typical -110 / -110
  // book has overround ≈ 1.0476 (~4.8% vig). Tighter → bigger
  // surprise that the model disagrees. Score is positive when
  // the model has a meaningful edge AGAINST a tight market.
  const overround =
    americanImpliedProb(args.overOdds) + americanImpliedProb(args.underOdds);
  // Distance from the canonical low-vig baseline of 1.048;
  // negative when overround is above (market is wider).
  const tightness = clamp(1 - (overround - 1.048) / 0.05, 0, 1);
  // Edge contribution is the absolute calibrated edge.
  const edgeMag = clamp(Math.abs(args.modelEdge), 0, 0.25);
  return clamp(edgeMag * tightness * 4, 0, 1);
}

/**
 * Compute all six diagnostic feature scores for a single
 * candidate. The function is pure — given the same history,
 * candidate, and currentWeek, it returns the same SignalFeatures
 * every time.
 *
 * `history` is the candidate's player_week_stats BEFORE the
 * strict-before filter; this function applies it. The caller
 * doesn't need to pre-filter.
 */
export function computeSignalFeatures(args: {
  propType: PropType;
  overOdds: number;
  underOdds: number;
  modelEdge: number;
  currentSeason: number;
  currentWeek: number;
  history: ReadonlyArray<NflPlayerWeekStat>;
}): SignalFeatures {
  const shareKey = PROP_TO_SHARE_KEY[args.propType];
  const statKey = PROP_TO_STAT_KEY[args.propType];
  const filtered = strictBefore(
    args.history,
    args.currentSeason,
    args.currentWeek,
  ).sort((a, b) => a.season - b.season || a.week - b.week);
  const role = computeRoleChangeScore(filtered, shareKey);
  const momentum = computeUsageMomentumScore(filtered, shareKey);
  const vol = computeVolatility(filtered, statKey);
  const distBias = computeDistributionBiasScore(filtered, statKey);
  const script = computeScriptSensitivityScore(filtered, shareKey);
  const resistance = computeMarketResistanceScore({
    overOdds: args.overOdds,
    underOdds: args.underOdds,
    modelEdge: args.modelEdge,
  });
  return {
    roleChangeScore: role,
    usageMomentumScore: momentum,
    volatilityScore: vol.score,
    volatilityBucket: vol.bucket,
    distributionBiasScore: distBias,
    scriptSensitivityScore: script.score,
    marketResistanceScore: resistance,
    historyRowsUsed: filtered.length,
    hasNeutralFallback:
      script.usedFallback || filtered.length < 3 || vol.bucket === "unknown",
  };
}
