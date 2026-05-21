/**
 * Dispatcher for the admin ingestion page's five actions.
 *
 *   1. readiness-check   — pure read of the existing checker.
 *   2. dry-run           — spawn the prop-line ingest script in
 *                          --dry-run mode (no API call).
 *   3. paid-smoke        — gated subprocess: requires
 *                          ALLOW_REAL_ODDS_API_CALLS=true,
 *                          ODDS_API_KEY, and confirmText.
 *   4. paid-week1        — same gates as paid-smoke PLUS a
 *                          recorded prior smoke success.
 *   5. stored-backtest   — pure call into the candidate builder.
 *
 * The subprocess command list is a fixed closed set — no string
 * interpolation of user input, no shell. The only env vars
 * forwarded to children are the inherited process.env plus a
 * trimmed view (we never echo the API key or admin token back to
 * the client).
 *
 * No paid call happens unless the action is `paid-*` AND every
 * gate passes. The runner refuses to spawn otherwise.
 *
 * No model logic. No automated betting. No touchdown props.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { buildReadinessReport } from "../../../scripts/check-real-week-1-readiness";
import { buildRealWeek1CandidatesFromStoredData } from "../backtest/real-week-candidate-builder";
import {
  hasPriorSmokeSuccess,
  recordActionResult,
  recordSmokeSuccess,
  recordWeek1Success,
  type AdminAction,
} from "./admin-state";

export const PAID_SMOKE_CONFIRM_TEXT = "RUN PAID SMOKE TEST";
export const PAID_WEEK1_CONFIRM_TEXT = "RUN WEEK 1 PAID INGESTION";

export interface AdminActionResult {
  action: AdminAction;
  ok: boolean;
  /** "success" / "failure" / "skipped" — recorded into state. */
  status: "success" | "failure" | "skipped";
  /** Short, page-friendly headline (no secrets). */
  summary: string;
  /** Multi-line detail safe to surface in the UI (no secrets). */
  detail?: string;
  /** Structured payload — kept compact, no raw HTTP bodies. */
  data?: Record<string, unknown>;
  /** Reason for skip / failure (for the user). */
  reason?: string;
  /** Credits consumed when the script reports a number. */
  creditsUsed?: number;
  /** Credits remaining as last seen in headers — best-effort. */
  creditsRemaining?: number | null;
}

export interface AdminRunArgs {
  action: AdminAction;
  /** Required for paid actions; ignored otherwise. */
  confirmText?: string;
  /** Repo root override for tests. */
  repoRoot?: string;
  /** Injected for tests; defaults to a real spawn-based runner. */
  spawner?: SubprocessRunner;
}

export interface SubprocessSpec {
  command: string;
  args: string[];
  /** Subset of env vars we want the child to see. */
  env: NodeJS.ProcessEnv;
  /** Hard cap; the runner kills the child if it exceeds. */
  timeoutMs: number;
  /** Subprocess working directory. */
  cwd: string;
}

export interface SubprocessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export type SubprocessRunner = (spec: SubprocessSpec) => Promise<SubprocessResult>;

// ---- precondition helpers ---------------------------------------------

export function isAllowRealOddsCalls(): boolean {
  return process.env.ALLOW_REAL_ODDS_API_CALLS === "true";
}

export function isOddsApiKeyConfigured(): boolean {
  const k = process.env.ODDS_API_KEY;
  return typeof k === "string" && k.length > 0;
}

// ---- real subprocess runner -------------------------------------------

function defaultTsxBin(repoRoot: string): string {
  return path.join(repoRoot, "node_modules", ".bin", "tsx");
}

const realSubprocessRunner: SubprocessRunner = async (spec) => {
  const started = Date.now();
  return new Promise<SubprocessResult>((resolve) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Give it a moment to exit cleanly before SIGKILL.
      setTimeout(() => child.kill("SIGKILL"), 2_000);
    }, spec.timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: stderr + `\nspawn error: ${(err as Error).message}`,
        timedOut: false,
        durationMs: Date.now() - started,
      });
    });
  });
};

