/**
 * Proxy football features.
 *
 * Derived, confidence-scored classifications of player role, defense
 * tendency, and offense behavior. These are educated estimates from
 * AVAILABLE stat rows; they are NOT claims of true alignment, route
 * tree, coverage shell, or pressure rate.
 *
 * Calibrated against `proxy-football-calibration.ts`. Every proxy:
 *   - is anchored on multiple agreeing signals (single-signal hits get
 *     low confidence)
 *   - returns `value ∈ [0, 1]` and `confidence ∈ [0, 0.95]`
 *   - prefixes explanation with `Proxy-based:`
 *   - sets `risk` when confidence is low / sample is thin / fallback
 *     data was used / signals disagree
 *   - exposes no recommendation or forcing surface
 */

import {
  DEEP_ADOT_THRESHOLD,
  HIGH_CATCH_RATE,
  HIGH_TARGET_SHARE,
  LEAGUE_AVG_PASS_RATE_FACED,
  LEAGUE_AVG_RUSH_RATE_FACED,
  LEAGUE_AVG_SACK_RATE,
  LOW_ADOT_THRESHOLD,
  LOW_CATCH_RATE,
  MEANINGFUL_AIR_YARDS_SHARE,
  MEANINGFUL_TARGET_SHARE,
  MIN_DEFENSIVE_PLAYS_FOR_MEDIUM_CONFIDENCE,
  MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
  MIN_TARGETS_FOR_MEDIUM_CONFIDENCE,
  MIN_WEEKS_FOR_STABILITY,
  PROXY_CONFIDENCE_MAX,
  buildProxyAccuracyWarning,
  clamp,
  confidenceFromDefenseVolume,
  confidenceFromPlayerVolume,
  confidenceFromSampleSize,
  confidenceFromSignalAgreement,
} from "./proxy-football-calibration";
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

// --- internal helpers ------------------------------------------------

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

const RECEIVING_POSITIONS = new Set(["WR", "TE", "RB"]);

function notApplicable(reason: string): ProxyResult {
  return {
    value: 0,
    confidence: 0,
    explanation: `Proxy-based: ${reason}`,
    risk: reason,
    tags: ["NOT_APPLICABLE"],
  };
}

function noSample(reason: string): ProxyResult {
  return {
    value: 0,
    confidence: 0.05,
    explanation: `Proxy-based: ${reason}`,
    risk: `${reason} — proxy unreliable`,
    tags: ["NO_SAMPLE"],
  };
}

function ensureReceiverContext(player: PlayerProxyInput): ProxyResult | null {
  if (!RECEIVING_POSITIONS.has(player.position)) {
    return notApplicable(
      `position ${player.position} not a receiving role; proxy not applicable`,
    );
  }
  if (player.games === 0 || player.targets === 0) {
    return noSample("no receiving usage in window");
  }
  return null;
}

function finalConfidence(
  sampleConfidence: number,
  agreementConfidence: number,
): number {
  return clamp(sampleConfidence * agreementConfidence, 0, PROXY_CONFIDENCE_MAX);
}

// --- player-role proxies --------------------------------------------

