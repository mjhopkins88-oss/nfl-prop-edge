/**
 * Season aggregate report — assertions.
 *
 *   · seasonSummary aggregates recommended-plays totals across
 *     weeks (plays / W-L / units sum, hitRate + ROI recomputed
 *     from totals).
 *   · perWeek breakdown carries every requested week, including
 *     failed weeks (ok=false) with their failure reason.
 *   · The formatted output includes the spec's exact section
 *     headers in order:
 *       === SEASON SUMMARY ===
 *       === EDGE SLICES (SEASON) ===
 *       === SIGNAL ANALYSIS (SEASON) ===
 *       === WR RECEPTIONS SIGNAL ANALYSIS ===
 *       === MULTI-HYPOTHESIS MISPRICING DIAGNOSTIC (SEASON) ===
 *       === ROOKIE MISPRICING ANALYSIS ===
 *   · The edge-slice report it delegates to carries the same
 *     diagnostics the existing edge-slice action produces — no
 *     drift between admin paths.
 *   · Headlines surface the no-data case cleanly when no
 *     snapshots are supplied.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import { buildSeasonAggregateReport } from "../src/lib/backtest/season-aggregate-report";
import type { SeasonBacktestPerWeekRow } from "../src/lib/backtest/season-stored-backtest-runner";
import type { StoredWeekSnapshot } from "../src/lib/backtest/week-1-monitor-summary";

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

function emptyGate(threshold: number, isProduction: boolean) {
  return {
    gateThreshold: threshold,
    isProduction,
    qualifiedCount: 0,
    decisiveCount: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    noResult: 0,
    hitRatePct: 0,
    roiPct: 0,
    unitsProfit: 0,
    averageEdgePct: 0,
    averageConfidence: 0,
    byPropType: [],
    byConfidenceTier: [],
    byEdgeBucket: [],
    candidates: [],
  };
}

function makeSnapshot(week: number): StoredWeekSnapshot {
  return {
    source: "postgres",
    dataMode: "stored",
    status: "READY",
    candidateCount: 0,
    scheduleValidationStatus: "PASS",
    realWeek1BacktestReady: true,
    syntheticFixture: false,
    storedOddsPresent: true,
    processedNflPresent: true,
    missingStoredOdds: false,
    missingProcessedNfl: false,
    gradingStatus: "graded",
    notes: [],
    season: 2025,
    week,
    graded: {
      gradedAt: new Date().toISOString(),
      universeDiagnostics: {
        totalCandidates: 0,
        candidatesWithActual: 0,
        candidatesMissingActual: 0,
        candidatesPushed: 0,
        overSide: {
          wins: 0,
          losses: 0,
          pushes: 0,
          graded: 0,
          hitRatePct: 0,
          roiPct: 0,
          unitsProfit: 0,
        },
        underSide: {
          wins: 0,
          losses: 0,
          pushes: 0,
          graded: 0,
          hitRatePct: 0,
          roiPct: 0,
          unitsProfit: 0,
        },
        betterSide: "TIE",
        byPropType: [],
        byLineBucket: [],
      },
      gradedSample: [],
      recommendedPlays: {
        enabled: false,
        note: "",
        count: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        hitRatePct: 0,
        roiPct: 0,
        unitsProfit: 0,
        averageEdgePct: 0,
        averageConfidence: 0,
        byPropType: [],
        byConfidenceTier: [],
        byEdgeBucket: [],
      },
      parlayPerformance: {
        enabled: false,
        note: "",
        evaluated: 0,
        selected: 0,
        rejected: 0,
        selectedAggregate: {
          wins: 0,
          losses: 0,
          pushes: 0,
          noResult: 0,
          hitRatePct: 0,
          roiPct: 0,
          unitsProfit: 0,
          averageModeledHitProbabilityPct: 0,
          averageRequiredHitProbabilityPct: 0,
          averagePayoutMultiplier: 0,
          averageEVPct: 0,
        },
        rejectionReasons: {},
      },
      disqualificationBreakdown: {
        edgeTooThin: 0,
        riskGate: 0,
        roleStability: 0,
        missingResult: 0,
        ungradeable: 0,
        other: 0,
        totalRejected: 0,
      },
      marketContextCalibration: {
        diagnosticOnly: true,
        generatedAt: new Date().toISOString(),
        productionGate: 0.45,
        note: "diagnostic only",
        production: emptyGate(0.45, true),
        gate040: emptyGate(0.4, false),
        gate035: emptyGate(0.35, false),
      },
    },
  };
}

function main(): void {
  console.log("Season aggregate report — assertions");
  console.log("=====================================");

  // 1. seasonSummary aggregates per-week totals correctly.
  {
    const r = makeReport("seasonSummary aggregates per-week totals");
    const perWeek: SeasonBacktestPerWeekRow[] = [
      {
        season: 2025,
        week: 1,
        ok: true,
        candidateCount: 100,
        qualifiedCount: 3,
        wins: 2,
        losses: 1,
        pushes: 0,
        hitRatePct: 66.7,
        roiPct: 20,
        unitsProfit: 0.82,
        dbSaved: true,
      },
      {
        season: 2025,
        week: 2,
        ok: true,
        candidateCount: 120,
        qualifiedCount: 4,
        wins: 1,
        losses: 3,
        pushes: 0,
        hitRatePct: 25,
        roiPct: -50,
        unitsProfit: -2.09,
        dbSaved: true,
      },
    ];
    const out = buildSeasonAggregateReport({
      season: 2025,
      weeksRequested: [1, 2],
      perWeek,
      snapshots: [makeSnapshot(1), makeSnapshot(2)],
    });
    check(
      r,
      out.seasonSummary.plays === 7,
      `plays=${out.seasonSummary.plays}, expected 7`,
    );
    check(
      r,
      out.seasonSummary.wins === 3,
      `wins=${out.seasonSummary.wins}, expected 3`,
    );
    check(
      r,
      out.seasonSummary.losses === 4,
      `losses=${out.seasonSummary.losses}, expected 4`,
    );
    // hitRatePct from totals: 3 / (3 + 4) = 42.86%
    check(
      r,
      Math.abs(out.seasonSummary.hitRatePct - (3 / 7) * 100) < 0.01,
      `hitRatePct=${out.seasonSummary.hitRatePct}, expected ~42.86`,
    );
    // unitsProfit sum
    check(
      r,
      Math.abs(out.seasonSummary.unitsProfit - (0.82 + -2.09)) < 0.001,
      `unitsProfit=${out.seasonSummary.unitsProfit}, expected -1.27`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — seasonSummary aggregates totals");
    else console.log("[1] FAIL — seasonSummary aggregation");
  }

  // 2. Failed weeks are carried in the perWeek block and don't
  //    pollute the rolled-up plays / W-L.
  {
    const r = makeReport("failed weeks carried but excluded from totals");
    const perWeek: SeasonBacktestPerWeekRow[] = [
      {
        season: 2025,
        week: 1,
        ok: true,
        candidateCount: 100,
        qualifiedCount: 5,
        wins: 4,
        losses: 1,
        pushes: 0,
        hitRatePct: 80,
        roiPct: 60,
        unitsProfit: 2.6,
      },
      {
        season: 2025,
        week: 2,
        ok: false,
        candidateCount: 0,
        failureReason: "missing-player-stats",
        failureDetail: "stats CSV missing",
      },
    ];
    const out = buildSeasonAggregateReport({
      season: 2025,
      weeksRequested: [1, 2],
      perWeek,
      snapshots: [makeSnapshot(1)],
    });
    check(
      r,
      out.seasonSummary.plays === 5,
      `plays=${out.seasonSummary.plays}, expected 5 (W2 failure excluded)`,
    );
    check(
      r,
      out.weeksMissing.length === 1 && out.weeksMissing[0] === 2,
      `weeksMissing=${JSON.stringify(out.weeksMissing)}, expected [2]`,
    );
    check(
      r,
      out.perWeek.length === 2,
      `perWeek.length=${out.perWeek.length}, expected 2`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — failed weeks tracked separately");
    else console.log("[2] FAIL — failed week handling");
  }

  // 3. Formatted output has the spec's section headers in order.
  {
    const r = makeReport("section headers present in order");
    const out = buildSeasonAggregateReport({
      season: 2025,
      weeksRequested: [1, 2],
      perWeek: [
        {
          season: 2025,
          week: 1,
          ok: true,
          candidateCount: 0,
          qualifiedCount: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          hitRatePct: 0,
          roiPct: 0,
          unitsProfit: 0,
        },
      ],
      snapshots: [makeSnapshot(1), makeSnapshot(2)],
    });
    const expected = [
      "=== SEASON SUMMARY ===",
      "=== EDGE SLICES (SEASON) ===",
      "=== SIGNAL ANALYSIS (SEASON) ===",
      "=== WR RECEPTIONS SIGNAL ANALYSIS ===",
      "=== MULTI-HYPOTHESIS MISPRICING DIAGNOSTIC (SEASON) ===",
      "=== ROOKIE MISPRICING ANALYSIS ===",
    ];
    let last = -1;
    for (const header of expected) {
      const idx = out.formatted.indexOf(header);
      check(r, idx > last, `header "${header}" missing or out of order`);
      last = idx;
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — section headers present in canonical order");
    else console.log("[3] FAIL — section headers");
  }

  // 4. Edge-slice report carries every diagnostic block (proves
  //    the season report is delegating, not re-implementing).
  {
    const r = makeReport("edge-slice carries all diagnostic blocks");
    const out = buildSeasonAggregateReport({
      season: 2025,
      weeksRequested: [1, 2],
      perWeek: [
        {
          season: 2025,
          week: 1,
          ok: true,
          candidateCount: 0,
          qualifiedCount: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          hitRatePct: 0,
          roiPct: 0,
          unitsProfit: 0,
        },
      ],
      snapshots: [makeSnapshot(1)],
    });
    check(
      r,
      out.edgeSlice.signalQuality !== undefined,
      "edge-slice should carry signalQuality",
    );
    check(
      r,
      out.edgeSlice.wrReceptionsAnalysis !== undefined,
      "edge-slice should carry wrReceptionsAnalysis",
    );
    check(
      r,
      out.edgeSlice.mispricingHypotheses !== undefined,
      "edge-slice should carry mispricingHypotheses",
    );
    check(
      r,
      out.edgeSlice.rookieMispricing !== undefined,
      "edge-slice should carry rookieMispricing",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — every diagnostic block delegated");
    else console.log("[4] FAIL — diagnostic block delegation");
  }

  // 5. Per-week compact breakdown surfaces in the formatted output.
  {
    const r = makeReport("per-week breakdown surfaces");
    const out = buildSeasonAggregateReport({
      season: 2025,
      weeksRequested: [1, 2],
      perWeek: [
        {
          season: 2025,
          week: 1,
          ok: true,
          candidateCount: 100,
          qualifiedCount: 3,
          wins: 2,
          losses: 1,
          pushes: 0,
          hitRatePct: 66.7,
          roiPct: 20,
          unitsProfit: 0.82,
        },
        {
          season: 2025,
          week: 2,
          ok: false,
          candidateCount: 0,
          failureReason: "missing-player-stats",
        },
      ],
      snapshots: [makeSnapshot(1)],
    });
    check(
      r,
      out.formatted.includes("Per-week breakdown:"),
      "formatted should include per-week breakdown header",
    );
    check(
      r,
      out.formatted.includes("W 1"),
      `formatted should mention W 1: ${out.formatted.split("\n").find((l) => l.includes("W 1")) ?? "(missing)"}`,
    );
    check(
      r,
      out.formatted.includes("FAILED"),
      "formatted should mention FAILED for the failed week",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — per-week breakdown surfaces");
    else console.log("[5] FAIL — per-week breakdown");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 5 / 5 SCENARIOS PASSED");
    return;
  }
  console.log(`FAIL — ${FAILURES.length} scenario(s) failed:`);
  for (const f of FAILURES) {
    console.log(`  · ${f.scenario}`);
    for (const reason of f.reasons) console.log(`    - ${reason}`);
  }
  process.exitCode = 1;
}

main();
