/**
 * Backtest grading.
 *
 * Compare scorecard recommendation against the actual stat the player
 * produced in the test week. PASS rows still count as evaluated but
 * are not bets — no profit/loss is assigned. However, every PASS also
 * gets a *counterfactual* outcome ("what would have happened if we
 * acted on the model's lean anyway") so the postmortem tagger can
 * tell filters that saved us from a loss apart from filters that cost
 * us a winner.
 *
 * Flat staking: 1 unit risk per qualified bet. American odds → payout
 * on a WIN, -1 unit on a LOSS, 0 on PUSH/PASS.
 */

import type { PropType } from "../types";
import type {
  BacktestBetResult,
  BacktestCandidate,
  BacktestEvaluatedProp,
  BacktestPlayerWeekStat,
} from "./types";
import { getPrimaryDisqualifier } from "../model/model-scorecard";
import { selectedEdge } from "../model/prop-opportunity";
import {
  getConfidenceBucket,
  getEdgeBucket,
  getLineBucket,
} from "./line-buckets";
import { assignPostmortemTags } from "./postmortem";

const STAT_KEY_BY_PROP_TYPE: Record<PropType, keyof BacktestPlayerWeekStat> = {
  PASSING_ATTEMPTS: "passingAttempts",
  PASSING_COMPLETIONS: "passingCompletions",
  PASSING_YARDS: "passingYards",
  RECEPTIONS: "receptions",
  RECEIVING_YARDS: "receivingYards",
  RUSHING_ATTEMPTS: "rushingAttempts",
  RUSHING_YARDS: "rushingYards",
};

export function getActualStatForProp(args: {
  playerId: string;
  propType: PropType;
  season: number;
  week: number;
  playerWeekStats: BacktestPlayerWeekStat[];
}): number | null {
  const row = args.playerWeekStats.find(
    (r) =>
      r.playerId === args.playerId &&
      r.season === args.season &&
      r.week === args.week,
  );
  if (!row) return null;
  const key = STAT_KEY_BY_PROP_TYPE[args.propType];
  const value = row[key];
  return typeof value === "number" ? value : null;
}

function americanPayoutMultiplier(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

function outcomeFromSide(
  selectedSide: "OVER" | "UNDER",
  line: number,
  actual: number | null,
): BacktestBetResult {
  if (actual == null) return "NO_RESULT";
  if (actual === line) return "PUSH";
  const overWins = actual > line;
  return (selectedSide === "OVER" && overWins) ||
    (selectedSide === "UNDER" && !overWins)
    ? "WIN"
    : "LOSS";
}

function profitLossForOutcome(
  outcome: BacktestBetResult,
  odds: number,
): number {
  if (outcome === "WIN") return americanPayoutMultiplier(odds);
  if (outcome === "LOSS") return -1;
  return 0;
}

export function gradeBacktestCandidate(args: {
  candidate: BacktestCandidate;
  playerWeekStats: BacktestPlayerWeekStat[];
}): BacktestEvaluatedProp {
  const { candidate } = args;
  const sc = candidate.scorecard;
  const actual = getActualStatForProp({
    playerId: candidate.playerId,
    propType: candidate.propType,
    season: candidate.season,
    week: candidate.week,
    playerWeekStats: args.playerWeekStats,
  });

  const selectedSide: "OVER" | "UNDER" = sc.selectedSide;
  const selectedOdds =
    selectedSide === "OVER" ? sc.overOdds : sc.underOdds;

  const counterfactualResult = outcomeFromSide(
    selectedSide,
    sc.marketLine,
    actual,
  );
  const counterfactualProfitLossUnits = profitLossForOutcome(
    counterfactualResult,
    selectedOdds,
  );

  let result: BacktestBetResult;
  let profitLossUnits = 0;
  const bet = sc.qualified && sc.recommendation !== "PASS";

  if (!bet) {
    result = "PASS";
  } else {
    result = counterfactualResult;
    profitLossUnits = profitLossForOutcome(result, selectedOdds);
  }

  const edge = selectedEdge(sc);
  const primaryDisq = getPrimaryDisqualifier(sc);

  const evaluated: BacktestEvaluatedProp = {
    id: `${candidate.season}-w${candidate.week}-${candidate.propMarketId}`,
    season: candidate.season,
    week: candidate.week,
    gameId: candidate.gameId,
    playerId: candidate.playerId,
    playerName: candidate.playerName,
    team: candidate.teamAbbr,
    opponent: candidate.opponentAbbr,
    propType: candidate.propType,
    line: candidate.marketLine,
    lineBucket: getLineBucket(candidate.propType, candidate.marketLine),
    marketOverProbability: sc.marketOverProbability,
    marketUnderProbability: sc.marketUnderProbability,
    modelOverProbability: sc.modelOverProbability,
    modelUnderProbability: sc.modelUnderProbability,
    edge,
    edgeBucket: getEdgeBucket(edge),
    recommendation: sc.recommendation,
    qualified: sc.qualified,
    confidence: sc.confidence,
    confidenceBucket: getConfidenceBucket(sc.confidence),
    primaryDisqualifier: primaryDisq ?? undefined,
    disqualifiers: sc.disqualifiers,
    riskScore: sc.riskScore,
    dataQualityScore: sc.dataQualityScore,
    roleStabilityScore: sc.roleStabilityScore,
    weatherRiskScore: sc.weatherEnvironmentScore,
    injuryRiskScore: sc.injuryContextScore,
    coachingUncertaintyScore:
      sc.coachingTransition?.scores.coachingUncertaintyPenalty ?? 0,
    correlationRiskScore: sc.correlationExposureScore,
    overOdds: sc.overOdds,
    underOdds: sc.underOdds,
    selectedOdds,
    selectedSide,
    actualStat: actual,
    result,
    profitLossUnits,
    counterfactualResult,
    counterfactualProfitLossUnits,
    postmortemTags: [],
    scorecardSnapshot: sc,
    createdAt: new Date().toISOString(),
  };
  evaluated.postmortemTags = assignPostmortemTags(evaluated);
  return evaluated;
}

export function gradeBacktestResults(args: {
  candidates: BacktestCandidate[];
  playerWeekStats: BacktestPlayerWeekStat[];
}): BacktestEvaluatedProp[] {
  return args.candidates.map((candidate) =>
    gradeBacktestCandidate({
      candidate,
      playerWeekStats: args.playerWeekStats,
    }),
  );
}
