/**
 * Calibration constants + shared helpers for the proxy football
 * feature framework.
 *
 * Goals:
 *   1. Centralize every magic number so we can audit and tune one file.
 *   2. Wire confidence to BOTH sample size AND signal agreement so
 *      single-signal hits can't claim certainty.
 *   3. Provide accuracy-warning helpers so downstream consumers can
 *      surface the right risk notes.
 */

// ----- league baselines ---------------------------------------------

export const LEAGUE_AVG_PASS_RATE_FACED = 0.59;
export const LEAGUE_AVG_RUSH_RATE_FACED = 0.41;
/** Modern NFL sack rate ≈ 6.5%. */
export const LEAGUE_AVG_SACK_RATE = 0.065;

// ----- aDOT bands ----------------------------------------------------

export const LOW_ADOT_THRESHOLD = 8;
export const MID_ADOT_RANGE: readonly [number, number] = [8, 12];
export const DEEP_ADOT_THRESHOLD = 13;

// ----- usage thresholds ---------------------------------------------

export const MEANINGFUL_TARGET_SHARE = 0.12;
export const HIGH_TARGET_SHARE = 0.22;
export const MEANINGFUL_AIR_YARDS_SHARE = 0.2;
export const HIGH_CATCH_RATE = 0.7;
export const LOW_CATCH_RATE = 0.55;

// ----- sample-size floors -------------------------------------------

export const MIN_GAMES_FOR_MEDIUM_CONFIDENCE = 3;
export const MIN_TARGETS_FOR_MEDIUM_CONFIDENCE = 18;
export const MIN_DEFENSIVE_PLAYS_FOR_MEDIUM_CONFIDENCE = 150;
export const MIN_WEEKS_FOR_STABILITY = 3;

// ----- adjustment caps ----------------------------------------------

/** Maximum value a proxy may return. Always [0, 1]. */
export const PROXY_VALUE_MAX = 1;
/** Maximum confidence — never claim certainty. */
export const PROXY_CONFIDENCE_MAX = 0.95;

// ----- shared helpers -----------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Sample-size confidence with explicit minimums. Returns 0..1.
 *
 *   games < minGames OR observations < minObservations → ≤ 0.4 (low)
 *   games == 2×minGames AND observations == 2×minObservations → ≈ 0.8
 */
export function confidenceFromSampleSize(args: {
  games: number;
  observations: number;
  minGames: number;
  minObservations: number;
}): number {
  if (args.games <= 0 || args.observations <= 0) return 0;
  const gameRatio = args.games / args.minGames;
  const obsRatio = args.observations / args.minObservations;
  // Below minimum on either side → confidence is capped low.
  if (gameRatio < 1 || obsRatio < 1) {
    return clamp(0.2 + 0.2 * Math.min(gameRatio, obsRatio), 0, 0.4);
  }
  const meanRatio = (gameRatio + obsRatio) / 2;
  return clamp(0.5 + 0.25 * (meanRatio - 1), 0, PROXY_CONFIDENCE_MAX);
}

export function confidenceFromPlayerVolume(args: {
  games: number;
  targets: number;
}): number {
  return confidenceFromSampleSize({
    games: args.games,
    observations: args.targets,
    minGames: MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
    minObservations: MIN_TARGETS_FOR_MEDIUM_CONFIDENCE,
  });
}

export function confidenceFromDefenseVolume(args: {
  games: number;
  totalPlaysFaced: number;
}): number {
  return confidenceFromSampleSize({
    games: args.games,
    observations: args.totalPlaysFaced,
    minGames: MIN_GAMES_FOR_MEDIUM_CONFIDENCE,
    minObservations: MIN_DEFENSIVE_PLAYS_FOR_MEDIUM_CONFIDENCE,
  });
}

/**
 * Signal-agreement multiplier. Returns 0.4..1.0:
 *   - 0 / total signals agree → 0.4 (signal is structurally weak)
 *   - all agree → 1.0
 *
 * Multiplied into sample-size confidence to make sure single-signal
 * hits stay in low-confidence territory.
 */
export function confidenceFromSignalAgreement(
  agreementCount: number,
  totalSignals: number,
): number {
  if (totalSignals <= 0) return 0.5;
  const ratio = clamp(agreementCount / totalSignals, 0, 1);
  return clamp(0.4 + 0.6 * ratio, 0.4, 1);
}

/**
 * Hard-cap a proxy adjustment to the [lo, hi] range. The proxy may
 * recommend a 0.85 lift, but consumers can constrain it to e.g.
 * [0, 0.4] to avoid overweighting.
 */
export function capProxyAdjustment(
  value: number,
  range: { lo: number; hi: number },
): number {
  return clamp(value, range.lo, range.hi);
}

export interface ProxySignalVote {
  name: string;
  vote: "positive" | "negative" | "neutral";
}

/**
 * Returns whether the supplied signals disagree (mixed positive +
 * negative votes). If they do, the consumer should drop confidence
 * and add a "conflicting signals" risk note.
 */
export function detectConflictingProxySignals(
  signals: ProxySignalVote[],
): { conflicting: boolean; positiveCount: number; negativeCount: number; reasoning: string } {
  const positive = signals.filter((s) => s.vote === "positive");
  const negative = signals.filter((s) => s.vote === "negative");
  const conflicting = positive.length > 0 && negative.length > 0;
  const reasoning = conflicting
    ? `Conflicting signals: ${positive.map((s) => s.name).join(", ")} positive vs ${negative
        .map((s) => s.name)
        .join(", ")} negative`
    : "";
  return {
    conflicting,
    positiveCount: positive.length,
    negativeCount: negative.length,
    reasoning,
  };
}

/**
 * Build a risk note covering low-sample / low-confidence / conflict
 * situations. Returns undefined when the proxy is safely confident.
 */
export function buildProxyAccuracyWarning(args: {
  confidence: number;
  conflicting?: boolean;
  smallSample?: boolean;
  fallbackData?: boolean;
  context?: string;
}): string | undefined {
  const parts: string[] = [];
  if (args.smallSample) parts.push("low sample size");
  if (args.fallbackData) parts.push("fallback / indirect data only");
  if (args.conflicting) parts.push("signals conflict");
  if (parts.length === 0 && args.confidence < 0.4) {
    parts.push("low confidence");
  }
  if (parts.length === 0) return undefined;
  const ctx = args.context ? ` for ${args.context}` : "";
  return `Proxy accuracy warning${ctx}: ${parts.join(", ")} — treat as approximation`;
}
