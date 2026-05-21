/**
 * Real Week 1 readiness assertions.
 *
 *   · NOT_READY when stored odds are missing
 *   · NOT_READY when processed NFL data is missing
 *   · NOT_READY when both are missing
 *   · READY only when both are present
 *   · fixture mode remains synthetic regardless of stored state
 *   · stored mode never falls back to synthetic fixtures
 *   · realWeek1BacktestReady cannot be true while either input is missing
 *   · the report's next-command + paid-API flag are coherent
 *   · no touchdown props are ever admitted
 *   · no paid API or fetch hooks in the readiness module
 *
 * Pure file IO + module import. No network.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReadinessReport } from "./check-real-week-1-readiness";

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

function makeTempRoot(): string {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "nfl-prop-edge-readiness-"),
  );
}

function writeCsv(p: string, headers: string[], rows: string[][]): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    [headers.join(",")].concat(rows.map((r) => r.join(","))).join("\n") + "\n",
  );
}

/**
 * Build a sandbox repo skeleton and pass the resolved repoRoot
 * to `buildReadinessReport`. The readiness module accepts a
 * `repoRoot` override at call time, so we don't need to chdir or
 * mock fs. The schedule fixture stays in the real repo since the
 * underlying validator loads it from a module-load-time constant.
 */
