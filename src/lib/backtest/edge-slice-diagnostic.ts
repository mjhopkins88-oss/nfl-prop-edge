/**
 * Edge-quality diagnostic slice report — library.
 *
 * Computes five edge-filtered slices off a set of stored
 * gate-0.40 calibration candidates and produces both a
 * structured payload (the admin action persists this in the
 * result `data` block) and a formatted multi-line string (the
 * admin result panel renders this verbatim).
 *
 * Pure function. Read-only. No paid API call. No threshold
 * change. No grading. No ingestion. Consumes the
 * `marketContextCalibration.gate040.candidates` payload that
 * the admin grade action already persists on each
 * StoredBacktestRun row.
 */

import type {
  CalibrationCandidate,
  MarketContextCalibrationReplay,
} from "./market-context-calibration";
import type { SignalFeatures } from "./signal-features";
import {
  buildSignalQualityReport,
  type SignalQualityReport,
} from "./signal-quality-audit";
import type { StoredWeekSnapshot } from "./week-1-monitor-summary";
import type { WrReceptionsSignals } from "./wr-receptions-signals";
import {
  buildWrReceptionsAnalysis,
  type WrReceptionsAnalysisReport,
} from "./wr-receptions-analysis";

export interface EdgeSliceCandidate {
  week: number;
  candidateId: string;
  playerName: string;
  propType: string;
  edge: number;
  modelProbability: number;
  marketProbability: number;
  confidence: number;
  dataQualityScore: number;
  /** Numeric volatility score derived from the scorecard's
   *  volatilityLevel: low → 0.25, medium → 0.50, high → 0.75.
   *  Defaults to 0.50 (medium) when the scorecard didn't carry
   *  a level. Used by the composite ranking — lower volatility
   *  contributes more to the score via `(1 - volatilityScore)`. */
  volatilityScore: number;
  /** `true` when the calibration candidate carried an explicit
   *  volatilityLevel (i.e. came from a recent scorecard pass).
   *  Older persisted calibrations default to medium and set
   *  this to `false`. */
  volatilityLevelPresent: boolean;
  /** `true` when the calibration candidate carried an explicit
   *  dataQualityScore. Older persisted calibrations default to
   *  0.50 and set this to `false`. */
  dataQualityScorePresent: boolean;
  outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  profitPerUnit: number;
  productionQualified: boolean;
  /** Composite score for the diagnostic ranking. See
   *  `computeCompositeScore` for the exact formula. */
  compositeScore: number;
  /** Diagnostic mispricing features computed from the
   *  candidate's strict-before history. Optional so older
   *  persisted calibrations without the field still load —
   *  the signal-quality audit reports the carry rate so the
   *  operator can see how many candidates had the signal. */
  signalFeatures?: SignalFeatures;
  /** WR-receptions-only diagnostic signals. Populated only
   *  when the candidate is a WR receptions prop with enough
   *  history; the WR receptions analysis layer filters on
   *  presence of this field. */
  wrReceptionsSignals?: WrReceptionsSignals;
}

const DEFAULT_DATA_QUALITY = 0.5;
const DEFAULT_VOLATILITY_SCORE = 0.5;

/** Map the scorecard's categorical volatilityLevel into a
 *  numeric score. Lower number = lower volatility = better. */
export function volatilityScoreFromLevel(
  level: "low" | "medium" | "high" | undefined,
): number {
  if (level === "low") return 0.25;
  if (level === "high") return 0.75;
  // medium and undefined both map to 0.50 — the user explicitly
  // asked for the "missing → neutral 0.50" fallback.
  return 0.5;
}

/**
 * Composite straight-bet ranking score. Higher = better. The
 * weights match the spec the user proposed:
 *
 *   compositeScore =
 *       calibratedEdge       × 0.40
 *     + confidenceScore      × 0.20
 *     + dataQualityScore     × 0.20
 *     + (1 - volatilityScore) × 0.20
 *
 * Inputs are expected on a roughly 0..1 scale. Edge can exceed
 * 1 in theory but in practice the calibration cap keeps it
 * inside ±0.25 — the composite is meaningful, not bounded.
 */