// ---- output parsers ---------------------------------------------------

const CREDITS_DONE_RE =
  /Done\.\s+Credits\s+estimated=(\d+)\s+actual=(\d+)\s+remaining=([\d?]+)/;
const ESTIMATED_RE = /Estimated credits:\s+(\d+)\s+\(budget\s+(\d+)\)/;
const NORMALIZED_RE =
  /normalized:\s+(\d+)\s+games,\s+(\d+)\s+player-weeks,\s+(\d+)\s+team-weeks,\s+(\d+)\s+roster entries,\s+(\d+)\s+snap rows/;
const WRITTEN_LINE_RE = /^\s+(.*data[/\\]processed[/\\]nfl[/\\][^\s]+\.csv)\s*$/gm;
const SKIPPED_LINE_RE = /^\s+skipped:\s+([^\s]+\.csv)\s*\(([^)]+)\)\s*$/gm;

interface ParsedCredits {
  creditsUsed?: number;
  creditsRemaining?: number | null;
  estimatedCredits?: number;
  budget?: number;
}

export function parseIngestionOutput(stdout: string): ParsedCredits {
  const out: ParsedCredits = {};
  const m1 = CREDITS_DONE_RE.exec(stdout);
  if (m1) {
    out.creditsUsed = Number(m1[2]);
    out.creditsRemaining = m1[3] === "?" ? null : Number(m1[3]);
  }
  const m2 = ESTIMATED_RE.exec(stdout);
  if (m2) {
    out.estimatedCredits = Number(m2[1]);
    out.budget = Number(m2[2]);
  }
  return out;
}

interface ParsedNflverseOutput {
  outputFilesWritten: string[];
  outputFilesSkipped: { name: string; reason: string }[];
  rowsProcessed?: {
    games: number;
    playerWeekStats: number;
    teamWeekStats: number;
    rosters: number;
    snapCounts: number;
  };
}

export function parseNflverseIngestionOutput(stdout: string): ParsedNflverseOutput {
  const out: ParsedNflverseOutput = {
    outputFilesWritten: [],
    outputFilesSkipped: [],
  };
  WRITTEN_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WRITTEN_LINE_RE.exec(stdout)) !== null) {
    out.outputFilesWritten.push(m[1]);
  }
  SKIPPED_LINE_RE.lastIndex = 0;
  while ((m = SKIPPED_LINE_RE.exec(stdout)) !== null) {
    out.outputFilesSkipped.push({ name: m[1], reason: m[2] });
  }
  const norm = NORMALIZED_RE.exec(stdout);
  if (norm) {
    out.rowsProcessed = {
      games: Number(norm[1]),
      playerWeekStats: Number(norm[2]),
      teamWeekStats: Number(norm[3]),
      rosters: Number(norm[4]),
      snapCounts: Number(norm[5]),
    };
  }
  return out;
}

const NFLVERSE_RESULT_FILE = path.join(
  "data",
  "admin-ingestion",
  "latest-nflverse-ingestion.json",
);

function writeNflverseResultFile(args: {
  repoRoot: string;
  startedAt: string;
  finishedAt: string;
  status: "success" | "failure";
  parsed: ParsedNflverseOutput;
  errorMessage?: string;
}): string {
  const target = path.join(args.repoRoot, NFLVERSE_RESULT_FILE);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const payload = {
    action: "run-nflverse-ingestion",
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    status: args.status,
    paidApiCallAttempted: false,
    outputFilesWritten: args.parsed.outputFilesWritten,
    outputFilesSkipped: args.parsed.outputFilesSkipped,
    rowsProcessed: args.parsed.rowsProcessed ?? null,
    errorMessage: args.errorMessage ?? null,
    guardrails: {
      noOddsApiCall: true,
      noTouchdownProps: true,
      noAutomatedBetting: true,
    },
  };
  fs.writeFileSync(target, JSON.stringify(payload, null, 2) + "\n");
  return target;
}

