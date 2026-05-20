/**
 * Proxy football feature types.
 *
 * Proxies are derived, confidence-scored classifications of player /
 * offense / defense behavior built from available stat rows. They are
 * intentionally NOT presented as ground-truth scheme/coverage data —
 * each result carries a 0..1 confidence and a plain-English
 * explanation prefixed with "Proxy-based:" so consumers know to
 * treat them as approximations.
 */

export interface ProxyResult {
  /**
   * Estimated strength of the signal, in [0, 1] for role / suppression
   * proxies. For symmetric funnel proxies the convention is given on
   * the helper itself.
   */
  value: number;
  /** 0..1 — sample-size and signal-clarity weighted. */
  confidence: number;
  /** Plain-English explanation. Always prefixed with `Proxy-based:`. */
  explanation: string;
  /** Risk note set when confidence is low or signals conflict. */
  risk?: string;
  tags: string[];
}

/** Window-rolled inputs available for a single player. */
export interface PlayerProxyInput {
  position: "QB" | "RB" | "WR" | "TE";
  /** Number of games covered by the window. */
  games: number;
  targets: number;
  receptions: number;
  receivingYards: number;
  /** Total air yards across targets in the window. */
  airYards: number;
  /** Sum of team targets across the same window. */
  teamTargets: number;
  /** Sum of team air yards across the same window. */
  teamAirYards: number;
  /** Average snap share across the window, 0..1. */
  snapShare: number;
  carries: number;
  /** Average carry share across the window, 0..1. */
  carryShare: number;
  /** Per-week target shares (optional). Used by target-share stability. */
  weekTargetShares?: number[];
  // QB-only fields:
  sacksTaken?: number;
  attempts?: number;
}

/** Window-rolled inputs available for a defense. */
export interface DefenseProxyInput {
  games: number;
  passAttemptsFaced: number;
  rushAttemptsFaced: number;
  sacksGenerated: number;
  blitzPctEstimate?: number;
  /** EPA per dropback allowed; league average ≈ 0.05 (positive). */
  epaPerDropbackAllowed?: number;
  /** EPA per rush allowed; league average ≈ -0.04 (negative). */
  epaPerRushAllowed?: number;
  receivingYardsAllowedToWR?: number;
  receivingYardsAllowedToTE?: number;
  receivingYardsAllowedToRB?: number;
  /** Completions ≥ 20 air yards allowed in window. */
  deepCompletionsAllowed?: number;
  /** League average deep completions per game × games-in-window. */
  deepCompletionsLeagueExpected?: number;
}

/** Window-rolled inputs available for an offense. */
export interface OffenseProxyInput {
  games: number;
  teamPassAttempts: number;
  teamRushAttempts: number;
  sacksTaken: number;
  /** Per-week rushing attempts. Used by rushing volume stability proxy. */
  weekRushingAttempts?: number[];
  /** Optional explicit estimate. */
  quickGamePctEstimate?: number;
}

export interface PlayerRoleProxies {
  slotRoleProxy: ProxyResult;
  deepReceiverProxy: ProxyResult;
  possessionReceiverProxy: ProxyResult;
  rbReceivingRoleProxy: ProxyResult;
  teReceivingRoleProxy: ProxyResult;
  targetShareStabilityProxy: ProxyResult;
}

export interface DefenseProxies {
  passFunnelProxy: ProxyResult;
  runFunnelProxy: ProxyResult;
  deepPassSuppressionProxy: ProxyResult;
}

export interface OffenseDefenseProxies {
  pressureRiskProxy: ProxyResult;
  quickGameProxy: ProxyResult;
  rushingVolumeStabilityProxy: ProxyResult;
}

export interface AllFootballProxies {
  player: PlayerRoleProxies;
  defense: DefenseProxies;
  offense: OffenseDefenseProxies;
}