export function computeCompositeScore(args: {
  calibratedEdge: number;
  confidenceScore: number;
  dataQualityScore: number;
  volatilityScore: number;
}): number {
  return (
    args.calibratedEdge * 0.4 +
    args.confidenceScore * 0.2 +
    args.dataQualityScore * 0.2 +
    (1 - args.volatilityScore) * 0.2
  );
}

export interface EdgeSliceMetrics {
  label: string;
  edgeFloor: number | null;
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  avgEdgePct: number;
  avgImpliedProbPct: number;
  avgModelProbPct: number;
  calibrationErrorPp: number;
  /** Optional — populated on composite-ranking slices only. */
  avgCompositeScore?: number;
}

export interface EdgeSliceReport {
  diagnosticOnly: true;
  generatedAt: string;
  productionGate: 0.45;
  replayGate: 0.4;
  weeksRequested: number[];
  weeksWithCalibration: number[];
  weeksWithoutCalibration: number[];
  candidateCount: number;
  slices: EdgeSliceMetrics[];
  /** Diagnostic-only composite ranking slices. Ranks the
   *  gate-0.40 candidate pool by `compositeScore` and reports
   *  performance for the top 10 / 15 / 20 / 25 picks — answers
   *  "does ranking by composite beat the edge ≥ 4% baseline?".
   *  Never changes production thresholds. */
  compositeSlices: EdgeSliceMetrics[];
  /** Per-candidate composite-score input stats so an operator
   *  can audit how the composite was built without re-running
   *  the report. Populated when at least one candidate carried
   *  the new (dataQuality + volatility) signals. */
  compositeInputs: {
    /** Count of candidates that carried an explicit
     *  dataQualityScore — older persisted calibrations default
     *  to 0.50. */
    candidatesWithDataQuality: number;
    /** Count of candidates that carried an explicit
     *  volatilityLevel — older persisted calibrations default
     *  to medium (0.50). */
    candidatesWithVolatility: number;
    candidatesTotal: number;
  };
  answers: {
    roiImprovesWithEdge: "yes" | "no" | "mixed" | "insufficient-data";
    anyPositiveRoi: boolean;
    bestSliceLabel: string | null;
    bestSliceRoiPct: number | null;
    systematicOverestimation:
      | "yes"
      | "no"
      | "mixed"
      | "insufficient-data";
    profitableEdgeThresholdPct: number | null;
    /** Comparative answer — does ranking the gate-0.40 pool by
     *  compositeScore (top N) outperform the existing edge ≥ 4%
     *  filter? `yes` when any composite slice beats the
     *  baseline's ROI; `no` when none does; `tie` when at
     *  least one matches it within 0.1pp. */
    compositeBeatsEdgeBaseline: "yes" | "no" | "tie" | "insufficient-data";
  };
  /** Diagnostic-only signal-quality audit. Buckets each of the
   *  six mispricing features into low/medium/high terciles and
   *  reports plays / W-L / hit / ROI / units / avg edge / avg
   *  model prob / calibration error per bucket. Also reports
   *  four combination slices the operator explicitly asked for.
   *  Never feeds production qualification. */
  signalQuality: SignalQualityReport;
  /** Diagnostic-only WR receptions signal analysis. Filters
   *  to WR receptions only and buckets each of the new WR-
   *  specific mispricing signals (roleChange, route
   *  participation, target-share volatility, PROE, market
   *  lag) plus four named combinations. Surfaces the verdict
   *  "edge found vs not" against pool baseline. Never feeds
   *  production qualification. */
  wrReceptionsAnalysis: WrReceptionsAnalysisReport;
  /** Plain-English headline summary for the admin action's
   *  `summary` field. */
  headline: string;
  /** Multi-line formatted report for the admin action's
   *  `detail` field — operators see the same output the CLI
   *  script prints. */
  formatted: string;
}

