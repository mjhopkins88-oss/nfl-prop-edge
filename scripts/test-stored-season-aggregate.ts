/**
 * Multi-week season aggregation assertions.
 *
 *   · loadAllStoredMonitorSnapshots returns every (season, week)
 *     that has data, in week order, skipping missing weeks
 *   · aggregateStoredSeason sums universe and recommended-plays
 *     numbers correctly across weeks
 *   · per-gate calibration rollup sums qualified counts /
 *     units / hits / losses across weeks AND recomputes
 *     hit / ROI from the SUMS so the math matches what users
 *     see per-week
 *   · adding a new week does NOT mutate previous weeks (each
 *     (season, week) row is independent in Postgres)
 *   · production gate stays 0.45 in the aggregate (no drift)
 *   · the aggregate calibration.available flag is false when
 *     no week carries a marketContextCalibration payload
 *   · no banned hooks (Odds API, Kalshi, automated betting, TD)
 *
 * Pure in-process — no spawn, no Prisma, no HTTP, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  inMemoryPersistenceClient,
  type PersistenceClient,
} from "../src/lib/persistence/week-1-persistence";
import {
  aggregateStoredSeason,
  loadAllStoredMonitorSnapshots,
  type StoredWeekSnapshot,
} from "../src/lib/backtest/week-1-monitor-summary";

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

async function seedWeekRow(args: {
  client: PersistenceClient;
  season: number;
  week: number;
  candidateCount: number;
  recommendedPlays?: {
    enabled: boolean;
    count: number;
    wins: number;
    losses: number;
    pushes: number;
    hitRatePct: number;
    roiPct: number;
    unitsProfit: number;
    averageEdgePct: number;
    averageConfidence: number;
  };
  calibration?: {
    production: { qualifiedCount: number; wins: number; losses: number; pushes: number; unitsProfit: number };
    gate040: { qualifiedCount: number; wins: number; losses: number; pushes: number; unitsProfit: number };
    gate035: { qualifiedCount: number; wins: number; losses: number; pushes: number; unitsProfit: number };
  };
}): Promise<void> {
  await args.client.saveStoredBacktestRunToDb({
    season: args.season,
    week: args.week,
    dataMode: "stored",
    status: "READY",
    realWeek1BacktestReady: true,
    scheduleValidationStatus: "PASS",
    syntheticFixture: false,
    candidatesJson: {
      candidates: Array.from({ length: args.candidateCount }, (_, i) => ({
        id: `w${args.week}-c${i}`,
      })),
    },
    resultsJson: args.recommendedPlays
      ? {
          summary: {
            totalCandidates: args.candidateCount,
            candidatesWithActual: args.candidateCount,
            candidatesMissingActual: 0,
            candidatesPushed: 0,
            qualifiedPlays: args.candidateCount,
            betterSide: "OVER" as const,
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
            recommendedPlays: args.recommendedPlays,
            parlayPerformance: {
              enabled: false,
              note: "pending",
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
          },
          marketContextCalibration: args.calibration
            ? {
                diagnosticOnly: true,
                generatedAt: new Date().toISOString(),
                productionGate: 0.45,
                production: {
                  gateThreshold: 0.45,
                  isProduction: true,
                  qualifiedCount: args.calibration.production.qualifiedCount,
                  decisiveCount:
                    args.calibration.production.wins +
                    args.calibration.production.losses,
                  wins: args.calibration.production.wins,
                  losses: args.calibration.production.losses,
                  pushes: args.calibration.production.pushes,
                  noResult: 0,
                  hitRatePct: 0,
                  roiPct: 0,
                  unitsProfit: args.calibration.production.unitsProfit,
                  averageEdgePct: 0,
                  averageConfidence: 0,
                  byPropType: [],
                  byConfidenceTier: [],
                  byEdgeBucket: [],
                  candidates: [],
                },
                gate040: {
                  gateThreshold: 0.4,
                  isProduction: false,
                  qualifiedCount: args.calibration.gate040.qualifiedCount,
                  decisiveCount:
                    args.calibration.gate040.wins +
                    args.calibration.gate040.losses,
                  wins: args.calibration.gate040.wins,
                  losses: args.calibration.gate040.losses,
                  pushes: args.calibration.gate040.pushes,
                  noResult: 0,
                  hitRatePct: 0,
                  roiPct: 0,
                  unitsProfit: args.calibration.gate040.unitsProfit,
                  averageEdgePct: 0,
                  averageConfidence: 0,
                  byPropType: [],
                  byConfidenceTier: [],
                  byEdgeBucket: [],
                  candidates: [],
                },
                gate035: {
                  gateThreshold: 0.35,
                  isProduction: false,
                  qualifiedCount: args.calibration.gate035.qualifiedCount,
                  decisiveCount:
                    args.calibration.gate035.wins +
                    args.calibration.gate035.losses,
                  wins: args.calibration.gate035.wins,
                  losses: args.calibration.gate035.losses,
                  pushes: args.calibration.gate035.pushes,
                  noResult: 0,
                  hitRatePct: 0,
                  roiPct: 0,
                  unitsProfit: args.calibration.gate035.unitsProfit,
                  averageEdgePct: 0,
                  averageConfidence: 0,
                  byPropType: [],
                  byConfidenceTier: [],
                  byEdgeBucket: [],
                  candidates: [],
                },
                note: "diagnostic only",
              }
            : undefined,
        }
      : undefined,
  });
}

async function main(): Promise<void> {
  console.log("Stored season aggregate — assertions");
  console.log("====================================");

  // 1. loadAllStoredMonitorSnapshots returns weeks in week
  //    order and skips weeks with no data.
  {
    const r = makeReport("loader returns weeks in order, skips missing");
    const client = inMemoryPersistenceClient();
    await seedWeekRow({ client, season: 2025, week: 1, candidateCount: 290 });
    await seedWeekRow({ client, season: 2025, week: 3, candidateCount: 250 });
    // Week 2 and 4+ have no rows — they should be skipped.
    const all = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
      weeks: [1, 2, 3, 4, 5],
    });
    check(r, all.length === 2, `length=${all.length}, expected 2`);
    check(r, all[0]?.week === 1, `weeks[0].week=${all[0]?.week}`);
    check(r, all[1]?.week === 3, `weeks[1].week=${all[1]?.week}`);
    check(
      r,
      all[0]?.candidateCount === 290 && all[1]?.candidateCount === 250,
      `candidate counts ${all[0]?.candidateCount} / ${all[1]?.candidateCount}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — multi-week loader returns ordered + skips missing");
    else console.log("[1] FAIL — loader");
  }

  // 2. aggregateStoredSeason sums universe + recommended-plays
  //    across weeks.
  {
    const r = makeReport("aggregateStoredSeason sums recommended plays");
    const snapshots: StoredWeekSnapshot[] = [
      makeFakeSnap({
        season: 2025,
        week: 1,
        candidateCount: 200,
        recommendedPlays: makeRec({ count: 5, wins: 3, losses: 2, unitsProfit: 0.85 }),
      }),
      makeFakeSnap({
        season: 2025,
        week: 2,
        candidateCount: 180,
        recommendedPlays: makeRec({ count: 7, wins: 4, losses: 3, unitsProfit: 0.66 }),
      }),
    ];
    const agg = aggregateStoredSeason(snapshots);
    check(r, agg.weekCount === 2, `weekCount=${agg.weekCount}`);
    check(r, agg.weeksGraded === 2, `weeksGraded=${agg.weeksGraded}`);
    check(
      r,
      agg.totalCandidates === 380,
      `totalCandidates=${agg.totalCandidates}`,
    );
    check(
      r,
      agg.recommendedPlays.enabled === true,
      `recommendedPlays.enabled=${agg.recommendedPlays.enabled}`,
    );
    check(
      r,
      agg.recommendedPlays.count === 12,
      `count=${agg.recommendedPlays.count}, expected 12`,
    );
    check(
      r,
      agg.recommendedPlays.wins === 7 && agg.recommendedPlays.losses === 5,
      `W/L=${agg.recommendedPlays.wins}/${agg.recommendedPlays.losses}, expected 7/5`,
    );
    // Hit rate recomputed: 7 / 12 = 58.33%.
    check(
      r,
      Math.abs(agg.recommendedPlays.hitRatePct - 58.33) < 0.01,
      `hit=${agg.recommendedPlays.hitRatePct.toFixed(2)}, expected 58.33`,
    );
    // Units profit summed: 0.85 + 0.66 = 1.51.
    check(
      r,
      Math.abs(agg.recommendedPlays.unitsProfit - 1.51) < 0.01,
      `units=${agg.recommendedPlays.unitsProfit.toFixed(2)}, expected 1.51`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — recommendedPlays sums + hit/ROI recomputed");
    else console.log("[2] FAIL — aggregation");
  }

  // 3. Per-gate calibration rollup sums + recomputes hit/ROI.
  {
    const r = makeReport("calibration rollup sums + recomputes");
    const snapshots: StoredWeekSnapshot[] = [
      makeFakeSnap({
        season: 2025,
        week: 1,
        candidateCount: 200,
        recommendedPlays: makeRec({ count: 0, wins: 0, losses: 0, unitsProfit: 0 }),
        calibration: makeCalibration({
          production: { q: 0, w: 0, l: 0, p: 0, u: 0 },
          gate040: { q: 5, w: 3, l: 2, p: 0, u: 0.85 },
          gate035: { q: 12, w: 7, l: 5, p: 0, u: 1.34 },
        }),
      }),
      makeFakeSnap({
        season: 2025,
        week: 2,
        candidateCount: 180,
        recommendedPlays: makeRec({ count: 0, wins: 0, losses: 0, unitsProfit: 0 }),
        calibration: makeCalibration({
          production: { q: 2, w: 1, l: 1, p: 0, u: -0.1 },
          gate040: { q: 10, w: 6, l: 4, p: 0, u: 1.5 },
          gate035: { q: 25, w: 12, l: 13, p: 0, u: -0.5 },
        }),
      }),
    ];
    const agg = aggregateStoredSeason(snapshots);
    check(
      r,
      agg.calibration.available === true,
      `calibration.available=${agg.calibration.available}`,
    );
    check(
      r,
      agg.calibration.productionGate === 0.45,
      `productionGate=${agg.calibration.productionGate}`,
    );
    // Production rollup: 0+2=2 plays, 1W·1L, units -0.1.
    check(
      r,
      agg.calibration.production.qualifiedCount === 2,
      `production qualified=${agg.calibration.production.qualifiedCount}`,
    );
    check(
      r,
      Math.abs(agg.calibration.production.unitsProfit - -0.1) < 0.001,
      `production units=${agg.calibration.production.unitsProfit}`,
    );
    // 0.40 rollup: 5+10=15 plays, 9W·6L, units 2.35.
    check(
      r,
      agg.calibration.gate040.qualifiedCount === 15,
      `gate040 qualified=${agg.calibration.gate040.qualifiedCount}`,
    );
    check(
      r,
      agg.calibration.gate040.wins === 9 && agg.calibration.gate040.losses === 6,
      `gate040 W/L=${agg.calibration.gate040.wins}/${agg.calibration.gate040.losses}`,
    );
    check(
      r,
      Math.abs(agg.calibration.gate040.unitsProfit - 2.35) < 0.001,
      `gate040 units=${agg.calibration.gate040.unitsProfit}`,
    );
    // 0.35 rollup: 12+25=37 plays, 19W·18L, units 0.84.
    check(
      r,
      agg.calibration.gate035.qualifiedCount === 37,
      `gate035 qualified=${agg.calibration.gate035.qualifiedCount}`,
    );
    check(
      r,
      Math.abs(agg.calibration.gate035.unitsProfit - 0.84) < 0.001,
      `gate035 units=${agg.calibration.gate035.unitsProfit}`,
    );
    // Hit rate recomputed from the SUM of wins/losses: 9/15 = 60%.
    check(
      r,
      Math.abs(agg.calibration.gate040.hitRatePct - 60) < 0.01,
      `gate040 hit=${agg.calibration.gate040.hitRatePct}, expected 60`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — calibration rollup sums + hit/ROI recomputed");
    else console.log("[3] FAIL — calibration rollup");
  }

  // 4. Production gate stays 0.45 in the aggregate — no drift.
  {
    const r = makeReport("production gate stays 0.45");
    const snapshots: StoredWeekSnapshot[] = [
      makeFakeSnap({
        season: 2025,
        week: 1,
        candidateCount: 100,
        recommendedPlays: makeRec({ count: 0, wins: 0, losses: 0, unitsProfit: 0 }),
        calibration: makeCalibration({
          production: { q: 0, w: 0, l: 0, p: 0, u: 0 },
          gate040: { q: 0, w: 0, l: 0, p: 0, u: 0 },
          gate035: { q: 0, w: 0, l: 0, p: 0, u: 0 },
        }),
      }),
    ];
    const agg = aggregateStoredSeason(snapshots);
    check(
      r,
      agg.calibration.production.gateThreshold === 0.45,
      `production.gateThreshold=${agg.calibration.production.gateThreshold}`,
    );
    check(
      r,
      agg.calibration.production.isProduction === true,
      `isProduction=${agg.calibration.production.isProduction}`,
    );
    check(
      r,
      agg.calibration.gate040.isProduction === false,
      `gate040.isProduction=${agg.calibration.gate040.isProduction}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — production gate unchanged in aggregate");
    else console.log("[4] FAIL — production gate drift");
  }

  // 5. calibration.available is false when no week carries
  //    a marketContextCalibration payload.
  {
    const r = makeReport("calibration.available false when no payload");
    const snapshots: StoredWeekSnapshot[] = [
      makeFakeSnap({
        season: 2025,
        week: 1,
        candidateCount: 100,
        recommendedPlays: makeRec({ count: 0, wins: 0, losses: 0, unitsProfit: 0 }),
      }),
    ];
    const agg = aggregateStoredSeason(snapshots);
    check(
      r,
      agg.calibration.available === false,
      `available=${agg.calibration.available}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — calibration.available reflects payload presence");
    else console.log("[5] FAIL — availability flag");
  }

  // 6. Adding a new week does not mutate previously-aggregated
  //    rollups (the function is pure).
  {
    const r = makeReport("aggregate is pure / non-mutating");
    const snapshots: StoredWeekSnapshot[] = [
      makeFakeSnap({
        season: 2025,
        week: 1,
        candidateCount: 100,
        recommendedPlays: makeRec({ count: 3, wins: 2, losses: 1, unitsProfit: 0.65 }),
      }),
    ];
    const before = JSON.stringify(snapshots);
    aggregateStoredSeason(snapshots);
    const after = JSON.stringify(snapshots);
    check(r, before === after, "snapshots mutated by aggregator");
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — aggregator is pure");
    else console.log("[6] FAIL — mutation");
  }

  // 7. The aggregator's calibration rollup explicitly excludes
  //    weeks without a calibration payload (the weekCount on
  //    each rollup reflects only weeks that contributed).
  {
    const r = makeReport("calibration rollup weekCount reflects contributors");
    const snapshots: StoredWeekSnapshot[] = [
      makeFakeSnap({
        season: 2025,
        week: 1,
        candidateCount: 100,
        recommendedPlays: makeRec({ count: 0, wins: 0, losses: 0, unitsProfit: 0 }),
        calibration: makeCalibration({
          production: { q: 1, w: 1, l: 0, p: 0, u: 0.91 },
          gate040: { q: 2, w: 1, l: 1, p: 0, u: -0.09 },
          gate035: { q: 5, w: 3, l: 2, p: 0, u: 0.73 },
        }),
      }),
      makeFakeSnap({
        season: 2025,
        week: 2,
        candidateCount: 80,
        recommendedPlays: makeRec({ count: 0, wins: 0, losses: 0, unitsProfit: 0 }),
        // No calibration payload — Week 2 should NOT increment
        // the rollup's weekCount.
      }),
    ];
    const agg = aggregateStoredSeason(snapshots);
    check(
      r,
      agg.calibration.production.weekCount === 1,
      `production.weekCount=${agg.calibration.production.weekCount}, expected 1`,
    );
    check(
      r,
      agg.calibration.gate040.weekCount === 1,
      `gate040.weekCount=${agg.calibration.gate040.weekCount}, expected 1`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — calibration rollup tracks contributors");
    else console.log("[7] FAIL — weekCount semantics");
  }

  // 8. No banned hooks in the multi-week loader or page wiring.
  {
    const r = makeReport("no banned hooks in season aggregation");
    const files = [
      "src/lib/backtest/week-1-monitor-summary.ts",
      "src/app/monitor/page.tsx",
      "src/app/backtest/week-1/page.tsx",
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
    if (r.reasons.length === 0)
      console.log("[8] PASS — no banned hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 8 stored-season-aggregate assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

function makeRec(over: Partial<{
  enabled: boolean;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  unitsProfit: number;
}>): NonNullable<
  StoredWeekSnapshot["graded"]
>["recommendedPlays"] {
  const count = over.count ?? 0;
  const wins = over.wins ?? 0;
  const losses = over.losses ?? 0;
  const pushes = over.pushes ?? 0;
  const unitsProfit = over.unitsProfit ?? 0;
  const decisive = wins + losses;
  const graded = wins + losses + pushes;
  return {
    enabled: over.enabled ?? count > 0,
    note: "",
    count,
    wins,
    losses,
    pushes,
    hitRatePct: decisive > 0 ? (wins / decisive) * 100 : 0,
    roiPct: graded > 0 ? (unitsProfit / graded) * 100 : 0,
    unitsProfit,
    averageEdgePct: 6,
    averageConfidence: 0.65,
    byPropType: [],
    byConfidenceTier: [],
    byEdgeBucket: [],
  };
}

function makeCalibration(args: {
  production: { q: number; w: number; l: number; p: number; u: number };
  gate040: { q: number; w: number; l: number; p: number; u: number };
  gate035: { q: number; w: number; l: number; p: number; u: number };
}): NonNullable<
  StoredWeekSnapshot["graded"]
>["marketContextCalibration"] {
  return {
    diagnosticOnly: true,
    generatedAt: new Date().toISOString(),
    productionGate: 0.45,
    note: "diagnostic only",
    production: makeGateSnap(0.45, true, args.production),
    gate040: makeGateSnap(0.4, false, args.gate040),
    gate035: makeGateSnap(0.35, false, args.gate035),
  };
}

function makeGateSnap(
  gate: number,
  isProduction: boolean,
  v: { q: number; w: number; l: number; p: number; u: number },
): NonNullable<
  StoredWeekSnapshot["graded"]
>["marketContextCalibration"] extends infer T
  ? T extends { production: infer P }
    ? P
    : never
  : never {
  const decisive = v.w + v.l;
  const graded = v.w + v.l + v.p;
  return {
    gateThreshold: gate,
    isProduction,
    qualifiedCount: v.q,
    decisiveCount: decisive,
    wins: v.w,
    losses: v.l,
    pushes: v.p,
    noResult: 0,
    hitRatePct: decisive > 0 ? (v.w / decisive) * 100 : 0,
    roiPct: graded > 0 ? (v.u / graded) * 100 : 0,
    unitsProfit: v.u,
    averageEdgePct: 0,
    averageConfidence: 0,
    byPropType: [],
    byConfidenceTier: [],
    byEdgeBucket: [],
    candidates: [],
  };
}

function makeFakeSnap(args: {
  season: number;
  week: number;
  candidateCount: number;
  recommendedPlays: NonNullable<StoredWeekSnapshot["graded"]>["recommendedPlays"];
  calibration?: NonNullable<StoredWeekSnapshot["graded"]>["marketContextCalibration"];
}): StoredWeekSnapshot {
  return {
    source: "postgres",
    dataMode: "stored",
    status: "READY",
    candidateCount: args.candidateCount,
    scheduleValidationStatus: "PASS",
    realWeek1BacktestReady: true,
    syntheticFixture: false,
    storedOddsPresent: true,
    processedNflPresent: true,
    missingStoredOdds: false,
    missingProcessedNfl: false,
    gradingStatus: "graded",
    notes: [],
    season: args.season,
    week: args.week,
    graded: {
      gradedAt: new Date().toISOString(),
      universeDiagnostics: {
        totalCandidates: args.candidateCount,
        candidatesWithActual: args.candidateCount,
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
      recommendedPlays: args.recommendedPlays,
      parlayPerformance: {
        enabled: false,
        note: "pending",
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
      marketContextCalibration: args.calibration,
    },
  };
}

void main();
