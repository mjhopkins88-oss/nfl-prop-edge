/**
 * Week 1 stored-backtest grading.
 *
 * Given the 290 stored pregame candidates from
 * `buildRealWeek1CandidatesFromStoredData`, look up each
 * player's actual Week 1 stat in `player_week_stats.csv` and
 * grade both sides of the market (OVER + UNDER) at the recorded
 * odds. Aggregates: hit rate, ROI, units profit, market-level
 * breakdown, line/odds bucket breakdown.
 *
 * Pure file IO + arithmetic. No paid API call. No model logic
 * change — this is "naive" grading that reports what the market
 * lines themselves would have paid for blindly betting each side.
 * A future model-aware grader plugs in by providing a per-
 * candidate `recommendation` (OVER | UNDER) and grading only
 * that side.
 *
 * No touchdown props (the candidate set is already filtered).
 * No automated betting (this is post-hoc analysis only).
 */

import type { PropType } from "../types";
import type { NflPlayerWeekStat } from "../ingestion/nflverse-types";
import type { RealWeekCandidate } from "./real-week-candidate-builder";

export type Side = "OVER" | "UNDER";
export type GradedOutcome = "WIN" | "LOSS" | "PUSH" | "NO_DATA";

export interface GradedCandidate {
  candidateId: string;
  gameId: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: PropType;
  line: number;
  overOdds: number;
  underOdds: number;
  /** Actual stat value from player_week_stats, or null when no
   *  matching row was found. */
  actualValue: number | null;
  /** Win/loss/push for each side at the stored line + odds. */
  overOutcome: GradedOutcome;
  underOutcome: GradedOutcome;
  /** Net profit per $1 wagered, payout − stake. WIN: +decimal-1,
   *  LOSS: -1, PUSH: 0, NO_DATA: 0. */
  overProfitPerUnit: number;
  underProfitPerUnit: number;
  /** True when both sides have a clear winner (not PUSH, not
   *  NO_DATA). Useful for "qualified play" framing. */
  decisive: boolean;
}

export interface SideAggregate {
  wins: number;
  losses: number;
  pushes: number;
  graded: number;
  hitRate: number;
  roiPct: number;
  unitsProfit: number;
}

export interface MarketBucket {
  propType: PropType;
  total: number;
  decisive: number;
  overSide: SideAggregate;
  underSide: SideAggregate;
}

export interface LineBucket {
  label: string;
  lineLow: number;
  lineHigh: number;
  total: number;
  decisive: number;
  overSide: SideAggregate;
  underSide: SideAggregate;
}

/**
 * Aggregate naive-grading numbers for ALL 290 candidates. These
 * are model diagnostics — what the LINES paid out blindly — NOT
 * "the model's betting performance". Hit rate / ROI on this
 * block describe the universe of OVER vs UNDER outcomes; they
 * do not represent bets the scorecard model would have placed.
 */
export interface UniverseDiagnostics {
  totalCandidates: number;
  candidatesWithActual: number;
  candidatesMissingActual: number;
  candidatesPushed: number;
  /** Directional outcomes across the full universe — diagnostic. */
  overSide: SideAggregate;
  underSide: SideAggregate;
  betterSide: Side | "TIE";
  byPropType: MarketBucket[];
  byLineBucket: LineBucket[];
}

/**
 * The model's actual betting performance — qualified plays only.
 * Empty when the stored candidates carry no recommendation
 * (today's state: the candidate builder produces the universe
 * but doesn't run the scorecard pass).
 */
export interface RecommendedPlaysPerformance {
  /** False when no recommendation field exists on candidates. */
  enabled: boolean;
  /** Plain-text reason when disabled. Page surfaces this so the
   *  user knows hit/ROI of 0 isn't a real result. */
  note: string;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  averageEdgePct: number;
  averageConfidence: number;
}

/**
 * Parlay-builder integration. Today's stored candidates lack
 * the model fields required to build ParlayLeg inputs, so this
 * stays disabled with a clear note. Future: persist the
 * scorecard's per-leg outputs and rebuild parlays here.
 */
export interface ParlayPerformance {
  enabled: boolean;
  note: string;
  evaluated: number;
  selected: number;
  rejected: number;
  graded: ParlayGradedRow[];
  /** Aggregate of SELECTED parlays only. */
  selectedAggregate: {
    wins: number;
    losses: number;
    pushes: number;
    noResult: number;
    hitRatePct: number;
    roiPct: number;
    unitsProfit: number;
    averageModeledHitProbabilityPct: number;
    averageRequiredHitProbabilityPct: number;
    averagePayoutMultiplier: number;
    averageEVPct: number;
  };
  /** Counts of rejection reasons across evaluated-but-not-selected. */
  rejectionReasons: Record<string, number>;
}

