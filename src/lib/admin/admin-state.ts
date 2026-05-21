/**
 * Tiny JSON state file for the admin ingestion page.
 *
 *   · last action + result (so the page can show what most
 *     recently happened)
 *   · "smoke test succeeded at" — the gate the paid Week 1
 *     ingestion requires; only the paid smoke action sets it
 *
 * The file lives at `data/admin/ingestion-state.json` and is
 * gitignored. We never write API keys, tokens, raw HTTP bodies,
 * or any other secret to it.
 *
 * No paid APIs. No model logic.
 */

import fs from "node:fs";
import path from "node:path";

export type AdminAction =
  | "readiness-check"
  | "run-nflverse-ingestion"
  | "dry-run"
  | "paid-smoke"
  | "odds-week1-subset-paid"
  | "paid-week1"
  | "paid-week-subset"
  | "paid-week-full"
  | "migrate-odds-to-canonical"
  | "stored-backtest"
  | "grade-week1-stored"
  | "grade-week-stored"
  | "verify-persistence";

export type AdminResult = "success" | "failure" | "skipped";

export interface AdminIngestionState {
  lastAction?: AdminAction;
  lastResult?: AdminResult;
  lastTimestamp?: string;
  lastSummary?: string;
  /** Set by a successful paid-smoke run. Required gate for paid-week1. */
  smokeSucceededAt?: string;
  smokeCreditsUsed?: number;
  /** Set when paid-week1 (full) succeeds. */
  week1IngestionSucceededAt?: string;
  /** Set when odds-week1-subset-paid succeeds. */
  week1SubsetSucceededAt?: string;
  week1SubsetCreditsUsed?: number;
  /** Most recent paid-smoke attempt — success OR failure. Used to
   *  show "last smoke used X credits before aborting" in the UI. */
  lastPaidSmokeAttemptAt?: string;
  lastPaidSmokeResult?: "success" | "failure";
  lastPaidSmokeCreditsUsed?: number;
  lastPaidSmokeReason?: string;
}

const STATE_REL_PATH = path.join("data", "admin", "ingestion-state.json");

export function adminStateFilePath(repoRoot?: string): string {
  const root = repoRoot ?? process.cwd();
  return path.join(root, STATE_REL_PATH);
}

export function readAdminState(repoRoot?: string): AdminIngestionState {
  const file = adminStateFilePath(repoRoot);
  if (!fs.existsSync(file)) return {};
  try {
    const text = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(text) as AdminIngestionState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeAdminState(
  state: AdminIngestionState,
  repoRoot?: string,
): void {
  const file = adminStateFilePath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

export function recordActionResult(args: {
  action: AdminAction;
  result: AdminResult;
  summary: string;
  repoRoot?: string;
}): AdminIngestionState {
  const current = readAdminState(args.repoRoot);
  const next: AdminIngestionState = {
    ...current,
    lastAction: args.action,
    lastResult: args.result,
    lastTimestamp: new Date().toISOString(),
    lastSummary: args.summary,
  };
  writeAdminState(next, args.repoRoot);
  return next;
}

export function recordSmokeSuccess(args: {
  creditsUsed?: number;
  repoRoot?: string;
}): AdminIngestionState {
  const current = readAdminState(args.repoRoot);
  const next: AdminIngestionState = {
    ...current,
    smokeSucceededAt: new Date().toISOString(),
    smokeCreditsUsed:
      typeof args.creditsUsed === "number" ? args.creditsUsed : current.smokeCreditsUsed,
  };
  writeAdminState(next, args.repoRoot);
  return next;
}

export function recordPaidSmokeAttempt(args: {
  result: "success" | "failure";
  creditsUsed?: number;
  reason?: string;
  repoRoot?: string;
}): AdminIngestionState {
  const current = readAdminState(args.repoRoot);
  const next: AdminIngestionState = {
    ...current,
    lastPaidSmokeAttemptAt: new Date().toISOString(),
    lastPaidSmokeResult: args.result,
    lastPaidSmokeCreditsUsed:
      typeof args.creditsUsed === "number"
        ? args.creditsUsed
        : current.lastPaidSmokeCreditsUsed,
    lastPaidSmokeReason: args.reason ?? current.lastPaidSmokeReason,
  };
  writeAdminState(next, args.repoRoot);
  return next;
}

export function recordWeek1Success(repoRoot?: string): AdminIngestionState {
  const current = readAdminState(repoRoot);
  const next: AdminIngestionState = {
    ...current,
    week1IngestionSucceededAt: new Date().toISOString(),
  };
  writeAdminState(next, repoRoot);
  return next;
}

export function recordWeek1SubsetSuccess(args: {
  creditsUsed?: number;
  repoRoot?: string;
}): AdminIngestionState {
  const current = readAdminState(args.repoRoot);
  const next: AdminIngestionState = {
    ...current,
    week1SubsetSucceededAt: new Date().toISOString(),
    week1SubsetCreditsUsed:
      typeof args.creditsUsed === "number"
        ? args.creditsUsed
        : current.week1SubsetCreditsUsed,
  };
  writeAdminState(next, args.repoRoot);
  return next;
}

export function hasPriorSmokeSuccess(repoRoot?: string): boolean {
  const state = readAdminState(repoRoot);
  return Boolean(state.smokeSucceededAt);
}