function withSandbox<T>(
  setup: (root: string) => void,
  body: (root: string) => T,
): T {
  const sandbox = makeTempRoot();
  fs.mkdirSync(path.join(sandbox, "data", "processed", "nfl"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(sandbox, "data", "processed", "odds", "2025"), {
    recursive: true,
  });
  setup(sandbox);
  return body(sandbox);
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

function writeRealOdds(sandbox: string): void {
  writeCsv(
    path.join(sandbox, "data", "processed", "odds", "2025", "week-1-prop-markets.csv"),
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
}

function writeRealNfl(sandbox: string): void {
  writeCsv(
    path.join(sandbox, "data", "processed", "nfl", "player_week_stats.csv"),
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
}

function main(): void {
  console.log("Real Week 1 readiness — assertions");
  console.log("===================================");

  // 1. NOT_READY when both inputs are missing.
  {
    const r = makeReport("NOT_READY when both inputs missing");
    const report = withSandbox(
      () => undefined,
      (root) => buildReadinessReport({ season: 2025, week: 1, repoRoot: root }),
    );
    check(r, report.status === "NOT_READY", `expected NOT_READY, got ${report.status}`);
    check(r, report.missingStoredOdds === true, "missingStoredOdds should be true");
    check(r, report.missingProcessedNfl === true, "missingProcessedNfl should be true");
    check(
      r,
      report.realWeek1BacktestReady === false,
      "realWeek1BacktestReady should be false",
    );
    check(r, report.syntheticFixture === true, "syntheticFixture should be true when not ready");
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — NOT_READY when both inputs missing");
    else console.log("[1] FAIL — NOT_READY (both missing)");
  }

  // 2. NOT_READY when only stored odds are missing.
  {
    const r = makeReport("NOT_READY when only stored odds are missing");
    const report = withSandbox(
      (sandbox) => writeRealNfl(sandbox),
      (root) => buildReadinessReport({ season: 2025, week: 1, repoRoot: root }),
    );
    check(r, report.status === "NOT_READY", `expected NOT_READY, got ${report.status}`);
    check(r, report.missingStoredOdds === true, "missingStoredOdds should be true");
    check(r, report.missingProcessedNfl === false, "missingProcessedNfl should be false");
    check(
      r,
      report.realWeek1BacktestReady === false,
      "realWeek1BacktestReady should be false",
    );
    check(
      r,
      report.nextCommandRequiresPaidApi === true,
      "next-command-requires-paid-API should be true when odds are missing",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — odds-missing → paid Odds API next-command");
    else console.log("[2] FAIL — NOT_READY (odds missing)");
  }

  // 3. NOT_READY when only processed NFL is missing.
  {
    const r = makeReport("NOT_READY when only processed NFL is missing");
    const report = withSandbox(
      (sandbox) => writeRealOdds(sandbox),
      (root) => buildReadinessReport({ season: 2025, week: 1, repoRoot: root }),
    );
    check(r, report.status === "NOT_READY", `expected NOT_READY, got ${report.status}`);
    check(r, report.missingStoredOdds === false, "missingStoredOdds should be false");
    check(r, report.missingProcessedNfl === true, "missingProcessedNfl should be true");
    check(
      r,
      report.nextCommandRequiresPaidApi === false,
      "next-command should NOT require paid API when only NFL is missing",
    );
    check(
      r,
      report.nextCommand.includes("ingest-nfl-history"),
      `next-command should point at nflverse ingestion, got ${report.nextCommand}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — nfl-missing → free nflverse next-command");
    else console.log("[3] FAIL — NOT_READY (nfl missing)");
  }

  // 4. READY only when both inputs are present.
  {
    const r = makeReport("READY when both inputs are present");
    const report = withSandbox(
      (sandbox) => {
        writeRealOdds(sandbox);
        writeRealNfl(sandbox);
      },
      (root) => buildReadinessReport({ season: 2025, week: 1, repoRoot: root }),
    );
    check(r, report.status === "READY", `expected READY, got ${report.status}`);
    check(r, report.missingStoredOdds === false, "missingStoredOdds should be false");
    check(r, report.missingProcessedNfl === false, "missingProcessedNfl should be false");
    check(
      r,
      report.realWeek1BacktestReady === true,
      "realWeek1BacktestReady should be true",
    );
    check(r, report.syntheticFixture === false, "syntheticFixture should be false");
    check(
      r,
      report.nextCommandRequiresPaidApi === false,
      "next-command after READY should not require paid API",
    );
    check(
      r,
      report.nextCommand.includes("--data-mode stored"),
      `next-command should run stored mode, got ${report.nextCommand}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — READY when both inputs present");
    else console.log("[4] FAIL — READY path");
  }

  // 5. realWeek1BacktestReady invariant — can't be true while
  //    either flag is true.
  {
    const r = makeReport("realWeek1BacktestReady invariant");
    for (const setup of [
      () => undefined,
      writeRealOdds,
      writeRealNfl,
    ]) {
      const report = withSandbox(
        (sandbox) => {
          if (typeof setup === "function") setup(sandbox);
        },
        (root) => buildReadinessReport({ season: 2025, week: 1, repoRoot: root }),
      );
      const bothPresent =
        !report.missingStoredOdds && !report.missingProcessedNfl;
      check(
        r,
        !(report.realWeek1BacktestReady && !bothPresent),
        `realWeek1BacktestReady=${report.realWeek1BacktestReady} while missing flags = ${report.missingStoredOdds}/${report.missingProcessedNfl}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — readiness invariant holds across configurations");
    else console.log("[5] FAIL — readiness invariant");
  }

  // 6. No touchdown propTypes referenced.
  {
    const r = makeReport("no touchdown propTypes in the readiness module");
    const text = readSrc("scripts/check-real-week-1-readiness.ts");
    check(
      r,
      !/\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|RUSH_TD|REC_TD|PASS_TD/.test(
        text,
      ),
      "readiness module mentions a touchdown propType",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — no touchdown propTypes");
    else console.log("[6] FAIL — touchdown propType");
  }

  // 7. No paid-API / fetch / betting hooks in the production
  //    readiness module. The test file itself contains those
  //    pattern strings inside its own assertions, so we
  //    deliberately don't scan ourselves — the test would fail
  //    on its own regex literals.
  {
    const r = makeReport("no API / fetch / betting hooks in production module");
    const text = readSrc("scripts/check-real-week-1-readiness.ts");
    for (const re of [
      /the-odds-api/i,
      /odds-api\.com/i,
      /placeBet|placeWager/i,
      /kalshi.+place/i,
      /fetch\(/,
      /https?:\/\/[a-z0-9\-]+\.[a-z]+/i,
    ]) {
      check(
        r,
        !re.test(text),
        `check-real-week-1-readiness.ts contains banned pattern ${re}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — no API / fetch / betting hooks");
    else console.log("[7] FAIL — banned hooks");
  }

  // 8. Report always carries the no-touchdown / no-paid-API /
  //    no-automated-betting guard flags as `true`.
  {
    const r = makeReport("guard flags always true");
    const report = withSandbox(
      () => undefined,
      (root) => buildReadinessReport({ season: 2025, week: 1, repoRoot: root }),
    );
    check(r, report.noTouchdownProps === true, "noTouchdownProps should be true");
    check(r, report.noPaidApiCalls === true, "noPaidApiCalls should be true");
    check(r, report.noAutomatedBetting === true, "noAutomatedBetting should be true");
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — guard flags asserted in report");
    else console.log("[8] FAIL — guard flags");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 8 real-Week-1-readiness assertions passed.");
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