export function pickCandidatesFromSnapshots(
  snapshots: ReadonlyArray<StoredWeekSnapshot>,
): EdgeSliceCandidate[] {
  const out: EdgeSliceCandidate[] = [];
  for (const snap of snapshots) {
    const cal = snap.graded?.marketContextCalibration;
    if (!cal) continue;
    for (const c of cal.gate040.candidates) {
      const dataQualityScorePresent =
        typeof c.dataQualityScore === "number";
      const volatilityLevelPresent = c.volatilityLevel !== undefined;
      const dataQualityScore = dataQualityScorePresent
        ? (c.dataQualityScore as number)
        : DEFAULT_DATA_QUALITY;
      const volatilityScore = volatilityScoreFromLevel(c.volatilityLevel);
      const compositeScore = computeCompositeScore({
        calibratedEdge: c.edge,
        confidenceScore: c.confidence,
        dataQualityScore,
        volatilityScore,
      });
      out.push({
        week: snap.week,
        candidateId: c.candidateId,
        playerName: c.playerName,
        propType: c.propType,
        edge: c.edge,
        modelProbability: c.modelProbability,
        marketProbability: c.marketProbability,
        confidence: c.confidence,
        dataQualityScore,
        volatilityScore,
        volatilityLevelPresent,
        dataQualityScorePresent,
        outcome: c.outcome,
        profitPerUnit: c.profitPerUnit,
        productionQualified: c.productionQualified,
        compositeScore,
        signalFeatures: c.signalFeatures,
        wrReceptionsSignals: c.wrReceptionsSignals,
      });
    }
  }
  return out;
}

function computeSlice(args: {
  label: string;
  edgeFloor: number | null;
  candidates: EdgeSliceCandidate[];
  /** When true, also computes avgCompositeScore — used by the
   *  top-N composite slices. */
  withComposite?: boolean;
}): EdgeSliceMetrics {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noResult = 0;
  let unitsProfit = 0;
  let sumEdge = 0;
  let sumModelProb = 0;
  let sumMarketProb = 0;
  let sumComposite = 0;
  for (const c of args.candidates) {
    if (c.outcome === "WIN") wins += 1;
    else if (c.outcome === "LOSS") losses += 1;
    else if (c.outcome === "PUSH") pushes += 1;
    else noResult += 1;
    unitsProfit += c.profitPerUnit;
    sumEdge += c.edge;
    sumModelProb += c.modelProbability;
    sumMarketProb += c.marketProbability;
    sumComposite += c.compositeScore;
  }
  const decisive = wins + losses;
  const graded = wins + losses + pushes;
  const n = args.candidates.length;
  const hitRatePct = decisive > 0 ? (wins / decisive) * 100 : 0;
  const avgModelProbPct = n > 0 ? (sumModelProb / n) * 100 : 0;
  const metrics: EdgeSliceMetrics = {
    label: args.label,
    edgeFloor: args.edgeFloor,
    plays: n,
    wins,
    losses,
    pushes,
    noResult,
    hitRatePct,
    roiPct: graded > 0 ? (unitsProfit / graded) * 100 : 0,
    unitsProfit,
    avgEdgePct: n > 0 ? (sumEdge / n) * 100 : 0,
    avgImpliedProbPct: n > 0 ? (sumMarketProb / n) * 100 : 0,
    avgModelProbPct,
    calibrationErrorPp: avgModelProbPct - hitRatePct,
  };
  if (args.withComposite) {
    metrics.avgCompositeScore = n > 0 ? sumComposite / n : 0;
  }
  return metrics;
}

/**
 * Build the top-N-by-composite-score slices. The candidate
 * pool is the same gate-0.40 set the edge-floor slices read.
 * For each N in [10, 15, 20, 25] we sort the pool by
 * compositeScore desc, take the top N, and compute the slice
 * metrics — exact same arithmetic the edge-floor slices use,
 * so the two families are directly comparable.
 */
