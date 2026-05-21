/**
 * GET /api/admin/ingestion/status
 *
 * Returns the page-state booleans + latest action summary. Every
 * field is non-secret. The API key, admin token, and raw HTTP
 * bodies are never included.
 */

import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  isAdminTokenConfigured,
  readAdminTokenFromHeaders,
  verifyAdminToken,
} from "@/lib/admin/admin-auth";
import { readAdminState } from "@/lib/admin/admin-state";
import {
  inspectStoredWeek1OddsOnDisk,
  isAllowRealOddsCalls,
  isOddsApiKeyConfigured,
} from "@/lib/admin/admin-runner";
import { getPersistenceClient } from "@/lib/persistence/week-1-persistence";
import { buildReadinessReport } from "../../../../../../scripts/check-real-week-1-readiness";

function readCalibrationResult(): Record<string, unknown> | null {
  const p = path.join(
    process.cwd(),
    "data",
    "admin-ingestion",
    "latest-odds-calibration.json",
  );
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const token = readAdminTokenFromHeaders(request.headers);
  if (!verifyAdminToken(token)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const fileState = readAdminState();
  const stored = inspectStoredWeek1OddsOnDisk();
  const readiness = buildReadinessReport({ season: 2025, week: 1 });

  // Persistence layer: load DB state (when DATABASE_URL is set)
  // and merge it with the file state. DB wins when both exist —
  // it's the durable source. File acts as cache.
  const persistence = await getPersistenceClient();
  const dbAvailable = persistence.isAvailable();
  let stateSource: "postgres" | "file" | "missing" = "missing";
  let oddsSource: "postgres-rehydration-pending" | "file" | "legacy" | "missing" =
    "missing";
  let backtestSource: "postgres" | "file" | "missing" = "missing";
  let state = fileState;
  let dbStateNote: string | null = null;
  if (dbAvailable) {
    const dbState = await persistence.loadAdminIngestionStateFromDb();
    if (dbState.ok && dbState.state) {
      // Merge DB state into file state, DB wins where set.
      state = {
        ...fileState,
        smokeSucceededAt:
          dbState.state.smokeSucceededAt ?? fileState.smokeSucceededAt,
        smokeCreditsUsed:
          dbState.state.smokeCreditsUsed ?? fileState.smokeCreditsUsed,
        week1IngestionSucceededAt:
          dbState.state.week1IngestionSucceededAt ??
          fileState.week1IngestionSucceededAt,
        week1SubsetSucceededAt:
          dbState.state.week1SubsetSucceededAt ??
          fileState.week1SubsetSucceededAt,
        week1SubsetCreditsUsed:
          dbState.state.week1SubsetCreditsUsed ??
          fileState.week1SubsetCreditsUsed,
        lastAction:
          (dbState.state.lastAction as typeof fileState.lastAction) ??
          fileState.lastAction,
        lastTimestamp: dbState.state.lastTimestamp ?? fileState.lastTimestamp,
        lastSummary: dbState.state.lastSummary ?? fileState.lastSummary,
      };
      stateSource = "postgres";
    } else if (!dbState.ok) {
      dbStateNote = dbState.error ?? "DB read failed";
      stateSource =
        fileState.smokeSucceededAt ||
        fileState.week1IngestionSucceededAt ||
        fileState.lastAction
          ? "file"
          : "missing";
    } else {
      stateSource =
        fileState.smokeSucceededAt ||
        fileState.week1IngestionSucceededAt ||
        fileState.lastAction
          ? "file"
          : "missing";
    }
    // Odds source: file present, or DB has rows (would rehydrate
    // on demand), or legacy fallback, or nothing.
    if (stored.canonical.present) {
      oddsSource = "file";
    } else {
      const oddsCheck = await persistence.loadCanonicalOddsRowsFromDb({
        season: 2025,
        week: 1,
      });
      if (oddsCheck.ok && oddsCheck.rows.length > 0) {
        oddsSource = "postgres-rehydration-pending";
      } else if (stored.legacy.present) {
        oddsSource = "legacy";
      }
    }
    const dbRun = await persistence.loadLatestStoredBacktestRunFromDb({
      season: 2025,
      week: 1,
    });
    backtestSource =
      dbRun.ok && dbRun.run
        ? "postgres"
        : fs.existsSync(
              path.join(
                process.cwd(),
                "data",
                "backtests",
                "2025",
                "week-1-data-mode-status.fixture.json",
              ),
            )
          ? "file"
          : "missing";
  } else {
    stateSource =
      fileState.smokeSucceededAt ||
      fileState.week1IngestionSucceededAt ||
      fileState.lastAction
        ? "file"
        : "missing";
    if (stored.canonical.present) oddsSource = "file";
    else if (stored.legacy.present) oddsSource = "legacy";
    backtestSource = fs.existsSync(
      path.join(
        process.cwd(),
        "data",
        "backtests",
        "2025",
        "week-1-data-mode-status.fixture.json",
      ),
    )
      ? "file"
      : "missing";
  }

  return NextResponse.json({
    ok: true,
    configuration: {
      oddsApiKeyConfigured: isOddsApiKeyConfigured(),
      adminTokenConfigured: isAdminTokenConfigured(),
      allowRealOddsApiCalls: isAllowRealOddsCalls(),
    },
    data: {
      processedNflDataPresent: !readiness.missingProcessedNfl,
      storedWeek1OddsPresent: !readiness.missingStoredOdds,
      storedWeek1OddsLegacyPresent: stored.legacy.present,
      storedWeek1OddsCanonicalPresent: stored.canonical.present,
      realWeek1BacktestReady: readiness.realWeek1BacktestReady,
      readinessStatus: readiness.status,
      missingFiles: readiness.missingFiles,
      nextCommandRequiresPaidApi: readiness.nextCommandRequiresPaidApi,
    },
    state: {
      lastAction: state.lastAction ?? null,
      lastResult: state.lastResult ?? null,
      lastTimestamp: state.lastTimestamp ?? null,
      lastSummary: state.lastSummary ?? null,
      smokeSucceededAt: state.smokeSucceededAt ?? null,
      smokeCreditsUsed: state.smokeCreditsUsed ?? null,
      week1IngestionSucceededAt: state.week1IngestionSucceededAt ?? null,
      lastPaidSmokeAttemptAt: state.lastPaidSmokeAttemptAt ?? null,
      lastPaidSmokeResult: state.lastPaidSmokeResult ?? null,
      lastPaidSmokeCreditsUsed: state.lastPaidSmokeCreditsUsed ?? null,
      lastPaidSmokeReason: state.lastPaidSmokeReason ?? null,
    },
    persistence: {
      databaseUrlConfigured: typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0,
      dbAvailable,
      stateSource,
      oddsSource,
      backtestSource,
      dbStateNote,
    },
    calibration: readCalibrationResult(),
    nextRecommendedAction: recommendNext({
      configuration: {
        oddsApiKeyConfigured: isOddsApiKeyConfigured(),
        allowRealOddsApiCalls: isAllowRealOddsCalls(),
      },
      data: {
        processedNflDataPresent: !readiness.missingProcessedNfl,
        storedWeek1OddsPresent: !readiness.missingStoredOdds,
      },
      state,
    }),
    guardrails: {
      noTouchdownProps: true,
      noAutomatedBetting: true,
      noKalshiIntegration: true,
      starterMarketsOnly: [
        "player_pass_attempts",
        "player_pass_completions",
        "player_receptions",
        "player_rush_attempts",
      ],
    },
  });
}

function recommendNext(s: {
  configuration: { oddsApiKeyConfigured: boolean; allowRealOddsApiCalls: boolean };
  data: { processedNflDataPresent: boolean; storedWeek1OddsPresent: boolean };
  state: { smokeSucceededAt?: string; week1IngestionSucceededAt?: string };
}): string {
  if (!s.data.processedNflDataPresent) {
    return "Run the free nflverse ingestion to populate data/processed/nfl/ before any paid step.";
  }
  if (!s.configuration.oddsApiKeyConfigured) {
    return "Set ODDS_API_KEY in this environment before any paid action.";
  }
  if (!s.configuration.allowRealOddsApiCalls) {
    return "Run the dry-run smoke first. Paid actions require ALLOW_REAL_ODDS_API_CALLS=true.";
  }
  if (!s.state.smokeSucceededAt) {
    return "Run the paid smoke test (confirmText: RUN PAID SMOKE TEST).";
  }
  if (!s.state.week1IngestionSucceededAt && !s.data.storedWeek1OddsPresent) {
    return "Run the paid Week 1 ingestion (confirmText: RUN WEEK 1 PAID INGESTION).";
  }
  return "Run the Week 1 stored backtest.";
}