// ---- per-action argv builders (fixed lists, no user input) ------------

function ingestScriptPath(repoRoot: string): string {
  return path.join(repoRoot, "scripts", "ingest-historical-prop-lines.ts");
}

function nflverseScriptPath(repoRoot: string): string {
  return path.join(repoRoot, "scripts", "ingest-nfl-history.ts");
}

function gamesCsvPath(repoRoot: string): string {
  return path.join(repoRoot, "data", "processed", "nfl", "games.csv");
}

/**
 * Free public nflverse ingestion. Forwards
 * ALLOW_NFLVERSE_NETWORK_FETCH=true to the child but explicitly
 * strips ALLOW_REAL_ODDS_API_CALLS and ODDS_API_KEY — even if
 * those happen to be set in the parent process — so this action
 * can never accidentally trip the paid path.
 */
function buildNflverseIngestionSpec(repoRoot: string): SubprocessSpec {
  const parentEnv = { ...process.env };
  delete parentEnv.ALLOW_REAL_ODDS_API_CALLS;
  delete parentEnv.ODDS_API_KEY;
  return {
    command: defaultTsxBin(repoRoot),
    args: [
      nflverseScriptPath(repoRoot),
      "--seasons",
      "2024,2025",
      "--source",
      "nflverse",
      "--no-dry-run",
    ],
    env: { ...parentEnv, ALLOW_NFLVERSE_NETWORK_FETCH: "true" },
    timeoutMs: 300_000,
    cwd: repoRoot,
  };
}

function buildDryRunSpec(repoRoot: string): SubprocessSpec {
  return {
    command: defaultTsxBin(repoRoot),
    args: [
      ingestScriptPath(repoRoot),
      "--season",
      "2025",
      "--scope",
      "smoke-test",
      "--source",
      "csv",
      "--input",
      gamesCsvPath(repoRoot),
      "--dry-run",
    ],
    env: { ...process.env },
    timeoutMs: 60_000,
    cwd: repoRoot,
  };
}

function buildPaidSmokeSpec(repoRoot: string): SubprocessSpec {
  return {
    command: defaultTsxBin(repoRoot),
    args: [
      ingestScriptPath(repoRoot),
      "--season",
      "2025",
      "--scope",
      "smoke-test",
      "--source",
      "csv",
      "--input",
      gamesCsvPath(repoRoot),
      "--execute",
    ],
    env: { ...process.env, ALLOW_REAL_ODDS_API_CALLS: "true" },
    timeoutMs: 120_000,
    cwd: repoRoot,
  };
}

function buildPaidWeek1Spec(repoRoot: string): SubprocessSpec {
  return {
    command: defaultTsxBin(repoRoot),
    args: [
      ingestScriptPath(repoRoot),
      "--season",
      "2025",
      "--scope",
      "week",
      "--week",
      "1",
      "--source",
      "csv",
      "--input",
      gamesCsvPath(repoRoot),
      "--execute",
    ],
    env: { ...process.env, ALLOW_REAL_ODDS_API_CALLS: "true" },
    timeoutMs: 600_000,
    cwd: repoRoot,
  };
}

// ---- the dispatcher ---------------------------------------------------

