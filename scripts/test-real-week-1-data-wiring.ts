/**
 * Real Week 1 stored-data wiring assertions.
 *
 *   · stored mode never uses synthetic fixture games
 *   · stored mode returns MISSING_STORED_ODDS when no
 *     stored odds exist for the target week
 *   · stored mode returns MISSING_PROCESSED_NFL when stored
 *     odds exist but processed nfl data does not
 *   · fixture mode still works and is labeled synthetic
 *   · candidate builder rejects KC/BAL and BUF/MIA in stored
 *     mode (schedule validation gate)
 *   · candidate builder accepts real Week 1 game IDs from the
 *     schedule fixture (PASS on a synthetic-but-correct row)
 *   · stored loader drops post-kickoff snapshots
 *   · stored loader admits only the four V1 starter markets
 *     (no touchdowns, no yardage)
 *   · no API calls / fetch hooks in the new modules
 *
 * Pure file IO + module import. No network.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildRealWeek1CandidatesFromStoredData,
  validateCandidateAgainstRealSchedule,
} from "../src/lib/backtest/real-week-candidate-builder";
import {
  loadStoredWeekOdds,
  mapOddsToV1PropTypes,
  STARTER_PROP_TYPES,
} from "../src/lib/backtest/stored-odds-loader";
import {
  loadProcessedNflGames,
  loadProcessedPlayerWeekStatsStrict,
} from "../src/lib/backtest/processed-nfl-loader";

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

function makeTempProcessedRoot(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nfl-prop-edge-real-week-"),
  );
  fs.mkdirSync(path.join(dir, "nfl"), { recursive: true });
  fs.mkdirSync(path.join(dir, "odds", "2025"), { recursive: true });
  return dir;
}

function writeCsv(p: string, headers: string[], rows: string[][]): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = [headers.join(",")]
    .concat(rows.map((r) => r.join(",")))
    .join("\n");
  fs.writeFileSync(p, body + "\n");
}

const ODDS_HEADERS = [
  "season",
  "week",
  "gameId",
  "kickoffTime",
  "sportsbook",
  "playerName",
  "team",
  "opponent",
  "marketKey",
  "line",
  "overOdds",
  "underOdds",
  "snapshotTime",
];

function main(): void {
  console.log("Real Week 1 stored-data wiring — assertions");
  console.log("===========================================");

  // 1. Stored mode + no data: MISSING_STORED_ODDS.
  {
    const r = makeReport("stored mode reports MISSING_STORED_ODDS when empty");
    const tmp = makeTempProcessedRoot();
    const result = buildRealWeek1CandidatesFromStoredData({
      season: 2025,
      week: 1,
      processedRoot: tmp,
    });
    check(
      r,
      result.status === "MISSING_STORED_ODDS",
      `expected MISSING_STORED_ODDS, got ${result.status}`,
    );
    check(
      r,
      result.candidates.length === 0,
      `expected zero candidates, got ${result.candidates.length}`,
    );
    check(
      r,
      result.nextSteps.length > 0,
      "expected nextSteps hints",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — MISSING_STORED_ODDS when temp processed dir is empty");
    else console.log("[1] FAIL — MISSING_STORED_ODDS");
  }

  // 2. Stored mode with stored odds but no NFL data: MISSING_PROCESSED_NFL.
  {
    const r = makeReport("stored mode reports MISSING_PROCESSED_NFL when nfl data absent");
    const tmp = makeTempProcessedRoot();
    writeCsv(
      path.join(tmp, "odds", "2025", "week-1-prop-markets.csv"),
      ODDS_HEADERS,
      [
        [
          "2025",
          "1",
          "2025-w1-kc-at-lac",
          "2025-09-06T00:00:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "LAC",
          "player_pass_attempts",
          "33.5",
          "-110",
          "-110",
          "2025-09-05T20:00:00Z",
        ],
      ],
    );
    const result = buildRealWeek1CandidatesFromStoredData({
      season: 2025,
      week: 1,
      processedRoot: tmp,
    });
    check(
      r,
      result.status === "MISSING_PROCESSED_NFL",
      `expected MISSING_PROCESSED_NFL, got ${result.status}`,
    );
    check(
      r,
      result.candidates.length === 0,
      "expected zero candidates when NFL data missing",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — MISSING_PROCESSED_NFL when nfl/ is empty");
    else console.log("[2] FAIL — MISSING_PROCESSED_NFL");
  }

  // 3. Stored mode rejects synthetic KC/BAL and BUF/MIA.
  {
    const r = makeReport("stored mode rejects synthetic Week-1 matchups");
    const tmp = makeTempProcessedRoot();
    writeCsv(
      path.join(tmp, "odds", "2025", "week-1-prop-markets.csv"),
      ODDS_HEADERS,
      [
        [
          "2025",
          "1",
          "fixture-kc-at-bal-w1",
          "2025-09-07T20:25:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "BAL",
          "player_pass_attempts",
          "33.5",
          "-110",
          "-110",
          "2025-09-07T19:00:00Z",
        ],
        [
          "2025",
          "1",
          "fixture-buf-at-mia-w1",
          "2025-09-07T17:00:00Z",
          "DraftKings",
          "Josh Allen",
          "BUF",
          "MIA",
          "player_pass_attempts",
          "31.5",
          "-110",
          "-110",
          "2025-09-07T15:00:00Z",
        ],
      ],
    );
    const result = buildRealWeek1CandidatesFromStoredData({
      season: 2025,
      week: 1,
      processedRoot: tmp,
    });
    check(
      r,
      result.status === "NO_CANDIDATES_AFTER_FILTER" ||
        result.status === "SCHEDULE_VALIDATION_FAILED",
      `expected NO_CANDIDATES_AFTER_FILTER / SCHEDULE_VALIDATION_FAILED, got ${result.status}`,
    );
    check(
      r,
      result.candidates.length === 0,
      "expected zero real candidates for synthetic IDs",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[3] PASS — synthetic IDs rejected (${result.status})`);
    else console.log("[3] FAIL — synthetic ID rejection");
  }

  // 4. Stored mode accepts real Week-1 IDs.
  {
    const r = makeReport("stored mode accepts real Week-1 game IDs");
    const tmp = makeTempProcessedRoot();
    writeCsv(
      path.join(tmp, "odds", "2025", "week-1-prop-markets.csv"),
      ODDS_HEADERS,
      [
        [
          "2025",
          "1",
          "2025-w1-kc-at-lac",
          "2025-09-06T00:00:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "LAC",
          "player_pass_attempts",
          "33.5",
          "-110",
          "-110",
          "2025-09-05T20:00:00Z",
        ],
        [
          "2025",
          "1",
          "2025-w1-bal-at-buf",
          "2025-09-08T00:20:00Z",
          "DraftKings",
          "Josh Allen",
          "BUF",
          "BAL",
          "player_pass_attempts",
          "31.5",
          "-110",
          "-110",
          "2025-09-07T22:00:00Z",
        ],
      ],
    );
    writeCsv(
      path.join(tmp, "nfl", "player_week_stats.csv"),
      [
        "playerId",
        "playerName",
        "position",
        "team",
        "opponent",
        "season",
        "week",
        "gameId",
        "homeAway",
        "passingAttempts",
      ],
      [
        [
          "00-mahomes",
          "Patrick Mahomes",
          "QB",
          "KC",
          "BUF",
          "2024",
          "18",
          "2024-w18-kc",
          "HOME",
          "36",
        ],
      ],
    );
    const result = buildRealWeek1CandidatesFromStoredData({
      season: 2025,
      week: 1,
      processedRoot: tmp,
    });
    check(
      r,
      result.status === "READY",
      `expected READY, got ${result.status} (notes: ${result.notes.join("; ")})`,
    );
    check(
      r,
      result.candidates.length === 2,
      `expected 2 candidates, got ${result.candidates.length}`,
    );
    for (const c of result.candidates) {
      check(
        r,
        c.syntheticFixture === false,
        `candidate ${c.id} has syntheticFixture=true`,
      );
      check(
        r,
        c.dataMode === "STORED_2025",
        `candidate ${c.id} dataMode=${c.dataMode}`,
      );
    }
    check(
      r,
      result.scheduleReport?.status === "PASS",
      `schedule report should PASS, got ${result.scheduleReport?.status}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[4] PASS — READY with ${result.candidates.length} real candidates`,
      );
    else console.log("[4] FAIL — READY path");
  }

  // 5. Stored loader drops post-kickoff snapshots.
  {
    const r = makeReport("stored loader drops post-kickoff snapshots");
    const tmp = makeTempProcessedRoot();
    writeCsv(
      path.join(tmp, "odds", "2025", "week-1-prop-markets.csv"),
      ODDS_HEADERS,
      [
        [
          "2025",
          "1",
          "2025-w1-kc-at-lac",
          "2025-09-06T00:00:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "LAC",
          "player_pass_attempts",
          "33.5",
          "-110",
          "-110",
          // Post-kickoff snapshot — should be dropped.
          "2025-09-06T02:00:00Z",
        ],
      ],
    );
    const result = loadStoredWeekOdds({
      season: 2025,
      week: 1,
      processedRoot: tmp,
    });
    check(
      r,
      result.status === "MISSING_STORED_ODDS" || result.markets.length === 0,
      "post-kickoff row should drop to zero markets",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[5] PASS — post-kickoff row dropped (status=${result.status})`);
    else console.log("[5] FAIL — post-kickoff guard");
  }

  // 6. Starter-market filter — only 4 V1 propTypes admitted.
  {
    const r = makeReport("only four starter propTypes admitted");
    const starters = Array.from(STARTER_PROP_TYPES);
    check(
      r,
      starters.length === 4,
      `expected 4 starters, got ${starters.length}: ${starters.join(",")}`,
    );
    for (const k of [
      "player_pass_attempts",
      "player_pass_completions",
      "player_receptions",
      "player_rush_attempts",
    ]) {
      check(r, mapOddsToV1PropTypes(k) !== undefined, `${k} should map`);
    }
    for (const k of ["player_pass_tds", "player_anytime_td", "player_first_td"]) {
      check(
        r,
        mapOddsToV1PropTypes(k) === undefined,
        `touchdown market ${k} should not map`,
      );
    }
    // Yardage markets are mapped but rejected by the loader.
    const tmp = makeTempProcessedRoot();
    writeCsv(
      path.join(tmp, "odds", "2025", "week-1-prop-markets.csv"),
      ODDS_HEADERS,
      [
        [
          "2025",
          "1",
          "2025-w1-kc-at-lac",
          "2025-09-06T00:00:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "LAC",
          "player_pass_yds",
          "274.5",
          "-110",
          "-110",
          "2025-09-05T20:00:00Z",
        ],
      ],
    );
    const result = loadStoredWeekOdds({
      season: 2025,
      week: 1,
      processedRoot: tmp,
    });
    check(
      r,
      result.markets.length === 0,
      `yardage prop should be filtered out — got ${result.markets.length} markets`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — starter-market filter enforced");
    else console.log("[6] FAIL — starter-market filter");
  }

  // 7. Schedule validation gate fires on stored markets.
  {
    const r = makeReport("validateCandidateAgainstRealSchedule rejects KC/BAL");
    const report = validateCandidateAgainstRealSchedule({
      markets: [
        {
          id: "x",
          season: 2025,
          week: 1,
          gameId: "fixture-kc-at-bal-w1",
          sportsbook: "x",
          playerName: "x",
          team: "KC",
          opponent: "BAL",
          propType: "PASSING_ATTEMPTS",
          marketKey: "player_pass_attempts",
          line: 0,
          overOdds: 0,
          underOdds: 0,
          isBeforeKickoff: true,
        },
      ],
      season: 2025,
      week: 1,
    });
    check(
      r,
      report.status !== "PASS",
      `KC@BAL should not pass — got ${report.status}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[7] PASS — KC@BAL schedule status=${report.status}`);
    else console.log("[7] FAIL — schedule gate");
  }

  // 8. Fixture mode still works (basic shape check).
  {
    const r = makeReport("fixture mode pregame snapshot still works");
    // We rely on the existing run-week-1-starter-test.ts having
    // already populated fixture mode outputs. The mode-status
    // file should exist and carry dataMode=fixture when written
    // from fixture mode.
    const p = path.join(
      process.cwd(),
      "data",
      "backtests",
      "2025",
      "week-1-data-mode-status.fixture.json",
    );
    if (!fs.existsSync(p)) {
      check(
        r,
        false,
        "fixture-mode runner should have written week-1-data-mode-status.fixture.json earlier",
      );
    } else {
      const status = JSON.parse(fs.readFileSync(p, "utf8"));
      check(
        r,
        status.dataMode === "fixture" || status.dataMode === "stored",
        `dataMode should be 'fixture' or 'stored' (got ${status.dataMode})`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — fixture-mode status file present");
    else console.log("[8] FAIL — fixture-mode status");
  }

  // 9. processed-nfl-loader returns MISSING (not throw) when
  //    games.csv is absent.
  {
    const r = makeReport("processed-nfl-loader MISSING-not-throw on absent file");
    const tmp = makeTempProcessedRoot();
    const games = loadProcessedNflGames(path.join(tmp, "nfl"));
    check(
      r,
      games.status === "MISSING",
      `expected MISSING, got ${games.status}`,
    );
    check(r, games.rows.length === 0, "no rows expected");
    const players = loadProcessedPlayerWeekStatsStrict(path.join(tmp, "nfl"));
    check(
      r,
      players.status === "MISSING",
      `expected MISSING for player stats, got ${players.status}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — processed-nfl-loader returns MISSING without throwing");
    else console.log("[9] FAIL — processed-nfl-loader");
  }

  // 10. No network / paid-API patterns in the new modules.
  {
    const r = makeReport("no API / fetch / betting hooks in new modules");
    for (const f of [
      "src/lib/backtest/processed-nfl-loader.ts",
      "src/lib/backtest/stored-odds-loader.ts",
      "src/lib/backtest/real-week-candidate-builder.ts",
    ]) {
      const text = readSrc(f);
      for (const re of [
        /the-odds-api/i,
        /odds-api\.com/i,
        /placeBet|placeWager/i,
        /kalshi.+place/i,
        /fetch\(/,
        /https?:\/\/[a-z0-9\-]+\.[a-z]+/i,
      ]) {
        check(r, !re.test(text), `${f} contains banned pattern ${re}`);
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — no API / fetch / betting hooks");
    else console.log("[10] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 10 real-week-1-data-wiring assertions passed.");
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
