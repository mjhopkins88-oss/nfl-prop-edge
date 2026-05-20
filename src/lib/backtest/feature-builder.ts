/**
 * Backtest feature builder.
 *
 * Given a target (season, week) and the fixture data, derive a complete
 * `BacktestFeatureRow` for every prop market in that game-week using
 * ONLY data with `season < season` or `season == season && week < week`.
 * No future-data leakage.
 */

import type { PropType } from "../types";
import {
  TEAM_COACHING_TRANSITIONS,
  UNCHANGED_STAFF_DEFAULT,
} from "../model/coaching-transition-data";
import { buildCoachingTransitionScorecard } from "../model/coaching-transition";
import type {
  BacktestFeatureRow,
  BacktestGame,
  BacktestInjuryFlag,
  BacktestPlayerWeekStat,
  BacktestPropMarket,
  BacktestPropQuote,
  BacktestWeatherSnapshot,
} from "./types";
import { buildMarketSnapshotForBacktest } from "./market-adapter";

const RECENT_WINDOW = 3;
const PROP_TYPE_VOLUME_TARGET: Record<PropType, "PASS" | "REC" | "RUSH"> = {
  PASSING_ATTEMPTS: "PASS",
  PASSING_COMPLETIONS: "PASS",
  PASSING_YARDS: "PASS",
  RECEPTIONS: "REC",
  RECEIVING_YARDS: "REC",
  RUSHING_ATTEMPTS: "RUSH",
  RUSHING_YARDS: "RUSH",
};

