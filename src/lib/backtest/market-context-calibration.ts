/**
 * Market-context gate calibration replay.
 *
 * Re-evaluates the stored Week-N candidates with a HYPOTHETICAL
 * marketContextGate value while leaving every other gate, the
 * edge threshold, and the live scorecard logic untouched. The
 * output is labeled DIAGNOSTIC and never feeds back into the
 * live model's recommendations.
 *
 * What changes vs. production:
 *   · A candidate that failed ONLY on marketContext (no other
 *     disqualifier) is treated as qualified IF its raw
 *     `rawMarketContextScore` is ≥ the override gate.
 *   · The recommended side is the same `selectedSide` the live
 *     scorecard already chose — we never re-pick a side.
 *
 * What stays the same:
 *   · Edge threshold, all 8 risk-bucket gates, projection math,
 *     no-vig math, the clamp floor on marketContextScore the
 *     live model consumes, and every production recommendation.
 *
 * Pure function. No paid API call. No mutation of the input
 * candidates or scorecards. No betting automation. Used by the
 * admin grading action so the page can render side-by-side
 * "production 0.45 / diagnostic 0.40 / diagnostic 0.35"
 * outcomes.
 */

import type { PropType } from "../types";
import type { NflPosition } from "../ingestion/nflverse-types";
import type { RealWeekCandidate } from "./real-week-candidate-builder";
import type { GradedCandidate } from "./week-1-grading";
import { rawMarketContextScore } from "./stored-candidate-scorecard";
import type { SignalFeatures } from "./signal-features";
import type { WrReceptionsSignals } from "./wr-receptions-signals";

export const PRODUCTION_MARKET_CONTEXT_GATE = 0.45;

export interface CalibrationCandidate {
  candidateId: string;
  playerName: string;
  team: string;
  opponent: string;
  gameId: string;
  propType: PropType;
  line: number;
  recommendedSide: "OVER" | "UNDER";
  modelProbability: number;
  marketProbability: number;
  edge: number;
  confidence: number;
  riskScore: number;
  /** Data-quality bucket score the scorecard saw (0..1). New
   *  field — older persisted calibrations won't carry it; the
   *  composite ranking falls back to a 0.50 neutral default. */
  dataQualityScore?: number;
  /** Volatility level the scorecard assigned to this projection.
   *  New field — older persisted calibrations won't carry it;
   *  the composite ranking treats `undefined` as medium (0.50). */
  volatilityLevel?: "low" | "medium" | "high";
  /** Diagnostic mispricing features computed from the
   *  candidate's strict-before history. Surfaced for the
   *  signal-quality audit; never feeds qualification. Optional
   *  so older persisted calibrations still load. */
  signalFeatures?: SignalFeatures;
  /** WR-receptions-specific diagnostic signals. Populated only
   *  when the candidate is a WR receptions prop with enough
   *  history; surfaced for the WR receptions analysis section
   *  of the edge-slice diagnostic. Never feeds qualification. */
  wrReceptionsSignals?: WrReceptionsSignals;
  /** Player's position pulled from the most recent strict-
   *  before history row. Diagnostic-only — used by the multi-
   *  hypothesis diagnostic to filter by position. */
  playerPosition?: NflPosition;
  /** True when the player has no strict-before rows from any
   *  prior season. Diagnostic-only — feeds the rookie
   *  mispricing analysis. */
  isRookie?: boolean;
  marketContextScoreClamped: number;
  marketContextScoreRaw: number;
  /** Was already qualified in production? When true, the
   *  calibration replay neither helps nor hurts this row. */
  productionQualified: boolean;
  actualValue: number | null;
  outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  profitPerUnit: number;
  /** Disqualifiers that the override removed. Empty when the
   *  candidate was already qualified or when no marketContext
   *  disqualifier was present. */
  removedDisqualifiers: string[];
}

