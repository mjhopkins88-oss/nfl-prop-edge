/**
 * WR receptions — diagnostic mispricing signals.
 *
 * Six per-candidate scores computed from STRICT-BEFORE player
 * (and, when available, team) history. WR-only by construction:
 * a candidate must have `propType === "RECEPTIONS"` AND the
 * player's most-recent history row must carry `position === "WR"`
 * for the signals to be populated. Every other candidate gets
 * `undefined` back so the audit layer can skip it cheaply.
 *
 * Signals computed:
 *   1. roleChange — last 2 games vs prior 3-game baseline,
 *      blending targets and snap share (a routes proxy).
 *   2. routeParticipationSlope — 3-game slope of
 *      (targets / snapShare) as the best routes proxy we can
 *      derive without route-charting data.
 *   3. targetShareVolatility — std dev of target share over
 *      the last 5 games.
 *   4. teamProe — team passRate − 0.575 (league average).
 *      Falls back to 0 + hasNeutralFallback when the team
 *      history isn't threaded through. Real PROE needs a
 *      down-and-distance baseline; this is the coarsest
 *      proxy we can compute from team_week_stats alone.
 *   5. defensiveMatchup — opponent receptions-allowed-to-WRs
 *      gap vs league average. Requires opponent-allowed
 *      aggregates that nflverse doesn't surface in
 *      NflTeamWeekStat → always `undefined` for now; the
 *      audit reports it as unavailable.
 *   6. marketLag — computed by the audit layer (needs prior-
 *      week candidate visibility); NOT populated here.
 *
 * All inputs respect the strict-before discipline:
 *   row.season < currentSeason
 *   OR (row.season === currentSeason AND row.week < currentWeek)
 *
 * No paid API. No mutation. No threshold or calibration change.
 */

import type {
  NflPlayerWeekStat,
  NflTeamWeekStat,
} from "../ingestion/nflverse-types";
import type { PropType } from "../types";

/** League-average pass rate proxy. Real PROE expects a model
 *  baseline tuned for down / distance / score; for the
 *  diagnostic we use the long-run NFL average as a flat
 *  reference, documented here so the constant doesn't drift. */
export const LEAGUE_PASS_RATE_BASELINE = 0.575;

export interface WrReceptionsSignals {
  /** Composite of targets-spike + snap-share-spike, last 2
   *  games vs prior 3-game baseline. Bounded ~[-1, 1]. */
  roleChange: number;
  /** Slope of `targets / snapShare` over the last 3 games.
   *  Approximates routes-per-snap trend (no routes data). */
  routeParticipationSlope: number;
  /** Std dev of target share over the last 5 games. Lower
   *  = more stable target share. */
  targetShareVolatility: number;
  /** Team pass rate over expectation — team passRate minus
   *  LEAGUE_PASS_RATE_BASELINE. Positive = team is more
   *  pass-heavy than league. */
  teamProe: number;
  /** Opponent receptions-allowed-to-WRs vs league. Always
   *  `undefined` for now — nflverse team_week_stats does not
   *  carry opponent-allowed-to-position aggregates. */
  defensiveMatchup?: number;
  /** History rows used after the strict-before filter. */
  historyRowsUsed: number;
  /** Set when any signal defaulted (no team history, sparse
   *  player history, etc). Surfaces on the audit's signal-
   *  availability counter. */
  hasNeutralFallback: boolean;
  /** Set when defensive matchup specifically isn't available.
   *  Always true today. */
  defensiveMatchupAvailable: boolean;
  /** Set when team history was threaded in. False → teamProe
   *  defaulted to 0. */
  teamHistoryAvailable: boolean;
}

