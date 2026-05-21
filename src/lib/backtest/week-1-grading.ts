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
 * Per-prop-type aggregate for recommended plays. Mirrors the
 * naive-grading MarketBucket but groups by recommendation side
 * (the model's pick, not OVER+UNDER blindly).
 */
export interface RecommendedPropTypeRow {
  propType: PropType;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

/**
 * Confidence-tier aggregate. Tiers are the same Low/Medium/High
 * cut points the live scorecard exposes via `confidenceLabelOf`.
 */
export interface RecommendedConfidenceTier {
  tier: "High" | "Medium" | "Low";
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

/** Edge bucket for recommended plays, by selected-side edge. */
export interface RecommendedEdgeBucket {
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
  /** Optional per-prop-type / per-tier / per-edge-bucket
   *  breakdowns. Present once the scorecard pass populates
   *  recommendations on the candidates. */
  byPropType?: RecommendedPropTypeRow[];
  byConfidenceTier?: RecommendedConfidenceTier[];
  byEdgeBucket?: RecommendedEdgeBucket[];
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

  // Recommended plays — populated only when candidates carry a
  // scorecard with qualified=true and a side recommendation
  // (OVER/UNDER). The scorecard is the SAME decision engine the
  // live Player Props page uses; we never invent a second
  // decision path here.
  const recommendedPlays = computeRecommendedPlays({
    candidates: args.candidates,
    graded,
  });

  // Disqualification breakdown — populated from scorecard
  // disqualifiers when present, otherwise only from the data-
  // side reasons grading can compute alone.
  const disqualificationBreakdownFromScorecard = computeDisqualificationBreakdown({
    candidates: args.candidates,
    candidatesMissingActual,
    candidatesPushed,
  });

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

  const disqualificationBreakdown = disqualificationBreakdownFromScorecard;

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

// =====================================================================
// Scorecard-aware aggregates — recommended plays only
// =====================================================================

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
  { label: "5–7%", lo: 0.05, hi: 0.07 },
  { label: "7–10%", lo: 0.07, hi: 0.1 },
  { label: "10–15%", lo: 0.1, hi: 0.15 },
  { label: "15%+", lo: 0.15, hi: Infinity },
];

function emptyRecommendedRow<T extends string>(label: T) {
  return {
    label,
    count: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    unitsProfit: 0,
  };
}

function pickOutcomeForSide(
  g: GradedCandidate,
  side: Side,
): { outcome: GradedOutcome; profit: number } {
  return side === "OVER"
    ? { outcome: g.overOutcome, profit: g.overProfitPerUnit }
    : { outcome: g.underOutcome, profit: g.underProfitPerUnit };
}

function finalizeRow<R extends {
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  unitsProfit: number;
}>(row: R): R & {
  hitRatePct: number;
  roiPct: number;
} {
  const denom = row.wins + row.losses;
  const graded = row.wins + row.losses + row.pushes;
  return {
    ...row,
    hitRatePct: denom > 0 ? (row.wins / denom) * 100 : 0,
    roiPct: graded > 0 ? (row.unitsProfit / graded) * 100 : 0,
  };
}

function computeRecommendedPlays(args: {
  candidates: readonly RealWeekCandidate[];
  graded: readonly GradedCandidate[];
}): RecommendedPlaysPerformance {
  // Index graded outcomes by candidate id.
  const gradedById = new Map<string, GradedCandidate>();
  for (const g of args.graded) gradedById.set(g.candidateId, g);

  // Recommended = candidates with a scorecard, qualified=true,
  // and a side recommendation (OVER/UNDER, never PASS).
  const recs = args.candidates.filter((c) => {
    const s = c.scorecard;
    if (!s) return false;
    if (!s.qualified) return false;
    return s.recommendation === "OVER" || s.recommendation === "UNDER";
  });

  if (recs.length === 0) {
    // Either no scorecard pass has run, or the pass ran but
    // every candidate was disqualified. Distinguish the two so
    // the page note is honest.
    const anyScored = args.candidates.some((c) => c.scorecard !== undefined);
    return {
      enabled: false,
      note: anyScored
        ? "Scorecard pass ran but produced 0 qualified plays for this " +
          "week. Disqualification breakdown below shows why."
        : "Stored candidates carry no scorecard recommendation yet. " +
          "Run the admin Grade-Week-1 action to apply the V1 scorecard " +
          "to the stored candidates and populate this section.",
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
  }

  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let unitsProfit = 0;
  let sumEdge = 0;
  let sumConfidence = 0;
  const byPropTypeMap = new Map<PropType, RecommendedPropTypeRow>();
  const byTierMap = new Map<
    string,
    {
      tier: "High" | "Medium" | "Low";
      count: number;
      wins: number;
      losses: number;
      pushes: number;
      unitsProfit: number;
    }
  >();
  const byEdgeBucketMap = new Map<
    string,
    {
      label: string;
      edgeLow: number;
      edgeHigh: number;
      count: number;
      wins: number;
      losses: number;
      pushes: number;
      unitsProfit: number;
    }
  >();

  for (const c of recs) {
    const s = c.scorecard;
    if (!s) continue;
    const g = gradedById.get(c.id);
    if (!g) continue;
    const side: Side = s.recommendation === "OVER" ? "OVER" : "UNDER";
    const { outcome, profit } = pickOutcomeForSide(g, side);
    if (outcome === "NO_DATA") continue;
    if (outcome === "WIN") wins += 1;
    else if (outcome === "LOSS") losses += 1;
    else if (outcome === "PUSH") pushes += 1;
    unitsProfit += profit;
    sumEdge += s.edge;
    sumConfidence += s.confidence;

    let mkt = byPropTypeMap.get(c.propType);
    if (!mkt) {
      mkt = {
        propType: c.propType,
        count: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        hitRatePct: 0,
        roiPct: 0,
        unitsProfit: 0,
      };
      byPropTypeMap.set(c.propType, mkt);
    }
    mkt.count += 1;
    if (outcome === "WIN") mkt.wins += 1;
    else if (outcome === "LOSS") mkt.losses += 1;
    else if (outcome === "PUSH") mkt.pushes += 1;
    mkt.unitsProfit += profit;

    const tier = CONFIDENCE_TIERS.find(
      (t) => s.confidence >= t.lo && s.confidence < t.hi,
    )?.tier ?? "Low";
    let tierAgg = byTierMap.get(tier);
    if (!tierAgg) {
      tierAgg = {
        tier,
        count: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        unitsProfit: 0,
      };
      byTierMap.set(tier, tierAgg);
    }
    tierAgg.count += 1;
    if (outcome === "WIN") tierAgg.wins += 1;
    else if (outcome === "LOSS") tierAgg.losses += 1;
    else if (outcome === "PUSH") tierAgg.pushes += 1;
    tierAgg.unitsProfit += profit;

    const eb = EDGE_BUCKETS.find(
      (b) => s.edge >= b.lo && s.edge < b.hi,
    );
    if (eb) {
      let bucket = byEdgeBucketMap.get(eb.label);
      if (!bucket) {
        bucket = {
          label: eb.label,
          edgeLow: eb.lo,
          edgeHigh: eb.hi,
          count: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          unitsProfit: 0,
        };
        byEdgeBucketMap.set(eb.label, bucket);
      }
      bucket.count += 1;
      if (outcome === "WIN") bucket.wins += 1;
      else if (outcome === "LOSS") bucket.losses += 1;
      else if (outcome === "PUSH") bucket.pushes += 1;
      bucket.unitsProfit += profit;
    }
  }

  const count = wins + losses + pushes;
  const decisive = wins + losses;
  const byPropType: RecommendedPropTypeRow[] = [];
  for (const m of byPropTypeMap.values()) {
    const denom = m.wins + m.losses;
    const graded = m.wins + m.losses + m.pushes;
    m.hitRatePct = denom > 0 ? (m.wins / denom) * 100 : 0;
    m.roiPct = graded > 0 ? (m.unitsProfit / graded) * 100 : 0;
    byPropType.push(m);
  }
  byPropType.sort((a, b) => b.count - a.count);

  const byConfidenceTier: RecommendedConfidenceTier[] = [];
  for (const t of byTierMap.values()) {
    byConfidenceTier.push(finalizeRow(t));
  }
  // Stable order: High → Medium → Low.
  byConfidenceTier.sort((a, b) => {
    const order = { High: 0, Medium: 1, Low: 2 };
    return order[a.tier] - order[b.tier];
  });

  const byEdgeBucket: RecommendedEdgeBucket[] = [];
  for (const b of byEdgeBucketMap.values()) {
    byEdgeBucket.push(finalizeRow(b));
  }
  byEdgeBucket.sort((a, b) => a.edgeLow - b.edgeLow);

  return {
    enabled: true,
    note: "",
    count,
    wins,
    losses,
    pushes,
    hitRatePct: decisive > 0 ? (wins / decisive) * 100 : 0,
    roiPct: count > 0 ? (unitsProfit / count) * 100 : 0,
    unitsProfit,
    averageEdgePct: count > 0 ? (sumEdge / count) * 100 : 0,
    averageConfidence: count > 0 ? sumConfidence / count : 0,
    byPropType,
    byConfidenceTier,
    byEdgeBucket,
  };
}

function computeDisqualificationBreakdown(args: {
  candidates: readonly RealWeekCandidate[];
  candidatesMissingActual: number;
  candidatesPushed: number;
}): DisqualificationBreakdown {
  const anyScored = args.candidates.some((c) => c.scorecard !== undefined);
  if (!anyScored) {
    return {
      edgeTooThin: 0,
      riskGate: 0,
      roleStability: 0,
      missingResult: args.candidatesMissingActual,
      ungradeable: args.candidatesPushed,
      other: 0,
      totalRejected: args.candidatesMissingActual + args.candidatesPushed,
    };
  }
  let edgeTooThin = 0;
  let riskGate = 0;
  let roleStability = 0;
  let other = 0;
  let totalRejected = 0;
  for (const c of args.candidates) {
    const s = c.scorecard;
    if (!s) continue;
    if (s.qualified) continue;
    totalRejected += 1;
    const primary = (s.primaryDisqualifier ?? "").toLowerCase();
    if (primary.includes("edge")) edgeTooThin += 1;
    else if (primary.includes("role stability")) roleStability += 1;
    else if (
      primary.includes("data quality") ||
      primary.includes("injury") ||
      primary.includes("weather") ||
      primary.includes("correlation") ||
      primary.includes("game script") ||
      primary.includes("pace") ||
      primary.includes("market context")
    ) {
      riskGate += 1;
    } else {
      other += 1;
    }
  }
  return {
    edgeTooThin,
    riskGate,
    roleStability,
    missingResult: args.candidatesMissingActual,
    ungradeable: args.candidatesPushed,
    other,
    totalRejected,
  };
}
