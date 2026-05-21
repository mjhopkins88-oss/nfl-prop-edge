/**
 * Server-side helpers to load the Week 1 starter-test outputs
 * written by `scripts/run-week-1-starter-test.ts`. Returns
 * undefined when a file is missing so pages can render a
 * "fixture not generated yet" hint instead of crashing.
 *
 * Pure file IO. Never calls a network.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  WeekPregameSnapshot,
} from "./week-simulation";

const ROOT = path.join(process.cwd(), "data", "backtests", "2025");

function readJsonIfExists<T>(filename: string): T | undefined {
  const p = path.join(ROOT, filename);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function loadWeek1Pregame(): WeekPregameSnapshot | undefined {
  return readJsonIfExists<WeekPregameSnapshot>("week-1-pregame.fixture.json");
}

export interface Week1Results {
  season: number;
  week: number;
  algorithmMode: string;
  generatedAt: string;
  evaluatedProps: Array<{
    id: string;
    playerName: string;
    team: string;
    opponent: string;
    propType: string;
    line: number;
    selectedSide: "OVER" | "UNDER";
    edge: number;
    recommendation: string;
    qualified: boolean;
    primaryDisqualifier?: string;
    confidence: number;
    result: string;
    actualStat: number | null;
    profitLossUnits: number;
    scorecardSnapshot?: {
      reasons?: string[];
      risks?: string[];
      finalExplanation?: string;
    };
  }>;
  /** ID list — full row lives in `evaluatedProps`. */
  qualifiedBets: string[];
  /** ID list — full row lives in `evaluatedProps`. */
  passedProps: string[];
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  averageEdge: number;
  averageConfidenceAdjustedEdge: number;
  bestPropType?: string;
  worstPropType?: string;
  commonDisqualifiers: Array<{ disqualifier: string; count: number }>;
}

export function loadWeek1Results(): Week1Results | undefined {
  return readJsonIfExists<Week1Results>("week-1-results.fixture.json");
}

export interface Week1V1V2Comparison {
  generatedAt: string;
  v1: {
    evaluated: number;
    qualifiedBets: number;
    hitRate: number;
    roiPct: number;
    profitUnits: number;
  };
  v2: {
    evaluated: number;
    qualifiedBets: number;
    hitRate: number;
    roiPct: number;
    profitUnits: number;
  };
  delta: Record<string, unknown>;
  recommendationChanges: Array<{
    propMarketId: string;
    playerName: string;
    propType: string;
    line: number;
    v1Recommendation: string;
    v2Recommendation: string;
    v1Qualified: boolean;
    v2Qualified: boolean;
    v1PrimaryDisqualifier?: string;
    v2PrimaryDisqualifier?: string;
    v2ConfidenceAdjustedEdge: number;
    kind: string;
  }>;
  recommendationChangeSummary: {
    totalEvaluated: number;
    counts: Record<string, number>;
    v1OnlyBets: number;
    v2OnlyBets: number;
    oppositeSides: number;
    topNewV2Disqualifiers: Array<{ disqualifier: string; count: number }>;
  };
}

export function loadWeek1V1V2Comparison():
  | Week1V1V2Comparison
  | undefined {
  return readJsonIfExists<Week1V1V2Comparison>(
    "week-1-v1-v2-comparison.fixture.json",
  );
}

export interface Week1ParlayPreview {
  generatedAt: string;
  portfolioSummary: {
    selectedCount: number;
    filteredCount: number;
    averagePayoutMultiplier: number;
    averageProjectedHitRate: number;
    averageRequiredHitRate: number;
    averageConfidenceAdjustedEV: number;
    highRiskFilteredOut: number;
    mostCommonPassReason?: string;
    strongestParlayType?: string;
    weakestParlayType?: string;
    riskProfileCounts: Record<string, number>;
  };
  batchSimulation: {
    batchSize: number;
    projectedHitRate: number;
    averagePayoutMultiplier: number;
    expectedHits: number;
    expectedReturnUnits: number;
    expectedProfitUnits: number;
    expectedROI: number;
    breakEvenHitRate: number;
  };
  candidates: Array<{
    id: string;
    parlayType: string;
    legCount: number;
    gameIds: string[];
    teams: string[];
    combinedOddsAmerican: number;
    combinedOddsDecimal: number;
    independentJointProbability: number;
    correlationAdjustedJointProbability: number;
    marketJointProbability: number;
    expectedValue: number;
    confidenceAdjustedExpectedValue: number;
    payoutMultiplier: number;
    requiredHitRate: number;
    projectedHitRate: number;
    correlationScore: number;
    correlationType: string;
    recommendation: string;
    qualified: boolean;
    primaryDisqualifier?: string;
    reasons: string[];
    risks: string[];
    legs: Array<{
      id: string;
      playerName: string;
      team: string;
      opponent: string;
      gameId: string;
      propType: string;
      side: string;
      line: number;
      odds: number;
    }>;
  }>;
}

