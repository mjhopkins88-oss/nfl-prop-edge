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
import {
  getPersistenceClient,
  rehydrateCanonicalOddsFromDbIfMissing,
} from "@/lib/persistence/week-1-persistence";
import { loadStoredWeek1MonitorSnapshot } from "@/lib/backtest/week-1-monitor-summary";
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
  // Persistence layer: load DB state (when DATABASE_URL is set)
  // and merge it with the file state. DB wins when both exist —
  // it's the durable source. File acts as cache.
  const persistence = await getPersistenceClient();
  const dbAvailable = persistence.isAvailable();
  // Ping the DB before reading anything else. A failed ping
  // tells us tables aren't created — persistence is effectively
  // a no-op even if DATABASE_URL is set.
  const ping = dbAvailable
    ? await persistence.ping()
    : { ok: false, tablesReady: false, error: "DATABASE_URL unset" as string };
  // Row counts feed the persistence diagnostic panel. Cheap —
  // four COUNT(*) queries.
  const countsResult = dbAvailable && ping.tablesReady
    ? await persistence.countPersistence({ season: 2025, week: 1 })
    : { ok: false, counts: undefined };
  const counts = countsResult.counts;
  // Auto-rehydrate the canonical odds file from DB if missing
  // BEFORE readiness check. Otherwise readiness still reports
  // the file as missing even though the DB has the rows.
  const rehydration =
    dbAvailable && ping.tablesReady
      ? await rehydrateCanonicalOddsFromDbIfMissing({
          season: 2025,
          week: 1,
          client: persistence,
        })
      : { rehydrated: false, source: "missing" as const };
  const stored = inspectStoredWeek1OddsOnDisk();
  const readiness = buildReadinessReport({ season: 2025, week: 1 });
  // Resolve the page's primary booleans against BOTH the
  // refreshed file (post-rehydration) AND the DB row count.
  // Either source proving the data exists is enough.
  const dbHasOdds = (counts?.storedPropMarketRows ?? 0) > 0;
  const dbHasBacktest = (counts?.storedBacktestRuns ?? 0) > 0;
  const storedWeek1OddsResolved = !readiness.missingStoredOdds || dbHasOdds;
  const realWeek1BacktestReadyResolved =
    readiness.realWeek1BacktestReady || dbHasBacktest;
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

  // Per-week status — selected via ?week=N. When omitted or
  // invalid, defaults to the global response only. Used by the
  // admin UI's multi-week section so the operator can see the
  // exact state for the week they're about to run.
  const url = new URL(request.url);
  const weekParam = url.searchParams.get("week");
  const targetWeek = (() => {
    if (!weekParam) return undefined;
    const n = Number(weekParam);
    if (!Number.isFinite(n) || n < 1 || n > 22) return undefined;
    return Math.trunc(n);
  })();
  const selectedWeek = targetWeek
    ? await (async () => {
        const snap = await loadStoredWeek1MonitorSnapshot({
          season: 2025,
          week: targetWeek,
          client: persistence,
        });
        if (!snap) {
          return {
            week: targetWeek,
            present: false,
            storedOddsPresent: false,
            candidateCount: 0,
            backtestReady: false,
            gradingStatus: "unavailable" as const,
            asOfOk: null as boolean | null,
            asOfValid: 0,
            asOfChecked: 0,
            recommendedPlaysCount: 0,
            note: "No stored backtest data for this week yet.",
          };
        }
        return {
          week: targetWeek,
          present: true,
          source: snap.source,
          storedOddsPresent: snap.storedOddsPresent,
          processedNflPresent: snap.processedNflPresent,
          status: snap.status,
          candidateCount: snap.candidateCount,
          scheduleValidationStatus: snap.scheduleValidationStatus,
          backtestReady: snap.realWeek1BacktestReady,
          gradingStatus: snap.gradingStatus,
          asOfOk: snap.graded?.asOfReport?.ok ?? null,
          asOfValid: snap.graded?.asOfReport?.candidatesValid ?? 0,
          asOfChecked: snap.graded?.asOfReport?.candidatesChecked ?? 0,
          recommendedPlaysCount: snap.graded?.recommendedPlays.enabled
            ? snap.graded.recommendedPlays.count
            : 0,
          note: null,
        };
      })()
    : null;

  return NextResponse.json({
    ok: true,
    selectedWeek,
    configuration: {
      oddsApiKeyConfigured: isOddsApiKeyConfigured(),
      adminTokenConfigured: isAdminTokenConfigured(),
      allowRealOddsApiCalls: isAllowRealOddsCalls(),
    },
    data: {
      processedNflDataPresent: !readiness.missingProcessedNfl,
      // DB rows OR file present → odds available. The previous
      // implementation reported "missing" whenever the file was
      // gone, even when Postgres still had the rows.
      storedWeek1OddsPresent: storedWeek1OddsResolved,
      storedWeek1OddsLegacyPresent: stored.legacy.present,
      storedWeek1OddsCanonicalPresent: stored.canonical.present,
      // DB run OR file mirror → backtest ready. Same logic.
      realWeek1BacktestReady: realWeek1BacktestReadyResolved,
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
      dbConfigured: typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0,
      prismaTablesReady: ping.tablesReady,
      pingError: ping.tablesReady ? null : ping.error ?? null,
      stateSource,
      // If we just rehydrated the canonical file from DB, label
      // the source clearly so the page can show it. Otherwise
      // keep the existing label logic.
      oddsSource: rehydration.rehydrated ? "postgres-rehydrated" : oddsSource,
      backtestSource,
      dbStateNote,
      counts: counts
        ? {
            storedPropMarketRows: counts.storedPropMarketRows,
            storedBacktestRuns: counts.storedBacktestRuns,
            oddsIngestionRuns: counts.oddsIngestionRuns,
            adminStateExists: counts.adminStateExists,
          }
        : null,
      rehydration: {
        rehydrated: rehydration.rehydrated,
        source: rehydration.source,
        rowsRestored:
          "rowsRestored" in rehydration ? rehydration.rowsRestored : undefined,
      },
    },
    calibration: readCalibrationResult(),
    nextRecommendedAction: recommendNext({
      configuration: {
        oddsApiKeyConfigured: isOddsApiKeyConfigured(),
        allowRealOddsApiCalls: isAllowRealOddsCalls(),
      },
      data: {
        processedNflDataPresent: !readiness.missingProcessedNfl,
        storedWeek1OddsPresent: storedWeek1OddsResolved,
      },
      state,
      persistence: {
        canonicalFilePresent: stored.canonical.present,
        legacyFilePresent: stored.legacy.present,
        dbHasOdds,
        dbHasBacktest,
        dbAvailable,
      },
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
  persistence: {
    canonicalFilePresent: boolean;
    legacyFilePresent: boolean;
    dbHasOdds: boolean;
    dbHasBacktest: boolean;
    dbAvailable: boolean;
  };
}): string {
  if (!s.data.processedNflDataPresent) {
    return "Run the free nflverse ingestion to populate data/processed/nfl/ before any paid step.";
  }
  // Persistence-aware odds-recovery path. The previous logic
  // recommended "run full paid ingestion" whenever the file was
  // gone, even after a successful paid run had persisted to
  // Postgres. Now the DB row count gets first say.
  if (!s.persistence.canonicalFilePresent && s.persistence.dbHasOdds) {
    return "Canonical odds rehydrated from Postgres. Run the Week 1 stored backtest.";
  }
  if (s.persistence.canonicalFilePresent && !s.persistence.dbHasOdds && s.persistence.dbAvailable) {
    return "Canonical odds file exists but Postgres has zero rows — run Migrate to persist to DB before the next redeploy.";
  }
  if (
    !s.persistence.canonicalFilePresent &&
    !s.persistence.dbHasOdds &&
    s.persistence.legacyFilePresent
  ) {
    return "Legacy prop_markets.csv present but canonical + DB empty — run Migrate to populate both.";
  }
  if (
    !s.persistence.canonicalFilePresent &&
    !s.persistence.legacyFilePresent &&
    !s.persistence.dbHasOdds
  ) {
    // Truly no data anywhere — only NOW is paid ingestion the
    // right recommendation. But only after the prior smoke + Week 1
    // success have run, because that's how this state should occur.
    if (!s.configuration.oddsApiKeyConfigured) {
      return "Set ODDS_API_KEY in this environment before any paid action.";
    }
    if (!s.configuration.allowRealOddsApiCalls) {
      return "Paid odds data missing from file AND DB. Set ALLOW_REAL_ODDS_API_CALLS=true and re-run the paid pipeline (or restore from backup).";
    }
    if (!s.state.smokeSucceededAt) {
      return "Run the paid smoke test (confirmText: RUN PAID SMOKE TEST).";
    }
    return "Paid odds data missing from file AND DB — rerun paid Week 1 ingestion (confirmText: RUN FULL WEEK 1 INGESTION 647 CREDITS) or restore from backup.";
  }
  // Odds present (in file, DB, or both). Now recommend based on
  // backtest state.
  if (!s.persistence.dbHasBacktest) {
    return "Run the Week 1 stored backtest.";
  }
  return "Stored backtest persisted. Grade Week 1 next (admin action #9) or refresh /backtest/week-1.";
}
