/**
 * Signal-quality audit.
 *
 * For each of the six diagnostic mispricing features, bucket
 * candidates low / medium / high and report:
 *   · plays
 *   · W-L
 *   · hit rate
 *   · ROI
 *   · units
 *   · avg calibrated edge
 *   · avg model probability
 *   · calibration error (model − actual hit)
 *
 * Also reports four combination slices the operator explicitly
 * asked for:
 *   · high roleChange + positive usageMomentum
 *   · low volatility + positive edge
 *   · strong scriptSensitivity + matching home/away game script
 *   · strong marketResistance + edge ≥ 4%
 *
 * Pure function — no IO, no API, no DB. Reads only the in-
 * memory candidate pool the edge-slice diagnostic already
 * loads. The audit never changes the scorecard, the edge
 * threshold, the calibration constants, or any other piece of
 * production selection logic.
 */

import type { EdgeSliceCandidate } from "./edge-slice-diagnostic";

export type SignalBucket = "low" | "medium" | "high";

export interface SignalBucketMetrics {
  bucket: SignalBucket;
  range: { min: number; max: number };
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  avgEdgePct: number;
  avgModelProbPct: number;
  calibrationErrorPp: number;
}

export interface FeatureBucketReport {
  feature: string;
  /** Candidates that carried this feature signal vs total
   *  pool. <pool when the signal was undefined on older
   *  persisted calibrations or returned a neutral fallback. */
  candidatesWithSignal: number;
  candidatesTotal: number;
  buckets: SignalBucketMetrics[];
  /** ROI delta = high.roiPct − low.roiPct. Positive means
   *  the high-signal bucket outperformed the low-signal
   *  bucket. Surfaces in the headline ranking. */
  highMinusLowRoiPp: number;
}

export interface CombinationSliceMetrics {
  label: string;
  predicate: string;
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  avgEdgePct: number;
  avgModelProbPct: number;
  calibrationErrorPp: number;
}

export interface SignalQualityReport {
  diagnosticOnly: true;
  generatedAt: string;
  candidatesTotal: number;
  candidatesWithFeatures: number;
  featureBuckets: FeatureBucketReport[];
  combinations: CombinationSliceMetrics[];
  /** Features ranked by |highMinusLowRoiPp| descending — the
   *  feature whose buckets show the biggest ROI gap is the
   *  strongest predictor in this sample. */
  featureRankingByRoiDelta: Array<{ feature: string; deltaPp: number }>;
  formatted: string;
}

function aggregate(
  candidates: ReadonlyArray<EdgeSliceCandidate>,
): {
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  avgEdgePct: number;
  avgModelProbPct: number;
  calibrationErrorPp: number;
} {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noResult = 0;
  let units = 0;
  let sumEdge = 0;
  let sumModelProb = 0;
  for (const c of candidates) {
    if (c.outcome === "WIN") wins += 1;
    else if (c.outcome === "LOSS") losses += 1;
    else if (c.outcome === "PUSH") pushes += 1;
    else noResult += 1;
    units += c.profitPerUnit;
    sumEdge += c.edge;
    sumModelProb += c.modelProbability;
  }
  const decisive = wins + losses;
  const graded = wins + losses + pushes;
  const n = candidates.length;
  const hit = decisive > 0 ? (wins / decisive) * 100 : 0;
  const modelPct = n > 0 ? (sumModelProb / n) * 100 : 0;
  return {
    plays: n,
    wins,
    losses,
    pushes,
    noResult,
    hitRatePct: hit,
    roiPct: graded > 0 ? (units / graded) * 100 : 0,
    unitsProfit: units,
    avgEdgePct: n > 0 ? (sumEdge / n) * 100 : 0,
    avgModelProbPct: modelPct,
    calibrationErrorPp: modelPct - hit,
  };
}

/** Tercile-bucket a candidate set by a numeric extractor. Falls
 *  back to a single "medium" bucket when fewer than 6 unique
 *  values are available — tiny pools can't produce meaningful
 *  buckets and the audit reports their limit transparently. */