export function calculateSlotRoleProxy(player: PlayerProxyInput): ProxyResult {
  const bail = ensureReceiverContext(player);
  if (bail) return bail;
  const aDOT = divSafe(player.airYards, player.targets);
  const targetShare = divSafe(player.targets, player.teamTargets);
  const catchRate = divSafe(player.receptions, player.targets);
  const snapShare = player.snapShare;

  // Continuous component scores (each in [0, 1]).
  const aDotScore = clamp((LOW_ADOT_THRESHOLD - aDOT) / 3.5, 0, 1);
  const targetShareScore = clamp(targetShare / MEANINGFUL_TARGET_SHARE, 0, 1);
  const catchRateScore = clamp((catchRate - LOW_CATCH_RATE) / 0.2, 0, 1);
  const snapScore = clamp(snapShare / 0.55, 0, 1);

  // Continuous value uses all four with weights.
  let value =
    0.35 * aDotScore + 0.25 * targetShareScore + 0.25 * catchRateScore +
    0.15 * snapScore;

  // Multi-signal anchor: both low aDOT AND meaningful TS must hold for
  // the value to enter the "likely" band. Without those anchors the
  // signal is at best ambiguous.
  const anchorsMet =
    aDOT < LOW_ADOT_THRESHOLD && targetShare >= MEANINGFUL_TARGET_SHARE;
  if (!anchorsMet) value = Math.min(value, 0.55);
  // Position dampening: slot-volume WR concept doesn't apply to TE/RB.
  if (player.position === "TE" || player.position === "RB") value *= 0.5;
  value = clamp(value, 0, 1);

  // Signal-agreement confidence (4 binary signals).
  const signalsTrue = [
    aDOT < LOW_ADOT_THRESHOLD,
    targetShare >= MEANINGFUL_TARGET_SHARE,
    catchRate >= HIGH_CATCH_RATE,
    snapShare >= 0.55,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(signalsTrue, 4);
  const sampleConf = confidenceFromPlayerVolume(player);
  const confidence = finalConfidence(sampleConf, agreement);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5 && player.position === "WR") {
    tags.push("SLOT_VOLUME_LIKELY");
  }
  const smallSample =
    player.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE ||
    player.targets < MIN_TARGETS_FOR_MEDIUM_CONFIDENCE;
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample,
    conflicting: !anchorsMet && (aDotScore > 0.5 || targetShareScore > 0.5),
    context: "slot role proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: aDOT ${aDOT.toFixed(1)}, target share ${(targetShare * 100).toFixed(0)}%, catch rate ${(catchRate * 100).toFixed(0)}%, snap share ${(snapShare * 100).toFixed(0)}% — ${value >= 0.65 ? "slot / short-area role likely" : "slot signal moderate"}`,
    risk,
    tags,
  };
}

export function calculateDeepReceiverProxy(player: PlayerProxyInput): ProxyResult {
  const bail = ensureReceiverContext(player);
  if (bail) return bail;
  const aDOT = divSafe(player.airYards, player.targets);
  const airYardsShare = divSafe(player.airYards, player.teamAirYards);
  const targetShare = divSafe(player.targets, player.teamTargets);

  const aDotScore = clamp((aDOT - DEEP_ADOT_THRESHOLD) / 4, 0, 1);
  const airShareScore = clamp(airYardsShare / MEANINGFUL_AIR_YARDS_SHARE, 0, 1);
  const volumeScore = clamp(targetShare / 0.16, 0, 1);

  // Anchors: deep aDOT AND meaningful air-yards share.
  const anchorsMet =
    aDOT >= DEEP_ADOT_THRESHOLD &&
    airYardsShare >= MEANINGFUL_AIR_YARDS_SHARE;
  let value = 0.55 * aDotScore + 0.3 * airShareScore + 0.15 * volumeScore;
  if (!anchorsMet) value = Math.min(value, 0.55);
  if (player.position !== "WR") value *= 0.55;
  value = clamp(value, 0, 1);

  const signalsTrue = [
    aDOT >= DEEP_ADOT_THRESHOLD,
    airYardsShare >= MEANINGFUL_AIR_YARDS_SHARE,
    targetShare >= 0.16,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(signalsTrue, 3);
  const sampleConf = confidenceFromPlayerVolume(player);
  const confidence = finalConfidence(sampleConf, agreement);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5 && player.position === "WR") {
    tags.push("DEEP_THREAT_LIKELY");
  }
  const smallSample =
    player.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE ||
    player.targets < MIN_TARGETS_FOR_MEDIUM_CONFIDENCE;
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample,
    context: "deep receiver proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: aDOT ${aDOT.toFixed(1)}, air-yards share ${(airYardsShare * 100).toFixed(0)}%, target share ${(targetShare * 100).toFixed(0)}% — ${value >= 0.65 ? "deep-threat role likely" : "deep signal moderate"}`,
    risk,
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

  const adotSweetSpot = clamp(1 - Math.abs(aDOT - 10) / 4, 0, 1);
  const targetShareScore = clamp(
    (targetShare - MEANINGFUL_TARGET_SHARE) /
      (HIGH_TARGET_SHARE - MEANINGFUL_TARGET_SHARE),
    0,
    1,
  );
  const catchRateScore = clamp((catchRate - HIGH_CATCH_RATE + 0.05) / 0.15, 0, 1);

  // Stability factor (mild — only when weekly target shares provided).
  let stabilityFactor = 1;
  let stabilityNote: string | undefined;
  if (player.weekTargetShares && player.weekTargetShares.length >= 2) {
    const sd = stddevArr(player.weekTargetShares);
    const mean = meanArr(player.weekTargetShares);
    const cv = mean > 0 ? sd / mean : 1;
    stabilityFactor = clamp(1 - cv / 0.4, 0.6, 1);
    if (cv > 0.4) stabilityNote = "target share unstable week-to-week";
  }

  // Anchors: catch rate high AND target share meaningful.
  const anchorsMet =
    catchRate >= HIGH_CATCH_RATE && targetShare >= MEANINGFUL_TARGET_SHARE;
  let value =
    (0.35 * adotSweetSpot + 0.3 * targetShareScore + 0.35 * catchRateScore) *
    stabilityFactor;
  if (!anchorsMet) value = Math.min(value, 0.55);
  if (player.position !== "WR" && player.position !== "TE") value *= 0.5;
  value = clamp(value, 0, 1);

  const signalsTrue = [
    aDOT >= MID_ADOT_LOW && aDOT <= MID_ADOT_HIGH,
    targetShare >= MEANINGFUL_TARGET_SHARE,
    catchRate >= HIGH_CATCH_RATE,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(signalsTrue, 3);
  const sampleConf = confidenceFromPlayerVolume(player);
  const confidence = finalConfidence(sampleConf, agreement);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5) {
    tags.push("POSSESSION_RECEIVER_LIKELY");
  }
  const smallSample =
    player.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE ||
    player.targets < MIN_TARGETS_FOR_MEDIUM_CONFIDENCE;
  const risk =
    buildProxyAccuracyWarning({
      confidence,
      smallSample,
      context: "possession receiver proxy",
    }) ?? stabilityNote;
  return {
    value,
    confidence,
    explanation: `Proxy-based: aDOT ${aDOT.toFixed(1)}, target share ${(targetShare * 100).toFixed(0)}%, catch rate ${(catchRate * 100).toFixed(0)}% — ${value >= 0.65 ? "possession-receiver role likely" : "possession signal moderate"}`,
    risk,
    tags,
  };
}

