/**
 * Parlay builder — turns a pool of legs (already-evaluated player
 * props) into ranked, qualified parlay candidates.
 *
 * Two flows:
 *
 *   buildParlayCandidates({ legs, candidateSpecs })
 *     — use a curated list of candidate specs (pairs/triples of leg
 *       IDs + a hint `parlayType`). Used by the test runner and the
 *       UI fixtures so we get deterministic outputs.
 *
 *   buildTwoLegParlays(legs) / buildThreeLegParlays(legs)
 *     — generate all reasonable combinations (with the curated
 *       parlay-type detector). Used when no manual list is supplied.
 *
 * Every candidate is scored, classified, and ranked. Hard
 * disqualifiers PASS the candidate. The dashboard / detail page
 * consumes the resulting `ParlayCandidate` objects.
 */

import type { PropType } from "../types";
import {
  MAX_LEG_LINE_FRAGILITY,
  MAX_LEGS_DEFAULT,
  MAX_LEGS_ALLOWED,
  MAX_PARLAYS_PER_GAME,
  MAX_RISK_SCORE,
  MAX_SAME_TEAM_PASS_VOLUME_EXPOSURE,
  MIN_CONFIDENCE_ADJUSTED_EV,
  MIN_LEG_CONFIDENCE,
  MIN_LEG_CONFIDENCE_ADJUSTED_EDGE,
  MIN_LEG_DATA_QUALITY,
  MIN_PARLAY_EV,
} from "./parlay-config";
import { calculateLegCorrelation } from "./parlay-correlation";
import {
  classifyParlayValue,
  calculateConfidenceAdjustedParlayEV,
  calculateParlayExpectedValue,
} from "./parlay-ev";
import {
  americanToDecimal,
  calculateCorrelationAdjustedJointProbability,
  calculateIndependentJointProbability,
  calculateRequiredHitRate,
  combineDecimalOdds,
  decimalToAmerican,
  impliedProbabilityFromAmerican,
} from "./parlay-probability";
import type {
  ParlayCandidate,
  ParlayCorrelationResult,
  ParlayLeg,
  ParlayRecommendation,
  ParlayScorecard,
  ParlayType,
} from "./parlay-types";

const V1_PROP_TYPES = new Set<PropType>([
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
]);

export interface ParlayCandidateSpec {
  legIds: string[];
  /** Optional manual type hint; otherwise inferred. */
  parlayType?: ParlayType;
}

export interface BuildParlayCandidatesArgs {
  legs: ParlayLeg[];
  /** Optional curated candidate list. */
  candidateSpecs?: ParlayCandidateSpec[];
  /** Defaults to MAX_LEGS_DEFAULT (2). */
  maxLegsPerParlay?: number;
  /** When true, generate every reasonable combination (capped). */
  enumerateAll?: boolean;
  targetRoi?: number;
}

export function buildParlayCandidates(
  args: BuildParlayCandidatesArgs,
): ParlayCandidate[] {
  const legsById = new Map<string, ParlayLeg>(args.legs.map((l) => [l.id, l]));
  const maxLegs = Math.min(
    args.maxLegsPerParlay ?? MAX_LEGS_DEFAULT,
    MAX_LEGS_ALLOWED,
  );

  let candidates: ParlayCandidate[] = [];

  if (args.candidateSpecs && args.candidateSpecs.length > 0) {
    for (const spec of args.candidateSpecs) {
      const legs = spec.legIds
        .map((id) => legsById.get(id))
        .filter((l): l is ParlayLeg => l !== undefined);
      if (legs.length < 2) continue;
      if (legs.length > maxLegs) continue;
      const result = qualifyParlayCandidate({
        legs,
        parlayTypeHint: spec.parlayType,
        targetRoi: args.targetRoi,
      });
      candidates.push(result);
    }
  } else {
    candidates = buildTwoLegParlays(args.legs, args.targetRoi);
    if (maxLegs >= 3) {
      candidates = candidates.concat(
        buildThreeLegParlays(args.legs, args.targetRoi),
      );
    }
  }

  if (args.enumerateAll) {
    candidates = filterDuplicateParlays(candidates);
  }
  candidates = capParlaysPerGame(candidates);
  return rankParlayCandidates(candidates);
}

