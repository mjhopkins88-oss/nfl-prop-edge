/**
 * Per-week stored-data grading pipeline — extracted as a pure
 * async function so the admin `grade-week-stored` action and
 * the season-level runner share one path.
 *
 * Sequence (each step is read-only or DB-persist-only — no paid
 * API call, no model logic change):
 *   1. Rebuild candidates from stored odds (via
 *      buildRealWeek1CandidatesFromStoredData).
 *   2. Load processed player_week_stats.csv (strict-before is
 *      enforced inside buildPlayerHistoryByName).
 *   3. Best-effort load team_week_stats.csv (for the WR PROE
 *      signal; the run still succeeds when missing).
 *   4. Apply the V1 scorecard to every candidate.
 *   5. Validate as-of fairness — abort the week when any
 *      candidate's odds were captured at/after kickoff or any
 *      attached history row leaks future data.
 *   6. Grade against actual outcomes.
 *   7. Build scorecard / market-context-calibration / diagnostic
 *      qualification audits.
 *   8. Persist to StoredBacktestRun (DB + file mirror) using
 *      the exact same shape the admin action persists.
 *
 * The function returns structured success / failure data; the
 * caller composes any operator-facing strings. Failure modes
 * return ok=false with a typed reason — they never throw.
 */

import fs from "node:fs";
import path from "node:path";
import { buildRealWeek1CandidatesFromStoredData } from "./real-week-candidate-builder";
import {
  gradeStoredWeek1Backtest,
  buildScorecardAudit,
  type GradeResult,
  type ScorecardAudit,
} from "./week-1-grading";
import {
  buildMarketContextCalibration,
  type MarketContextCalibrationReplay,
} from "./market-context-calibration";
import {
  buildDiagnosticQualificationAudit,
  bucketScoresFromEvaluatedCandidates,
  type DiagnosticQualificationAudit,
} from "./diagnostic-qualification-audit";
import {
  validateAsOfFairness,
  type AsOfValidationReport,
} from "./as-of-validation";
import {
  loadProcessedPlayerWeekStatsStrict,
  loadProcessedTeamWeekStatsStrict,
} from "./processed-nfl-loader";
import {
  applyScorecardToCandidates,
  buildPlayerHistoryByName,
  type EvaluatedRealWeekCandidate,
} from "./stored-candidate-scorecard";
import type { PersistenceClient } from "../persistence/week-1-persistence";

export type GradeStoredWeekFailureReason =
  | "candidate-builder-failed"
  | "missing-player-stats"
  | "as-of-fairness-failed"
  | "persistence-failed";

export interface GradeStoredWeekPipelineSuccess {
  ok: true;
  season: number;
  week: number;
  candidateCount: number;
  evaluatedCandidates: EvaluatedRealWeekCandidate[];
  asOfReport: AsOfValidationReport;
  grade: GradeResult;
  scorecardAudit: ScorecardAudit;
  marketContextCalibration: MarketContextCalibrationReplay;
  diagnosticQualificationAudit: DiagnosticQualificationAudit;
  dbSaved: boolean;
  dbError?: string;
  gradedFilePath: string;
  scheduleValidationStatus: string;
}

export interface GradeStoredWeekPipelineFailure {
  ok: false;
  season: number;
  week: number;
  reason: GradeStoredWeekFailureReason;
  detail: string;
  /** Populated when the failure was triggered AFTER candidates
   *  were built — lets callers report partial progress. */
  candidateBuilderStatus?: string;
  asOfReport?: AsOfValidationReport;
}

export type GradeStoredWeekPipelineResult =
  | GradeStoredWeekPipelineSuccess
  | GradeStoredWeekPipelineFailure;

export interface GradeStoredWeekPipelineArgs {
  season: number;
  week: number;
  repoRoot: string;
  persistence: PersistenceClient;
  /** Write the file-mirror snapshot. Defaults to true; the
   *  season runner can set it to false when looping many weeks
   *  to avoid 18 disk writes per run. */
  writeFileMirror?: boolean;
}

/**
 * Run the per-week stored-data grading pipeline. Pure — no
 * paid API call, no model-logic mutation, no threshold change.
 * The function reads stored odds + processed nflverse data and
 * persists results to Postgres (+ optional file mirror).
 *
 * Strict-before is enforced by `buildPlayerHistoryByName` and
 * is re-confirmed by `validateAsOfFairness`. A week whose
 * as-of check fails returns failure WITHOUT persisting — the
 * row is not saved, so a future replay won't show stale data
 * either.
 */
