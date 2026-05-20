/**
 * Experimental Game Edge model types.
 *
 * This is a SEPARATE model from the player prop scorecard. It
 * evaluates game-level markets (moneyline + spread) and produces
 * upset / spread / cover assessments. It must never be conflated
 * with player prop logic, UI, or output files.
 *
 * The framework treats market win probability as the baseline,
 * applies capped football-context adjustments, and reports
 * confidence-adjusted edges plus risk-aware disqualifiers — same
 * disciplined approach the player prop scorecard uses, applied to
 * game-level markets.
 */

export type GameMarket = "MONEYLINE" | "SPREAD";

export type GameRecommendation =
  | "HOME_MONEYLINE"
  | "AWAY_MONEYLINE"
  | "HOME_SPREAD"
  | "AWAY_SPREAD"
  | "PASS";

export type GameRecommendationLabel =
  | "Strong ML Value"
  | "Playable ML Value"
  | "Upset Watch"
  | "Spread Value"
  | "Cover Watch"
  | "Pass / No Edge"
  | "Pass / Too Much Uncertainty";

export type GameSide = "HOME" | "AWAY";

export interface GameEdgeInput {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  // Market.
  homeMoneylineOdds: number;
  awayMoneylineOdds: number;
  homeSpread: number;
  awaySpread: number;
  homeSpreadOdds: number;
  awaySpreadOdds: number;
  marketHomeWinProbability: number;
  marketAwayWinProbability: number;
  homeImpliedTeamTotal?: number;
  awayImpliedTeamTotal?: number;
  gameTotal?: number;
  // Environmental / contextual scores (0..1; 1 = clean).
  weatherRiskScore: number;
  coachingUncertaintyHome: number; // 0..100 penalty (matches coaching transition)
  coachingUncertaintyAway: number;
  homeRestDays?: number;
  awayRestDays?: number;
  homeTravelPenalty?: number;
  awayTravelPenalty?: number;
  homeOffensiveContinuityScore?: number;
  awayOffensiveContinuityScore?: number;
  homeDefensiveContinuityScore?: number;
  awayDefensiveContinuityScore?: number;
  homeQBStabilityScore?: number;
  awayQBStabilityScore?: number;
  homePressureAdvantageScore?: number;
  awayPressureAdvantageScore?: number;
  homeRunGameAdvantageScore?: number;
  awayRunGameAdvantageScore?: number;
  homePassGameAdvantageScore?: number;
  awayPassGameAdvantageScore?: number;
  homeTurnoverVolatilityScore?: number;
  awayTurnoverVolatilityScore?: number;
  homeInjuryRiskScore?: number;
  awayInjuryRiskScore?: number;
  /** Optional explicit override; otherwise derived from continuity scores. */
  gameDataQualityScore?: number;
}

export interface GameEdgeOutput {
  gameId: string;
  recommendation: GameRecommendation;
  recommendationLabel: GameRecommendationLabel;
  selectedSide?: GameSide;
  selectedMarket?: GameMarket;
  modelHomeWinProbability: number;
  modelAwayWinProbability: number;
  marketHomeWinProbability: number;
  marketAwayWinProbability: number;
  homeMoneylineEdge: number;
  awayMoneylineEdge: number;
  /** Spread cover probability for HOME side. */
  spreadCoverProbabilityHome: number;
  spreadCoverProbabilityAway: number;
  /** Edge over breakeven for the spread, per side. */
  spreadEdgeHome: number;
  spreadEdgeAway: number;
  upsetScore: number;
  underdogSide?: GameSide;
  confidence: number;
  riskScore: number;
  dataQualityScore: number;
  reasons: string[];
  risks: string[];
  disqualifiers: string[];
  upsetFactors: string[];
  scorecard: GameEdgeScorecard;
}

/** Display object — the structured story behind the recommendation. */
export interface GameEdgeScorecard {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
  recommendation: GameRecommendation;
  recommendationLabel: GameRecommendationLabel;
  marketBaseline: {
    homeWinProbability: number;
    awayWinProbability: number;
    homeMoneylineOdds: number;
    awayMoneylineOdds: number;
    homeSpread: number;
    awaySpread: number;
  };
  modelProbability: {
    home: number;
    away: number;
  };
  moneyline: {
    homeEdgePp: number;
    awayEdgePp: number;
    confidenceAdjustedHomeEdgePp: number;
    confidenceAdjustedAwayEdgePp: number;
  };
  spread: {
    homeCoverProbability: number;
    awayCoverProbability: number;
    homeEdgePp: number;
    awayEdgePp: number;
    confidenceAdjustedHomeEdgePp: number;
    confidenceAdjustedAwayEdgePp: number;
    keyNumberRisk: boolean;
    keyNumber?: number;
  };
  upset: {
    score: number;
    underdogSide?: GameSide;
    factors: string[];
    risks: string[];
  };
  confidence: number;
  riskScore: number;
  dataQualityScore: number;
  reasons: string[];
  risks: string[];
  disqualifiers: string[];
  /**
   * Plain-English "what would change the recommendation?" — used by
   * the detail page.
   */
  whatWouldChange: string[];
  finalExplanation: string;
}

/**
 * Future game-level backtest result row. Not consumed by any runner
 * yet — defined now so we can store results when the historical
 * pipeline lands.
 */
export interface GameEdgeBacktestResult {
  gameId: string;
  season: number;
  week: number;
  recommendation: GameRecommendation;
  market: GameMarket;
  selectedSide?: GameSide;
  odds?: number;
  spread?: number;
  closingLine?: number;
  actualWinner?: "HOME" | "AWAY";
  actualMargin?: number;
  result?: "WIN" | "LOSS" | "PUSH" | "PASS" | "NO_RESULT";
  profitLossUnits?: number;
  upsetScore: number;
  spreadEdge: number;
  moneylineEdge: number;
}
