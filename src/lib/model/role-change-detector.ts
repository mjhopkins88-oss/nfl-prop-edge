/**
 * Role-trend detector for V1 player prop markets.
 *
 * Reads weekly usage series (snap share, target share, carry share,
 * route-ish proxy if present) and classifies the role as STABLE /
 * EXPANDING / DECLINING / VOLATILE / UNKNOWN. A trend is *not* a
 * recommendation — the v2 pipeline uses it to set a role-stability
 * floor and to add reasons / risks.
 *
 * Two principles:
 *   1. Tiny but flat usage is not stability. A 3% target share that
 *      stays at 3% is not a useable signal.
 *   2. Insufficient sample → UNKNOWN. We do not pretend to know.
 */

export interface RoleTrendInput {
  /** Per-week snap share (0..1). Most recent week last. */
  weeklySnapShare?: number[];
  /** Per-week target share (0..1). */
  weeklyTargetShare?: number[];
  /** Per-week carry share (0..1). */
  weeklyCarryShare?: number[];
  /** Per-week route / usage proxy (0..1), if available. */
  weeklyRouteOrUsageProxy?: number[];
  /**
   * Season-to-date baseline (per metric). If omitted, derived from
   * the supplied weekly series.
   */
  seasonBaselineSnapShare?: number;
  seasonBaselineTargetShare?: number;
  seasonBaselineCarryShare?: number;
  /**
   * Prior baseline carried in from a previous season / role.
   * Used to anchor expansion / decline classification when the
   * current season sample is short.
   */
  priorBaselineUsage?: number;
  /** How many recent weeks to average for the "recent" window. */
  recentWindow?: number;
}

export type RoleTrendClassification =
  | "STABLE_ROLE"
  | "EXPANDING_ROLE"
  | "DECLINING_ROLE"
  | "VOLATILE_ROLE"
  | "UNKNOWN_ROLE";

export interface RoleTrendOutput {
  classification: RoleTrendClassification;
  /** 0..1; high = the role is dependable. */
  roleStabilityScore: number;
  /** -1..+1; +1 = strong expansion, -1 = strong decline. */
  roleMomentumScore: number;
  /** 0..1; how confident we are in the classification. */
  confidence: number;
  /** Recent average of the primary usage metric. */
  recentUsage: number;
  /** Season baseline of the primary usage metric. */
  baselineUsage: number;
  /** Coefficient of variation of weekly usage. */
  weeklyVariation: number;
  reasons: string[];
  risks: string[];
}

const DEFAULT_RECENT_WINDOW = 3;
const MIN_SAMPLE_FOR_CLASSIFICATION = 3;
const MIN_MEANINGFUL_USAGE = 0.08; // 8% — below this we treat usage as nominal
const EXPANSION_DELTA = 0.05;
const DECLINE_DELTA = 0.05;
const VOLATILE_CV_THRESHOLD = 0.45;

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(Math.max(value, lo), hi);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const v =
    values.reduce((a, b) => a + (b - m) * (b - m), 0) / (values.length - 1);
  return Math.sqrt(v);
}

interface UsageStream {
  name: string;
  values: number[];
  baseline?: number;
}

function pickPrimaryStream(input: RoleTrendInput): UsageStream | undefined {
  if (
    input.weeklyTargetShare &&
    input.weeklyTargetShare.length >= MIN_SAMPLE_FOR_CLASSIFICATION
  ) {
    return {
      name: "target share",
      values: input.weeklyTargetShare,
      baseline: input.seasonBaselineTargetShare,
    };
  }
  if (
    input.weeklyCarryShare &&
    input.weeklyCarryShare.length >= MIN_SAMPLE_FOR_CLASSIFICATION
  ) {
    return {
      name: "carry share",
      values: input.weeklyCarryShare,
      baseline: input.seasonBaselineCarryShare,
    };
  }
  if (
    input.weeklyRouteOrUsageProxy &&
    input.weeklyRouteOrUsageProxy.length >= MIN_SAMPLE_FOR_CLASSIFICATION
  ) {
    return {
      name: "route / usage proxy",
      values: input.weeklyRouteOrUsageProxy,
    };
  }
  if (
    input.weeklySnapShare &&
    input.weeklySnapShare.length >= MIN_SAMPLE_FOR_CLASSIFICATION
  ) {
    return {
      name: "snap share",
      values: input.weeklySnapShare,
      baseline: input.seasonBaselineSnapShare,
    };
  }
  return undefined;
}