function numericValues(
  rows: ReadonlyArray<NflPlayerWeekStat>,
  key: keyof NflPlayerWeekStat,
): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function teamNumericValues(
  rows: ReadonlyArray<NflTeamWeekStat>,
  key: keyof NflTeamWeekStat,
): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (xs.length - 1));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function slope(ys: number[]): number {
  if (ys.length < 2) return 0;
  const n = ys.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (ys[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function strictBefore(
  rows: ReadonlyArray<NflPlayerWeekStat>,
  season: number,
  week: number,
): NflPlayerWeekStat[] {
  return rows.filter((r) => {
    if (r.season < season) return true;
    if (r.season === season && r.week < week) return true;
    return false;
  });
}

function strictBeforeTeam(
  rows: ReadonlyArray<NflTeamWeekStat>,
  season: number,
  week: number,
): NflTeamWeekStat[] {
  return rows.filter((r) => {
    if (r.season < season) return true;
    if (r.season === season && r.week < week) return true;
    return false;
  });
}

/** WR check: the most recent strict-before history row's
 *  `position` must be "WR". Players who switched roles
 *  mid-season still pass when their CURRENT (most-recent
 *  pre-target) position is WR. */
function isWideReceiver(
  history: ReadonlyArray<NflPlayerWeekStat>,
): boolean {
  if (history.length === 0) return false;
  // history is sorted oldest → newest by the caller.
  const latest = history[history.length - 1];
  return latest.position === "WR";
}

function computeRoleChange(history: NflPlayerWeekStat[]): number {
  // Last 2 games vs prior 3-game baseline.
  if (history.length < 5) return 0;
  const last2 = history.slice(-2);
  const prior3 = history.slice(-5, -2);
  const targetsDelta = relativeDelta(
    numericValues(last2, "targets"),
    numericValues(prior3, "targets"),
  );
  const snapDelta = relativeDelta(
    numericValues(last2, "snapShare"),
    numericValues(prior3, "snapShare"),
  );
  // 60/40 weighting toward targets (the more direct usage
  // signal for receptions) with snap share as a secondary
  // role-change indicator.
  return clamp(0.6 * targetsDelta + 0.4 * snapDelta, -1, 1);
}

function relativeDelta(recent: number[], prior: number[]): number {
  if (recent.length === 0 || prior.length === 0) return 0;
  const recentMean = mean(recent);
  const priorMean = mean(prior);
  if (priorMean <= 0) return 0;
  return clamp((recentMean - priorMean) / priorMean, -1, 1);
}

function computeRouteParticipationSlope(
  history: NflPlayerWeekStat[],
): number {
  // No routes data — proxy with (targets / snapShare) which
  // approximates "looks per snap played".
  if (history.length < 3) return 0;
  const lastThree = history.slice(-3);
  const ys: number[] = [];
  for (const row of lastThree) {
    const t = typeof row.targets === "number" ? row.targets : 0;
    const s = typeof row.snapShare === "number" ? row.snapShare : 0;
    if (s > 0) ys.push(t / s);
  }
  if (ys.length < 2) return 0;
  return clamp(slope(ys), -5, 5);
}

function computeTargetShareVolatility(history: NflPlayerWeekStat[]): number {
  if (history.length < 3) return 0;
  const lastFive = history.slice(-5);
  const xs = numericValues(lastFive, "targetShare");
  if (xs.length < 2) return 0;
  return clamp(stddev(xs), 0, 1);
}

function computeTeamProe(
  teamHistory: NflTeamWeekStat[] | undefined,
  team: string,
  season: number,
  week: number,
): { score: number; available: boolean } {
  if (!teamHistory || teamHistory.length === 0) {
    return { score: 0, available: false };
  }
  const filtered = strictBeforeTeam(
    teamHistory.filter((r) => r.team === team),
    season,
    week,
  );
  if (filtered.length === 0) return { score: 0, available: false };
  // Recent 4 weeks of team pass rate — the team-tendency
  // signal that matters for a WR's target ceiling.
  const recent = filtered.slice(-4);
  const rates = teamNumericValues(recent, "passRate");
  if (rates.length === 0) return { score: 0, available: false };
  return {
    score: clamp(mean(rates) - LEAGUE_PASS_RATE_BASELINE, -0.4, 0.4),
    available: true,
  };
}

/**
 * Compute the WR receptions signals. Returns `undefined` when
 * the candidate isn't a WR receptions prop or doesn't have
 * enough strict-before history to compute the role-change
 * signal (the most important one — the spec marks it CRITICAL).
 */
export function computeWrReceptionsSignals(args: {
  propType: PropType;
  team: string;
  currentSeason: number;
  currentWeek: number;
  history: ReadonlyArray<NflPlayerWeekStat>;
  teamHistory?: ReadonlyArray<NflTeamWeekStat>;
}): WrReceptionsSignals | undefined {
  if (args.propType !== "RECEPTIONS") return undefined;
  const filtered = strictBefore(
    args.history,
    args.currentSeason,
    args.currentWeek,
  ).sort((a, b) => a.season - b.season || a.week - b.week);
  if (!isWideReceiver(filtered)) return undefined;
  if (filtered.length < 3) return undefined;
  const roleChange = computeRoleChange(filtered);
  const routeParticipationSlope = computeRouteParticipationSlope(filtered);
  const targetShareVolatility = computeTargetShareVolatility(filtered);
  const proe = computeTeamProe(
    args.teamHistory ? [...args.teamHistory] : undefined,
    args.team,
    args.currentSeason,
    args.currentWeek,
  );
  const hasNeutralFallback =
    !proe.available ||
    filtered.length < 5 ||
    targetShareVolatility === 0;
  return {
    roleChange,
    routeParticipationSlope,
    targetShareVolatility,
    teamProe: proe.score,
    defensiveMatchup: undefined,
    historyRowsUsed: filtered.length,
    hasNeutralFallback,
    defensiveMatchupAvailable: false,
    teamHistoryAvailable: proe.available,
  };
}
