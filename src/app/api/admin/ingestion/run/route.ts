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
  "paid-week-subset",
  "paid-week-full",
  "paid-season-full",
  "migrate-odds-to-canonical",
  "stored-backtest",
  "grade-week1-stored",
  "grade-week-stored",
  "edge-slice-diagnostic",
  "run-season-stored-backtest",
  "verify-persistence",
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
  const weekRaw = (body as { week?: unknown })?.week;
  const week =
    typeof weekRaw === "number" && Number.isFinite(weekRaw) && weekRaw >= 1
      ? Math.trunc(weekRaw)
      : undefined;
  const weeksRaw = (body as { weeks?: unknown })?.weeks;
  const weeks = Array.isArray(weeksRaw)
    ? weeksRaw
        .filter(
          (w): w is number =>
            typeof w === "number" && Number.isFinite(w) && w >= 1 && w <= 22,
        )
        .map((w) => Math.trunc(w))
    : undefined;
  // Season-runner inputs: season, startWeek, endWeek. All
  // optional — the runner falls back to defaults when omitted.
  const seasonRaw = (body as { season?: unknown })?.season;
  const startWeekRaw = (body as { startWeek?: unknown })?.startWeek;
  const endWeekRaw = (body as { endWeek?: unknown })?.endWeek;
  const season =
    typeof seasonRaw === "number" && Number.isFinite(seasonRaw)
      ? Math.trunc(seasonRaw)
      : undefined;
  const startWeek =
    typeof startWeekRaw === "number" &&
    Number.isFinite(startWeekRaw) &&
    startWeekRaw >= 1 &&
    startWeekRaw <= 22
      ? Math.trunc(startWeekRaw)
      : undefined;
  const endWeek =
    typeof endWeekRaw === "number" &&
    Number.isFinite(endWeekRaw) &&
    endWeekRaw >= 1 &&
    endWeekRaw <= 22
      ? Math.trunc(endWeekRaw)
      : undefined;
  const result = await runAdminAction({
    action,
    confirmText:
      typeof confirmText === "string" ? confirmText : undefined,
    week,
    weeks,
    season,
    startWeek,
    endWeek,
  });

  return NextResponse.json(result, {
    status: result.status === "skipped" ? 422 : result.ok ? 200 : 500,
  });
}
