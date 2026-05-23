/**
 * Season-level stored-data backtest runner.
 *
 * Loops every week in [startWeek, endWeek] and runs the same
 * per-week grading pipeline the admin `grade-week-stored`
 * action uses. Each week is graded INDEPENDENTLY using only
 * data available before that week — the strict-before
 * discipline is enforced by `buildPlayerHistoryByName` and
 * re-confirmed by `validateAsOfFairness` inside the per-week
 * pipeline.
 *
 *   For each week W:
 *     · load stored odds snapshots (already filtered to
 *       snapshotTime < kickoffTime by the canonical writer)
 *     · build candidates
 *     · compute features with strict-before history
 *     · apply scorecard + calibration (unchanged)
 *     · grade against actual outcomes
 *     · persist per-week row to Postgres + file mirror
 *
 *   After every week is processed:
 *     · load all weeks' snapshots back from persistence
 *     · build season-aggregate report (see
 *       `season-aggregate-report.ts`)
 *
 * The runner NEVER mutates the persisted rows in-place across
 * weeks — each week's grade replaces only that week's row.
 * Aggregation reads the latest persisted snapshots back in
 * one DB round trip and produces the season-level report.
 *
 * Pure async function. No paid API call. No model-logic
 * mutation. No threshold change.
 */

import {
  gradeStoredWeekPipeline,
  type GradeStoredWeekPipelineResult,
} from "./grade-stored-week-pipeline";
import {
  loadAllStoredMonitorSnapshots,
  type StoredWeekSnapshot,
} from "./week-1-monitor-summary";
import {
  buildSeasonAggregateReport,
  type SeasonAggregateReport,
} from "./season-aggregate-report";
import type { PersistenceClient } from "../persistence/week-1-persistence";

export interface SeasonBacktestPerWeekRow {
  season: number;
  week: number;
  ok: boolean;
  /** Failure reason when ok=false; preserved so the summary
   *  can explain which weeks didn't grade. */
  failureReason?: string;
  failureDetail?: string;
  candidateCount: number;
  /** Recommended-plays (model-qualified) numbers when ok=true. */
  qualifiedCount?: number;
  wins?: number;
  losses?: number;
  pushes?: number;
  hitRatePct?: number;
  roiPct?: number;
  unitsProfit?: number;
  /** Set when the persistence layer's save call failed even
   *  though the pipeline succeeded. The week's row may not be
   *  re-readable from DB; the aggregate will skip it. */
  dbSaved?: boolean;
  dbError?: string;
}

export interface SeasonStoredBacktestResult {
  season: number;
  startWeek: number;
  endWeek: number;
  weeksRequested: number[];
  /** Per-week outcomes in season order. Includes failed weeks
   *  with `ok=false` so the operator can see what skipped. */
  perWeek: SeasonBacktestPerWeekRow[];
  weeksGraded: number;
  weeksFailed: number;
  /** Season-aggregate report computed from the latest
   *  persisted snapshots after every per-week run completed. */
  aggregate: SeasonAggregateReport;
  /** Plain-English headline for the admin summary field. */
  headline: string;
}

export interface RunSeasonStoredBacktestArgs {
  season: number;
  startWeek: number;
  endWeek: number;
  repoRoot: string;
  persistence: PersistenceClient;
  /** Defaults to true; the per-week pipeline writes the file
   *  mirror so /backtest/week-N keeps rendering when DB is
   *  out of reach. Tests can disable to keep the temp tree
   *  clean. */
  writeFileMirror?: boolean;
  /** Test seam — injects an alternate per-week pipeline. The
   *  default real pipeline reads from disk + DB; tests pass
   *  a stub that returns canned per-week results. */
  pipeline?: (args: {
    season: number;
    week: number;
    repoRoot: string;
    persistence: PersistenceClient;
    writeFileMirror?: boolean;
  }) => Promise<GradeStoredWeekPipelineResult>;
  /** Test seam — overrides the snapshot loader so tests can
   *  inject the per-week snapshots their stub pipeline would
   *  have produced. */
  loadSnapshots?: (args: {
    season: number;
    weeks: number[];
    client: PersistenceClient;
  }) => Promise<StoredWeekSnapshot[]>;
}

