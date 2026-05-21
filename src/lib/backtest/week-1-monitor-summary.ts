/**
 * Latest stored Week-1 backtest snapshot used by `/monitor` and
 * `/backtest/week-1`. Reads the persistence layer first
 * (Postgres `StoredBacktestRun`), then the file mirror
 * (`data/backtests/2025/week-1-data-mode-status.fixture.json`),
 * then nothing. Either source survives a Railway redeploy.
 *
 *   · The DB row carries everything we need (status,
 *     candidatesJson, realWeek1BacktestReady, scheduleValidation
 *     Status, syntheticFixture, dataMode).
 *   · The file mirror is written by both
 *     `scripts/run-week-1-starter-test.ts --data-mode stored`
 *     and the admin `stored-backtest` action.
 *
 * Pure file IO + persistence client read. No paid API call.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getPersistenceClient,
  type PersistenceClient,
} from "../persistence/week-1-persistence";

export interface StoredWeek1MonitorSnapshot {
  /** Where the data came from. `"none"` means neither source
   *  had a stored run; the caller should fall back to fixture
   *  starter-test data. */
  source: "postgres" | "file";
  /** ISO string when the source generated this snapshot. */
  generatedAt?: string;
  /** Always "stored" — fixture sources go through a different
   *  loader. */
  dataMode: "stored";
  /** Status from the candidate builder: READY,
   *  MISSING_STORED_ODDS, MISSING_PROCESSED_NFL,
   *  SCHEDULE_VALIDATION_FAILED, NO_CANDIDATES_AFTER_FILTER. */
  status: string;
  candidateCount: number;
  /** Whether the schedule-validation report passed. PASS / FAIL /
   *  SYNTHETIC_ONLY / unknown. */
  scheduleValidationStatus: string | null;
  /** `true` when status === "READY". */
  realWeek1BacktestReady: boolean;
  /** Always `false` for a stored snapshot — that's the whole
   *  point. Kept as a literal type to make page logic
   *  exhaustive. */
  syntheticFixture: false;
  storedOddsPresent: boolean;
  processedNflPresent: boolean;
  missingStoredOdds: boolean;
  missingProcessedNfl: boolean;
  /** No graded outcomes exist yet — stored mode only generates
   *  pregame candidates. `"graded"` is reserved for the future
   *  when graded results land in the DB. */
  gradingStatus: "ungraded" | "graded" | "unavailable";
  notes: string[];
}

interface FileShape {
  generatedAt?: string;
  season: number;
  week: number;
  dataMode: "stored" | "fixture";
  status: string;
  candidateCount: number;
  syntheticFixture: boolean;
  realWeek1BacktestReady: boolean;
  missingStoredOdds: boolean;
  missingProcessedNfl: boolean;
  scheduleReport?: { status?: string | null } | null;
  notes?: string[];
}

function readFile(season: number, week: number): FileShape | undefined {
  const p = path.join(
    process.cwd(),
    "data",
    "backtests",
    String(season),
    `week-${week}-data-mode-status.fixture.json`,
  );
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as FileShape;
  } catch {
    return undefined;
  }
}

/**
 * Load the latest stored Week-1 snapshot. Returns `undefined`
 * when neither Postgres nor the file mirror has a stored run,
 * letting the caller fall back to fixture starter-test data.
 */
export async function loadStoredWeek1MonitorSnapshot(args: {
  season: number;
  week: number;
  /** Inject a persistence client for tests. */
  client?: PersistenceClient;
}): Promise<StoredWeek1MonitorSnapshot | undefined> {
  const client = args.client ?? (await getPersistenceClient());
  if (client.isAvailable()) {
    const dbRun = await client.loadLatestStoredBacktestRunFromDb({
      season: args.season,
      week: args.week,
    });
    if (dbRun.ok && dbRun.run) {
      const run = dbRun.run;
      const candidatesJson = run.candidatesJson as
        | { candidates?: unknown[] }
        | null
        | undefined;
      const candidateCount = Array.isArray(candidatesJson?.candidates)
        ? candidatesJson.candidates.length
        : 0;
      const status = String(run.status);
      const ready = run.realWeek1BacktestReady === true;
      const missingStoredOdds = status === "MISSING_STORED_ODDS";
      const missingProcessedNfl = status === "MISSING_PROCESSED_NFL";
      return {
        source: "postgres",
        dataMode: "stored",
        status,
        candidateCount,
        scheduleValidationStatus: run.scheduleValidationStatus ?? null,
        realWeek1BacktestReady: ready,
        syntheticFixture: false,
        storedOddsPresent: !missingStoredOdds,
        processedNflPresent: !missingProcessedNfl,
        missingStoredOdds,
        missingProcessedNfl,
        gradingStatus: "ungraded",
        notes: [],
      };
    }
  }
  const file = readFile(args.season, args.week);
  if (file && file.dataMode === "stored") {
    return {
      source: "file",
      generatedAt: file.generatedAt,
      dataMode: "stored",
      status: file.status,
      candidateCount: file.candidateCount,
      scheduleValidationStatus: file.scheduleReport?.status ?? null,
      realWeek1BacktestReady: file.realWeek1BacktestReady,
      syntheticFixture: false,
      storedOddsPresent: !file.missingStoredOdds,
      processedNflPresent: !file.missingProcessedNfl,
      missingStoredOdds: file.missingStoredOdds,
      missingProcessedNfl: file.missingProcessedNfl,
      gradingStatus: "ungraded",
      notes: file.notes ?? [],
    };
  }
  return undefined;
}
