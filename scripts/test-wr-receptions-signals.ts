/**
 * WR receptions signal computation — assertions.
 *
 *   · Filters: only WR + propType=RECEPTIONS yields a non-
 *     undefined result. RB / TE / QB or other prop types
 *     return undefined.
 *   · strict-before discipline: target-week and future rows
 *     are excluded from every signal.
 *   · roleChange uses last-2 vs prior-3-game baseline
 *     (different from the generic signal-features roleChange,
 *     which compares last-2 vs ALL prior weeks).
 *   · routeParticipationSlope tracks targets/snapShare slope.
 *   · targetShareVolatility = stddev of targetShare over last
 *     5 games; bounded to [0, 1].
 *   · teamProe = teamPassRate − LEAGUE baseline when team
 *     history is provided; falls back to 0 + teamHistoryAvailable
 *     = false otherwise.
 *   · defensiveMatchup is always undefined for now (no
 *     opponent-allowed-to-WRs in current ingestion).
 *   · hasNeutralFallback fires whenever any signal defaulted.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import { computeWrReceptionsSignals } from "../src/lib/backtest/wr-receptions-signals";
import type {
  NflPlayerWeekStat,
  NflTeamWeekStat,
} from "../src/lib/ingestion/nflverse-types";

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

function makeRow(over: Partial<NflPlayerWeekStat>): NflPlayerWeekStat {
  return {
    season: 2025,
    week: 1,
    playerId: "00-WR",
    playerName: "WR Player",
    team: "BUF",
    position: "WR",
    opponent: "NYJ",
    gameId: "2025-w1-BUF-NYJ",
    homeAway: "HOME",
    passingAttempts: 0,
    passingCompletions: 0,
    passingYards: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    receptions: 0,
    receivingYards: 0,
    targets: 0,
    snapShare: 0.5,
    targetShare: 0.2,
    carryShare: 0,
    ...over,
  };
}

function makeTeamRow(
  over: Partial<NflTeamWeekStat>,
): NflTeamWeekStat {
  return {
    team: "BUF",
    opponent: "NYJ",
    season: 2025,
    week: 1,
    gameId: "2025-w1-BUF-NYJ",
    homeAway: "HOME",
    totalPlays: 60,
    passAttempts: 35,
    rushAttempts: 25,
    passRate: 0.583,
    rushRate: 0.417,
    secondsPerPlay: 28,
    pointsFor: 21,
    pointsAgainst: 17,
    ...over,
  };
}

function main(): void {
  console.log("WR receptions signal computation — assertions");
  console.log("=============================================");

  // 1. Non-WR or non-RECEPTIONS returns undefined.
  {
    const r = makeReport("WR + RECEPTIONS filter");
    const wrHistory: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, position: "WR", targets: 8 }),
      makeRow({ season: 2025, week: 2, position: "WR", targets: 7 }),
      makeRow({ season: 2025, week: 3, position: "WR", targets: 9 }),
    ];
    const rbHistory: NflPlayerWeekStat[] = wrHistory.map((r) => ({
      ...r,
      position: "RB",
    }));
    // Non-RECEPTIONS prop type — undefined.
    const notRec = computeWrReceptionsSignals({
      propType: "RECEIVING_YARDS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 4,
      history: wrHistory,
    });
    check(r, notRec === undefined, "RECEIVING_YARDS should return undefined");
    // RB with RECEPTIONS — undefined.
    const rbRec = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 4,
      history: rbHistory,
    });
    check(r, rbRec === undefined, "RB receptions should return undefined");
    // WR with RECEPTIONS — populated.
    const wrRec = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 4,
      history: wrHistory,
    });
    check(r, wrRec !== undefined, "WR receptions should be populated");
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — WR + RECEPTIONS filter");
    else console.log("[1] FAIL — WR + RECEPTIONS filter");
  }

  // 2. strict-before: target week and future rows excluded.
  {
    const r = makeReport("strict-before excludes target + future");
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targets: 7 }),
      makeRow({ season: 2025, week: 2, targets: 7 }),
      makeRow({ season: 2025, week: 3, targets: 8 }),
      makeRow({ season: 2025, week: 4, targets: 8 }),
      makeRow({ season: 2025, week: 5, targets: 7 }),
      // Target week — must NOT influence signals.
      makeRow({ season: 2025, week: 6, targets: 99, snapShare: 1.0 }),
      // Future season — must NOT influence signals.
      makeRow({ season: 2026, week: 1, targets: 99, snapShare: 1.0 }),
    ];
    const out = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 6,
      history,
    });
    check(r, out !== undefined, "WR receptions should be populated");
    check(
      r,
      out?.historyRowsUsed === 5,
      `historyRowsUsed=${out?.historyRowsUsed}, expected 5 (target + future excluded)`,
    );
    // 99-target target-week row would push role change up to
    // the cap; the exclusion must keep it small (~0).
    check(
      r,
      Math.abs(out?.roleChange ?? 1) < 0.3,
      `roleChange=${out?.roleChange} — strict-before should keep it small`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — strict-before");
    else console.log("[2] FAIL — strict-before");
  }

  // 3. roleChange detects last-2 spike vs prior-3 baseline.
  {
    const r = makeReport("roleChange spike");
    const history: NflPlayerWeekStat[] = [
      // prior-3 baseline: targets≈4, snap≈0.4
      makeRow({ season: 2025, week: 1, targets: 4, snapShare: 0.4 }),
      makeRow({ season: 2025, week: 2, targets: 4, snapShare: 0.4 }),
      makeRow({ season: 2025, week: 3, targets: 4, snapShare: 0.4 }),
      // last-2: targets≈10, snap≈0.8
      makeRow({ season: 2025, week: 4, targets: 10, snapShare: 0.8 }),
      makeRow({ season: 2025, week: 5, targets: 10, snapShare: 0.8 }),
    ];
    const out = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 6,
      history,
    });
    check(r, out !== undefined, "out populated");
    check(
      r,
      (out?.roleChange ?? 0) > 0.5,
      `roleChange=${out?.roleChange} expected > 0.5 (clear usage spike)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — roleChange spike");
    else console.log("[3] FAIL — roleChange");
  }

  // 4. roleChange returns 0 when history is too short.
  {
    const r = makeReport("roleChange short history");
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targets: 7 }),
      makeRow({ season: 2025, week: 2, targets: 7 }),
      makeRow({ season: 2025, week: 3, targets: 7 }),
    ];
    const out = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 4,
      history,
    });
    check(r, out !== undefined, "out populated (>= 3 rows)");
    check(
      r,
      out?.roleChange === 0,
      `roleChange=${out?.roleChange} expected 0 (< 5 rows = no baseline)`,
    );
    check(
      r,
      out?.hasNeutralFallback === true,
      "hasNeutralFallback should fire when < 5 rows",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — roleChange short history");
    else console.log("[4] FAIL — roleChange short history");
  }

  // 5. routeParticipationSlope: rising targets/snapShare.
  {
    const r = makeReport("routeParticipationSlope rising");
    const history: NflPlayerWeekStat[] = [
      // targets/snapShare = 2/0.5=4, 4/0.5=8, 6/0.5=12 → upward slope.
      makeRow({ season: 2025, week: 1, targets: 2, snapShare: 0.5 }),
      makeRow({ season: 2025, week: 2, targets: 4, snapShare: 0.5 }),
      makeRow({ season: 2025, week: 3, targets: 6, snapShare: 0.5 }),
    ];
    const out = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 4,
      history,
    });
    check(
      r,
      (out?.routeParticipationSlope ?? 0) > 0,
      `routeParticipationSlope=${out?.routeParticipationSlope} expected positive`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — routeParticipationSlope rising");
    else console.log("[5] FAIL — routeParticipationSlope");
  }

  // 6. targetShareVolatility from last-5 std dev.
  {
    const r = makeReport("targetShareVolatility std dev");
    const stable: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targetShare: 0.20 }),
      makeRow({ season: 2025, week: 2, targetShare: 0.21 }),
      makeRow({ season: 2025, week: 3, targetShare: 0.20 }),
      makeRow({ season: 2025, week: 4, targetShare: 0.21 }),
      makeRow({ season: 2025, week: 5, targetShare: 0.20 }),
    ];
    const erratic: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targetShare: 0.05 }),
      makeRow({ season: 2025, week: 2, targetShare: 0.40 }),
      makeRow({ season: 2025, week: 3, targetShare: 0.10 }),
      makeRow({ season: 2025, week: 4, targetShare: 0.45 }),
      makeRow({ season: 2025, week: 5, targetShare: 0.05 }),
    ];
    const out1 = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 6,
      history: stable,
    });
    const out2 = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 6,
      history: erratic,
    });
    check(
      r,
      (out1?.targetShareVolatility ?? 0) < (out2?.targetShareVolatility ?? 0),
      `stable=${out1?.targetShareVolatility} should be < erratic=${out2?.targetShareVolatility}`,
    );
    check(
      r,
      (out1?.targetShareVolatility ?? 0) < 0.05,
      `stable vol=${out1?.targetShareVolatility} should be < 0.05`,
    );
    check(
      r,
      (out2?.targetShareVolatility ?? 0) > 0.1,
      `erratic vol=${out2?.targetShareVolatility} should be > 0.1`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — targetShareVolatility");
    else console.log("[6] FAIL — targetShareVolatility");
  }

  // 7. teamProe positive when team passRate > LEAGUE baseline.
  {
    const r = makeReport("teamProe + team-history availability");
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targets: 7 }),
      makeRow({ season: 2025, week: 2, targets: 7 }),
      makeRow({ season: 2025, week: 3, targets: 7 }),
      makeRow({ season: 2025, week: 4, targets: 7 }),
      makeRow({ season: 2025, week: 5, targets: 7 }),
    ];
    const teamHistory: NflTeamWeekStat[] = [
      // BUF pass rate well above league baseline (~0.575).
      makeTeamRow({ season: 2025, week: 1, passRate: 0.70 }),
      makeTeamRow({ season: 2025, week: 2, passRate: 0.72 }),
      makeTeamRow({ season: 2025, week: 3, passRate: 0.68 }),
      makeTeamRow({ season: 2025, week: 4, passRate: 0.70 }),
      makeTeamRow({ season: 2025, week: 5, passRate: 0.71 }),
    ];
    const out = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 6,
      history,
      teamHistory,
    });
    check(r, out?.teamHistoryAvailable === true, "team history available");
    check(
      r,
      (out?.teamProe ?? 0) > 0.05,
      `teamProe=${out?.teamProe} expected > 0.05 (BUF very pass-heavy)`,
    );

    // Without team history, falls back to 0 + flag.
    const out2 = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 6,
      history,
    });
    check(r, out2?.teamProe === 0, `no team history: teamProe=${out2?.teamProe}, expected 0`);
    check(
      r,
      out2?.teamHistoryAvailable === false,
      "no team history: teamHistoryAvailable should be false",
    );
    check(
      r,
      out2?.hasNeutralFallback === true,
      "no team history: hasNeutralFallback should be true",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — teamProe + fallback");
    else console.log("[7] FAIL — teamProe");
  }

  // 8. defensiveMatchup always undefined (no data ingested).
  {
    const r = makeReport("defensiveMatchup unavailable");
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targets: 7 }),
      makeRow({ season: 2025, week: 2, targets: 7 }),
      makeRow({ season: 2025, week: 3, targets: 7 }),
    ];
    const out = computeWrReceptionsSignals({
      propType: "RECEPTIONS",
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 4,
      history,
    });
    check(
      r,
      out?.defensiveMatchup === undefined,
      `defensiveMatchup=${out?.defensiveMatchup}, expected undefined`,
    );
    check(
      r,
      out?.defensiveMatchupAvailable === false,
      "defensiveMatchupAvailable should be false",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — defensiveMatchup unavailable");
    else console.log("[8] FAIL — defensiveMatchup");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 8 / 8 SCENARIOS PASSED");
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
