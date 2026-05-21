/**
 * Multi-week admin actions assertions.
 *
 *   · paidSubsetConfirmText(N) and paidFullConfirmText(N, C)
 *     produce the dynamic confirmation strings the UI shows.
 *   · Week 1 dynamic strings match the legacy hardcoded
 *     constants — no Week 1 behaviour change.
 *   · SUPPORTED_PAID_INGESTION_WEEKS includes Weeks 1-6.
 *   · paid-week-subset / paid-week-full reject calls missing the
 *     correct confirmText for the supplied week.
 *   · paid-week-subset / paid-week-full reject unsupported weeks.
 *   · grade-week-stored routes through the same Week-1 grading
 *     workflow with `week` parameterized.
 *   · migrate-odds-to-canonical accepts a `week` body field.
 *   · stored-backtest accepts a `week` body field and writes
 *     the per-week status file.
 *   · Admin UI lists the new action names + the multi-week
 *     selector + the per-week status block.
 *   · No banned hooks anywhere (Odds API, Kalshi, automated
 *     betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API call.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  paidSubsetConfirmText,
  paidFullConfirmText,
  SUPPORTED_PAID_INGESTION_WEEKS,
  estimatedFullCreditsForWeek,
  PAID_WEEK1_SUBSET_CONFIRM_TEXT,
  PAID_WEEK1_CONFIRM_TEXT,
  runAdminAction,
} from "../src/lib/admin/admin-runner";
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

async function main(): Promise<void> {
  console.log("Multi-week admin actions — assertions");
  console.log("=====================================");

  // 1. Dynamic confirmation text generators.
  {
    const r = makeReport("dynamic confirmation text");
    check(
      r,
      paidSubsetConfirmText(1) === "RUN WEEK 1 SUBSET INGESTION",
      `subset(1)=${paidSubsetConfirmText(1)}`,
    );
    check(
      r,
      paidSubsetConfirmText(3) === "RUN WEEK 3 SUBSET INGESTION",
      `subset(3)=${paidSubsetConfirmText(3)}`,
    );
    check(
      r,
      paidFullConfirmText(1, 647) === "RUN FULL WEEK 1 INGESTION 647 CREDITS",
      `full(1,647)=${paidFullConfirmText(1, 647)}`,
    );
    check(
      r,
      paidFullConfirmText(4, 647) === "RUN FULL WEEK 4 INGESTION 647 CREDITS",
      `full(4,647)=${paidFullConfirmText(4, 647)}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — dynamic confirmation text");
    else console.log("[1] FAIL — confirmation text");
  }

  // 2. Week 1 dynamic strings equal the legacy hardcoded
  //    constants — no Week 1 behaviour change.
  {
    const r = makeReport("Week 1 strings match legacy constants");
    check(
      r,
      paidSubsetConfirmText(1) === PAID_WEEK1_SUBSET_CONFIRM_TEXT,
      `subset(1) drift: ${paidSubsetConfirmText(1)} vs ${PAID_WEEK1_SUBSET_CONFIRM_TEXT}`,
    );
    check(
      r,
      paidFullConfirmText(1, 647) === PAID_WEEK1_CONFIRM_TEXT,
      `full(1) drift: ${paidFullConfirmText(1, 647)} vs ${PAID_WEEK1_CONFIRM_TEXT}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — Week 1 strings unchanged");
    else console.log("[2] FAIL — Week 1 drift");
  }

  // 3. SUPPORTED_PAID_INGESTION_WEEKS includes Weeks 1-6.
  {
    const r = makeReport("SUPPORTED_PAID_INGESTION_WEEKS includes 1..6");
    for (const w of [1, 2, 3, 4, 5, 6]) {
      check(
        r,
        SUPPORTED_PAID_INGESTION_WEEKS.includes(w),
        `week ${w} missing from SUPPORTED_PAID_INGESTION_WEEKS`,
      );
    }
    check(
      r,
      estimatedFullCreditsForWeek(2) > 0,
      "credit estimate for week 2 must be > 0",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — Weeks 1..6 supported");
    else console.log("[3] FAIL — supported weeks");
  }

  // 4. paid-week-subset rejects wrong confirmText for week 2.
  {
    const r = makeReport("paid-week-subset wrong confirm rejected");
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "paid-week-subset",
      week: 2,
      confirmText: "RUN WEEK 1 SUBSET INGESTION", // wrong week
      persistence: client,
      spawner: async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      }),
    });
    check(
      r,
      result.status === "skipped" || !result.ok,
      `result should not run — got status=${result.status} ok=${result.ok}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — wrong-week confirm rejected");
    else console.log("[4] FAIL — wrong-week confirm");
  }

  // 5. paid-week-full rejects unsupported week 99.
  {
    const r = makeReport("paid-week-full rejects unsupported week");
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "paid-week-full",
      week: 99,
      confirmText: paidFullConfirmText(99, 647),
      persistence: client,
      spawner: async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      }),
    });
    check(r, !result.ok, `unsupported week should fail (got ok=${result.ok})`);
    check(
      r,
      result.summary.toLowerCase().includes("unsupported"),
      `summary should mention unsupported: ${result.summary}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — unsupported-week rejected");
    else console.log("[5] FAIL — unsupported week");
  }

  // 6. grade-week-stored accepts a week parameter and reports
  //    the correct action name in the result.
  {
    const r = makeReport("grade-week-stored uses provided week");
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "grade-week-stored",
      week: 3,
      persistence: client,
    });
    // No stored data locally → expected to fail with a candidate-
    // builder status. The important assertion is that the action
    // name flowed through correctly and the failure mentions
    // "week 3".
    check(
      r,
      result.action === "grade-week-stored",
      `action=${result.action}`,
    );
    check(
      r,
      result.summary.includes("week 3") || result.summary.includes("Week 3"),
      `summary should mention week 3: ${result.summary}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — grade-week-stored routes through week 3");
    else console.log("[6] FAIL — grade-week-stored");
  }

  // 7. migrate-odds-to-canonical accepts a week parameter
  //    without crashing.
  {
    const r = makeReport("migrate-odds-to-canonical accepts week");
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "migrate-odds-to-canonical",
      week: 2,
      persistence: client,
    });
    check(
      r,
      result.action === "migrate-odds-to-canonical",
      `action=${result.action}`,
    );
    // Locally no legacy file for week 2 — expect ok=false but a
    // structured result, not a crash.
    check(
      r,
      typeof result.ok === "boolean",
      `result must be a structured AdminActionResult`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — migrate week parameter accepted");
    else console.log("[7] FAIL — migrate week");
  }

  // 8. stored-backtest accepts a week parameter and writes the
  //    per-week status file. Sandboxed in a tmp repoRoot so the
  //    test does not leak files into the real repo.
  {
    const r = makeReport("stored-backtest writes per-week status file");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "multi-week-admin-"));
    try {
      const client = inMemoryPersistenceClient();
      const result = await runAdminAction({
        action: "stored-backtest",
        week: 4,
        persistence: client,
        repoRoot: tmp,
      });
      check(r, result.action === "stored-backtest", `action=${result.action}`);
      const expectedFile = path.join(
        tmp,
        "data",
        "backtests",
        "2025",
        "week-4-data-mode-status.fixture.json",
      );
      check(
        r,
        fs.existsSync(expectedFile),
        `expected status file ${expectedFile} to exist`,
      );
      if (fs.existsSync(expectedFile)) {
        const text = fs.readFileSync(expectedFile, "utf8");
        check(
          r,
          text.includes('"week": 4'),
          "status file must record week: 4",
        );
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — stored-backtest week 4 writes per-week file");
    else console.log("[8] FAIL — stored-backtest week");
  }

  // 9. Admin client UI exposes the new action names + multi-
  //    week selector + per-week status block.
  {
    const r = makeReport("admin UI exposes multi-week section");
    const text = readSrc("src/app/admin/ingestion/AdminIngestionClient.tsx");
    check(
      r,
      /"paid-week-subset"/.test(text),
      "ActionName must include paid-week-subset",
    );
    check(
      r,
      /"paid-week-full"/.test(text),
      "ActionName must include paid-week-full",
    );
    check(
      r,
      /"grade-week-stored"/.test(text),
      "ActionName must include grade-week-stored",
    );
    check(
      r,
      /data-testid="admin-multi-week-select"/.test(text),
      "must render the week selector dropdown",
    );
    check(
      r,
      /Paid Ingestion by Week/.test(text),
      "must render the paid-ingestion section heading",
    );
    check(
      r,
      /Week Processing Pipeline/.test(text),
      "must render the pipeline section heading",
    );
    check(
      r,
      /No stored odds for Week \{statusForWeek\.week\} yet/.test(text),
      "must render the 'no stored odds' fallback per week",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — admin UI exposes new sections");
    else console.log("[9] FAIL — admin UI");
  }

  // 10. /api/admin/ingestion/run accepts the new actions and
  //    a week body field. /api/admin/ingestion/status returns
  //    selectedWeek when ?week= is supplied.
  {
    const r = makeReport("API routes accept week parameter");
    const runText = readSrc("src/app/api/admin/ingestion/run/route.ts");
    check(
      r,
      /paid-week-subset/.test(runText) && /paid-week-full/.test(runText) && /grade-week-stored/.test(runText),
      "run route VALID_ACTIONS must include the new actions",
    );
    check(
      r,
      /week:\s*\(body as.*week\?:\s*unknown\}\)\?\.week|weekRaw\b/.test(runText),
      "run route must parse week from body",
    );
    const statusText = readSrc("src/app/api/admin/ingestion/status/route.ts");
    check(
      r,
      /searchParams\.get\("week"\)/.test(statusText),
      "status route must read ?week= query",
    );
    check(
      r,
      /selectedWeek/.test(statusText),
      "status route must expose selectedWeek in payload",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — API routes accept week");
    else console.log("[10] FAIL — API routes");
  }

  // 11. No banned hooks across the touched files.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/lib/admin/admin-runner.ts",
      "src/lib/admin/admin-state.ts",
      "src/app/admin/ingestion/AdminIngestionClient.tsx",
      "src/app/api/admin/ingestion/run/route.ts",
      "src/app/api/admin/ingestion/status/route.ts",
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
    if (r.reasons.length === 0) console.log("[11] PASS — no banned hooks");
    else console.log("[11] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 11 multi-week-admin assertions passed.");
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
