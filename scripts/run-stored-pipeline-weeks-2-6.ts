/**
 * Stored-data pipeline runner for Weeks 2-6 (one week at a time).
 *
 * For each requested week this script reproduces the exact
 * workflow the admin `grade-week1-stored` action runs for
 * Week 1:
 *
 *   1. Load stored odds (file → Postgres rehydrate).
 *   2. Build canonical candidates with the schedule-validated
 *      builder. Stop the week if MISSING_STORED_ODDS.
 *   3. Apply the V1 scorecard adapter so every candidate
 *      carries a decision.
 *   4. Run validateAsOfFairness() — STOP THE WEEK if the
 *      report is not OK (no grading, no persistence).
 *   5. Grade the candidates against stored nflverse stats.
 *   6. Build the scorecard audit + market-context calibration.
 *   7. Persist the (season, week) StoredBacktestRun row to
 *      Postgres. Each week is independent — Week 1 is never
 *      touched.
 *
 * After all weeks process, load every stored snapshot 1..6
 * through the multi-week loader and print the aggregate
 * monitor rollup.
 *
 * Pure stored-data pipeline. NO paid API call. NO ingestion.
 * NO threshold changes. NO parlay testing (deferred). NO
 * touchdown props. Each week's success or failure is reported
 * independently — a failing week does not block the others.
 *
 * Usage:
 *   npx tsx scripts/run-stored-pipeline-weeks-2-6.ts
 *   npx tsx scripts/run-stored-pipeline-weeks-2-6.ts --season 2025 --weeks 2,3,4,5,6
 *   npx tsx scripts/run-stored-pipeline-weeks-2-6.ts --weeks 4
 */

import { buildRealWeek1CandidatesFromStoredData } from "../src/lib/backtest/real-week-candidate-builder";
import {
  applyScorecardToCandidates,
  buildPlayerHistoryByName,
} from "../src/lib/backtest/stored-candidate-scorecard";
import {
  buildScorecardAudit,
  gradeStoredWeek1Backtest,
} from "../src/lib/backtest/week-1-grading";
import { buildMarketContextCalibration } from "../src/lib/backtest/market-context-calibration";
import { loadProcessedPlayerWeekStatsStrict } from "../src/lib/backtest/processed-nfl-loader";
import {
  formatAsOfReport,
  validateAsOfFairness,
} from "../src/lib/backtest/as-of-validation";
import {
  aggregateStoredSeason,
  loadAllStoredMonitorSnapshots,
} from "../src/lib/backtest/week-1-monitor-summary";
import { getPersistenceClient } from "../src/lib/persistence/week-1-persistence";

interface CliArgs {
  season: number;
  weeks: number[];
}

function parseArgs(argv: string[]): CliArgs {
  let season = 2025;
  let weeks = [2, 3, 4, 5, 6];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--season" && argv[i + 1]) {
      season = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--weeks" && argv[i + 1]) {
      weeks = argv[i + 1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      i += 1;
    }
  }
  return { season, weeks };
}

interface WeekOutcome {
  season: number;
  week: number;
  status:
    | "ok"
    | "missing_stored_odds"
    | "missing_processed_nfl"
    | "schedule_validation_failed"
    | "no_candidates"
    | "as_of_failed"
    | "persistence_failed"
    | "error";
  candidateCount?: number;
  recommendedPlaysCount?: number;
  asOfOk?: boolean;
  asOfInvalid?: number;
  calibration?: {
    production: number;
    gate040: number;
    gate035: number;
  };
  dbSaveOk?: boolean;
  detail?: string;
}