const MID_ADOT_LOW = 8;
const MID_ADOT_HIGH = 12;

export function calculateRbReceivingRoleProxy(
  player: PlayerProxyInput,
): ProxyResult {
  if (player.position !== "RB") {
    return notApplicable(`position ${player.position} — RB receiving proxy not applicable`);
  }
  if (player.games === 0) {
    return noSample("no games in window");
  }
  const recPerGame = divSafe(player.receptions, player.games);
  const targetShare = divSafe(player.targets, player.teamTargets);
  const catchRate = divSafe(player.receptions, player.targets);

  const recScore = clamp((recPerGame - 1.5) / 3, 0, 1);
  const tsScore = clamp(targetShare / 0.12, 0, 1);
  const catchScore = clamp((catchRate - LOW_CATCH_RATE) / 0.25, 0, 1);

  // Anchors: meaningful rec/game AND meaningful TS.
  const anchorsMet = recPerGame >= 2 && targetShare >= 0.08;
  let value = 0.5 * recScore + 0.3 * tsScore + 0.2 * catchScore;
  if (!anchorsMet) value = Math.min(value, 0.5);
  value = clamp(value, 0, 1);

  const signalsTrue = [
    recPerGame >= 3,
    targetShare >= 0.1,
    catchRate >= 0.65,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(signalsTrue, 3);
  const sampleConf = confidenceFromPlayerVolume(player);
  const confidence = finalConfidence(sampleConf, agreement);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5) tags.push("RECEIVING_RB_LIKELY");
  const smallSample =
    player.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE ||
    player.targets < MIN_TARGETS_FOR_MEDIUM_CONFIDENCE;
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample,
    context: "receiving-RB proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${recPerGame.toFixed(1)} rec/game, ${(targetShare * 100).toFixed(0)}% target share, ${(catchRate * 100).toFixed(0)}% catch rate — ${value >= 0.65 ? "receiving-back role likely" : "receiving usage moderate"}`,
    risk,
    tags,
  };
}

