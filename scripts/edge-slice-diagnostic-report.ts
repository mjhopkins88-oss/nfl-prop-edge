/**
 * Edge-quality diagnostic slice report.
 *
 * Reads the stored + graded Week 1 and Week 2 backtest rows
 * from Postgres (file fallback for the local sandbox), pulls
 * the gate-0.40 calibration candidate set from each, and
 * computes five edge-filtered slices side by side:
 *
 *   1. edge ≥ 4%
 *   2. edge ≥ 6%
 *   3. edge ≥ 8%
 *   4. edge ≥ 10%
 *   5. elite-only (production-qualified only)
 *
 * For each slice the script prints plays, W/L, hit rate, ROI,
 * units, avg model edge, avg implied probability (market), avg
 * model probability, and the calibration error
 * (model_prob - actual_hit_rate). Slices are ranked best→worst
 * by ROI.
 *
 * Pure read-only. No paid API calls. No re-grading. No
 * threshold or scorecard changes. Diagnostic-only.
 *
 * Usage:
 *   npx tsx scripts/edge-slice-diagnostic-report.ts
 *   npx tsx scripts/edge-slice-diagnostic-report.ts --weeks 1,2,3
 */

import {
  loadAllStoredMonitorSnapshots,
  type StoredWeekSnapshot,
} from "../src/lib/backtest/week-1-monitor-summary";

interface CliArgs {
  season: number;
  weeks: number[];
}

function parseArgs(argv: string[]): CliArgs {
  let season = 2025;
  let weeks = [1, 2];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--season" && argv[i + 1]) {
      season = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--weeks" && argv[i + 1]) {
      weeks = argv[i + 1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      i += 1;
    }
  }
  return { season, weeks };
}

interface Candidate {
  week: number;
  candidateId: string;
  playerName: string;
  propType: string;
  edge: number; // 0..1
  modelProbability: number; // 0..1
  marketProbability: number; // 0..1 (no-vig)
  outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  profitPerUnit: number;
  productionQualified: boolean;
}

