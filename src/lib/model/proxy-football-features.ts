/**
 * Proxy football features.
 *
 * Derived, confidence-scored classifications of player role, defense
 * tendency, and offense behavior. The proxies are upstream of the
 * matchup intelligence layer — they help classify a player as
 * "slot-volume WR" vs "outside deep WR", a defense as "pass funnel"
 * vs "balanced", and so on. They do NOT feed directly into the
 * scorecard's recommendation math; they feed the matchup framework
 * (which is itself non-forcing) and surface explanations + risks for
 * the UI.
 *
 * Every proxy:
 *   - returns a 0..1 confidence
 *   - prefixes its explanation with `Proxy-based:`
 *   - sets a risk note when confidence is low or signals conflict
 *   - caps its value so a single proxy cannot drive a decision
 */

import type {
  AllFootballProxies,
  DefenseProxies,
  DefenseProxyInput,
  OffenseDefenseProxies,
  OffenseProxyInput,
  PlayerProxyInput,
  PlayerRoleProxies,
  ProxyResult,
} from "./proxy-football-feature-types";

export type {
  AllFootballProxies,
  DefenseProxies,
  DefenseProxyInput,
  OffenseDefenseProxies,
  OffenseProxyInput,
  PlayerProxyInput,
  PlayerRoleProxies,
  ProxyResult,
} from "./proxy-football-feature-types";

// --- shared helpers --------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function divSafe(num: number, denom: number, fallback = 0): number {
  if (!Number.isFinite(num) || !Number.isFinite(denom) || denom === 0)
    return fallback;
  return num / denom;
}

