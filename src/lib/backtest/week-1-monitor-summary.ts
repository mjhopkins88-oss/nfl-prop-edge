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

export interface GradedSideSnapshot {
  wins: number;
  losses: number;
  pushes: number;
  graded: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

export interface GradedSnapshot {
  gradedAt: string;
  totalCandidates: number;
  candidatesWithActual: number;
  candidatesMissingActual: number;
  qualifiedPlays: number;
  overSide: GradedSideSnapshot;
  underSide: GradedSideSnapshot;
  betterSide: "OVER" | "UNDER" | "TIE";
}

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
  /** "graded" when the admin grade-week1-stored action has run,
   *  "ungraded" while only pregame candidates exist. */
  gradingStatus: "ungraded" | "graded" | "unavailable";
  /** Populated when gradingStatus === "graded". */
  graded?: GradedSnapshot;
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

interface GradedFileShape {
  gradedAt: string;
  season: number;
  week: number;
  summary: {
    totalCandidates: number;
    candidatesWithActual: number;
    candidatesMissingActual: number;
    qualifiedPlays: number;
    betterSide: "OVER" | "UNDER" | "TIE";
    overSide: {
      wins: number;
      losses: number;
      pushes: number;
      graded: number;
      hitRate: number;
      roiPct: number;
      unitsProfit: number;
    };
    underSide: {
      wins: number;
      losses: number;
      pushes: number;
      graded: number;
      hitRate: number;
      roiPct: number;
      unitsProfit: number;
    };
  };
}

function readGradedFile(
  season: number,
  week: number,
): GradedFileShape | undefined {
  const p = path.join(
    process.cwd(),
    "data",
    "backtests",
    String(season),
    `week-${week}-graded-summary.fixture.json`,
  );
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as GradedFileShape;
  } catch {
    return undefined;
  }
}

function toGradedSnapshot(g: GradedFileShape | undefined): GradedSnapshot | undefined {
  if (!g) return undefined;
  return {
    gradedAt: g.gradedAt,
    totalCandidates: g.summary.totalCandidates,
    candidatesWithActual: g.summary.candidatesWithActual,
    candidatesMissingActual: g.summary.candidatesMissingActual,
    qualifiedPlays: g.summary.qualifiedPlays,
    betterSide: g.summary.betterSide,
    overSide: {
      wins: g.summary.overSide.wins,
      losses: g.summary.overSide.losses,
      pushes: g.summary.overSide.pushes,
      graded: g.summary.overSide.graded,
      hitRatePct: g.summary.overSide.hitRate * 100,
      roiPct: g.summary.overSide.roiPct,
      unitsProfit: g.summary.overSide.unitsProfit,
    },
    underSide: {
      wins: g.summary.underSide.wins,
      losses: g.summary.underSide.losses,
      pushes: g.summary.underSide.pushes,
      graded: g.summary.underSide.graded,
      hitRatePct: g.summary.underSide.hitRate * 100,
      roiPct: g.summary.underSide.roiPct,
      unitsProfit: g.summary.underSide.unitsProfit,
    },
  };
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
      // Graded summary lives in resultsJson when the
      // grade-week1-stored action has run. Fall back to the
      // file mirror so a redeploy that wipes only one source
      // still finds the data.
      const resultsJson = run.resultsJson as
        | { summary?: GradedFileShape["summary"] }
        | null
        | undefined;
      const dbGraded = resultsJson?.summary
        ? toGradedSnapshot({
            gradedAt: new Date().toISOString(),
            season: args.season,
            week: args.week,
            summary: resultsJson.summary,
          })
        : undefined;
      const fileGraded = toGradedSnapshot(
        readGradedFile(args.season, args.week),
      );
      const graded = dbGraded ?? fileGraded;
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
        gradingStatus: graded ? "graded" : "ungraded",
        graded,
        notes: [],
      };
    }
  }
  const file = readFile(args.season, args.week);
  if (file && file.dataMode === "stored") {
    const graded = toGradedSnapshot(readGradedFile(args.season, args.week));
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
      gradingStatus: graded ? "graded" : "ungraded",
      graded,
      notes: file.notes ?? [],
    };
  }
  return undefined;
}
