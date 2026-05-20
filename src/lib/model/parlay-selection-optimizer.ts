/**
 * Portfolio-level parlay selection.
 *
 * Takes a list of qualified parlay candidates and returns a
 * curated subset that controls same-game / same-QB / same-correlation
 * exposure. Also removes duplicate-leg exposure and surfaces a
 * `ParlayPortfolioSummary` for the UI.
 *
 * Does NOT mutate input candidates. Read-only over them.
 */

import { rankParlayCandidates } from "./parlay-builder";
import { classifyParlayRiskProfile } from "./parlay-risk-profile";
import type {
  ParlayCandidate,
  ParlayPortfolioSummary,
  ParlayRiskProfile,
  ParlayType,
} from "./parlay-types";

const DEFAULT_MAX_PARLAYS_PER_GAME = 2;
const DEFAULT_MAX_PARLAYS_PER_QB = 2;
const DEFAULT_MAX_PARLAYS_PER_CORRELATION_STORY = 2;
const DEFAULT_MAX_PORTFOLIO_SIZE = 8;
const DEFAULT_MAX_HIGH_VARIANCE_YARDAGE = 2;

export interface OptimizerOptions {
  maxPortfolioSize?: number;
  maxParlaysPerGame?: number;
  maxParlaysPerQb?: number;
  maxParlaysPerCorrelationStory?: number;
  maxHighVarianceYardageParlays?: number;
}

export interface ParlayPortfolioResult {
  selected: ParlayCandidate[];
  filteredOut: ParlayCandidate[];
  summary: ParlayPortfolioSummary;
}

function teamsKey(candidate: ParlayCandidate): string {
  return [...candidate.teams].sort().join("+");
}

function gameKey(candidate: ParlayCandidate): string {
  return [...candidate.gameIds].sort().join("+");
}

/**
 * Identify the "QB anchor" leg of a parlay if there is one — used
 * to cap same-QB exposure across multiple parlays.
 */
function qbAnchorKey(candidate: ParlayCandidate): string | undefined {
  for (const leg of candidate.legs) {
    if (
      leg.propType === "PASSING_YARDS" ||
      leg.propType === "PASSING_ATTEMPTS" ||
      leg.propType === "PASSING_COMPLETIONS" ||
      leg.playerRole === "QB"
    ) {
      return `${leg.team}:${leg.playerName}`;
    }
  }
  return undefined;
}

/** A coarse "correlation story" key — same game + parlayType. */
function correlationStoryKey(candidate: ParlayCandidate): string {
  return `${gameKey(candidate)}::${candidate.parlayType}`;
}

/** Cap parlays per game given a list. */
export function capParlaysByGame(
  candidates: ParlayCandidate[],
  limit = DEFAULT_MAX_PARLAYS_PER_GAME,
): ParlayCandidate[] {
  const counts = new Map<string, number>();
  const out: ParlayCandidate[] = [];
  for (const c of candidates) {
    const key = gameKey(c);
    const seen = counts.get(key) ?? 0;
    if (seen >= limit) continue;
    counts.set(key, seen + 1);
    out.push(c);
  }
  return out;
}

/** Cap parlays per correlation story. */
export function capParlaysByCorrelationStory(
  candidates: ParlayCandidate[],
  limit = DEFAULT_MAX_PARLAYS_PER_CORRELATION_STORY,
): ParlayCandidate[] {
  const counts = new Map<string, number>();
  const out: ParlayCandidate[] = [];
  for (const c of candidates) {
    const key = correlationStoryKey(c);
    const seen = counts.get(key) ?? 0;
    if (seen >= limit) continue;
    counts.set(key, seen + 1);
    out.push(c);
  }
  return out;
}

/**
 * Remove parlays whose legs overlap by ID. Keep the highest-EV
 * version of any conflict; the others are dropped.
 */
export function removeDuplicateLegExposure(
  candidates: ParlayCandidate[],
): ParlayCandidate[] {
  const seenLegIds = new Set<string>();
  const ranked = rankParlayCandidates(candidates);
  const out: ParlayCandidate[] = [];
  for (const c of ranked) {
    const ids = c.legs.map((l) => l.id);
    const overlap = ids.some((id) => seenLegIds.has(id));
    if (overlap) continue;
    for (const id of ids) seenLegIds.add(id);
    out.push(c);
  }
  return out;
}

/**
 * Cap the number of high-variance yardage parlays in the portfolio.
 */
function capHighVarianceYardage(
  candidates: ParlayCandidate[],
  limit: number,
): ParlayCandidate[] {
  let highVarianceCount = 0;
  const out: ParlayCandidate[] = [];
  for (const c of candidates) {
    const profile = classifyParlayRiskProfile(c);
    const isHighVarianceYardage =
      profile === "HIGH_VARIANCE_YARDAGE" ||
      profile === "HIGH_PAYOUT_LONGSHOT";
    if (isHighVarianceYardage) {
      if (highVarianceCount >= limit) continue;
      highVarianceCount += 1;
    }
    out.push(c);
  }
  return out;
}

/**
 * Cap same-QB exposure.
 */
function capByQb(
  candidates: ParlayCandidate[],
  limit: number,
): ParlayCandidate[] {
  const counts = new Map<string, number>();
  const out: ParlayCandidate[] = [];
  for (const c of candidates) {
    const key = qbAnchorKey(c);
    if (!key) {
      out.push(c);
      continue;
    }
    const seen = counts.get(key) ?? 0;
    if (seen >= limit) continue;
    counts.set(key, seen + 1);
    out.push(c);
  }
  return out;
}

