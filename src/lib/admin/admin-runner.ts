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
  gradeStoredWeek1Backtest,
  buildScorecardAudit,
} from "../backtest/week-1-grading";
import { buildMarketContextCalibration } from "../backtest/market-context-calibration";
import {
  validateAsOfFairness,
  formatAsOfReport,
} from "../backtest/as-of-validation";
import { loadProcessedPlayerWeekStatsStrict } from "../backtest/processed-nfl-loader";
import {
  applyScorecardToCandidates,
  buildPlayerHistoryByName,
} from "../backtest/stored-candidate-scorecard";
import {
  buildCanonicalOddsRows,
  canonicalMarketsPath,
  migrateLegacyToCanonical,
} from "../ingestion/canonical-odds-writer";
import {
  getPersistenceClient,
  rehydrateCanonicalOddsFromDbIfMissing,
  type PersistenceClient,
} from "../persistence/week-1-persistence";
import { getExpectedWeek1Schedule } from "../backtest/week-1-schedule-validation";
import {
  normalizeTeamAbbreviation,
  validateCanonicalOddsGameIds,
} from "../backtest/week-1-game-id-mapper";
import { parseCsvRows } from "../ingestion/nflverse";
import {
  hasPriorSmokeSuccess,
  recordActionResult,
  recordPaidSmokeAttempt,
  recordSmokeSuccess,
  recordWeek1Success,
  recordWeek1SubsetSuccess,
  type AdminAction,
} from "./admin-state";

export const PAID_SMOKE_CONFIRM_TEXT = "RUN PAID SMOKE TEST";
export const PAID_WEEK1_SUBSET_CONFIRM_TEXT = "RUN WEEK 1 SUBSET INGESTION";
/**
 * Full Week 1 carries the 647-credit estimate in the confirmation
 * itself — the user has to type the number, not just a label.
 * Anyone copy/pasting from the audit doc has to acknowledge the
 * specific cost.
 */
export const PAID_WEEK1_CONFIRM_TEXT =
  "RUN FULL WEEK 1 INGESTION 647 CREDITS";

/** Hard-coded per-action credit ceilings. Never user-provided. */
export const ADMIN_PAID_SMOKE_MAX_CREDITS = 50;
export const ADMIN_WEEK1_SUBSET_MAX_CREDITS = 175;
export const ADMIN_WEEK1_SUBSET_MAX_ODDS_REQUESTS = 4;
export const ADMIN_WEEK1_FULL_MAX_CREDITS = 700;

/** Dynamic subset confirmation text per week. Week 1 returns
 *  the legacy string so existing callers keep working. */
export function paidSubsetConfirmText(week: number): string {
  return `RUN WEEK ${week} SUBSET INGESTION`;
}

/** Dynamic full-ingestion confirmation text per week. The
 *  credit estimate is included in the string so the operator
 *  has to type the number, not just a label. Week 1 reuses
 *  the audited 647-credit estimate to keep legacy strings
 *  identical. */
export function paidFullConfirmText(week: number, estimatedCredits: number): string {
  return `RUN FULL WEEK ${week} INGESTION ${estimatedCredits} CREDITS`;
}

/** Per-week estimated credit cost for the FULL ingestion.
 *  Week 1 = 647 (audited). Other weeks use the same default
 *  pending audit. Operators see this number in the
 *  confirmation text and must type it exactly. */
export const FULL_INGESTION_ESTIMATED_CREDITS_BY_WEEK: Record<number, number> = {
  1: 647,
  2: 647,
  3: 647,
  4: 647,
  5: 647,
  6: 647,
};

export function estimatedFullCreditsForWeek(week: number): number {
  return FULL_INGESTION_ESTIMATED_CREDITS_BY_WEEK[week] ?? 647;
}

/** Allow-list for the generic any-week paid actions. Adding
 *  new weeks to this list is the only required step to extend
 *  past Week 6 — every action handler reads `args.week` and
 *  pipes it through to the existing ingestion script. */
export const SUPPORTED_PAID_INGESTION_WEEKS: readonly number[] = [
  1, 2, 3, 4, 5, 6,
];

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
  /** Target week (1-18). Required for the generic
   *  `paid-week-subset`, `paid-week-full`, and
   *  `grade-week-stored` actions. Defaults to 1 elsewhere so
   *  legacy Week 1 callers keep working unchanged. */
  week?: number;
  /** Repo root override for tests. */
  repoRoot?: string;
  /** Injected for tests; defaults to a real spawn-based runner. */
  spawner?: SubprocessRunner;
  /** Injected for tests; defaults to the lazily-resolved Prisma
   *  client (or the null client when DATABASE_URL is unset). */
  persistence?: PersistenceClient;
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
const ABORT_OVERAGE_RE =
  /ABORT mid-run:\s*actual credits\s+(\d+)\s+exceed estimate/;
const ABORT_PRECALL_RE =
  /ABORT before request:\s*projected cumulative actual\s+(\d+)/;
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
  // When the run aborted, surface the cumulative credits used at
  // the abort point. Both abort paths log a number we can pick up.
  if (out.creditsUsed === undefined) {
    const aOver = ABORT_OVERAGE_RE.exec(stdout);
    if (aOver) out.creditsUsed = Number(aOver[1]);
  }
  if (out.creditsUsed === undefined) {
    const aPre = ABORT_PRECALL_RE.exec(stdout);
    if (aPre) out.creditsUsed = Number(aPre[1]);
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

// ---- per-paid-action result-file writers ------------------------------

const WEEK1_SUBSET_RESULT_FILE = path.join(
  "data",
  "admin-ingestion",
  "latest-odds-week1-subset-paid.json",
);
const WEEK1_FULL_RESULT_FILE = path.join(
  "data",
  "admin-ingestion",
  "latest-odds-week1-full-paid.json",
);

/** Parse the `Wrote {path} (N rows)` lines emitted by the
 *  prop-line script's live mode. */
const WROTE_LINE_RE = /Wrote\s+(.+?)\s+\((\d+)\s+rows\)/g;
function parseWrittenOutputFiles(stdout: string): string[] {
  const out: string[] = [];
  WROTE_LINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WROTE_LINE_RE.exec(stdout)) !== null) out.push(m[1]);
  return out;
}

interface OddsRunResultArgs {
  repoRoot: string;
  resultFile: string;
  action: AdminAction;
  startedAt: string;
  finishedAt: string;
  status: "success" | "failure";
  parsed: ParsedCredits;
  outputFilesWritten: string[];
  /** True when the canonical Week 1 markets file is on disk after
   *  the run. The current ingest script writes to the legacy flat
   *  paths; this surfaces whether the canonical path is up-to-date. */
  canonicalWeek1MarketsFileUpdated: boolean;
  errorMessage?: string;
  maxCreditsCap: number;
  confirmText: string;
}

function writeOddsRunResultFile(args: OddsRunResultArgs): string {
  const target = path.join(args.repoRoot, args.resultFile);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const payload = {
    action: args.action,
    startedAt: args.startedAt,
    finishedAt: args.finishedAt,
    status: args.status,
    paidApiCallAttempted: true,
    creditsEstimated: args.parsed.estimatedCredits ?? null,
    creditsUsed: args.parsed.creditsUsed ?? null,
    creditsRemaining:
      args.parsed.creditsRemaining === undefined
        ? null
        : args.parsed.creditsRemaining,
    budgetCeiling: args.maxCreditsCap,
    confirmText: args.confirmText,
    outputFilesWritten: args.outputFilesWritten,
    canonicalWeek1MarketsFileUpdated: args.canonicalWeek1MarketsFileUpdated,
    errorMessage: args.errorMessage ?? null,
    guardrails: {
      noTouchdownProps: true,
      noAutomatedBetting: true,
      noKalshiIntegration: true,
      starterMarketsOnly: true,
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
  // Mirror the paid-smoke calibration argv exactly — same season,
  // scope, source, calibration ceiling, --max-odds-requests, and
  // --max-credits — but use --dry-run instead of --execute. The
  // dry-run preview must show the cost of what the paid button
  // would actually do; otherwise the page reports 647 credits
  // (the full-Week-1 plan) and the up-front budget guard refuses
  // before any preview can render.
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
      "--calibration",
      "--max-odds-requests",
      "1",
      "--max-credits",
      "50",
      "--dry-run",
    ],
    env: { ...process.env },
    timeoutMs: 60_000,
    cwd: repoRoot,
  };
}