export interface ParlayGradedRow {
  parlayId: string;
  parlayType: string;
  correlationType: string;
  legCount: number;
  legResults: ("WIN" | "LOSS" | "PUSH" | "NO_RESULT")[];
  parlayResult: "WIN" | "LOSS" | "PUSH" | "NO_RESULT";
  modeledHitProbabilityPct: number;
  requiredHitProbabilityPct: number;
  payoutMultiplier: number;
  evPct: number;
  unitsProfit: number;
}

/**
 * Counts of why candidates couldn't become recommended plays.
 * `missingResult` + `ungradeable` are populated from grading
 * directly; the other reasons require model integration and
 * stay 0 until that lands.
 */
export interface DisqualificationBreakdown {
  edgeTooThin: number;
  riskGate: number;
  roleStability: number;
  missingResult: number;
  ungradeable: number;
  other: number;
  /** Sum of the above so the page can render "passed / rejected". */
  totalRejected: number;
}

export interface GradedSummary {
  gradedAt: string;
  universeDiagnostics: UniverseDiagnostics;
  recommendedPlays: RecommendedPlaysPerformance;
  parlayPerformance: ParlayPerformance;
  disqualificationBreakdown: DisqualificationBreakdown;
  /** Backwards-compat headline fields for older callers. NEVER
   *  used for the "betting performance" headline — only for
   *  the diagnostic universe number. */
  totalCandidates: number;
  candidatesWithActual: number;
  candidatesMissingActual: number;
  candidatesPushed: number;
  qualifiedPlays: number;
  overSide: SideAggregate;
  underSide: SideAggregate;
  betterSide: Side | "TIE";
  byPropType: MarketBucket[];
  byLineBucket: LineBucket[];
}

export interface GradeResult {
  summary: GradedSummary;
  graded: GradedCandidate[];
}

const PROP_TYPE_TO_STAT: Record<string, keyof NflPlayerWeekStat> = {
  PASSING_ATTEMPTS: "passingAttempts",
  PASSING_COMPLETIONS: "passingCompletions",
  PASSING_YARDS: "passingYards",
  RECEPTIONS: "receptions",
  RECEIVING_YARDS: "receivingYards",
  RUSHING_ATTEMPTS: "rushingAttempts",
  RUSHING_YARDS: "rushingYards",
};

/** American odds → decimal multiplier (e.g., -110 → 1.909). */
export function americanToDecimal(odds: number): number {
  if (odds === 0) return 1;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

/** Net profit per $1 wagered for a winning bet at American odds. */
export function americanToProfit(odds: number): number {
  return americanToDecimal(odds) - 1;
}

function lookupActual(args: {
  candidate: Pick<RealWeekCandidate, "playerName" | "team" | "propType">;
  season: number;
  week: number;
  playerWeekStats: readonly NflPlayerWeekStat[];
}): number | null {
  const statKey = PROP_TYPE_TO_STAT[args.candidate.propType];
  if (!statKey) return null;
  // Prefer exact (player, season, week, team) match; fall back
  // to (player, season, week) when team-mismatch happens (the
  // candidate uses the post-normalization LAR while stats might
  // still say LA for the same player).
  const exact = args.playerWeekStats.find(
    (r) =>
      r.playerName === args.candidate.playerName &&
      r.season === args.season &&
      r.week === args.week &&
      r.team === args.candidate.team,
  );
  const candidate =
    exact ??
    args.playerWeekStats.find(
      (r) =>
        r.playerName === args.candidate.playerName &&
        r.season === args.season &&
        r.week === args.week,
    );
  if (!candidate) return null;
  const v = candidate[statKey];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function gradeOne(args: {
  candidate: RealWeekCandidate;
  season: number;
  week: number;
  playerWeekStats: readonly NflPlayerWeekStat[];
}): GradedCandidate {
  const actual = lookupActual({
    candidate: args.candidate,
    season: args.season,
    week: args.week,
    playerWeekStats: args.playerWeekStats,
  });
  const outcome = (side: Side): GradedOutcome => {
    if (actual === null) return "NO_DATA";
    if (actual === args.candidate.line) return "PUSH";
    if (side === "OVER")
      return actual > args.candidate.line ? "WIN" : "LOSS";
    return actual < args.candidate.line ? "WIN" : "LOSS";
  };
  const profit = (side: Side, o: GradedOutcome): number => {
    if (o === "WIN") {
      return side === "OVER"
        ? americanToProfit(args.candidate.overOdds)
        : americanToProfit(args.candidate.underOdds);
    }
    if (o === "LOSS") return -1;
    return 0;
  };
  const overOutcome = outcome("OVER");
  const underOutcome = outcome("UNDER");
  return {
    candidateId: args.candidate.id,
    gameId: args.candidate.gameId,
    playerName: args.candidate.playerName,
    team: args.candidate.team,
    opponent: args.candidate.opponent,
    propType: args.candidate.propType,
    line: args.candidate.line,
    overOdds: args.candidate.overOdds,
    underOdds: args.candidate.underOdds,
    actualValue: actual,
    overOutcome,
    underOutcome,
    overProfitPerUnit: profit("OVER", overOutcome),
    underProfitPerUnit: profit("UNDER", underOutcome),
    decisive:
      overOutcome !== "NO_DATA" &&
      overOutcome !== "PUSH" &&
      underOutcome !== "NO_DATA" &&
      underOutcome !== "PUSH",
  };
}

function emptyAggregate(): SideAggregate {
  return {
    wins: 0,
    losses: 0,
    pushes: 0,
    graded: 0,
    hitRate: 0,
    roiPct: 0,
    unitsProfit: 0,
  };
}

function finalize(agg: SideAggregate): SideAggregate {
  const graded = agg.wins + agg.losses + agg.pushes;
  const denom = agg.wins + agg.losses;
  agg.graded = graded;
  agg.hitRate = denom > 0 ? agg.wins / denom : 0;
  agg.roiPct = graded > 0 ? (agg.unitsProfit / graded) * 100 : 0;
  return agg;
}

function accumulate(
  agg: SideAggregate,
  outcome: GradedOutcome,
  profit: number,
): void {
  if (outcome === "WIN") agg.wins += 1;
  else if (outcome === "LOSS") agg.losses += 1;
  else if (outcome === "PUSH") agg.pushes += 1;
  agg.unitsProfit += profit;
}

const LINE_BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "≤ 5", lo: 0, hi: 5 },
  { label: "5–10", lo: 5, hi: 10 },
  { label: "10–25", lo: 10, hi: 25 },
  { label: "25–35", lo: 25, hi: 35 },
  { label: "35+", lo: 35, hi: Infinity },
];

