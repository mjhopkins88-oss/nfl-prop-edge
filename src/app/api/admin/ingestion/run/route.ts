/**
 * POST /api/admin/ingestion/run
 *
 * Body:
 *   { action: "readiness-check" | "dry-run" | "paid-smoke"
 *           | "paid-week1" | "stored-backtest",
 *     confirmText?: string }
 *
 * Header:
 *   x-admin-ingest-token: <ADMIN_INGEST_TOKEN>
 *
 * Paid actions require ALLOW_REAL_ODDS_API_CALLS=true AND
 * ODDS_API_KEY AND an exact confirmText. Paid Week 1 also
 * requires a prior recorded smoke success. None of those gates
 * can be bypassed from the client.
 */

import { NextResponse } from "next/server";
import {
  readAdminTokenFromHeaders,
  verifyAdminToken,
} from "@/lib/admin/admin-auth";
import { runAdminAction } from "@/lib/admin/admin-runner";
import type { AdminAction } from "@/lib/admin/admin-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS: readonly AdminAction[] = [
  "readiness-check",
  "run-nflverse-ingestion",
  "dry-run",
  "paid-smoke",
  "odds-week1-subset-paid",
  "paid-week1",
  "migrate-odds-to-canonical",
  "stored-backtest",
];

function isAdminAction(s: unknown): s is AdminAction {
  return typeof s === "string" && VALID_ACTIONS.includes(s as AdminAction);
}

export async function POST(request: Request): Promise<NextResponse> {
  const token = readAdminTokenFromHeaders(request.headers);
  if (!verifyAdminToken(token)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be JSON" },
      { status: 400 },
    );
  }

  const action = (body as { action?: unknown })?.action;
  if (!isAdminAction(action)) {
    return NextResponse.json(
      { ok: false, error: `action must be one of ${VALID_ACTIONS.join(", ")}` },
      { status: 400 },
    );
  }

  const confirmText = (body as { confirmText?: unknown })?.confirmText;
  const result = await runAdminAction({
    action,
    confirmText:
      typeof confirmText === "string" ? confirmText : undefined,
  });

  return NextResponse.json(result, {
    status: result.status === "skipped" ? 422 : result.ok ? 200 : 500,
  });
}