function buildPaidSmokeSpec(repoRoot: string): SubprocessSpec {
  // Calibration mode is the smallest paid sample we ever run from
  // the admin UI: 1 events-list call + 1 event-odds call, with a
  // 50-credit hard cap. The corrected pricing model already routes
  // calibration via SMOKE_CALIBRATION_MAX_CREDITS, but we pass
  // --max-credits explicitly so the runtime guard is set even if
  // the constant changes later. See ODDS_API_CREDIT_AUDIT.md.
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
      "--calibration",
      "--max-odds-requests",
      "1",
      "--max-credits",
      "50",
      "--execute",
    ],
    env: { ...process.env, ALLOW_REAL_ODDS_API_CALLS: "true" },
    timeoutMs: 120_000,
    cwd: repoRoot,
  };
}

/**
 * Subset ingestion for any week — capped to 4 event-odds calls
 * + a 175-credit ceiling. Fits under the 200-credit per-run
 * policy. Lets us land a partial week set + verify the canonical
 * price model without the full ~647 spend.
 *
 * Week 1 callers go through `buildPaidWeek1SubsetSpec(repoRoot)`
 * (a thin wrapper around this function with week=1) so their
 * subprocess argv is byte-identical to the legacy version.
 */
function buildPaidSubsetSpec(args: {
  repoRoot: string;
  week: number;
}): SubprocessSpec {
  return {
    command: defaultTsxBin(args.repoRoot),
    args: [
      ingestScriptPath(args.repoRoot),
      "--season",
      "2025",
      "--scope",
      "week",
      "--week",
      String(args.week),
      "--source",
      "csv",
      "--input",
      gamesCsvPath(args.repoRoot),
      "--max-odds-requests",
      String(ADMIN_WEEK1_SUBSET_MAX_ODDS_REQUESTS),
      "--max-credits",
      String(ADMIN_WEEK1_SUBSET_MAX_CREDITS),
      "--budget",
      String(ADMIN_WEEK1_SUBSET_MAX_CREDITS),
      "--execute",
    ],
    env: { ...process.env, ALLOW_REAL_ODDS_API_CALLS: "true" },
    timeoutMs: 300_000,
    cwd: args.repoRoot,
  };
}

function buildPaidWeek1SubsetSpec(repoRoot: string): SubprocessSpec {
  return buildPaidSubsetSpec({ repoRoot, week: 1 });
}

/**
 * Full ingestion for any week. Pins --budget AND --max-credits
 * to the hard-coded 700 ceiling (validateCreditBudget honours
 * the override via maxCreditsOverride; the per-call guard reads
 * --max-credits). 700 covers the audited 647-credit estimate
 * with ~8% slack. Never accepts a user-supplied cap.
 *
 * Week 1 callers go through `buildPaidWeek1Spec(repoRoot)`.
 */
function buildPaidFullSpec(args: {
  repoRoot: string;
  week: number;
}): SubprocessSpec {
  return {
    command: defaultTsxBin(args.repoRoot),
    args: [
      ingestScriptPath(args.repoRoot),
      "--season",
      "2025",
      "--scope",
      "week",
      "--week",
      String(args.week),
      "--source",
      "csv",
      "--input",
      gamesCsvPath(args.repoRoot),
      "--max-credits",
      String(ADMIN_WEEK1_FULL_MAX_CREDITS),
      "--budget",
      String(ADMIN_WEEK1_FULL_MAX_CREDITS),
      "--execute",
    ],
    env: { ...process.env, ALLOW_REAL_ODDS_API_CALLS: "true" },
    timeoutMs: 900_000,
    cwd: args.repoRoot,
  };
}

function buildPaidWeek1Spec(repoRoot: string): SubprocessSpec {
  return buildPaidFullSpec({ repoRoot, week: 1 });
}

/** Per-week result-file paths so each week's last paid run is
 *  recorded separately. Week 1 keeps its existing path for
 *  back-compat. */
function paidSubsetResultFile(week: number): string {
  if (week === 1) return WEEK1_SUBSET_RESULT_FILE;
  return path.join(
    "data",
    "admin-ingestion",
    `latest-odds-week${week}-subset-paid.json`,
  );
}

function paidFullResultFile(week: number): string {
  if (week === 1) return WEEK1_FULL_RESULT_FILE;
  return path.join(
    "data",
    "admin-ingestion",
    `latest-odds-week${week}-full-paid.json`,
  );
}

// ---- the dispatcher ---------------------------------------------------