export function buildCompositeSlices(args: {
  candidates: ReadonlyArray<EdgeSliceCandidate>;
  ns?: number[];
}): EdgeSliceMetrics[] {
  const ranked = [...args.candidates].sort(
    (a, b) => b.compositeScore - a.compositeScore,
  );
  const ns = args.ns ?? [10, 15, 20, 25];
  const slices: EdgeSliceMetrics[] = [];
  for (const n of ns) {
    const top = ranked.slice(0, n);
    slices.push(
      computeSlice({
        label: `top ${n} by compositeScore`,
        edgeFloor: null,
        candidates: top,
        withComposite: true,
      }),
    );
  }
  return slices;
}

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function formatSlice(s: EdgeSliceMetrics): string {
  const lines: string[] = [];
  lines.push(`Slice: ${s.label}`);
  lines.push(`  Plays:            ${s.plays}`);
  const recordSuffix =
    (s.pushes > 0 ? ` (${s.pushes}P)` : "") +
    (s.noResult > 0 ? ` (${s.noResult} NO_DATA)` : "");
  lines.push(`  Record (W-L):     ${s.wins}-${s.losses}${recordSuffix}`);
  lines.push(`  Hit Rate:         ${s.hitRatePct.toFixed(1)}%`);
  lines.push(`  ROI:              ${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(1)}%`);
  lines.push(`  Units:            ${s.unitsProfit >= 0 ? "+" : ""}${s.unitsProfit.toFixed(2)}`);
  lines.push(`  Avg Edge:         ${s.avgEdgePct.toFixed(2)}%`);
  lines.push(`  Avg Implied Prob: ${s.avgImpliedProbPct.toFixed(1)}%`);
  lines.push(`  Avg Model Prob:   ${s.avgModelProbPct.toFixed(1)}%`);
  lines.push(`  Actual Hit:       ${s.hitRatePct.toFixed(1)}%`);
  const calLabel =
    s.calibrationErrorPp > 0
      ? "(model OVERestimates)"
      : s.calibrationErrorPp < 0
        ? "(model UNDERestimates)"
        : "(calibrated)";
  lines.push(
    `  Calibration Err:  ${s.calibrationErrorPp >= 0 ? "+" : ""}${s.calibrationErrorPp.toFixed(1)}pp ${calLabel}`,
  );
  return lines.join("\n");
}

function buildAnswers(args: {
  slices: ReadonlyArray<EdgeSliceMetrics>;
  compositeSlices: ReadonlyArray<EdgeSliceMetrics>;
}): EdgeSliceReport["answers"] {
  const slices = args.slices;
  const edgeOrdered = slices
    .filter((s) => s.edgeFloor !== null)
    .sort((a, b) => (a.edgeFloor ?? 0) - (b.edgeFloor ?? 0));
  const allSlices = [...slices, ...args.compositeSlices];
  const populated = allSlices.filter((s) => s.plays > 0);
  const best = populated.length === 0
    ? null
    : [...populated].sort((a, b) => b.roiPct - a.roiPct)[0];
  let roiImprovesWithEdge: EdgeSliceReport["answers"]["roiImprovesWithEdge"] =
    "insufficient-data";
  if (edgeOrdered.filter((s) => s.plays > 0).length >= 2) {
    let up = 0;
    let down = 0;
    const ordered = edgeOrdered.filter((s) => s.plays > 0);
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].roiPct > ordered[i - 1].roiPct) up += 1;
      else if (ordered[i].roiPct < ordered[i - 1].roiPct) down += 1;
    }
    if (up > 0 && down === 0) roiImprovesWithEdge = "yes";
    else if (down > 0 && up === 0) roiImprovesWithEdge = "no";
    else if (up > 0 || down > 0) roiImprovesWithEdge = "mixed";
  }
  let systematicOverestimation: EdgeSliceReport["answers"]["systematicOverestimation"] =
    "insufficient-data";
  if (populated.length > 0) {
    const allOver = populated.every((s) => s.calibrationErrorPp > 0);
    const allUnder = populated.every((s) => s.calibrationErrorPp < 0);
    if (allOver) systematicOverestimation = "yes";
    else if (allUnder) systematicOverestimation = "no";
    else systematicOverestimation = "mixed";
  }
  let profitableEdgeThresholdPct: number | null = null;
  for (const s of edgeOrdered) {
    if (s.plays === 0) continue;
    if (s.roiPct > 0) {
      profitableEdgeThresholdPct = (s.edgeFloor ?? 0) * 100;
      break;
    }
  }
  // Composite vs edge-baseline comparison. The baseline is the
  // `edge ≥ 4%` slice (the operator's current production-style
  // floor). We compare its ROI to each top-N composite slice;
  // the answer is `yes` when any composite slice beats it by
  // more than 0.1pp, `tie` when at least one matches it within
  // 0.1pp, `no` otherwise.
  const baseline = slices.find((s) => s.edgeFloor === 0.04);
  let compositeBeatsEdgeBaseline: EdgeSliceReport["answers"]["compositeBeatsEdgeBaseline"] =
    "insufficient-data";
  const populatedComposites = args.compositeSlices.filter((s) => s.plays > 0);
  if (baseline && baseline.plays > 0 && populatedComposites.length > 0) {
    let beats = false;
    let ties = false;
    for (const c of populatedComposites) {
      const diff = c.roiPct - baseline.roiPct;
      if (diff > 0.1) beats = true;
      else if (Math.abs(diff) <= 0.1) ties = true;
    }
    if (beats) compositeBeatsEdgeBaseline = "yes";
    else if (ties) compositeBeatsEdgeBaseline = "tie";
    else compositeBeatsEdgeBaseline = "no";
  }
  return {
    roiImprovesWithEdge,
    anyPositiveRoi: populated.some((s) => s.roiPct > 0),
    bestSliceLabel: best ? best.label : null,
    bestSliceRoiPct: best ? best.roiPct : null,
    systematicOverestimation,
    profitableEdgeThresholdPct,
    compositeBeatsEdgeBaseline,
  };
}

