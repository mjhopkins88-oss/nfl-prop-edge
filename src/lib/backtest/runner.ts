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
  buildModelAuditSummary,
  calculateAverageEdge,
  calculateAverageExpectedValue,
  calculateBrierScore,
  calculateHitRate,
  calculateMaxDrawdown,
  calculateROI,
  summarizeByCoachingUncertaintyBucket,
  summarizeByConfidenceBucket,
  summarizeByEdgeBucket,
  summarizeByLineBucket,
  summarizeByPostmortem,
  summarizeByPrimaryDisqualifier,
  summarizeByPropType,
  summarizeByQualifiedVsPassed,
  summarizeByRecommendationSide,
  summarizeByRoleStability,
  summarizeByWeatherRiskBucket,
} from "./metrics";
import {
  loadBacktestFixtures,
  type LoadedBacktestFixtures,
} from "./data-loader";
import type {
  BacktestCandidate,
  BacktestEvaluatedProp,
  BacktestScope,
  BacktestSummary,
} from "./types";
import {
  buildV2BacktestCandidate,
  type V2BacktestCandidate,
  type V2BacktestMetadata,
} from "./v2-pipeline-adapter";

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

/**
 * Backtest algorithm mode. The v2 pipeline is opt-in — `V1_SCORECARD`
 * remains the default so existing callers and dashboard recommendations
 * are unchanged. `COMPARE_V1_V2` runs both paths over the same fixtures
 * — use the comparison runner in `algorithm-comparison.ts` for the
 * full A/B output.
 */
export type BacktestAlgorithmMode =
  | "V1_SCORECARD"
  | "V2_PIPELINE"
  | "COMPARE_V1_V2";

export interface RunBacktestArgs {
  scope: BacktestScope;
  fixtures?: LoadedBacktestFixtures;
  /** Defaults to V1_SCORECARD. */
  algorithmMode?: BacktestAlgorithmMode;
}

export interface RunBacktestOutput {
  summary: BacktestSummary;
  results: BacktestEvaluatedProp[];
  /** Echoed for downstream consumers (defaults to V1_SCORECARD). */
  algorithmMode: BacktestAlgorithmMode;
  /**
   * Populated when `algorithmMode === "V2_PIPELINE"`. The keys are
   * `propMarketId` so the comparison runner can join V1 and V2
   * candidates without re-walking the fixture loop.
   */
  v2Metadata?: Record<string, V2BacktestMetadata>;
}

export function runBacktest(args: RunBacktestArgs): RunBacktestOutput {
  const fixtures = args.fixtures ?? loadBacktestFixtures();
  const { scope } = args;
  const mode: BacktestAlgorithmMode = args.algorithmMode ?? "V1_SCORECARD";
  // COMPARE_V1_V2 is orchestrated externally — when called via
  // `runBacktest` we treat it as V1 and let the caller invoke
  // `runBacktestComparison` for the full A/B output.
  const effectiveMode: "V1_SCORECARD" | "V2_PIPELINE" =
    mode === "V2_PIPELINE" ? "V2_PIPELINE" : "V1_SCORECARD";

  const allowedPropTypes = new Set<PropType>(scope.propTypes);
  if (!scope.includeYardage) {
    allowedPropTypes.delete("PASSING_YARDS");
    allowedPropTypes.delete("RECEIVING_YARDS");
    allowedPropTypes.delete("RUSHING_YARDS");
  }

  const candidates: BacktestCandidate[] = [];
  const v2MetadataByPropMarketId: Record<string, V2BacktestMetadata> = {};

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
      if (effectiveMode === "V2_PIPELINE") {
        const v2Candidate: V2BacktestCandidate =
          buildV2BacktestCandidate(featureRow);
        candidates.push({
          propMarketId: v2Candidate.propMarketId,
          gameId: v2Candidate.gameId,
          playerId: v2Candidate.playerId,
          playerName: v2Candidate.playerName,
          teamAbbr: v2Candidate.teamAbbr,
          opponentAbbr: v2Candidate.opponentAbbr,
          propType: v2Candidate.propType,
          season: v2Candidate.season,
          week: v2Candidate.week,
          marketLine: v2Candidate.marketLine,
          scorecard: v2Candidate.scorecard,
        });
        v2MetadataByPropMarketId[v2Candidate.propMarketId] = v2Candidate.v2;
      } else {
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
  }

  const results = gradeBacktestResults({
    candidates,
    playerWeekStats: fixtures.playerWeekStats,
  });

  const isBet = (r: BacktestEvaluatedProp) =>
    r.qualified && r.recommendation !== "PASS";

  const evaluated = results.length;
  const qualifiedBets = results.filter(isBet).length;
  const passes = results.filter((r) => !isBet(r)).length;
  const wins = results.filter((r) => r.result === "WIN").length;
  const losses = results.filter((r) => r.result === "LOSS").length;
  const pushes = results.filter((r) => r.result === "PUSH").length;

  const byPropType = summarizeByPropType(results);
  const byDisqualifier = summarizeByPrimaryDisqualifier(results);
  const byEdgeBucket = summarizeByEdgeBucket(results);
  const byConfidence = summarizeByConfidenceBucket(results);
  const byCoachingUncertainty = summarizeByCoachingUncertaintyBucket(results);
  const byWeatherRisk = summarizeByWeatherRiskBucket(results);
  const byLineBucket = summarizeByLineBucket(results);
  const byPostmortem = summarizeByPostmortem(results);
  const byRecommendationSide = summarizeByRecommendationSide(results);
  const byRoleStability = summarizeByRoleStability(results);
  const byQualifiedVsPassed = summarizeByQualifiedVsPassed(results);

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

  const audit = buildModelAuditSummary(
    results,
    byPropType,
    byLineBucket,
    byEdgeBucket,
    byConfidence,
    byPostmortem,
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
    byLineBucket,
    byPostmortem,
    byRecommendationSide,
    byRoleStability,
    byQualifiedVsPassed,
    audit,
  };

  return {
    summary,
    results,
    algorithmMode: effectiveMode,
    v2Metadata:
      effectiveMode === "V2_PIPELINE" ? v2MetadataByPropMarketId : undefined,
  };
}
