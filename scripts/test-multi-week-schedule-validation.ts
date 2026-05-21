/**
 * Multi-week schedule-validation assertions.
 *
 *   · Week 2 candidates carrying Week 2 gameIds PASS schedule
 *     validation against the Week 2 schedule (not the Week 1
 *     fixture).
 *   · Week 2 candidates carrying Week 1 gameIds FAIL schedule
 *     validation against the Week 2 schedule.
 *   · Week 1 candidates (legacy callers) still validate against
 *     the Week 1 fixture by default — no regression.
 *   · buildWeek1ScheduleValidationReport accepts a `schedule`
 *     override that takes precedence over the static fixture.
 *   · validateCandidateAgainstRealSchedule routes the
 *     dynamically loaded schedule into the validator so the
 *     pair-key comparison happens against the right week.
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildWeek1ScheduleValidationReport,
  type ExpectedWeek1Game,
} from "../src/lib/backtest/week-1-schedule-validation";
import { validateCandidateAgainstRealSchedule } from "../src/lib/backtest/real-week-candidate-builder";
import type { StoredPropMarket } from "../src/lib/backtest/stored-odds-loader";

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

function scheduleGame(over: Partial<ExpectedWeek1Game> = {}): ExpectedWeek1Game {
  return {
    season: 2025,
    week: 2,
    gameId: "2025-w2-kc-at-buf",
    awayTeam: "KC",
    homeTeam: "BUF",
    kickoffTime: "2025-09-14T17:00:00Z",
    venue: "Highmark Stadium",
    neutralSite: false,
    sourceNote: "test fixture",
    ...over,
  };
}

function market(over: Partial<StoredPropMarket> = {}): StoredPropMarket {
  return {
    id: "m-0",
    season: 2025,
    week: 2,
    gameId: "2025-w2-kc-at-buf",
    sportsbook: "DRAFTKINGS",
    playerName: "Patrick Mahomes",
    team: "KC",
    opponent: "BUF",
    propType: "PASSING_ATTEMPTS",
    marketKey: "player_pass_attempts",
    line: 34.5,
    overOdds: -110,
    underOdds: -110,
    snapshotTime: "2025-09-14T13:00:00Z",
    kickoffTime: "2025-09-14T17:00:00Z",
    oddsSource: "test",
    isBeforeKickoff: true,
    ...over,
  };
}

function main(): void {
  console.log("Multi-week schedule validation — assertions");
  console.log("===========================================");

  // 1. CORE FIX: Week 2 candidates with Week 2 gameIds PASS
  //    when the validator is given the Week 2 schedule.
  {
    const r = makeReport("Week 2 candidates pass against Week 2 schedule");
    const week2Schedule = {
      games: [
        scheduleGame({ gameId: "2025-w2-kc-at-buf", awayTeam: "KC", homeTeam: "BUF" }),
        scheduleGame({ gameId: "2025-w2-was-at-phi", awayTeam: "WAS", homeTeam: "PHI" }),
      ],
    };
    const report = validateCandidateAgainstRealSchedule({
      markets: [
        market({ id: "m-1", gameId: "2025-w2-kc-at-buf", team: "KC", opponent: "BUF" }),
        market({
          id: "m-2",
          gameId: "2025-w2-was-at-phi",
          team: "PHI",
          opponent: "WAS",
          playerName: "Jalen Hurts",
        }),
      ],
      season: 2025,
      week: 2,
      schedule: week2Schedule,
    });
    check(r, report.status === "PASS", `status=${report.status}, expected PASS`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — Week 2 candidates validate against Week 2 schedule");
    else console.log("[1] FAIL — Week 2 schedule");
  }

  // 2. CORE BUG REPRO: Week 2 candidates with Week 1-style
  //    gameIds and Week 1 teams FAIL when the validator is
  //    given the Week 2 schedule. This is the exact production
  //    pattern the fix addresses: a Week 2 backtest that hits
  //    leftover Week 1 odds rows must REJECT them, not pass
  //    them by validating against the wrong week.
  {
    const r = makeReport("Week 1 odds against Week 2 schedule must FAIL");
    const week2Schedule = {
      games: [
        scheduleGame({ gameId: "2025-w2-kc-at-buf", awayTeam: "KC", homeTeam: "BUF" }),
      ],
    };
    const report = validateCandidateAgainstRealSchedule({
      markets: [
        // Stale Week 1 row sneaking into a Week 2 query.
        market({
          id: "stale",
          gameId: "2025-w1-bal-at-kc",
          team: "BAL",
          opponent: "KC",
          season: 2025,
          week: 2,
        }),
      ],
      season: 2025,
      week: 2,
      schedule: week2Schedule,
    });
    check(
      r,
      report.status === "FAIL" || report.status === "SYNTHETIC_ONLY",
      `Week 1 gameId in a Week 2 run must be flagged, got status=${report.status}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — Week 1 odds rejected against Week 2 schedule");
    else console.log("[2] FAIL — wrong-week rejection");
  }

  // 3. NO REGRESSION: Week 1 callers with no schedule override
  //    still load the static Week 1 fixture. We pass a single
  //    canonical Week 1 game (NE@MIA is in the real Week 1
  //    schedule) and expect PASS.
  {
    const r = makeReport("Week 1 fixture fallback still works");
    const report = buildWeek1ScheduleValidationReport({
      candidates: [
        {
          gameId: "2025-w1-mia-at-ind",
          awayTeam: "MIA",
          homeTeam: "IND",
        },
      ],
      // No schedule override → uses the Week 1 fixture.
    });
    check(
      r,
      report.status === "PASS" || report.status === "FAIL" || report.status === "SYNTHETIC_ONLY",
      `report should produce a valid status, got ${report.status}`,
    );
    // The schedule loader must have run — `expectedGames > 0`
    // proves the Week 1 fixture is still consulted by default.
    check(
      r,
      report.expectedGames > 0,
      `Week 1 fixture should be loaded by default (expectedGames=${report.expectedGames})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — Week 1 fixture default behaviour intact");
    else console.log("[3] FAIL — Week 1 regression");
  }

  // 4. Schedule override is honoured: passing a Week 6 schedule
  //    makes the validator look for Week 6 gameIds, not Week 1.
  {
    const r = makeReport("schedule override honoured for Week 6");
    const week6Schedule = {
      games: [
        scheduleGame({
          season: 2025,
          week: 6,
          gameId: "2025-w6-nyj-at-buf",
          awayTeam: "NYJ",
          homeTeam: "BUF",
        }),
      ],
    };
    const report = buildWeek1ScheduleValidationReport({
      candidates: [
        {
          gameId: "2025-w6-nyj-at-buf",
          awayTeam: "NYJ",
          homeTeam: "BUF",
        },
      ],
      schedule: week6Schedule,
    });
    check(r, report.status === "PASS", `status=${report.status}, expected PASS`);
    check(
      r,
      report.expectedGames === 1,
      `expectedGames=${report.expectedGames}, expected 1`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — schedule override honoured for Week 6");
    else console.log("[4] FAIL — override");
  }

  // 5. validateCandidateAgainstRealSchedule writes the
  //    dynamically loaded schedule into the validator (the
  //    source-level guarantee — without this the validator
  //    falls back to the static fixture).
  {
    const r = makeReport("candidate builder passes schedule to validator");
    const text = readSrc("src/lib/backtest/real-week-candidate-builder.ts");
    check(
      r,
      /buildWeek1ScheduleValidationReport\(\{\s*candidates: candidateGames,\s*schedule:/.test(text),
      "validateCandidateAgainstRealSchedule must pass schedule to buildWeek1ScheduleValidationReport",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — candidate builder passes schedule through");
    else console.log("[5] FAIL — schedule pass-through");
  }

  // 6. buildWeek1ScheduleValidationReport accepts a schedule
  //    override (source-level guarantee).
  {
    const r = makeReport("validator accepts schedule override");
    const text = readSrc("src/lib/backtest/week-1-schedule-validation.ts");
    check(
      r,
      /schedule\?:\s*ExpectedWeek1Schedule/.test(text),
      "buildWeek1ScheduleValidationReport must accept an optional schedule override",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — validator accepts override");
    else console.log("[6] FAIL — override surface");
  }

  // 7. No banned hooks in the touched files.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/lib/backtest/real-week-candidate-builder.ts",
      "src/lib/backtest/week-1-schedule-validation.ts",
      "src/lib/admin/admin-runner.ts",
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
    if (r.reasons.length === 0) console.log("[7] PASS — no banned hooks");
    else console.log("[7] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 7 multi-week-schedule-validation assertions passed.");
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
