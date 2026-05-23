/**
 * Admin run-season-stored-backtest action — assertions.
 *
 *   · runAdminAction("run-season-stored-backtest") routes to the
 *     season runner and returns the season aggregate report in
 *     the detail field.
 *   · Bounds checks: startWeek > endWeek and startWeek < 1
 *     short-circuit with ok=false rather than throwing.
 *   · The action invokes the per-week pipeline against actual
 *     stored data; in this test we surface the failure path that
 *     happens when no candidates can be built (no processed data
 *     in the temp repo root). Even the all-weeks-failed case
 *     returns ok=true with a season report — the operator sees
 *     what didn't grade rather than getting a blanket failure.
 *   · The API route accepts the new action + season/startWeek/
 *     endWeek body fields.
 *   · The admin client exposes the run button + week inputs.
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API call.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runAdminAction } from "../src/lib/admin/admin-runner";
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
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function makeEmptyRepoRoot(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "season-backtest-admin-"),
  );
  // No data/processed dir → candidate builder will return
  // MISSING_PROCESSED_NFL for every week. That's the failure
  // path we want to assert handles cleanly.
  return dir;
}

async function main(): Promise<void> {
  console.log("Admin run-season-stored-backtest — assertions");
  console.log("=============================================");

  // 1. Range validation: startWeek > endWeek returns ok=false
  //    with a clear summary.
  {
    const r = makeReport("invalid range rejected");
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "run-season-stored-backtest",
      persistence: client,
      season: 2025,
      startWeek: 5,
      endWeek: 2,
    });
    check(
      r,
      result.action === "run-season-stored-backtest",
      `action=${result.action}`,
    );
    check(r, result.ok === false, `ok=${result.ok}, expected false`);
    check(
      r,
      result.summary.toLowerCase().includes("invalid week range"),
      `summary should call out invalid range: "${result.summary}"`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — invalid range rejected");
    else console.log("[1] FAIL — invalid range");
  }

  // 2. Empty repo (no processed data) → every week fails its
  //    candidate build, but the action returns ok=true with a
  //    season report listing the failures. Operator-visible.
  {
    const r = makeReport("empty repo → all-weeks-failed report");
    const client = inMemoryPersistenceClient();
    const repoRoot = makeEmptyRepoRoot();
    try {
      const result = await runAdminAction({
        action: "run-season-stored-backtest",
        persistence: client,
        repoRoot,
        season: 2025,
        startWeek: 1,
        endWeek: 2,
      });
      check(
        r,
        result.ok === true,
        `ok=${result.ok} — read-only failure-summary success expected`,
      );
      check(
        r,
        result.summary.includes("graded 0/2"),
        `summary should report 0/2 graded: "${result.summary}"`,
      );
      check(
        r,
        result.summary.includes("failed"),
        `summary should mention failed weeks: "${result.summary}"`,
      );
      check(
        r,
        typeof result.detail === "string" &&
          result.detail.includes("=== SEASON SUMMARY ==="),
        "detail should include SEASON SUMMARY header",
      );
      check(
        r,
        typeof result.detail === "string" &&
          result.detail.includes("=== ROOKIE MISPRICING ANALYSIS ==="),
        "detail should include rookie analysis header",
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — empty repo produces failure-summary report");
    else console.log("[2] FAIL — empty repo");
  }

  // 3. endWeek auto-defaults to the highest week with a stored
  //    backtest row when omitted. With no rows, defaults to
  //    startWeek so the run is a single-week no-op.
  {
    const r = makeReport("endWeek auto-defaults");
    const client = inMemoryPersistenceClient();
    const repoRoot = makeEmptyRepoRoot();
    try {
      const result = await runAdminAction({
        action: "run-season-stored-backtest",
        persistence: client,
        repoRoot,
        season: 2025,
        startWeek: 1,
        // endWeek omitted on purpose
      });
      check(r, result.ok === true, `ok=${result.ok}`);
      check(
        r,
        result.summary.includes("W1-W1"),
        `summary should default endWeek=startWeek when no stored rows: "${result.summary}"`,
      );
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — endWeek auto-defaults");
    else console.log("[3] FAIL — endWeek default");
  }

  // 4. API route wires the new action.
  {
    const r = makeReport("API route accepts new action + season inputs");
    const src = readSrc("src/app/api/admin/ingestion/run/route.ts");
    check(
      r,
      src.includes('"run-season-stored-backtest"'),
      "API route must include run-season-stored-backtest in VALID_ACTIONS",
    );
    check(
      r,
      src.includes("startWeek") && src.includes("endWeek"),
      "API route must parse startWeek + endWeek body fields",
    );
    check(
      r,
      src.includes("season"),
      "API route must parse season body field",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — API route wires new action");
    else console.log("[4] FAIL — API route");
  }

  // 5. Admin client exposes the new section + button.
  {
    const r = makeReport("admin client exposes season backtest section");
    const src = readSrc("src/app/admin/ingestion/AdminIngestionClient.tsx");
    check(
      r,
      src.includes("run-season-stored-backtest"),
      "client must reference run-season-stored-backtest in ActionName",
    );
    check(
      r,
      src.includes("SeasonStoredBacktestSection"),
      "client must render SeasonStoredBacktestSection",
    );
    check(
      r,
      src.includes("admin-season-backtest-run-button"),
      "client must include data-testid for the run button",
    );
    check(
      r,
      src.includes("Run Season Stored Backtest"),
      "client must surface the spec's button label",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — admin client exposes section + button");
    else console.log("[5] FAIL — admin client");
  }

  // 6. No banned hooks in any touched module.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/lib/backtest/grade-stored-week-pipeline.ts",
      "src/lib/backtest/season-stored-backtest-runner.ts",
      "src/lib/backtest/season-aggregate-report.ts",
    ];
    const banned: RegExp[] = [
      /the-odds-api/i,
      /odds-api\.com/i,
      /placeBet|placeWager/,
      /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
      /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
    ];
    for (const file of files) {
      const src = readSrc(file);
      for (const pattern of banned) {
        check(
          r,
          !pattern.test(src),
          `${file} contains banned token matching ${pattern}`,
        );
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — no banned hooks");
    else console.log("[6] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 6 / 6 SCENARIOS PASSED");
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
