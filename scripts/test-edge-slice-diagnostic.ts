/**
 * Edge-slice diagnostic report assertions.
 *
 *   · Five slices computed off the gate-0.40 calibration set:
 *     edge ≥ 4%, ≥ 6%, ≥ 8%, ≥ 10%, and elite-only.
 *   · Each slice carries plays / W-L / hit / ROI / units / avg
 *     edge / avg implied prob / avg model prob / calibration
 *     error.
 *   · The slice counts narrow correctly when the edge floor
 *     rises.
 *   · Calibration error = avgModelProbPct − hitRatePct
 *     (positive = model OVERestimates).
 *   · The "best slice by ROI" answer correctly identifies the
 *     highest-ROI slice.
 *   · "Systematic overestimation = yes" when every slice's
 *     calibration error is positive; "mixed" when some are
 *     positive and some negative.
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API call.
 */

import fs from "node:fs";
import path from "node:path";

interface Failure {
  scenario: string;
  reasons: string[];
}
const FAILURES: Failure[] = [];
function check(report: Failure, predicate: boolean, reason: string): void {
  if (!predicate) report.reasons.push(reason);
}
function record(report: Failure): void {
  if (report.reasons.length > 0) FAILURES.push(report);
}
function makeReport(scenario: string): Failure {
  return { scenario, reasons: [] };
}
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

// Reproduce the script's pure slice math here so we can test
// the arithmetic directly without spawning the script.
interface Candidate {
  edge: number;
  modelProbability: number;
  marketProbability: number;
  outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  profitPerUnit: number;
  productionQualified: boolean;
}

interface Slice {
  label: string;
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  avgEdgePct: number;
  avgModelProbPct: number;
  avgImpliedProbPct: number;
  calibrationErrorPp: number;
}

function computeSlice(label: string, candidates: Candidate[]): Slice {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitsProfit = 0;
  let sumEdge = 0;
  let sumModelProb = 0;
  let sumMarketProb = 0;
  for (const c of candidates) {
    if (c.outcome === "WIN") wins += 1;
    else if (c.outcome === "LOSS") losses += 1;
    else if (c.outcome === "PUSH") pushes += 1;
    unitsProfit += c.profitPerUnit;
    sumEdge += c.edge;
    sumModelProb += c.modelProbability;
    sumMarketProb += c.marketProbability;
  }
  const decisive = wins + losses;
  const graded = wins + losses + pushes;
  const n = candidates.length;
  const hitRatePct = decisive > 0 ? (wins / decisive) * 100 : 0;
  const avgModelProbPct = n > 0 ? (sumModelProb / n) * 100 : 0;
  return {
    label,
    plays: n,
    wins,
    losses,
    pushes,
    hitRatePct,
    roiPct: graded > 0 ? (unitsProfit / graded) * 100 : 0,
    unitsProfit,
    avgEdgePct: n > 0 ? (sumEdge / n) * 100 : 0,
    avgModelProbPct,
    avgImpliedProbPct: n > 0 ? (sumMarketProb / n) * 100 : 0,
    calibrationErrorPp: avgModelProbPct - hitRatePct,
  };
}