export async function runAdminAction(
  args: AdminRunArgs,
): Promise<AdminActionResult> {
  const repoRoot = args.repoRoot ?? process.cwd();
  const spawner = args.spawner ?? realSubprocessRunner;

  switch (args.action) {
    case "readiness-check": {
      const report = buildReadinessReport({
        season: 2025,
        week: 1,
        repoRoot,
      });
      const result: AdminActionResult = {
        action: "readiness-check",
        ok: true,
        status: "success",
        summary: `${report.status} — realWeek1BacktestReady=${report.realWeek1BacktestReady}`,
        data: {
          status: report.status,
          realWeek1BacktestReady: report.realWeek1BacktestReady,
          missingStoredOdds: report.missingStoredOdds,
          missingProcessedNfl: report.missingProcessedNfl,
          storedBuilderStatus: report.storedBuilderStatus,
          missingFiles: report.missingFiles,
          nextCommandRequiresPaidApi: report.nextCommandRequiresPaidApi,
        },
      };
      recordActionResult({
        action: "readiness-check",
        result: "success",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "run-nflverse-ingestion": {
      const startedAt = new Date().toISOString();
      const sub = await spawner(buildNflverseIngestionSpec(repoRoot));
      const finishedAt = new Date().toISOString();
      const parsed = parseNflverseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const errorMessage = ok
        ? undefined
        : sub.timedOut
          ? "nflverse ingestion timed out"
          : `nflverse ingestion failed with exit ${sub.exitCode}`;
      const resultPath = writeNflverseResultFile({
        repoRoot,
        startedAt,
        finishedAt,
        status: ok ? "success" : "failure",
        parsed,
        errorMessage,
      });
      const fileCount = parsed.outputFilesWritten.length;
      const result: AdminActionResult = {
        action: "run-nflverse-ingestion",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `nflverse ingestion OK. Wrote ${fileCount} processed file(s)${
              parsed.rowsProcessed
                ? `; ${parsed.rowsProcessed.games} games, ${parsed.rowsProcessed.playerWeekStats} player-weeks`
                : ""
            }.`
          : errorMessage!,
        detail: truncateForUi(sub.stdout, sub.stderr),
        data: {
          outputFilesWritten: parsed.outputFilesWritten,
          outputFilesSkipped: parsed.outputFilesSkipped,
          rowsProcessed: parsed.rowsProcessed,
          resultFile: resultPath,
          paidApiCallAttempted: false,
        },
      };
      recordActionResult({
        action: "run-nflverse-ingestion",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "dry-run": {
      const sub = await spawner(buildDryRunSpec(repoRoot));
      const parsed = parseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const result: AdminActionResult = {
        action: "dry-run",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `Dry-run OK. Estimated credits: ${parsed.estimatedCredits ?? "?"} (budget ${parsed.budget ?? "?"}).`
          : sub.timedOut
            ? "Dry-run timed out."
            : `Dry-run failed with exit ${sub.exitCode}.`,
        detail: truncateForUi(sub.stdout, sub.stderr),
        data: { estimatedCredits: parsed.estimatedCredits, budget: parsed.budget },
        creditsUsed: 0,
      };
      recordActionResult({
        action: "dry-run",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "paid-smoke": {
      const gate = checkPaidGates({
        confirmText: args.confirmText,
        expectedConfirm: PAID_SMOKE_CONFIRM_TEXT,
        requirePriorSmoke: false,
        repoRoot,
      });
      if (gate) return recordSkip("paid-smoke", gate, repoRoot);
      const sub = await spawner(buildPaidSmokeSpec(repoRoot));
      const parsed = parseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const result: AdminActionResult = {
        action: "paid-smoke",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `Smoke OK. Credits used=${parsed.creditsUsed ?? "?"} remaining=${parsed.creditsRemaining ?? "?"}.`
          : sub.timedOut
            ? "Smoke timed out."
            : `Smoke failed with exit ${sub.exitCode}.`,
        detail: truncateForUi(sub.stdout, sub.stderr),
        data: {
          creditsUsed: parsed.creditsUsed,
          creditsRemaining: parsed.creditsRemaining,
        },
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
      };
      if (ok) {
        recordSmokeSuccess({ creditsUsed: parsed.creditsUsed, repoRoot });
      }
      recordActionResult({
        action: "paid-smoke",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "paid-week1": {
      const gate = checkPaidGates({
        confirmText: args.confirmText,
        expectedConfirm: PAID_WEEK1_CONFIRM_TEXT,
        requirePriorSmoke: true,
        repoRoot,
      });
      if (gate) return recordSkip("paid-week1", gate, repoRoot);
      const sub = await spawner(buildPaidWeek1Spec(repoRoot));
      const parsed = parseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const result: AdminActionResult = {
        action: "paid-week1",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `Week 1 ingestion OK. Credits used=${parsed.creditsUsed ?? "?"} remaining=${parsed.creditsRemaining ?? "?"}.`
          : sub.timedOut
            ? "Week 1 ingestion timed out."
            : `Week 1 ingestion failed with exit ${sub.exitCode}.`,
        detail: truncateForUi(sub.stdout, sub.stderr),
        data: {
          creditsUsed: parsed.creditsUsed,
          creditsRemaining: parsed.creditsRemaining,
        },
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
      };
      if (ok) recordWeek1Success(repoRoot);
      recordActionResult({
        action: "paid-week1",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "stored-backtest": {
      const r = buildRealWeek1CandidatesFromStoredData({
        season: 2025,
        week: 1,
      });
      const ok = r.status === "READY";
      const result: AdminActionResult = {
        action: "stored-backtest",
        ok,
        status: ok ? "success" : "failure",
        summary: `${r.status} — ${r.candidates.length} candidates`,
        detail: r.notes.join("\n"),
        data: {
          status: r.status,
          candidateCount: r.candidates.length,
          scheduleReportStatus: r.scheduleReport?.status,
        },
      };
      recordActionResult({
        action: "stored-backtest",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    default: {
      const unknown = args.action satisfies never;
      throw new Error(`Unknown admin action: ${String(unknown)}`);
    }
  }
}

// ---- gates + helpers --------------------------------------------------

function checkPaidGates(args: {
  confirmText?: string;
  expectedConfirm: string;
  requirePriorSmoke: boolean;
  repoRoot: string;
}): string | undefined {
  if (!isAllowRealOddsCalls()) {
    return "ALLOW_REAL_ODDS_API_CALLS is not 'true'. Paid actions disabled.";
  }
  if (!isOddsApiKeyConfigured()) {
    return "ODDS_API_KEY is not configured in this environment.";
  }
  if (args.confirmText !== args.expectedConfirm) {
    return `confirmText must be exactly: ${args.expectedConfirm}`;
  }
  if (args.requirePriorSmoke && !hasPriorSmokeSuccess(args.repoRoot)) {
    return "Paid smoke test must succeed before Week 1 paid ingestion.";
  }
  return undefined;
}

function recordSkip(
  action: AdminAction,
  reason: string,
  repoRoot: string,
): AdminActionResult {
  const result: AdminActionResult = {
    action,
    ok: false,
    status: "skipped",
    summary: `Skipped: ${reason}`,
    reason,
  };
  recordActionResult({
    action,
    result: "skipped",
    summary: result.summary,
    repoRoot,
  });
  return result;
}

const UI_OUTPUT_TAIL_BYTES = 4000;

function truncateForUi(stdout: string, stderr: string): string {
  const tail = (s: string): string =>
    s.length <= UI_OUTPUT_TAIL_BYTES
      ? s
      : `…(${s.length - UI_OUTPUT_TAIL_BYTES} bytes truncated)…\n` +
        s.slice(-UI_OUTPUT_TAIL_BYTES);
  return ["--- stdout ---", tail(stdout), "--- stderr ---", tail(stderr)].join(
    "\n",
  );
}

// ---- side-effect helper used by the status endpoint ------------------

/**
 * Inspect the canonical and legacy stored-odds paths. Mirrors
 * the readiness checker's view so the status panel agrees.
 */
export function inspectStoredWeek1OddsOnDisk(repoRoot?: string): {
  canonical: { path: string; present: boolean };
  legacy: { path: string; present: boolean };
} {
  const root = repoRoot ?? process.cwd();
  const canonical = path.join(
    root,
    "data",
    "processed",
    "odds",
    "2025",
    "week-1-prop-markets.csv",
  );
  const legacy = path.join(root, "data", "processed", "prop_markets.csv");
  return {
    canonical: { path: canonical, present: fs.existsSync(canonical) },
    legacy: { path: legacy, present: fs.existsSync(legacy) },
  };
}