function tercileBuckets(args: {
  candidates: ReadonlyArray<EdgeSliceCandidate>;
  extract: (c: EdgeSliceCandidate) => number | undefined;
}): SignalBucketMetrics[] {
  const populated: Array<{ c: EdgeSliceCandidate; v: number }> = [];
  for (const c of args.candidates) {
    const v = args.extract(c);
    if (typeof v === "number" && Number.isFinite(v)) {
      populated.push({ c, v });
    }
  }
  if (populated.length === 0) {
    return [
      bucketMetric("low", [], { min: 0, max: 0 }),
      bucketMetric("medium", [], { min: 0, max: 0 }),
      bucketMetric("high", [], { min: 0, max: 0 }),
    ];
  }
  if (populated.length < 6) {
    // Too few candidates to tercile-split meaningfully — surface
    // the whole pool as "medium" and leave the other two
    // buckets empty.
    return [
      bucketMetric("low", [], { min: 0, max: 0 }),
      bucketMetric(
        "medium",
        populated.map((x) => x.c),
        {
          min: Math.min(...populated.map((x) => x.v)),
          max: Math.max(...populated.map((x) => x.v)),
        },
      ),
      bucketMetric("high", [], { min: 0, max: 0 }),
    ];
  }
  const sorted = [...populated].sort((a, b) => a.v - b.v);
  const lowCutoff = sorted[Math.floor(sorted.length / 3)].v;
  const highCutoff = sorted[Math.floor((2 * sorted.length) / 3)].v;
  const low: typeof sorted = [];
  const medium: typeof sorted = [];
  const high: typeof sorted = [];
  for (const x of sorted) {
    if (x.v <= lowCutoff) low.push(x);
    else if (x.v < highCutoff) medium.push(x);
    else high.push(x);
  }
  const rangeOf = (xs: typeof sorted) =>
    xs.length === 0
      ? { min: 0, max: 0 }
      : { min: xs[0].v, max: xs[xs.length - 1].v };
  return [
    bucketMetric(
      "low",
      low.map((x) => x.c),
      rangeOf(low),
    ),
    bucketMetric(
      "medium",
      medium.map((x) => x.c),
      rangeOf(medium),
    ),
    bucketMetric(
      "high",
      high.map((x) => x.c),
      rangeOf(high),
    ),
  ];
}

function bucketMetric(
  bucket: SignalBucket,
  candidates: EdgeSliceCandidate[],
  range: { min: number; max: number },
): SignalBucketMetrics {
  const agg = aggregate(candidates);
  return {
    bucket,
    range,
    plays: agg.plays,
    wins: agg.wins,
    losses: agg.losses,
    pushes: agg.pushes,
    noResult: agg.noResult,
    hitRatePct: agg.hitRatePct,
    roiPct: agg.roiPct,
    unitsProfit: agg.unitsProfit,
    avgEdgePct: agg.avgEdgePct,
    avgModelProbPct: agg.avgModelProbPct,
    calibrationErrorPp: agg.calibrationErrorPp,
  };
}

function featureReport(args: {
  feature: string;
  candidates: ReadonlyArray<EdgeSliceCandidate>;
  extract: (c: EdgeSliceCandidate) => number | undefined;
}): FeatureBucketReport {
  const withSignal = args.candidates.filter((c) => {
    const v = args.extract(c);
    return typeof v === "number" && Number.isFinite(v);
  });
  const buckets = tercileBuckets({
    candidates: args.candidates,
    extract: args.extract,
  });
  const high = buckets.find((b) => b.bucket === "high");
  const low = buckets.find((b) => b.bucket === "low");
  const highMinusLowRoiPp =
    high && low ? high.roiPct - low.roiPct : 0;
  return {
    feature: args.feature,
    candidatesWithSignal: withSignal.length,
    candidatesTotal: args.candidates.length,
    buckets,
    highMinusLowRoiPp,
  };
}

function combinationSlice(
  label: string,
  predicate: string,
  candidates: EdgeSliceCandidate[],
): CombinationSliceMetrics {
  const agg = aggregate(candidates);
  return {
    label,
    predicate,
    plays: agg.plays,
    wins: agg.wins,
    losses: agg.losses,
    pushes: agg.pushes,
    hitRatePct: agg.hitRatePct,
    roiPct: agg.roiPct,
    unitsProfit: agg.unitsProfit,
    avgEdgePct: agg.avgEdgePct,
    avgModelProbPct: agg.avgModelProbPct,
    calibrationErrorPp: agg.calibrationErrorPp,
  };
}

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function formatBucketRow(bucket: SignalBucketMetrics): string {
  const rangeStr =
    bucket.plays === 0
      ? "—"
      : `[${bucket.range.min.toFixed(2)} .. ${bucket.range.max.toFixed(2)}]`;
  return (
    pad(`  ${bucket.bucket}`, 12) +
    pad(rangeStr, 22, "R") +
    pad(bucket.plays, 7, "R") +
    pad(`${bucket.wins}-${bucket.losses}`, 10, "R") +
    pad(`${bucket.hitRatePct.toFixed(1)}%`, 8, "R") +
    pad(`${bucket.roiPct >= 0 ? "+" : ""}${bucket.roiPct.toFixed(1)}%`, 9, "R") +
    pad(
      `${bucket.unitsProfit >= 0 ? "+" : ""}${bucket.unitsProfit.toFixed(2)}`,
      9,
      "R",
    ) +
    pad(`${bucket.avgEdgePct.toFixed(1)}%`, 8, "R") +
    pad(`${bucket.avgModelProbPct.toFixed(1)}%`, 9, "R") +
    pad(
      `${bucket.calibrationErrorPp >= 0 ? "+" : ""}${bucket.calibrationErrorPp.toFixed(1)}pp`,
      9,
      "R",
    )
  );
}

