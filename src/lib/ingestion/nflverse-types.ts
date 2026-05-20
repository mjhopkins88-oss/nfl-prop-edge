/**
 * nflverse / nflfastR ingestion — normalized TypeScript types.
 *
 * The free nflverse-data releases ship CSV + Parquet at static
 * GitHub URLs. No API key required. These types describe the
 * normalized shape we write under `data/processed/nfl/` after the
 * raw frames are cleaned.
 *
 * V1 scope: lower-variance markets only. We do NOT model
 * touchdown columns; the normalization step drops them.
 */

export type NflSeason = number;
export type NflWeek = number;
export type NflPosition = "QB" | "RB" | "WR" | "TE";
export type NflGameType =
  | "REG"
  | "WC"
  | "DIV"
  | "CON"
  | "SB"
  | "POST";
export type NflHomeAway = "HOME" | "AWAY";
export type NflRoofType =
  | "outdoors"
  | "dome"
  | "retractable_open"
  | "retractable_closed"
  | "unknown";

export interface NflGame {
  gameId: string;
  season: NflSeason;
  week: NflWeek;
  gameType: NflGameType;
  /** ISO 8601 game start (UTC). May be omitted when unknown. */
  startTimeUtc?: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number | null;
  awayScore: number | null;
  roof: NflRoofType;
  surface?: string;
  stadium?: string;
  /** Pregame closing spread for the HOME team (negative = home favored). */
  closingHomeSpread?: number;
  /** Pregame closing total. */
  closingTotal?: number;
}

export interface NflPlayerWeekStat {
  /** Stable, nflverse-style player ID (e.g., 00-0036971). */
  playerId: string;
  /** Display name used in nflverse rosters (e.g., "Patrick Mahomes"). */
  playerName: string;
  position: NflPosition;
  team: string;
  opponent: string;
  season: NflSeason;
  week: NflWeek;
  gameId: string;
  homeAway: NflHomeAway;
  /** QB volumes (no touchdowns). */
  passingAttempts?: number;
  passingCompletions?: number;
  passingYards?: number;
  passingSacks?: number;
  /** Rushing (any position). */
  rushingAttempts?: number;
  rushingYards?: number;
  /** Receiving (any position). */
  targets?: number;
  receptions?: number;
  receivingYards?: number;
  receivingAirYards?: number;
  /** Usage shares — 0..1. */
  snapShare?: number;
  carryShare?: number;
  targetShare?: number;
  airYardsShare?: number;
  /** Advanced efficiency proxies (computed at ingest where available). */
  racr?: number;
  wopr?: number;
  /**
   * Optional fantasy points (for sanity / aggregate dashboards).
   * Not consumed by the prop model.
   */
  fantasyPoints?: number;
}

export interface NflTeamWeekStat {
  team: string;
  opponent: string;
  season: NflSeason;
  week: NflWeek;
  gameId: string;
  homeAway: NflHomeAway;
  /** Team-level volume. */
  totalPlays?: number;
  passAttempts?: number;
  rushAttempts?: number;
  /** Pre-derived ratios — `passAttempts / (passAttempts + rushAttempts)`. */
  passRate?: number;
  rushRate?: number;
  /** Pace — seconds per play. */
  secondsPerPlay?: number;
  pointsFor?: number;
  pointsAgainst?: number;
}

export interface NflRosterPlayer {
  playerId: string;
  playerName: string;
  position: NflPosition;
  team: string;
  season: NflSeason;
  jerseyNumber?: number;
  status?: "ACT" | "RES" | "PUP" | "IR" | "CUT" | "OTHER";
  birthDate?: string;
  /** Recent depth-chart slot if available. */
  depthChartRank?: number;
}

export interface NflSnapCount {
  playerId: string;
  playerName: string;
  position: NflPosition;
  team: string;
  season: NflSeason;
  week: NflWeek;
  gameId: string;
  offenseSnaps?: number;
  offenseSnapShare?: number;
  defenseSnaps?: number;
  stSnaps?: number;
}

/** Reverse map: nflverse player ID ↔ our internal display name + team. */
export interface NflPlayerIdMap {
  playerId: string;
  playerName: string;
  position: NflPosition;
  team: string;
  /** Most recent season this player ID was associated with `team`. */
  lastSeason: NflSeason;
}

/**
 * Optional play-by-play summary row. Only filled in when the
 * pbp_summary CSV is generated; not required for the V1 prop
 * backtest.
 */
export interface NflPlayByPlaySummary {
  gameId: string;
  season: NflSeason;
  week: NflWeek;
  team: string;
  opponent: string;
  passingEpaPerDropback?: number;
  rushingEpaPerCarry?: number;
  pressureRate?: number;
  successRate?: number;
}

/**
 * Top-level bundle returned by `loadAllProcessed()`. Every field
 * is optional so partial ingest output is still usable.
 */
export interface NflProcessedBundle {
  games: NflGame[];
  playerWeekStats: NflPlayerWeekStat[];
  teamWeekStats: NflTeamWeekStat[];
  rosters: NflRosterPlayer[];
  snapCounts?: NflSnapCount[];
  playerIds?: NflPlayerIdMap[];
  playByPlaySummary?: NflPlayByPlaySummary[];
}
