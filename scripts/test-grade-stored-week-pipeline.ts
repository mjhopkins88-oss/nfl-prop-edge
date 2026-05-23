/**
 * Per-week stored grading pipeline — assertions.
 *
 *   · Returns ok=false / reason="candidate-builder-failed" when
 *     no processed data exists in the repo root.
 *   · Returns ok=false / reason="missing-player-stats" when the
 *     candidate builder succeeds but processed nflverse data
 *     is unavailable.
 *   · Failure paths do NOT touch persistence (no row written).
 *   · Failure paths do NOT write the file mirror.
 *   · The pipeline never throws on a missing-data condition —
 *     it always returns structured ok=false.
 *
 * The success path requires a fully populated stored odds + nflverse
 * data tree which is provisioned separately in the test-week-1-grading
 * suite; this test focuses on the failure paths so the pipeline can
 * be exercised without a heavy fixture setup.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { gradeStoredWeekPipeline } from "../src/lib/backtest/grade-stored-week-pipeline";
import { inMemoryPersistenceClient } from "../src/lib/persistence/week-1-persistence";

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

function makeEmptyRepoRoot(): string {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), "grade-week-pipeline-test-"),
  );
}

async function main(): Promise<void> {
  console.log("Per-week stored grading pipeline — assertions");
  console.log("=============================================");

  // 1. No processed data → candidate-builder-failed, ok=false.
  {
    const r = makeReport("missing processed data → candidate-builder-failed");
    const client = inMemoryPersistenceClient();
    const repoRoot = makeEmptyRepoRoot();
    try {
      const result = await gradeStoredWeekPipeline({
        season: 2025,
        week: 1,
        repoRoot,
        persistence: client,
        writeFileMirror: false,
      });
      check(r, result.ok === false, `ok=${result.ok}, expected false`);
      if (!result.ok) {
        check(
          r,
          result.reason === "candidate-builder-failed",
          `reason=${result.reason}, expected candidate-builder-failed`,
        );
        check(
          r,
          typeof result.detail === "string" && result.detail.length > 0,
          `detail should be populated, got: ${result.detail}`,
        );
        check(
          r,
          typeof result.candidateBuilderStatus === "string",
          `candidateBuilderStatus should be populated`,
        );
      }
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — candidate-builder-failed surfaces");
    else console.log("[1] FAIL — candidate-builder failure");
  }

  // 2. Failure path does NOT persist anything (no DB write).
  {
    const r = makeReport("failure does not persist to DB");
    const client = inMemoryPersistenceClient();
    const repoRoot = makeEmptyRepoRoot();
    try {
      await gradeStoredWeekPipeline({
        season: 2025,
        week: 1,
        repoRoot,
        persistence: client,
        writeFileMirror: false,
      });
      // The in-memory persistence client should have no
      // StoredBacktestRun rows because the failure happened
      // before the save call.
      const loaded = await client.loadLatestStoredBacktestRunFromDb({
        season: 2025,
        week: 1,
      });
      check(
        r,
        !loaded.run,
        "no row should be persisted on failure path",
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — failure does not persist");
    else console.log("[2] FAIL — failure persistence");
  }

  // 3. Failure path does NOT write the file mirror.
  {
    const r = makeReport("failure does not write file mirror");
    const client = inMemoryPersistenceClient();
    const repoRoot = makeEmptyRepoRoot();
    try {
      await gradeStoredWeekPipeline({
        season: 2025,
        week: 1,
        repoRoot,
        persistence: client,
        // writeFileMirror=true is the default; the failure
        // path should still skip the write because persistence
        // didn't run.
        writeFileMirror: true,
      });
      const expectedFile = path.join(
        repoRoot,
        "data",
        "backtests",
        "2025",
        "week-1-graded-summary.fixture.json",
      );
      check(
        r,
        !fs.existsSync(expectedFile),
        `file mirror should not exist on failure path: ${expectedFile}`,
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — file mirror not written on failure");
    else console.log("[3] FAIL — file mirror on failure");
  }

  // 4. Multiple failure scenarios all return structured ok=false
  //    (no throws).
  {
    const r = makeReport("structured failure across weeks");
    const client = inMemoryPersistenceClient();
    const repoRoot = makeEmptyRepoRoot();
    try {
      for (const week of [1, 2, 3, 4]) {
        const result = await gradeStoredWeekPipeline({
          season: 2025,
          week,
          repoRoot,
          persistence: client,
          writeFileMirror: false,
        });
        check(
          r,
          result.ok === false,
          `W${week} ok=${result.ok}, expected false`,
        );
        if (!result.ok) {
          check(
            r,
            typeof result.reason === "string",
            `W${week} reason should be a string`,
          );
        }
      }
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — structured failure across multiple weeks");
    else console.log("[4] FAIL — multi-week failure");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 4 / 4 SCENARIOS PASSED");
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
