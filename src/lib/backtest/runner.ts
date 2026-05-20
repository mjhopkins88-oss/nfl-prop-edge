/**
 * Backtest runner — week-by-week replay against stored data.
 *
 * GUARDRAILS:
 *   - NEVER call paid APIs from this file. The backtest consumes
 *     stored / fixture data only.
 *   - Use the staged ingestion pipeline (out-of-band, dry-run by
 *     default) to populate `data/processed/`. The runner reads, never
 *     fetches.
 *   - Do NOT add touchdown props to V1.
 *   - When replaying week N, only use data with (season < S) OR
 *     (season == S AND week < N). No future-data leakage.
 */

import type { PropType } from "../types";
import { buildPropDecisionScorecard } from "../model/model-scorecard";
import { buildPregameFeatureRow } from "./feature-builder";
import { buildScorecardInputFromFeatureRow } from "./projection-adapter";
import { gradeBacktestResults } from "./grading";
import {
  calculateAverageEdge,
  calculateAverageExpectedValue,
  calculateBrierScore,
  calculateHitRate,
  calculateMaxDrawdown,
  calculateROI,
  summarizeByCoachingUncertaintyBucket,
  summarizeByConfidenceBucket,
  summarizeByEdgeBucket,
  summarizeByPrimaryDisqualifier,
  summarizeByPropType,
  summarizeByWeatherRiskBucket,
} from "./metrics";
import {
  loadBacktestFixtures,
  type LoadedBacktestFixtures,
} from "./data-loader";
import type {
  BacktestCandidate,
  BacktestGradedResult,
  BacktestScope,
  BacktestSummary,
} from "./types";

export const V1_PROP_TYPES: readonly PropType[] = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
];

export const V1_STARTER_PROP_TYPES: readonly PropType[] = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "RECEPTIONS",
  "RUSHING_ATTEMPTS",
];

export interface RunBacktestArgs {
  scope: BacktestScope;
  fixtures?: LoadedBacktestFixtures;
}

export interface RunBacktestOutput {
  summary: BacktestSummary;
  results: BacktestGradedResult[];
}

export function runBacktest(args: RunBacktestArgs): RunBacktestOutput {
  const fixtures = args.fixtures ?? loadBacktestFixtures();
  const { scope } = args;

  const allowedPropTypes = new Set<PropType>(scope.propTypes);
  if (!scope.includeYardage) {
    allowedPropTypes.delete("PASSING_YARDS");
    allowedPropTypes.delete("RECEIVING_YARDS");
    allowedPropTypes.delete("RUSHING_YARDS");
  }

  const candidates: BacktestCandidate[] = [];

  for (let week = scope.startWeek; week <= scope.endWeek; week++) {
    const gamesThisWeek = fixtures.games.filter(
      (g) => g.season === scope.season && g.week === week,
    );
    if (gamesThisWeek.length === 0) continue;

    const marketsThisWeek = fixtures.propMarkets.filter((m) => {
      if (!allowedPropTypes.has(m.propType)) return false;
      const game = gamesThisWeek.find((g) => g.id === m.gameId);
      return game !== undefined;
    });

    for (const market of marketsThisWeek) {
      const game = gamesThisWeek.find((g) => g.id === market.gameId);
      if (!game) continue;
      const featureRow = buildPregameFeatureRow({
        market,
        game,
        season: scope.season,
        week,
        playerWeekStats: fixtures.playerWeekStats,
        quotes: fixtures.propQuotes,
        weather: fixtures.weather,
        injuryFlags: fixtures.injuryFlags,
        allMarketsThisWeek: marketsThisWeek,
      });
      const scorecardInput = buildScorecardInputFromFeatureRow(featureRow);
      const scorecard = buildPropDecisionScorecard(scorecardInput);
      candidates.push({
        propMarketId: market.id,
        gameId: game.id,
        playerId: market.playerId,
        playerName: featureRow.playerName,
        teamAbbr: featureRow.teamAbbr,
        opponentAbbr: featureRow.opponentAbbr,
        propType: market.propType,
        season: scope.season,
        week,
        marketLine: featureRow.marketLine,
        scorecard,
      });
    }
  }

  const results = gradeBacktestResults({
    candidates,
    playerWeekStats: fixtures.playerWeekStats,
  });

  const evaluated = results.length;
  const qualifiedBets = results.filter((r) => r.bet).length;
  const passes = results.filter((r) => !r.bet).length;
  const wins = results.filter((r) => r.outcome === "WIN").length;
  const losses = results.filter((r) => r.outcome === "LOSS").length;
  const pushes = results.filter((r) => r.outcome === "PUSH").length;

  const byPropType = summarizeByPropType(results);
  const byDisqualifier = summarizeByPrimaryDisqualifier(results);
  const byEdgeBucket = summarizeByEdgeBucket(results);
  const byConfidence = summarizeByConfidenceBucket(results);
  const byCoachingUncertainty = summarizeByCoachingUncertaintyBucket(results);
  const byWeatherRisk = summarizeByWeatherRiskBucket(results);

  const propTypeWithBets = byPropType.filter((s) => s.bets >= 2);
  const bestPropType =
    propTypeWithBets.sort((a, b) => b.roiPct - a.roiPct)[0]?.propType ??
    byPropType.sort((a, b) => b.roiPct - a.roiPct)[0]?.propType;
  const worstPropType =
    propTypeWithBets.sort((a, b) => a.roiPct - b.roiPct)[0]?.propType ??
    byPropType.sort((a, b) => a.roiPct - b.roiPct)[0]?.propType;

  const profitUnits = results.reduce(
    (acc, r) => acc + r.profitLossUnits,
    0,
  );

  const summary: BacktestSummary = {
    scope,
    generatedAt: new Date().toISOString(),
    evaluated,
    qualifiedBets,
    passes,
    wins,
    losses,
    pushes,
    hitRate: calculateHitRate(results),
    roiPct: calculateROI(results) * 100,
    averageEdge: calculateAverageEdge(results),
    averageExpectedValueUnits: calculateAverageExpectedValue(results),
    brierScore: calculateBrierScore(results),
    maxDrawdownUnits: calculateMaxDrawdown(results),
    profitUnits,
    bestPropType,
    worstPropType,
    mostCommonDisqualifier: byDisqualifier[0]?.disqualifier,
    byPropType,
    byDisqualifier,
    byEdgeBucket,
    byConfidence,
    byCoachingUncertainty,
    byWeatherRisk,
  };

  return { summary, results };
}