function formatFeature(report: FeatureBucketReport): string {
  const lines: string[] = [];
  lines.push(
    `Feature: ${report.feature} (${report.candidatesWithSignal}/${report.candidatesTotal} carry the signal)`,
  );
  lines.push(
    pad("  Bucket", 12) +
      pad("Range", 22, "R") +
      pad("Plays", 7, "R") +
      pad("W-L", 10, "R") +
      pad("Hit", 8, "R") +
      pad("ROI", 9, "R") +
      pad("Units", 9, "R") +
      pad("Edge", 8, "R") +
      pad("ModelP", 9, "R") +
      pad("CalErr", 9, "R"),
  );
  for (const b of report.buckets) lines.push(formatBucketRow(b));
  lines.push(
    `  ROI delta (high − low): ${report.highMinusLowRoiPp >= 0 ? "+" : ""}${report.highMinusLowRoiPp.toFixed(1)}pp`,
  );
  return lines.join("\n");
}

function formatCombination(c: CombinationSliceMetrics): string {
  return (
    pad(c.label, 40) +
    pad(c.plays, 7, "R") +
    pad(`${c.wins}-${c.losses}`, 10, "R") +
    pad(`${c.hitRatePct.toFixed(1)}%`, 8, "R") +
    pad(`${c.roiPct >= 0 ? "+" : ""}${c.roiPct.toFixed(1)}%`, 9, "R") +
    pad(`${c.unitsProfit >= 0 ? "+" : ""}${c.unitsProfit.toFixed(2)}`, 9, "R") +
    pad(`${c.avgEdgePct.toFixed(1)}%`, 8, "R") +
    pad(`${c.avgModelProbPct.toFixed(1)}%`, 9, "R") +
    pad(
      `${c.calibrationErrorPp >= 0 ? "+" : ""}${c.calibrationErrorPp.toFixed(1)}pp`,
      9,
      "R",
    )
  );
}

/**
 * Build the full signal-quality audit. Pure — every metric is
 * derived from the in-memory candidate pool the caller already
 * loaded. No IO.
 */