export interface CalibrationPropTypeBucket {
  propType: string;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

export interface CalibrationConfidenceTier {
  tier: "High" | "Medium" | "Low";
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

export interface CalibrationEdgeBucket {
  label: string;
  edgeLow: number;
  edgeHigh: number;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

export interface CalibrationGateResult {
  gateThreshold: number;
  /** True when this is the production gate (0.45). The page
   *  uses this to label the row. */
  isProduction: boolean;
  qualifiedCount: number;
  decisiveCount: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  averageEdgePct: number;
  averageConfidence: number;
  byPropType: CalibrationPropTypeBucket[];
  byConfidenceTier: CalibrationConfidenceTier[];
  byEdgeBucket: CalibrationEdgeBucket[];
  candidates: CalibrationCandidate[];
}

export interface MarketContextCalibrationReplay {
  diagnosticOnly: true;
  generatedAt: string;
  productionGate: number;
  /** The live model's actual production result. Mirrors what
   *  /backtest/week-1 already shows as Recommended Plays
   *  Performance — duplicated here so the calibration section
   *  can render the side-by-side comparison from a single
   *  payload. */
  production: CalibrationGateResult;
  /** Hypothetical gate at 0.40. */
  gate040: CalibrationGateResult;
  /** Hypothetical gate at 0.35. */
  gate035: CalibrationGateResult;
  /** Plain-text safety note that surfaces on the page. */
  note: string;
}

const CONFIDENCE_TIERS: {
  tier: "High" | "Medium" | "Low";
  lo: number;
  hi: number;
}[] = [
  { tier: "High", lo: 0.75, hi: 1 + 1e-9 },
  { tier: "Medium", lo: 0.5, hi: 0.75 },
  { tier: "Low", lo: 0, hi: 0.5 },
];

const EDGE_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "<0%", lo: -Infinity, hi: 0 },
  { label: "0–5%", lo: 0, hi: 0.05 },
  { label: "5–7%", lo: 0.05, hi: 0.07 },
  { label: "7–10%", lo: 0.07, hi: 0.1 },
  { label: "10–15%", lo: 0.1, hi: 0.15 },
  { label: "15%+", lo: 0.15, hi: Infinity },
];

function wouldQualifyAtGate(args: {
  scorecard: NonNullable<RealWeekCandidate["scorecard"]>;
  candidate: RealWeekCandidate;
  gate: number;
}): {
  qualified: boolean;
  removedDisqualifiers: string[];
} {
  const { scorecard, candidate, gate } = args;
  // Production-qualified at the production gate — automatic
  // qualification at every override too.
  if (scorecard.qualified) {
    return { qualified: true, removedDisqualifiers: [] };
  }
  const allDisqs = scorecard.disqualifiers;
  const marketContextDisqs = allDisqs.filter((d) =>
    d.toLowerCase().includes("market context"),
  );
  const otherDisqs = allDisqs.filter(
    (d) => !d.toLowerCase().includes("market context"),
  );
  // Something else fails — gate change cannot help.
  if (otherDisqs.length > 0) {
    return { qualified: false, removedDisqualifiers: [] };
  }
  // Only marketContext was failing in production. Does the RAW
  // score (the value the model would have seen without the
  // 0.40 clamp floor) clear the new gate?
  const raw = rawMarketContextScore(candidate);
  if (raw >= gate) {
    return { qualified: true, removedDisqualifiers: marketContextDisqs };
  }
  return { qualified: false, removedDisqualifiers: [] };
}

function pickOutcome(
  g: GradedCandidate,
  side: "OVER" | "UNDER",
): { outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA"; profit: number } {
  return side === "OVER"
    ? { outcome: g.overOutcome, profit: g.overProfitPerUnit }
    : { outcome: g.underOutcome, profit: g.underProfitPerUnit };
}

function emptyAgg() {
  return {
    count: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    unitsProfit: 0,
  };
}

function finalizeAgg<T extends {
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  unitsProfit: number;
}>(agg: T): T & { hitRatePct: number; roiPct: number } {
  const decisive = agg.wins + agg.losses;
  const graded = agg.wins + agg.losses + agg.pushes;
  return {
    ...agg,
    hitRatePct: decisive > 0 ? (agg.wins / decisive) * 100 : 0,
    roiPct: graded > 0 ? (agg.unitsProfit / graded) * 100 : 0,
  };
}

function buildGateResult(args: {
  candidates: readonly RealWeekCandidate[];
  graded: readonly GradedCandidate[];
  gate: number;
  isProduction: boolean;
}): CalibrationGateResult {
  const { candidates, graded, gate, isProduction } = args;
  const gradedById = new Map<string, GradedCandidate>();
  for (const g of graded) gradedById.set(g.candidateId, g);

  const qualifiedCandidates: CalibrationCandidate[] = [];
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noResult = 0;
  let unitsProfit = 0;
  let sumEdge = 0;
  let sumConfidence = 0;
  let decisiveCount = 0;
  const byPropTypeMap = new Map<
    string,
    ReturnType<typeof emptyAgg> & { propType: string }
  >();
  const byTierMap = new Map<
    string,
    ReturnType<typeof emptyAgg> & { tier: "High" | "Medium" | "Low" }
  >();
  const byEdgeBucketMap = new Map<
    string,
    ReturnType<typeof emptyAgg> & { label: string; edgeLow: number; edgeHigh: number }
  >();

  for (const c of candidates) {
    const s = c.scorecard;
    if (!s) continue;
    const decision = wouldQualifyAtGate({
      scorecard: s,
      candidate: c,
      gate,
    });
    if (!decision.qualified) continue;
    const g = gradedById.get(c.id);
    const side = s.selectedSide;
    const outcomeAndProfit = g
      ? pickOutcome(g, side)
      : { outcome: "NO_DATA" as const, profit: 0 };
    const actualValue = g?.actualValue ?? null;
    const marketProbability =
      side === "OVER" ? s.marketOverProbability : s.marketUnderProbability;
    qualifiedCandidates.push({
      candidateId: c.id,
      playerName: c.playerName,
      team: c.team,
      opponent: c.opponent,
      gameId: c.gameId,
      propType: c.propType,
      line: c.line,
      recommendedSide: side,
      modelProbability: s.modelProbability,
      marketProbability,
      edge: s.edge,
      confidence: s.confidence,
      riskScore: s.riskScore,
      dataQualityScore: s.dataQualityScore,
      volatilityLevel: s.volatilityLevel,
      signalFeatures: s.signalFeatures,
      wrReceptionsSignals: s.wrReceptionsSignals,
      playerPosition: s.playerPosition,
      isRookie: s.isRookie,
      marketContextScoreClamped: s.marketContextScore,
      marketContextScoreRaw: rawMarketContextScore(c),
      productionQualified: s.qualified,
      actualValue,
      outcome: outcomeAndProfit.outcome,
      profitPerUnit: outcomeAndProfit.profit,
      removedDisqualifiers: decision.removedDisqualifiers,
    });
    if (outcomeAndProfit.outcome === "NO_DATA") {
      noResult += 1;
      continue;
    }
    if (outcomeAndProfit.outcome === "WIN") wins += 1;
    else if (outcomeAndProfit.outcome === "LOSS") losses += 1;
    else if (outcomeAndProfit.outcome === "PUSH") pushes += 1;
    unitsProfit += outcomeAndProfit.profit;
    sumEdge += s.edge;
    sumConfidence += s.confidence;
    decisiveCount += 1;

    // Bucket aggregates — by prop type.
    const mkt = byPropTypeMap.get(c.propType) ?? {
      ...emptyAgg(),
      propType: c.propType,
    };
    mkt.count += 1;
    if (outcomeAndProfit.outcome === "WIN") mkt.wins += 1;
    else if (outcomeAndProfit.outcome === "LOSS") mkt.losses += 1;
    else if (outcomeAndProfit.outcome === "PUSH") mkt.pushes += 1;
    mkt.unitsProfit += outcomeAndProfit.profit;
    byPropTypeMap.set(c.propType, mkt);

    // By confidence tier.
    const tier =
      CONFIDENCE_TIERS.find((t) => s.confidence >= t.lo && s.confidence < t.hi)
        ?.tier ?? "Low";
    const tierAgg = byTierMap.get(tier) ?? { ...emptyAgg(), tier };
    tierAgg.count += 1;
    if (outcomeAndProfit.outcome === "WIN") tierAgg.wins += 1;
    else if (outcomeAndProfit.outcome === "LOSS") tierAgg.losses += 1;
    else if (outcomeAndProfit.outcome === "PUSH") tierAgg.pushes += 1;
    tierAgg.unitsProfit += outcomeAndProfit.profit;
    byTierMap.set(tier, tierAgg);

    // By edge bucket.
    const eb = EDGE_BUCKETS.find((b) => s.edge >= b.lo && s.edge < b.hi);
    if (eb) {
      const bucket = byEdgeBucketMap.get(eb.label) ?? {
        ...emptyAgg(),
        label: eb.label,
        edgeLow: eb.lo,
        edgeHigh: eb.hi,
      };
      bucket.count += 1;
      if (outcomeAndProfit.outcome === "WIN") bucket.wins += 1;
      else if (outcomeAndProfit.outcome === "LOSS") bucket.losses += 1;
      else if (outcomeAndProfit.outcome === "PUSH") bucket.pushes += 1;
      bucket.unitsProfit += outcomeAndProfit.profit;
      byEdgeBucketMap.set(eb.label, bucket);
    }
  }

  const decisiveDenom = wins + losses;
  const gradedCount = wins + losses + pushes;
  const byPropType: CalibrationPropTypeBucket[] = [...byPropTypeMap.values()]
    .map(finalizeAgg)
    .sort((a, b) => b.count - a.count);
  const byConfidenceTier: CalibrationConfidenceTier[] = [...byTierMap.values()]
    .map(finalizeAgg)
    .sort((a, b) => {
      const order = { High: 0, Medium: 1, Low: 2 };
      return order[a.tier] - order[b.tier];
    });
  const byEdgeBucket: CalibrationEdgeBucket[] = [...byEdgeBucketMap.values()]
    .map(finalizeAgg)
    .sort((a, b) => a.edgeLow - b.edgeLow);

  return {
    gateThreshold: gate,
    isProduction,
    qualifiedCount: qualifiedCandidates.length,
    decisiveCount,
    wins,
    losses,
    pushes,
    noResult,
    hitRatePct: decisiveDenom > 0 ? (wins / decisiveDenom) * 100 : 0,
    roiPct: gradedCount > 0 ? (unitsProfit / gradedCount) * 100 : 0,
    unitsProfit,
    averageEdgePct:
      decisiveCount > 0 ? (sumEdge / decisiveCount) * 100 : 0,
    averageConfidence:
      decisiveCount > 0 ? sumConfidence / decisiveCount : 0,
    byPropType,
    byConfidenceTier,
    byEdgeBucket,
    candidates: qualifiedCandidates,
  };
}

/**
 * Build the diagnostic replay payload. Pure function — does
 * not call any API, does not mutate inputs.
 */
export function buildMarketContextCalibration(args: {
  candidates: readonly RealWeekCandidate[];
  graded: readonly GradedCandidate[];
}): MarketContextCalibrationReplay {
  const production = buildGateResult({
    candidates: args.candidates,
    graded: args.graded,
    gate: PRODUCTION_MARKET_CONTEXT_GATE,
    isProduction: true,
  });
  const gate040 = buildGateResult({
    candidates: args.candidates,
    graded: args.graded,
    gate: 0.4,
    isProduction: false,
  });
  const gate035 = buildGateResult({
    candidates: args.candidates,
    graded: args.graded,
    gate: 0.35,
    isProduction: false,
  });
  return {
    diagnosticOnly: true,
    generatedAt: new Date().toISOString(),
    productionGate: PRODUCTION_MARKET_CONTEXT_GATE,
    production,
    gate040,
    gate035,
    note:
      "Diagnostic-only replay. The live model still uses the " +
      "production gate (0.45). The 0.40 / 0.35 results below " +
      "describe what WOULD have happened if ONLY the " +
      "marketContext gate were lowered, holding every other " +
      "gate and the edge threshold fixed. Do not treat as " +
      "live performance.",
  };
}
