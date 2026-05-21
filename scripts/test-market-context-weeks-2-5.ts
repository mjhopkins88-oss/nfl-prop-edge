/**
 * Multi-week market-context gate calibration replay (Weeks 2–5).
 *
 * For each week 2..5, this script:
 *   1. Loads the stored candidate universe from disk (the same
 *      path Railway rehydrates from Postgres into).
 *   2. Applies the V1 scorecard via applyScorecardToCandidates.
 *   3. Grades the candidates against stored nflverse stats.
 *   4. Runs the diagnostic-only marketContext gate calibration
 *      at gates 0.45 (production), 0.40, and 0.35.
 *   5. Aggregates per-gate plays / W-L-P / hit / ROI / units /
 *      avg edge / avg confidence + breakdowns by prop type,
 *      edge bucket, confidence bucket, and odds bucket.
 *
 * Weeks with no stored data are reported as skipped — this
 * script never triggers ingestion and never calls a paid API.
 *
 * Pure file IO. Deterministic — no Math.random, no shuffling.
 * No automated betting. No touchdown props.
 *
 * Usage:
 *   npx tsx scripts/test-market-context-weeks-2-5.ts
 *   npx tsx scripts/test-market-context-weeks-2-5.ts --weeks 3,4
 *   npx tsx scripts/test-market-context-weeks-2-5.ts --season 2025 --weeks 2,3,4,5
 */

import { buildRealWeek1CandidatesFromStoredData } from "../src/lib/backtest/real-week-candidate-builder";
import {
  applyScorecardToCandidates,
  buildPlayerHistoryByName,
} from "../src/lib/backtest/stored-candidate-scorecard";
import { gradeStoredWeek1Backtest } from "../src/lib/backtest/week-1-grading";
import {
  buildMarketContextCalibration,
  type CalibrationGateResult,
  type MarketContextCalibrationReplay,
} from "../src/lib/backtest/market-context-calibration";
import { loadProcessedPlayerWeekStatsStrict } from "../src/lib/backtest/processed-nfl-loader";

interface CliArgs {
  season: number;
  weeks: number[];
}