/** Wrapper — pre-rank, then size-cap. */
export function rankParlaysForPortfolio(
  candidates: ParlayCandidate[],
): ParlayCandidate[] {
  return rankParlayCandidates(candidates);
}

/**
 * Top-level: take a set of qualified candidates and return a
 * portfolio that respects exposure caps. Non-qualified candidates
 * are filtered out before the caps apply.
 */
export function optimizeParlayPortfolio(
  candidates: ParlayCandidate[],
  options: OptimizerOptions = {},
): ParlayPortfolioResult {
  const maxPortfolio =
    options.maxPortfolioSize ?? DEFAULT_MAX_PORTFOLIO_SIZE;
  const maxGame = options.maxParlaysPerGame ?? DEFAULT_MAX_PARLAYS_PER_GAME;
  const maxQb = options.maxParlaysPerQb ?? DEFAULT_MAX_PARLAYS_PER_QB;
  const maxStory =
    options.maxParlaysPerCorrelationStory ??
    DEFAULT_MAX_PARLAYS_PER_CORRELATION_STORY;
  const maxHighVariance =
    options.maxHighVarianceYardageParlays ??
    DEFAULT_MAX_HIGH_VARIANCE_YARDAGE;

  // Start from qualified-only.
  const qualifiedRanked = rankParlayCandidates(
    candidates.filter((c) => c.qualified),
  );

  let working = removeDuplicateLegExposure(qualifiedRanked);
  working = capParlaysByGame(working, maxGame);
  working = capByQb(working, maxQb);
  working = capParlaysByCorrelationStory(working, maxStory);
  working = capHighVarianceYardage(working, maxHighVariance);
  const selected = working.slice(0, maxPortfolio);
  const selectedIds = new Set(selected.map((c) => c.id));
  const filteredOut = candidates.filter((c) => !selectedIds.has(c.id));

  // Aggregate summary.
  const passReasons = new Map<string, number>();
  for (const c of filteredOut) {
    if (c.primaryDisqualifier) {
      passReasons.set(
        c.primaryDisqualifier,
        (passReasons.get(c.primaryDisqualifier) ?? 0) + 1,
      );
    }
  }
  const mostCommonPassReason = [...passReasons.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];

  // Strongest / weakest parlay type by average conf-adj EV in
  // selected.
  const typeStats = new Map<
    ParlayType,
    { sum: number; count: number }
  >();
  for (const c of selected) {
    const cur = typeStats.get(c.parlayType) ?? { sum: 0, count: 0 };
    cur.sum += c.confidenceAdjustedExpectedValue;
    cur.count += 1;
    typeStats.set(c.parlayType, cur);
  }
  let strongestParlayType: ParlayType | undefined;
  let weakestParlayType: ParlayType | undefined;
  let strongest = -Infinity;
  let weakest = Infinity;
  for (const [type, stat] of typeStats.entries()) {
    if (stat.count === 0) continue;
    const avg = stat.sum / stat.count;
    if (avg > strongest) {
      strongest = avg;
      strongestParlayType = type;
    }
    if (avg < weakest) {
      weakest = avg;
      weakestParlayType = type;
    }
  }

  const riskProfileCounts: Record<ParlayRiskProfile, number> = {
    LOW_VARIANCE_CORRELATED: 0,
    MEDIUM_VARIANCE_CORRELATED: 0,
    HIGH_VARIANCE_YARDAGE: 0,
    HIGH_PAYOUT_LONGSHOT: 0,
    UNKNOWN_CORRELATION: 0,
    OVERSTACKED: 0,
    FRAGILE_LINES: 0,
  };
  for (const c of selected) {
    const profile = classifyParlayRiskProfile(c);
    riskProfileCounts[profile] += 1;
  }
  const filteredHighRisk = filteredOut.filter((c) => {
    const profile = classifyParlayRiskProfile(c);
    return (
      profile === "OVERSTACKED" ||
      profile === "FRAGILE_LINES" ||
      profile === "HIGH_PAYOUT_LONGSHOT" ||
      profile === "UNKNOWN_CORRELATION"
    );
  }).length;

  const avgPayout =
    selected.length === 0
      ? 0
      : selected.reduce((a, c) => a + c.payoutMultiplier, 0) /
        selected.length;
  const avgProjected =
    selected.length === 0
      ? 0
      : selected.reduce((a, c) => a + c.projectedHitRate, 0) /
        selected.length;
  const avgRequired =
    selected.length === 0
      ? 0
      : selected.reduce((a, c) => a + c.requiredHitRate, 0) /
        selected.length;
  const avgConfAdjEV =
    selected.length === 0
      ? 0
      : selected.reduce(
          (a, c) => a + c.confidenceAdjustedExpectedValue,
          0,
        ) / selected.length;

  return {
    selected,
    filteredOut,
    summary: {
      selectedCount: selected.length,
      filteredCount: filteredOut.length,
      averagePayoutMultiplier: avgPayout,
      averageProjectedHitRate: avgProjected,
      averageRequiredHitRate: avgRequired,
      averageConfidenceAdjustedEV: avgConfAdjEV,
      highRiskFilteredOut: filteredHighRisk,
      mostCommonPassReason,
      strongestParlayType,
      weakestParlayType,
      riskProfileCounts,
    },
  };
}
