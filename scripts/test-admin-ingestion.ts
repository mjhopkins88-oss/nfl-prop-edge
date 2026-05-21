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

  // 14. run-nflverse-ingestion runs WITHOUT requiring
  //     ALLOW_REAL_ODDS_API_CALLS or ODDS_API_KEY.
  {
    const r = makeReport("run-nflverse-ingestion runs without paid env");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout:
        "nflverse ingest — seasons 2024, 2025, source=nflverse, dryRun=false\n" +
        "fetched 8 files. Falling through to normalize + write.\n" +
        "normalized: 570 games, 12588 player-weeks, 0 team-weeks, 1967 roster entries, 0 snap rows\n" +
        "written:\n" +
        `  ${path.join(repoRoot, "data/processed/nfl/games.csv")}\n` +
        `  ${path.join(repoRoot, "data/processed/nfl/player_week_stats.csv")}\n` +
        `  ${path.join(repoRoot, "data/processed/nfl/rosters.csv")}\n` +
        "  skipped: team_week_stats.csv (no rows)\n" +
        "  skipped: snap_counts.csv (none)\n",
      stderr: "",
      timedOut: false,
      durationMs: 1000,
    });
    const result = await withEnvAsync(
      {
        ALLOW_REAL_ODDS_API_CALLS: undefined,
        ODDS_API_KEY: undefined,
      },
      () =>
        runAdminAction({
          action: "run-nflverse-ingestion",
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, result.ok === true, `ok=${result.ok}, status=${result.status}`);
    check(
      r,
      spawner.calls.length === 1,
      `expected one spawn call, got ${spawner.calls.length}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[14] PASS — nflverse ingestion runs without paid env");
    else console.log("[14] FAIL — nflverse without paid env");
  }

  // 15. nflverse spec passes ALLOW_NFLVERSE_NETWORK_FETCH=true
  //     but never ALLOW_REAL_ODDS_API_CALLS=true.
  {
    const r = makeReport("nflverse spec env: flips only the nflverse flag");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "normalized: 1 games, 1 player-weeks, 0 team-weeks, 1 roster entries, 0 snap rows\nwritten:\n",
      stderr: "",
      timedOut: false,
      durationMs: 10,
    });
    // Even if the parent process happens to have ALLOW_REAL_ODDS_API_CALLS
    // or ODDS_API_KEY set, the runner must STRIP them before spawning the
    // free nflverse subprocess.
    await withEnvAsync(
      {
        ALLOW_REAL_ODDS_API_CALLS: "true",
        ODDS_API_KEY: "sk-should-never-be-forwarded",
      },
      () =>
        runAdminAction({
          action: "run-nflverse-ingestion",
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    const env = spawner.calls[0]?.env ?? {};
    check(
      r,
      env.ALLOW_NFLVERSE_NETWORK_FETCH === "true",
      `ALLOW_NFLVERSE_NETWORK_FETCH should be 'true', got ${env.ALLOW_NFLVERSE_NETWORK_FETCH}`,
    );
    check(
      r,
      env.ALLOW_REAL_ODDS_API_CALLS === undefined,
      `ALLOW_REAL_ODDS_API_CALLS must be stripped, got ${env.ALLOW_REAL_ODDS_API_CALLS}`,
    );
    check(
      r,
      env.ODDS_API_KEY === undefined,
      "ODDS_API_KEY must be stripped from the child env",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[15] PASS — nflverse env: flag-only, paid env stripped");
    else console.log("[15] FAIL — nflverse env");
  }

  // 16. nflverse spec argv is a closed list with no --execute,
  //     no shell metachars, no arbitrary command path.
  {
    const r = makeReport("nflverse spec argv shape");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "normalized: 0 games, 0 player-weeks, 0 team-weeks, 0 roster entries, 0 snap rows\nwritten:\n",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    await runAdminAction({
      action: "run-nflverse-ingestion",
      repoRoot,
      spawner: spawner.fn,
    });
    const spec = spawner.calls[0];
    check(r, Array.isArray(spec.args), "args must be an array (no shell)");
    check(
      r,
      spec.args.includes("--source") && spec.args.includes("nflverse"),
      "must include --source nflverse",
    );
    check(
      r,
      spec.args.includes("--no-dry-run"),
      "must include --no-dry-run (actually write)",
    );
    check(
      r,
      !spec.args.includes("--execute"),
      "must NOT include --execute (that's an Odds API flag)",
    );
    check(
      r,
      !spec.args.some((a) => /the-odds-api|odds-api\.com/i.test(a)),
      "must not reference any Odds API endpoint in args",
    );
    check(
      r,
      !spec.args.some((a) => /[;&|`$()<>]/.test(a)),
      "no shell metachars in args",
    );
    check(
      r,
      typeof spec.command === "string" && spec.command.endsWith("tsx"),
      `command should be the tsx binary, got ${spec.command}`,
    );
    check(
      r,
      spec.args.some((a) => a.endsWith("ingest-nfl-history.ts")),
      "must invoke ingest-nfl-history.ts (whitelisted), not arbitrary script",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[16] PASS — nflverse argv is a whitelisted closed list");
    else console.log("[16] FAIL — nflverse argv shape");
  }

  // 17. Result file is written with the expected non-secret shape.
  {
    const r = makeReport("nflverse result file shape");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout:
        "normalized: 570 games, 12588 player-weeks, 0 team-weeks, 1967 roster entries, 0 snap rows\n" +
        "written:\n" +
        `  ${path.join(repoRoot, "data/processed/nfl/games.csv")}\n` +
        `  ${path.join(repoRoot, "data/processed/nfl/player_week_stats.csv")}\n`,
      stderr: "",
      timedOut: false,
      durationMs: 1234,
    });
    const before = Date.now();
    const res = await runAdminAction({
      action: "run-nflverse-ingestion",
      repoRoot,
      spawner: spawner.fn,
    });
    check(r, res.ok === true, `action should succeed, got status=${res.status}`);
    const filePath = path.join(
      repoRoot,
      "data",
      "admin-ingestion",
      "latest-nflverse-ingestion.json",
    );
    check(r, fs.existsSync(filePath), `result file should exist at ${filePath}`);
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      check(
        r,
        parsed.action === "run-nflverse-ingestion",
        `action field: ${parsed.action}`,
      );
      check(
        r,
        parsed.paidApiCallAttempted === false,
        "paidApiCallAttempted must be false",
      );
      check(
        r,
        parsed.guardrails?.noOddsApiCall === true,
        "guardrails.noOddsApiCall must be true",
      );
      check(
        r,
        parsed.guardrails?.noTouchdownProps === true,
        "guardrails.noTouchdownProps must be true",
      );
      check(
        r,
        parsed.guardrails?.noAutomatedBetting === true,
        "guardrails.noAutomatedBetting must be true",
      );
      check(
        r,
        Array.isArray(parsed.outputFilesWritten) &&
          parsed.outputFilesWritten.length === 2,
        `outputFilesWritten count=${parsed.outputFilesWritten?.length}`,
      );
      check(
        r,
        parsed.rowsProcessed?.games === 570 &&
          parsed.rowsProcessed?.playerWeekStats === 12588,
        "rowsProcessed parsed from normalized line",
      );
      check(
        r,
        typeof parsed.startedAt === "string" && typeof parsed.finishedAt === "string",
        "startedAt + finishedAt are strings",
      );
      check(
        r,
        Date.parse(parsed.startedAt) >= before - 1000,
        "startedAt is recent",
      );
      // No secret values must leak into the result file.
      const raw = fs.readFileSync(filePath, "utf8");
      check(r, !/ODDS_API_KEY/.test(raw), "no ODDS_API_KEY token in result file");
      check(r, !/ADMIN_INGEST_TOKEN/.test(raw), "no ADMIN_INGEST_TOKEN in result file");
      check(r, !/sk-/.test(raw), "no sk- key prefix in result file");
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[17] PASS — nflverse result file shape + no secrets");
    else console.log("[17] FAIL — nflverse result file");
  }

  // 18. Even with nflverse action available, paid actions remain
  //     blocked when ALLOW_REAL_ODDS_API_CALLS is unset.
  {
    const r = makeReport("paid actions remain blocked alongside the new action");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    // Trigger the new action successfully...
    await withEnvAsync({ ALLOW_REAL_ODDS_API_CALLS: undefined }, () =>
      runAdminAction({
        action: "run-nflverse-ingestion",
        repoRoot,
        spawner: spawner.fn,
      }),
    );
    // ...then verify paid-smoke still refuses.
    const smoke = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: undefined, ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: PAID_SMOKE_CONFIRM_TEXT,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, smoke.status === "skipped", `paid-smoke status=${smoke.status}`);
    // Spawner saw exactly the nflverse call — not the smoke call.
    check(
      r,
      spawner.calls.length === 1,
      `spawner should only be called once (nflverse), got ${spawner.calls.length}`,
    );
    check(
      r,
      spawner.calls[0].args.some((a) => a.endsWith("ingest-nfl-history.ts")),
      "the one call should be the nflverse script",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[18] PASS — paid actions still blocked alongside nflverse action");
    else console.log("[18] FAIL — paid gating regressed");
  }

  // 19. paid-smoke spawns the calibration argv (--calibration,
  //     --max-odds-requests 1, --max-credits 50).
  {
    const r = makeReport("paid-smoke uses calibration argv by default");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout:
        "Dry-run complete. Estimated credits: 41 (budget 50).\n" +
        "Done. Credits estimated=41 actual=41 remaining=950 budget=50. Usage log: x\n",
      stderr: "",
      timedOut: false,
      durationMs: 10,
    });
    await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: PAID_SMOKE_CONFIRM_TEXT,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    const call = spawner.calls[0];
    check(r, call.args.includes("--calibration"), "must pass --calibration");
    const moIdx = call.args.indexOf("--max-odds-requests");
    check(
      r,
      moIdx >= 0 && call.args[moIdx + 1] === "1",
      `must pass --max-odds-requests 1, got ${call.args[moIdx + 1]}`,
    );
    const mcIdx = call.args.indexOf("--max-credits");
    check(
      r,
      mcIdx >= 0 && call.args[mcIdx + 1] === "50",
      `must pass --max-credits 50, got ${call.args[mcIdx + 1]}`,
    );
    check(r, call.args.includes("--execute"), "must include --execute");
    record(r);
    if (r.reasons.length === 0)
      console.log("[19] PASS — paid-smoke argv defaults to calibration (1 odds, 50 credits)");
    else console.log("[19] FAIL — paid-smoke calibration argv");
  }

  // 20. Failed paid-smoke records lastPaidSmokeCreditsUsed AND
  //     does NOT unlock Week 1 paid ingestion.
  {
    const r = makeReport("failed smoke records credits, leaves Week 1 locked");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      // Reproduces the 2026-05 abort log line — runner parses 41
      // out of the cumulative-actual figure.
      exitCode: 4,
      stdout:
        "2026-05-21T00:00:00.000Z ERROR ABORT mid-run: actual credits 41 exceed estimate 5 by >10% (cap 5.5)\n",
      stderr: "",
      timedOut: false,
      durationMs: 50,
    });
    const fail = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: PAID_SMOKE_CONFIRM_TEXT,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, fail.status === "failure", `status=${fail.status}`);
    check(r, fail.creditsUsed === 41, `creditsUsed=${fail.creditsUsed}`);
    const state = readAdminState(repoRoot);
    check(
      r,
      state.lastPaidSmokeResult === "failure",
      `lastPaidSmokeResult=${state.lastPaidSmokeResult}`,
    );
    check(
      r,
      state.lastPaidSmokeCreditsUsed === 41,
      `lastPaidSmokeCreditsUsed=${state.lastPaidSmokeCreditsUsed}`,
    );
    check(
      r,
      hasPriorSmokeSuccess(repoRoot) === false,
      "smoke success must NOT be recorded after a failed smoke",
    );
    // Confirm Week 1 paid ingestion remains locked.
    const week1 = await withEnvAsync(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-week1",
          confirmText: PAID_WEEK1_CONFIRM_TEXT,
          repoRoot,
          spawner: spawner.fn,
        }),
    );
    check(r, week1.status === "skipped", `week1 status=${week1.status}`);
    check(
      r,
      (week1.reason ?? "").toLowerCase().includes("smoke"),
      `week1 reason should cite smoke prerequisite, got: ${week1.reason}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[20] PASS — failed smoke records credits, Week 1 stays locked");
    else console.log("[20] FAIL — failed-smoke state");
  }

  // 21. parseIngestionOutput extracts cumulative credits from the
  //     pre-call abort line too.
  {
    const r = makeReport("output parser extracts credits from abort lines");
    const overage = parseIngestionOutput(
      "2026-05-21T00:00:00.000Z ERROR ABORT mid-run: actual credits 41 exceed estimate 5 by >10% (cap 5.5)\n",
    );
    check(r, overage.creditsUsed === 41, `overage creditsUsed=${overage.creditsUsed}`);
    const precall = parseIngestionOutput(
      "2026-05-21T00:00:00.000Z ERROR ABORT before request: projected cumulative actual 81 would exceed --max-credits 50\n",
    );
    check(
      r,
      precall.creditsUsed === 81,
      `precall creditsUsed=${precall.creditsUsed}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[21] PASS — parser extracts cumulative credits from aborts");
    else console.log("[21] FAIL — abort-line parser");
  }

  // 22. dry-run uses the same calibration shape as paid-smoke
  //     but with --dry-run instead of --execute. Without this,
  //     the preview falls through to the full-Week-1 plan (647
  //     credits) and the up-front budget guard refuses it.
  {
    const r = makeReport("dry-run argv mirrors paid-smoke calibration");
    const repoRoot = makeTempRepo();
    const spawner = recordingSpawner({
      exitCode: 0,
      stdout: "Dry-run complete. Estimated credits: 41 (budget 50).\n",
      stderr: "",
      timedOut: false,
      durationMs: 10,
    });
    const result = await runAdminAction({
      action: "dry-run",
      repoRoot,
      spawner: spawner.fn,
    });
    check(r, result.ok === true, `dry-run ok=${result.ok}`);
    check(
      r,
      spawner.calls.length === 1,
      `expected one spawn call, got ${spawner.calls.length}`,
    );
    const spec = spawner.calls[0];
    check(r, spec.args.includes("--calibration"), "argv must include --calibration");
    const moIdx = spec.args.indexOf("--max-odds-requests");
    check(
      r,
      moIdx >= 0 && spec.args[moIdx + 1] === "1",
      `must pass --max-odds-requests 1, got ${spec.args[moIdx + 1]}`,
    );
    const mcIdx = spec.args.indexOf("--max-credits");
    check(
      r,
      mcIdx >= 0 && spec.args[mcIdx + 1] === "50",
      `must pass --max-credits 50, got ${spec.args[mcIdx + 1]}`,
    );
    check(r, spec.args.includes("--dry-run"), "argv must include --dry-run");
    check(
      r,
      !spec.args.includes("--execute"),
      "argv must NOT include --execute (dry-run only)",
    );
    check(
      r,
      spec.env.ALLOW_REAL_ODDS_API_CALLS === undefined ||
        spec.env.ALLOW_REAL_ODDS_API_CALLS !== "true",
      "dry-run must not inject ALLOW_REAL_ODDS_API_CALLS=true",
    );
    check(
      r,
      typeof result.data?.estimatedCredits === "number" &&
        (result.data.estimatedCredits as number) <= 50,
      `parsed estimate must be ≤ 50, got ${result.data?.estimatedCredits}`,
    );
    check(
      r,
      result.summary.includes("41") || result.summary.includes("dry-run"),
      `summary should mention parsed estimate, got: ${result.summary}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[22] PASS — dry-run argv = calibration shape with --dry-run");
    else console.log("[22] FAIL — dry-run calibration argv");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 22 admin-ingestion assertions passed.");
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
