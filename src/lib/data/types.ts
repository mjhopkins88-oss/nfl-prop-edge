// Data layer types.
// Re-exports raw entity types from `lib/types.ts` and adds view-model
// shapes that the UI consumes directly (e.g. PropOpportunity is a prop
// with its player/team/opponent/game already joined in).

export type {
  Position,
  PropType,
  Recommendation,
  Team,
  Player,
  Game,
  GameLog,
  PropMarket,
  LineQuote,
  PropDetail,
  BacktestSummary,
  BacktestMarketSlice,
} from "../types";

import type {
  Game,
  Player,
  Position,
  PropType,
  Recommendation,
  Team,
} from "../types";

/**
 * A prop market joined with its player, team, opponent, and game.
 * This is the shape returned by `getPropOpportunities` and consumed
 * directly by the dashboard table — no further lookups required.
 */
export interface PropOpportunity {
  id: string;
  propType: PropType;
  line: number;
  overOdds: number;
  underOdds: number;
  sportsbook: string;
  projection: number;
  projectionStdDev: number;
  modelHitRateOver: number;
  bookImpliedOver: number;
  edge: number;
  confidence: number;
  recommendation: Recommendation;
  player: Player;
  team: Team;
  opponent: Team;
  game: Game;
  isHome: boolean;
}

export interface PropOpportunityFilter {
  propType?: PropType;
  position?: Position;
  recommendation?: Recommendation;
}

export type PropOpportunitySort = "edge" | "confidence" | "player";

export interface GetPropOpportunitiesArgs {
  filter?: PropOpportunityFilter;
  sort?: PropOpportunitySort;
}

export interface DashboardTopEdge {
  value: number; // absolute edge, e.g. 0.098
  playerName: string;
  positive: boolean; // true if model favors OVER, false if UNDER
}

export interface DashboardSummary {
  trackedMarkets: number;
  actionableMarkets: number;
  positiveEdges: number;
  averageEdge: number;
  topEdge: DashboardTopEdge | null;
}
