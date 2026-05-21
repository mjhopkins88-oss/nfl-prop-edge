/**
 * Admin ingestion safety + dispatch assertions.
 *
 *   · token verification (missing / wrong / right / timing-safe)
 *   · paid actions refuse without ALLOW_REAL_ODDS_API_CALLS=true
 *   · paid actions refuse without ODDS_API_KEY
 *   · paid smoke refuses unless confirmText is exactly
 *     "RUN PAID SMOKE TEST"
 *   · paid Week 1 refuses unless confirmText is exactly
 *     "RUN WEEK 1 PAID INGESTION"
 *   · paid Week 1 refuses unless smokeSucceededAt exists
 *   · readiness-check and stored-backtest never spawn anything
 *   · subprocess specs use a fixed argv list — no shell, no
 *     user-input interpolation, never an "execute via /bin/sh"
 *     path
 *   · the route handlers, runner, and state module contain no
 *     secret values, no touchdown propTypes, no automated
 *     betting / Kalshi hooks
 *   · the status route's JSON shape carries booleans + safe
 *     fields only (no env-var values)
 *
 * Pure file IO + module import. No network. No spawn. No paid
 * call ever attempted — every action is exercised via an
 * injected spawner stub.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ADMIN_INGEST_TOKEN_ENV,
  ADMIN_TOKEN_HEADER,
  isAdminTokenConfigured,
  readAdminTokenFromHeaders,
  verifyAdminToken,
} from "../src/lib/admin/admin-auth";
import {
  PAID_SMOKE_CONFIRM_TEXT,
  PAID_WEEK1_CONFIRM_TEXT,
  parseIngestionOutput,
  runAdminAction,
  type SubprocessResult,
  type SubprocessRunner,
  type SubprocessSpec,
} from "../src/lib/admin/admin-runner";
import {
  hasPriorSmokeSuccess,
  readAdminState,
  recordSmokeSuccess,
} from "../src/lib/admin/admin-state";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nfl-prop-edge-admin-"));
  // Re-create the parts of the tree the runner touches.
  fs.mkdirSync(path.join(dir, "data", "admin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "processed", "nfl"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "processed", "odds", "2025"), {
    recursive: true,
  });
  return dir;
}

function recordingSpawner(out: SubprocessResult): {
  fn: SubprocessRunner;
  calls: SubprocessSpec[];
} {
  const calls: SubprocessSpec[] = [];
  return {
    calls,
    fn: async (spec) => {
      calls.push(spec);
      return out;
    },
  };
}

function withEnv<T>(
  vars: Record<string, string | undefined>,
  body: () => T,
): T {
  const original: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    original[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return body();
  } finally {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

async function withEnvAsync<T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    original[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await body();
  } finally {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

async function main(): Promise<void> {
  console.log("admin ingestion — assertions");
  console.log("=============================");

  // 1. Token: missing / wrong / right / non-configured.
  {
    const r = makeReport("verifyAdminToken behaviour");
    await withEnvAsync({ [ADMIN_INGEST_TOKEN_ENV]: undefined }, async () => {
      check(
        r,
        isAdminTokenConfigured() === false,
        "isAdminTokenConfigured should be false when env unset",
      );
      check(
        r,
        verifyAdminToken("anything") === false,
        "verifyAdminToken should reject when env unset",
      );
    });
    await withEnvAsync({ [ADMIN_INGEST_TOKEN_ENV]: "s3cr3t-token-value" }, async () => {
      check(r, isAdminTokenConfigured() === true, "configured=true");
      check(r, verifyAdminToken(null) === false, "null token rejected");
      check(r, verifyAdminToken("") === false, "empty token rejected");
      check(r, verifyAdminToken("wrong") === false, "wrong token rejected");
      check(
        r,
        verifyAdminToken("s3cr3t-token-value") === true,
        "correct token accepted",
      );
      check(
        r,
        verifyAdminToken("s3cr3t-token-valu") === false,
        "shorter token rejected (length-mismatch path)",
      );
    });
    record(r);
    if (r.reasons.length === 0) console.log("[1] PASS — token verification");
    else console.log("[1] FAIL — token verification");
  }

  // 2. Header extraction.
  {
    const r = makeReport("readAdminTokenFromHeaders");
    const headers = new Headers({ [ADMIN_TOKEN_HEADER]: "abc" });
    check(r, readAdminTokenFromHeaders(headers) === "abc", "header read OK");
    const empty = new Headers();
    check(r, readAdminTokenFromHeaders(empty) === null, "missing header → null");
    record(r);
    if (r.reasons.length === 0) console.log("[2] PASS — header extraction");
    else console.log("[2] FAIL — header extraction");
  }

  // 3. paid-smoke refused without ALLOW_REAL_ODDS_API_CALLS.
  {
    const r = makeReport("paid-smoke refuses without ALLOW_REAL_ODDS_API_CALLS");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    const result = await withEnvAsync(
      {
        ALLOW_REAL_ODDS_API_CALLS: undefined,
        ODDS_API_KEY: "sk-test",
      },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: PAID_SMOKE_CONFIRM_TEXT,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, result.status === "skipped", `status=${result.status}`);
    check(r, !result.ok, "ok should be false");
    check(
      r,
      spawner.calls.length === 0,
      `spawner should not be called, got ${spawner.calls.length}`,
    );
    check(
      r,
      (result.reason ?? "").includes("ALLOW_REAL_ODDS_API_CALLS"),
      `reason should cite the env gate, got: ${result.reason}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — paid-smoke refuses without env gate");
    else console.log("[3] FAIL — paid-smoke env gate");
  }

  // 4. paid-smoke refused without ODDS_API_KEY.
  {
    const r = makeReport("paid-smoke refuses without ODDS_API_KEY");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    const result = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: undefined },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: PAID_SMOKE_CONFIRM_TEXT,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, result.status === "skipped", `status=${result.status}`);
    check(r, spawner.calls.length === 0, "spawner not called");
    check(
      r,
      (result.reason ?? "").includes("ODDS_API_KEY"),
      `reason should cite ODDS_API_KEY, got: ${result.reason}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — paid-smoke refuses without ODDS_API_KEY");
    else console.log("[4] FAIL — paid-smoke ODDS_API_KEY gate");
  }

  // 5. paid-smoke refused with wrong confirmText.
  {
    const r = makeReport("paid-smoke refuses with wrong / missing confirmText");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    const wrong = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: "run paid smoke test",
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, wrong.status === "skipped", `wrong status=${wrong.status}`);
    check(r, spawner.calls.length === 0, "spawner not called (wrong text)");
    const missing = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: undefined,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, missing.status === "skipped", `missing status=${missing.status}`);
    check(
      r,
      spawner.calls.length === 0,
      `spawner not called (missing text), got ${spawner.calls.length}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — paid-smoke confirmText must be exact");
    else console.log("[5] FAIL — paid-smoke confirmText");
  }

  // 6. paid-week1 refused without prior smoke success.
  {
    const r = makeReport("paid-week1 refuses without prior smoke success");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    check(
      r,
      hasPriorSmokeSuccess(repoRoot) === false,
      "smoke success should start false",
    );
    const result = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-week1",
          confirmText: PAID_WEEK1_CONFIRM_TEXT,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, result.status === "skipped", `status=${result.status}`);
    check(r, spawner.calls.length === 0, "spawner not called");
    check(
      r,
      (result.reason ?? "").toLowerCase().includes("smoke"),
      `reason should mention smoke prerequisite, got: ${result.reason}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — paid-week1 requires prior smoke success");
    else console.log("[6] FAIL — paid-week1 smoke prerequisite");
  }

  // 7. paid-week1 also refuses on wrong confirmText.
  {
    const r = makeReport("paid-week1 refuses with wrong confirmText");
    const repoRoot = makeTempRepo();
    // Pre-seed a smoke success.
    recordSmokeSuccess({ creditsUsed: 1, repoRoot });
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    const result = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-week1",
          confirmText: "RUN PAID SMOKE TEST",
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, result.status === "skipped", `status=${result.status}`);
    check(r, spawner.calls.length === 0, "spawner not called");
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — paid-week1 confirmText is exact-match");
    else console.log("[7] FAIL — paid-week1 confirmText");
  }

  // 8. paid-smoke with all gates passing spawns the right argv.
  {
    const r = makeReport("paid-smoke spawn argv is a closed, no-shell list");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "Done. Credits estimated=1 actual=1 remaining=999 budget=200. Usage log: x",
      stderr: "",
      timedOut: false,
      durationMs: 10,
    });
    const result = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: PAID_SMOKE_CONFIRM_TEXT,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, result.ok === true, `ok=${result.ok}; status=${result.status}`);
    check(r, spawner.calls.length === 1, `one spawn call expected, got ${spawner.calls.length}`);
    const call = spawner.calls[0];
    check(
      r,
      Array.isArray(call.args),
      "args must be an array (spawn-style, not shell-style)",
    );
    check(
      r,
      call.args.includes("--execute"),
      "smoke must pass --execute to the ingest script",
    );
    check(
      r,
      call.args.includes("--scope") && call.args.includes("smoke-test"),
      "smoke must use --scope smoke-test",
    );
    check(
      r,
      !call.args.some((a) => /[;&|`$()<>]/.test(a)),
      "no shell metacharacters allowed in the args list",
    );
    check(
      r,
      typeof call.command === "string" && call.command.endsWith("tsx"),
      `command should be a tsx binary, got: ${call.command}`,
    );
    check(
      r,
      result.creditsUsed === 1 && result.creditsRemaining === 999,
      `credits parsed: used=${result.creditsUsed} rem=${result.creditsRemaining}`,
    );
    check(
      r,
      hasPriorSmokeSuccess(repoRoot) === true,
      "smoke success should have been recorded",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — paid-smoke spawns a clean argv and records success");
    else console.log("[8] FAIL — paid-smoke spawn");
  }

  // 9. readiness-check and stored-backtest never spawn.
  {
    const r = makeReport("readiness-check / stored-backtest never spawn");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    const r1 = await runAdminAction({
      action: "readiness-check",
      repoRoot,
      spawner: spawner.fn,
    });
    check(r, r1.ok === true, "readiness-check ok");
    const r2 = await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      spawner: spawner.fn,
    });
    // stored-backtest may not be ready in a temp repo — that's fine, we just
    // assert no subprocess was launched.
    check(
      r,
      r2.status === "success" || r2.status === "failure",
      `stored-backtest returned ${r2.status}`,
    );
    check(
      r,
      spawner.calls.length === 0,
      `expected zero spawn calls, got ${spawner.calls.length}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — pure actions don't spawn");
    else console.log("[9] FAIL — pure actions spawned");
  }

  // 10. Output parser handles success line.
  {
    const r = makeReport("parseIngestionOutput extracts credits");
    const p = parseIngestionOutput(
      "Some prelude\nDone. Credits estimated=4 actual=4 remaining=996 budget=200. Usage log: x\n",
    );
    check(r, p.creditsUsed === 4, `creditsUsed=${p.creditsUsed}`);
    check(r, p.creditsRemaining === 996, `creditsRemaining=${p.creditsRemaining}`);
    const dry = parseIngestionOutput("Dry-run complete. Estimated credits: 71 (budget 200).\n");
    check(r, dry.estimatedCredits === 71, `estimated=${dry.estimatedCredits}`);
    check(r, dry.budget === 200, `budget=${dry.budget}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — output parser extracts credit fields");
    else console.log("[10] FAIL — output parser");
  }

  // 11. Source files contain no banned hooks / secret echoes /
  //     touchdown markets / Kalshi place / automated betting.
  {
    const r = makeReport("source files: no banned content");
    const files = [
      "src/lib/admin/admin-auth.ts",
      "src/lib/admin/admin-state.ts",
      "src/lib/admin/admin-runner.ts",
      "src/app/api/admin/ingestion/status/route.ts",
      "src/app/api/admin/ingestion/run/route.ts",
      "src/app/admin/ingestion/page.tsx",
      "src/app/admin/ingestion/AdminIngestionClient.tsx",
    ];
    const banned: RegExp[] = [
      /placeBet|placeWager/i,
      // Real Kalshi integration patterns — imports, client/place calls.
      // The literal word "Kalshi" in user-facing copy ("No Kalshi.")
      // is allowed and intentional.
      /from\s+["'][^"']*kalshi[^"']*["']/i,
      /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
      /the-odds-api/i,
      /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|RUSH_TD|REC_TD|PASS_TD/,
      /child_process.*exec\(/, // exec / execSync would allow shell injection
      /execSync/,
      /\bshell:\s*true\b/, // spawn({ shell: true }) bypass
      // The token + key values must never appear in JSON-string templates:
      /process\.env\.ADMIN_INGEST_TOKEN[\s\S]{0,40}stringify/i,
      /process\.env\.ODDS_API_KEY[\s\S]{0,40}stringify/i,
    ];
    for (const f of files) {
      const text = readSrc(f);
      for (const re of banned) {
        check(r, !re.test(text), `${f} contains banned pattern ${re}`);
      }
    }
    // Stronger: the status route returns booleans for these env
    // checks, never values. Verify by string check.
    const statusRoute = readSrc("src/app/api/admin/ingestion/status/route.ts");
    check(
      r,
      !statusRoute.includes("process.env.ODDS_API_KEY"),
      "status route must not read the key value directly into JSON",
    );
    check(
      r,
      !statusRoute.includes("process.env.ADMIN_INGEST_TOKEN"),
      "status route must not read the token value directly into JSON",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[11] PASS — no banned hooks / secrets / touchdowns in admin code");
    else console.log("[11] FAIL — banned content");
  }

  // 12. Confirm strings are the exact constants the user spec'd.
  {
    const r = makeReport("confirmText constants are exact");
    check(
      r,
      PAID_SMOKE_CONFIRM_TEXT === "RUN PAID SMOKE TEST",
      `smoke const: ${PAID_SMOKE_CONFIRM_TEXT}`,
    );
    check(
      r,
      PAID_WEEK1_CONFIRM_TEXT === "RUN WEEK 1 PAID INGESTION",
      `week1 const: ${PAID_WEEK1_CONFIRM_TEXT}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[12] PASS — confirmText constants match spec");
    else console.log("[12] FAIL — confirmText constants");
  }

  // 13. state file lives under data/admin and isn't mistakenly
  //     persisting the token / key.
  {
    const r = makeReport("admin state file content + location");
    const repoRoot = makeTempRepo();
    recordSmokeSuccess({ creditsUsed: 7, repoRoot });
    const state = readAdminState(repoRoot);
    check(r, state.smokeSucceededAt !== undefined, "smokeSucceededAt set");
    check(r, state.smokeCreditsUsed === 7, "smokeCreditsUsed recorded");
    const raw = fs.readFileSync(
      path.join(repoRoot, "data", "admin", "ingestion-state.json"),
      "utf8",
    );
    check(r, !/ADMIN_INGEST_TOKEN/.test(raw), "raw state must not name the token env");
    check(r, !/ODDS_API_KEY/.test(raw), "raw state must not name the key env");
    record(r);
    if (r.reasons.length === 0)
      console.log("[13] PASS — state file is non-secret and lives under data/admin");
    else console.log("[13] FAIL — state file");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 13 admin-ingestion assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

void withEnv({}, () => main());
