/**
 * As-of fairness validation assertions.
 *
 *   · clean candidates (pre-kickoff snapshot, strict-before
 *     history) pass with ok=true
 *   · post-kickoff snapshot fails with snapshot_after_kickoff
 *   · missing snapshotTime fails with missing_snapshot_time
 *   · missing kickoffTime fails with missing_kickoff_time
 *   · history row at target week fails with
 *     history_row_at_or_after_target_week
 *   · history row from a future season fails the same way
 *   · validator is pure (does not mutate input candidates or
 *     the history map)
 *   · formatAsOfReport produces a multi-line string that
 *     references the failure codes
 *   · no banned hooks (Odds API, Kalshi, automated betting, TD)
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  validateAsOfFairness,
  formatAsOfReport,
} from "../src/lib/backtest/as-of-validation";
import type { RealWeekCandidate } from "../src/lib/backtest/real-week-candidate-builder";
import type { NflPlayerWeekStat } from "../src/lib/ingestion/nflverse-types";

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

function statRow(over: Partial<NflPlayerWeekStat>): NflPlayerWeekStat {
  return {
    playerId: "00-pid",
    playerName: "Player",
    position: "WR",
    team: "BUF",
    opponent: "NYJ",
    season: 2024,
    week: 18,
    gameId: "2024-w18",
    homeAway: "HOME",
    snapShare: 0.85,
    ...over,
  };
}

function makeCandidate(
  over: Partial<RealWeekCandidate> = {},
): RealWeekCandidate {
  return {
    id: "c-0",
    season: 2025,
    week: 1,
    gameId: "2025-w1",
    playerName: "Player A",
    team: "BUF",
    opponent: "NYJ",
    propType: "RECEPTIONS",
    line: 4.5,
    overOdds: -110,
    underOdds: -110,
    sportsbook: "DRAFTKINGS",
    kickoffTime: "2025-09-07T17:00:00Z",
    snapshotTime: "2025-09-07T13:00:00Z",
    dataMode: "STORED_2025",
    syntheticFixture: false,
    ...over,
  };
}

function main(): void {
  console.log("As-of fairness validation — assertions");
  console.log("======================================");

  // 1. Clean candidates pass.
  {
    const r = makeReport("clean candidate passes");
    const c = makeCandidate();
    const history = new Map([
      [
        "Player A::BUF",
        [
          statRow({ playerName: "Player A", team: "BUF", season: 2024, week: 17 }),
          statRow({ playerName: "Player A", team: "BUF", season: 2024, week: 18 }),
        ],
      ],
    ]);
    const report = validateAsOfFairness({
      candidates: [c],
      season: 2025,
      week: 1,
      playerHistoryByName: history,
    });
    check(r, report.ok === true, `report.ok=${report.ok}`);
    check(
      r,
      report.candidatesValid === 1,
      `valid=${report.candidatesValid}`,
    );
    check(
      r,
      report.candidatesInvalid === 0,
      `invalid=${report.candidatesInvalid}`,
    );
    check(
      r,
      report.candidates[0].snapshotBeforeKickoff === true,
      `snapshotBeforeKickoff=${report.candidates[0].snapshotBeforeKickoff}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — clean candidate passes");
    else console.log("[1] FAIL — clean pass");
  }

  // 2. Post-kickoff snapshot fails.
  {
    const r = makeReport("post-kickoff snapshot fails");
    const c = makeCandidate({
      id: "post-kick",
      kickoffTime: "2025-09-07T17:00:00Z",
      // 4 hours after kickoff — should fail.
      snapshotTime: "2025-09-07T21:00:00Z",
    });
    const report = validateAsOfFairness({
      candidates: [c],
      season: 2025,
      week: 1,
      playerHistoryByName: new Map(),
    });
    check(r, report.ok === false, `report.ok=${report.ok}`);
    check(
      r,
      report.candidates[0].snapshotBeforeKickoff === false,
      `snapBeforeKick=${report.candidates[0].snapshotBeforeKickoff}`,
    );
    const violations = report.candidates[0].violations;
    check(
      r,
      violations.some((v) => v.code === "snapshot_after_kickoff"),
      `violations=${JSON.stringify(violations.map((v) => v.code))}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — post-kickoff snapshot fails");
    else console.log("[2] FAIL — post-kickoff");
  }

  // 3. Missing snapshotTime fails.
  {
    const r = makeReport("missing snapshotTime fails");
    const c = makeCandidate({ id: "no-snap", snapshotTime: undefined });
    const report = validateAsOfFairness({
      candidates: [c],
      season: 2025,
      week: 1,
      playerHistoryByName: new Map(),
    });
    check(r, report.ok === false, `ok=${report.ok}`);
    check(
      r,
      report.candidates[0].violations.some(
        (v) => v.code === "missing_snapshot_time",
      ),
      "expected missing_snapshot_time",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — missing snapshotTime fails");
    else console.log("[3] FAIL — missing snapshot");
  }

  // 4. Missing kickoffTime fails.
  {
    const r = makeReport("missing kickoffTime fails");
    const c = makeCandidate({ id: "no-kick", kickoffTime: undefined });
    const report = validateAsOfFairness({
      candidates: [c],
      season: 2025,
      week: 1,
      playerHistoryByName: new Map(),
    });
    check(r, report.ok === false, `ok=${report.ok}`);
    check(
      r,
      report.candidates[0].violations.some(
        (v) => v.code === "missing_kickoff_time",
      ),
      "expected missing_kickoff_time",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — missing kickoffTime fails");
    else console.log("[4] FAIL — missing kickoff");
  }

  // 5. History row at target week fails.
  {
    const r = makeReport("history row at target week fails");
    const c = makeCandidate();
    const history = new Map([
      [
        "Player A::BUF",
        [
          statRow({ playerName: "Player A", team: "BUF", season: 2024, week: 18 }),
          // Same-week row → strict-before violation.
          statRow({ playerName: "Player A", team: "BUF", season: 2025, week: 1 }),
        ],
      ],
    ]);
    const report = validateAsOfFairness({
      candidates: [c],
      season: 2025,
      week: 1,
      playerHistoryByName: history,
    });
    check(r, report.ok === false, `ok=${report.ok}`);
    check(
      r,
      report.candidates[0].historyWindowOk === false,
      `historyWindowOk=${report.candidates[0].historyWindowOk}`,
    );
    check(
      r,
      report.candidates[0].violations.some(
        (v) => v.code === "history_row_at_or_after_target_week",
      ),
      "expected history_row_at_or_after_target_week",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — same-week history row fails");
    else console.log("[5] FAIL — same-week history");
  }

  // 6. Future-season row in history fails.
  {
    const r = makeReport("future-season history row fails");
    const c = makeCandidate();
    const history = new Map([
      [
        "Player A::BUF",
        [
          // Year ahead of target → strict-before violation.
          statRow({ playerName: "Player A", team: "BUF", season: 2026, week: 1 }),
        ],
      ],
    ]);
    const report = validateAsOfFairness({
      candidates: [c],
      season: 2025,
      week: 1,
      playerHistoryByName: history,
    });
    check(r, report.ok === false, `ok=${report.ok}`);
    check(
      r,
      report.candidates[0].violations.some(
        (v) => v.code === "history_row_at_or_after_target_week",
      ),
      "expected history_row_at_or_after_target_week",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — future-season history row fails");
    else console.log("[6] FAIL — future season");
  }

  // 7. Validator is pure — does not mutate inputs.
  {
    const r = makeReport("validator is pure");
    const c = makeCandidate();
    const history = new Map([
      [
        "Player A::BUF",
        [
          statRow({ playerName: "Player A", team: "BUF", season: 2024, week: 17 }),
        ],
      ],
    ]);
    const before = JSON.stringify({
      c,
      history: Array.from(history.entries()),
    });
    validateAsOfFairness({
      candidates: [c],
      season: 2025,
      week: 1,
      playerHistoryByName: history,
    });
    const after = JSON.stringify({
      c,
      history: Array.from(history.entries()),
    });
    check(r, before === after, "inputs mutated by validator");
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — validator is pure");
    else console.log("[7] FAIL — mutation");
  }

  // 8. formatAsOfReport renders a string referencing each
  //    failure code and the per-candidate kickoff/snapshot
  //    timestamps.
  {
    const r = makeReport("formatAsOfReport renders codes + timestamps");
    const c1 = makeCandidate({
      id: "post-kick",
      kickoffTime: "2025-09-07T17:00:00Z",
      snapshotTime: "2025-09-07T20:00:00Z",
    });
    const c2 = makeCandidate({
      id: "no-kick",
      kickoffTime: undefined,
    });
    const report = validateAsOfFairness({
      candidates: [c1, c2],
      season: 2025,
      week: 1,
      playerHistoryByName: new Map(),
    });
    const text = formatAsOfReport(report);
    check(
      r,
      text.includes("As-of fairness validation"),
      "missing header",
    );
    check(
      r,
      text.includes("snapshot_after_kickoff"),
      "missing snapshot_after_kickoff code",
    );
    check(
      r,
      text.includes("missing_kickoff_time"),
      "missing missing_kickoff_time code",
    );
    check(
      r,
      text.includes("2025-09-07T17:00:00Z"),
      "missing kickoff timestamp in output",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — formatAsOfReport renders codes + timestamps");
    else console.log("[8] FAIL — formatAsOfReport");
  }

  // 9. The grader integration: when the admin runner imports
  //    validateAsOfFairness, the source files must not contain
  //    any banned hooks.
  {
    const r = makeReport("no banned hooks in as-of files");
    const files = [
      "src/lib/backtest/as-of-validation.ts",
      "src/lib/admin/admin-runner.ts",
      "src/lib/backtest/real-week-candidate-builder.ts",
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
      console.log("[9] PASS — no banned hooks");
    else console.log("[9] FAIL — banned hooks");
  }

  // 10. A mixed set with 3 clean + 1 dirty candidate produces
  //     report.ok=false with the dirty one flagged.
  {
    const r = makeReport("mixed set partials report correctly");
    const c1 = makeCandidate({ id: "ok-1" });
    const c2 = makeCandidate({ id: "ok-2", playerName: "Player B" });
    const c3 = makeCandidate({ id: "ok-3", playerName: "Player C" });
    const c4 = makeCandidate({
      id: "dirty",
      playerName: "Player D",
      kickoffTime: "2025-09-07T17:00:00Z",
      snapshotTime: "2025-09-07T22:00:00Z",
    });
    const report = validateAsOfFairness({
      candidates: [c1, c2, c3, c4],
      season: 2025,
      week: 1,
      playerHistoryByName: new Map(),
    });
    check(r, report.candidatesChecked === 4, `checked=${report.candidatesChecked}`);
    // c1/c2/c3 have default (clean) snapshot+kickoff; c4 is
    // post-kickoff. Expected: valid=3, invalid=1.
    check(
      r,
      report.candidatesValid === 3,
      `valid=${report.candidatesValid}, expected 3`,
    );
    check(
      r,
      report.candidatesInvalid === 1,
      `invalid=${report.candidatesInvalid}, expected 1`,
    );
    check(
      r,
      report.sampleInvalid.length >= 1,
      `sampleInvalid=${report.sampleInvalid.length}`,
    );
    check(
      r,
      report.sampleInvalid[0].candidateId === "dirty",
      `first invalid=${report.sampleInvalid[0].candidateId}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — mixed set reports correctly");
    else console.log("[10] FAIL — mixed set");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 10 as-of-validation assertions passed.");
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
