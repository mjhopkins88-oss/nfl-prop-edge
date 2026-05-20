/**
 * Per-week backtest simulation — orchestrates the V1 starter-test
 * workflow and the Model Monitor's "what would have happened" view.
 *
 * Pure CPU on stored / fixture data. Never calls a paid API.
 * Future-data leakage is prevented by:
 *
 *   1. `buildWeekPregameSnapshot` runs the existing fixture
 *      backtest restricted to `endWeek = week`. The feature
 *      builder already gates by strict-before-week, so the
 *      pregame view shows only what the model would have seen
 *      going into kickoff.
 *   2. `runWeekSimulation` is `buildWeekPregameSnapshot` plus a
 *      grading pass against the player-week-stat fixture's actual
 *      week results. Actual results are NEVER read when producing
 *      the pregame snapshot.
 *   3. The output bundle distinguishes `pregameSnapshot` (no
 *      results) from `evaluatedProps` (graded outcomes) — the UI
 *      and tests rely on this separation.
 *
 * Author note: the parlay + game edge previews here are
 * intentionally lean — they re-use the existing fixture builders
 * via thin adapters so future changes to those modules flow into
 * the Week-1 view automatically.
 */

import {
  runBacktest,
  type BacktestAlgorithmMode,
} from "./runner";
import {
  runBacktestComparison,
  type AlgorithmDeltaSummary,
  type RecommendationChange,
  type RecommendationChangeSummary,
} from "./algorithm-comparison";
import { loadBacktestFixtures } from "./data-loader";
import type {
  BacktestEvaluatedProp,
  BacktestScope,
  BacktestSummary,
} from "./types";
import { buildGameEdge } from "../model/game-edge-model";
import { GAME_EDGE_FIXTURES } from "../model/game-edge-data";
import type { GameEdgeOutput } from "../model/game-edge-types";
import { buildAllFixtureParlayCandidates } from "../model/parlay-scorecard";
import { optimizeParlayPortfolio } from "../model/parlay-selection-optimizer";
import { classifyParlayRiskProfile } from "../model/parlay-risk-profile";
import { simulateParlayCandidateBatch } from "../model/parlay-target-math";
import type {
  ParlayCandidate,
  ParlayBatchSimulation,
  ParlayPortfolioSummary,
} from "../model/parlay-types";

// V1 starter markets — defaults to the four lower-variance volume
// markets per the 2025 plan. Yardage markets stay deferred.
import { V1_STARTER_PROP_TYPES } from "./runner";
import type { PropType } from "../types";

export interface WeekSimulationInput {
  season: number;
  week: number;
  /** Defaults to V1_STARTER_PROP_TYPES. */
  propTypes?: readonly PropType[];
  /** Defaults to "V1_SCORECARD". */
  algorithmMode?: BacktestAlgorithmMode;
  /** Defaults to true. */
  useFixtures?: boolean;
  /**
   * Optional fixture root override. The default backtest fixture
   * dir is Week 11; pass `data/fixtures/backtest/week-1` for the
   * Week 1 starter test. The runner reads stored data only.
   */
  fixtureRoot?: string;
}

export interface WeekPregameSnapshot {
  season: number;
  week: number;
  /** Active prop type list for the snapshot. */
  propTypes: readonly PropType[];
  /** Markets explicitly excluded from the starter test. */
  excludedPropTypes: readonly PropType[];
  /** True when no Week-N actual results were used to build this. */
  pregameOnly: true;
  /** Generated at ISO timestamp. */
  generatedAt: string;
  /** Algorithm mode this snapshot was built with. */
  algorithmMode: BacktestAlgorithmMode;
  /** Recommendation rows — note that these still carry an `actualStat`
   *  field on the scorecard snapshot if the fixture has post-game
   *  numbers attached, but the snapshot itself does NOT consume them.
   *  The simulation pass below is where outcomes enter. */
  candidates: BacktestEvaluatedProp[];
}

export interface WeekRecommendationChange {
  propMarketId: string;
  playerName: string;
  propType: PropType;
  line: number;
  v1Recommendation: string;
  v2Recommendation: string;
  v1Qualified: boolean;
  v2Qualified: boolean;
  v1PrimaryDisqualifier?: string;
  v2PrimaryDisqualifier?: string;
  v2ConfidenceAdjustedEdge: number;
  kind: string;
}