function perWeekRowFromResult(
  result: GradeStoredWeekPipelineResult,
): SeasonBacktestPerWeekRow {
  if (!result.ok) {
    return {
      season: result.season,
      week: result.week,
      ok: false,
      failureReason: result.reason,
      failureDetail: result.detail,
      candidateCount: 0,
    };
  }
  const rec = result.grade.summary.recommendedPlays;
  return {
    season: result.season,
    week: result.week,
    ok: true,
    candidateCount: result.candidateCount,
    qualifiedCount: rec.count,
    wins: rec.wins,
    losses: rec.losses,
    pushes: rec.pushes,
    hitRatePct: rec.hitRatePct,
    roiPct: rec.roiPct,
    unitsProfit: rec.unitsProfit,
    dbSaved: result.dbSaved,
    dbError: result.dbError,
  };
}

/**
 * Run the season-level stored-data backtest. Each week is
 * graded independently using only pre-week data; after every
 * week is processed the latest persisted snapshots are loaded
 * back and aggregated into the season-level report.
 *
 * Failures on individual weeks do NOT abort the run — the
 * loop continues so partial-season data still produces a
 * usable aggregate. The per-week row records the failure
 * reason so operators can see what didn't grade.
 */
export async function runSeasonStoredBacktest(
  args: RunSeasonStoredBacktestArgs,
): Promise<SeasonStoredBacktestResult> {
  if (args.startWeek < 1 || args.endWeek > 22 || args.startWeek > args.endWeek) {
    throw new Error(
      `Invalid week range: [${args.startWeek}, ${args.endWeek}]. Weeks must be in [1, 22] with startWeek ≤ endWeek.`,
    );
  }
  const weeks: number[] = [];
  for (let w = args.startWeek; w <= args.endWeek; w++) weeks.push(w);

  const pipeline = args.pipeline ?? gradeStoredWeekPipeline;
  const snapshotLoader =
    args.loadSnapshots ?? loadAllStoredMonitorSnapshots;
  const perWeek: SeasonBacktestPerWeekRow[] = [];
  for (const week of weeks) {
    const result = await pipeline({
      season: args.season,
      week,
      repoRoot: args.repoRoot,
      persistence: args.persistence,
      writeFileMirror: args.writeFileMirror ?? true,
    });
    perWeek.push(perWeekRowFromResult(result));
  }

  const weeksGraded = perWeek.filter((w) => w.ok).length;
  const weeksFailed = perWeek.filter((w) => !w.ok).length;

  // Re-load every requested week's latest persisted snapshot
  // and build the season aggregate. Weeks that failed to grade
  // won't have a fresh snapshot — they're either skipped or
  // load whatever older row exists for that (season, week).
  const snapshots: StoredWeekSnapshot[] = await snapshotLoader({
    season: args.season,
    weeks,
    client: args.persistence,
  });
  const aggregate = buildSeasonAggregateReport({
    season: args.season,
    weeksRequested: weeks,
    perWeek,
    snapshots,
  });

  const failedSuffix =
    weeksFailed > 0
      ? ` · ${weeksFailed} failed (${perWeek
          .filter((w) => !w.ok)
          .map((w) => `W${w.week}:${w.failureReason}`)
          .join(", ")})`
      : "";
  const headline =
    `Season ${args.season} W${args.startWeek}-W${args.endWeek}: ` +
    `graded ${weeksGraded}/${weeks.length} weeks${failedSuffix}. ` +
    `Aggregate: ${aggregate.seasonSummary.plays} qualified plays · ` +
    `${aggregate.seasonSummary.hitRatePct.toFixed(1)}% hit · ` +
    `${aggregate.seasonSummary.roiPct >= 0 ? "+" : ""}${aggregate.seasonSummary.roiPct.toFixed(1)}% ROI · ` +
    `${aggregate.seasonSummary.unitsProfit >= 0 ? "+" : ""}${aggregate.seasonSummary.unitsProfit.toFixed(2)}u.`;

  return {
    season: args.season,
    startWeek: args.startWeek,
    endWeek: args.endWeek,
    weeksRequested: weeks,
    perWeek,
    weeksGraded,
    weeksFailed,
    aggregate,
    headline,
  };
}