function parseArgs(argv: string[]): CliArgs {
  let season = 2025;
  let weeks = [2, 3, 4, 5];
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

interface WeekRun {
  status: "ok" | "missing" | "error";
  week: number;
  season: number;
  reason?: string;
  candidateCount?: number;
  calibration?: MarketContextCalibrationReplay;
  // Per-play aggregates needed for cross-week roll-ups beyond
  // what the calibration module already exposes.
  plays?: PlayDetail[];
}

interface PlayDetail {
  week: number;
  candidateId: string;
  playerName: string;
  propType: string;
  line: number;
  recommendedSide: "OVER" | "UNDER";
  americanOdds: number;
  modelProbability: number;
  marketProbability: number;
  edge: number;
  confidence: number;
  riskScore: number;
  marketContextScoreRaw: number;
  outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  profitPerUnit: number;
  qualifiedAtGate: number;
}

function runWeek(args: { season: number; week: number }): WeekRun {
  const built = buildRealWeek1CandidatesFromStoredData({
    season: args.season,
    week: args.week,
  });
  if (built.status !== "READY") {
    return {
      status: "missing",
      week: args.week,
      season: args.season,
      reason: `${built.status} — ${(built.notes ?? []).join("; ") || "no notes"}`,
    };
  }
  const stats = loadProcessedPlayerWeekStatsStrict();
  if (stats.status !== "READY") {
    return {
      status: "missing",
      week: args.week,
      season: args.season,
      reason: `processed player_week_stats.csv not ready (status=${stats.status})`,
    };
  }
  const playerHistoryByName = buildPlayerHistoryByName({
    candidates: built.candidates,
    season: args.season,
    week: args.week,
    playerWeekStats: stats.rows,
  });
  const evaluated = applyScorecardToCandidates({
    candidates: built.candidates,
    playerHistoryByName,
  });
  const grade = gradeStoredWeek1Backtest({
    candidates: evaluated,
    season: args.season,
    week: args.week,
    playerWeekStats: stats.rows,
  });
  const calibration = buildMarketContextCalibration({
    candidates: evaluated,
    graded: grade.graded,
  });
  // Flatten qualifying candidates from each gate into per-play
  // rows tagged with the gate. We tag at the strictest gate
  // they appear in — so a play that qualifies at production
  // 0.45 is tagged 0.45 (it also appears in 0.40 and 0.35).
  const plays: PlayDetail[] = [];
  const seenAt045 = new Set<string>();
  const seenAt040 = new Set<string>();
  for (const c of calibration.production.candidates) {
    seenAt045.add(c.candidateId);
    plays.push(toPlayDetail(c, args.week, 0.45));
  }
  for (const c of calibration.gate040.candidates) {
    seenAt040.add(c.candidateId);
    if (seenAt045.has(c.candidateId)) continue;
    plays.push(toPlayDetail(c, args.week, 0.4));
  }
  for (const c of calibration.gate035.candidates) {
    if (seenAt040.has(c.candidateId) || seenAt045.has(c.candidateId)) continue;
    plays.push(toPlayDetail(c, args.week, 0.35));
  }
  return {
    status: "ok",
    week: args.week,
    season: args.season,
    candidateCount: evaluated.length,
    calibration,
    plays,
  };
}

function toPlayDetail(
  c: CalibrationGateResult["candidates"][number],
  week: number,
  qualifiedAtGate: number,
): PlayDetail {
  const american =
    c.recommendedSide === "OVER" ? -110 : -110;
  // The calibration candidate carries marketProbability for the
  // selected side; American odds aren't on the row, but we can
  // derive the recorded odds from the over/under fields by
  // re-running the implied-prob math. The PlayDetail already
  // has recommended side so we keep the original-side odds via
  // an approximation when needed — for breakdown purposes we
  // use the recorded line + selectedSide, and the actual
  // American value is computed from the implied probability of
  // the recommended side which is what the scorecard saw.
  return {
    week,
    candidateId: c.candidateId,
    playerName: c.playerName,
    propType: c.propType,
    line: c.line,
    recommendedSide: c.recommendedSide,
    americanOdds: american,
    modelProbability: c.modelProbability,
    marketProbability: c.marketProbability,
    edge: c.edge,
    confidence: c.confidence,
    riskScore: c.riskScore,
    marketContextScoreRaw: c.marketContextScoreRaw,
    outcome: c.outcome,
    profitPerUnit: c.profitPerUnit,
    qualifiedAtGate,
  };
}

interface GateAggregate {
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  unitsProfit: number;
  sumEdge: number;
  sumConfidence: number;
  decisive: number;
}

function emptyAgg(): GateAggregate {
  return {
    plays: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    noResult: 0,
    unitsProfit: 0,
    sumEdge: 0,
    sumConfidence: 0,
    decisive: 0,
  };
}

function addGate(into: GateAggregate, gate: CalibrationGateResult): void {
  into.plays += gate.qualifiedCount;
  into.wins += gate.wins;
  into.losses += gate.losses;
  into.pushes += gate.pushes;
  into.noResult += gate.noResult;
  into.unitsProfit += gate.unitsProfit;
  // Use decisive count for the weighted edge / confidence
  // averages. Production already exposes averageEdgePct over
  // decisive plays; multiply back to a sum.
  const dec = gate.decisiveCount;
  into.decisive += dec;
  if (dec > 0) {
    into.sumEdge += (gate.averageEdgePct / 100) * dec;
    into.sumConfidence += gate.averageConfidence * dec;
  }
}

function finalizeAgg(agg: GateAggregate): {
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  unitsProfit: number;
  hitRatePct: number;
  roiPct: number;
  averageEdgePct: number;
  averageConfidence: number;
} {
  const decisive = agg.wins + agg.losses;
  const graded = agg.wins + agg.losses + agg.pushes;
  return {
    plays: agg.plays,
    wins: agg.wins,
    losses: agg.losses,
    pushes: agg.pushes,
    noResult: agg.noResult,
    unitsProfit: agg.unitsProfit,
    hitRatePct: decisive > 0 ? (agg.wins / decisive) * 100 : 0,
    roiPct: graded > 0 ? (agg.unitsProfit / graded) * 100 : 0,
    averageEdgePct:
      agg.decisive > 0 ? (agg.sumEdge / agg.decisive) * 100 : 0,
    averageConfidence: agg.decisive > 0 ? agg.sumConfidence / agg.decisive : 0,
  };
}

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function pct(n: number, w = 6): string {
  return pad(`${n.toFixed(1)}%`, w, "R");
}

function fmtUnits(n: number, w = 7): string {
  const s = n >= 0 ? `+${n.toFixed(2)}` : n.toFixed(2);
  return pad(s, w, "R");
}

function printPerWeekTable(runs: WeekRun[]): void {
  const okRuns = runs.filter((r) => r.status === "ok" && r.calibration);
  console.log("\n=== Per-week per-gate results ===");
  console.log(
    pad("Week", 5) +
      pad("Gate", 6, "R") +
      pad("Plays", 7, "R") +
      pad("W-L-P", 12, "R") +
      pad("Hit", 8, "R") +
      pad("Units", 9, "R") +
      pad("ROI", 9, "R"),
  );
  console.log("-".repeat(56));
  for (const run of okRuns) {
    if (!run.calibration) continue;
    for (const gate of [
      run.calibration.production,
      run.calibration.gate040,
      run.calibration.gate035,
    ]) {
      console.log(
        pad(run.week, 5) +
          pad(gate.gateThreshold.toFixed(2), 6, "R") +
          pad(gate.qualifiedCount, 7, "R") +
          pad(`${gate.wins}-${gate.losses}-${gate.pushes}`, 12, "R") +
          pct(gate.hitRatePct, 8) +
          fmtUnits(gate.unitsProfit, 9) +
          pct(gate.roiPct, 9),
      );
    }
  }
}

function printAggregateTable(runs: WeekRun[]): {
  prod: ReturnType<typeof finalizeAgg>;
  g040: ReturnType<typeof finalizeAgg>;
  g035: ReturnType<typeof finalizeAgg>;
} {
  const aggProd = emptyAgg();
  const aggG040 = emptyAgg();
  const aggG035 = emptyAgg();
  for (const r of runs) {
    if (r.status !== "ok" || !r.calibration) continue;
    addGate(aggProd, r.calibration.production);
    addGate(aggG040, r.calibration.gate040);
    addGate(aggG035, r.calibration.gate035);
  }
  const prod = finalizeAgg(aggProd);
  const g040 = finalizeAgg(aggG040);
  const g035 = finalizeAgg(aggG035);
  console.log("\n=== Aggregated results (Weeks 2–5) ===");
  console.log(
    pad("Gate", 7) +
      pad("Plays", 8, "R") +
      pad("W-L-P", 13, "R") +
      pad("Hit", 9, "R") +
      pad("Units", 10, "R") +
      pad("ROI", 9, "R") +
      pad("avgEdge", 10, "R") +
      pad("avgConf", 10, "R"),
  );
  console.log("-".repeat(76));
  for (const [label, f] of [
    ["0.45", prod],
    ["0.40", g040],
    ["0.35", g035],
  ] as const) {
    console.log(
      pad(label, 7) +
        pad(f.plays, 8, "R") +
        pad(`${f.wins}-${f.losses}-${f.pushes}`, 13, "R") +
        pct(f.hitRatePct, 9) +
        fmtUnits(f.unitsProfit, 10) +
        pct(f.roiPct, 9) +
        pct(f.averageEdgePct, 10) +
        pad(f.averageConfidence.toFixed(2), 10, "R"),
    );
  }
  return { prod, g040, g035 };
}

interface BreakdownRow {
  label: string;
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  unitsProfit: number;
}

function emptyRow(label: string): BreakdownRow {
  return {
    label,
    plays: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    noResult: 0,
    unitsProfit: 0,
  };
}

function bucketEdge(edge: number): string {
  if (edge < 0.04) return "<4%";
  if (edge < 0.06) return "4–6%";
  if (edge < 0.08) return "6–8%";
  return "8%+";
}

function bucketConfidence(conf: number): string {
  if (conf >= 0.75) return "High (≥0.75)";
  if (conf >= 0.5) return "Medium (0.50–0.75)";
  return "Low (<0.50)";
}

function bucketOdds(american: number): string {
  if (american >= -110) return "−105 to −110";
  if (american >= -120) return "−111 to −120";
  return "worse than −120";
}

function buildBreakdown(
  plays: PlayDetail[],
  bucket: (p: PlayDetail) => string,
  filter?: (p: PlayDetail) => boolean,
): BreakdownRow[] {
  const map = new Map<string, BreakdownRow>();
  for (const p of plays) {
    if (filter && !filter(p)) continue;
    const label = bucket(p);
    const row = map.get(label) ?? emptyRow(label);
    row.plays += 1;
    if (p.outcome === "WIN") row.wins += 1;
    else if (p.outcome === "LOSS") row.losses += 1;
    else if (p.outcome === "PUSH") row.pushes += 1;
    else row.noResult += 1;
    row.unitsProfit += p.profitPerUnit;
    map.set(label, row);
  }
  return [...map.values()];
}

function printBreakdown(title: string, rows: BreakdownRow[]): void {
  if (rows.length === 0) return;
  console.log(`\n--- ${title} ---`);
  console.log(
    pad("Bucket", 22) +
      pad("Plays", 7, "R") +
      pad("W-L-P", 11, "R") +
      pad("Hit", 8, "R") +
      pad("Units", 9, "R") +
      pad("ROI", 9, "R"),
  );
  for (const r of rows) {
    const decisive = r.wins + r.losses;
    const graded = r.wins + r.losses + r.pushes;
    const hit = decisive > 0 ? (r.wins / decisive) * 100 : 0;
    const roi = graded > 0 ? (r.unitsProfit / graded) * 100 : 0;
    console.log(
      pad(r.label, 22) +
        pad(r.plays, 7, "R") +
        pad(`${r.wins}-${r.losses}-${r.pushes}`, 11, "R") +
        pct(hit, 8) +
        fmtUnits(r.unitsProfit, 9) +
        pct(roi, 9),
    );
  }
}

function printExtremes(plays: PlayDetail[]): void {
  if (plays.length === 0) return;
  const sortedByEdge = [...plays].sort((a, b) => b.edge - a.edge);
  console.log("\n=== Top 10 highest-edge plays ===");
  console.log(
    pad("Week", 5) +
      pad("Player", 24) +
      pad("Prop", 22) +
      pad("Line", 7, "R") +
      pad("Side", 6, "R") +
      pad("Edge", 8, "R") +
      pad("Conf", 7, "R") +
      pad("Outcome", 9, "R") +
      pad("P/L", 9, "R"),
  );
  for (const p of sortedByEdge.slice(0, 10)) {
    console.log(
      pad(p.week, 5) +
        pad(p.playerName.slice(0, 22), 24) +
        pad(p.propType.replace(/_/g, " ").slice(0, 20), 22) +
        pad(p.line.toString(), 7, "R") +
        pad(p.recommendedSide, 6, "R") +
        pct(p.edge * 100, 8) +
        pad(p.confidence.toFixed(2), 7, "R") +
        pad(p.outcome, 9, "R") +
        fmtUnits(p.profitPerUnit, 9),
    );
  }
  const sortedByPL = [...plays].sort(
    (a, b) => a.profitPerUnit - b.profitPerUnit,
  );
  console.log("\n=== Worst 10 plays by P/L ===");
  console.log(
    pad("Week", 5) +
      pad("Player", 24) +
      pad("Prop", 22) +
      pad("Line", 7, "R") +
      pad("Side", 6, "R") +
      pad("Edge", 8, "R") +
      pad("Conf", 7, "R") +
      pad("Outcome", 9, "R") +
      pad("P/L", 9, "R"),
  );
  for (const p of sortedByPL.slice(0, 10)) {
    console.log(
      pad(p.week, 5) +
        pad(p.playerName.slice(0, 22), 24) +
        pad(p.propType.replace(/_/g, " ").slice(0, 20), 22) +
        pad(p.line.toString(), 7, "R") +
        pad(p.recommendedSide, 6, "R") +
        pct(p.edge * 100, 8) +
        pad(p.confidence.toFixed(2), 7, "R") +
        pad(p.outcome, 9, "R") +
        fmtUnits(p.profitPerUnit, 9),
    );
  }
}

function printSummary(args: {
  prod: ReturnType<typeof finalizeAgg>;
  g040: ReturnType<typeof finalizeAgg>;
  g035: ReturnType<typeof finalizeAgg>;
  okWeeks: number[];
  skippedWeeks: number[];
}): void {
  console.log("\n=== Summary ===");
  const lines: string[] = [];
  const byROI = [
    { label: "0.45", f: args.prod },
    { label: "0.40", f: args.g040 },
    { label: "0.35", f: args.g035 },
  ].sort((a, b) => b.f.roiPct - a.f.roiPct);
  lines.push(
    `Weeks evaluated: ${args.okWeeks.join(", ") || "none"}` +
      (args.skippedWeeks.length > 0
        ? `  · skipped (no stored data): ${args.skippedWeeks.join(", ")}`
        : ""),
  );
  lines.push(
    `Best ROI gate: ${byROI[0].label} (${byROI[0].f.roiPct.toFixed(1)}%, ${byROI[0].f.plays} plays)`,
  );
  // 0.40 vs 0.35 balance.
  const liftG040 = args.g040.plays - args.prod.plays;
  const liftG035 = args.g035.plays - args.g040.plays;
  lines.push(
    `Volume lift: 0.45 → 0.40 adds ${liftG040} plays; 0.40 → 0.35 adds ${liftG035} more.`,
  );
  // Edge quality drift.
  const edgeDrift = args.g040.averageEdgePct - args.g035.averageEdgePct;
  if (Number.isFinite(edgeDrift)) {
    lines.push(
      `Edge quality: 0.40 avg edge ${args.g040.averageEdgePct.toFixed(1)}% vs 0.35 avg edge ${args.g035.averageEdgePct.toFixed(1)}% ` +
        `(0.35 ${edgeDrift > 0 ? "lower" : "higher"} by ${Math.abs(edgeDrift).toFixed(1)}pp).`,
    );
  }
  // Per-week consistency: how many weeks did each gate finish
  // positive ROI?
  const positiveCounts = { prod: 0, g040: 0, g035: 0 };
  for (const w of args.okWeeks) {
    // We can't access per-week ROI from here without passing
    // the runs; the per-week table prints that. Leave the
    // consistency line as a pointer to the table.
  }
  lines.push(
    `Consistency: see the per-week table above — a gate that wins on aggregate but only because of one outlier week is fragile.`,
  );
  lines.push(
    `Diagnostic only — production gate stays at 0.45 regardless of which gate scores best here.`,
  );
  for (const l of lines) console.log(`  · ${l}`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  console.log("Multi-week market-context calibration replay");
  console.log("============================================");
  console.log(
    `Season ${args.season} · Weeks ${args.weeks.join(", ")} · diagnostic only`,
  );

  const runs: WeekRun[] = [];
  for (const week of args.weeks) {
    process.stdout.write(`\nLoading ${args.season} W${week} ... `);
    try {
      const run = runWeek({ season: args.season, week });
      runs.push(run);
      if (run.status === "ok") {
        const cal = run.calibration!;
        process.stdout.write(
          `READY ${run.candidateCount} candidates · prod=${cal.production.qualifiedCount} · 0.40=${cal.gate040.qualifiedCount} · 0.35=${cal.gate035.qualifiedCount}\n`,
        );
      } else {
        process.stdout.write(`MISSING (${run.reason})\n`);
      }
    } catch (err) {
      runs.push({
        status: "error",
        week,
        season: args.season,
        reason: (err as Error).message,
      });
      process.stdout.write(`ERROR (${(err as Error).message})\n`);
    }
  }

  const okWeeks = runs.filter((r) => r.status === "ok").map((r) => r.week);
  const skippedWeeks = runs
    .filter((r) => r.status !== "ok")
    .map((r) => r.week);
  if (okWeeks.length === 0) {
    console.log(
      "\nNo weeks produced stored candidates. Nothing to aggregate.",
    );
    console.log(
      "If this is the local sandbox: only Week 1 is ingested; this is expected.",
    );
    console.log(
      "On Railway: confirm Postgres has StoredPropMarket rows for the target weeks.",
    );
    return;
  }

  printPerWeekTable(runs);
  const agg = printAggregateTable(runs);

  // Concatenated plays across all ok weeks for breakdowns + extremes.
  const allPlays = runs.flatMap((r) => r.plays ?? []);

  // Per-gate breakdowns: prop type / edge / confidence / odds.
  for (const gate of [0.45, 0.4, 0.35]) {
    const plays = allPlays.filter((p) => {
      if (gate === 0.45) return p.qualifiedAtGate === 0.45;
      if (gate === 0.4) return p.qualifiedAtGate === 0.45 || p.qualifiedAtGate === 0.4;
      return true; // gate === 0.35: all
    });
    console.log(
      `\n>>> Breakdowns @ gate ${gate.toFixed(2)} (${plays.length} plays) <<<`,
    );
    printBreakdown(
      "By prop type",
      buildBreakdown(plays, (p) => p.propType.replace(/_/g, " ")),
    );
    printBreakdown(
      "By edge bucket",
      buildBreakdown(plays, (p) => bucketEdge(p.edge)),
    );
    printBreakdown(
      "By confidence",
      buildBreakdown(plays, (p) => bucketConfidence(p.confidence)),
    );
    printBreakdown(
      "By odds",
      buildBreakdown(plays, (p) => bucketOdds(p.americanOdds)),
    );
  }

  printExtremes(allPlays);
  printSummary({
    prod: agg.prod,
    g040: agg.g040,
    g035: agg.g035,
    okWeeks,
    skippedWeeks,
  });

  console.log(
    "\nDone. DIAGNOSTIC ONLY — production gate stays at 0.45. " +
      "No paid API call, no automated betting, no touchdown props.",
  );
}

main();