export function buildTwoLegParlays(
  legs: ParlayLeg[],
  targetRoi?: number,
): ParlayCandidate[] {
  const out: ParlayCandidate[] = [];
  for (let i = 0; i < legs.length - 1; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (a.gameId !== b.gameId) continue;
      out.push(
        qualifyParlayCandidate({
          legs: [a, b],
          targetRoi,
        }),
      );
    }
  }
  return out;
}

export function buildThreeLegParlays(
  legs: ParlayLeg[],
  targetRoi?: number,
): ParlayCandidate[] {
  const out: ParlayCandidate[] = [];
  for (let i = 0; i < legs.length - 2; i++) {
    for (let j = i + 1; j < legs.length - 1; j++) {
      for (let k = j + 1; k < legs.length; k++) {
        const a = legs[i];
        const b = legs[j];
        const c = legs[k];
        if (a.gameId !== b.gameId || a.gameId !== c.gameId) continue;
        out.push(
          qualifyParlayCandidate({
            legs: [a, b, c],
            targetRoi,
          }),
        );
      }
    }
  }
  return out;
}

export interface QualifyParlayArgs {
  legs: ParlayLeg[];
  parlayTypeHint?: ParlayType;
  targetRoi?: number;
}

export function qualifyParlayCandidate(
  args: QualifyParlayArgs,
): ParlayCandidate {
  const legs = args.legs;
  const reasons: string[] = [];
  const risks: string[] = [];
  const disqualifiers: string[] = [];

  // -- hard guards --
  for (const leg of legs) {
    if (!V1_PROP_TYPES.has(leg.propType)) {
      disqualifiers.push(
        `Leg ${leg.id} prop type ${leg.propType} is not in V1 supported markets`,
      );
    }
    if (leg.confidence < MIN_LEG_CONFIDENCE) {
      disqualifiers.push(
        `Leg ${leg.playerName} ${leg.propType} confidence ${(leg.confidence * 100).toFixed(0)}% below ${(MIN_LEG_CONFIDENCE * 100).toFixed(0)}% floor`,
      );
    }
    if (leg.dataQualityScore < MIN_LEG_DATA_QUALITY) {
      disqualifiers.push(
        `Leg ${leg.playerName} data quality ${leg.dataQualityScore.toFixed(2)} below ${MIN_LEG_DATA_QUALITY.toFixed(2)} floor`,
      );
    }
    if (Math.abs(leg.confidenceAdjustedEdge) < MIN_LEG_CONFIDENCE_ADJUSTED_EDGE) {
      disqualifiers.push(
        `Leg ${leg.playerName} ${leg.propType} confidence-adjusted edge ${(leg.confidenceAdjustedEdge * 100).toFixed(1)}pp below ${(MIN_LEG_CONFIDENCE_ADJUSTED_EDGE * 100).toFixed(1)}pp floor`,
      );
    }
    if (!leg.qualified && leg.primaryDisqualifier) {
      disqualifiers.push(
        `Leg ${leg.playerName} not qualified standalone: ${leg.primaryDisqualifier}`,
      );
    }
  }

  // Same-team pass-volume cap.
  const passVolumeByTeam = new Map<string, number>();
  for (const leg of legs) {
    if (
      (leg.propType === "RECEPTIONS" ||
        leg.propType === "RECEIVING_YARDS") &&
      leg.side === "OVER"
    ) {
      passVolumeByTeam.set(
        leg.team,
        (passVolumeByTeam.get(leg.team) ?? 0) + 1,
      );
    }
  }
  for (const [team, count] of passVolumeByTeam.entries()) {
    if (count > MAX_SAME_TEAM_PASS_VOLUME_EXPOSURE) {
      disqualifiers.push(
        `Too many receiving OVERs for ${team} (${count}) — same-game target overstacking`,
      );
    }
  }

  // Correlation analysis.
  const correlation = calculateLegCorrelation(legs);

  // Probability + odds math.
  const decimals = legs.map((l) => americanToDecimal(l.odds));
  const combinedDecimal = combineDecimalOdds(decimals);
  const combinedAmerican = decimalToAmerican(combinedDecimal);
  const payoutMultiplier = combinedDecimal;
  const indep = calculateIndependentJointProbability(legs);
  const avgConfidence =
    legs.reduce((a, l) => a + l.confidence, 0) / legs.length;
  const corrAdjusted = calculateCorrelationAdjustedJointProbability({
    independentJointProbability: indep,
    correlationScore: correlation.correlationScore,
    confidence: avgConfidence,
  });
  const marketJoint = legs.reduce(
    (acc, l) => acc * impliedProbabilityFromAmerican(l.odds),
    1,
  );

  // EV.
  const ev = calculateParlayExpectedValue({
    correlationAdjustedJointProbability: corrAdjusted,
    combinedDecimalOdds: combinedDecimal,
  });
  const sameGameLegs = new Set(legs.map((l) => l.gameId)).size === 1
    ? legs.length
    : 1;
  const confAdjEv = calculateConfidenceAdjustedParlayEV({
    expectedValue: ev,
    legs,
    correlationType: correlation.correlationType,
    overstackingRisk: correlation.overstackingRisk,
    conflictingScript: correlation.conflictingScript,
    sameGameLegs,
  });
  const requiredHitRate = calculateRequiredHitRate({
    payoutMultiplier,
    targetRoi: args.targetRoi,
  });
  const projectedHitRate = corrAdjusted;

  // -- soft disqualifiers + reasons --
  if (ev <= 0) {
    disqualifiers.push(
      `Expected value ${(ev * 100).toFixed(1)}% non-positive — parlay does not pay enough at projected hit rate`,
    );
  } else if (ev < MIN_PARLAY_EV) {
    risks.push(
      `Raw EV ${(ev * 100).toFixed(1)}% below ${(MIN_PARLAY_EV * 100).toFixed(0)}% comfort floor — thin parlay`,
    );
  } else {
    reasons.push(
      `Raw EV ${(ev * 100).toFixed(1)}% clears ${(MIN_PARLAY_EV * 100).toFixed(0)}% comfort floor`,
    );
  }
  if (confAdjEv <= 0) {
    disqualifiers.push(
      `Confidence-adjusted EV ${(confAdjEv * 100).toFixed(1)}% non-positive — risk-adjusted value gone`,
    );
  } else if (confAdjEv < MIN_CONFIDENCE_ADJUSTED_EV) {
    risks.push(
      `Confidence-adjusted EV ${(confAdjEv * 100).toFixed(1)}% below ${(MIN_CONFIDENCE_ADJUSTED_EV * 100).toFixed(0)}% — fragile after shrinkage`,
    );
  } else {
    reasons.push(
      `Confidence-adjusted EV ${(confAdjEv * 100).toFixed(1)}% clears ${(MIN_CONFIDENCE_ADJUSTED_EV * 100).toFixed(0)}% floor`,
    );
  }
  if (projectedHitRate < requiredHitRate) {
    disqualifiers.push(
      `Projected hit rate ${(projectedHitRate * 100).toFixed(1)}% below required ${(requiredHitRate * 100).toFixed(1)}% for this payout`,
    );
  }
  if (correlation.conflictingScript) {
    risks.push("Game-script conflict — legs need volume that may not materialize");
  }
  if (correlation.overstackingRisk) {
    disqualifiers.push(
      "Same-team receiver overstacking — pass volume cannot reliably support multiple OVERs in the same game",
    );
  }
  if (correlation.correlationType === "UNKNOWN") {
    risks.push("Correlation classified UNKNOWN — independent probability used");
  }
  for (const leg of legs) {
    if ((leg.lineFragilityScore ?? 0) >= MAX_LEG_LINE_FRAGILITY) {
      disqualifiers.push(
        `Leg ${leg.playerName} ${leg.propType} line fragility ${(leg.lineFragilityScore ?? 0).toFixed(2)} above ${MAX_LEG_LINE_FRAGILITY.toFixed(2)}`,
      );
    } else if ((leg.lineFragilityScore ?? 0) >= 0.6) {
      risks.push(
        `Leg ${leg.playerName} line sensitivity ${(leg.lineFragilityScore ?? 0).toFixed(2)} — edge could move`,
      );
    }
  }
  reasons.push(correlation.correlationExplanation);

  // Risk score for this parlay (average of leg risk scores, gated).
  const averageRisk =
    legs.reduce((a, l) => a + l.riskScore, 0) / legs.length;
  if (averageRisk < 1 - MAX_RISK_SCORE) {
    risks.push(
      `Average leg risk ${averageRisk.toFixed(2)} below ${(1 - MAX_RISK_SCORE).toFixed(2)} — environment is shaky`,
    );
  }
  const averageDataQuality =
    legs.reduce((a, l) => a + l.dataQualityScore, 0) / legs.length;

  // Classify.
  const valueClass = classifyParlayValue({
    expectedValue: ev,
    confidenceAdjustedExpectedValue: confAdjEv,
    projectedHitRate,
    requiredHitRate,
    correlationType: correlation.correlationType,
    conflictingScript: correlation.conflictingScript,
    overstackingRisk: correlation.overstackingRisk,
    anyLegNotQualified: legs.some((l) => !l.qualified),
    anyLegFragile: legs.some(
      (l) => (l.lineFragilityScore ?? 0) >= MAX_LEG_LINE_FRAGILITY,
    ),
    averageRisk,
    averageConfidence: avgConfidence,
  });
  let recommendation: ParlayRecommendation = valueClass.recommendation;
  // Disqualifier overrides — if any present, prefer the most
  // descriptive PASS bucket.
  if (disqualifiers.length > 0) {
    recommendation = pickPassReasonFromDisqualifiers(disqualifiers, recommendation);
  }
  const qualified = valueClass.qualifies && disqualifiers.length === 0;

  const parlayType = args.parlayTypeHint ?? inferParlayType(legs, correlation);
  const gameIds = Array.from(new Set(legs.map((l) => l.gameId)));
  const teams = Array.from(new Set(legs.map((l) => l.team)));
  const parlayId = `parlay-${legs.map((l) => l.id).join("+")}`;
  const finalExplanation = buildFinalExplanation({
    parlayType,
    recommendation,
    qualified,
    legs,
    correlation,
    ev,
    confAdjEv,
    projectedHitRate,
    requiredHitRate,
    payoutMultiplier,
    disqualifiers,
  });

  const scorecard: ParlayScorecard = {
    parlayId,
    parlayType,
    recommendation,
    qualified,
    legSummaries: legs.map((l) => ({
      playerName: l.playerName,
      propType: l.propType,
      side: l.side,
      line: l.line,
      odds: l.odds,
      legEdgePp: l.rawEdge * 100,
      legConfidenceAdjustedEdgePp: l.confidenceAdjustedEdge * 100,
      confidence: l.confidence,
      qualified: l.qualified,
      primaryDisqualifier: l.primaryDisqualifier,
      reasons: l.reasons,
      risks: l.risks,
    })),
    combinedOddsAmerican: combinedAmerican,
    combinedOddsDecimal: combinedDecimal,
    independentJointProbability: indep,
    correlationAdjustedJointProbability: corrAdjusted,
    marketJointProbability: marketJoint,
    requiredHitRate,
    projectedHitRate,
    expectedValue: ev,
    confidenceAdjustedExpectedValue: confAdjEv,
    payoutMultiplier,
    correlationScore: correlation.correlationScore,
    correlationType: correlation.correlationType,
    correlationExplanation: correlation.correlationExplanation,
    riskScore: averageRisk,
    dataQualityScore: averageDataQuality,
    reasons,
    risks,
    disqualifiers,
    finalExplanation,
  };

  return {
    id: parlayId,
    legs,
    parlayType,
    gameIds,
    teams,
    legCount: legs.length,
    combinedOddsAmerican: combinedAmerican,
    combinedOddsDecimal: combinedDecimal,
    independentJointProbability: indep,
    correlationAdjustedJointProbability: corrAdjusted,
    marketJointProbability: marketJoint,
    parlayEdge: (corrAdjusted - marketJoint) * 100,
    expectedValue: ev,
    confidenceAdjustedExpectedValue: confAdjEv,
    correlationScore: correlation.correlationScore,
    correlationType: correlation.correlationType,
    correlationExplanation: correlation.correlationExplanation,
    riskScore: averageRisk,
    dataQualityScore: averageDataQuality,
    payoutMultiplier,
    requiredHitRate,
    projectedHitRate,
    recommendation,
    qualified,
    primaryDisqualifier: disqualifiers[0],
    disqualifiers,
    reasons,
    risks,
    scorecard,
  };
}

