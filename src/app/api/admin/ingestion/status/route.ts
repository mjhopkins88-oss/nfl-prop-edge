/**
 * GET /api/admin/ingestion/status
 *
 * Returns the page-state booleans + latest action summary. Every
 * field is non-secret. The API key, admin token, and raw HTTP
 * bodies are never included.
 */

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
import { buildReadinessReport } from "../../../../../../scripts/check-real-week-1-readiness";

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

  const state = readAdminState();
  const stored = inspectStoredWeek1OddsOnDisk();
  const readiness = buildReadinessReport({ season: 2025, week: 1 });

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
    },
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