async function runOneWeek(args: {
  season: number;
  week: number;
}): Promise<WeekOutcome> {
  console.log(`\n── ${args.season} Week ${args.week} ──`);

  // 1. Build candidates from stored odds.
  const built = buildRealWeek1CandidatesFromStoredData({
    season: args.season,
    week: args.week,
  });
  if (built.status === "MISSING_STORED_ODDS") {
    console.log(
      `  · status: MISSING_STORED_ODDS — no stored odds rows for this week`,
    );
    console.log(`  · skipping (paid ingestion blocked by policy)`);
    return {
      season: args.season,
      week: args.week,
      status: "missing_stored_odds",
      detail: built.notes.join("; "),
    };
  }
  if (built.status === "MISSING_PROCESSED_NFL") {
    console.log(
      `  · status: MISSING_PROCESSED_NFL — nflverse processed data is missing`,
    );
    return {
      season: args.season,
      week: args.week,
      status: "missing_processed_nfl",
      detail: built.notes.join("; "),
    };
  }
  if (built.status === "SCHEDULE_VALIDATION_FAILED") {
    console.log(
      `  · status: SCHEDULE_VALIDATION_FAILED — stored odds reference games not in the real schedule`,
    );
    return {
      season: args.season,
      week: args.week,
      status: "schedule_validation_failed",
      detail: built.notes.join("; "),
    };
  }
  if (built.status === "NO_CANDIDATES_AFTER_FILTER") {
    console.log(
      `  · status: NO_CANDIDATES_AFTER_FILTER — every stored row was filtered out`,
    );
    return {
      season: args.season,
      week: args.week,
      status: "no_candidates",
      detail: built.notes.join("; "),
    };
  }
  console.log(
    `  · candidates: ${built.candidates.length} (schedule ${built.scheduleReport?.status ?? "?"})`,
  );

  // 2. Load nflverse processed stats for history + grading.
  const stats = loadProcessedPlayerWeekStatsStrict();
  if (stats.status !== "READY") {
    console.log(`  · status: processed player_week_stats not available`);
    return {
      season: args.season,
      week: args.week,
      status: "missing_processed_nfl",
      detail: `player_week_stats status=${stats.status} source=${stats.source}`,
    };
  }
  const playerHistoryByName = buildPlayerHistoryByName({
    candidates: built.candidates,
    season: args.season,
    week: args.week,
    playerWeekStats: stats.rows,
  });

  // 3. Apply scorecard.
  const evaluated = applyScorecardToCandidates({
    candidates: built.candidates,
    playerHistoryByName,
  });

  // 4. As-of fairness validation — HARD GATE.
  const asOf = validateAsOfFairness({
    candidates: evaluated,
    season: args.season,
    week: args.week,
    playerHistoryByName,
  });
  console.log(
    `  · as-of fairness: ${asOf.ok ? "PASS" : "FAIL"} (${asOf.candidatesValid}/${asOf.candidatesChecked} valid)`,
  );
  if (!asOf.ok) {
    console.log(formatAsOfReport(asOf));
    console.log(
      `  · ABORT — not grading or persisting this week because of as-of violations`,
    );
    return {
      season: args.season,
      week: args.week,
      status: "as_of_failed",
      candidateCount: evaluated.length,
      asOfOk: false,
      asOfInvalid: asOf.candidatesInvalid,
      detail: `${asOf.candidatesInvalid}/${asOf.candidatesChecked} candidates failed as-of validation`,
    };
  }

  // 5. Grade against actuals.
  const grade = gradeStoredWeek1Backtest({
    candidates: evaluated,
    season: args.season,
    week: args.week,
    playerWeekStats: stats.rows,
  });
  const audit = buildScorecardAudit({
    candidates: evaluated,
    playerHistoryByName,
    playerWeekStats: stats.rows,
    samplePicksCount: 50,
    closestToQualifyingCount: 50,
    missingHistoryExamplesCount: 25,
  });
  const calibration = buildMarketContextCalibration({
    candidates: evaluated,
    graded: grade.graded,
  });

  console.log(
    `  · grading: ${grade.summary.candidatesWithActual}/${grade.summary.totalCandidates} with actual results`,
  );
  console.log(
    `  · recommended plays (gate 0.45): ${grade.summary.recommendedPlays.count} ` +
      (grade.summary.recommendedPlays.enabled
        ? `(${grade.summary.recommendedPlays.wins}W·${grade.summary.recommendedPlays.losses}L·${grade.summary.recommendedPlays.pushes}P · hit ${grade.summary.recommendedPlays.hitRatePct.toFixed(1)}% · ROI ${grade.summary.recommendedPlays.roiPct.toFixed(1)}% · ${grade.summary.recommendedPlays.unitsProfit.toFixed(2)}u)`
        : "(0 qualified — see audit for reasons)"),
  );
  console.log(
    `  · calibration: prod=${calibration.production.qualifiedCount} · 0.40=${calibration.gate040.qualifiedCount} · 0.35=${calibration.gate035.qualifiedCount}`,
  );

  // 6. Persist independently — same shape the admin
  //    grade-week1-stored action writes.
  const persistence = await getPersistenceClient();
  if (!persistence.isAvailable()) {
    console.log(
      `  · persistence: SKIPPED (DATABASE_URL not configured in this env)`,
    );
    return {
      season: args.season,
      week: args.week,
      status: "ok",
      candidateCount: evaluated.length,
      recommendedPlaysCount: grade.summary.recommendedPlays.enabled
        ? grade.summary.recommendedPlays.count
        : 0,
      asOfOk: true,
      asOfInvalid: 0,
      calibration: {
        production: calibration.production.qualifiedCount,
        gate040: calibration.gate040.qualifiedCount,
        gate035: calibration.gate035.qualifiedCount,
      },
      dbSaveOk: false,
      detail: "DB not configured — results computed in memory only",
    };
  }
  const dbSave = await persistence.saveStoredBacktestRunToDb({
    season: args.season,
    week: args.week,
    dataMode: "stored",
    status: built.status,
    realWeek1BacktestReady: true,
    scheduleValidationStatus: built.scheduleReport?.status ?? "PASS",
    syntheticFixture: false,
    candidatesJson: {
      candidates: evaluated.slice(0, 500),
    },
    resultsJson: {
      summary: grade.summary,
      gradedSampleSize: grade.graded.length,
      gradedSample: grade.graded.slice(0, 100),
      asOfReport: asOf,
      scorecardAudit: audit,
      marketContextCalibration: calibration,
    },
  });
  console.log(
    `  · persistence: ${dbSave.ok ? `saved (id=${dbSave.id ?? "?"})` : `failed (${dbSave.error ?? "?"})`}`,
  );
  return {
    season: args.season,
    week: args.week,
    status: dbSave.ok ? "ok" : "persistence_failed",
    candidateCount: evaluated.length,
    recommendedPlaysCount: grade.summary.recommendedPlays.enabled
      ? grade.summary.recommendedPlays.count
      : 0,
    asOfOk: true,
    asOfInvalid: 0,
    calibration: {
      production: calibration.production.qualifiedCount,
      gate040: calibration.gate040.qualifiedCount,
      gate035: calibration.gate035.qualifiedCount,
    },
    dbSaveOk: dbSave.ok,
    detail: dbSave.ok ? undefined : dbSave.error,
  };
}

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function printPerWeekTable(outcomes: WeekOutcome[]): void {
  console.log("\n== Per-week summary ==");
  console.log(
    pad("Week", 6) +
      pad("Status", 26) +
      pad("Candidates", 12, "R") +
      pad("As-of", 7, "R") +
      pad("RecPlays", 10, "R") +
      pad("Prod/0.40/0.35", 16, "R"),
  );
  console.log("-".repeat(77));
  for (const o of outcomes) {
    const cal = o.calibration
      ? `${o.calibration.production}/${o.calibration.gate040}/${o.calibration.gate035}`
      : "—";
    console.log(
      pad(`W${o.week}`, 6) +
        pad(o.status, 26) +
        pad(o.candidateCount ?? "—", 12, "R") +
        pad(o.asOfOk === undefined ? "—" : o.asOfOk ? "PASS" : "FAIL", 7, "R") +
        pad(o.recommendedPlaysCount ?? "—", 10, "R") +
        pad(cal, 16, "R"),
    );
  }
}