function inferParlayType(
  legs: ParlayLeg[],
  correlation: ParlayCorrelationResult,
): ParlayType {
  const hasPassYards = legs.some(
    (l) => l.propType === "PASSING_YARDS" && l.side === "OVER",
  );
  const hasReceivingYards = legs.some(
    (l) => l.propType === "RECEIVING_YARDS",
  );
  const hasPassCompletions = legs.some(
    (l) => l.propType === "PASSING_COMPLETIONS" && l.side === "OVER",
  );
  const hasReceptions = legs.some((l) => l.propType === "RECEPTIONS");
  const hasPassAttempts = legs.some(
    (l) => l.propType === "PASSING_ATTEMPTS" && l.side === "OVER",
  );
  const hasRushingAttempts = legs.some(
    (l) => l.propType === "RUSHING_ATTEMPTS" && l.side === "OVER",
  );
  const hasRushingYards = legs.some(
    (l) => l.propType === "RUSHING_YARDS" && l.side === "OVER",
  );
  const allUnder = legs.every((l) => l.side === "UNDER");
  const passingUnder = legs.some(
    (l) => l.propType === "PASSING_YARDS" && l.side === "UNDER",
  );
  const receivingUnder = legs.some(
    (l) => l.propType === "RECEIVING_YARDS" && l.side === "UNDER",
  );
  const pressureLeg = legs.some(
    (l) => l.propType === "RECEPTIONS" && l.side === "OVER",
  );
  const passingUnderLeg = legs.some(
    (l) => l.propType === "PASSING_YARDS" && l.side === "UNDER",
  );

  if (passingUnder && receivingUnder && allUnder) {
    return "WEATHER_UNDER_STACK";
  }
  if (passingUnderLeg && pressureLeg) {
    return "PRESSURE_QUICK_GAME_STACK";
  }
  if (hasPassYards && hasReceivingYards) return "QB_RECEIVER_YARDS";
  if (hasPassCompletions && hasReceptions)
    return "QB_COMPLETIONS_RECEIVER_RECEPTIONS";
  if (hasPassAttempts && hasReceptions) return "PASS_VOLUME_STACK";
  if (hasRushingAttempts && hasRushingYards) return "RB_GAME_SCRIPT_STACK";
  if (allUnder && legs.length === 2) {
    return "NEGATIVE_PASSING_STACK";
  }
  void correlation; // available for future heuristics
  return "CUSTOM";
}