interface SliceMetrics {
  label: string;
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

function pickCandidates(snapshots: StoredWeekSnapshot[]): Candidate[] {
  const out: Candidate[] = [];
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

function computeSlice(label: string, candidates: Candidate[]): SliceMetrics {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noResult = 0;
  let unitsProfit = 0;
  let sumEdge = 0;
  let sumModelProb = 0;
  let sumMarketProb = 0;
  for (const c of candidates) {
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
  const n = candidates.length;
  const hitRatePct = decisive > 0 ? (wins / decisive) * 100 : 0;
  const roiPct = graded > 0 ? (unitsProfit / graded) * 100 : 0;
  const avgEdgePct = n > 0 ? (sumEdge / n) * 100 : 0;
  const avgImpliedProbPct = n > 0 ? (sumMarketProb / n) * 100 : 0;
  const avgModelProbPct = n > 0 ? (sumModelProb / n) * 100 : 0;
  return {
    label,
    plays: n,
    wins,
    losses,
    pushes,
    noResult,
    hitRatePct,
    roiPct,
    unitsProfit,
    avgEdgePct,
    avgImpliedProbPct,
    avgModelProbPct,
    // Calibration error in percentage points = model probability
    // minus actual hit rate. Positive = model OVERestimates.
    calibrationErrorPp: avgModelProbPct - hitRatePct,
  };
}

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function printSlice(s: SliceMetrics): void {
  console.log(`Slice: ${s.label}`);
  console.log(`  Plays:            ${s.plays}`);
  console.log(`  Record (W-L):     ${s.wins}-${s.losses}` + (s.pushes > 0 ? ` (${s.pushes}P)` : "") + (s.noResult > 0 ? ` (${s.noResult} NO_DATA)` : ""));
  console.log(`  Hit Rate:         ${s.hitRatePct.toFixed(1)}%`);
  console.log(`  ROI:              ${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(1)}%`);
  console.log(`  Units:            ${s.unitsProfit >= 0 ? "+" : ""}${s.unitsProfit.toFixed(2)}`);
  console.log(`  Avg Edge:         ${s.avgEdgePct.toFixed(2)}%`);
  console.log(`  Avg Implied Prob: ${s.avgImpliedProbPct.toFixed(1)}%`);
  console.log(`  Avg Model Prob:   ${s.avgModelProbPct.toFixed(1)}%`);
  console.log(`  Actual Hit:       ${s.hitRatePct.toFixed(1)}%`);
  console.log(`  Calibration Err:  ${s.calibrationErrorPp >= 0 ? "+" : ""}${s.calibrationErrorPp.toFixed(1)}pp ${s.calibrationErrorPp > 0 ? "(model OVERestimates)" : s.calibrationErrorPp < 0 ? "(model UNDERestimates)" : "(calibrated)"}`);
  console.log("");
}

function printRanked(slices: SliceMetrics[]): void {
  console.log("=== Slices ranked best → worst by ROI ===\n");
  const sorted = [...slices].sort((a, b) => b.roiPct - a.roiPct);
  for (const s of sorted) printSlice(s);
}

function printCompact(slices: SliceMetrics[]): void {
  console.log("=== Compact summary ===");
  console.log(
    pad("Slice", 28) +
      pad("Plays", 7, "R") +
      pad("W-L", 10, "R") +
      pad("Hit", 8, "R") +
      pad("ROI", 9, "R") +
      pad("Units", 9, "R") +
      pad("Edge", 8, "R") +
      pad("ModelP", 9, "R") +
      pad("CalErr", 9, "R"),
  );
  console.log("-".repeat(96));
  const sorted = [...slices].sort((a, b) => b.roiPct - a.roiPct);
  for (const s of sorted) {
    console.log(
      pad(s.label, 28) +
        pad(s.plays, 7, "R") +
        pad(`${s.wins}-${s.losses}`, 10, "R") +
        pad(`${s.hitRatePct.toFixed(1)}%`, 8, "R") +
        pad(`${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(1)}%`, 9, "R") +
        pad(`${s.unitsProfit >= 0 ? "+" : ""}${s.unitsProfit.toFixed(2)}`, 9, "R") +
        pad(`${s.avgEdgePct.toFixed(1)}%`, 8, "R") +
        pad(`${s.avgModelProbPct.toFixed(1)}%`, 9, "R") +
        pad(`${s.calibrationErrorPp >= 0 ? "+" : ""}${s.calibrationErrorPp.toFixed(1)}pp`, 9, "R"),
    );
  }
}

interface Answers {
  roiImprovesWithEdge: "yes" | "no" | "mixed" | "insufficient-data";
  anyPositiveRoi: boolean;
  bestSlice: SliceMetrics | null;
  systematicOverestimation:
    | "yes"
    | "no"
    | "mixed"
    | "insufficient-data";
  profitableEdgeThreshold: number | null;
}

function buildAnswers(slices: SliceMetrics[]): Answers {
  const edgeOrdered = slices.filter((s) => /edge ≥/.test(s.label));
  edgeOrdered.sort((a, b) => {
    const av = Number(a.label.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? 0);
    const bv = Number(b.label.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? 0);
    return av - bv;
  });
  const positives = slices.filter((s) => s.roiPct > 0);
  const bestSlice =
    slices.length === 0
      ? null
      : [...slices].sort((a, b) => b.roiPct - a.roiPct)[0];
  // ROI direction across edge thresholds
  let roiImprovesWithEdge: Answers["roiImprovesWithEdge"] = "insufficient-data";
  if (edgeOrdered.length >= 2) {
    let up = 0;
    let down = 0;
    for (let i = 1; i < edgeOrdered.length; i++) {
      const a = edgeOrdered[i - 1];
      const b = edgeOrdered[i];
      if (a.plays === 0 || b.plays === 0) continue;
      if (b.roiPct > a.roiPct) up += 1;
      else if (b.roiPct < a.roiPct) down += 1;
    }
    if (up > 0 && down === 0) roiImprovesWithEdge = "yes";
    else if (down > 0 && up === 0) roiImprovesWithEdge = "no";
    else if (up > 0 || down > 0) roiImprovesWithEdge = "mixed";
  }
  // Systematic overestimation = avg calibration error > 0 across
  // every populated slice. We average over slices with plays>0.
  const populated = slices.filter((s) => s.plays > 0);
  let systematicOverestimation: Answers["systematicOverestimation"] =
    "insufficient-data";
  if (populated.length > 0) {
    const allOver = populated.every((s) => s.calibrationErrorPp > 0);
    const allUnder = populated.every((s) => s.calibrationErrorPp < 0);
    if (allOver) systematicOverestimation = "yes";
    else if (allUnder) systematicOverestimation = "no";
    else systematicOverestimation = "mixed";
  }
  // First edge threshold where ROI > 0.
  let profitableEdgeThreshold: number | null = null;
  for (const s of edgeOrdered) {
    if (s.plays === 0) continue;
    if (s.roiPct > 0) {
      const v = Number(s.label.match(/(\d+(?:\.\d+)?)%/)?.[1] ?? 0);
      profitableEdgeThreshold = v;
      break;
    }
  }
  return {
    roiImprovesWithEdge,
    anyPositiveRoi: positives.length > 0,
    bestSlice,
    systematicOverestimation,
    profitableEdgeThreshold,
  };
}

function printAnswers(answers: Answers): void {
  console.log("\n=== Answers ===");
  console.log(`1. Does ROI improve as edge threshold increases? ${answers.roiImprovesWithEdge.toUpperCase()}`);
  console.log(`2. Is there ANY slice that produces positive ROI?         ${answers.anyPositiveRoi ? "YES" : "NO"}`);
  if (answers.bestSlice) {
    console.log(
      `   Best slice: ${answers.bestSlice.label} → ROI ${answers.bestSlice.roiPct >= 0 ? "+" : ""}${answers.bestSlice.roiPct.toFixed(1)}% (${answers.bestSlice.plays} plays)`,
    );
  }
  console.log(`3. Is the model systematically overestimating?            ${answers.systematicOverestimation.toUpperCase()}`);
  console.log(
    `4. Profitable edge threshold (if any):                    ${
      answers.profitableEdgeThreshold !== null
        ? `≥ ${answers.profitableEdgeThreshold}%`
        : "NONE — no edge slice in this set produced positive ROI"
    }`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log("Edge-quality diagnostic slice report");
  console.log("=====================================");
  console.log(
    `Season ${args.season} · Weeks ${args.weeks.join(", ")} · diagnostic gate = 0.40 · analysis only`,
  );

  const snapshots = await loadAllStoredMonitorSnapshots({
    season: args.season,
    weeks: args.weeks,
  });
  if (snapshots.length === 0) {
    console.log("\nNo stored snapshots found for the requested weeks.");
    console.log(
      "Locally: no DB configured and no per-week file mirrors present.",
    );
    console.log(
      "On Railway: run /admin/ingestion → Grade Stored Backtest for the target week first.",
    );
    return;
  }
  const usable = snapshots.filter(
    (s) => s.graded?.marketContextCalibration !== undefined,
  );
  if (usable.length === 0) {
    console.log(
      `\n${snapshots.length} snapshot(s) loaded but NONE carry a marketContextCalibration payload.`,
    );
    console.log(
      "Re-run /admin/ingestion → Grade Stored Backtest for these weeks. The calibration replay is persisted as part of that action.",
    );
    return;
  }
  for (const s of usable) {
    const cal = s.graded?.marketContextCalibration;
    if (!cal) continue;
    console.log(
      `\nWeek ${s.week}: gate-0.40 candidates loaded = ${cal.gate040.candidates.length} (production-qualified = ${cal.production.qualifiedCount})`,
    );
  }
  if (snapshots.length > usable.length) {
    console.log(
      `\nSkipped ${snapshots.length - usable.length} week(s) with no calibration payload: ${snapshots
        .filter((s) => s.graded?.marketContextCalibration === undefined)
        .map((s) => `W${s.week}`)
        .join(", ")}`,
    );
  }

  const candidates = pickCandidates(usable);
  console.log(`\nCombined gate-0.40 candidate pool: ${candidates.length} plays`);

  const slices: SliceMetrics[] = [
    computeSlice(
      "edge ≥ 4%",
      candidates.filter((c) => c.edge >= 0.04),
    ),
    computeSlice(
      "edge ≥ 6%",
      candidates.filter((c) => c.edge >= 0.06),
    ),
    computeSlice(
      "edge ≥ 8%",
      candidates.filter((c) => c.edge >= 0.08),
    ),
    computeSlice(
      "edge ≥ 10%",
      candidates.filter((c) => c.edge >= 0.1),
    ),
    computeSlice(
      "elite-only (production-qualified)",
      candidates.filter((c) => c.productionQualified),
    ),
  ];

  console.log("");
  printCompact(slices);
  console.log("");
  printRanked(slices);
  printAnswers(buildAnswers(slices));
  console.log(
    "\n--- DIAGNOSTIC ONLY · production threshold (0.45) unchanged · no APIs called · no re-grading. ---",
  );
}

void main();
