/**
 * WR receptions signal analysis — diagnostic only.
 *
 * Buckets every WR receptions candidate in the gate-0.40 pool
 * by each of the new mispricing signals (low / medium / high
 * terciles) and reports plays / W-L / hit rate / ROI / units /
 * avg edge / avg model probability / actual hit rate /
 * calibration error.
 *
 * Also tests four named combination slices:
 *   · high roleChange + high route participation
 *   · high roleChange + market lag
 *   · low volatility + edge ≥ 4%
 *   · high PROE + high roleChange
 *
 * Market lag is computed inside this module because it needs
 * cross-week visibility (prior-week candidate for the same
 * player) that isn't available at the per-candidate scorecard
 * pass. Lag is high when the player's role rose but the
 * market-implied probability barely moved week-over-week.
 *
 * Output explicitly states "No measurable edge found in WR
 * receptions under current data" when no bucket / combination
 * clears the spec's targets (positive ROI AND hit rate > 55%
 * AND lower calibration error than the pool average).
 *
 * Pure function — no IO, no API, no DB. Operates on the in-
 * memory candidate pool the edge-slice diagnostic already
 * loads. The audit never changes the scorecard, the edge
 * threshold, the calibration constants, or any other piece of
 * production selection logic.
 */

import type { EdgeSliceCandidate } from "./edge-slice-diagnostic";

export type WrSignalBucket = "low" | "medium" | "high";

export interface WrBucketMetrics {
  bucket: WrSignalBucket;
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
  /** Actual hit rate is just hitRatePct, kept on the report
   *  for clarity since the spec asks for it explicitly
   *  alongside avgModelProbPct. */
  actualHitRatePct: number;
  calibrationErrorPp: number;
}

export interface WrFeatureReport {
  feature: string;
  candidatesWithSignal: number;
  candidatesTotal: number;
  buckets: WrBucketMetrics[];
  highMinusLowRoiPp: number;
}

