/**
 * Backtest stage 1 — Feature builder.
 *
 * Takes the raw inputs we have at decision-time (the prop market, the
 * player's PRIOR weekly logs only — never the actual stat we're
 * grading against — plus weather and injury context) and emits the
 * numeric features the projection engine consumes.
 *
 * Strict no-leak rule: priorLogs MUST only contain weeks earlier than
 * the target week. The orchestrator slices logs before calling this.
 */

import type { GameLog, PropType } from "../types";
import type { NormalizedWeatherSnapshot } from "../ingestion/weather";
import type { InjuryFlag, PlayerInjuryContext } from "../ingestion/injuries";

// --- column mapping ---------------------------------------------------

export const STAT_KEY_BY_PROP_TYPE: Record<PropType, keyof GameLog> = {
  PASSING_ATTEMPTS: "passingAttempts",
  PASSING_COMPLETIONS: "passingCompletions",
  PASSING_YARDS: "passingYards",
  RECEPTIONS: "receptions",
  RECEIVING_YARDS: "receivingYards",
  RUSHING_ATTEMPTS: "rushingAttempts",
  RUSHING_YARDS: "rushingYards",
};

const RECENT_WINDOW = 5; // last N games for "recent" averages

// --- inputs / outputs -------------------------------------------------

export interface FeatureBuildInput {
  season: number;
  week: number;
  gameId: string;
  team: string;
  opponentTeam: string;
  playerName: string;
  propType: PropType;
  line: number;
  /** Logs from weeks STRICTLY before `week` (caller enforces). */
  priorLogs: GameLog[];
  weather: NormalizedWeatherSnapshot | null;
  injuryFlags: InjuryFlag[];
  /** Whether the prop market itself looks well-formed. */
  marketWellFormed: boolean;
}

export interface PropFeatures {
  // Sample stats
  recentMean: number;
  recentStdDev: number;
  seasonMean: number;
  seasonStdDev: number;
  gamesSampled: number;
  recentSampleSize: number;

  // Volume / role estimates (used as priors for the projection)
  recentTargetShare: number; // 0..1 — used for receiving markets
  recentCarryShare: number; // 0..1 — used for rushing markets
  recentSnapShare: number; // 0..1 — V1 placeholder until snap CSV joins in
  /** rough team-plays prior (count of plays / game) — currently a constant. */
  projectedTeamPlays: number;
  /** team pass rate estimate; default 0.58 NFL average. */
  projectedPassRate: number;

  // Context
  weather: NormalizedWeatherSnapshot | null;
  injuryContext: PlayerInjuryContext;
  opponentAdjustment: number; // multiplicative; 1.0 = neutral

  // Hygiene flags surfaced to later stages
  flags: {
    lowSample: boolean;
    missingMarketData: boolean;
    weatherImpactEligible: boolean;
  };
}

import { getPlayerContext } from "../ingestion/injuries";

// --- helpers ----------------------------------------------------------

function statValues(logs: GameLog[], key: keyof GameLog): number[] {
  return logs.map((l) => Number(l[key] ?? 0));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function targetShare(logs: GameLog[]): number {
  // Crude proxy: receptions / (receptions + carries + 1) gives a rough
  // share of touch volume on receiving plays. Will be replaced with a
  // real team-target denominator once team_week_stats.csv is wired in.
  const r = mean(statValues(logs, "receptions"));
  const c = mean(statValues(logs, "rushingAttempts"));
  return r / Math.max(1, r + c + 1);
}

function carryShare(logs: GameLog[]): number {
  const r = mean(statValues(logs, "receptions"));
  const c = mean(statValues(logs, "rushingAttempts"));
  return c / Math.max(1, r + c + 1);
}

function recentLogs(logs: GameLog[]): GameLog[] {
  // Assume logs are not sorted; take the most recent N by (season, week).
  return [...logs]
    .sort((a, b) =>
      a.season !== b.season ? b.season - a.season : b.week - a.week,
    )
    .slice(0, RECENT_WINDOW);
}

// --- entry point ------------------------------------------------------

export function buildFeatures(input: FeatureBuildInput): PropFeatures {
  const key = STAT_KEY_BY_PROP_TYPE[input.propType];
  const seasonLogs = input.priorLogs;
  const recent = recentLogs(input.priorLogs);

  const seasonVals = statValues(seasonLogs, key);
  const recentVals = statValues(recent, key);

  const injuryContext = getPlayerContext(input.injuryFlags, {
    season: input.season,
    week: input.week,
    gameId: input.gameId,
    team: input.team,
    opponentTeam: input.opponentTeam,
    playerName: input.playerName,
  });

  return {
    recentMean: mean(recentVals),
    recentStdDev: stddev(recentVals),
    seasonMean: mean(seasonVals),
    seasonStdDev: stddev(seasonVals),
    gamesSampled: seasonLogs.length,
    recentSampleSize: recent.length,

    recentTargetShare: targetShare(recent),
    recentCarryShare: carryShare(recent),
    recentSnapShare: 0, // populated when snap_counts.csv joins in

    projectedTeamPlays: 64, // league avg; replaced once team_week_stats lands
    projectedPassRate: 0.58, // league avg

    weather: input.weather,
    injuryContext,
    opponentAdjustment: 1.0, // placeholder until opponent splits land

    flags: {
      lowSample: seasonLogs.length < 3,
      missingMarketData: !input.marketWellFormed,
      weatherImpactEligible: input.weather?.weatherImpactEligible ?? false,
    },
  };
}
