import type { PropType, Recommendation } from "../types";
import type { CoachingTransitionScorecard } from "../model/coaching-transition-types";
import type { PropDecisionScorecard } from "../model/model-scorecard";

export type BacktestSeason = number;
export type BacktestWeek = number;

export interface BacktestScope {
  season: BacktestSeason;
  startWeek: BacktestWeek;
  endWeek: BacktestWeek;
  propTypes: readonly PropType[];
  includeYardage: boolean;
  useFixtures: boolean;
}

export interface BacktestGame {
  id: string;
  season: BacktestSeason;
  week: BacktestWeek;
  kickoff: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  spread: number;
  total: number;
  isDome: boolean;
}

export interface BacktestPlayerWeekStat {
  playerId: string;
  playerName: string;
  teamAbbr: string;
  position: "QB" | "RB" | "WR" | "TE";
  season: BacktestSeason;
  week: BacktestWeek;
  snapShare: number;
  targetShare: number;
  carryShare: number;
  passingAttempts: number;
  passingCompletions: number;
  passingYards: number;
  receptions: number;
  receivingYards: number;
  rushingAttempts: number;
  rushingYards: number;
  teamPlays: number;
}

export interface BacktestPropMarket {
  id: string;
  gameId: string;
  playerId: string;
  propType: PropType;
  line: number;
  overOdds: number;
  underOdds: number;
  projectionMean: number;
  projectionStdDev: number;
  sportsbook: string;
  /**
   * Optional correlation tag — props sharing the same tag against the
   * same playerId are treated as a correlation stack and the second
   * (and later) markets carry a lower correlationExposureScore.
   */
  correlationTag?: string;
}

export interface BacktestPropQuote {
  marketId: string;
  sportsbook: string;
  line: number;
  overOdds: number;
  underOdds: number;
}

export interface BacktestWeatherSnapshot {
  gameId: string;
  isDome: boolean;
  temperatureF: number | null;
  windMph: number | null;
  gustsMph: number | null;
  precipitationMm: number | null;
  snowfallCm: number | null;
}

export interface BacktestInjuryFlag {
  playerId: string;
  season: BacktestSeason;
  week: BacktestWeek;
  status: "OUT" | "DOUBTFUL" | "QUESTIONABLE" | "PROBABLE" | "HEALTHY";
  note?: string;
}

export interface BacktestFeatureRow {
  propMarketId: string;
  gameId: string;
  playerId: string;
  playerName: string;
  teamAbbr: string;
  opponentAbbr: string;
  propType: PropType;
  season: BacktestSeason;
  week: BacktestWeek;
  /** Market inputs sourced from the prop market + best quote. */
  marketLine: number;
  overOdds: number;
  underOdds: number;
  /** Projection — copied from prop market for now. */
  projectionMean: number;
  projectionStdDev: number;
  /** Volume / role features. */
  recentSnapShare: number;
  recentTargetShare: number;
  recentCarryShare: number;
  seasonSnapShare: number;
  seasonTargetShare: number;
  seasonCarryShare: number;
  projectedTeamPlays: number;
  projectedPassRate: number;
  /** Risk scores (all 0..1, 1 = clean). */
  roleStabilityScore: number;
  gameScriptScore: number;
  paceScore: number;
  marketContextScore: number;
  weatherEnvironmentScore: number;
  injuryContextScore: number;
  correlationExposureScore: number;
  dataQualityScore: number;
  /** Optional coaching transition scorecard. */
  coachingTransition?: CoachingTransitionScorecard;
}

export interface BacktestProjectionInput {
  featureRow: BacktestFeatureRow;
}

export interface BacktestProjectionOutput {
  scorecard: PropDecisionScorecard;
}

export interface BacktestCandidate {
  propMarketId: string;
  gameId: string;
  playerId: string;
  playerName: string;
  teamAbbr: string;
  opponentAbbr: string;
  propType: PropType;
  season: BacktestSeason;
  week: BacktestWeek;
  marketLine: number;
  scorecard: PropDecisionScorecard;
}

export type BacktestOutcome = "WIN" | "LOSS" | "PUSH" | "PASS" | "NO_RESULT";

export interface BacktestGradedResult {
  candidate: BacktestCandidate;
  recommendation: Recommendation;
  qualified: boolean;
  bet: boolean;
  actualStat: number | null;
  outcome: BacktestOutcome;
  profitLossUnits: number;
  edgeAtRecommendation: number;
  primaryDisqualifier?: string;
}

export interface BacktestPropTypeSummary {
  propType: PropType;
  evaluated: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  profitUnits: number;
}

export interface BacktestDisqualifierSummary {
  disqualifier: string;
  count: number;
}

export interface BacktestEdgeBucketSummary {
  label: string;
  loEdge: number;
  hiEdge: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  profitUnits: number;
}

export interface BacktestConfidenceBucketSummary {
  label: "High" | "Medium" | "Low";
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  profitUnits: number;
}

export interface BacktestCoachingUncertaintyBucketSummary {
  label: string;
  loPenalty: number;
  hiPenalty: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  profitUnits: number;
}

export interface BacktestWeatherRiskBucketSummary {
  label: string;
  loScore: number;
  hiScore: number;
  bets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  profitUnits: number;
}

export interface BacktestSummary {
  scope: BacktestScope;
  generatedAt: string;
  evaluated: number;
  qualifiedBets: number;
  passes: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  roiPct: number;
  averageEdge: number;
  averageExpectedValueUnits: number;
  brierScore: number;
  maxDrawdownUnits: number;
  profitUnits: number;
  bestPropType?: PropType;
  worstPropType?: PropType;
  mostCommonDisqualifier?: string;
  byPropType: BacktestPropTypeSummary[];
  byDisqualifier: BacktestDisqualifierSummary[];
  byEdgeBucket: BacktestEdgeBucketSummary[];
  byConfidence: BacktestConfidenceBucketSummary[];
  byCoachingUncertainty: BacktestCoachingUncertaintyBucketSummary[];
  byWeatherRisk: BacktestWeatherRiskBucketSummary[];
}