function formatReport(args: {
  weeksRequested: number[];
  weeksWithCalibration: number[];
  weeksWithoutCalibration: number[];
  candidateCount: number;
  slices: EdgeSliceMetrics[];
  compositeSlices: EdgeSliceMetrics[];
  compositeInputs: EdgeSliceReport["compositeInputs"];
  answers: EdgeSliceReport["answers"];
  signalQuality: SignalQualityReport;
  wrReceptionsAnalysis: WrReceptionsAnalysisReport;
}): string {
  const lines: string[] = [];
  lines.push(
    `Season 2025 · Weeks ${args.weeksRequested.join(", ")} · diagnostic gate = 0.40 · analysis only`,
  );
  if (args.weeksWithoutCalibration.length > 0) {
    lines.push(
      `\nWeek(s) skipped (no calibration payload — re-grade this week first to persist marketContextCalibration): ${args.weeksWithoutCalibration.map((w) => `W${w}`).join(", ")}`,
    );
  }
  lines.push(`\nWeeks with calibration: ${args.weeksWithCalibration.map((w) => `W${w}`).join(", ") || "(none)"}`);
  lines.push(`Combined gate-0.40 candidate pool: ${args.candidateCount} plays`);

  lines.push("\n=== Compact summary (sorted best→worst by ROI) ===");
  lines.push(
    pad("Slice", 36) +
      pad("Plays", 7, "R") +
      pad("W-L", 10, "R") +
      pad("Hit", 8, "R") +
      pad("ROI", 9, "R") +
      pad("Units", 9, "R") +
      pad("Edge", 8, "R") +
      pad("ModelP", 9, "R") +
      pad("CalErr", 9, "R"),
  );
  lines.push("-".repeat(104));
  const ranked = [...args.slices].sort((a, b) => b.roiPct - a.roiPct);
  for (const s of ranked) {
    lines.push(
      pad(s.label, 36) +
        pad(s.plays, 7, "R") +
        pad(`${s.wins}-${s.losses}`, 10, "R") +
        pad(`${s.hitRatePct.toFixed(1)}%`, 8, "R") +
        pad(`${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(1)}%`, 9, "R") +
        pad(`${s.unitsProfit >= 0 ? "+" : ""}${s.unitsProfit.toFixed(2)}`, 9, "R") +
        pad(`${s.avgEdgePct.toFixed(1)}%`, 8, "R") +
        pad(`${s.avgModelProbPct.toFixed(1)}%`, 9, "R") +
        pad(
          `${s.calibrationErrorPp >= 0 ? "+" : ""}${s.calibrationErrorPp.toFixed(1)}pp`,
          9,
          "R",
        ),
    );
  }

  lines.push("\n=== Slices ranked best → worst by ROI ===\n");
  for (const s of ranked) {
    lines.push(formatSlice(s));
    lines.push("");
  }

  // Composite ranking section — diagnostic-only. The same
  // gate-0.40 candidate pool ranked by `compositeScore` rather
  // than the edge floor. Helps the operator see whether
  // top-N-by-composite would have outperformed the existing
  // edge ≥ 4% baseline.
  lines.push(
    "=== Composite ranking · DIAGNOSTIC ONLY · no threshold change ===",
  );
  lines.push(
    `compositeScore = calibratedEdge×0.40 + confidence×0.20 + dataQuality×0.20 + (1−volatilityScore)×0.20`,
  );
  lines.push(
    `Composite inputs available: dataQuality=${args.compositeInputs.candidatesWithDataQuality}/${args.compositeInputs.candidatesTotal} candidates, volatility=${args.compositeInputs.candidatesWithVolatility}/${args.compositeInputs.candidatesTotal} candidates. ` +
      `Missing values default to 0.50 (neutral) so old persisted calibrations still rank without crashing.`,
  );
  lines.push("");
  lines.push(
    pad("Slice", 36) +
      pad("Plays", 7, "R") +
      pad("W-L", 10, "R") +
      pad("Hit", 8, "R") +
      pad("ROI", 9, "R") +
      pad("Units", 9, "R") +
      pad("Edge", 8, "R") +
      pad("ModelP", 9, "R") +
      pad("CalErr", 9, "R") +
      pad("AvgComp", 9, "R"),
  );
  lines.push("-".repeat(113));
  for (const s of args.compositeSlices) {
    lines.push(
      pad(s.label, 36) +
        pad(s.plays, 7, "R") +
        pad(`${s.wins}-${s.losses}`, 10, "R") +
        pad(`${s.hitRatePct.toFixed(1)}%`, 8, "R") +
        pad(`${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(1)}%`, 9, "R") +
        pad(`${s.unitsProfit >= 0 ? "+" : ""}${s.unitsProfit.toFixed(2)}`, 9, "R") +
        pad(`${s.avgEdgePct.toFixed(1)}%`, 8, "R") +
        pad(`${s.avgModelProbPct.toFixed(1)}%`, 9, "R") +
        pad(
          `${s.calibrationErrorPp >= 0 ? "+" : ""}${s.calibrationErrorPp.toFixed(1)}pp`,
          9,
          "R",
        ) +
        pad(
          s.avgCompositeScore !== undefined
            ? s.avgCompositeScore.toFixed(3)
            : "—",
          9,
          "R",
        ),
    );
  }
  lines.push("");

  lines.push(args.signalQuality.formatted);
  lines.push("");
  lines.push(args.wrReceptionsAnalysis.formatted);
  lines.push("");

  lines.push("=== Answers ===");
  lines.push(
    `1. Does ROI improve as edge threshold increases? ${args.answers.roiImprovesWithEdge.toUpperCase()}`,
  );
  lines.push(
    `2. Is there ANY slice that produces positive ROI?         ${args.answers.anyPositiveRoi ? "YES" : "NO"}`,
  );
  if (args.answers.bestSliceLabel && args.answers.bestSliceRoiPct !== null) {
    lines.push(
      `   Best slice: ${args.answers.bestSliceLabel} → ROI ${args.answers.bestSliceRoiPct >= 0 ? "+" : ""}${args.answers.bestSliceRoiPct.toFixed(1)}%`,
    );
  }
  lines.push(
    `3. Is the model systematically overestimating?            ${args.answers.systematicOverestimation.toUpperCase()}`,
  );
  lines.push(
    `4. Profitable edge threshold (if any):                    ${
      args.answers.profitableEdgeThresholdPct !== null
        ? `≥ ${args.answers.profitableEdgeThresholdPct}%`
        : "NONE — no edge slice in this set produced positive ROI"
    }`,
  );
  lines.push(
    `5. Does composite ranking beat the edge ≥ 4% baseline?    ${args.answers.compositeBeatsEdgeBaseline.toUpperCase()}`,
  );
  lines.push(
    "\n--- DIAGNOSTIC ONLY · production threshold (0.45) unchanged · read-only · no APIs called · no re-grading. ---",
  );
  return lines.join("\n");
}