export async function runAdminAction(
  args: AdminRunArgs,
): Promise<AdminActionResult> {
  const repoRoot = args.repoRoot ?? process.cwd();
  const spawner = args.spawner ?? realSubprocessRunner;
  const persistence =
    args.persistence ?? (await getPersistenceClient());

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
      const startedAt = new Date().toISOString();
      const sub = await spawner(buildPaidSmokeSpec(repoRoot));
      const finishedAt = new Date().toISOString();
      const parsed = parseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const persistenceNotes: string[] = [];
      if (ok) {
        recordSmokeSuccess({ creditsUsed: parsed.creditsUsed, repoRoot });
        const dbState = await persistence.saveAdminIngestionStateToDb({
          smokeSucceededAt: finishedAt,
          smokeCreditsUsed: parsed.creditsUsed,
        });
        if (!dbState.ok && dbState.error)
          persistenceNotes.push(`db state: ${dbState.error}`);
      }
      recordPaidSmokeAttempt({
        result: ok ? "success" : "failure",
        creditsUsed: parsed.creditsUsed,
        reason: ok ? undefined : `smoke ${ok ? "ok" : "failed"}`,
        repoRoot,
      });
      const dbRun = await persistence.saveOddsIngestionRunToDb({
        season: 2025,
        week: 1,
        scope: "paid-smoke-calibration",
        status: ok ? "success" : "failure",
        startedAt,
        finishedAt,
        creditsEstimated: parsed.estimatedCredits,
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
      });
      if (!dbRun.ok && dbRun.error)
        persistenceNotes.push(`db run: ${dbRun.error}`);
      const result: AdminActionResult = {
        action: "paid-smoke",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `Smoke OK. Credits used=${parsed.creditsUsed ?? "?"} remaining=${parsed.creditsRemaining ?? "?"}.`
          : sub.timedOut
            ? "Smoke timed out."
            : `Smoke failed with exit ${sub.exitCode}.`,
        detail: truncateForUi(sub.stdout, sub.stderr) +
          (persistenceNotes.length > 0
            ? `\n--- persistence ---\n${persistenceNotes.join("\n")}`
            : ""),
        data: {
          creditsUsed: parsed.creditsUsed,
          creditsRemaining: parsed.creditsRemaining,
          persistedToDb: dbRun.ok,
        },
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
      };
      recordActionResult({
        action: "paid-smoke",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "odds-week1-subset-paid": {
      const gate = checkPaidGates({
        confirmText: args.confirmText,
        expectedConfirm: PAID_WEEK1_SUBSET_CONFIRM_TEXT,
        requirePriorSmoke: true,
        repoRoot,
      });
      if (gate)
        return recordSkip("odds-week1-subset-paid", gate, repoRoot);
      const startedAt = new Date().toISOString();
      const sub = await spawner(buildPaidWeek1SubsetSpec(repoRoot));
      const finishedAt = new Date().toISOString();
      const parsed = parseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const outputFiles = parseWrittenOutputFiles(sub.stdout);
      const canonical = inspectStoredWeek1OddsOnDisk(repoRoot).canonical.present;
      writeOddsRunResultFile({
        repoRoot,
        resultFile: WEEK1_SUBSET_RESULT_FILE,
        action: "odds-week1-subset-paid",
        startedAt,
        finishedAt,
        status: ok ? "success" : "failure",
        parsed,
        outputFilesWritten: outputFiles,
        canonicalWeek1MarketsFileUpdated: canonical,
        errorMessage: ok ? undefined : sub.timedOut ? "timed out" : `exit ${sub.exitCode}`,
        maxCreditsCap: ADMIN_WEEK1_SUBSET_MAX_CREDITS,
        confirmText: PAID_WEEK1_SUBSET_CONFIRM_TEXT,
      });
      const result: AdminActionResult = {
        action: "odds-week1-subset-paid",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `Week 1 subset OK. Credits used=${parsed.creditsUsed ?? "?"} remaining=${parsed.creditsRemaining ?? "?"}.`
          : sub.timedOut
            ? "Week 1 subset timed out."
            : `Week 1 subset failed with exit ${sub.exitCode}.`,
        detail: truncateForUi(sub.stdout, sub.stderr),
        data: {
          creditsUsed: parsed.creditsUsed,
          creditsRemaining: parsed.creditsRemaining,
          outputFilesWritten: outputFiles,
          canonicalWeek1MarketsFileUpdated: canonical,
          maxCreditsCap: ADMIN_WEEK1_SUBSET_MAX_CREDITS,
        },
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
      };
      if (ok) {
        recordWeek1SubsetSuccess({ creditsUsed: parsed.creditsUsed, repoRoot });
        await persistence.saveAdminIngestionStateToDb({
          week1SubsetSucceededAt: finishedAt,
          week1SubsetCreditsUsed: parsed.creditsUsed,
        });
      }
      await persistence.saveOddsIngestionRunToDb({
        season: 2025,
        week: 1,
        scope: "paid-week1-subset",
        status: ok ? "success" : "failure",
        startedAt,
        finishedAt,
        creditsEstimated: parsed.estimatedCredits,
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
        marketsRequested: 4,
        gamesRequested: ADMIN_WEEK1_SUBSET_MAX_ODDS_REQUESTS,
      });
      recordActionResult({
        action: "odds-week1-subset-paid",
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
      const startedAt = new Date().toISOString();
      const sub = await spawner(buildPaidWeek1Spec(repoRoot));
      const finishedAt = new Date().toISOString();
      const parsed = parseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const outputFiles = parseWrittenOutputFiles(sub.stdout);
      const canonical = inspectStoredWeek1OddsOnDisk(repoRoot).canonical.present;
      writeOddsRunResultFile({
        repoRoot,
        resultFile: WEEK1_FULL_RESULT_FILE,
        action: "paid-week1",
        startedAt,
        finishedAt,
        status: ok ? "success" : "failure",
        parsed,
        outputFilesWritten: outputFiles,
        canonicalWeek1MarketsFileUpdated: canonical,
        errorMessage: ok ? undefined : sub.timedOut ? "timed out" : `exit ${sub.exitCode}`,
        maxCreditsCap: ADMIN_WEEK1_FULL_MAX_CREDITS,
        confirmText: PAID_WEEK1_CONFIRM_TEXT,
      });
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
          outputFilesWritten: outputFiles,
          canonicalWeek1MarketsFileUpdated: canonical,
          maxCreditsCap: ADMIN_WEEK1_FULL_MAX_CREDITS,
        },
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
      };
      if (ok) {
        recordWeek1Success(repoRoot);
        await persistence.saveAdminIngestionStateToDb({
          week1IngestionSucceededAt: finishedAt,
        });
      }
      await persistence.saveOddsIngestionRunToDb({
        season: 2025,
        week: 1,
        scope: "paid-week1-full",
        status: ok ? "success" : "failure",
        startedAt,
        finishedAt,
        creditsEstimated: parsed.estimatedCredits,
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
        marketsRequested: 4,
      });
      recordActionResult({
        action: "paid-week1",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "paid-week-subset": {
      const week = args.week ?? 1;
      if (!SUPPORTED_PAID_INGESTION_WEEKS.includes(week)) {
        return {
          action: "paid-week-subset",
          ok: false,
          status: "failure",
          summary: `Unsupported week ${week} (allowed: ${SUPPORTED_PAID_INGESTION_WEEKS.join(", ")})`,
        };
      }
      const expectedConfirm = paidSubsetConfirmText(week);
      const gate = checkPaidGates({
        confirmText: args.confirmText,
        expectedConfirm,
        requirePriorSmoke: true,
        repoRoot,
      });
      if (gate) return recordSkip("paid-week-subset", gate, repoRoot);
      const startedAt = new Date().toISOString();
      const sub = await spawner(buildPaidSubsetSpec({ repoRoot, week }));
      const finishedAt = new Date().toISOString();
      const parsed = parseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const outputFiles = parseWrittenOutputFiles(sub.stdout);
      writeOddsRunResultFile({
        repoRoot,
        resultFile: paidSubsetResultFile(week),
        action: "paid-week-subset",
        startedAt,
        finishedAt,
        status: ok ? "success" : "failure",
        parsed,
        outputFilesWritten: outputFiles,
        canonicalWeek1MarketsFileUpdated: false,
        errorMessage: ok
          ? undefined
          : sub.timedOut
            ? "timed out"
            : `exit ${sub.exitCode}`,
        maxCreditsCap: ADMIN_WEEK1_SUBSET_MAX_CREDITS,
        confirmText: expectedConfirm,
      });
      const result: AdminActionResult = {
        action: "paid-week-subset",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `Week ${week} subset OK. Credits used=${parsed.creditsUsed ?? "?"} remaining=${parsed.creditsRemaining ?? "?"}.`
          : sub.timedOut
            ? `Week ${week} subset timed out.`
            : `Week ${week} subset failed with exit ${sub.exitCode}.`,
        detail: truncateForUi(sub.stdout, sub.stderr),
        data: {
          week,
          creditsUsed: parsed.creditsUsed,
          creditsRemaining: parsed.creditsRemaining,
          outputFilesWritten: outputFiles,
          maxCreditsCap: ADMIN_WEEK1_SUBSET_MAX_CREDITS,
        },
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
      };
      await persistence.saveOddsIngestionRunToDb({
        season: 2025,
        week,
        scope: "paid-week-subset",
        status: ok ? "success" : "failure",
        startedAt,
        finishedAt,
        creditsEstimated: parsed.estimatedCredits,
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
        marketsRequested: 4,
        gamesRequested: ADMIN_WEEK1_SUBSET_MAX_ODDS_REQUESTS,
      });
      recordActionResult({
        action: "paid-week-subset",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "paid-week-full": {
      const week = args.week ?? 1;
      if (!SUPPORTED_PAID_INGESTION_WEEKS.includes(week)) {
        return {
          action: "paid-week-full",
          ok: false,
          status: "failure",
          summary: `Unsupported week ${week} (allowed: ${SUPPORTED_PAID_INGESTION_WEEKS.join(", ")})`,
        };
      }
      const credits = estimatedFullCreditsForWeek(week);
      const expectedConfirm = paidFullConfirmText(week, credits);
      const gate = checkPaidGates({
        confirmText: args.confirmText,
        expectedConfirm,
        requirePriorSmoke: true,
        repoRoot,
      });
      if (gate) return recordSkip("paid-week-full", gate, repoRoot);
      const startedAt = new Date().toISOString();
      const sub = await spawner(buildPaidFullSpec({ repoRoot, week }));
      const finishedAt = new Date().toISOString();
      const parsed = parseIngestionOutput(sub.stdout);
      const ok = sub.exitCode === 0 && !sub.timedOut;
      const outputFiles = parseWrittenOutputFiles(sub.stdout);
      writeOddsRunResultFile({
        repoRoot,
        resultFile: paidFullResultFile(week),
        action: "paid-week-full",
        startedAt,
        finishedAt,
        status: ok ? "success" : "failure",
        parsed,
        outputFilesWritten: outputFiles,
        canonicalWeek1MarketsFileUpdated: false,
        errorMessage: ok
          ? undefined
          : sub.timedOut
            ? "timed out"
            : `exit ${sub.exitCode}`,
        maxCreditsCap: ADMIN_WEEK1_FULL_MAX_CREDITS,
        confirmText: expectedConfirm,
      });
      const result: AdminActionResult = {
        action: "paid-week-full",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `Week ${week} full ingestion OK. Credits used=${parsed.creditsUsed ?? "?"} remaining=${parsed.creditsRemaining ?? "?"}.`
          : sub.timedOut
            ? `Week ${week} full ingestion timed out.`
            : `Week ${week} full ingestion failed with exit ${sub.exitCode}.`,
        detail: truncateForUi(sub.stdout, sub.stderr),
        data: {
          week,
          creditsUsed: parsed.creditsUsed,
          creditsRemaining: parsed.creditsRemaining,
          outputFilesWritten: outputFiles,
          maxCreditsCap: ADMIN_WEEK1_FULL_MAX_CREDITS,
        },
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
      };
      await persistence.saveOddsIngestionRunToDb({
        season: 2025,
        week,
        scope: "paid-week-full",
        status: ok ? "success" : "failure",
        startedAt,
        finishedAt,
        creditsEstimated: parsed.estimatedCredits,
        creditsUsed: parsed.creditsUsed,
        creditsRemaining: parsed.creditsRemaining,
        marketsRequested: 4,
      });
      recordActionResult({
        action: "paid-week-full",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "migrate-odds-to-canonical": {
      // Pure file-IO. No paid call. Requires only the admin
      // token; no Odds API gates and no confirmText — this
      // action just copies bytes between paths.
      const migrateWeek = args.week ?? 1;
      const r = migrateLegacyToCanonical({
        season: 2025,
        week: migrateWeek,
        processedRoot: path.join(repoRoot, "data", "processed"),
      });
      const ok = r.status === "READY";
      const target = canonicalMarketsPath({
        season: 2025,
        week: migrateWeek,
        processedRoot: path.join(repoRoot, "data", "processed"),
      });
      // Mirror canonical rows to Postgres so a redeploy doesn't
      // erase the migration result. First delete every stored
      // row for (2025, 1) so stale rows from a pre-fix migration
      // (e.g., LA-era gameIds) cannot survive — the upsert key
      // doesn't catch every shape of stale data. Then write the
      // newly-normalized rows.
      let dbUpserted = 0;
      let dbDeleted = 0;
      let dbRowCountAfter = 0;
      let dbError: string | undefined;
      if (ok && r.target) {
        try {
          const cleared = await persistence.deleteCanonicalOddsRowsForWeek({
            season: 2025,
            week: migrateWeek,
          });
          if (cleared.ok) dbDeleted = cleared.deleted ?? 0;
          else dbError = cleared.error ?? undefined;
          const parsed = parseWrittenCanonicalCsv(r.target);
          const saved = await persistence.saveCanonicalOddsRowsToDb({
            season: 2025,
            week: migrateWeek,
            rows: parsed,
          });
          if (saved.ok) dbUpserted = saved.upserted ?? parsed.length;
          else dbError = saved.error ?? dbError ?? "unknown DB error";
          // Verify: count what landed. Catches half-failures
          // (delete OK, save half-failed) the upsert response
          // alone wouldn't surface.
          if (persistence.isAvailable()) {
            const post = await persistence.countPersistence({
              season: 2025,
              week: migrateWeek,
            });
            if (post.ok) {
              dbRowCountAfter = post.counts?.storedPropMarketRows ?? 0;
            } else if (!dbError) {
              dbError = post.error ?? "count verification failed";
            }
          }
        } catch (err) {
          dbError = (err as Error).message;
        }
      }
      const persistenceWarning =
        ok && persistence.isAvailable() && dbRowCountAfter === 0
          ? "Data is only in ephemeral file cache and will be lost on redeploy."
          : !persistence.isAvailable() && ok
            ? "DATABASE_URL not configured — file cache is the only source; data will be lost on redeploy."
            : undefined;
      const resultFile = path.join(
        repoRoot,
        "data",
        "admin-ingestion",
        "latest-odds-migration.json",
      );
      fs.mkdirSync(path.dirname(resultFile), { recursive: true });
      fs.writeFileSync(
        resultFile,
        JSON.stringify(
          {
            action: "migrate-odds-to-canonical",
            ranAt: new Date().toISOString(),
            status: r.status,
            target: r.target ?? target,
            rowsWritten: r.rowsWritten ?? 0,
            diagnostics: r.diagnostics ?? null,
            sourcesInspected: r.sourcesInspected,
            paidApiCallAttempted: false,
            persistence: {
              dbAvailable: persistence.isAvailable(),
              dbDeleted,
              dbUpserted,
              dbError: dbError ?? null,
            },
            guardrails: {
              noOddsApiCall: true,
              noTouchdownProps: true,
              noAutomatedBetting: true,
              noKalshiIntegration: true,
            },
          },
          null,
          2,
        ) + "\n",
      );
      // Build a focused failure summary when NO_ROWS_FOR_WEEK so
      // the operator sees the week-mismatch root cause without
      // hunting through the diagnostics blob.
      const noRowsHint = (() => {
        if (r.status !== "NO_ROWS_FOR_WEEK") return "";
        const hist = r.marketWeekHistogram ?? {};
        const lines: string[] = [
          `Selected (season=${r.targetSeason ?? migrateWeek === 1 ? 2025 : 2025}, week=${r.targetWeek ?? migrateWeek}).`,
        ];
        const histEntries = Object.entries(hist).sort((a, b) => b[1] - a[1]);
        if (histEntries.length > 0) {
          lines.push("Legacy markets per week (parsed from gameId):");
          for (const [k, v] of histEntries) lines.push(`  · ${k} → ${v} markets`);
        }
        if ((r.droppedWrongWeek ?? 0) > 0) {
          lines.push(
            `${r.droppedWrongWeek} markets dropped BEFORE join because their gameId is from a different week than the selected one.`,
          );
        }
        if (r.sampleMarketGameIds && r.sampleMarketGameIds.length > 0) {
          lines.push(
            `First ${r.sampleMarketGameIds.length} market gameIds: ${r.sampleMarketGameIds.join(", ")}`,
          );
        }
        if (r.sampleScheduleGameIds && r.sampleScheduleGameIds.length > 0) {
          lines.push(
            `First ${r.sampleScheduleGameIds.length} schedule gameIds for the target week: ${r.sampleScheduleGameIds.join(", ")}`,
          );
        } else {
          lines.push(
            `Schedule for the target week is EMPTY. games.csv has no rows for season=${r.targetSeason} week=${r.targetWeek}.`,
          );
        }
        lines.push(
          "Action: either pick the week that matches the markets in the CSV, or re-ingest legacy odds for the target week.",
        );
        return "\n\n" + lines.join("\n");
      })();
      const result: AdminActionResult = {
        action: "migrate-odds-to-canonical",
        ok,
        status: ok ? "success" : "failure",
        summary: ok
          ? `Migration OK (week ${migrateWeek}). Wrote ${r.rowsWritten} canonical rows to ${r.target}${
              dbUpserted > 0
                ? `; deleted ${dbDeleted} stale + upserted ${dbUpserted} in Postgres (rowCountAfter=${dbRowCountAfter}).`
                : "."
            }${persistenceWarning ? ` ⚠ ${persistenceWarning}` : ""}`
          : r.status === "NO_ROWS_FOR_WEEK"
            ? `Migration ${r.status} for week ${migrateWeek}. Likely a week mismatch — see details below.`
            : `Migration ${r.status}. No canonical file written.`,
        detail:
          `sourcesInspected:\n  ${r.sourcesInspected.join("\n  ")}` +
          (r.diagnostics
            ? `\ndiagnostics: ${JSON.stringify(r.diagnostics)}`
            : "") +
          (dbError ? `\npersistence: ${dbError}` : "") +
          noRowsHint,
        data: {
          status: r.status,
          targetSeason: r.targetSeason,
          targetWeek: r.targetWeek,
          target: r.target,
          rowsWritten: r.rowsWritten,
          diagnostics: r.diagnostics,
          marketWeekHistogram: r.marketWeekHistogram,
          droppedWrongWeek: r.droppedWrongWeek,
          sampleMarketGameIds: r.sampleMarketGameIds,
          sampleScheduleGameIds: r.sampleScheduleGameIds,
          dbDeleted,
          dbUpserted,
          dbRowCountAfter,
          dbAvailable: persistence.isAvailable(),
          persistenceWarning: persistenceWarning ?? null,
        },
      };
      recordActionResult({
        action: "migrate-odds-to-canonical",
        result: ok ? "success" : "failure",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "stored-backtest": {
      const backtestWeek = args.week ?? 1;
      // First: if the canonical odds file is missing on disk but
      // we have rows in Postgres, rehydrate the file from DB.
      // This handles the redeploy case where the container's
      // ephemeral filesystem lost the file but the DB row
      // survives.
      const rehydration = await rehydrateCanonicalOddsFromDbIfMissing({
        season: 2025,
        week: backtestWeek,
        client: persistence,
        processedRoot: path.join(repoRoot, "data", "processed"),
      });
      const r = buildRealWeek1CandidatesFromStoredData({
        season: 2025,
        week: backtestWeek,
        processedRoot: path.join(repoRoot, "data", "processed"),
      });
      const ok = r.status === "READY";
      // Determine the canonical-odds source for the admin
      // result. "postgres-rehydrated" when we just wrote the
      // file from DB, "file" when the file was already there,
      // "missing" when neither DB nor file had it.
      const storedBacktestSource: "postgres-rehydrated" | "file" | "missing" =
        rehydration.rehydrated
          ? "postgres-rehydrated"
          : rehydration.source === "file"
            ? "file"
            : "missing";
      // Mirror the data-mode-status file that
      // run-week-1-starter-test.ts writes, so /backtest/week-1
      // and /monitor (which read this file) reflect the latest
      // admin-triggered run. File mirrors the DB save below —
      // either source survives a Railway redeploy.
      const statusFile = path.join(
        repoRoot,
        "data",
        "backtests",
        "2025",
        `week-${backtestWeek}-data-mode-status.fixture.json`,
      );
      fs.mkdirSync(path.dirname(statusFile), { recursive: true });
      fs.writeFileSync(
        statusFile,
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            season: 2025,
            week: backtestWeek,
            dataMode: "stored",
            status: r.status,
            candidateCount: r.candidates.length,
            syntheticFixture: false,
            realWeek1BacktestReady: ok,
            missingStoredOdds: r.status === "MISSING_STORED_ODDS",
            missingProcessedNfl: r.status === "MISSING_PROCESSED_NFL",
            scheduleReport: r.scheduleReport ?? null,
            notes: r.notes,
            nextSteps: r.nextSteps,
            source: "admin-stored-backtest",
          },
          null,
          2,
        ) + "\n",
      );
      // When validation fails, attach a structured diagnostic
      // so the admin UI surfaces the exact mismatch instead of
      // an opaque "0 candidates" message. The diagnostic is a
      // pure file-read (canonical CSV + fixture + games.csv) —
      // no network, no DB call.
      const debug =
        r.status === "SCHEDULE_VALIDATION_FAILED"
          ? buildScheduleValidationDebug({
              repoRoot,
              season: 2025,
              week: backtestWeek,
            })
          : null;
      // Mirror the run output to Postgres so the page can read
      // it back after a redeploy.
      const dbSave = await persistence.saveStoredBacktestRunToDb({
        season: 2025,
        week: backtestWeek,
        dataMode: "stored",
        status: r.status,
        realWeek1BacktestReady: ok,
        scheduleValidationStatus: r.scheduleReport?.status ?? null,
        syntheticFixture: false,
        candidatesJson: { candidates: r.candidates.slice(0, 500) },
      });
      const result: AdminActionResult = {
        action: "stored-backtest",
        ok,
        status: ok ? "success" : "failure",
        summary: `${r.status} — ${r.candidates.length} candidates${
          rehydration.rehydrated
            ? ` (rehydrated ${rehydration.rowsRestored} odds rows from Postgres)`
            : ""
        }${
          debug
            ? ` · ${debug.invalidGameIds.length} invalid gameIds, ${debug.teamPairIssues.length} pair mismatches`
            : ""
        }`,
        detail:
          r.notes.join("\n") +
          `\n--- persistence ---\ncanonical odds source: ${rehydration.source}` +
          (rehydration.error ? `\nrehydration error: ${rehydration.error}` : "") +
          `\nDB save: ${dbSave.ok ? "ok" : `failed (${dbSave.error ?? "?"})`}` +
          (debug
            ? `\n--- schedule-validation debug ---\n` +
              `canonical rows: ${debug.canonicalRowCount}\n` +
              `distinct gameIds: ${debug.distinctCanonicalGameIds.join(", ")}\n` +
              `gameIds in odds but NOT in fixture: ${debug.invalidGameIds.join(", ") || "(none)"}\n` +
              `gameIds in fixture but NOT in odds: ${debug.missingFromOdds.join(", ") || "(none)"}\n` +
              `team-pair mismatches:\n` +
              (debug.teamPairIssues.length === 0
                ? "  (none)\n"
                : debug.teamPairIssues
                    .map(
                      (i) =>
                        `  · ${i.gameId} expects ${i.expectedTeams.join("/")}; bad: ${i.badPairs.join(" · ")}`,
                    )
                    .join("\n") + "\n") +
              `first ${debug.firstProblematicRows.length} problematic rows:\n` +
              debug.firstProblematicRows
                .map(
                  (r2) =>
                    `  · gameId=${r2.gameId} team=${r2.team} opp=${r2.opponent} player=${r2.playerName} book=${r2.sportsbook}`,
                )
                .join("\n") +
              "\nRecommended: re-run the migration so the writer rewrites every row through normalizeTeamAbbreviation. The migration now also deletes stale DB rows for (season, week) before saving."
            : ""),
        data: {
          status: r.status,
          candidateCount: r.candidates.length,
          scheduleReportStatus: r.scheduleReport?.status,
          canonicalOddsSource: rehydration.source,
          storedBacktestSource,
          storedBacktestDbSave: dbSave.ok ? "ok" : "fail",
          storedBacktestDbError: dbSave.ok ? null : dbSave.error ?? null,
          dbAvailable: persistence.isAvailable(),
          dbRunSaved: dbSave.ok,
          persistenceWarning:
            ok && persistence.isAvailable() && !dbSave.ok
              ? "Backtest output is only in ephemeral file cache and will be lost on redeploy."
              : !persistence.isAvailable() && ok
                ? "DATABASE_URL not configured — backtest output is only in the ephemeral file cache."
                : null,
          scheduleValidationDebug: debug,
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

    case "grade-week-stored":
    case "grade-week1-stored": {
      const week =
        args.action === "grade-week1-stored" ? 1 : (args.week ?? 1);
      const actionName = args.action;
      if (!Number.isFinite(week) || week < 1 || week > 22) {
        return {
          action: actionName,
          ok: false,
          status: "failure",
          summary: `Invalid week ${week}`,
        };
      }
      // Re-run the candidate builder to get the SAME pregame
      // candidate set the stored-backtest action persisted, then
      // grade each candidate against processed nflverse stats.
      // We rebuild rather than reading candidatesJson from DB so
      // the grader never depends on the previous row's shape
      // surviving — same code path, same output.
      const built = buildRealWeek1CandidatesFromStoredData({
        season: 2025,
        week,
        processedRoot: path.join(repoRoot, "data", "processed"),
      });
      if (built.status !== "READY") {
        const result: AdminActionResult = {
          action: actionName,
          ok: false,
          status: "failure",
          summary: `Cannot grade week ${week}: candidate builder returned ${built.status}. Run the migration + stored backtest for this week first.`,
          detail: built.notes.join("\n"),
          data: { week, candidateBuilderStatus: built.status },
        };
        recordActionResult({
          action: actionName,
          result: "failure",
          summary: result.summary,
          repoRoot,
        });
        return result;
      }
      const stats = loadProcessedPlayerWeekStatsStrict(
        path.join(repoRoot, "data", "processed", "nfl"),
      );
      if (stats.status !== "READY") {
        const result: AdminActionResult = {
          action: actionName,
          ok: false,
          status: "failure",
          summary: `Cannot grade week ${week}: processed player_week_stats.csv missing at ${stats.source}.`,
          detail: "Run nflverse ingestion to produce data/processed/nfl/player_week_stats.csv.",
          data: { week, playerStatsStatus: stats.status, source: stats.source },
        };
        recordActionResult({
          action: actionName,
          result: "failure",
          summary: result.summary,
          repoRoot,
        });
        return result;
      }
      // Apply the V1 scorecard to each candidate using the
      // same projection engine + decision authority the live
      // Player Props page uses. Strict-before player history
      // is built from the processed nflverse rows we just
      // loaded. The output candidates carry a `.scorecard`
      // field that the grader uses to compute recommended-
      // plays performance.
      const playerHistoryByName = buildPlayerHistoryByName({
        candidates: built.candidates,
        season: 2025,
        week,
        playerWeekStats: stats.rows,
      });
      const evaluatedCandidates = applyScorecardToCandidates({
        candidates: built.candidates,
        playerHistoryByName,
      });
      // As-of fairness validation. Confirms every candidate's
      // odds were captured BEFORE kickoff and every attached
      // history row is strict-before the target (season, week).
      // If anything fails, abort the run — we will not grade a
      // candidate set that may have leaked future data.
      const asOfReport = validateAsOfFairness({
        candidates: evaluatedCandidates,
        season: 2025,
        week,
        playerHistoryByName,
      });
      if (!asOfReport.ok) {
        const result: AdminActionResult = {
          action: actionName,
          ok: false,
          status: "failure",
          summary: `Aborting grade week ${week}: as-of fairness check failed — ${asOfReport.candidatesInvalid}/${asOfReport.candidatesChecked} candidates invalid. No grading performed.`,
          detail: formatAsOfReport(asOfReport),
          data: { week, asOfReport },
        };
        recordActionResult({
          action: actionName,
          result: "failure",
          summary: result.summary,
          repoRoot,
        });
        return result;
      }
      const grade = gradeStoredWeek1Backtest({
        candidates: evaluatedCandidates,
        season: 2025,
        week,
        playerWeekStats: stats.rows,
      });
      const scorecardAudit = buildScorecardAudit({
        candidates: evaluatedCandidates,
        playerHistoryByName,
        playerWeekStats: stats.rows,
        samplePicksCount: 50,
        closestToQualifyingCount: 50,
        missingHistoryExamplesCount: 25,
      });
      // Diagnostic-only calibration replay. The live model
      // continues to use the production marketContextGate
      // (0.45); this payload simply REPORTS what would have
      // happened at 0.40 / 0.35 so the operator can decide
      // whether to propose a gate change in a separate PR.
      const marketContextCalibration = buildMarketContextCalibration({
        candidates: evaluatedCandidates,
        graded: grade.graded,
      });
      // Persist to DB. New row carries both candidatesJson +
      // resultsJson so the pregame snapshot isn't overwritten;
      // the latest row wins.
      const dbSave = await persistence.saveStoredBacktestRunToDb({
        season: 2025,
        week,
        dataMode: "stored",
        status: built.status,
        realWeek1BacktestReady: true,
        scheduleValidationStatus: built.scheduleReport?.status ?? "PASS",
        syntheticFixture: false,
        candidatesJson: {
          // Evaluated candidates carry scorecard fields; downstream
          // monitor + backtest pages read them straight from this
          // row so the page can render recommended plays without
          // re-running the scorecard pass.
          candidates: evaluatedCandidates.slice(0, 500),
        },
        resultsJson: {
          summary: grade.summary,
          gradedSampleSize: grade.graded.length,
          // Persist up to 100 per-candidate graded rows so the
          // /backtest/week-1 page can render the actual plays
          // + outcomes without re-running the grader. Cap keeps
          // the row JSON modest in size.
          gradedSample: grade.graded.slice(0, 100),
          // As-of fairness validation report. Persisted so the
          // page can render confirmation that the run was a
          // fair as-of simulation (no post-kickoff odds, no
          // future stats in the model's history join).
          asOfReport,
          // Per-bucket disqualifier counts + feature-completeness
          // audit. Lets /monitor and /backtest/week-1 surface
          // "why is recommendedPlays empty?" without a second
          // round trip.
          scorecardAudit,
          // DIAGNOSTIC ONLY — what WOULD have qualified if the
          // marketContext gate were 0.40 or 0.35, with every
          // other gate unchanged. Persisted so the calibration
          // section on /monitor and /backtest/week-1 renders
          // without re-running the replay.
          marketContextCalibration,
        },
      });
      // File mirror — small, secret-free. Per-week filename so
      // a later week never overwrites Week 1's mirror.
      const gradedFile = path.join(
        repoRoot,
        "data",
        "backtests",
        "2025",
        `week-${week}-graded-summary.fixture.json`,
      );
      fs.mkdirSync(path.dirname(gradedFile), { recursive: true });
      fs.writeFileSync(
        gradedFile,
        JSON.stringify(
          {
            gradedAt: grade.summary.gradedAt,
            season: 2025,
            week,
            summary: grade.summary,
            // Persist a few example rows so the page can show a
            // breakdown without the full 290.
            samples: grade.graded.slice(0, 20),
            paidApiCallAttempted: false,
            guardrails: {
              noOddsApiCall: true,
              noTouchdownProps: true,
              noAutomatedBetting: true,
            },
          },
          null,
          2,
        ) + "\n",
      );
      // Build a summary that honestly splits universe diagnostics
      // from the model's recommended-plays performance. The old
      // copy used `qualifiedPlays` (legacy = candidates with both
      // sides decisive) and labeled it "qualified", which made
      // the universe look like the model's bet count.
      const recPlays = grade.summary.recommendedPlays;
      const headlineRecCopy = recPlays.enabled
        ? `Recommended plays: ${recPlays.count} (${recPlays.wins}W·${recPlays.losses}L·${recPlays.pushes}P · hit ${recPlays.hitRatePct.toFixed(1)}% · ROI ${recPlays.roiPct.toFixed(1)}% · ${recPlays.unitsProfit.toFixed(2)}u)`
        : `Recommended plays: 0 (scorecard pass produced 0 qualified plays — see scorecardAudit.topDisqualifiers / featureCompleteness for why)`;
      const universeCopy = `Universe diagnostic: ${grade.summary.candidatesWithActual}/${grade.summary.totalCandidates} candidates with actual results — OVER hit ${(grade.summary.overSide.hitRate * 100).toFixed(1)}% / UNDER hit ${(grade.summary.underSide.hitRate * 100).toFixed(1)}% (better side: ${grade.summary.betterSide}, NOT model ROI)`;
      const asOfHeadline = `As-of fairness: ${asOfReport.candidatesValid}/${asOfReport.candidatesChecked} candidates passed (snapshot < kickoff + strict-before history)`;
      const topDisqLine =
        scorecardAudit.topDisqualifiers.length > 0
          ? `Top disqualifier: ${scorecardAudit.topDisqualifiers[0].reason} (×${scorecardAudit.topDisqualifiers[0].count})`
          : "No scorecard disqualifiers recorded.";
      const sampleSnapshotKickoffLines = evaluatedCandidates
        .slice(0, 5)
        .map(
          (c) =>
            `  · ${c.playerName} ${c.propType} ${c.line} · kickoff=${c.kickoffTime ?? "?"} · snapshot=${c.snapshotTime ?? "?"}`,
        )
        .join("\n");
      const result: AdminActionResult = {
        action: actionName,
        ok: true,
        status: "success",
        summary: `Week ${week} · ${headlineRecCopy} · ${universeCopy} · ${asOfHeadline}`,
        detail:
          `${formatAsOfReport(asOfReport)}\n` +
          `Sample kickoff / snapshot times:\n${sampleSnapshotKickoffLines}\n\n` +
          `Recommended (model-qualified):\n` +
          (recPlays.enabled
            ? `  plays=${recPlays.count}  W=${recPlays.wins}  L=${recPlays.losses}  P=${recPlays.pushes}  hit=${recPlays.hitRatePct.toFixed(1)}%  ROI=${recPlays.roiPct.toFixed(1)}%  units=${recPlays.unitsProfit.toFixed(2)}  avgEdge=${recPlays.averageEdgePct.toFixed(2)}%  avgConfidence=${recPlays.averageConfidence.toFixed(2)}\n`
            : `  plays=0  reason: ${recPlays.note}\n`) +
          `\nUniverse diagnostic (NOT betting performance):\n` +
          `  total=${grade.summary.totalCandidates}  withActual=${grade.summary.candidatesWithActual}  missing=${grade.summary.candidatesMissingActual}  pushed=${grade.summary.candidatesPushed}\n` +
          `  OVER:  wins=${grade.summary.overSide.wins} losses=${grade.summary.overSide.losses} units=${grade.summary.overSide.unitsProfit.toFixed(2)}\n` +
          `  UNDER: wins=${grade.summary.underSide.wins} losses=${grade.summary.underSide.losses} units=${grade.summary.underSide.unitsProfit.toFixed(2)}\n` +
          `\nDisqualification breakdown:\n` +
          `  edgeTooThin=${grade.summary.disqualificationBreakdown.edgeTooThin}  ` +
          `riskGate(total)=${grade.summary.disqualificationBreakdown.riskGate}  ` +
          `other=${grade.summary.disqualificationBreakdown.other}  ` +
          `missingResult=${grade.summary.disqualificationBreakdown.missingResult}  ` +
          `ungradeable=${grade.summary.disqualificationBreakdown.ungradeable}\n` +
          `  dataQualityGate=${grade.summary.disqualificationBreakdown.dataQualityGate}  ` +
          `roleStabilityGate=${grade.summary.disqualificationBreakdown.roleStabilityGate}  ` +
          `injuryContextGate=${grade.summary.disqualificationBreakdown.injuryContextGate}  ` +
          `correlationExposureGate=${grade.summary.disqualificationBreakdown.correlationExposureGate}\n` +
          `  weatherEnvironmentGate=${grade.summary.disqualificationBreakdown.weatherEnvironmentGate}  ` +
          `gameScriptGate=${grade.summary.disqualificationBreakdown.gameScriptGate}  ` +
          `paceGate=${grade.summary.disqualificationBreakdown.paceGate}  ` +
          `marketContextGate=${grade.summary.disqualificationBreakdown.marketContextGate}\n` +
          `\nScorecard audit:\n` +
          `  candidatesWithScorecard=${scorecardAudit.candidatesWithScorecard}/${scorecardAudit.candidatesScored}  ` +
          `qualified=${scorecardAudit.qualifiedCount}  disqualified=${scorecardAudit.disqualifiedCount}  ` +
          `missingHistory=${scorecardAudit.candidatesMissingHistory}\n` +
          `  byRecommendation: OVER=${scorecardAudit.byRecommendation.OVER} UNDER=${scorecardAudit.byRecommendation.UNDER} PASS=${scorecardAudit.byRecommendation.PASS} unknown=${scorecardAudit.byRecommendation.unknown}\n` +
          `  ${topDisqLine}\n` +
          (scorecardAudit.missingHistory
            ? `  missingHistory split: teamSwitched=${scorecardAudit.missingHistory.teamSwitched} ` +
              `rookieOrUnknown=${scorecardAudit.missingHistory.rookieOrUnknown} ` +
              `possibleNameMismatch=${scorecardAudit.missingHistory.possibleNameMismatch}\n`
            : "") +
          (scorecardAudit.marketContext
            ? `\nMarket context audit (gate ${scorecardAudit.marketContext.gateThreshold.toFixed(2)}, clamp floor ${scorecardAudit.marketContext.clampFloor.toFixed(2)}):\n` +
              `  raw score min/mean/max: ${scorecardAudit.marketContext.rawMin.toFixed(2)} / ${scorecardAudit.marketContext.rawMean.toFixed(2)} / ${scorecardAudit.marketContext.rawMax.toFixed(2)}\n` +
              `  raw distribution: ≥0.45=${scorecardAudit.marketContext.rawDistribution.gte045} ` +
              `0.40–0.45=${scorecardAudit.marketContext.rawDistribution.band040To045} ` +
              `0.35–0.40=${scorecardAudit.marketContext.rawDistribution.band035To040} ` +
              `0.20–0.35=${scorecardAudit.marketContext.rawDistribution.band020To035} ` +
              `0.00–0.20=${scorecardAudit.marketContext.rawDistribution.band000To020} ` +
              `<0=${scorecardAudit.marketContext.rawDistribution.lt000}\n` +
              `  simulation (DIAGNOSTIC — gate unchanged): would qualify at gate 0.45=${scorecardAudit.marketContext.simulation.qualifyingAtGate045}  ` +
              `at 0.40=${scorecardAudit.marketContext.simulation.qualifyingAtGate040}  ` +
              `at 0.35=${scorecardAudit.marketContext.simulation.qualifyingAtGate035}\n`
            : "") +
          (scorecardAudit.closestToQualifying &&
          scorecardAudit.closestToQualifying.length > 0
            ? `\nClosest 5 to qualifying (smallest gap = closest):\n` +
              scorecardAudit.closestToQualifying
                .slice(0, 5)
                .map(
                  (c, i) =>
                    `  ${i + 1}. ${c.playerName} ${c.propType} ${c.line} (${c.side}) gap=${c.qualificationGap.toFixed(2)} disq=${c.disqualifiers.join("; ")}`,
                )
                .join("\n") +
              `\n`
            : "") +
          `\nMarket-context gate calibration (DIAGNOSTIC ONLY — production gate unchanged at 0.45):\n` +
          `  Production 0.45: ${marketContextCalibration.production.qualifiedCount} plays  ${marketContextCalibration.production.wins}W·${marketContextCalibration.production.losses}L·${marketContextCalibration.production.pushes}P  hit=${marketContextCalibration.production.hitRatePct.toFixed(1)}%  ROI=${marketContextCalibration.production.roiPct.toFixed(1)}%  ${marketContextCalibration.production.unitsProfit.toFixed(2)}u\n` +
          `  Diagnostic 0.40: ${marketContextCalibration.gate040.qualifiedCount} plays  ${marketContextCalibration.gate040.wins}W·${marketContextCalibration.gate040.losses}L·${marketContextCalibration.gate040.pushes}P  hit=${marketContextCalibration.gate040.hitRatePct.toFixed(1)}%  ROI=${marketContextCalibration.gate040.roiPct.toFixed(1)}%  ${marketContextCalibration.gate040.unitsProfit.toFixed(2)}u\n` +
          `  Diagnostic 0.35: ${marketContextCalibration.gate035.qualifiedCount} plays  ${marketContextCalibration.gate035.wins}W·${marketContextCalibration.gate035.losses}L·${marketContextCalibration.gate035.pushes}P  hit=${marketContextCalibration.gate035.hitRatePct.toFixed(1)}%  ROI=${marketContextCalibration.gate035.roiPct.toFixed(1)}%  ${marketContextCalibration.gate035.unitsProfit.toFixed(2)}u\n` +
          `\nDB save: ${dbSave.ok ? "ok" : `failed (${dbSave.error ?? "?"})`}`,
        data: {
          summary: grade.summary,
          scorecardAudit,
          marketContextCalibration,
          dbSaved: dbSave.ok,
          gradedFile,
        },
      };
      recordActionResult({
        action: actionName,
        result: "success",
        summary: result.summary,
        repoRoot,
      });
      return result;
    }

    case "verify-persistence": {
      // Pure read: ping the DB, count rows, peek at the legacy
      // files, report rehydration availability. No external API.
      const ping = await persistence.ping();
      const countsResult = ping.tablesReady
        ? await persistence.countPersistence({ season: 2025, week: 1 })
        : { ok: false, counts: undefined };
      const stored = inspectStoredWeek1OddsOnDisk(repoRoot);
      const canonicalFilePresent = stored.canonical.present;
      const dbOddsRows = countsResult.counts?.storedPropMarketRows ?? 0;
      const dbBacktestRuns = countsResult.counts?.storedBacktestRuns ?? 0;
      const dbIngestionRuns = countsResult.counts?.oddsIngestionRuns ?? 0;
      const adminStateExists = countsResult.counts?.adminStateExists ?? false;
      const canRehydrateOdds = !canonicalFilePresent && dbOddsRows > 0;
      const canLoadStoredBacktest = dbBacktestRuns > 0;
      const ok = persistence.isAvailable() && ping.tablesReady;
      const summary = ok
        ? `DB ok · ${dbOddsRows} odds rows · ${dbBacktestRuns} backtest runs · ${dbIngestionRuns} ingestion runs · admin state ${adminStateExists ? "present" : "missing"}.`
        : persistence.isAvailable()
          ? `DB reachable but tables not ready: ${ping.error ?? "unknown"}.`
          : `DATABASE_URL not configured — persistence disabled, file cache is the only source.`;
      const result: AdminActionResult = {
        action: "verify-persistence",
        ok,
        status: ok ? "success" : "failure",
        summary,
        detail: [
          `dbConfigured: ${typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0}`,
          `dbAvailable: ${persistence.isAvailable()}`,
          `prismaTablesReady: ${ping.tablesReady}`,
          ping.error ? `pingError: ${ping.error}` : null,
          `StoredPropMarket(2025, w1): ${dbOddsRows} rows`,
          `StoredBacktestRun(2025, w1): ${dbBacktestRuns} rows`,
          `OddsIngestionRun(2025, w1): ${dbIngestionRuns} rows`,
          `AdminIngestionState: ${adminStateExists ? "present" : "missing"}`,
          `canonical file present: ${canonicalFilePresent}`,
          `legacy file present: ${stored.legacy.present}`,
          `canRehydrateCanonicalFromDb: ${canRehydrateOdds}`,
          `canLoadStoredBacktestFromDb: ${canLoadStoredBacktest}`,
        ]
          .filter((line): line is string => line !== null)
          .join("\n"),
        data: {
          dbConfigured:
            typeof process.env.DATABASE_URL === "string" &&
            process.env.DATABASE_URL.length > 0,
          dbAvailable: persistence.isAvailable(),
          prismaTablesReady: ping.tablesReady,
          pingError: ping.tablesReady ? null : ping.error ?? null,
          counts: {
            storedPropMarketRows: dbOddsRows,
            storedBacktestRuns: dbBacktestRuns,
            oddsIngestionRuns: dbIngestionRuns,
            adminStateExists,
          },
          files: {
            canonicalPresent: canonicalFilePresent,
            legacyPresent: stored.legacy.present,
          },
          canRehydrateCanonicalFromDb: canRehydrateOdds,
          canLoadStoredBacktestFromDb: canLoadStoredBacktest,
        },
      };
      recordActionResult({
        action: "verify-persistence",
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

interface ScheduleValidationDebug {
  canonicalRowCount: number;
  distinctCanonicalGameIds: string[];
  expectedFixtureGameIds: string[];
  invalidGameIds: string[];
  missingFromOdds: string[];
  teamPairIssues: {
    gameId: string;
    expectedTeams: string[];
    badPairs: string[];
  }[];
  firstProblematicRows: {
    gameId: string;
    team: string;
    opponent: string;
    playerName: string;
    sportsbook: string;
  }[];
}

/**
 * Build a structured diagnostic explaining why stored-mode
 * schedule validation failed. Pure file IO: reads the canonical
 * odds CSV + the static Week 1 fixture + (optionally) the
 * processed games.csv. Surfaces every mismatch so the admin
 * page can show the actual broken rows instead of "0
 * candidates".
 */
function buildScheduleValidationDebug(args: {
  repoRoot: string;
  season: number;
  week: number;
}): ScheduleValidationDebug {
  const canonicalPath = path.join(
    args.repoRoot,
    "data",
    "processed",
    "odds",
    String(args.season),
    `week-${args.week}-prop-markets.csv`,
  );
  let canonical: Array<{
    season: number;
    week: number;
    gameId: string;
    team: string;
    opponent: string;
    playerName: string;
    sportsbook: string;
  }> = [];
  if (fs.existsSync(canonicalPath)) {
    canonical = parseCsvRows(fs.readFileSync(canonicalPath, "utf8")).map(
      (r) => ({
        season: Number(r.season),
        week: Number(r.week),
        gameId: r.gameId ?? "",
        team: r.team ?? "",
        opponent: r.opponent ?? "",
        playerName: r.playerName ?? "",
        sportsbook: r.sportsbook ?? "",
      }),
    );
  }
  const fixture = getExpectedWeek1Schedule();
  const fixtureIds = new Set(fixture.games.map((g) => g.gameId));
  const canonicalIds = [...new Set(canonical.map((r) => r.gameId))].sort();

  const idValidation = validateCanonicalOddsGameIds({
    rows: canonical,
    schedule: fixture.games,
  });

  const fixtureByGameId = new Map(
    fixture.games.map((g) => [g.gameId, g] as const),
  );
  const teamPairIssues: ScheduleValidationDebug["teamPairIssues"] = [];
  for (const gameId of canonicalIds) {
    const fx = fixtureByGameId.get(gameId);
    if (!fx) continue;
    const expected = [
      normalizeTeamAbbreviation(fx.awayTeam),
      normalizeTeamAbbreviation(fx.homeTeam),
    ];
    const rowsForGame = canonical.filter((r) => r.gameId === gameId);
    const pairs = new Map<string, number>();
    for (const r of rowsForGame)
      pairs.set(`${r.team}/${r.opponent}`, (pairs.get(`${r.team}/${r.opponent}`) ?? 0) + 1);
    const badPairs: string[] = [];
    for (const [pair, count] of pairs) {
      const [team, opponent] = pair.split("/");
      const teamN = normalizeTeamAbbreviation(team);
      const oppN = normalizeTeamAbbreviation(opponent);
      const teamOk = teamN === expected[0] || teamN === expected[1];
      const oppOk = oppN === expected[0] || oppN === expected[1];
      if (!teamOk || !oppOk || teamN === oppN) {
        badPairs.push(`${pair} × ${count}`);
      }
    }
    if (badPairs.length > 0) {
      teamPairIssues.push({ gameId, expectedTeams: expected, badPairs });
    }
  }

  const invalidIdsSet = new Set(idValidation.invalidGameIds);
  const teamPairBadIds = new Set(teamPairIssues.map((i) => i.gameId));
  const firstProblematicRows = canonical
    .filter(
      (r) => invalidIdsSet.has(r.gameId) || teamPairBadIds.has(r.gameId),
    )
    .slice(0, 20)
    .map((r) => ({
      gameId: r.gameId,
      team: r.team,
      opponent: r.opponent,
      playerName: r.playerName,
      sportsbook: r.sportsbook,
    }));

  return {
    canonicalRowCount: canonical.length,
    distinctCanonicalGameIds: canonicalIds,
    expectedFixtureGameIds: [...fixtureIds].sort(),
    invalidGameIds: idValidation.invalidGameIds,
    missingFromOdds: [...fixtureIds].filter(
      (g) => !canonicalIds.includes(g),
    ),
    teamPairIssues,
    firstProblematicRows,
  };
}

/**
 * Parse a canonical Week-N CSV back into rows for persistence.
 * Used by the migrate-odds-to-canonical action — the migration
 * already wrote the file, so we re-parse it to avoid re-joining
 * the legacy CSVs in memory. Tolerant of column reordering: the
 * column index map is built from the header row.
 */
function parseWrittenCanonicalCsv(
  filePath: string,
): import("../ingestion/canonical-odds-writer").CanonicalPropRow[] {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length <= 1) return [];
  const header = lines[0].split(",");
  const idx = (name: string): number => header.indexOf(name);
  const out: import("../ingestion/canonical-odds-writer").CanonicalPropRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    out.push({
      season: Number(cells[idx("season")]),
      week: Number(cells[idx("week")]),
      gameId: cells[idx("gameId")] ?? "",
      kickoffTime: cells[idx("kickoffTime")] ?? "",
      sportsbook: cells[idx("sportsbook")] ?? "",
      playerName: cells[idx("playerName")] ?? "",
      team: cells[idx("team")] ?? "",
      opponent: cells[idx("opponent")] ?? "",
      marketKey: cells[idx("marketKey")] ?? "",
      propType: cells[idx("propType")] ?? "",
      line: Number(cells[idx("line")]),
      overOdds: Number(cells[idx("overOdds")]),
      underOdds: Number(cells[idx("underOdds")]),
      snapshotTime: cells[idx("snapshotTime")] ?? "",
    });
  }
  return out;
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