export function calculateTeReceivingRoleProxy(
  player: PlayerProxyInput,
): ProxyResult {
  if (player.position !== "TE") {
    return notApplicable(`position ${player.position} — TE receiving proxy not applicable`);
  }
  if (player.games === 0) {
    return noSample("no games in window");
  }
  const recPerGame = divSafe(player.receptions, player.games);
  const targetShare = divSafe(player.targets, player.teamTargets);
  const snapShare = player.snapShare;

  const recScore = clamp((recPerGame - 2) / 4, 0, 1);
  const tsScore = clamp((targetShare - 0.1) / 0.12, 0, 1);
  const snapScore = clamp(snapShare / 0.65, 0, 1);

  // Anchors: meaningful TS OR meaningful rec/game (TEs can dominate
  // either via volume or efficient red-zone usage).
  const anchorsMet = targetShare >= 0.12 || recPerGame >= 3.5;
  let value = 0.45 * recScore + 0.35 * tsScore + 0.2 * snapScore;
  if (!anchorsMet) value = Math.min(value, 0.5);
  // Thin target volume drives confidence down hard.
  const thinTargets = player.targets < MIN_TARGETS_FOR_MEDIUM_CONFIDENCE;
  if (thinTargets) value = Math.min(value, 0.65);
  value = clamp(value, 0, 1);

  const signalsTrue = [
    recPerGame >= 3,
    targetShare >= MEANINGFUL_TARGET_SHARE,
    snapShare >= 0.65,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(signalsTrue, 3);
  const sampleConf = confidenceFromPlayerVolume(player);
  const confidence = finalConfidence(sampleConf, agreement);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5) tags.push("RECEIVING_TE_LIKELY");
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample: thinTargets,
    context: "receiving-TE proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${recPerGame.toFixed(1)} rec/game, ${(targetShare * 100).toFixed(0)}% target share, ${(snapShare * 100).toFixed(0)}% snap share — ${value >= 0.65 ? "receiving-TE role likely" : "receiving-TE signal moderate"}`,
    risk,
    tags,
  };
}

export function calculateTargetShareStabilityProxy(
  player: PlayerProxyInput,
): ProxyResult {
  const weeks = player.weekTargetShares ?? [];
  if (weeks.length < MIN_WEEKS_FOR_STABILITY) {
    return {
      value: 0.5,
      confidence: 0.2,
      explanation: `Proxy-based: only ${weeks.length} weeks of target share data — stability not estimable`,
      risk: `Need ≥ ${MIN_WEEKS_FOR_STABILITY} weeks of target shares for stability proxy`,
      tags: ["NEEDS_MORE_WEEKS"],
    };
  }
  const m = meanArr(weeks);
  const sd = stddevArr(weeks);
  const cv = m > 0 ? sd / m : 1;
  const stability = clamp(1 - cv / 0.3, 0, 1);
  // Meaningfulness factor: a stable but tiny share is not valuable.
  const meaningfulness = clamp(m / MEANINGFUL_TARGET_SHARE, 0, 1);
  const value = clamp(stability * meaningfulness, 0, 1);

  const sampleConf = clamp(weeks.length / 6, 0.2, PROXY_CONFIDENCE_MAX);
  const agreementSignals = [
    stability >= 0.6,
    meaningfulness >= 0.7,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(agreementSignals, 2);
  const confidence = finalConfidence(sampleConf, agreement);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5) tags.push("STABLE_TARGET_SHARE");
  if (stability <= 0.4) tags.push("VOLATILE_TARGET_SHARE");
  if (m < MEANINGFUL_TARGET_SHARE * 0.5) tags.push("TINY_SHARE_NOT_MEANINGFUL");

  const smallSample = weeks.length < MIN_WEEKS_FOR_STABILITY + 1;
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample,
    context: "target-share stability proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${weeks.length} weeks, mean share ${(m * 100).toFixed(0)}%, CV ${(cv * 100).toFixed(0)}% — ${value >= 0.65 ? "stable meaningful target share" : "stability signal moderate"}`,
    risk,
    tags,
  };
}

// --- defense proxies ------------------------------------------------