export interface FeatureBuildArgs {
  market: BacktestPropMarket;
  game: BacktestGame;
  season: number;
  week: number;
  playerWeekStats: BacktestPlayerWeekStat[];
  quotes: BacktestPropQuote[];
  weather: BacktestWeatherSnapshot[];
  injuryFlags: BacktestInjuryFlag[];
  allMarketsThisWeek: BacktestPropMarket[];
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

// --- per-bucket helpers ----------------------------------------------

export function buildPlayerUsageFeatures(args: {
  playerId: string;
  season: number;
  week: number;
  playerWeekStats: BacktestPlayerWeekStat[];
}): {
  recentSnapShare: number;
  recentTargetShare: number;
  recentCarryShare: number;
  seasonSnapShare: number;
  seasonTargetShare: number;
  seasonCarryShare: number;
  priorWeeksCount: number;
} {
  const prior = args.playerWeekStats
    .filter(
      (r) =>
        r.playerId === args.playerId &&
        (r.season < args.season ||
          (r.season === args.season && r.week < args.week)),
    )
    .sort((a, b) => (a.season - b.season) || (a.week - b.week));
  const seasonOnly = prior.filter((r) => r.season === args.season);
  const recent = prior.slice(-RECENT_WINDOW);
  return {
    recentSnapShare: mean(recent.map((r) => r.snapShare)),
    recentTargetShare: mean(recent.map((r) => r.targetShare)),
    recentCarryShare: mean(recent.map((r) => r.carryShare)),
    seasonSnapShare: mean(seasonOnly.map((r) => r.snapShare)),
    seasonTargetShare: mean(seasonOnly.map((r) => r.targetShare)),
    seasonCarryShare: mean(seasonOnly.map((r) => r.carryShare)),
    priorWeeksCount: prior.length,
  };
}

export function buildTeamVolumeFeatures(args: {
  teamAbbr: string;
  season: number;
  week: number;
  playerWeekStats: BacktestPlayerWeekStat[];
}): {
  projectedTeamPlays: number;
  projectedPassRate: number;
} {
  const teamPriorRows = args.playerWeekStats.filter(
    (r) =>
      r.teamAbbr === args.teamAbbr &&
      (r.season < args.season ||
        (r.season === args.season && r.week < args.week)),
  );
  // Use the unique (season, week) tuples — each row has the team play
  // count duplicated across players from that game.
  const seenWeeks = new Set<string>();
  const teamPlaysPerWeek: number[] = [];
  let passAttempts = 0;
  let rushAttempts = 0;
  for (const r of teamPriorRows) {
    const key = `${r.season}-${r.week}`;
    if (!seenWeeks.has(key)) {
      seenWeeks.add(key);
      teamPlaysPerWeek.push(r.teamPlays);
    }
    passAttempts += r.passingAttempts;
    rushAttempts += r.rushingAttempts;
  }
  const projectedTeamPlays = teamPlaysPerWeek.length > 0
    ? mean(teamPlaysPerWeek)
    : 63;
  const total = passAttempts + rushAttempts;
  const projectedPassRate = total > 0 ? passAttempts / total : 0.59;
  return { projectedTeamPlays, projectedPassRate };
}

export function buildGameScriptFeatures(args: {
  spread: number;
  total: number;
}): { gameScriptScore: number; paceScore: number } {
  // Big favorites / blowout spreads compress passing volume.
  // 0..1 score where 1 = balanced game script.
  const gameScriptScore = clamp(
    1 - Math.min(Math.abs(args.spread) / 14, 0.5),
    0,
    1,
  );
  // Game totals 47-52 are pace-neutral; >55 boosts pace, <42 dampens it.
  const paceDelta = (args.total - 47) / 25;
  const paceScore = clamp(0.6 + paceDelta, 0, 1);
  return { gameScriptScore, paceScore };
}

export function buildWeatherFeatures(args: {
  propType: PropType;
  weather: BacktestWeatherSnapshot | undefined;
}): number {
  const w = args.weather;
  if (!w || w.isDome) return 1.0;
  const target = PROP_TYPE_VOLUME_TARGET[args.propType];
  const wind = w.windMph ?? 0;
  const gusts = w.gustsMph ?? wind;
  const snow = w.snowfallCm ?? 0;
  const rain = w.precipitationMm ?? 0;
  // Rushing is roughly weather-insensitive. Passing/receiving react
  // strongly to wind + precipitation.
  if (target === "RUSH") {
    return clamp(1 - gusts / 60 - snow / 12, 0.6, 1);
  }
  return clamp(1 - gusts / 32 - rain / 18 - snow / 6, 0, 1);
}

export function buildInjuryFeatures(args: {
  playerId: string;
  season: number;
  week: number;
  injuryFlags: BacktestInjuryFlag[];
}): number {
  const flag = args.injuryFlags.find(
    (f) =>
      f.playerId === args.playerId &&
      f.season === args.season &&
      f.week === args.week,
  );
  if (!flag) return 0.85;
  switch (flag.status) {
    case "OUT":
      return 0.05;
    case "DOUBTFUL":
      return 0.25;
    case "QUESTIONABLE":
      return 0.45;
    case "PROBABLE":
      return 0.7;
    case "HEALTHY":
      return 0.95;
  }
}

export function buildCoachingFeatures(teamAbbr: string, week: number) {
  const record =
    TEAM_COACHING_TRANSITIONS[teamAbbr] ?? {
      ...UNCHANGED_STAFF_DEFAULT,
      team: teamAbbr,
    };
  return buildCoachingTransitionScorecard(record, week);
}

export function buildMarketFeatures(args: {
  market: BacktestPropMarket;
  quotes: BacktestPropQuote[];
}): { line: number; overOdds: number; underOdds: number } {
  const snap = buildMarketSnapshotForBacktest(args.market, args.quotes);
  return {
    line: snap.line,
    overOdds: snap.overOdds,
    underOdds: snap.underOdds,
  };
}

function buildRoleStability(
  prior: BacktestPlayerWeekStat[],
  recent: BacktestPlayerWeekStat[],
): number {
  if (recent.length < 2) return 0.5;
  const recentSnap = recent.map((r) => r.snapShare);
  const sd = stddev(recentSnap);
  const m = mean(recentSnap);
  // Coefficient of variation. CV > 0.20 is genuinely unstable.
  const cv = m > 0 ? sd / m : 1;
  const stability = 1 - clamp(cv / 0.25, 0, 1);
  // If we have very little history, drop stability further.
  if (prior.length < 3) return Math.min(stability, 0.55);
  return clamp(0.4 + 0.6 * stability, 0, 1);
}

function buildCorrelationExposure(
  market: BacktestPropMarket,
  allThisWeek: BacktestPropMarket[],
): number {
  // Two correlated-prop signals:
  //   (1) explicit `correlationTag` on the market — already stacked.
  //   (2) same player has another prop in the same game (same week)
  //       that we'd be likely to bet on. Treat the later ones as
  //       correlation-risk.
  if (market.correlationTag) return 0.3;
  const samePlayerProps = allThisWeek.filter(
    (m) => m.playerId === market.playerId && m.gameId === market.gameId,
  );
  if (samePlayerProps.length <= 1) return 0.8;
  // Three-or-more stacks reduce more than two-prop pairs.
  return samePlayerProps.length >= 3 ? 0.55 : 0.7;
}

function buildDataQuality(priorWeeksCount: number): number {
  if (priorWeeksCount >= 5) return 0.85;
  if (priorWeeksCount >= 3) return 0.7;
  if (priorWeeksCount >= 1) return 0.55;
  return 0.4;
}

function buildMarketContextScore(
  market: BacktestPropMarket,
  quotes: BacktestPropQuote[],
): number {
  // Crude proxy: tighter no-vig overround means a more efficient,
  // less-sharp-driven market. Single-quote markets get a moderate
  // default.
  const pool = quotes.filter((q) => q.marketId === market.id);
  if (pool.length === 0) return 0.7;
  const overrounds = pool.map((q) => {
    const o = q.overOdds < 0 ? -q.overOdds / (-q.overOdds + 100) : 100 / (q.overOdds + 100);
    const u = q.underOdds < 0 ? -q.underOdds / (-q.underOdds + 100) : 100 / (q.underOdds + 100);
    return o + u;
  });
  const mAvg = mean(overrounds);
  // overround 1.04 (very tight, < 0.5% per side) → high context score
  // overround 1.10 (5%/side) → lower context score
  return clamp(1 - (mAvg - 1) / 0.1, 0.4, 0.95);
}

// --- entry point ------------------------------------------------------

export function buildPregameFeatureRow(
  args: FeatureBuildArgs,
): BacktestFeatureRow {
  const { market, game, season, week } = args;

  const opponentAbbr =
    game.homeTeamAbbr ===
    args.playerWeekStats.find((r) => r.playerId === market.playerId)?.teamAbbr
      ? game.awayTeamAbbr
      : game.homeTeamAbbr;
  const playerRow = args.playerWeekStats.find(
    (r) => r.playerId === market.playerId,
  );
  const teamAbbr = playerRow?.teamAbbr ?? "UNK";
  const playerName = playerRow?.playerName ?? market.playerId;

  const usage = buildPlayerUsageFeatures({
    playerId: market.playerId,
    season,
    week,
    playerWeekStats: args.playerWeekStats,
  });
  const teamVol = buildTeamVolumeFeatures({
    teamAbbr,
    season,
    week,
    playerWeekStats: args.playerWeekStats,
  });
  const gs = buildGameScriptFeatures({ spread: game.spread, total: game.total });
  const weather = args.weather.find((w) => w.gameId === game.id);
  const weatherEnvironmentScore = buildWeatherFeatures({
    propType: market.propType,
    weather,
  });
  const injuryContextScore = buildInjuryFeatures({
    playerId: market.playerId,
    season,
    week,
    injuryFlags: args.injuryFlags,
  });
  const coachingTransition = buildCoachingFeatures(teamAbbr, week);
  const marketFeatures = buildMarketFeatures({
    market,
    quotes: args.quotes,
  });

  const priorPlayer = args.playerWeekStats.filter(
    (r) =>
      r.playerId === market.playerId &&
      (r.season < season || (r.season === season && r.week < week)),
  );
  const recent = priorPlayer.slice(-RECENT_WINDOW);
  const roleStabilityScore = buildRoleStability(priorPlayer, recent);
  const correlationExposureScore = buildCorrelationExposure(
    market,
    args.allMarketsThisWeek,
  );
  const dataQualityScore = buildDataQuality(usage.priorWeeksCount);
  const marketContextScore = buildMarketContextScore(market, args.quotes);

  return {
    propMarketId: market.id,
    gameId: game.id,
    playerId: market.playerId,
    playerName,
    teamAbbr,
    opponentAbbr,
    propType: market.propType,
    season,
    week,
    marketLine: marketFeatures.line,
    overOdds: marketFeatures.overOdds,
    underOdds: marketFeatures.underOdds,
    projectionMean: market.projectionMean,
    projectionStdDev: market.projectionStdDev,
    recentSnapShare: usage.recentSnapShare,
    recentTargetShare: usage.recentTargetShare,
    recentCarryShare: usage.recentCarryShare,
    seasonSnapShare: usage.seasonSnapShare,
    seasonTargetShare: usage.seasonTargetShare,
    seasonCarryShare: usage.seasonCarryShare,
    projectedTeamPlays: teamVol.projectedTeamPlays,
    projectedPassRate: teamVol.projectedPassRate,
    roleStabilityScore,
    gameScriptScore: gs.gameScriptScore,
    paceScore: gs.paceScore,
    marketContextScore,
    weatherEnvironmentScore,
    injuryContextScore,
    correlationExposureScore,
    dataQualityScore,
    coachingTransition,
  };
}