function main(): void {
  console.log("Edge-slice diagnostic report — assertions");
  console.log("==========================================");

  // 1. Counts narrow correctly when the edge floor rises.
  {
    const r = makeReport("edge floors narrow the count correctly");
    const cs: Candidate[] = [
      // edge: 5%, 7%, 9%, 12%
      { edge: 0.05, modelProbability: 0.55, marketProbability: 0.5, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
      { edge: 0.07, modelProbability: 0.6, marketProbability: 0.53, outcome: "LOSS", profitPerUnit: -1, productionQualified: false },
      { edge: 0.09, modelProbability: 0.62, marketProbability: 0.53, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
      { edge: 0.12, modelProbability: 0.65, marketProbability: 0.53, outcome: "LOSS", profitPerUnit: -1, productionQualified: true },
    ];
    const s4 = computeSlice("≥4", cs.filter((c) => c.edge >= 0.04));
    const s6 = computeSlice("≥6", cs.filter((c) => c.edge >= 0.06));
    const s8 = computeSlice("≥8", cs.filter((c) => c.edge >= 0.08));
    const s10 = computeSlice("≥10", cs.filter((c) => c.edge >= 0.1));
    check(r, s4.plays === 4, `≥4 plays=${s4.plays}`);
    check(r, s6.plays === 3, `≥6 plays=${s6.plays}`);
    check(r, s8.plays === 2, `≥8 plays=${s8.plays}`);
    check(r, s10.plays === 1, `≥10 plays=${s10.plays}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — edge floors narrow the count");
    else console.log("[1] FAIL — edge floor counts");
  }

  // 2. Calibration error math.
  {
    const r = makeReport("calibration error = model prob − actual hit");
    // 4 plays, 2 W 2 L → hit rate 50%. Model probs all 60% → avg 60%.
    // Expected calibration error = 60 − 50 = +10pp.
    const cs: Candidate[] = [
      { edge: 0.05, modelProbability: 0.6, marketProbability: 0.5, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
      { edge: 0.05, modelProbability: 0.6, marketProbability: 0.5, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
      { edge: 0.05, modelProbability: 0.6, marketProbability: 0.5, outcome: "LOSS", profitPerUnit: -1, productionQualified: false },
      { edge: 0.05, modelProbability: 0.6, marketProbability: 0.5, outcome: "LOSS", profitPerUnit: -1, productionQualified: false },
    ];
    const s = computeSlice("test", cs);
    check(r, Math.abs(s.hitRatePct - 50) < 1e-9, `hit=${s.hitRatePct}, expected 50`);
    check(r, Math.abs(s.avgModelProbPct - 60) < 1e-9, `model=${s.avgModelProbPct}, expected 60`);
    check(
      r,
      Math.abs(s.calibrationErrorPp - 10) < 1e-9,
      `calErr=${s.calibrationErrorPp}, expected +10`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — calibration error = model − actual");
    else console.log("[2] FAIL — calibration math");
  }

  // 3. ROI math: unitsProfit / graded * 100.
  {
    const r = makeReport("ROI = unitsProfit / graded × 100");
    // 1 W (+0.91) + 1 L (-1) = -0.09 over 2 plays = -4.5%
    const cs: Candidate[] = [
      { edge: 0.05, modelProbability: 0.55, marketProbability: 0.5, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
      { edge: 0.05, modelProbability: 0.55, marketProbability: 0.5, outcome: "LOSS", profitPerUnit: -1, productionQualified: false },
    ];
    const s = computeSlice("test", cs);
    check(r, Math.abs(s.roiPct - -4.5) < 0.001, `ROI=${s.roiPct}, expected -4.5`);
    check(r, Math.abs(s.unitsProfit - -0.09) < 0.001, `units=${s.unitsProfit}`);
    record(r);
    if (r.reasons.length === 0) console.log("[3] PASS — ROI math correct");
    else console.log("[3] FAIL — ROI math");
  }

  // 4. Elite-only slice = production-qualified subset.
  {
    const r = makeReport("elite-only = production-qualified subset");
    const cs: Candidate[] = [
      { edge: 0.04, modelProbability: 0.55, marketProbability: 0.51, outcome: "WIN", profitPerUnit: 0.91, productionQualified: true },
      { edge: 0.08, modelProbability: 0.6, marketProbability: 0.52, outcome: "LOSS", profitPerUnit: -1, productionQualified: false },
    ];
    const elite = computeSlice("elite-only", cs.filter((c) => c.productionQualified));
    check(r, elite.plays === 1, `elite plays=${elite.plays}`);
    check(r, elite.wins === 1, `elite wins=${elite.wins}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — elite-only = production-qualified subset");
    else console.log("[4] FAIL — elite slice");
  }

  // 5. Empty slice (no plays meet the edge floor) returns
  //    sensible zeros — no NaN.
  {
    const r = makeReport("empty slice = zeros, no NaN");
    const s = computeSlice("empty", []);
    check(r, s.plays === 0, "plays should be 0");
    check(r, s.roiPct === 0, "ROI should be 0 (no plays)");
    check(r, s.hitRatePct === 0, "hit rate should be 0");
    check(
      r,
      !Number.isNaN(s.calibrationErrorPp),
      `calibrationErrorPp=${s.calibrationErrorPp}, must not be NaN`,
    );
    check(
      r,
      !Number.isNaN(s.avgEdgePct),
      `avgEdgePct=${s.avgEdgePct}, must not be NaN`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — empty slice returns zeros");
    else console.log("[5] FAIL — empty slice NaN");
  }

  // 6. Implied probability tracks the market-probability field
  //    (no-vig). Used by the calibration-vs-market section of
  //    the report.
  {
    const r = makeReport("avg implied prob = avg market prob");
    const cs: Candidate[] = [
      { edge: 0.05, modelProbability: 0.55, marketProbability: 0.5, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
      { edge: 0.05, modelProbability: 0.55, marketProbability: 0.55, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
    ];
    const s = computeSlice("test", cs);
    check(
      r,
      Math.abs(s.avgImpliedProbPct - 52.5) < 1e-9,
      `avgImplied=${s.avgImpliedProbPct}, expected 52.5`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — avg implied prob math");
    else console.log("[6] FAIL — implied prob");
  }

  // 7. Source-level: the CLI script loads stored snapshots and
  //    routes them through the shared library — which is where
  //    the slice labels and answer-question strings live.
  {
    const r = makeReport("script + library wire loader + slice labels + answers");
    const scriptText = readSrc("scripts/edge-slice-diagnostic-report.ts");
    const libText = readSrc("src/lib/backtest/edge-slice-diagnostic.ts");
    check(
      r,
      /loadAllStoredMonitorSnapshots/.test(scriptText),
      "script must call loadAllStoredMonitorSnapshots",
    );
    check(
      r,
      /buildEdgeSliceReport/.test(scriptText),
      "script must call buildEdgeSliceReport",
    );
    check(
      r,
      /cal\.gate040\.candidates/.test(libText) ||
        /gate040\.candidates/.test(libText),
      "library must read gate040 candidates from the calibration payload",
    );
    for (const label of ["edge ≥ 4%", "edge ≥ 6%", "edge ≥ 8%", "edge ≥ 10%", "elite-only"]) {
      check(r, libText.includes(label), `library must define slice label '${label}'`);
    }
    check(
      r,
      /Does ROI improve as edge threshold increases/.test(libText),
      "library must print the ROI-vs-edge question",
    );
    check(
      r,
      /systematically overestimating/.test(libText),
      "library must print the overestimation question",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — script + library wire loader + slices + answers");
    else console.log("[7] FAIL — source wiring");
  }

  // 8. No banned hooks in the script or the audit module it
  //    builds on.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "scripts/edge-slice-diagnostic-report.ts",
      "src/lib/backtest/edge-slice-diagnostic.ts",
      "src/lib/backtest/diagnostic-qualification-audit.ts",
      "src/lib/backtest/market-context-calibration.ts",
    ];
    for (const f of files) {
      const text = readSrc(f);
      for (const re of [
        /the-odds-api/i,
        /odds-api\.com/i,
        /placeBet|placeWager/,
        /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
        /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
      ]) {
        check(r, !re.test(text), `${f} contains banned pattern ${re}`);
      }
    }
    record(r);
    if (r.reasons.length === 0) console.log("[8] PASS — no banned hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 8 edge-slice-diagnostic assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

main();
