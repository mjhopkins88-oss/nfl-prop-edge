/**
 * Multi-week monitor aggregate assertions.
 *
 *   · loadAllStoredMonitorSnapshots uses the bulk DB loader
 *     when persistence is available, returning every (season,
 *     week) row — not just Week 1.
 *   · Week 1 + Week 2 stored rows aggregate together in the
 *     season totals (candidates, recommended-plays, calibration).
 *   · Future weeks (e.g., Week 7) added after Week 1 + Week 2
 *     are picked up automatically with no code changes.
 *   · The bulk loader picks the LATEST row per week when
 *     multiple rows exist for the same (season, week).
 *   · DB-unavailable fallback still iterates per-week file
 *     mirrors so the local sandbox keeps working.
 *   · The monitor page renders "Real Stored Backtest" headings
 *     (not "Real Week 1") with a per-week suffix when a week is
 *     selected.
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  inMemoryPersistenceClient,
  type PersistenceClient,
  type StoredBacktestRecord,
} from "../src/lib/persistence/week-1-persistence";
import {
  aggregateStoredSeason,
  loadAllStoredMonitorSnapshots,
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

async function seedRow(
  client: PersistenceClient,
  args: {
    season: number;
    week: number;
    candidateCount: number;
    recommendedCount?: number;
    recommendedWins?: number;
    recommendedLosses?: number;
    recommendedUnits?: number;
  },
): Promise<void> {
  await client.saveStoredBacktestRunToDb({
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
    resultsJson:
      args.recommendedCount !== undefined
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
              recommendedPlays: {
                enabled: args.recommendedCount > 0,
                note: "",
                count: args.recommendedCount,
                wins: args.recommendedWins ?? 0,
                losses: args.recommendedLosses ?? 0,
                pushes: 0,
                hitRatePct:
                  args.recommendedCount > 0
                    ? ((args.recommendedWins ?? 0) /
                        Math.max(
                          1,
                          (args.recommendedWins ?? 0) +
                            (args.recommendedLosses ?? 0),
                        )) *
                      100
                    : 0,
                roiPct: 0,
                unitsProfit: args.recommendedUnits ?? 0,
                averageEdgePct: 6,
                averageConfidence: 0.65,
                byPropType: [],
                byConfidenceTier: [],
                byEdgeBucket: [],
              },
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
          }
        : undefined,
  });
}

async function main(): Promise<void> {
  console.log("Monitor multi-week aggregate — assertions");
  console.log("=========================================");

  // 1. CORE FIX: Week 1 + Week 2 stored rows aggregate together.
  {
    const r = makeReport("Week 1 + Week 2 aggregate together");
    const client = inMemoryPersistenceClient();
    await seedRow(client, {
      season: 2025,
      week: 1,
      candidateCount: 290,
      recommendedCount: 5,
      recommendedWins: 3,
      recommendedLosses: 2,
      recommendedUnits: 0.85,
    });
    await seedRow(client, {
      season: 2025,
      week: 2,
      candidateCount: 220,
      recommendedCount: 4,
      recommendedWins: 2,
      recommendedLosses: 2,
      recommendedUnits: -0.18,
    });
    const all = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
    });
    check(r, all.length === 2, `length=${all.length}, expected 2`);
    check(r, all[0]?.week === 1, `weeks[0].week=${all[0]?.week}`);
    check(r, all[1]?.week === 2, `weeks[1].week=${all[1]?.week}`);
    const agg = aggregateStoredSeason(all);
    check(
      r,
      agg.totalCandidates === 510,
      `totalCandidates=${agg.totalCandidates}, expected 510`,
    );
    check(
      r,
      agg.recommendedPlays.count === 9,
      `recommendedPlays.count=${agg.recommendedPlays.count}, expected 9`,
    );
    check(
      r,
      agg.recommendedPlays.wins === 5 && agg.recommendedPlays.losses === 4,
      `W/L=${agg.recommendedPlays.wins}/${agg.recommendedPlays.losses}, expected 5/4`,
    );
    check(
      r,
      Math.abs(agg.recommendedPlays.unitsProfit - 0.67) < 0.001,
      `units=${agg.recommendedPlays.unitsProfit}, expected 0.67`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — Week 1 + Week 2 aggregate together");
    else console.log("[1] FAIL — aggregate");
  }

  // 2. Future weeks added later are picked up automatically.
  {
    const r = makeReport("future weeks added later picked up automatically");
    const client = inMemoryPersistenceClient();
    await seedRow(client, { season: 2025, week: 1, candidateCount: 290 });
    let snaps = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
    });
    check(r, snaps.length === 1, `initial length=${snaps.length}, expected 1`);
    // Add Week 7 — a "future" week not yet imagined when the
    // monitor page was built. The bulk loader must include it
    // without any code change.
    await seedRow(client, { season: 2025, week: 7, candidateCount: 175 });
    snaps = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
    });
    check(r, snaps.length === 2, `after-add length=${snaps.length}, expected 2`);
    check(
      r,
      snaps.some((s) => s.week === 7),
      `should include week 7 (weeks=${snaps.map((s) => s.week).join(",")})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — future weeks picked up automatically");
    else console.log("[2] FAIL — future weeks");
  }

  // 3. Bulk loader picks LATEST row per week.
  {
    const r = makeReport("latest row per week wins");
    const client = inMemoryPersistenceClient();
    // Two Week 1 writes — the second should win.
    await seedRow(client, { season: 2025, week: 1, candidateCount: 100 });
    await seedRow(client, { season: 2025, week: 1, candidateCount: 290 });
    const snaps = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
    });
    check(r, snaps.length === 1, `length=${snaps.length}`);
    check(
      r,
      snaps[0]?.candidateCount === 290,
      `candidateCount=${snaps[0]?.candidateCount}, expected 290 (latest)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — latest stored row wins per week");
    else console.log("[3] FAIL — latest-wins");
  }

  // 4. Selecting a specific week is supported via the weeks
  //    filter — used by the monitor's ?week= query param.
  {
    const r = makeReport("weeks filter narrows the result");
    const client = inMemoryPersistenceClient();
    await seedRow(client, { season: 2025, week: 1, candidateCount: 290 });
    await seedRow(client, { season: 2025, week: 2, candidateCount: 220 });
    await seedRow(client, { season: 2025, week: 5, candidateCount: 180 });
    const week2Only = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
      weeks: [2],
    });
    check(r, week2Only.length === 1, `week-2 length=${week2Only.length}`);
    check(r, week2Only[0]?.week === 2, `selected week=${week2Only[0]?.week}`);
    const allThree = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
    });
    check(
      r,
      allThree.length === 3,
      `all length=${allThree.length}, expected 3`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — weeks filter narrows correctly");
    else console.log("[4] FAIL — week filter");
  }

  // 5. The bulk loader does NOT use the file fallback when
  //    DB returns rows — Week 1 file mirror would otherwise
  //    appear twice (once from DB, once from file scan).
  {
    const r = makeReport("DB rows skip the file fallback");
    const client = inMemoryPersistenceClient();
    await seedRow(client, { season: 2025, week: 1, candidateCount: 290 });
    const snaps = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
    });
    check(r, snaps.length === 1, `length=${snaps.length}, expected 1`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — DB rows skip the file fallback");
    else console.log("[5] FAIL — file fallback dedup");
  }

  // 6. aggregateStoredSeason produces the right
  //    universe-rollup totals across stored weeks.
  {
    const r = makeReport("season universe rollup");
    const client = inMemoryPersistenceClient();
    await seedRow(client, {
      season: 2025,
      week: 1,
      candidateCount: 100,
      recommendedCount: 0,
    });
    await seedRow(client, {
      season: 2025,
      week: 2,
      candidateCount: 75,
      recommendedCount: 0,
    });
    await seedRow(client, {
      season: 2025,
      week: 3,
      candidateCount: 50,
      recommendedCount: 0,
    });
    const snaps = await loadAllStoredMonitorSnapshots({
      season: 2025,
      client,
    });
    const agg = aggregateStoredSeason(snaps);
    check(
      r,
      agg.totalCandidates === 225,
      `totalCandidates=${agg.totalCandidates}, expected 225 (100+75+50)`,
    );
    check(r, agg.weekCount === 3, `weekCount=${agg.weekCount}, expected 3`);
    check(r, agg.weeksGraded === 3, `weeksGraded=${agg.weeksGraded}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — universe rollup totals correct");
    else console.log("[6] FAIL — universe rollup");
  }

  // 7. /monitor renders "Real Stored Backtest" (no hardcoded
  //    "Week 1"), with a per-week suffix when a week is selected.
  {
    const r = makeReport("monitor heading is week-aware");
    const text = readSrc("src/app/monitor/page.tsx");
    check(
      r,
      !/Real Week 1 Stored Backtest/.test(text),
      "must not hardcode 'Real Week 1 Stored Backtest'",
    );
    check(
      r,
      /Real Stored Backtest · Week \$\{week\}/.test(text) ||
        /Real Stored Backtest · Week.*\$\{week\}/.test(text),
      "must render dynamic 'Real Stored Backtest · Week N' when a week is supplied",
    );
    check(
      r,
      /"Real Stored Backtest"/.test(text),
      "must keep the generic 'Real Stored Backtest' label when no week supplied",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — monitor heading is week-aware");
    else console.log("[7] FAIL — heading");
  }

  // 8. No banned hooks anywhere.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/lib/backtest/week-1-monitor-summary.ts",
      "src/lib/persistence/week-1-persistence.ts",
      "src/app/monitor/page.tsx",
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
    console.log("All 8 monitor-multi-week-aggregate assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

void main();
