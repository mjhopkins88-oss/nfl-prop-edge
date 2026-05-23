/**
 * Season stored-backtest runner — assertions.
 *
 *   · runSeasonStoredBacktest iterates [startWeek, endWeek] in
 *     order and calls the per-week pipeline exactly once per
 *     week.
 *   · The pipeline injection seam (args.pipeline) is honoured —
 *     tests can swap in a stub that returns canned per-week
 *     results without touching disk or DB.
 *   · perWeek rows reflect each pipeline result, preserving
 *     order and including failed weeks.
 *   · weeksGraded / weeksFailed counts are accurate.
 *   · Invalid ranges (start > end, < 1, > 22) throw rather than
 *     silently producing empty results.
 *   · Aggregate report uses the injected snapshot loader so
 *     tests can supply matching snapshots.
 *   · Headline string surfaces season totals + failure summary.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import { runSeasonStoredBacktest } from "../src/lib/backtest/season-stored-backtest-runner";
import type {
  GradeStoredWeekPipelineResult,
  GradeStoredWeekFailureReason,
} from "../src/lib/backtest/grade-stored-week-pipeline";
import type { StoredWeekSnapshot } from "../src/lib/backtest/week-1-monitor-summary";
import type { PersistenceClient } from "../src/lib/persistence/week-1-persistence";

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
        production: emptyGate(0.45, true),
        gate040: emptyGate(0.4, false),
        gate035: emptyGate(0.35, false),
        note: "diagnostic only",
      },
    },
  };
}

function makeSuccessPipelineResult(args: {
  week: number;
  candidateCount: number;
  qualifiedCount: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}): GradeStoredWeekPipelineResult {
  // The runner only reads `grade.summary.recommendedPlays` off
  // the pipeline result for the per-week row mapping. The rest
  // of the shape is structural padding — we cast through
  // `unknown` to avoid wiring 100+ lines of fixture for nested
  // types that don't influence any test assertion.
  return ({
    ok: true,
    season: 2025,
    week: args.week,
    candidateCount: args.candidateCount,
    evaluatedCandidates: [],
    asOfReport: {
      ok: true,
      season: 2025,
      week: args.week,
      candidatesChecked: 0,
      candidatesValid: 0,
      candidatesInvalid: 0,
      candidates: [],
      sampleInvalid: [],
    },
    grade: {
      summary: {
        gradedAt: new Date().toISOString(),
        totalCandidates: args.candidateCount,
        candidatesWithActual: args.candidateCount,
        candidatesMissingActual: 0,
        candidatesPushed: 0,
        qualifiedPlays: args.qualifiedCount,
        betterSide: "OVER",
        overSide: {
          wins: 0,
          losses: 0,
          pushes: 0,
          graded: 0,
          hitRate: 0,
          roiPct: 0,
          unitsProfit: 0,
        },
        underSide: {
          wins: 0,
          losses: 0,
          pushes: 0,
          graded: 0,
          hitRate: 0,
          roiPct: 0,
          unitsProfit: 0,
        },
        byPropType: [],
        byLineBucket: [],
        recommendedPlays: {
          enabled: true,
          note: "test",
          count: args.qualifiedCount,
          wins: args.wins,
          losses: args.losses,
          pushes: args.pushes,
          hitRatePct: args.hitRatePct,
          roiPct: args.roiPct,
          unitsProfit: args.unitsProfit,
          averageEdgePct: 5,
          averageConfidence: 0.6,
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
          graded: [],
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
          dataQualityGate: 0,
          roleStabilityGate: 0,
          roleStability: 0,
          injuryContextGate: 0,
          correlationExposureGate: 0,
          weatherEnvironmentGate: 0,
          gameScriptGate: 0,
          paceGate: 0,
          marketContextGate: 0,
          missingResult: 0,
          ungradeable: 0,
          other: 0,
          totalRejected: 0,
        },
      },
      graded: [],
    },
    scorecardAudit: {
      candidatesScored: args.candidateCount,
      candidatesWithScorecard: args.candidateCount,
      candidatesMissingHistory: 0,
      byRecommendation: { OVER: 0, UNDER: 0, PASS: 0, unknown: 0 },
      qualifiedCount: args.qualifiedCount,
      disqualifiedCount: 0,
      topDisqualifiers: [],
      featureCompleteness: [],
      samplePicks: [],
    },
    marketContextCalibration: {
      diagnosticOnly: true,
      generatedAt: new Date().toISOString(),
      productionGate: 0.45,
      production: emptyGate(0.45, true),
      gate040: emptyGate(0.4, false),
      gate035: emptyGate(0.35, false),
      note: "diagnostic only",
    },
    diagnosticQualificationAudit: {
      generatedAt: new Date().toISOString(),
      diagnosticOnly: true,
      integrity: {
        ok: true,
        productionGate: 0.45,
        overriddenGate: "marketContext",
        violations: [],
      },
    },
    dbSaved: true,
    gradedFilePath: "/tmp/test-season-runner.json",
    scheduleValidationStatus: "PASS",
  } as unknown as GradeStoredWeekPipelineResult);
}

function makeFailurePipelineResult(args: {
  week: number;
  reason: GradeStoredWeekFailureReason;
  detail: string;
}): GradeStoredWeekPipelineResult {
  return {
    ok: false,
    season: 2025,
    week: args.week,
    reason: args.reason,
    detail: args.detail,
  };
}

async function main(): Promise<void> {
  console.log("Season stored-backtest runner — assertions");
  console.log("==========================================");

  const stubPersistence: PersistenceClient = {
    isAvailable: () => false,
  } as unknown as PersistenceClient;

  // 1. Pipeline is invoked once per week in order; perWeek
  //    preserves order.
  {
    const r = makeReport("pipeline called once per week, in order");
    const calls: number[] = [];
    const result = await runSeasonStoredBacktest({
      season: 2025,
      startWeek: 1,
      endWeek: 3,
      repoRoot: "/tmp/season-runner-test",
      persistence: stubPersistence,
      pipeline: async ({ week }) => {
        calls.push(week);
        return makeSuccessPipelineResult({
          week,
          candidateCount: 100,
          qualifiedCount: 2,
          wins: 1,
          losses: 1,
          pushes: 0,
          hitRatePct: 50,
          roiPct: 0,
          unitsProfit: 0,
        });
      },
      loadSnapshots: async () => [
        makeSnapshot(1),
        makeSnapshot(2),
        makeSnapshot(3),
      ],
    });
    check(
      r,
      JSON.stringify(calls) === JSON.stringify([1, 2, 3]),
      `pipeline calls=${JSON.stringify(calls)}, expected [1,2,3]`,
    );
    check(
      r,
      result.perWeek.length === 3,
      `perWeek.length=${result.perWeek.length}, expected 3`,
    );
    check(
      r,
      result.weeksGraded === 3 && result.weeksFailed === 0,
      `graded=${result.weeksGraded} failed=${result.weeksFailed}, expected 3/0`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — pipeline called per week in order");
    else console.log("[1] FAIL — pipeline ordering");
  }

  // 2. Failed weeks are tracked + the run continues to subsequent
  //    weeks.
  {
    const r = makeReport("failed week does not abort the run");
    const result = await runSeasonStoredBacktest({
      season: 2025,
      startWeek: 1,
      endWeek: 3,
      repoRoot: "/tmp/season-runner-test",
      persistence: stubPersistence,
      pipeline: async ({ week }) => {
        if (week === 2) {
          return makeFailurePipelineResult({
            week,
            reason: "missing-player-stats",
            detail: "stats CSV missing",
          });
        }
        return makeSuccessPipelineResult({
          week,
          candidateCount: 100,
          qualifiedCount: 2,
          wins: 1,
          losses: 1,
          pushes: 0,
          hitRatePct: 50,
          roiPct: 0,
          unitsProfit: 0,
        });
      },
      loadSnapshots: async () => [makeSnapshot(1), makeSnapshot(3)],
    });
    check(
      r,
      result.weeksGraded === 2,
      `weeksGraded=${result.weeksGraded}, expected 2`,
    );
    check(
      r,
      result.weeksFailed === 1,
      `weeksFailed=${result.weeksFailed}, expected 1`,
    );
    check(
      r,
      result.perWeek[1].ok === false &&
        result.perWeek[1].failureReason === "missing-player-stats",
      `W2 failure reason wrong: ${JSON.stringify(result.perWeek[1])}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — failed week recorded; loop continues");
    else console.log("[2] FAIL — failed week handling");
  }

  // 3. Invalid range throws.
  {
    const r = makeReport("invalid range throws");
    let threwForReverse = false;
    try {
      await runSeasonStoredBacktest({
        season: 2025,
        startWeek: 5,
        endWeek: 2,
        repoRoot: "/tmp/season-runner-test",
        persistence: stubPersistence,
        pipeline: async () =>
          makeSuccessPipelineResult({
            week: 1,
            candidateCount: 0,
            qualifiedCount: 0,
            wins: 0,
            losses: 0,
            pushes: 0,
            hitRatePct: 0,
            roiPct: 0,
            unitsProfit: 0,
          }),
        loadSnapshots: async () => [],
      });
    } catch {
      threwForReverse = true;
    }
    check(r, threwForReverse, "should throw when startWeek > endWeek");

    let threwForOutOfBounds = false;
    try {
      await runSeasonStoredBacktest({
        season: 2025,
        startWeek: 0,
        endWeek: 5,
        repoRoot: "/tmp/season-runner-test",
        persistence: stubPersistence,
        pipeline: async () =>
          makeSuccessPipelineResult({
            week: 1,
            candidateCount: 0,
            qualifiedCount: 0,
            wins: 0,
            losses: 0,
            pushes: 0,
            hitRatePct: 0,
            roiPct: 0,
            unitsProfit: 0,
          }),
        loadSnapshots: async () => [],
      });
    } catch {
      threwForOutOfBounds = true;
    }
    check(r, threwForOutOfBounds, "should throw when startWeek < 1");
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — invalid range throws");
    else console.log("[3] FAIL — invalid range");
  }

  // 4. Aggregate report wires through; headline reflects season
  //    totals.
  {
    const r = makeReport("aggregate report + headline");
    const result = await runSeasonStoredBacktest({
      season: 2025,
      startWeek: 1,
      endWeek: 2,
      repoRoot: "/tmp/season-runner-test",
      persistence: stubPersistence,
      pipeline: async ({ week }) =>
        makeSuccessPipelineResult({
          week,
          candidateCount: 100,
          qualifiedCount: week === 1 ? 4 : 2,
          wins: week === 1 ? 3 : 1,
          losses: week === 1 ? 1 : 1,
          pushes: 0,
          hitRatePct: week === 1 ? 75 : 50,
          roiPct: week === 1 ? 50 : -10,
          unitsProfit: week === 1 ? 2.0 : -0.21,
        }),
      loadSnapshots: async () => [makeSnapshot(1), makeSnapshot(2)],
    });
    check(
      r,
      result.aggregate.seasonSummary.plays === 6,
      `aggregate plays=${result.aggregate.seasonSummary.plays}, expected 6`,
    );
    check(
      r,
      result.aggregate.seasonSummary.wins === 4,
      `aggregate wins=${result.aggregate.seasonSummary.wins}, expected 4`,
    );
    check(
      r,
      result.headline.includes("Season 2025"),
      `headline missing season label: ${result.headline}`,
    );
    check(
      r,
      result.headline.includes("graded 2/2"),
      `headline missing graded count: ${result.headline}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — aggregate + headline");
    else console.log("[4] FAIL — aggregate/headline");
  }

  // 5. Headline calls out failed weeks with their reasons.
  {
    const r = makeReport("headline lists failed weeks");
    const result = await runSeasonStoredBacktest({
      season: 2025,
      startWeek: 1,
      endWeek: 2,
      repoRoot: "/tmp/season-runner-test",
      persistence: stubPersistence,
      pipeline: async ({ week }) =>
        week === 2
          ? makeFailurePipelineResult({
              week,
              reason: "candidate-builder-failed",
              detail: "no stored odds for W2",
            })
          : makeSuccessPipelineResult({
              week,
              candidateCount: 50,
              qualifiedCount: 1,
              wins: 1,
              losses: 0,
              pushes: 0,
              hitRatePct: 100,
              roiPct: 100,
              unitsProfit: 0.91,
            }),
      loadSnapshots: async () => [makeSnapshot(1)],
    });
    check(
      r,
      result.headline.includes("W2:candidate-builder-failed"),
      `headline missing failure marker: ${result.headline}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — headline lists failed weeks");
    else console.log("[5] FAIL — headline failure list");
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

void main();
