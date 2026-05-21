/**
 * /backtest/week-1 stored-result rendering assertions.
 *
 *   · admin stored-backtest action writes
 *     week-1-data-mode-status.fixture.json so the file-based
 *     loader picks up the latest run
 *   · the page's merge helper folds a DB-backed snapshot into
 *     the Week1DataModeStatus shape — DB wins when available
 *   · when stored snapshot exists, the page primary state is
 *     `dataMode=stored, realWeek1BacktestReady=true,
 *     candidateCount=N, scheduleValidationStatus=PASS,
 *     syntheticFixture=false, missingStoredOdds=false`
 *   · without a stored snapshot, the page falls back to the
 *     file-only Week1DataModeStatus
 *   · a successful stored run demotes the synthetic-fixture
 *     banner (page checks realWeek1BacktestReady)
 *   · no paid API call, no touchdown props, no automated
 *     betting in any of the touched code
 *
 * Pure file IO + persistence stub. No render, no spawn, no
 * Prisma, no HTTP.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inMemoryPersistenceClient,
} from "../src/lib/persistence/week-1-persistence";
import { loadStoredWeek1MonitorSnapshot } from "../src/lib/backtest/week-1-monitor-summary";
import { runAdminAction } from "../src/lib/admin/admin-runner";

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

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nfl-prop-edge-w1page-"),
  );
  fs.mkdirSync(path.join(dir, "data", "backtests", "2025"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "data", "processed", "odds", "2025"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "data", "processed", "nfl"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "admin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "admin-ingestion"), {
    recursive: true,
  });
  return dir;
}

function seedReadyStored(root: string): void {
  // Canonical odds + processed NFL + games.csv so the builder
  // can return READY.
  fs.writeFileSync(
    path.join(
      root,
      "data",
      "processed",
      "odds",
      "2025",
      "week-1-prop-markets.csv",
    ),
    [
      [
        "season",
        "week",
        "gameId",
        "kickoffTime",
        "sportsbook",
        "playerName",
        "team",
        "opponent",
        "marketKey",
        "propType",
        "line",
        "overOdds",
        "underOdds",
        "snapshotTime",
      ].join(","),
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
        "PASSING_ATTEMPTS",
        "33.5",
        "-110",
        "-110",
        "2025-09-05T20:30:00Z",
      ].join(","),
    ].join("\n") + "\n",
  );
  fs.writeFileSync(
    path.join(root, "data", "processed", "nfl", "player_week_stats.csv"),
    [
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
      ].join(","),
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
      ].join(","),
    ].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  console.log("/backtest/week-1 stored-result — assertions");
  console.log("=============================================");

  // 1. Admin stored-backtest action writes the file mirror.
  {
    const r = makeReport("admin runner writes week-1-data-mode-status file");
    const repoRoot = makeTempRepo();
    seedReadyStored(repoRoot);
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      persistence: client,
    });
    check(r, result.ok === true, `stored-backtest ok=${result.ok}; status=${result.status}`);
    const filePath = path.join(
      repoRoot,
      "data",
      "backtests",
      "2025",
      "week-1-data-mode-status.fixture.json",
    );
    check(r, fs.existsSync(filePath), `file should exist at ${filePath}`);
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      check(r, parsed.dataMode === "stored", `dataMode=${parsed.dataMode}`);
      check(
        r,
        parsed.syntheticFixture === false,
        `syntheticFixture=${parsed.syntheticFixture}`,
      );
      check(
        r,
        parsed.realWeek1BacktestReady === true,
        `realReady=${parsed.realWeek1BacktestReady}`,
      );
      check(r, parsed.status === "READY", `status=${parsed.status}`);
      check(
        r,
        typeof parsed.candidateCount === "number" && parsed.candidateCount > 0,
        `candidateCount=${parsed.candidateCount}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — admin runner mirrors stored run to the file the page reads");
    else console.log("[1] FAIL — file mirror");
  }

  // 2. Stored snapshot loader sees the result with the SAME
  //    cwd the page would use. (loadStoredWeek1MonitorSnapshot
  //    falls back to file when DB is empty.)
  {
    const r = makeReport("page loader picks up the file mirror");
    const repoRoot = makeTempRepo();
    seedReadyStored(repoRoot);
    const client = inMemoryPersistenceClient();
    await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      persistence: client,
    });
    // The page reads from cwd, so chdir into the temp repo.
    const original = process.cwd();
    process.chdir(repoRoot);
    try {
      // Use a FRESH client (empty) so the loader falls back to
      // file — proves the file mirror is actually self-sufficient.
      const fileOnlyClient = inMemoryPersistenceClient();
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client: fileOnlyClient,
      });
      check(r, snap !== undefined, "snapshot must be defined");
      check(r, snap?.source === "file", `source=${snap?.source}`);
      check(
        r,
        snap?.realWeek1BacktestReady === true,
        `realReady=${snap?.realWeek1BacktestReady}`,
      );
      check(r, snap?.status === "READY", `status=${snap?.status}`);
      check(
        r,
        snap?.candidateCount === 1,
        `candidateCount=${snap?.candidateCount} (seed has 1 market)`,
      );
      check(r, snap?.missingStoredOdds === false, "missingStoredOdds must be false");
      check(
        r,
        snap?.missingProcessedNfl === false,
        "missingProcessedNfl must be false",
      );
      check(r, snap?.syntheticFixture === false, "syntheticFixture must be false");
    } finally {
      process.chdir(original);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — page loader reads the file mirror, DB-empty path");
    else console.log("[2] FAIL — file-mirror read");
  }

  // 3. DB-backed snapshot survives file deletion (post-redeploy
  //    state). The loader returns the run from Postgres so the
  //    page still shows READY without the file.
  {
    const r = makeReport("DB-backed snapshot survives file deletion");
    const repoRoot = makeTempRepo();
    seedReadyStored(repoRoot);
    const client = inMemoryPersistenceClient();
    await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      persistence: client,
    });
    // Simulate a Railway redeploy: blow away the file mirror.
    fs.rmSync(
      path.join(
        repoRoot,
        "data",
        "backtests",
        "2025",
        "week-1-data-mode-status.fixture.json",
      ),
    );
    const original = process.cwd();
    process.chdir(repoRoot);
    try {
      // Same persistence client (the one that recorded the run).
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(r, snap !== undefined, "snapshot must be defined post-redeploy");
      check(r, snap?.source === "postgres", `source=${snap?.source}`);
      check(
        r,
        snap?.realWeek1BacktestReady === true,
        "real ready survives redeploy",
      );
      check(r, snap?.syntheticFixture === false, "syntheticFixture must be false");
    } finally {
      process.chdir(original);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — DB survives Railway redeploy that wipes the file");
    else console.log("[3] FAIL — redeploy survival");
  }

  // 4. Fixture starter-test files do NOT override the stored
  //    result. We don't import the page (server component), so
  //    we test the loader directly: with a stored snapshot
  //    returned, the caller's `storedReady` would be true and
  //    the page demotes the synthetic-fixture banner.
  {
    const r = makeReport("fixture files do not override stored result");
    const repoRoot = makeTempRepo();
    // Pretend an old synthetic starter-test ran and left files
    // showing "Not real-week ready".
    fs.writeFileSync(
      path.join(
        repoRoot,
        "data",
        "backtests",
        "2025",
        "week-1-data-mode-status.fixture.json",
      ),
      JSON.stringify(
        {
          generatedAt: "2024-12-01T00:00:00Z",
          season: 2025,
          week: 1,
          dataMode: "fixture",
          status: "SYNTHETIC_ONLY",
          candidateCount: 0,
          syntheticFixture: true,
          realWeek1BacktestReady: false,
          missingStoredOdds: true,
          missingProcessedNfl: false,
          scheduleReport: null,
          notes: ["old synthetic"],
        },
        null,
        2,
      ),
    );
    const client = inMemoryPersistenceClient();
    // DB has a fresh successful stored run.
    await client.saveStoredBacktestRunToDb({
      season: 2025,
      week: 1,
      dataMode: "stored",
      status: "READY",
      realWeek1BacktestReady: true,
      scheduleValidationStatus: "PASS",
      syntheticFixture: false,
      candidatesJson: { candidates: new Array(290).fill({ id: "x" }) },
    });
    const original = process.cwd();
    process.chdir(repoRoot);
    try {
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(r, snap?.source === "postgres", `source=${snap?.source}`);
      check(
        r,
        snap?.realWeek1BacktestReady === true,
        "DB ready overrides file SYNTHETIC_ONLY",
      );
      check(r, snap?.candidateCount === 290, `candidateCount=${snap?.candidateCount}`);
      check(r, snap?.syntheticFixture === false, "syntheticFixture must be false");
    } finally {
      process.chdir(original);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — stored DB result wins over fixture files");
    else console.log("[4] FAIL — fixture override");
  }

  // 5. No banned hooks in the touched page code.
  {
    const r = makeReport("no banned hooks in week-1 page touched code");
    const text =
      readSrc("src/app/backtest/week-1/page.tsx") +
      "\n" +
      readSrc("src/app/monitor/page.tsx") +
      "\n" +
      readSrc("src/lib/backtest/week-1-monitor-summary.ts");
    for (const re of [
      /the-odds-api/i,
      /odds-api\.com/i,
      /placeBet|placeWager/i,
      /from\s+["'][^"']*kalshi[^"']*["']/i,
      /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
      /https?:\/\/[a-z0-9\-]+\.[a-z]+/i,
      /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
    ]) {
      check(r, !re.test(text), `touched code contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — no API / Kalshi / TD hooks");
    else console.log("[5] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 5 week-1-page-stored-result assertions passed.");
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