export interface WeekV1V2Comparison {
  /** True if V2 actually changed at least one decision. */
  anyChanges: boolean;
  v1Summary: BacktestSummary;
  v2Summary: BacktestSummary;
  deltaSummary: AlgorithmDeltaSummary;
  recommendationChanges: WeekRecommendationChange[];
  recommendationChangeSummary: RecommendationChangeSummary;
}

export interface WeekParlayPreview {
  candidates: ParlayCandidate[];
  portfolioSummary: ParlayPortfolioSummary;
  batchSimulation: ParlayBatchSimulation;
}

export interface WeekGameEdgePreview {
  games: GameEdgeOutput[];
  qualifiedCount: number;
  upsetWatchCount: number;
  passCount: number;
}

export interface WeekSimulationResult {
  season: number;
  week: number;
  algorithmMode: BacktestAlgorithmMode;
  generatedAt: string;
  /** Pregame-only view — no Week-N actuals consumed. */
  pregameSnapshot: WeekPregameSnapshot;
  /** Graded rows. */
  evaluatedProps: BacktestEvaluatedProp[];
  qualifiedBets: BacktestEvaluatedProp[];
  passedProps: BacktestEvaluatedProp[];
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  averageEdge: number;
  averageConfidenceAdjustedEdge: number;
  bestPropType?: PropType;
  worstPropType?: PropType;
  commonDisqualifiers: Array<{ disqualifier: string; count: number }>;
  v1v2Comparison?: WeekV1V2Comparison;
  parlayPreview: WeekParlayPreview;
  gameEdgePreview: WeekGameEdgePreview;
}

const EXCLUDED_PROP_TYPES: readonly PropType[] = [
  "PASSING_YARDS",
  "RECEIVING_YARDS",
  "RUSHING_YARDS",
];

function buildScope(args: {
  season: number;
  week: number;
  propTypes: readonly PropType[];
}): BacktestScope {
  return {
    season: args.season,
    startWeek: args.week,
    endWeek: args.week,
    propTypes: args.propTypes,
    includeYardage: false,
    useFixtures: true,
  };
}

/**
 * Build the pregame view of a week. The feature builder's strict-
 * before filter already excludes the current-week actuals; this
 * function just runs the backtest scoped to `[week, week]` and
 * strips any grading output from the returned rows so the consumer
 * cannot accidentally read them.
 */
export function buildWeekPregameSnapshot(
  input: WeekSimulationInput,
): WeekPregameSnapshot {
  const propTypes = input.propTypes ?? V1_STARTER_PROP_TYPES;
  const algorithmMode = input.algorithmMode ?? "V1_SCORECARD";
  const scope = buildScope({
    season: input.season,
    week: input.week,
    propTypes,
  });
  const fixtures = loadBacktestFixtures(input.fixtureRoot);
  const { results } = runBacktest({
    scope,
    fixtures,
    algorithmMode,
  });
  // Strip post-game outcomes from the pregame snapshot to prevent
  // future-data leakage in any UI that reads it.
  const pregameRows: BacktestEvaluatedProp[] = results.map((r) => ({
    ...r,
    actualStat: null,
    result: "PASS",
    profitLossUnits: 0,
    counterfactualResult: "NO_RESULT",
    counterfactualProfitLossUnits: 0,
    postmortemTags: [],
  }));
  return {
    season: input.season,
    week: input.week,
    propTypes,
    excludedPropTypes: EXCLUDED_PROP_TYPES,
    pregameOnly: true,
    generatedAt: new Date().toISOString(),
    algorithmMode,
    candidates: pregameRows,
  };
}

/**
 * Run a full simulation: pregame snapshot + grading against the
 * fixture's actual Week-N results + parlay + game-edge previews +
 * an optional V1 vs V2 comparison.
 *
 * Grading is done by the existing backtest runner — this function
 * is just orchestration. The pregame snapshot is built separately
 * so callers can confirm it does not depend on outcomes.
 */
