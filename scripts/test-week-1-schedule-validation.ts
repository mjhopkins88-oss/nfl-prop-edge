/**
 * 2025 Week 1 schedule-validation assertions.
 *
 *   · expected schedule fixture loads
 *   · KC vs BAL is invalid for 2025 Week 1
 *   · BUF vs MIA is invalid for 2025 Week 1
 *   · KC @ LAC is valid for 2025 Week 1
 *   · BAL @ BUF is valid for 2025 Week 1
 *   · current candidate fixture either passes schedule validation
 *     or is labeled synthetic + realWeek1BacktestReady === false
 *   · if invalid games exist, realWeek1BacktestReady === false
 *   · no final scores are present in the schedule fixture
 *   · no touchdown propTypes anywhere
 *   · no real API calls are made (no betting / fetch hooks in
 *     the validator source)
 *
 * Pure file IO + module import. No network.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildWeek1ScheduleValidationReport,
  getExpectedWeek1Schedule,
  validateCandidateGamesAgainstSchedule,
  validateWeek1FixtureSchedule,
  type CandidateGame,
} from "../src/lib/backtest/week-1-schedule-validation";
import { loadBacktestFixtures } from "../src/lib/backtest/data-loader";

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

function main(): void {
  console.log("Week 1 2025 schedule validation — assertions");
  console.log("=============================================");

  // 1. Schedule fixture loads + has the right shape.
  {
    const r = makeReport("schedule fixture loads");
    const schedule = getExpectedWeek1Schedule({ forceReload: true });
    check(
      r,
      schedule.season === 2025,
      `schedule.season=${schedule.season}`,
    );
    check(r, schedule.week === 1, `schedule.week=${schedule.week}`);
    check(
      r,
      schedule.games.length >= 16,
      `expected ≥ 16 games, got ${schedule.games.length}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[1] PASS — ${schedule.games.length} games loaded for ${schedule.season} Week ${schedule.week}`,
      );
    else console.log("[1] FAIL — schedule fixture load");
  }

  // 2. KC vs BAL invalid for 2025 Week 1.
  {
    const r = makeReport("KC vs BAL invalid for 2025 Week 1");
    const results = validateCandidateGamesAgainstSchedule([
      { gameId: "x", awayTeam: "KC", homeTeam: "BAL" },
    ]);
    check(r, results.length === 1, "expected one result");
    check(
      r,
      results[0].valid === false,
      `KC@BAL should be invalid (got ${results[0].valid})`,
    );
    record(r);
    if (r.reasons.length === 0) console.log("[2] PASS — KC@BAL flagged invalid");
    else console.log("[2] FAIL — KC@BAL");
  }

  // 3. BUF vs MIA invalid for 2025 Week 1.
  {
    const r = makeReport("BUF vs MIA invalid for 2025 Week 1");
    const results = validateCandidateGamesAgainstSchedule([
      { gameId: "x", awayTeam: "BUF", homeTeam: "MIA" },
    ]);
    check(
      r,
      results[0].valid === false,
      `BUF@MIA should be invalid (got ${results[0].valid})`,
    );
    record(r);
    if (r.reasons.length === 0) console.log("[3] PASS — BUF@MIA flagged invalid");
    else console.log("[3] FAIL — BUF@MIA");
  }

  // 4. KC @ LAC valid for 2025 Week 1.
  {
    const r = makeReport("KC @ LAC valid for 2025 Week 1");
    const results = validateCandidateGamesAgainstSchedule([
      { gameId: "x", awayTeam: "KC", homeTeam: "LAC" },
    ]);
    check(
      r,
      results[0].valid === true,
      `KC@LAC should be valid (got ${results[0].valid})`,
    );
    check(
      r,
      Boolean(results[0].matchedRealGameId),
      "expected matchedRealGameId",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[4] PASS — KC@LAC matched to ${results[0].matchedRealGameId}`,
      );
    else console.log("[4] FAIL — KC@LAC");
  }

  // 5. BAL @ BUF valid for 2025 Week 1.
  {
    const r = makeReport("BAL @ BUF valid for 2025 Week 1");
    const results = validateCandidateGamesAgainstSchedule([
      { gameId: "x", awayTeam: "BAL", homeTeam: "BUF" },
    ]);
    check(
      r,
      results[0].valid === true,
      `BAL@BUF should be valid (got ${results[0].valid})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[5] PASS — BAL@BUF matched to ${results[0].matchedRealGameId}`,
      );
    else console.log("[5] FAIL — BAL@BUF");
  }

  // 6. Status enum behaves: all valid → PASS, mix → FAIL, none → SYNTHETIC_ONLY.
  {
    const r = makeReport("status enum behaviour");
    const allValid: CandidateGame[] = [
      { gameId: "a", awayTeam: "KC", homeTeam: "LAC" },
      { gameId: "b", awayTeam: "BAL", homeTeam: "BUF" },
    ];
    check(
      r,
      validateWeek1FixtureSchedule(allValid) === "PASS",
      "all-valid set should return PASS",
    );
    const mixed: CandidateGame[] = [
      { gameId: "a", awayTeam: "KC", homeTeam: "LAC" },
      { gameId: "b", awayTeam: "KC", homeTeam: "BAL" },
    ];
    check(
      r,
      validateWeek1FixtureSchedule(mixed) === "FAIL",
      "mixed set should return FAIL",
    );
    const allSynthetic: CandidateGame[] = [
      { gameId: "a", awayTeam: "KC", homeTeam: "BAL" },
      { gameId: "b", awayTeam: "BUF", homeTeam: "MIA" },
    ];
    check(
      r,
      validateWeek1FixtureSchedule(allSynthetic) === "SYNTHETIC_ONLY",
      "all-invalid set should return SYNTHETIC_ONLY",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — PASS / FAIL / SYNTHETIC_ONLY transitions");
    else console.log("[6] FAIL — status enum");
  }

  // 7. Current Week 1 fixture-input games → SYNTHETIC_ONLY +
  //    realWeek1BacktestReady === false.
  {
    const r = makeReport("current fixture is synthetic + not real-week ready");
    const fixtures = loadBacktestFixtures(
      path.join(process.cwd(), "data", "fixtures", "backtest", "week-1"),
    );
    const candidateGames: CandidateGame[] = fixtures.games.map((g) => ({
      gameId: g.id,
      homeTeam: g.homeTeamAbbr,
      awayTeam: g.awayTeamAbbr,
    }));
    const report = buildWeek1ScheduleValidationReport({
      candidates: candidateGames,
    });
    check(
      r,
      report.status === "SYNTHETIC_ONLY" || report.status === "FAIL",
      `current fixture should be synthetic, got ${report.status}`,
    );
    check(
      r,
      report.realWeek1BacktestReady === false,
      `realWeek1BacktestReady should be false when synthetic (got ${report.realWeek1BacktestReady})`,
    );
    check(
      r,
      report.syntheticFixture === true,
      `syntheticFixture should be true (got ${report.syntheticFixture})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[7] PASS — current fixture: status=${report.status}, ready=${report.realWeek1BacktestReady}`,
      );
    else console.log("[7] FAIL — current fixture status");
  }

  // 8. Schedule fixture has no scores / winners.
  {
    const r = makeReport("schedule fixture carries no scores or winners");
    const raw = readSrc("data/fixtures/nfl/2025-week-1-schedule.fixture.json");
    for (const banned of [
      /"homeScore"\s*:/,
      /"awayScore"\s*:/,
      /"winner"\s*:/,
      /"finalScore"\s*:/,
      /"score"\s*:/,
    ]) {
      check(
        r,
        !banned.test(raw),
        `schedule fixture contains banned field ${banned}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — schedule fixture is schedule-only");
    else console.log("[8] FAIL — schedule has scores");
  }

  // 9. No touchdown propTypes referenced by the validator source
  //    or the schedule fixture.
  {
    const r = makeReport("no touchdown propTypes referenced");
    for (const f of [
      "src/lib/backtest/week-1-schedule-validation.ts",
      "data/fixtures/nfl/2025-week-1-schedule.fixture.json",
    ]) {
      const text = readSrc(f);
      check(
        r,
        !/\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|RUSH_TD|REC_TD|PASS_TD/.test(
          text,
        ),
        `${f} mentions a touchdown propType`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — no touchdown propTypes referenced");
    else console.log("[9] FAIL — touchdown propType");
  }

  // 10. No real-API / betting hooks in the validator source.
  {
    const r = makeReport("no API / betting hooks in validator source");
    const text = readSrc("src/lib/backtest/week-1-schedule-validation.ts");
    const banned = [
      /the-odds-api/i,
      /odds-api\.com/i,
      /placeBet|placeWager/i,
      /kalshi.+place/i,
      /fetch\(/,
      /https?:\/\//,
    ];
    for (const re of banned) {
      check(
        r,
        !re.test(text),
        `validator source contains banned pattern ${re}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — no API / betting hooks");
    else console.log("[10] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 10 schedule-validation assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const r of f.reasons) console.log(`     - ${r}`);
    }
    process.exit(1);
  }
}

main();