async function printAggregateRollup(season: number): Promise<void> {
  console.log("\n== Aggregate Weeks 1-6 (from Postgres) ==");
  const snapshots = await loadAllStoredMonitorSnapshots({
    season,
    weeks: [1, 2, 3, 4, 5, 6],
  });
  if (snapshots.length === 0) {
    console.log(
      "  (No stored snapshots in Postgres for these weeks. Run grading first.)",
    );
    return;
  }
  const agg = aggregateStoredSeason(snapshots);
  console.log(
    `  Weeks loaded: ${agg.weeks.map((w) => `W${w}`).join(", ")} (${agg.weekCount} total, ${agg.weeksGraded} graded)`,
  );
  console.log(
    `  Universe: ${agg.totalCandidates} candidates · ${agg.totalCandidatesWithActual} with actual stat`,
  );
  console.log(
    `  Recommended plays (production gate 0.45): ${agg.recommendedPlays.count}` +
      (agg.recommendedPlays.enabled
        ? ` · ${agg.recommendedPlays.wins}W·${agg.recommendedPlays.losses}L·${agg.recommendedPlays.pushes}P · hit ${agg.recommendedPlays.hitRatePct.toFixed(1)}% · ROI ${agg.recommendedPlays.roiPct.toFixed(1)}% · ${agg.recommendedPlays.unitsProfit.toFixed(2)}u`
        : " (no qualified plays across the loaded weeks)"),
  );
  if (agg.calibration.available) {
    console.log(`  Market-context calibration rollup (DIAGNOSTIC ONLY):`);
    for (const g of [
      agg.calibration.production,
      agg.calibration.gate040,
      agg.calibration.gate035,
    ]) {
      const label = g.isProduction
        ? `production ${g.gateThreshold.toFixed(2)}`
        : `diagnostic ${g.gateThreshold.toFixed(2)}`;
      console.log(
        `    · ${label}: ${g.qualifiedCount} plays · ` +
          `${g.wins}W·${g.losses}L·${g.pushes}P · ` +
          `hit ${g.hitRatePct.toFixed(1)}% · ROI ${g.roiPct.toFixed(1)}% · ` +
          `${g.unitsProfit.toFixed(2)}u`,
      );
    }
  } else {
    console.log(
      `  Market-context calibration rollup: unavailable (no week persisted a calibration payload).`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log("Stored-data pipeline runner · Weeks 2-6");
  console.log("=========================================");
  console.log(
    `Season ${args.season} · weeks ${args.weeks.join(", ")} · no paid APIs · no parlay testing`,
  );

  const outcomes: WeekOutcome[] = [];
  for (const week of args.weeks) {
    try {
      const o = await runOneWeek({ season: args.season, week });
      outcomes.push(o);
    } catch (err) {
      console.log(`  · ERROR: ${(err as Error).message}`);
      outcomes.push({
        season: args.season,
        week,
        status: "error",
        detail: (err as Error).message,
      });
    }
  }

  printPerWeekTable(outcomes);
  await printAggregateRollup(args.season);

  const missing = outcomes.filter((o) => o.status === "missing_stored_odds");
  const asOfFailed = outcomes.filter((o) => o.status === "as_of_failed");
  const persisted = outcomes.filter(
    (o) => o.status === "ok" && o.dbSaveOk === true,
  );
  const computedNoDb = outcomes.filter(
    (o) => o.status === "ok" && o.dbSaveOk === false,
  );

  console.log("\n== Notes ==");
  console.log(
    `  · Weeks persisted to Postgres: ${persisted.length}/${outcomes.length}` +
      (persisted.length > 0
        ? ` (${persisted.map((o) => `W${o.week}`).join(", ")})`
        : ""),
  );
  if (computedNoDb.length > 0) {
    console.log(
      `  · Weeks computed but DB not configured: ${computedNoDb.length} (${computedNoDb.map((o) => `W${o.week}`).join(", ")})`,
    );
  }
  if (missing.length > 0) {
    console.log(
      `  · Weeks missing stored odds (skipped — no paid ingestion): ${missing.map((o) => `W${o.week}`).join(", ")}`,
    );
  }
  if (asOfFailed.length > 0) {
    console.log(
      `  · Weeks halted by as-of fairness violation: ${asOfFailed.map((o) => `W${o.week}`).join(", ")}`,
    );
  }
  console.log(
    `  · Parlay testing deferred — straight-prop diagnostics through Week 6 must finish first.`,
  );
  console.log(
    `  · DIAGNOSTIC ONLY for any 0.40 / 0.35 gate replay numbers above. Production gate 0.45 unchanged.`,
  );
}

void main();
