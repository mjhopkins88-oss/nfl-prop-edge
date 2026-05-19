export type Position = "QB" | "RB" | "WR" | "TE";

export type PropType =
  | "PASSING_ATTEMPTS"
  | "PASSING_COMPLETIONS"
  | "PASSING_YARDS"
  | "RECEPTIONS"
  | "RECEIVING_YARDS"
  | "RUSHING_ATTEMPTS"
  | "RUSHING_YARDS";

export type Recommendation = "OVER" | "UNDER" | "PASS";

export interface Team {
  abbreviation: string;
  name: string;
  city: string;
  conference: "AFC" | "NFC";
  division: "North" | "South" | "East" | "West";
  primary: string;
  secondary: string;
}

export interface Player {
  id: string;
  fullName: string;
  position: Position;
  jersey: number;
  teamAbbr: string;
}

export interface Game {
  id: string;
  season: number;
  week: number;
  kickoff: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
  spread: number;
  total: number;
}

export interface GameLog {
  season: number;
  week: number;
  opponentAbbr: string;
  passingAttempts: number;
  passingCompletions: number;
  passingYards: number;
  receptions: number;
  receivingYards: number;
  rushingAttempts: number;
  rushingYards: number;
}

export interface PropMarket {
  id: string;
  playerId: string;
  gameId: string;
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
}

export interface LineQuote {
  sportsbook: string;
  line: number;
  overOdds: number;
  underOdds: number;
}

export interface PropDetail extends PropMarket {
  player: Player;
  team: Team;
  opponent: Team;
  game: Game;
  recentLogs: GameLog[];
  altLines: LineQuote[];
  reasons: string[];
  risks: string[];
  whatWouldChangeRec: string[];
  expectedValue: number;
}

export interface BacktestMarketSlice {
  propType: PropType;
  plays: number;
  hitRate: number;
  roiUnits: number;
  roiPct: number;
}

export type ConfidenceTier = "High" | "Medium" | "Low";

export interface BacktestConfidenceSlice {
  tier: ConfidenceTier;
  plays: number;
  hitRate: number;
  roiUnits: number;
  roiPct: number;
}

export interface BacktestEdgeBucketSlice {
  bucket: string; // e.g. "4–6%", "6–8%", "8–10%", "10%+"
  plays: number;
  hitRate: number;
  roiUnits: number;
  roiPct: number;
}

export interface BacktestSummary {
  windowLabel: string;
  totalPlays: number;
  wins: number;
  losses: number;
  pushes: number;
  unitsStaked: number;
  unitsReturn: number;
  roiPct: number;
  byMarket: BacktestMarketSlice[];
  byConfidence: BacktestConfidenceSlice[];
  byEdgeBucket: BacktestEdgeBucketSlice[];
  bestMarket: BacktestMarketSlice;
  worstMarket: BacktestMarketSlice;
}