/**
 * Build the full report from already-loaded stored snapshots.
 * The caller (admin action or CLI script) supplies the
 * snapshots; this function never reads from disk or DB. Pure.
 */
export function buildEdgeSliceReport(args: {
  snapshots: ReadonlyArray<StoredWeekSnapshot>;
  weeksRequested: number[];
}): EdgeSliceReport {
  const weeksWithCalibration: number[] = [];
  const weeksWithoutCalibration: number[] = [];
  for (const w of args.weeksRequested) {
    const snap = args.snapshots.find((s) => s.week === w);
    if (!snap) {
      weeksWithoutCalibration.push(w);
      continue;
    }
    if (snap.graded?.marketContextCalibration) {
      weeksWithCalibration.push(w);
    } else {
      weeksWithoutCalibration.push(w);
    }
  }
  const usable = args.snapshots.filter(
    (s) =>
      args.weeksRequested.includes(s.week) &&
      s.graded?.marketContextCalibration !== undefined,
  );
  const candidates = pickCandidatesFromSnapshots(usable);
  const slices: EdgeSliceMetrics[] = [
    computeSlice({
      label: "edge ≥ 4%",
      edgeFloor: 0.04,
      candidates: candidates.filter((c) => c.edge >= 0.04),
    }),
    computeSlice({
      label: "edge ≥ 6%",
      edgeFloor: 0.06,
      candidates: candidates.filter((c) => c.edge >= 0.06),
    }),
    computeSlice({
      label: "edge ≥ 8%",
      edgeFloor: 0.08,
      candidates: candidates.filter((c) => c.edge >= 0.08),
    }),
    computeSlice({
      label: "edge ≥ 10%",
      edgeFloor: 0.1,
      candidates: candidates.filter((c) => c.edge >= 0.1),
    }),
    computeSlice({
      label: "elite-only (production-qualified)",
      edgeFloor: null,
      candidates: candidates.filter((c) => c.productionQualified),
    }),
  ];
  const compositeSlices = buildCompositeSlices({ candidates });
  const compositeInputs: EdgeSliceReport["compositeInputs"] = {
    candidatesWithDataQuality: candidates.filter(
      (c) => c.dataQualityScorePresent,
    ).length,
    candidatesWithVolatility: candidates.filter(
      (c) => c.volatilityLevelPresent,
    ).length,
    candidatesTotal: candidates.length,
  };
  const answers = buildAnswers({ slices, compositeSlices });
  const signalQuality = buildSignalQualityReport({ candidates });
  const wrReceptionsAnalysis = buildWrReceptionsAnalysis({ candidates });
  const headline =
    weeksWithCalibration.length === 0
      ? `No calibration data found for the requested weeks. Re-grade ${args.weeksRequested.map((w) => `W${w}`).join(", ")} first to persist marketContextCalibration.`
      : `Edge slices over ${candidates.length} plays from ${weeksWithCalibration.map((w) => `W${w}`).join(", ")}. Best slice: ${answers.bestSliceLabel ?? "(none)"} → ROI ${answers.bestSliceRoiPct !== null ? `${answers.bestSliceRoiPct >= 0 ? "+" : ""}${answers.bestSliceRoiPct.toFixed(1)}%` : "(no graded plays)"}. Composite vs edge ≥ 4%: ${answers.compositeBeatsEdgeBaseline.toUpperCase()}. Systematic overestimation: ${answers.systematicOverestimation.toUpperCase()}.`;
  const formatted = formatReport({
    weeksRequested: args.weeksRequested,
    weeksWithCalibration,
    weeksWithoutCalibration,
    candidateCount: candidates.length,
    slices,
    compositeSlices,
    compositeInputs,
    answers,
    signalQuality,
    wrReceptionsAnalysis,
  });
  return {
    diagnosticOnly: true,
    generatedAt: new Date().toISOString(),
    productionGate: 0.45,
    replayGate: 0.4,
    weeksRequested: args.weeksRequested,
    weeksWithCalibration,
    weeksWithoutCalibration,
    candidateCount: candidates.length,
    slices,
    compositeSlices,
    compositeInputs,
    answers,
    signalQuality,
    wrReceptionsAnalysis,
    headline,
    formatted,
  };
}

// Helpful re-export so the CLI script can keep its local types.
export type { MarketContextCalibrationReplay, CalibrationCandidate };