export function runWeekSimulation(
  input: WeekSimulationInput,
): WeekSimulationResult {
  const propTypes = input.propTypes ?? V1_STARTER_PROP_TYPES;
  const algorithmMode = input.algorithmMode ?? "V1_SCORECARD";
  const scope = buildScope({
    season: input.season,
    week: input.week,
    propTypes,
  });
  const fixtures = loadBacktestFixtures(input.fixtureRoot);
  const { results } = runBacktest({
    scope,
    fixtures,
    algorithmMode,
  });

  const summary = summarizeWeekResults(results);

  const v1v2Comparison =
    algorithmMode === "V1_SCORECARD"
      ? buildV1V2ComparisonForWeek({
          scope,
          fixtures,
        })
      : undefined;

  const parlayPreview = buildParlayPreview();
  const gameEdgePreview = buildGameEdgePreview();
  const pregameSnapshot = buildWeekPregameSnapshot({
    ...input,
    algorithmMode,
  });

  return {
    season: input.season,
    week: input.week,
    algorithmMode,
    generatedAt: new Date().toISOString(),
    pregameSnapshot,
    evaluatedProps: results,
    qualifiedBets: results.filter(
      (r) => r.qualified && r.recommendation !== "PASS",
    ),
    passedProps: results.filter(
      (r) => !r.qualified || r.recommendation === "PASS",
    ),
    wins: summary.wins,
    losses: summary.losses,
    pushes: summary.pushes,
    hitRate: summary.hitRate,
    roiPct: summary.roiPct,
    averageEdge: summary.averageEdge,
    averageConfidenceAdjustedEdge: summary.averageConfidenceAdjustedEdge,
    bestPropType: summary.bestPropType,
    worstPropType: summary.worstPropType,
    commonDisqualifiers: summary.commonDisqualifiers,
    v1v2Comparison,
    parlayPreview,
    gameEdgePreview,
  };
}

/**
 * Grade a pre-built list of evaluated rows. Re-uses the runner's
 * scoped output so callers don't have to re-walk the fixture loop.
 */
export function gradeWeekRecommendations(input: {
  evaluatedProps: BacktestEvaluatedProp[];
}): {
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
} {
  const bets = input.evaluatedProps.filter(
    (r) => r.qualified && r.recommendation !== "PASS",
  );
  const wins = bets.filter((r) => r.result === "WIN").length;
  const losses = bets.filter((r) => r.result === "LOSS").length;
  const pushes = bets.filter((r) => r.result === "PUSH").length;
  const decided = wins + losses;
  return {
    wins,
    losses,
    pushes,
    hitRate: decided === 0 ? 0 : wins / decided,
  };
}

export interface WeekResultsSummary {
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  averageEdge: number;
  averageConfidenceAdjustedEdge: number;
  bestPropType?: PropType;
  worstPropType?: PropType;
  commonDisqualifiers: Array<{ disqualifier: string; count: number }>;
}