function pickPassReasonFromDisqualifiers(
  disqualifiers: string[],
  fallback: ParlayRecommendation,
): ParlayRecommendation {
  const joined = disqualifiers.join(" | ").toLowerCase();
  if (joined.includes("not qualified standalone")) return "PASS_LEG_NOT_QUALIFIED";
  if (joined.includes("overstacking") || joined.includes("conflict"))
    return "PASS_BAD_CORRELATION";
  if (joined.includes("fragility")) return "PASS_TOO_FRAGILE";
  if (joined.includes("expected value") || joined.includes("projected hit rate"))
    return "PASS_LOW_EV";
  if (joined.includes("data quality") || joined.includes("confidence"))
    return "PASS_TOO_MUCH_RISK";
  return fallback;
}

function buildFinalExplanation(args: {
  parlayType: ParlayType;
  recommendation: ParlayRecommendation;
  qualified: boolean;
  legs: ParlayLeg[];
  correlation: ParlayCorrelationResult;
  ev: number;
  confAdjEv: number;
  projectedHitRate: number;
  requiredHitRate: number;
  payoutMultiplier: number;
  disqualifiers: string[];
}): string {
  const legSummary = args.legs
    .map((l) => `${l.playerName} ${l.propType} ${l.side}`)
    .join(" + ");
  if (args.qualified) {
    return (
      `Qualified ${args.parlayType.replace(/_/g, " ").toLowerCase()}: ${legSummary}. ` +
      `Correlation ${args.correlation.correlationType.toLowerCase()} (${args.correlation.correlationScore.toFixed(2)}); ` +
      `projected hit rate ${(args.projectedHitRate * 100).toFixed(1)}% beats required ${(args.requiredHitRate * 100).toFixed(1)}% at ${args.payoutMultiplier.toFixed(2)}x payout. ` +
      `Confidence-adjusted EV ${(args.confAdjEv * 100).toFixed(1)}%.`
    );
  }
  if (args.recommendation === "CORRELATED_WATCH") {
    return (
      `Correlated watch only: ${legSummary}. Correlation classified ${args.correlation.correlationType.toLowerCase()} — independent estimate ` +
      `(joint ${(args.projectedHitRate * 100).toFixed(1)}%, required ${(args.requiredHitRate * 100).toFixed(1)}%).`
    );
  }
  if (args.disqualifiers.length > 0) {
    return `PASS — ${args.disqualifiers[0]}.`;
  }
  return `PASS — ${args.recommendation.replace(/_/g, " ").toLowerCase()} on ${legSummary}.`;
}

