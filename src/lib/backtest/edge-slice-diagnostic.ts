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
import type { StoredWeekSnapshot } from "./week-1-monitor-summary";

export interface EdgeSliceCandidate {
  week: number;
  candidateId: string;
  playerName: string;
  propType: string;
  edge: number;
  modelProbability: number;
  marketProbability: number;
  outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  profitPerUnit: number;
  productionQualified: boolean;
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
  };
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
      out.push({
        week: snap.week,
        candidateId: c.candidateId,
        playerName: c.playerName,
        propType: c.propType,
        edge: c.edge,
        modelProbability: c.modelProbability,
        marketProbability: c.marketProbability,
        outcome: c.outcome,
        profitPerUnit: c.profitPerUnit,
        productionQualified: c.productionQualified,
      });
    }
  }
  return out;
}

function computeSlice(args: {
  label: string;
  edgeFloor: number | null;
  candidates: EdgeSliceCandidate[];
}): EdgeSliceMetrics {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noResult = 0;
  let unitsProfit = 0;
  let sumEdge = 0;
  let sumModelProb = 0;
  let sumMarketProb = 0;
  for (const c of args.candidates) {
    if (c.outcome === "WIN") wins += 1;
    else if (c.outcome === "LOSS") losses += 1;
    else if (c.outcome === "PUSH") pushes += 1;
    else noResult += 1;
    unitsProfit += c.profitPerUnit;
    sumEdge += c.edge;
    sumModelProb += c.modelProbability;
    sumMarketProb += c.marketProbability;
  }
  const decisive = wins + losses;
  const graded = wins + losses + pushes;
  const n = args.candidates.length;
  const hitRatePct = decisive > 0 ? (wins / decisive) * 100 : 0;
  const avgModelProbPct = n > 0 ? (sumModelProb / n) * 100 : 0;
  return {
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

function buildAnswers(slices: ReadonlyArray<EdgeSliceMetrics>): EdgeSliceReport["answers"] {
  const edgeOrdered = slices
    .filter((s) => s.edgeFloor !== null)
    .sort((a, b) => (a.edgeFloor ?? 0) - (b.edgeFloor ?? 0));
  const populated = slices.filter((s) => s.plays > 0);
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
  return {
    roiImprovesWithEdge,
    anyPositiveRoi: populated.some((s) => s.roiPct > 0),
    bestSliceLabel: best ? best.label : null,
    bestSliceRoiPct: best ? best.roiPct : null,
    systematicOverestimation,
    profitableEdgeThresholdPct,
  };
}

function formatReport(args: {
  weeksRequested: number[];
  weeksWithCalibration: number[];
  weeksWithoutCalibration: number[];
  candidateCount: number;
  slices: EdgeSliceMetrics[];
  answers: EdgeSliceReport["answers"];
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
  const answers = buildAnswers(slices);
  const headline =
    weeksWithCalibration.length === 0
      ? `No calibration data found for the requested weeks. Re-grade ${args.weeksRequested.map((w) => `W${w}`).join(", ")} first to persist marketContextCalibration.`
      : `Edge slices over ${candidates.length} plays from ${weeksWithCalibration.map((w) => `W${w}`).join(", ")}. Best slice: ${answers.bestSliceLabel ?? "(none)"} → ROI ${answers.bestSliceRoiPct !== null ? `${answers.bestSliceRoiPct >= 0 ? "+" : ""}${answers.bestSliceRoiPct.toFixed(1)}%` : "(no graded plays)"}. Systematic overestimation: ${answers.systematicOverestimation.toUpperCase()}.`;
  const formatted = formatReport({
    weeksRequested: args.weeksRequested,
    weeksWithCalibration,
    weeksWithoutCalibration,
    candidateCount: candidates.length,
    slices,
    answers,
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
    answers,
    headline,
    formatted,
  };
}

// Helpful re-export so the CLI script can keep its local types.
export type { MarketContextCalibrationReplay, CalibrationCandidate };