function meanArr(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddevArr(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = meanArr(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/**
 * Sample-size confidence. Inputs:
 *   - games observed in the window
 *   - count of the underlying observations (targets, carries, etc.)
 *
 * Returns 0..1. Capped so even rich data won't push confidence above
 * 0.95 — proxies are still approximations.
 */
function sampleConfidence(games: number, observations: number): number {
  const gameComponent = clamp(games / 6, 0, 1);
  const obsComponent = clamp(observations / 60, 0, 1);
  return clamp(0.5 * gameComponent + 0.5 * obsComponent, 0, 0.95);
}

function positionConfidenceMultiplier(
  actual: PlayerProxyInput["position"],
  expected: PlayerProxyInput["position"],
): number {
  return actual === expected ? 1 : 0;
}

// --- player-role proxies --------------------------------------------

const RECEIVING_POSITIONS = new Set(["WR", "TE", "RB"]);

function ensureReceiverContext(player: PlayerProxyInput): ProxyResult | null {
  if (!RECEIVING_POSITIONS.has(player.position)) {
    return {
      value: 0,
      confidence: 0,
      explanation: `Proxy-based: position ${player.position} not a receiving role; proxy not applicable`,
      risk: "Proxy not applicable to this position",
      tags: ["NOT_APPLICABLE"],
    };
  }
  if (player.games === 0 || player.targets === 0) {
    return {
      value: 0,
      confidence: 0.05,
      explanation: "Proxy-based: no receiving usage in window; proxy not estimable",
      risk: "No targets in sample — proxy unreliable",
      tags: ["NO_SAMPLE"],
    };
  }
  return null;
}

export function calculateSlotRoleProxy(player: PlayerProxyInput): ProxyResult {
  const bail = ensureReceiverContext(player);
  if (bail) return bail;
  const aDOT = divSafe(player.airYards, player.targets);
  const targetShare = divSafe(player.targets, player.teamTargets);
  const catchRate = divSafe(player.receptions, player.targets);

  const lowADOT = clamp((9 - aDOT) / 4, 0, 1);
  const volume = clamp(targetShare / 0.18, 0, 1);
  const catchAccuracy = clamp((catchRate - 0.5) / 0.3, 0, 1);

  let value = 0.5 * lowADOT + 0.3 * volume + 0.2 * catchAccuracy;
  if (player.position === "TE" || player.position === "RB") {
    // Slot-WR signal applies less strongly to TE / RB roles.
    value *= 0.4;
  }
  value = clamp(value, 0, 1);
  const confidence = sampleConfidence(player.games, player.targets);
  const tags: string[] = [];
  if (value >= 0.6 && player.position === "WR") tags.push("SLOT_VOLUME_LIKELY");
  return {
    value,
    confidence,
    explanation: `Proxy-based: aDOT ${aDOT.toFixed(1)}, target share ${(targetShare * 100).toFixed(0)}%, catch rate ${(catchRate * 100).toFixed(0)}% — ${value >= 0.6 ? "slot / short-area role likely" : "slot signal moderate"}`,
    risk: confidence < 0.4 ? "Low sample size — slot role proxy unreliable" : undefined,
    tags,
  };
}

export function calculateDeepReceiverProxy(player: PlayerProxyInput): ProxyResult {
  const bail = ensureReceiverContext(player);
  if (bail) return bail;
  const aDOT = divSafe(player.airYards, player.targets);
  const airYardsShare = divSafe(player.airYards, player.teamAirYards);

  const adotScore = clamp((aDOT - 10) / 5, 0, 1);
  const airShareScore = clamp(airYardsShare / 0.25, 0, 1);
  let value = 0.7 * adotScore + 0.3 * airShareScore;
  if (player.position !== "WR") value *= 0.5;
  value = clamp(value, 0, 1);
  const confidence = sampleConfidence(player.games, player.targets);
  const tags: string[] = [];
  if (value >= 0.6 && player.position === "WR") tags.push("DEEP_THREAT_LIKELY");
  return {
    value,
    confidence,
    explanation: `Proxy-based: aDOT ${aDOT.toFixed(1)}, air-yards share ${(airYardsShare * 100).toFixed(0)}% — ${value >= 0.6 ? "deep-threat role likely" : "deep signal moderate"}`,
    risk: confidence < 0.4 ? "Low sample size — deep receiver proxy unreliable" : undefined,
    tags,
  };
}

export function calculatePossessionReceiverProxy(
  player: PlayerProxyInput,
): ProxyResult {
  const bail = ensureReceiverContext(player);
  if (bail) return bail;
  const aDOT = divSafe(player.airYards, player.targets);
  const targetShare = divSafe(player.targets, player.teamTargets);
  const catchRate = divSafe(player.receptions, player.targets);

  // Possession sweet spot: aDOT 8–12 + high target share + high catch rate.
  const adotSweetSpot = clamp(1 - Math.abs(aDOT - 10) / 4, 0, 1);
  const volume = clamp((targetShare - 0.18) / 0.1, 0, 1);
  const accuracy = clamp((catchRate - 0.66) / 0.14, 0, 1);
  let value = 0.4 * adotSweetSpot + 0.3 * volume + 0.3 * accuracy;
  if (player.position !== "WR" && player.position !== "TE") value *= 0.6;
  value = clamp(value, 0, 1);
  const confidence = sampleConfidence(player.games, player.targets);
  const tags: string[] = [];
  if (value >= 0.6) tags.push("POSSESSION_RECEIVER_LIKELY");
  return {
    value,
    confidence,
    explanation: `Proxy-based: aDOT ${aDOT.toFixed(1)}, target share ${(targetShare * 100).toFixed(0)}%, catch rate ${(catchRate * 100).toFixed(0)}% — ${value >= 0.6 ? "possession-receiver role likely" : "possession signal moderate"}`,
    risk: confidence < 0.4 ? "Low sample size — possession receiver proxy unreliable" : undefined,
    tags,
  };
}

export function calculateRbReceivingRoleProxy(
  player: PlayerProxyInput,
): ProxyResult {
  const positionMul = positionConfidenceMultiplier(player.position, "RB");
  if (positionMul === 0) {
    return {
      value: 0,
      confidence: 0,
      explanation: `Proxy-based: position ${player.position} — RB receiving proxy not applicable`,
      risk: "Position is not RB",
      tags: ["NOT_APPLICABLE"],
    };
  }
  const recPerGame = divSafe(player.receptions, player.games);
  const targetShare = divSafe(player.targets, player.teamTargets);
  const recScore = clamp((recPerGame - 1.5) / 3, 0, 1);
  const tsScore = clamp(targetShare / 0.12, 0, 1);
  const value = clamp(0.6 * recScore + 0.4 * tsScore, 0, 1);
  const confidence =
    sampleConfidence(player.games, player.targets) * positionMul;
  const tags: string[] = [];
  if (value >= 0.6) tags.push("RECEIVING_RB_LIKELY");
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${recPerGame.toFixed(1)} rec/game and ${(targetShare * 100).toFixed(0)}% team target share — ${value >= 0.6 ? "receiving-back role likely" : "receiving usage moderate"}`,
    risk: confidence < 0.4 ? "Low sample size — receiving-RB proxy unreliable" : undefined,
    tags,
  };
}

export function calculateTeReceivingRoleProxy(
  player: PlayerProxyInput,
): ProxyResult {
  const positionMul = positionConfidenceMultiplier(player.position, "TE");
  if (positionMul === 0) {
    return {
      value: 0,
      confidence: 0,
      explanation: `Proxy-based: position ${player.position} — TE receiving proxy not applicable`,
      risk: "Position is not TE",
      tags: ["NOT_APPLICABLE"],
    };
  }
  const recPerGame = divSafe(player.receptions, player.games);
  const targetShare = divSafe(player.targets, player.teamTargets);
  const snapShare = player.snapShare;
  const recScore = clamp((recPerGame - 2) / 4, 0, 1);
  const tsScore = clamp((targetShare - 0.1) / 0.12, 0, 1);
  const snapScore = clamp(snapShare / 0.65, 0, 1);
  const value = clamp(0.5 * recScore + 0.3 * tsScore + 0.2 * snapScore, 0, 1);
  const confidence =
    sampleConfidence(player.games, player.targets) * positionMul;
  const tags: string[] = [];
  if (value >= 0.6) tags.push("RECEIVING_TE_LIKELY");
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${recPerGame.toFixed(1)} rec/game, ${(targetShare * 100).toFixed(0)}% target share, ${(snapShare * 100).toFixed(0)}% snap share — ${value >= 0.6 ? "receiving-TE role likely" : "receiving-TE signal moderate"}`,
    risk: confidence < 0.4 ? "Low sample size — receiving-TE proxy unreliable" : undefined,
    tags,
  };
}

export function calculateTargetShareStabilityProxy(
  player: PlayerProxyInput,
): ProxyResult {
  const weeks = player.weekTargetShares ?? [];
  if (weeks.length < 2) {
    return {
      value: 0.5,
      confidence: 0.2,
      explanation: "Proxy-based: not enough per-week target shares to evaluate stability",
      risk: "Need ≥ 2 weeks of target shares for stability proxy",
      tags: ["NEEDS_MORE_WEEKS"],
    };
  }
  const m = meanArr(weeks);
  const sd = stddevArr(weeks);
  const cv = m > 0 ? sd / m : 1;
  const value = clamp(1 - cv / 0.3, 0, 1);
  const confidence = clamp(weeks.length / 5, 0.2, 0.9);
  const tags: string[] = [];
  if (value >= 0.75) tags.push("STABLE_TARGET_SHARE");
  if (value <= 0.4) tags.push("VOLATILE_TARGET_SHARE");
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${weeks.length} weeks · mean target share ${(m * 100).toFixed(0)}% · CV ${(cv * 100).toFixed(0)}% — ${value >= 0.75 ? "target share stable" : value <= 0.4 ? "target share volatile" : "target share moderately stable"}`,
    risk: confidence < 0.4 ? "Few weeks observed — stability proxy unreliable" : undefined,
    tags,
  };
}

// --- defense proxies ------------------------------------------------

function defenseSampleConfidence(d: DefenseProxyInput): number {
  // Defenses need more games than a single player needs targets — a
  // 1-game pass-rate snapshot is dominated by game-script noise.
  const total = d.passAttemptsFaced + d.rushAttemptsFaced;
  const gameComponent = clamp(d.games / 6, 0, 1);
  const obsComponent = clamp(total / 220, 0, 1);
  return clamp(0.55 * gameComponent + 0.45 * obsComponent, 0, 0.95);
}

export function calculatePassFunnelProxy(d: DefenseProxyInput): ProxyResult {
  const total = d.passAttemptsFaced + d.rushAttemptsFaced;
  if (total === 0 || d.games === 0) {
    return {
      value: 0.5,
      confidence: 0,
      explanation: "Proxy-based: no attempts faced — pass funnel not estimable",
      risk: "Empty defense sample",
      tags: ["NO_SAMPLE"],
    };
  }
  const passRate = d.passAttemptsFaced / total;
  // League pass rate ≈ 0.59; positive value = pass-funnel.
  const value = clamp((passRate - 0.59) * 4 + 0.5, 0, 1);
  const confidence = defenseSampleConfidence(d);
  const tags: string[] = [];
  if (value >= 0.6) tags.push("PASS_FUNNEL_LIKELY");
  return {
    value,
    confidence,
    explanation: `Proxy-based: defense faces ${(passRate * 100).toFixed(0)}% pass (league ~59%) — ${value >= 0.6 ? "pass funnel likely" : "pass / run mix near league avg"}`,
    risk: confidence < 0.4 ? "Low sample — pass-funnel proxy unreliable" : undefined,
    tags,
  };
}

export function calculateRunFunnelProxy(d: DefenseProxyInput): ProxyResult {
  const total = d.passAttemptsFaced + d.rushAttemptsFaced;
  if (total === 0 || d.games === 0) {
    return {
      value: 0.5,
      confidence: 0,
      explanation: "Proxy-based: no attempts faced — run funnel not estimable",
      risk: "Empty defense sample",
      tags: ["NO_SAMPLE"],
    };
  }
  const runRate = d.rushAttemptsFaced / total;
  const value = clamp((runRate - 0.41) * 4 + 0.5, 0, 1);
  const confidence = defenseSampleConfidence(d);
  const tags: string[] = [];
  if (value >= 0.6) tags.push("RUN_FUNNEL_LIKELY");
  return {
    value,
    confidence,
    explanation: `Proxy-based: defense faces ${(runRate * 100).toFixed(0)}% run (league ~41%) — ${value >= 0.6 ? "run funnel likely" : "pass / run mix near league avg"}`,
    risk: confidence < 0.4 ? "Low sample — run-funnel proxy unreliable" : undefined,
    tags,
  };
}

export function calculateDeepPassSuppressionProxy(
  d: DefenseProxyInput,
): ProxyResult {
  const total = d.passAttemptsFaced + d.rushAttemptsFaced;
  if (total === 0 || d.games === 0) {
    return {
      value: 0.5,
      confidence: 0,
      explanation: "Proxy-based: no defense sample — deep suppression not estimable",
      risk: "Empty defense sample",
      tags: ["NO_SAMPLE"],
    };
  }
  // Primary signal: deep completions allowed vs league expected.
  let primary: number | null = null;
  if (
    d.deepCompletionsAllowed !== undefined &&
    d.deepCompletionsLeagueExpected !== undefined &&
    d.deepCompletionsLeagueExpected > 0
  ) {
    const ratio = d.deepCompletionsAllowed / d.deepCompletionsLeagueExpected;
    primary = clamp(1 - ratio, 0, 1);
  }
  // Secondary signal: EPA per dropback allowed (lower = better).
  let secondary: number | null = null;
  if (d.epaPerDropbackAllowed !== undefined) {
    secondary = clamp((0.1 - d.epaPerDropbackAllowed) / 0.2, 0, 1);
  }
  let value: number;
  if (primary !== null && secondary !== null) {
    value = 0.7 * primary + 0.3 * secondary;
  } else if (primary !== null) {
    value = primary;
  } else if (secondary !== null) {
    value = secondary;
  } else {
    return {
      value: 0.5,
      confidence: 0.15,
      explanation: "Proxy-based: no deep-completions or EPA data — deep suppression not estimable",
      risk: "Need deep completion or EPA-allowed data",
      tags: ["NEEDS_MORE_DATA"],
    };
  }
  const confidence = defenseSampleConfidence(d);
  const tags: string[] = [];
  if (value >= 0.6) tags.push("DEEP_SUPPRESSION_LIKELY");
  return {
    value,
    confidence,
    explanation: `Proxy-based: deep completions allowed vs league baseline — ${value >= 0.6 ? "deep pass suppression likely" : "deep coverage near league avg"}`,
    risk: confidence < 0.4 ? "Low sample — deep suppression proxy unreliable" : undefined,
    tags,
  };
}

// --- offense / combined proxies -------------------------------------

export function calculatePressureRiskProxy(
  offense: OffenseProxyInput,
  defense: DefenseProxyInput,
): ProxyResult {
  if (offense.teamPassAttempts === 0 || defense.passAttemptsFaced === 0) {
    return {
      value: 0.5,
      confidence: 0.1,
      explanation: "Proxy-based: not enough dropback / sack data — pressure risk not estimable",
      risk: "Empty pressure sample",
      tags: ["NO_SAMPLE"],
    };
  }
  const offSackRate = offense.sacksTaken / offense.teamPassAttempts;
  const defSackRate = defense.sacksGenerated / defense.passAttemptsFaced;
  // League sack rate ≈ 6%.
  const combined = (offSackRate + defSackRate) / 2;
  const value = clamp((combined - 0.05) * 12, 0, 1);
  const confidence = Math.min(
    sampleConfidence(offense.games, offense.teamPassAttempts),
    sampleConfidence(defense.games, defense.passAttemptsFaced),
  );
  const tags: string[] = [];
  if (value >= 0.6) tags.push("PRESSURE_RISK_HIGH");
  return {
    value,
    confidence,
    explanation: `Proxy-based: offense sack rate ${(offSackRate * 100).toFixed(1)}%, defense sack rate ${(defSackRate * 100).toFixed(1)}% — ${value >= 0.6 ? "pressure risk elevated" : "pressure near league avg"}`,
    risk: confidence < 0.4 ? "Low sample — pressure proxy unreliable" : undefined,
    tags,
  };
}

export function calculateQuickGameProxy(
  offense: OffenseProxyInput,
): ProxyResult {
  if (offense.quickGamePctEstimate !== undefined) {
    const value = clamp(offense.quickGamePctEstimate, 0, 1);
    const confidence = clamp(offense.games / 6, 0.3, 0.85);
    return {
      value,
      confidence,
      explanation: `Proxy-based: explicit quick-game estimate ${(value * 100).toFixed(0)}%`,
      risk: confidence < 0.4 ? "Low sample — quick-game proxy unreliable" : undefined,
      tags: value >= 0.6 ? ["QUICK_GAME_OFFENSE"] : [],
    };
  }
  if (offense.teamPassAttempts === 0 || offense.games === 0) {
    return {
      value: 0.5,
      confidence: 0.1,
      explanation: "Proxy-based: no offense sample — quick-game not estimable",
      risk: "Empty offense sample",
      tags: ["NO_SAMPLE"],
    };
  }
  const attemptsPerGame = offense.teamPassAttempts / offense.games;
  const sackRate = offense.sacksTaken / offense.teamPassAttempts;
  // High attempts + low sack rate → quick-game / short-passing.
  const attemptScore = clamp((attemptsPerGame - 28) / 10, 0, 1);
  const protectionScore = clamp((0.08 - sackRate) / 0.05, 0, 1);
  const value = clamp(0.55 * attemptScore + 0.45 * protectionScore, 0, 1);
  const confidence = sampleConfidence(offense.games, offense.teamPassAttempts);
  const tags: string[] = [];
  if (value >= 0.6) tags.push("QUICK_GAME_OFFENSE");
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${attemptsPerGame.toFixed(1)} pass att/game, ${(sackRate * 100).toFixed(1)}% sack rate — ${value >= 0.6 ? "quick-game / short-passing offense" : "quick-game signal moderate"}`,
    risk: confidence < 0.4 ? "Low sample — quick-game proxy unreliable" : undefined,
    tags,
  };
}

export function calculateRushingVolumeStabilityProxy(
  offense: OffenseProxyInput,
): ProxyResult {
  const weeks = offense.weekRushingAttempts ?? [];
  if (weeks.length < 2) {
    return {
      value: 0.5,
      confidence: 0.2,
      explanation: "Proxy-based: not enough weekly rushing samples — stability not estimable",
      risk: "Need ≥ 2 weeks of rushing attempts",
      tags: ["NEEDS_MORE_WEEKS"],
    };
  }
  const m = meanArr(weeks);
  const sd = stddevArr(weeks);
  const cv = m > 0 ? sd / m : 1;
  const value = clamp(1 - cv / 0.3, 0, 1);
  const confidence = clamp(weeks.length / 5, 0.2, 0.9);
  const tags: string[] = [];
  if (value >= 0.7) tags.push("STABLE_RUSH_VOLUME");
  if (value <= 0.4) tags.push("VOLATILE_RUSH_VOLUME");
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${weeks.length} weeks · mean ${m.toFixed(1)} rush att · CV ${(cv * 100).toFixed(0)}% — ${value >= 0.7 ? "stable rushing volume" : value <= 0.4 ? "volatile rushing volume" : "moderate rushing stability"}`,
    risk: confidence < 0.4 ? "Few weeks observed — stability proxy unreliable" : undefined,
    tags,
  };
}

// --- bundle builders ------------------------------------------------

export function buildPlayerRoleProxies(
  player: PlayerProxyInput,
): PlayerRoleProxies {
  return {
    slotRoleProxy: calculateSlotRoleProxy(player),
    deepReceiverProxy: calculateDeepReceiverProxy(player),
    possessionReceiverProxy: calculatePossessionReceiverProxy(player),
    rbReceivingRoleProxy: calculateRbReceivingRoleProxy(player),
    teReceivingRoleProxy: calculateTeReceivingRoleProxy(player),
    targetShareStabilityProxy: calculateTargetShareStabilityProxy(player),
  };
}

export function buildDefenseProxies(d: DefenseProxyInput): DefenseProxies {
  return {
    passFunnelProxy: calculatePassFunnelProxy(d),
    runFunnelProxy: calculateRunFunnelProxy(d),
    deepPassSuppressionProxy: calculateDeepPassSuppressionProxy(d),
  };
}

export function buildOffenseDefenseProxies(
  offense: OffenseProxyInput,
  defense: DefenseProxyInput,
): OffenseDefenseProxies {
  return {
    pressureRiskProxy: calculatePressureRiskProxy(offense, defense),
    quickGameProxy: calculateQuickGameProxy(offense),
    rushingVolumeStabilityProxy: calculateRushingVolumeStabilityProxy(offense),
  };
}

export function buildAllFootballProxies(args: {
  player: PlayerProxyInput;
  offense: OffenseProxyInput;
  defense: DefenseProxyInput;
}): AllFootballProxies {
  return {
    player: buildPlayerRoleProxies(args.player),
    defense: buildDefenseProxies(args.defense),
    offense: buildOffenseDefenseProxies(args.offense, args.defense),
  };
}