export function buildSignalQualityReport(args: {
  candidates: ReadonlyArray<EdgeSliceCandidate>;
  /** Raw scripts for the per-script-direction combination —
   *  defaults to homeAway="HOME" being treated as "leading"
   *  for the purpose of the diagnostic. Real lead/trail data
   *  isn't on NflPlayerWeekStat so this is the coarsest
   *  approximation we can do without pbp ingestion. */
}): SignalQualityReport {
  const withFeatures = args.candidates.filter(
    (c) => c.signalFeatures !== undefined,
  );

  const featureBuckets: FeatureBucketReport[] = [
    featureReport({
      feature: "roleChangeScore",
      candidates: args.candidates,
      extract: (c) => c.signalFeatures?.roleChangeScore,
    }),
    featureReport({
      feature: "usageMomentumScore",
      candidates: args.candidates,
      extract: (c) => c.signalFeatures?.usageMomentumScore,
    }),
    featureReport({
      feature: "volatilityScore",
      candidates: args.candidates,
      extract: (c) => c.signalFeatures?.volatilityScore,
    }),
    featureReport({
      feature: "distributionBiasScore",
      candidates: args.candidates,
      extract: (c) => c.signalFeatures?.distributionBiasScore,
    }),
    featureReport({
      feature: "scriptSensitivityScore",
      candidates: args.candidates,
      extract: (c) => c.signalFeatures?.scriptSensitivityScore,
    }),
    featureReport({
      feature: "marketResistanceScore",
      candidates: args.candidates,
      extract: (c) => c.signalFeatures?.marketResistanceScore,
    }),
  ];

  // Combination slices the user explicitly requested.
  const highRoleAndPositiveMomentum: EdgeSliceCandidate[] = [];
  const lowVolPositiveEdge: EdgeSliceCandidate[] = [];
  const strongScriptMatching: EdgeSliceCandidate[] = [];
  const strongResistanceAndEdge: EdgeSliceCandidate[] = [];

  // Tercile thresholds for "high" — use the same tercile
  // cutoffs as featureReport so the combinations match.
  const roleSorted = [...withFeatures]
    .map((c) => c.signalFeatures?.roleChangeScore ?? Number.NaN)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const roleHighCutoff =
    roleSorted.length > 0
      ? roleSorted[Math.floor((2 * roleSorted.length) / 3)]
      : Number.POSITIVE_INFINITY;
  const volSorted = [...withFeatures]
    .map((c) => c.signalFeatures?.volatilityScore ?? Number.NaN)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const volLowCutoff =
    volSorted.length > 0
      ? volSorted[Math.floor(volSorted.length / 3)]
      : Number.NEGATIVE_INFINITY;
  const resSorted = [...withFeatures]
    .map((c) => c.signalFeatures?.marketResistanceScore ?? Number.NaN)
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  const resHighCutoff =
    resSorted.length > 0
      ? resSorted[Math.floor((2 * resSorted.length) / 3)]
      : Number.POSITIVE_INFINITY;

  for (const c of withFeatures) {
    const f = c.signalFeatures;
    if (!f) continue;
    if (f.roleChangeScore >= roleHighCutoff && f.usageMomentumScore > 0) {
      highRoleAndPositiveMomentum.push(c);
    }
    if (f.volatilityScore <= volLowCutoff && c.edge > 0) {
      lowVolPositiveEdge.push(c);
    }
    // "Strong scriptSensitivity + matching game script" — we
    // don't have lead/trail signal on stored data; coarsest
    // proxy is |scriptSensitivityScore| > 0.20 which means the
    // player's HOME share diverges from AWAY by >20%.
    if (Math.abs(f.scriptSensitivityScore) > 0.2) {
      strongScriptMatching.push(c);
    }
    if (f.marketResistanceScore >= resHighCutoff && c.edge >= 0.04) {
      strongResistanceAndEdge.push(c);
    }
  }

  const combinations: CombinationSliceMetrics[] = [
    combinationSlice(
      "high roleChange + positive usageMomentum",
      `roleChangeScore ≥ ${roleHighCutoff.toFixed(2)} AND usageMomentumScore > 0`,
      highRoleAndPositiveMomentum,
    ),
    combinationSlice(
      "low volatility + positive edge",
      `volatilityScore ≤ ${volLowCutoff.toFixed(2)} AND edge > 0`,
      lowVolPositiveEdge,
    ),
    combinationSlice(
      "strong scriptSensitivity (|score| > 0.20)",
      "abs(scriptSensitivityScore) > 0.20",
      strongScriptMatching,
    ),
    combinationSlice(
      "strong marketResistance + edge ≥ 4%",
      `marketResistanceScore ≥ ${resHighCutoff.toFixed(2)} AND edge ≥ 0.04`,
      strongResistanceAndEdge,
    ),
  ];

  const featureRankingByRoiDelta = featureBuckets
    .map((f) => ({ feature: f.feature, deltaPp: f.highMinusLowRoiPp }))
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp));

  const lines: string[] = [];
  lines.push(
    "=== Signal Quality Audit · DIAGNOSTIC ONLY · no model change ===",
  );
  lines.push(
    `${withFeatures.length}/${args.candidates.length} candidates carry the new signalFeatures payload. ` +
      `Older persisted calibrations report 0 — re-grade those weeks to populate.`,
  );
  lines.push("");
  for (const f of featureBuckets) {
    lines.push(formatFeature(f));
    lines.push("");
  }
  lines.push("Combination slices:");
  lines.push(
    pad("Slice", 40) +
      pad("Plays", 7, "R") +
      pad("W-L", 10, "R") +
      pad("Hit", 8, "R") +
      pad("ROI", 9, "R") +
      pad("Units", 9, "R") +
      pad("Edge", 8, "R") +
      pad("ModelP", 9, "R") +
      pad("CalErr", 9, "R"),
  );
  for (const c of combinations) lines.push(formatCombination(c));
  lines.push("");
  lines.push("Feature ranking by |high − low ROI delta| (strongest first):");
  for (const r of featureRankingByRoiDelta) {
    lines.push(
      `  · ${pad(r.feature, 28)} ${r.deltaPp >= 0 ? "+" : ""}${r.deltaPp.toFixed(1)}pp`,
    );
  }
  lines.push(
    "\n--- DIAGNOSTIC ONLY · No threshold or model logic changed · Read-only ---",
  );

  return {
    diagnosticOnly: true,
    generatedAt: new Date().toISOString(),
    candidatesTotal: args.candidates.length,
    candidatesWithFeatures: withFeatures.length,
    featureBuckets,
    combinations,
    featureRankingByRoiDelta,
    formatted: lines.join("\n"),
  };
}
