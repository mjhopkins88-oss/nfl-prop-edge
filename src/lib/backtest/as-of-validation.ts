/**
 * As-of backtest fairness validation.
 *
 * For every stored candidate, confirm:
 *
 *   1. The odds carry both a `snapshotTime` and a `kickoffTime`.
 *   2. `snapshotTime <= kickoffTime` (no post-kickoff odds).
 *   3. Every player-history row attached to the candidate is
 *      STRICT-BEFORE the candidate's (season, week) — no row
 *      from the target week itself, no future weeks, no future
 *      seasons.
 *
 * If any candidate fails any check, the validator marks the
 * report `ok === false` and the caller must abort the run.
 *
 * Note: `player_week_stats.csv` legitimately contains the
 * target-week rows (the grader reads them to compute actual
 * outcomes) and may carry future-week rows from the season's
 * nflverse export. Future-stat LEAKAGE INTO THE MODEL is
 * prevented at the join step (`playerHistoryByName`), which
 * the per-candidate check (3) above confirms. There is no
 * dataset-wide check because the grader filters by exact
 * (season, week) before reading actuals.
 *
 * No paid API call. No network. No mutation of inputs. Used by
 * the admin grade-week1-stored action before scoring runs.
 */

import type { NflPlayerWeekStat } from "../ingestion/nflverse-types";
import type { RealWeekCandidate } from "./real-week-candidate-builder";

export type AsOfViolationCode =
  | "missing_snapshot_time"
  | "missing_kickoff_time"
  | "snapshot_after_kickoff"
  | "history_row_at_or_after_target_week";

export interface AsOfCandidateValidation {
  candidateId: string;
  playerName: string;
  team: string;
  opponent: string;
  gameId: string;
  propType: string;
  season: number;
  week: number;
  kickoffTime?: string;
  snapshotTime?: string;
  snapshotBeforeKickoff: boolean | "unknown";
  historyRowsAttached: number;
  historyWindowOk: boolean;
  ok: boolean;
  violations: AsOfViolation[];
}

export interface AsOfViolation {
  code: AsOfViolationCode;
  candidateId?: string;
  detail: string;
}

export interface AsOfValidationReport {
  ok: boolean;
  season: number;
  week: number;
  candidatesChecked: number;
  candidatesValid: number;
  candidatesInvalid: number;
  /** Per-candidate report. Sorted by candidateId for stable
   *  rendering. */
  candidates: AsOfCandidateValidation[];
  /** Sample of invalid candidates capped at 20 rows for the
   *  page / admin output. */
  sampleInvalid: AsOfCandidateValidation[];
}

function tsCompare(snap?: string, kick?: string): boolean | "unknown" {
  if (!snap || !kick) return "unknown";
  const a = Date.parse(snap);
  const b = Date.parse(kick);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "unknown";
  return a <= b;
}

function isStrictBefore(args: {
  rowSeason: number;
  rowWeek: number;
  targetSeason: number;
  targetWeek: number;
}): boolean {
  if (args.rowSeason < args.targetSeason) return true;
  if (args.rowSeason === args.targetSeason && args.rowWeek < args.targetWeek)
    return true;
  return false;
}

/**
 * Validate the full backtest pipeline's as-of discipline.
 * Inputs are read-only — the validator does not modify the
 * candidate list or the history map.
 */
export function validateAsOfFairness(args: {
  candidates: readonly RealWeekCandidate[];
  season: number;
  week: number;
  /** Per-player strict-before history that the scorecard
   *  adapter consumed. Validator confirms every row in this
   *  map is strict-before the target (season, week). */
  playerHistoryByName: Map<string, readonly NflPlayerWeekStat[]>;
}): AsOfValidationReport {
  const candidates: AsOfCandidateValidation[] = [];

  for (const c of args.candidates) {
    const violations: AsOfViolation[] = [];
    const snapshotTime = c.snapshotTime;
    const kickoffTime = c.kickoffTime;
    if (!snapshotTime) {
      violations.push({
        code: "missing_snapshot_time",
        candidateId: c.id,
        detail: `${c.playerName} ${c.propType} has no snapshotTime — cannot confirm pre-kickoff capture`,
      });
    }
    if (!kickoffTime) {
      violations.push({
        code: "missing_kickoff_time",
        candidateId: c.id,
        detail: `${c.playerName} ${c.propType} (${c.gameId}) has no kickoffTime`,
      });
    }
    const cmp = tsCompare(snapshotTime, kickoffTime);
    if (cmp === false) {
      violations.push({
        code: "snapshot_after_kickoff",
        candidateId: c.id,
        detail: `${c.playerName} ${c.propType}: snapshotTime ${snapshotTime} is AFTER kickoffTime ${kickoffTime}`,
      });
    }
    // History window check — every row attached must be
    // strict-before.
    const historyKey = `${c.playerName}::${c.team}`;
    const rows = args.playerHistoryByName.get(historyKey) ?? [];
    let historyWindowOk = true;
    for (const row of rows) {
      if (
        !isStrictBefore({
          rowSeason: row.season,
          rowWeek: row.week,
          targetSeason: c.season,
          targetWeek: c.week,
        })
      ) {
        historyWindowOk = false;
        violations.push({
          code: "history_row_at_or_after_target_week",
          candidateId: c.id,
          detail: `${c.playerName} history contains ${row.season} W${row.week} — not strict-before ${c.season} W${c.week}`,
        });
        break;
      }
    }
    candidates.push({
      candidateId: c.id,
      playerName: c.playerName,
      team: c.team,
      opponent: c.opponent,
      gameId: c.gameId,
      propType: c.propType,
      season: c.season,
      week: c.week,
      kickoffTime,
      snapshotTime,
      snapshotBeforeKickoff: cmp,
      historyRowsAttached: rows.length,
      historyWindowOk,
      ok: violations.length === 0,
      violations,
    });
  }

  candidates.sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const invalid = candidates.filter((c) => !c.ok);

  return {
    ok: invalid.length === 0,
    season: args.season,
    week: args.week,
    candidatesChecked: candidates.length,
    candidatesValid: candidates.length - invalid.length,
    candidatesInvalid: invalid.length,
    candidates,
    sampleInvalid: invalid.slice(0, 20),
  };
}

/**
 * Pretty-printer for the admin action `detail` field. Returns
 * a multi-line string suitable for the admin runner's output.
 */
export function formatAsOfReport(report: AsOfValidationReport): string {
  const lines: string[] = [];
  lines.push(
    `As-of fairness validation for ${report.season} W${report.week}: ` +
      `${report.candidatesValid}/${report.candidatesChecked} valid · ` +
      `${report.candidatesInvalid} invalid`,
  );
  if (report.sampleInvalid.length > 0) {
    lines.push(
      `Sample invalid candidates (${report.sampleInvalid.length} of ${report.candidatesInvalid}):`,
    );
    for (const c of report.sampleInvalid) {
      const status = c.snapshotBeforeKickoff;
      lines.push(
        `  · ${c.candidateId} ${c.playerName} ${c.propType} · ` +
          `kickoff=${c.kickoffTime ?? "?"} · snapshot=${c.snapshotTime ?? "?"} · ` +
          `snapBeforeKick=${status} · historyRows=${c.historyRowsAttached} · ` +
          `historyOk=${c.historyWindowOk}`,
      );
      for (const v of c.violations) {
        lines.push(`      ↳ [${v.code}] ${v.detail}`);
      }
    }
  }
  return lines.join("\n");
}