export function calculatePassFunnelProxy(d: DefenseProxyInput): ProxyResult {
  const total = d.passAttemptsFaced + d.rushAttemptsFaced;
  if (total === 0 || d.games === 0) {
    return noSample("no defensive plays in window");
  }
  const passRate = d.passAttemptsFaced / total;
  const passRateExcess = clamp(
    (passRate - LEAGUE_AVG_PASS_RATE_FACED) * 5 + 0.4,
    0,
    1,
  );

  // EPA support: positive pass EPA allowed means defense IS actually
  // vulnerable to passing, not just facing pass-heavy scripts.
  let epaSupport: number | null = null;
  if (d.epaPerDropbackAllowed !== undefined) {
    epaSupport = clamp(0.5 + d.epaPerDropbackAllowed / 0.12, 0, 1);
  }

  const haveEpa = epaSupport !== null;
  let value = haveEpa
    ? 0.6 * passRateExcess + 0.4 * (epaSupport as number)
    : passRateExcess;
  // Without EPA, treat as script-driven and cap below "likely" band.
  if (!haveEpa) value = Math.min(value, 0.58);
  value = clamp(value, 0, 1);

  const signalsTrue = [
    passRate >= LEAGUE_AVG_PASS_RATE_FACED + 0.04,
    haveEpa && (d.epaPerDropbackAllowed as number) >= 0,
    haveEpa && (d.epaPerDropbackAllowed as number) >= 0.05,
  ].filter(Boolean).length;
  const totalSignals = haveEpa ? 3 : 1;
  const agreement = confidenceFromSignalAgreement(signalsTrue, totalSignals);
  const sampleConf = confidenceFromDefenseVolume({
    games: d.games,
    totalPlaysFaced: total,
  });
  let confidence = finalConfidence(sampleConf, agreement);
  if (!haveEpa) confidence = Math.min(confidence, 0.5);
  confidence = clamp(confidence, 0, PROXY_CONFIDENCE_MAX);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5) tags.push("PASS_FUNNEL_LIKELY");
  if (!haveEpa) tags.push("PASS_FUNNEL_SCRIPT_FALLBACK");

  const smallSample =
    d.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE ||
    total < MIN_DEFENSIVE_PLAYS_FOR_MEDIUM_CONFIDENCE;
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample,
    fallbackData: !haveEpa,
    context: "pass funnel proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: defense faces ${(passRate * 100).toFixed(0)}% pass (league ${(LEAGUE_AVG_PASS_RATE_FACED * 100).toFixed(0)}%)${haveEpa ? `, EPA allowed ${(d.epaPerDropbackAllowed as number).toFixed(3)}` : " (no EPA support, may be script-driven)"} — ${value >= 0.65 ? "pass funnel likely" : "pass-funnel signal moderate"}`,
    risk,
    tags,
  };
}

export function calculateRunFunnelProxy(d: DefenseProxyInput): ProxyResult {
  const total = d.passAttemptsFaced + d.rushAttemptsFaced;
  if (total === 0 || d.games === 0) {
    return noSample("no defensive plays in window");
  }
  const runRate = d.rushAttemptsFaced / total;
  const runRateExcess = clamp(
    (runRate - LEAGUE_AVG_RUSH_RATE_FACED) * 5 + 0.4,
    0,
    1,
  );

  // EPA support: positive rush EPA allowed = real run vulnerability.
  let epaSupport: number | null = null;
  if (d.epaPerRushAllowed !== undefined) {
    epaSupport = clamp(0.5 + d.epaPerRushAllowed / 0.1, 0, 1);
  }
  const haveEpa = epaSupport !== null;
  let value = haveEpa
    ? 0.6 * runRateExcess + 0.4 * (epaSupport as number)
    : runRateExcess;
  if (!haveEpa) value = Math.min(value, 0.58);
  value = clamp(value, 0, 1);

  const signalsTrue = [
    runRate >= LEAGUE_AVG_RUSH_RATE_FACED + 0.04,
    haveEpa && (d.epaPerRushAllowed as number) >= 0,
    haveEpa && (d.epaPerRushAllowed as number) >= 0.03,
  ].filter(Boolean).length;
  const totalSignals = haveEpa ? 3 : 1;
  const agreement = confidenceFromSignalAgreement(signalsTrue, totalSignals);
  const sampleConf = confidenceFromDefenseVolume({
    games: d.games,
    totalPlaysFaced: total,
  });
  let confidence = finalConfidence(sampleConf, agreement);
  if (!haveEpa) confidence = Math.min(confidence, 0.5);
  confidence = clamp(confidence, 0, PROXY_CONFIDENCE_MAX);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5) tags.push("RUN_FUNNEL_LIKELY");
  if (!haveEpa) tags.push("RUN_FUNNEL_SCRIPT_FALLBACK");

  const smallSample =
    d.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE ||
    total < MIN_DEFENSIVE_PLAYS_FOR_MEDIUM_CONFIDENCE;
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample,
    fallbackData: !haveEpa,
    context: "run funnel proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: defense faces ${(runRate * 100).toFixed(0)}% rush (league ${(LEAGUE_AVG_RUSH_RATE_FACED * 100).toFixed(0)}%)${haveEpa ? `, EPA allowed ${(d.epaPerRushAllowed as number).toFixed(3)}` : " (no EPA support, may be script-driven)"} — ${value >= 0.65 ? "run funnel likely" : "run-funnel signal moderate"}`,
    risk,
    tags,
  };
}