export function rankParlayCandidates(
  candidates: ParlayCandidate[],
): ParlayCandidate[] {
  return [...candidates].sort((a, b) => {
    if (
      Math.abs(
        b.confidenceAdjustedExpectedValue - a.confidenceAdjustedExpectedValue,
      ) > 1e-6
    ) {
      return (
        b.confidenceAdjustedExpectedValue - a.confidenceAdjustedExpectedValue
      );
    }
    if (
      Math.abs(
        b.correlationAdjustedJointProbability -
          a.correlationAdjustedJointProbability,
      ) > 1e-6
    ) {
      return (
        b.correlationAdjustedJointProbability -
        a.correlationAdjustedJointProbability
      );
    }
    if (Math.abs(b.riskScore - a.riskScore) > 1e-6) {
      return b.riskScore - a.riskScore; // higher score = lower risk → preferred
    }
    if (Math.abs(b.dataQualityScore - a.dataQualityScore) > 1e-6) {
      return b.dataQualityScore - a.dataQualityScore;
    }
    return b.payoutMultiplier - a.payoutMultiplier;
  });
}

export function filterDuplicateParlays(
  candidates: ParlayCandidate[],
): ParlayCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const sig = c.legs
      .map((l) => `${l.id}:${l.side}`)
      .sort()
      .join("|");
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

export function capParlaysPerGame(
  candidates: ParlayCandidate[],
): ParlayCandidate[] {
  const sorted = rankParlayCandidates(candidates);
  const perGameCounts = new Map<string, number>();
  const result: ParlayCandidate[] = [];
  for (const c of sorted) {
    const key = c.gameIds.join("+");
    const count = perGameCounts.get(key) ?? 0;
    if (count >= MAX_PARLAYS_PER_GAME) continue;
    perGameCounts.set(key, count + 1);
    result.push(c);
  }
  return result;
}