export function detectRoleTrend(input: RoleTrendInput): RoleTrendOutput {
  const reasons: string[] = [];
  const risks: string[] = [];
  const recentWindow = input.recentWindow ?? DEFAULT_RECENT_WINDOW;

  const stream = pickPrimaryStream(input);
  if (!stream) {
    risks.push("Insufficient weekly usage data to classify role");
    return {
      classification: "UNKNOWN_ROLE",
      roleStabilityScore: 0.4,
      roleMomentumScore: 0,
      confidence: 0.2,
      recentUsage: 0,
      baselineUsage: input.priorBaselineUsage ?? 0,
      weeklyVariation: 0,
      reasons,
      risks,
    };
  }

  const values = stream.values;
  const recent = values.slice(-recentWindow);
  const recentMean = mean(recent);
  const baseline =
    stream.baseline !== undefined ? stream.baseline : mean(values);
  const variation = recentMean > 0 ? stdDev(values) / recentMean : 0;
  const delta = recentMean - baseline;

  // Stability bedrock.
  const meaningfulUsage = recentMean >= MIN_MEANINGFUL_USAGE;
  if (!meaningfulUsage) {
    risks.push(
      `Recent ${stream.name} ${(recentMean * 100).toFixed(1)}% — too low to project a reliable role`,
    );
  }

  // Snap-share gate: when target / carry share trends are stable but
  // snap share is dropping, that contradicts apparent stability.
  if (
    stream.name !== "snap share" &&
    input.weeklySnapShare &&
    input.weeklySnapShare.length >= MIN_SAMPLE_FOR_CLASSIFICATION
  ) {
    const snapsRecent = mean(input.weeklySnapShare.slice(-recentWindow));
    const snapsBaseline =
      input.seasonBaselineSnapShare ?? mean(input.weeklySnapShare);
    if (snapsRecent < snapsBaseline - 0.08) {
      risks.push(
        `Snap share dropping (${(snapsRecent * 100).toFixed(0)}% recent vs ${(snapsBaseline * 100).toFixed(0)}% baseline)`,
      );
    }
  }

  // Volatility check (precedence over expansion / decline).
  if (variation >= VOLATILE_CV_THRESHOLD) {
    risks.push(
      `Weekly ${stream.name} swings (CV ${variation.toFixed(2)}) — role is volatile`,
    );
    return {
      classification: "VOLATILE_ROLE",
      roleStabilityScore: clamp(0.5 - variation, 0.2, 0.55),
      roleMomentumScore: clamp(delta * 4, -1, 1),
      confidence: 0.4,
      recentUsage: recentMean,
      baselineUsage: baseline,
      weeklyVariation: variation,
      reasons,
      risks,
    };
  }

  // Expansion / decline trends require a meaningful absolute level.
  if (meaningfulUsage && delta >= EXPANSION_DELTA) {
    reasons.push(
      `Recent ${stream.name} ${(recentMean * 100).toFixed(0)}% vs ${(baseline * 100).toFixed(0)}% baseline — expanding role`,
    );
    return {
      classification: "EXPANDING_ROLE",
      roleStabilityScore: clamp(0.65 + (delta - EXPANSION_DELTA) * 2, 0.55, 0.85),
      roleMomentumScore: clamp(delta * 6, 0, 1),
      confidence: clamp(0.55 + (recentMean - MIN_MEANINGFUL_USAGE) * 1.5, 0.55, 0.85),
      recentUsage: recentMean,
      baselineUsage: baseline,
      weeklyVariation: variation,
      reasons,
      risks,
    };
  }
  if (delta <= -DECLINE_DELTA) {
    risks.push(
      `Recent ${stream.name} ${(recentMean * 100).toFixed(0)}% vs ${(baseline * 100).toFixed(0)}% baseline — declining role`,
    );
    return {
      classification: "DECLINING_ROLE",
      roleStabilityScore: clamp(0.4 + delta * 2, 0.2, 0.5),
      roleMomentumScore: clamp(delta * 6, -1, 0),
      confidence: clamp(0.55 + Math.abs(delta) * 1.5, 0.5, 0.85),
      recentUsage: recentMean,
      baselineUsage: baseline,
      weeklyVariation: variation,
      reasons,
      risks,
    };
  }

  // Stable case — but tiny usage is not real stability.
  if (!meaningfulUsage) {
    return {
      classification: "UNKNOWN_ROLE",
      roleStabilityScore: 0.45,
      roleMomentumScore: 0,
      confidence: 0.3,
      recentUsage: recentMean,
      baselineUsage: baseline,
      weeklyVariation: variation,
      reasons,
      risks,
    };
  }

  reasons.push(
    `Recent ${stream.name} ${(recentMean * 100).toFixed(0)}% within ${(EXPANSION_DELTA * 100).toFixed(0)}pp of baseline — stable role`,
  );
  return {
    classification: "STABLE_ROLE",
    roleStabilityScore: clamp(
      0.7 + (recentMean - MIN_MEANINGFUL_USAGE) * 1.3 - variation,
      0.55,
      0.9,
    ),
    roleMomentumScore: clamp(delta * 4, -0.2, 0.2),
    confidence: clamp(0.7 - variation, 0.55, 0.85),
    recentUsage: recentMean,
    baselineUsage: baseline,
    weeklyVariation: variation,
    reasons,
    risks,
  };
}