export function calculateDeepPassSuppressionProxy(
  d: DefenseProxyInput,
): ProxyResult {
  const total = d.passAttemptsFaced + d.rushAttemptsFaced;
  if (total === 0 || d.games === 0) {
    return noSample("no defensive plays in window");
  }
  // Tier 1: deep completions allowed vs league expected.
  let primaryValue: number | null = null;
  if (
    d.deepCompletionsAllowed !== undefined &&
    d.deepCompletionsLeagueExpected !== undefined &&
    d.deepCompletionsLeagueExpected > 0
  ) {
    const ratio = d.deepCompletionsAllowed / d.deepCompletionsLeagueExpected;
    primaryValue = clamp(1 - ratio, 0, 1);
  }
  // Tier 2: EPA per dropback allowed (lower = better).
  let secondaryValue: number | null = null;
  if (d.epaPerDropbackAllowed !== undefined) {
    secondaryValue = clamp((0.08 - d.epaPerDropbackAllowed) / 0.16, 0, 1);
  }
  // Tier 3: WR receiving yards allowed (weak fallback only).
  let tertiaryValue: number | null = null;
  if (d.receivingYardsAllowedToWR !== undefined) {
    const ydsPerGame = d.receivingYardsAllowedToWR / Math.max(d.games, 1);
    tertiaryValue = clamp((150 - ydsPerGame) / 100, 0, 1);
  }

  let value: number;
  let usedFallback: boolean;
  if (primaryValue !== null && secondaryValue !== null) {
    value = 0.75 * primaryValue + 0.25 * secondaryValue;
    usedFallback = false;
  } else if (primaryValue !== null) {
    value = primaryValue;
    usedFallback = false;
  } else if (secondaryValue !== null) {
    value = secondaryValue;
    usedFallback = true;
  } else if (tertiaryValue !== null) {
    value = tertiaryValue;
    usedFallback = true;
  } else {
    return {
      value: 0.5,
      confidence: 0.15,
      explanation:
        "Proxy-based: no deep-completion / EPA / WR-yards data — deep suppression not estimable",
      risk: "Need deep completion or EPA-allowed data",
      tags: ["NEEDS_MORE_DATA"],
    };
  }
  value = clamp(value, 0, 1);

  const sampleConf = confidenceFromDefenseVolume({
    games: d.games,
    totalPlaysFaced: total,
  });
  // Reduce confidence when fallback data is used.
  const agreementSignals = [
    primaryValue !== null && primaryValue >= 0.55,
    secondaryValue !== null && secondaryValue >= 0.55,
    tertiaryValue !== null && tertiaryValue >= 0.55,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(
    agreementSignals,
    [primaryValue, secondaryValue, tertiaryValue].filter((v) => v !== null).length,
  );
  let confidence = finalConfidence(sampleConf, agreement);
  if (usedFallback) confidence = Math.min(confidence, 0.55);
  confidence = clamp(confidence, 0, PROXY_CONFIDENCE_MAX);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5)
    tags.push("DEEP_SUPPRESSION_LIKELY");
  if (usedFallback) tags.push("DEEP_SUPPRESSION_FALLBACK");

  const smallSample =
    d.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE ||
    total < MIN_DEFENSIVE_PLAYS_FOR_MEDIUM_CONFIDENCE;
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample,
    fallbackData: usedFallback,
    context: "deep pass suppression proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${primaryValue !== null ? "deep completions allowed vs league baseline" : usedFallback ? "EPA / WR-yards fallback signal" : "deep suppression not estimable"} — ${value >= 0.65 ? "deep pass suppression likely" : "deep coverage near league avg"}`,
    risk,
    tags,
  };
}

// --- offense / combined proxies -------------------------------------