export function loadWeek1ParlayPreview():
  | Week1ParlayPreview
  | undefined {
  return readJsonIfExists<Week1ParlayPreview>(
    "week-1-parlay-preview.fixture.json",
  );
}

export interface Week1GameEdgePreview {
  generatedAt: string;
  qualifiedCount: number;
  upsetWatchCount: number;
  passCount: number;
  games: Array<{
    gameId: string;
    homeTeam: string;
    awayTeam: string;
    recommendation: string;
    recommendationLabel: string;
    selectedSide?: string;
    selectedMarket?: string;
    marketHomeWinProbability: number;
    marketAwayWinProbability: number;
    modelHomeWinProbability: number;
    modelAwayWinProbability: number;
    homeMoneylineEdge: number;
    awayMoneylineEdge: number;
    spreadEdgeHome: number;
    spreadEdgeAway: number;
    upsetScore: number;
    underdogSide?: string;
    confidence: number;
    riskScore: number;
    dataQualityScore: number;
    reasons: string[];
    risks: string[];
  }>;
}

export function loadWeek1GameEdgePreview():
  | Week1GameEdgePreview
  | undefined {
  return readJsonIfExists<Week1GameEdgePreview>(
    "week-1-game-edge-preview.fixture.json",
  );
}

export interface Week1LockedRecommendations {
  generatedAt: string;
  season: number;
  week: number;
  algorithmMode: string;
  lockedAt: string;
  totalCandidates: number;
  lockedQualifiedCount: number;
  lockedPasses: number;
  recommendations: Array<{
    propMarketId: string;
    playerName: string;
    team: string;
    opponent: string;
    propType: string;
    line: number;
    selectedSide: "OVER" | "UNDER";
    recommendation: string;
    qualified: boolean;
    confidence: number;
    edge: number;
    edgeBucket: string;
    primaryDisqualifier?: string;
    locked: boolean;
    season: number;
    week: number;
  }>;
}

export function loadWeek1LockedRecommendations():
  | Week1LockedRecommendations
  | undefined {
  return readJsonIfExists<Week1LockedRecommendations>(
    "week-1-locked-pregame-recommendations.fixture.json",
  );
}

export interface Week1DataAudit {
  generatedAt: string;
  season: number;
  week: number;
  algorithmMode: string;
  pregameOnly: boolean;
  includedPropTypes: string[];
  excludedPropTypes: string[];
  candidateCount: number;
  candidatesByPropType: Record<string, number>;
  actualResultsVisibleToModel: boolean;
  touchdownPropsAllowed: boolean;
  dataSources: string[];
  notes: string[];
}

export function loadWeek1DataAudit(): Week1DataAudit | undefined {
  return readJsonIfExists<Week1DataAudit>(
    "week-1-data-audit.fixture.json",
  );
}

export interface Week1OddsCoverage {
  generatedAt: string;
  season: number;
  week: number;
  totalProps: number;
  byPropType: Record<string, number>;
  byGame: Record<string, number>;
  source: string;
  paidApiCalls: number;
  note: string;
}

export function loadWeek1OddsCoverage(): Week1OddsCoverage | undefined {
  return readJsonIfExists<Week1OddsCoverage>(
    "week-1-odds-coverage.fixture.json",
  );
}

export interface Week1NflDataCoverage {
  generatedAt: string;
  season: number;
  week: number;
  uniquePlayerProps: number;
  players: Array<{ playerName: string; team: string; propType: string }>;
  source: string;
  historyWindow: string;
  note: string;
}

export function loadWeek1NflDataCoverage():
  | Week1NflDataCoverage
  | undefined {
  return readJsonIfExists<Week1NflDataCoverage>(
    "week-1-nfl-data-coverage.fixture.json",
  );
}

export interface Week1LeakageCheck {
  generatedAt: string;
  season: number;
  week: number;
  pregameOnly: boolean;
  actualResultsVisibleToModel: boolean;
  leakageDetected: boolean;
  violations: Array<{ id: string; reason: string }>;
  notes: string[];
}

export function loadWeek1LeakageCheck(): Week1LeakageCheck | undefined {
  return readJsonIfExists<Week1LeakageCheck>(
    "week-1-leakage-check.fixture.json",
  );
}

export interface Week1ScheduleValidation {
  generatedAt: string;
  season: number;
  week: number;
  scheduleSource: string;
  expectedGames: number;
  candidateGames: number;
  validCandidateGames: number;
  invalidCandidateGames: number;
  status: "PASS" | "FAIL" | "SYNTHETIC_ONLY";
  realWeek1BacktestReady: boolean;
  syntheticFixture: boolean;
  candidates: Array<{
    gameId: string;
    homeTeam: string;
    awayTeam: string;
    valid: boolean;
    matchedRealGameId?: string;
    reason?: string;
  }>;
  notes: string[];
}

export function loadWeek1ScheduleValidation():
  | Week1ScheduleValidation
  | undefined {
  return readJsonIfExists<Week1ScheduleValidation>(
    "week-1-schedule-validation.fixture.json",
  );
}