export async function gradeStoredWeekPipeline(
  args: GradeStoredWeekPipelineArgs,
): Promise<GradeStoredWeekPipelineResult> {
  const writeFileMirror = args.writeFileMirror ?? true;
  const built = buildRealWeek1CandidatesFromStoredData({
    season: args.season,
    week: args.week,
    processedRoot: path.join(args.repoRoot, "data", "processed"),
  });
  if (built.status !== "READY") {
    return {
      ok: false,
      season: args.season,
      week: args.week,
      reason: "candidate-builder-failed",
      detail: built.notes.join("\n") || `Candidate builder status: ${built.status}`,
      candidateBuilderStatus: built.status,
    };
  }
  const stats = loadProcessedPlayerWeekStatsStrict(
    path.join(args.repoRoot, "data", "processed", "nfl"),
  );
  if (stats.status !== "READY") {
    return {
      ok: false,
      season: args.season,
      week: args.week,
      reason: "missing-player-stats",
      detail: `processed player_week_stats.csv missing at ${stats.source}.`,
    };
  }
  const playerHistoryByName = buildPlayerHistoryByName({
    candidates: built.candidates,
    season: args.season,
    week: args.week,
    playerWeekStats: stats.rows,
  });
  const teamStats = loadProcessedTeamWeekStatsStrict(
    path.join(args.repoRoot, "data", "processed", "nfl"),
  );
  const teamHistory =
    teamStats.status === "READY" ? teamStats.rows : undefined;
  const evaluatedCandidates = applyScorecardToCandidates({
    candidates: built.candidates,
    playerHistoryByName,
    teamHistory,
  });
  const asOfReport = validateAsOfFairness({
    candidates: evaluatedCandidates,
    season: args.season,
    week: args.week,
    playerHistoryByName,
  });
  if (!asOfReport.ok) {
    return {
      ok: false,
      season: args.season,
      week: args.week,
      reason: "as-of-fairness-failed",
      detail: `${asOfReport.candidatesInvalid}/${asOfReport.candidatesChecked} candidates invalid — see asOfReport.sampleInvalid.`,
      asOfReport,
    };
  }
  const grade = gradeStoredWeek1Backtest({
    candidates: evaluatedCandidates,
    season: args.season,
    week: args.week,
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
  const marketContextCalibration = buildMarketContextCalibration({
    candidates: evaluatedCandidates,
    graded: grade.graded,
  });
  const diagnosticQualificationAudit = buildDiagnosticQualificationAudit({
    replay: marketContextCalibration,
    bucketScoresByCandidateId:
      bucketScoresFromEvaluatedCandidates(evaluatedCandidates),
  });
  const dbSave = await args.persistence.saveStoredBacktestRunToDb({
    season: args.season,
    week: args.week,
    dataMode: "stored",
    status: built.status,
    realWeek1BacktestReady: true,
    scheduleValidationStatus: built.scheduleReport?.status ?? "PASS",
    syntheticFixture: false,
    candidatesJson: {
      candidates: evaluatedCandidates.slice(0, 500),
    },
    resultsJson: {
      summary: grade.summary,
      gradedSampleSize: grade.graded.length,
      gradedSample: grade.graded.slice(0, 100),
      asOfReport,
      scorecardAudit,
      marketContextCalibration,
      diagnosticQualificationAudit,
    },
  });
  const gradedFilePath = path.join(
    args.repoRoot,
    "data",
    "backtests",
    String(args.season),
    `week-${args.week}-graded-summary.fixture.json`,
  );
  if (writeFileMirror) {
    fs.mkdirSync(path.dirname(gradedFilePath), { recursive: true });
    fs.writeFileSync(
      gradedFilePath,
      JSON.stringify(
        {
          gradedAt: grade.summary.gradedAt,
          season: args.season,
          week: args.week,
          summary: grade.summary,
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
  }
  return {
    ok: true,
    season: args.season,
    week: args.week,
    candidateCount: built.candidates.length,
    evaluatedCandidates,
    asOfReport,
    grade,
    scorecardAudit,
    marketContextCalibration,
    diagnosticQualificationAudit,
    dbSaved: dbSave.ok,
    dbError: dbSave.ok ? undefined : dbSave.error,
    gradedFilePath,
    scheduleValidationStatus:
      built.scheduleReport?.status ?? "PASS",
  };
}