export function calculatePressureRiskProxy(
  offense: OffenseProxyInput,
  defense: DefenseProxyInput,
): ProxyResult {
  const haveOffense = offense.teamPassAttempts > 0 && offense.games > 0;
  const haveDefense = defense.passAttemptsFaced > 0 && defense.games > 0;
  if (!haveOffense && !haveDefense) {
    return noSample("no offense or defense pass-rush data");
  }

  // Offense side: sacks taken per game / per dropback.
  const offSackRate = haveOffense
    ? offense.sacksTaken / offense.teamPassAttempts
    : LEAGUE_AVG_SACK_RATE;
  const offSackPerGame = haveOffense
    ? offense.sacksTaken / offense.games
    : null;

  // Defense side.
  const defSackRate = haveDefense
    ? defense.sacksGenerated / defense.passAttemptsFaced
    : LEAGUE_AVG_SACK_RATE;
  const defSackPerGame = haveDefense
    ? defense.sacksGenerated / defense.games
    : null;

  // Combined value uses both rates and per-game counts.
  const combinedRate = (offSackRate + defSackRate) / 2;
  let value = clamp((combinedRate - LEAGUE_AVG_SACK_RATE) * 14, 0, 1);

  // If only one side present, the signal is weak.
  const oneSidedOnly = !haveOffense || !haveDefense;
  if (oneSidedOnly) value = Math.min(value, 0.55);

  // Blitz support (optional).
  let blitzSupportTag: string | undefined;
  if (
    defense.blitzPctEstimate !== undefined &&
    defense.blitzPctEstimate >= 0.35
  ) {
    blitzSupportTag = "blitz_pressure_proxy";
    value = Math.min(value + 0.05, 1);
  }

  value = clamp(value, 0, 1);

  const sampleConf = Math.min(
    haveOffense
      ? confidenceFromSampleSize({
          games: offense.games,
          observations: offense.teamPassAttempts,
          minGames: MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
          minObservations: 100,
        })
      : 0.2,
    haveDefense
      ? confidenceFromSampleSize({
          games: defense.games,
          observations: defense.passAttemptsFaced,
          minGames: MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
          minObservations: 100,
        })
      : 0.2,
  );
  const signalsTrue = [
    haveOffense && offSackRate >= LEAGUE_AVG_SACK_RATE,
    haveDefense && defSackRate >= LEAGUE_AVG_SACK_RATE,
    blitzSupportTag !== undefined,
  ].filter(Boolean).length;
  const totalSignals =
    (haveOffense ? 1 : 0) +
    (haveDefense ? 1 : 0) +
    (defense.blitzPctEstimate !== undefined ? 1 : 0);
  const agreement = confidenceFromSignalAgreement(signalsTrue, Math.max(totalSignals, 1));
  let confidence = finalConfidence(sampleConf, agreement);
  if (oneSidedOnly) confidence = Math.min(confidence, 0.45);
  confidence = clamp(confidence, 0, PROXY_CONFIDENCE_MAX);

  const tags: string[] = [];
  if (value >= 0.65 && confidence >= 0.5) tags.push("PRESSURE_RISK_HIGH");
  if (blitzSupportTag) tags.push(blitzSupportTag);
  if (oneSidedOnly) tags.push("PRESSURE_ONE_SIDED");

  const smallSample =
    (haveOffense && offense.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE) ||
    (haveDefense && defense.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE);
  const baseWarning = buildProxyAccuracyWarning({
    confidence,
    smallSample,
    fallbackData: oneSidedOnly,
    context: "pressure risk proxy",
  });
  const sackCaveat = "Sack rate is an imperfect proxy for true pressure rate";
  const risk = baseWarning ? `${baseWarning}; ${sackCaveat}` : sackCaveat;
  return {
    value,
    confidence,
    explanation: `Proxy-based: offense sack rate ${(offSackRate * 100).toFixed(1)}%${offSackPerGame !== null ? ` (${offSackPerGame.toFixed(1)}/game)` : ""}, defense sack rate ${(defSackRate * 100).toFixed(1)}%${defSackPerGame !== null ? ` (${defSackPerGame.toFixed(1)}/game)` : ""}${oneSidedOnly ? " — one-sided signal only" : ""} — ${value >= 0.65 ? "pressure risk elevated" : "pressure near league avg"}`,
    risk,
    tags,
  };
}