export interface WrCombinationMetrics {
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

export interface WrReceptionsAnalysisReport {
  diagnosticOnly: true;
  generatedAt: string;
  candidatesTotal: number;
  wrReceptionsTotal: number;
  candidatesWithSignals: number;
  /** Pool-wide hit / ROI / calibration baseline so the
   *  "edge found?" check has something to compare against. */
  baseline: {
    plays: number;
    hitRatePct: number;
    roiPct: number;
    calibrationErrorPp: number;
  };
  features: WrFeatureReport[];
  combinations: WrCombinationMetrics[];
  /** Per-candidate market-lag scores keyed by candidateId.
   *  Lag is high when player role rose but market line
   *  barely moved week-over-week. Empty when fewer than two
   *  weeks of candidates were supplied. */
  marketLagByCandidate: Record<string, number>;
  /** Plain-English headline: which subset (if any) showed
   *  positive ROI + hit > 55% + lower calibration error than
   *  the pool baseline. `null` when no subset qualified. */
  edgeFound: {
    found: boolean;
    label: string | null;
    plays: number;
    hitRatePct: number;
    roiPct: number;
    calibrationErrorPp: number;
  };
  formatted: string;
}

interface AggregateMetrics {
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

function aggregate(
  candidates: ReadonlyArray<EdgeSliceCandidate>,
): AggregateMetrics {
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

function tercileBuckets(args: {
  candidates: ReadonlyArray<EdgeSliceCandidate>;
  extract: (c: EdgeSliceCandidate) => number | undefined;
}): WrBucketMetrics[] {
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
  bucket: WrSignalBucket,
  candidates: EdgeSliceCandidate[],
  range: { min: number; max: number },
): WrBucketMetrics {
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
    actualHitRatePct: agg.hitRatePct,
    calibrationErrorPp: agg.calibrationErrorPp,
  };
}

function featureReport(args: {
  feature: string;
  candidates: ReadonlyArray<EdgeSliceCandidate>;
  extract: (c: EdgeSliceCandidate) => number | undefined;
}): WrFeatureReport {
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

function combinationMetric(
  label: string,
  predicate: string,
  candidates: EdgeSliceCandidate[],
): WrCombinationMetrics {
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

/**
 * Compute per-candidate market lag. Definition:
 *
 *   marketLag = roleChange × (1 − |Δ marketProbability| × 10)
 *
 * High lag = the player's role rose but the book's implied
 * probability barely budged. Clamped to [0, 1] — negative
 * lag is meaningless under this construction so we floor it.
 *
 * The function assumes `candidates` covers multiple weeks so a
 * per-player prior week can be located. When no prior week
 * exists for a given candidate, lag is `0` (no signal).
 */
export function computeMarketLagByCandidate(
  candidates: ReadonlyArray<EdgeSliceCandidate>,
): Record<string, number> {
  const out: Record<string, number> = {};
  // Index per-player prior weeks. Key = player + propType,
  // sorted by week so we can look up the latest-prior row.
  const byPlayer = new Map<string, EdgeSliceCandidate[]>();
  for (const c of candidates) {
    const key = `${c.playerName}::${c.propType}`;
    const list = byPlayer.get(key) ?? [];
    list.push(c);
    byPlayer.set(key, list);
  }
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.week - b.week);
  }
  for (const c of candidates) {
    if (!c.wrReceptionsSignals) continue;
    const list = byPlayer.get(`${c.playerName}::${c.propType}`) ?? [];
    const idx = list.findIndex((x) => x.candidateId === c.candidateId);
    if (idx <= 0) {
      // No prior week visible — lag undefined.
      continue;
    }
    const prior = list[idx - 1];
    const deltaMarket = Math.abs(
      c.marketProbability - prior.marketProbability,
    );
    const role = c.wrReceptionsSignals.roleChange;
    // Tightness factor: 0 when market moved ≥ 10pp, 1 when
    // market is stationary.
    const tightness = Math.max(0, 1 - deltaMarket * 10);
    const lag = Math.max(0, role) * tightness;
    out[c.candidateId] = Math.min(Math.max(lag, 0), 1);
  }
  return out;
}

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function formatBucketRow(b: WrBucketMetrics): string {
  const rangeStr =
    b.plays === 0
      ? "—"
      : `[${b.range.min.toFixed(2)} .. ${b.range.max.toFixed(2)}]`;
  return (
    pad(`  ${b.bucket}`, 12) +
    pad(rangeStr, 22, "R") +
    pad(b.plays, 7, "R") +
    pad(`${b.wins}-${b.losses}`, 10, "R") +
    pad(`${b.hitRatePct.toFixed(1)}%`, 8, "R") +
    pad(`${b.roiPct >= 0 ? "+" : ""}${b.roiPct.toFixed(1)}%`, 9, "R") +
    pad(`${b.unitsProfit >= 0 ? "+" : ""}${b.unitsProfit.toFixed(2)}`, 9, "R") +
    pad(`${b.avgEdgePct.toFixed(1)}%`, 8, "R") +
    pad(`${b.avgModelProbPct.toFixed(1)}%`, 9, "R") +
    pad(`${b.actualHitRatePct.toFixed(1)}%`, 9, "R") +
    pad(
      `${b.calibrationErrorPp >= 0 ? "+" : ""}${b.calibrationErrorPp.toFixed(1)}pp`,
      9,
      "R",
    )
  );
}

function formatFeature(report: WrFeatureReport): string {
  const lines: string[] = [];
  lines.push(
    `Signal: ${report.feature} (${report.candidatesWithSignal}/${report.candidatesTotal} carry it)`,
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
      pad("Actual", 9, "R") +
      pad("CalErr", 9, "R"),
  );
  for (const b of report.buckets) lines.push(formatBucketRow(b));
  lines.push(
    `  ROI delta (high − low): ${report.highMinusLowRoiPp >= 0 ? "+" : ""}${report.highMinusLowRoiPp.toFixed(1)}pp`,
  );
  return lines.join("\n");
}

function formatCombination(c: WrCombinationMetrics): string {
  return (
    pad(c.label, 44) +
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
 * Build the full WR receptions analysis. Pure — every metric
 * is derived from the in-memory candidate pool the caller
 * already loaded. No IO.
 */
export function buildWrReceptionsAnalysis(args: {
  candidates: ReadonlyArray<EdgeSliceCandidate>;
}): WrReceptionsAnalysisReport {
  // Filter to WR RECEPTIONS only. The signal-computation
  // layer already enforces both (propType + position from
  // history); presence of wrReceptionsSignals encodes WR.
  const wr = args.candidates.filter(
    (c) => c.propType === "RECEPTIONS" && c.wrReceptionsSignals !== undefined,
  );
  const marketLagByCandidate = computeMarketLagByCandidate(args.candidates);
  const baselineAgg = aggregate(wr);
  const baseline = {
    plays: baselineAgg.plays,
    hitRatePct: baselineAgg.hitRatePct,
    roiPct: baselineAgg.roiPct,
    calibrationErrorPp: baselineAgg.calibrationErrorPp,
  };

  // Compute tercile cutoffs once so the buckets and the
  // combination predicates use the same definition of "high".
  const cutoff = (
    extract: (c: EdgeSliceCandidate) => number | undefined,
    side: "low" | "high",
  ): number => {
    const values: number[] = [];
    for (const c of wr) {
      const v = extract(c);
      if (typeof v === "number" && Number.isFinite(v)) values.push(v);
    }
    if (values.length === 0) {
      return side === "high"
        ? Number.POSITIVE_INFINITY
        : Number.NEGATIVE_INFINITY;
    }
    values.sort((a, b) => a - b);
    const idx =
      side === "high"
        ? Math.floor((2 * values.length) / 3)
        : Math.floor(values.length / 3);
    return values[idx];
  };

  const roleHigh = cutoff((c) => c.wrReceptionsSignals?.roleChange, "high");
  const routeHigh = cutoff(
    (c) => c.wrReceptionsSignals?.routeParticipationSlope,
    "high",
  );
  const volLow = cutoff(
    (c) => c.wrReceptionsSignals?.targetShareVolatility,
    "low",
  );
  const proeHigh = cutoff((c) => c.wrReceptionsSignals?.teamProe, "high");
  const lagHigh = cutoff(
    (c) => marketLagByCandidate[c.candidateId],
    "high",
  );

  const features: WrFeatureReport[] = [
    featureReport({
      feature: "roleChange",
      candidates: wr,
      extract: (c) => c.wrReceptionsSignals?.roleChange,
    }),
    featureReport({
      feature: "routeParticipationSlope",
      candidates: wr,
      extract: (c) => c.wrReceptionsSignals?.routeParticipationSlope,
    }),
    featureReport({
      feature: "targetShareVolatility",
      candidates: wr,
      extract: (c) => c.wrReceptionsSignals?.targetShareVolatility,
    }),
    featureReport({
      feature: "teamProe",
      candidates: wr,
      extract: (c) => c.wrReceptionsSignals?.teamProe,
    }),
    featureReport({
      feature: "marketLag",
      candidates: wr,
      extract: (c) => marketLagByCandidate[c.candidateId],
    }),
  ];

  // Combinations the spec named explicitly.
  const highRoleHighRoute: EdgeSliceCandidate[] = [];
  const highRoleMarketLag: EdgeSliceCandidate[] = [];
  const lowVolPositiveEdge: EdgeSliceCandidate[] = [];
  const highProeHighRole: EdgeSliceCandidate[] = [];
  for (const c of wr) {
    const f = c.wrReceptionsSignals;
    if (!f) continue;
    const lag = marketLagByCandidate[c.candidateId] ?? 0;
    if (f.roleChange >= roleHigh && f.routeParticipationSlope >= routeHigh) {
      highRoleHighRoute.push(c);
    }
    if (f.roleChange >= roleHigh && lag >= lagHigh && lagHigh > 0) {
      highRoleMarketLag.push(c);
    }
    if (f.targetShareVolatility <= volLow && c.edge >= 0.04) {
      lowVolPositiveEdge.push(c);
    }
    if (f.teamProe >= proeHigh && f.roleChange >= roleHigh) {
      highProeHighRole.push(c);
    }
  }

  const combinations: WrCombinationMetrics[] = [
    combinationMetric(
      "high roleChange + high route participation",
      `roleChange ≥ ${roleHigh.toFixed(2)} AND routeParticipationSlope ≥ ${routeHigh.toFixed(2)}`,
      highRoleHighRoute,
    ),
    combinationMetric(
      "high roleChange + market lag",
      `roleChange ≥ ${roleHigh.toFixed(2)} AND marketLag ≥ ${lagHigh.toFixed(2)}`,
      highRoleMarketLag,
    ),
    combinationMetric(
      "low volatility + edge ≥ 4%",
      `targetShareVolatility ≤ ${volLow.toFixed(2)} AND edge ≥ 0.04`,
      lowVolPositiveEdge,
    ),
    combinationMetric(
      "high PROE + high roleChange",
      `teamProe ≥ ${proeHigh.toFixed(2)} AND roleChange ≥ ${roleHigh.toFixed(2)}`,
      highProeHighRole,
    ),
  ];

  // "Edge found" verdict: a subset (bucket OR combination) is
  // counted as an edge when ALL three hold:
  //   plays ≥ 5 (so the result isn't noise)
  //   roiPct > 0
  //   hitRatePct > 55
  //   |calibrationErrorPp| < baseline.calibrationErrorPp
  // The spec's targets explicitly. Pick the one with the
  // highest ROI; tie-break by hit rate.
  type Candidate = {
    label: string;
    plays: number;
    hitRatePct: number;
    roiPct: number;
    calibrationErrorPp: number;
  };
  const candidatesForEdge: Candidate[] = [];
  for (const feature of features) {
    for (const b of feature.buckets) {
      candidatesForEdge.push({
        label: `${feature.feature} · ${b.bucket}`,
        plays: b.plays,
        hitRatePct: b.hitRatePct,
        roiPct: b.roiPct,
        calibrationErrorPp: b.calibrationErrorPp,
      });
    }
  }
  for (const c of combinations) {
    candidatesForEdge.push({
      label: c.label,
      plays: c.plays,
      hitRatePct: c.hitRatePct,
      roiPct: c.roiPct,
      calibrationErrorPp: c.calibrationErrorPp,
    });
  }
  const baselineAbsCalErr = Math.abs(baseline.calibrationErrorPp);
  const qualifying = candidatesForEdge.filter(
    (c) =>
      c.plays >= 5 &&
      c.roiPct > 0 &&
      c.hitRatePct > 55 &&
      Math.abs(c.calibrationErrorPp) < baselineAbsCalErr,
  );
  qualifying.sort(
    (a, b) => b.roiPct - a.roiPct || b.hitRatePct - a.hitRatePct,
  );
  const edgeFound = qualifying[0]
    ? {
        found: true,
        label: qualifying[0].label,
        plays: qualifying[0].plays,
        hitRatePct: qualifying[0].hitRatePct,
        roiPct: qualifying[0].roiPct,
        calibrationErrorPp: qualifying[0].calibrationErrorPp,
      }
    : {
        found: false,
        label: null,
        plays: 0,
        hitRatePct: 0,
        roiPct: 0,
        calibrationErrorPp: 0,
      };

  const lines: string[] = [];
  lines.push("=== WR RECEPTIONS SIGNAL ANALYSIS ===");
  lines.push(
    `WR receptions candidates with signals: ${wr.length}/${args.candidates.length}. ` +
      `Older persisted calibrations may report 0 — re-grade those weeks to populate.`,
  );
  lines.push(
    `Pool baseline: ${baseline.plays} plays · ${baseline.hitRatePct.toFixed(1)}% hit · ` +
      `${baseline.roiPct >= 0 ? "+" : ""}${baseline.roiPct.toFixed(1)}% ROI · ` +
      `cal ${baseline.calibrationErrorPp >= 0 ? "+" : ""}${baseline.calibrationErrorPp.toFixed(1)}pp`,
  );
  lines.push("");
  for (const f of features) {
    lines.push(formatFeature(f));
    lines.push("");
  }
  lines.push("Combinations:");
  lines.push(
    pad("Slice", 44) +
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
  if (edgeFound.found && edgeFound.label) {
    lines.push(
      `VERDICT: Edge candidate found → ${edgeFound.label}: ` +
        `${edgeFound.plays} plays, ${edgeFound.hitRatePct.toFixed(1)}% hit, ` +
        `${edgeFound.roiPct >= 0 ? "+" : ""}${edgeFound.roiPct.toFixed(1)}% ROI, ` +
        `cal ${edgeFound.calibrationErrorPp >= 0 ? "+" : ""}${edgeFound.calibrationErrorPp.toFixed(1)}pp ` +
        `(beats pool baseline of |cal|=${baselineAbsCalErr.toFixed(1)}pp).`,
    );
    lines.push(
      "Diagnostic only — production thresholds unchanged. Validate on more weeks before any selection-logic change.",
    );
  } else {
    lines.push("No measurable edge found in WR receptions under current data");
    lines.push(
      `(no bucket or combination cleared: plays ≥ 5, ROI > 0, hit > 55%, |cal| < ${baselineAbsCalErr.toFixed(1)}pp).`,
    );
  }
  lines.push(
    "--- DIAGNOSTIC ONLY · No threshold or model logic changed · Read-only ---",
  );

  return {
    diagnosticOnly: true,
    generatedAt: new Date().toISOString(),
    candidatesTotal: args.candidates.length,
    wrReceptionsTotal: wr.length,
    candidatesWithSignals: wr.length,
    baseline,
    features,
    combinations,
    marketLagByCandidate,
    edgeFound,
    formatted: lines.join("\n"),
  };
}