function bucketLine(line: number): { label: string; lo: number; hi: number } {
  return (
    LINE_BUCKETS.find((b) => line > b.lo && line <= b.hi) ??
    LINE_BUCKETS[LINE_BUCKETS.length - 1]
  );
}

/**
 * Grade the stored pregame candidates against actual outcomes.
 * Returns one row per candidate plus aggregate summaries.
 */
export function gradeStoredWeek1Backtest(args: {
  candidates: readonly RealWeekCandidate[];
  season: number;
  week: number;
  playerWeekStats: readonly NflPlayerWeekStat[];
}): GradeResult {
  const graded: GradedCandidate[] = args.candidates.map((c) =>
    gradeOne({
      candidate: c,
      season: args.season,
      week: args.week,
      playerWeekStats: args.playerWeekStats,
    }),
  );

  const overSide = emptyAggregate();
  const underSide = emptyAggregate();
  const byPropType = new Map<PropType, MarketBucket>();
  const byLineBucket = new Map<string, LineBucket>();
  let candidatesWithActual = 0;
  let candidatesMissingActual = 0;
  let candidatesPushed = 0;
  let qualifiedPlays = 0;

  for (const g of graded) {
    if (g.actualValue === null) {
      candidatesMissingActual += 1;
    } else {
      candidatesWithActual += 1;
      if (g.overOutcome === "PUSH" || g.underOutcome === "PUSH") {
        candidatesPushed += 1;
      }
    }
    if (g.decisive) qualifiedPlays += 1;

    accumulate(overSide, g.overOutcome, g.overProfitPerUnit);
    accumulate(underSide, g.underOutcome, g.underProfitPerUnit);

    let market = byPropType.get(g.propType);
    if (!market) {
      market = {
        propType: g.propType,
        total: 0,
        decisive: 0,
        overSide: emptyAggregate(),
        underSide: emptyAggregate(),
      };
      byPropType.set(g.propType, market);
    }
    market.total += 1;
    if (g.decisive) market.decisive += 1;
    accumulate(market.overSide, g.overOutcome, g.overProfitPerUnit);
    accumulate(market.underSide, g.underOutcome, g.underProfitPerUnit);

    const bucketDef = bucketLine(g.line);
    let bucket = byLineBucket.get(bucketDef.label);
    if (!bucket) {
      bucket = {
        label: bucketDef.label,
        lineLow: bucketDef.lo,
        lineHigh: bucketDef.hi,
        total: 0,
        decisive: 0,
        overSide: emptyAggregate(),
        underSide: emptyAggregate(),
      };
      byLineBucket.set(bucketDef.label, bucket);
    }
    bucket.total += 1;
    if (g.decisive) bucket.decisive += 1;
    accumulate(bucket.overSide, g.overOutcome, g.overProfitPerUnit);
    accumulate(bucket.underSide, g.underOutcome, g.underProfitPerUnit);
  }

  finalize(overSide);
  finalize(underSide);
  for (const bucket of byPropType.values()) {
    finalize(bucket.overSide);
    finalize(bucket.underSide);
  }
  for (const bucket of byLineBucket.values()) {
    finalize(bucket.overSide);
    finalize(bucket.underSide);
  }

  const betterSide: Side | "TIE" =
    overSide.unitsProfit > underSide.unitsProfit
      ? "OVER"
      : underSide.unitsProfit > overSide.unitsProfit
        ? "UNDER"
        : "TIE";

  const sortedByPropType = [...byPropType.values()].sort(
    (a, b) => b.total - a.total,
  );
  const sortedByLineBucket = [...byLineBucket.values()].sort(
    (a, b) => a.lineLow - b.lineLow,
  );

  const universeDiagnostics: UniverseDiagnostics = {
    totalCandidates: graded.length,
    candidatesWithActual,
    candidatesMissingActual,
    candidatesPushed,
    overSide,
    underSide,
    betterSide,
    byPropType: sortedByPropType,
    byLineBucket: sortedByLineBucket,
  };

  // Recommended plays — empty today. The stored
  // RealWeekCandidate type carries no `recommendation` or
  // `qualified` field; producing real numbers here requires
  // running the V1 scorecard model on each candidate first.
  // The page surfaces the note instead of zeroes-as-result.
  const recommendedPlays: RecommendedPlaysPerformance = {
    enabled: false,
    note:
      "Stored candidates carry no scorecard recommendation yet. " +
      "The 290 candidates are the evaluated UNIVERSE, not bets the " +
      "model would have placed. Wire `recommendation` + `qualified` " +
      "onto the candidate builder output to populate this section.",
    count: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    hitRatePct: 0,
    roiPct: 0,
    unitsProfit: 0,
    averageEdgePct: 0,
    averageConfidence: 0,
  };

  // Parlay performance — same reason as above. Parlay legs
  // require model-derived modelProbability + qualified +
  // recommendation per leg. Until those land on the stored
  // candidates, we cannot build ParlayLeg inputs that the
  // existing builder would treat as real picks. We do NOT
  // bypass the qualification step with synthetic defaults
  // because the resulting "selected parlays" would be
  // misleading.
  const parlayPerformance: ParlayPerformance = {
    enabled: false,
    note:
      "Parlay grading requires per-leg model recommendations on " +
      "the stored candidates (modelProbability, qualified, " +
      "recommendation, riskScore). The parlay builder rejects legs " +
      "lacking those fields. Populate them via the V1 scorecard " +
      "pass and re-run grading.",
    evaluated: 0,
    selected: 0,
    rejected: 0,
    graded: [],
    selectedAggregate: {
      wins: 0,
      losses: 0,
      pushes: 0,
      noResult: 0,
      hitRatePct: 0,
      roiPct: 0,
      unitsProfit: 0,
      averageModeledHitProbabilityPct: 0,
      averageRequiredHitProbabilityPct: 0,
      averagePayoutMultiplier: 0,
      averageEVPct: 0,
    },
    rejectionReasons: {},
  };

  // Disqualification breakdown — only the data-side reasons
  // we can compute today. Model-gate reasons (edge-too-thin,
  // risk-gate, role-stability) stay at 0 until the scorecard
  // pass runs and persists its decision per candidate.
  const missingResult = candidatesMissingActual;
  const ungradeable = candidatesPushed;
  const disqualificationBreakdown: DisqualificationBreakdown = {
    edgeTooThin: 0,
    riskGate: 0,
    roleStability: 0,
    missingResult,
    ungradeable,
    other: 0,
    totalRejected: missingResult + ungradeable,
  };

  return {
    summary: {
      gradedAt: new Date().toISOString(),
      universeDiagnostics,
      recommendedPlays,
      parlayPerformance,
      disqualificationBreakdown,
      // Backwards-compat headline fields. Diagnostics only —
      // the page now puts them under "Candidate Universe
      // Diagnostics", not under "Betting Performance".
      totalCandidates: graded.length,
      candidatesWithActual,
      candidatesMissingActual,
      candidatesPushed,
      qualifiedPlays,
      overSide,
      underSide,
      betterSide,
      byPropType: sortedByPropType,
      byLineBucket: sortedByLineBucket,
    },
    graded,
  };
}