export function calculateQuickGameProxy(
  offense: OffenseProxyInput,
): ProxyResult {
  if (offense.quickGamePctEstimate !== undefined) {
    const value = clamp(offense.quickGamePctEstimate, 0, 1);
    const sampleConf = confidenceFromSampleSize({
      games: offense.games,
      observations: offense.teamPassAttempts || 1,
      minGames: MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
      minObservations: 80,
    });
    const confidence = clamp(sampleConf, 0.3, PROXY_CONFIDENCE_MAX);
    const tags: string[] = [];
    if (value >= 0.6 && confidence >= 0.5) tags.push("QUICK_GAME_OFFENSE");
    return {
      value,
      confidence,
      explanation: `Proxy-based: explicit quick-game estimate ${(value * 100).toFixed(0)}%`,
      risk: buildProxyAccuracyWarning({
        confidence,
        smallSample: offense.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
        context: "quick game proxy (explicit estimate)",
      }),
      tags,
    };
  }
  if (offense.teamPassAttempts === 0 || offense.games === 0) {
    return noSample("no offense pass-attempt data");
  }
  // Indirect inference: high attempts + low sack rate.
  const attemptsPerGame = offense.teamPassAttempts / offense.games;
  const sackRate = offense.sacksTaken / offense.teamPassAttempts;
  const attemptScore = clamp((attemptsPerGame - 28) / 10, 0, 1);
  const protectionScore = clamp((0.08 - sackRate) / 0.05, 0, 1);
  let value = 0.55 * attemptScore + 0.45 * protectionScore;
  // Indirect inference: cap below "high confidence" band.
  value = Math.min(value, 0.75);
  value = clamp(value, 0, 1);

  const sampleConf = confidenceFromSampleSize({
    games: offense.games,
    observations: offense.teamPassAttempts,
    minGames: MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
    minObservations: 100,
  });
  const signalsTrue = [
    attemptsPerGame >= 35,
    sackRate <= 0.05,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(signalsTrue, 2);
  let confidence = finalConfidence(sampleConf, agreement);
  // Indirect inference: cap confidence at 0.55.
  confidence = Math.min(confidence, 0.55);

  const tags: string[] = ["QUICK_GAME_INDIRECT"];
  if (value >= 0.6 && confidence >= 0.45) tags.push("QUICK_GAME_OFFENSE");
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample: offense.games < MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
    fallbackData: true,
    context: "quick game proxy (indirect)",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${attemptsPerGame.toFixed(1)} pass att/game, ${(sackRate * 100).toFixed(1)}% sack rate — ${value >= 0.6 ? "quick-game / short-passing offense (indirect inference)" : "quick-game signal weak"}`,
    risk,
    tags,
  };
}

export function calculateRushingVolumeStabilityProxy(
  offense: OffenseProxyInput,
): ProxyResult {
  const weeks = offense.weekRushingAttempts ?? [];
  if (weeks.length < MIN_WEEKS_FOR_STABILITY) {
    return {
      value: 0.5,
      confidence: 0.2,
      explanation: `Proxy-based: only ${weeks.length} weeks of rushing attempt data — stability not estimable`,
      risk: `Need ≥ ${MIN_WEEKS_FOR_STABILITY} weeks of rushing attempts for stability proxy`,
      tags: ["NEEDS_MORE_WEEKS"],
    };
  }
  const m = meanArr(weeks);
  const sd = stddevArr(weeks);
  const cv = m > 0 ? sd / m : 1;
  const value = clamp(1 - cv / 0.3, 0, 1);
  const sampleConf = clamp(weeks.length / 6, 0.2, PROXY_CONFIDENCE_MAX);
  const signalsTrue = [
    cv <= 0.15,
    m >= 22,
  ].filter(Boolean).length;
  const agreement = confidenceFromSignalAgreement(signalsTrue, 2);
  const confidence = finalConfidence(sampleConf, agreement);

  const tags: string[] = [];
  if (value >= 0.7 && confidence >= 0.5) tags.push("STABLE_RUSH_VOLUME");
  if (value <= 0.4) tags.push("VOLATILE_RUSH_VOLUME");
  const risk = buildProxyAccuracyWarning({
    confidence,
    smallSample: weeks.length < MIN_WEEKS_FOR_STABILITY + 1,
    context: "rushing volume stability proxy",
  });
  return {
    value,
    confidence,
    explanation: `Proxy-based: ${weeks.length} weeks, mean ${m.toFixed(1)} rush att, CV ${(cv * 100).toFixed(0)}% — ${value >= 0.7 ? "stable rushing volume" : value <= 0.4 ? "volatile rushing volume" : "moderate rushing stability"}`,
    risk,
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