export function summarizeWeekResults(
  results: BacktestEvaluatedProp[],
): WeekResultsSummary {
  const bets = results.filter(
    (r) => r.qualified && r.recommendation !== "PASS",
  );
  const wins = bets.filter((r) => r.result === "WIN").length;
  const losses = bets.filter((r) => r.result === "LOSS").length;
  const pushes = bets.filter((r) => r.result === "PUSH").length;
  const decided = wins + losses;
  const profit = bets.reduce((a, r) => a + r.profitLossUnits, 0);
  const stake = bets.length;
  const roiPct = stake === 0 ? 0 : (profit / stake) * 100;
  const avgEdge =
    bets.length === 0
      ? 0
      : bets.reduce((a, r) => a + Math.abs(r.edge), 0) / bets.length;

  // Per-prop-type aggregation for best / worst.
  const perType = new Map<
    PropType,
    { wins: number; losses: number; profit: number; bets: number }
  >();
  for (const r of bets) {
    const cur = perType.get(r.propType) ?? {
      wins: 0,
      losses: 0,
      profit: 0,
      bets: 0,
    };
    cur.bets += 1;
    if (r.result === "WIN") cur.wins += 1;
    if (r.result === "LOSS") cur.losses += 1;
    cur.profit += r.profitLossUnits;
    perType.set(r.propType, cur);
  }
  let bestPropType: PropType | undefined;
  let worstPropType: PropType | undefined;
  let bestRoi = -Infinity;
  let worstRoi = Infinity;
  for (const [type, stat] of perType.entries()) {
    if (stat.bets === 0) continue;
    const roi = stat.profit / stat.bets;
    if (roi > bestRoi) {
      bestRoi = roi;
      bestPropType = type;
    }
    if (roi < worstRoi) {
      worstRoi = roi;
      worstPropType = type;
    }
  }

  // Disqualifier histogram.
  const disq = new Map<string, number>();
  for (const r of results) {
    if (!r.qualified && r.primaryDisqualifier) {
      disq.set(r.primaryDisqualifier, (disq.get(r.primaryDisqualifier) ?? 0) + 1);
    }
  }
  const commonDisqualifiers = [...disq.entries()]
    .map(([disqualifier, count]) => ({ disqualifier, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    wins,
    losses,
    pushes,
    hitRate: decided === 0 ? 0 : wins / decided,
    roiPct,
    averageEdge: avgEdge,
    averageConfidenceAdjustedEdge: avgEdge, // V1 path uses raw edge — match for transparency
    bestPropType,
    worstPropType,
    commonDisqualifiers,
  };
}

function buildV1V2ComparisonForWeek(args: {
  scope: BacktestScope;
  fixtures: ReturnType<typeof loadBacktestFixtures>;
}): WeekV1V2Comparison | undefined {
  try {
    const result = runBacktestComparison({
      scope: args.scope,
      fixtures: args.fixtures,
    });
    const anyChanges =
      (result.recommendationChangeSummary.counts.V1_BET_V2_PASS ?? 0) +
        (result.recommendationChangeSummary.counts.V1_PASS_V2_BET ?? 0) +
        (result.recommendationChangeSummary.counts.OPPOSITE_SIDE ?? 0) +
        (result.recommendationChangeSummary.counts
          .SAME_PASS_DIFFERENT_REASON ?? 0) +
        (result.recommendationChangeSummary.counts
          .SAME_RECOMMENDATION_DIFFERENT_CONFIDENCE ?? 0) >
      0;
    const recommendationChanges: WeekRecommendationChange[] =
      result.recommendationChangeSummary.changes.map(
        (c: RecommendationChange) => ({
          propMarketId: c.propMarketId,
          playerName: c.playerName,
          propType: c.propType as PropType,
          line: c.marketLine,
          v1Recommendation: c.v1Recommendation,
          v2Recommendation: c.v2Recommendation,
          v1Qualified: c.v1Qualified,
          v2Qualified: c.v2Qualified,
          v1PrimaryDisqualifier: c.v1PrimaryDisqualifier,
          v2PrimaryDisqualifier: c.v2PrimaryDisqualifier,
          v2ConfidenceAdjustedEdge: c.v2ConfidenceAdjustedEdge,
          kind: c.kind,
        }),
      );
    return {
      anyChanges,
      v1Summary: result.v1Summary,
      v2Summary: result.v2Summary,
      deltaSummary: result.deltaSummary,
      recommendationChanges,
      recommendationChangeSummary: result.recommendationChangeSummary,
    };
  } catch {
    // The comparison runner shouldn't throw, but if fixture data is
    // missing we surface "no comparison available" cleanly instead
    // of taking the rest of the simulation down with us.
    return undefined;
  }
}

function buildParlayPreview(): WeekParlayPreview {
  const candidates = buildAllFixtureParlayCandidates();
  const portfolio = optimizeParlayPortfolio(candidates);
  const batchSimulation = simulateParlayCandidateBatch({
    candidates: portfolio.selected,
  });
  return {
    candidates,
    portfolioSummary: portfolio.summary,
    batchSimulation,
  };
}

function buildGameEdgePreview(): WeekGameEdgePreview {
  const games = GAME_EDGE_FIXTURES.map((f) => buildGameEdge(f));
  const qualifiedCount = games.filter(
    (g) =>
      g.recommendation === "HOME_MONEYLINE" ||
      g.recommendation === "AWAY_MONEYLINE" ||
      g.recommendation === "HOME_SPREAD" ||
      g.recommendation === "AWAY_SPREAD",
  ).length;
  const upsetWatchCount = games.filter(
    (g) => g.recommendationLabel === "Upset Watch",
  ).length;
  const passCount = games.filter((g) => g.recommendation === "PASS").length;
  return { games, qualifiedCount, upsetWatchCount, passCount };
}

/** Risk-profile breakdown for the monitor's parlay panel. */
export function summarizeParlayRiskProfiles(
  candidates: ParlayCandidate[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const c of candidates) {
    const profile = classifyParlayRiskProfile(c);
    counts[profile] = (counts[profile] ?? 0) + 1;
  }
  return counts;
}
