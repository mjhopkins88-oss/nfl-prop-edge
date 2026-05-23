/**
 * Latest stored Week-1 backtest snapshot used by `/monitor` and
 * `/backtest/week-1`. Reads the persistence layer first
 * (Postgres `StoredBacktestRun`), then the file mirror
 * (`data/backtests/2025/week-1-data-mode-status.fixture.json`),
 * then nothing. Either source survives a Railway redeploy.
 *
 *   · The DB row carries everything we need (status,
 *     candidatesJson, realWeek1BacktestReady, scheduleValidation
 *     Status, syntheticFixture, dataMode).
 *   · The file mirror is written by both
 *     `scripts/run-week-1-starter-test.ts --data-mode stored`
 *     and the admin `stored-backtest` action.
 *
 * Pure file IO + persistence client read. No paid API call.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getPersistenceClient,
  type PersistenceClient,
} from "../persistence/week-1-persistence";

export interface GradedSideSnapshot {
  wins: number;
  losses: number;
  pushes: number;
  graded: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

export interface GradedMarketBucket {
  propType: string;
  total: number;
  decisive: number;
  overSide: GradedSideSnapshot;
  underSide: GradedSideSnapshot;
}

export interface GradedLineBucket {
  label: string;
  lineLow: number;
  lineHigh: number;
  total: number;
  decisive: number;
  overSide: GradedSideSnapshot;
  underSide: GradedSideSnapshot;
}

export interface RecommendedPlayRow {
  label: string;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

export interface GradedSampleRow {
  candidateId: string;
  gameId: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  overOdds: number;
  underOdds: number;
  actualValue: number | null;
  overOutcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  underOutcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  overProfitPerUnit: number;
  underProfitPerUnit: number;
  decisive: boolean;
}

export interface GradedSnapshot {
  gradedAt: string;
  /** Diagnostic numbers across all candidates. Per-side hit
   *  rates here describe what the LINES paid, NOT model
   *  performance. The page labels this section "Candidate
   *  Universe Diagnostics — model diagnostic only". */
  universeDiagnostics: {
    totalCandidates: number;
    candidatesWithActual: number;
    candidatesMissingActual: number;
    candidatesPushed: number;
    overSide: GradedSideSnapshot;
    underSide: GradedSideSnapshot;
    betterSide: "OVER" | "UNDER" | "TIE";
    /** Per-market-type universe breakdown (PASSING_ATTEMPTS,
     *  RECEPTIONS, etc.). Populated when the grader has at
     *  least one row per market. */
    byPropType: GradedMarketBucket[];
    /** Per-line-bucket (≤5, 5–10, 10–25, 25–35, 35+). */
    byLineBucket: GradedLineBucket[];
  };
  /** Up to 100 individual graded candidates persisted by the
   *  admin grading action. Sorted by candidateId for stable
   *  rendering. */
  gradedSample: GradedSampleRow[];
  /** Model's actual betting performance — qualified plays only.
   *  Empty until candidates carry a `recommendation` field. */
  recommendedPlays: {
    enabled: boolean;
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
    byPropType: RecommendedPlayRow[];
    byConfidenceTier: RecommendedPlayRow[];
    byEdgeBucket: RecommendedPlayRow[];
  };
  /** Parlay-builder integration — same gating as recommended
   *  plays. Stays disabled until per-leg model fields land. */
  parlayPerformance: {
    enabled: boolean;
    note: string;
    evaluated: number;
    selected: number;
    rejected: number;
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
    rejectionReasons: Record<string, number>;
  };
  /** Candidate rejection reason counts. */
  disqualificationBreakdown: {
    edgeTooThin: number;
    riskGate: number;
    roleStability: number;
    /** Per-bucket counts the page uses to break "Risk gate"
     *  into 8 specific categories. Always present once the
     *  grading payload comes from a scorecard-aware run. */
    dataQualityGate?: number;
    roleStabilityGate?: number;
    injuryContextGate?: number;
    correlationExposureGate?: number;
    weatherEnvironmentGate?: number;
    gameScriptGate?: number;
    paceGate?: number;
    marketContextGate?: number;
    missingResult: number;
    ungradeable: number;
    other: number;
    totalRejected: number;
  };
  /** Per-feature audit + sample picks. Populated when the
   *  grading payload includes `scorecardAudit`. */
  scorecardAudit?: ScorecardAuditSnapshot;
  /** Diagnostic-only marketContext gate calibration replay.
   *  Populated when the grading payload includes
   *  `marketContextCalibration`. The page renders this in a
   *  clearly labeled "DIAGNOSTIC" section that is NEVER mixed
   *  with the live model's recommendations. */
  marketContextCalibration?: MarketContextCalibrationSnapshot;
  /** As-of fairness validation report from the admin grading
   *  action. Confirms no post-kickoff odds and no future stats
   *  reached the model. */
  asOfReport?: AsOfReportSnapshot;
}

export interface AsOfReportSnapshot {
  ok: boolean;
  season: number;
  week: number;
  candidatesChecked: number;
  candidatesValid: number;
  candidatesInvalid: number;
  candidates?: Array<{
    candidateId: string;
    playerName: string;
    team: string;
    opponent: string;
    gameId: string;
    propType: string;
    kickoffTime?: string;
    snapshotTime?: string;
    snapshotBeforeKickoff: boolean | "unknown";
    historyRowsAttached: number;
    historyWindowOk: boolean;
    ok: boolean;
  }>;
  sampleInvalid?: Array<{
    candidateId: string;
    playerName: string;
    propType: string;
    kickoffTime?: string;
    snapshotTime?: string;
    snapshotBeforeKickoff: boolean | "unknown";
    historyRowsAttached: number;
    historyWindowOk: boolean;
    violations: Array<{ code: string; detail: string }>;
  }>;
}

export interface ScorecardAuditFeatureRow {
  bucket: string;
  gateThreshold: number;
  belowGate: number;
  scored: number;
  missing: number;
  minScore: number;
  meanScore: number;
  maxScore: number;
}

export interface ScorecardAuditSamplePick {
  candidateId: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  recommendation: "OVER" | "UNDER" | "PASS" | "unknown";
  qualified: boolean | null;
  modelProbability: number | null;
  marketProbability: number | null;
  edge: number | null;
  confidence: number | null;
  riskScore: number | null;
  primaryDisqualifier: string | null;
  projectedMean: number | null;
}

export interface ScorecardClosestRow {
  candidateId: string;
  playerName: string;
  team: string;
  opponent: string;
  propType: string;
  line: number;
  side: "OVER" | "UNDER" | "PASS" | "unknown";
  modelProbability: number | null;
  marketProbability: number | null;
  edge: number | null;
  edgeThreshold: number | null;
  confidence: number | null;
  riskScore: number | null;
  dataQualityScore: number | null;
  marketContextScore: number | null;
  historyRows: number | null;
  disqualifiers: string[];
  gateGaps: Array<{ bucket: string; score: number; gate: number; gap: number }>;
  edgeGap: number | null;
  qualificationGap: number;
}

export interface ScorecardMarketContextAudit {
  gateThreshold: number;
  clampFloor: number;
  clampedDistribution: {
    gte045: number;
    band040To045: number;
    band035To040: number;
    lt035: number;
  };
  rawDistribution: {
    gte045: number;
    band040To045: number;
    band035To040: number;
    band020To035: number;
    band000To020: number;
    lt000: number;
  };
  rawMin: number;
  rawMean: number;
  rawMax: number;
  simulation: {
    qualifyingAtGate045: number;
    qualifyingAtGate040: number;
    qualifyingAtGate035: number;
  };
}

export interface ScorecardMissingHistoryAudit {
  totalMissing: number;
  teamSwitched: number;
  rookieOrUnknown: number;
  possibleNameMismatch: number;
  examples: Array<{
    candidateId: string;
    playerName: string;
    team: string;
    opponent: string;
    propType: string;
    line: number;
    cause: "teamSwitched" | "rookieOrUnknown" | "possibleNameMismatch" | "unknown";
    matchedTeam?: string;
    matchedName?: string;
  }>;
}

export interface ScorecardAuditSnapshot {
  candidatesScored: number;
  candidatesWithScorecard: number;
  candidatesMissingHistory: number;
  byRecommendation: {
    OVER: number;
    UNDER: number;
    PASS: number;
    unknown: number;
  };
  qualifiedCount: number;
  disqualifiedCount: number;
  topDisqualifiers: Array<{ reason: string; count: number }>;
  featureCompleteness: ScorecardAuditFeatureRow[];
  samplePicks: ScorecardAuditSamplePick[];
  /** Closest-to-qualifying candidates sorted ascending by gap. */
  closestToQualifying?: ScorecardClosestRow[];
  /** Market context distribution + threshold simulation. */
  marketContext?: ScorecardMarketContextAudit;
  /** Missing-history cause categorization. */
  missingHistory?: ScorecardMissingHistoryAudit;
}

export interface MarketContextCalibrationBucket {
  propType: string;
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

export interface MarketContextCalibrationTierBucket {
  tier: "High" | "Medium" | "Low";
  count: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

export interface MarketContextCalibrationEdgeBucket {
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

export interface MarketContextCalibrationCandidate {
  candidateId: string;
  playerName: string;
  team: string;
  opponent: string;
  gameId: string;
  propType: string;
  line: number;
  recommendedSide: "OVER" | "UNDER";
  modelProbability: number;
  marketProbability: number;
  edge: number;
  confidence: number;
  riskScore: number;
  dataQualityScore?: number;
  volatilityLevel?: "low" | "medium" | "high";
  signalFeatures?: {
    roleChangeScore: number;
    usageMomentumScore: number;
    volatilityScore: number;
    volatilityBucket: "low" | "medium" | "high" | "unknown";
    distributionBiasScore: number;
    scriptSensitivityScore: number;
    marketResistanceScore: number;
    historyRowsUsed: number;
    hasNeutralFallback: boolean;
  };
  wrReceptionsSignals?: {
    roleChange: number;
    routeParticipationSlope: number;
    targetShareVolatility: number;
    teamProe: number;
    defensiveMatchup?: number;
    historyRowsUsed: number;
    hasNeutralFallback: boolean;
    defensiveMatchupAvailable: boolean;
    teamHistoryAvailable: boolean;
  };
  marketContextScoreClamped: number;
  marketContextScoreRaw: number;
  productionQualified: boolean;
  actualValue: number | null;
  outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
  profitPerUnit: number;
  removedDisqualifiers: string[];
}

export interface MarketContextCalibrationGateSnapshot {
  gateThreshold: number;
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
  byPropType: MarketContextCalibrationBucket[];
  byConfidenceTier: MarketContextCalibrationTierBucket[];
  byEdgeBucket: MarketContextCalibrationEdgeBucket[];
  candidates: MarketContextCalibrationCandidate[];
}

export interface MarketContextCalibrationSnapshot {
  diagnosticOnly: true;
  generatedAt: string;
  productionGate: number;
  production: MarketContextCalibrationGateSnapshot;
  gate040: MarketContextCalibrationGateSnapshot;
  gate035: MarketContextCalibrationGateSnapshot;
  note: string;
}

export interface StoredWeek1MonitorSnapshot {
  /** Where the data came from. `"none"` means neither source
   *  had a stored run; the caller should fall back to fixture
   *  starter-test data. */
  source: "postgres" | "file";
  /** ISO string when the source generated this snapshot. */
  generatedAt?: string;
  /** Always "stored" — fixture sources go through a different
   *  loader. */
  dataMode: "stored";
  /** Status from the candidate builder: READY,
   *  MISSING_STORED_ODDS, MISSING_PROCESSED_NFL,
   *  SCHEDULE_VALIDATION_FAILED, NO_CANDIDATES_AFTER_FILTER. */
  status: string;
  candidateCount: number;
  /** Whether the schedule-validation report passed. PASS / FAIL /
   *  SYNTHETIC_ONLY / unknown. */
  scheduleValidationStatus: string | null;
  /** `true` when status === "READY". */
  realWeek1BacktestReady: boolean;
  /** Always `false` for a stored snapshot — that's the whole
   *  point. Kept as a literal type to make page logic
   *  exhaustive. */
  syntheticFixture: false;
  storedOddsPresent: boolean;
  processedNflPresent: boolean;
  missingStoredOdds: boolean;
  missingProcessedNfl: boolean;
  /** "graded" when the admin grade-week1-stored action has run,
   *  "ungraded" while only pregame candidates exist. */
  gradingStatus: "ungraded" | "graded" | "unavailable";
  /** Populated when gradingStatus === "graded". */
  graded?: GradedSnapshot;
  notes: string[];
}

interface FileShape {
  generatedAt?: string;
  season: number;
  week: number;
  dataMode: "stored" | "fixture";
  status: string;
  candidateCount: number;
  syntheticFixture: boolean;
  realWeek1BacktestReady: boolean;
  missingStoredOdds: boolean;
  missingProcessedNfl: boolean;
  scheduleReport?: { status?: string | null } | null;
  notes?: string[];
}

interface GradedSideShape {
  wins: number;
  losses: number;
  pushes: number;
  graded: number;
  hitRate: number;
  roiPct: number;
  unitsProfit: number;
}

interface GradedMarketBucketShape {
  propType: string;
  total: number;
  decisive: number;
  overSide: GradedSideShape;
  underSide: GradedSideShape;
}

interface GradedLineBucketShape {
  label: string;
  lineLow: number;
  lineHigh: number;
  total: number;
  decisive: number;
  overSide: GradedSideShape;
  underSide: GradedSideShape;
}

interface GradedFileShape {
  gradedAt: string;
  season: number;
  week: number;
  /** Optional individual graded rows (admin grading action
   *  persists up to 100). The page renders them. */
  samples?: GradedSampleRow[];
  /** Same shape, just a different key name used by the DB
   *  resultsJson path. */
  gradedSample?: GradedSampleRow[];
  /** Scorecard audit payload from the admin grading action. */
  scorecardAudit?: ScorecardAuditSnapshot;
  /** Diagnostic-only marketContext gate calibration replay. */
  marketContextCalibration?: MarketContextCalibrationSnapshot;
  /** As-of fairness validation report. */
  asOfReport?: AsOfReportSnapshot;
  summary: {
    gradedAt?: string;
    /** Legacy headline fields — diagnostic only. */
    totalCandidates: number;
    candidatesWithActual: number;
    candidatesMissingActual: number;
    candidatesPushed?: number;
    qualifiedPlays: number;
    betterSide: "OVER" | "UNDER" | "TIE";
    overSide: GradedSideShape;
    underSide: GradedSideShape;
    /** New structured sections (added in the diagnostic-vs-
     *  betting-performance refactor). */
    universeDiagnostics?: {
      totalCandidates: number;
      candidatesWithActual: number;
      candidatesMissingActual: number;
      candidatesPushed: number;
      overSide: GradedSideShape;
      underSide: GradedSideShape;
      betterSide: "OVER" | "UNDER" | "TIE";
      byPropType?: GradedMarketBucketShape[];
      byLineBucket?: GradedLineBucketShape[];
    };
    byPropType?: GradedMarketBucketShape[];
    byLineBucket?: GradedLineBucketShape[];
    recommendedPlays?: {
      enabled: boolean;
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
      byPropType?: Array<{
        propType: string;
        count: number;
        wins: number;
        losses: number;
        pushes: number;
        hitRatePct: number;
        roiPct: number;
        unitsProfit: number;
      }>;
      byConfidenceTier?: Array<{
        tier: "High" | "Medium" | "Low";
        count: number;
        wins: number;
        losses: number;
        pushes: number;
        hitRatePct: number;
        roiPct: number;
        unitsProfit: number;
      }>;
      byEdgeBucket?: Array<{
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
      }>;
    };
    parlayPerformance?: {
      enabled: boolean;
      note: string;
      evaluated: number;
      selected: number;
      rejected: number;
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
      rejectionReasons: Record<string, number>;
    };
    disqualificationBreakdown?: {
      edgeTooThin: number;
      riskGate: number;
      roleStability: number;
      dataQualityGate?: number;
      roleStabilityGate?: number;
      injuryContextGate?: number;
      correlationExposureGate?: number;
      weatherEnvironmentGate?: number;
      gameScriptGate?: number;
      paceGate?: number;
      marketContextGate?: number;
      missingResult: number;
      ungradeable: number;
      other: number;
      totalRejected: number;
    };
  };
}

function readGradedFile(
  season: number,
  week: number,
): GradedFileShape | undefined {
  const p = path.join(
    process.cwd(),
    "data",
    "backtests",
    String(season),
    `week-${week}-graded-summary.fixture.json`,
  );
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as GradedFileShape;
  } catch {
    return undefined;
  }
}

function sideToSnapshot(s: GradedSideShape): GradedSideSnapshot {
  return {
    wins: s.wins,
    losses: s.losses,
    pushes: s.pushes,
    graded: s.graded,
    hitRatePct: s.hitRate * 100,
    roiPct: s.roiPct,
    unitsProfit: s.unitsProfit,
  };
}

function bucketToSnapshot(b: GradedMarketBucketShape): GradedMarketBucket {
  return {
    propType: b.propType,
    total: b.total,
    decisive: b.decisive,
    overSide: sideToSnapshot(b.overSide),
    underSide: sideToSnapshot(b.underSide),
  };
}

function lineBucketToSnapshot(b: GradedLineBucketShape): GradedLineBucket {
  return {
    label: b.label,
    lineLow: b.lineLow,
    lineHigh: b.lineHigh,
    total: b.total,
    decisive: b.decisive,
    overSide: sideToSnapshot(b.overSide),
    underSide: sideToSnapshot(b.underSide),
  };
}

function toGradedSnapshot(g: GradedFileShape | undefined): GradedSnapshot | undefined {
  if (!g) return undefined;
  const s = g.summary;
  // Breakdown buckets may live either inside universeDiagnostics
  // (preferred) or directly on the summary (legacy headline
  // fields). Map both shapes.
  const byPropType = (
    s.universeDiagnostics?.byPropType ?? s.byPropType ?? []
  ).map(bucketToSnapshot);
  const byLineBucket = (
    s.universeDiagnostics?.byLineBucket ?? s.byLineBucket ?? []
  ).map(lineBucketToSnapshot);
  return {
    gradedAt: g.gradedAt,
    universeDiagnostics: s.universeDiagnostics
      ? {
          totalCandidates: s.universeDiagnostics.totalCandidates,
          candidatesWithActual: s.universeDiagnostics.candidatesWithActual,
          candidatesMissingActual: s.universeDiagnostics.candidatesMissingActual,
          candidatesPushed: s.universeDiagnostics.candidatesPushed,
          overSide: sideToSnapshot(s.universeDiagnostics.overSide),
          underSide: sideToSnapshot(s.universeDiagnostics.underSide),
          betterSide: s.universeDiagnostics.betterSide,
          byPropType,
          byLineBucket,
        }
      : {
          totalCandidates: s.totalCandidates,
          candidatesWithActual: s.candidatesWithActual,
          candidatesMissingActual: s.candidatesMissingActual,
          candidatesPushed: s.candidatesPushed ?? 0,
          overSide: sideToSnapshot(s.overSide),
          underSide: sideToSnapshot(s.underSide),
          betterSide: s.betterSide,
          byPropType,
          byLineBucket,
        },
    gradedSample: g.gradedSample ?? g.samples ?? [],
    recommendedPlays: s.recommendedPlays
      ? {
          enabled: s.recommendedPlays.enabled,
          note: s.recommendedPlays.note,
          count: s.recommendedPlays.count,
          wins: s.recommendedPlays.wins,
          losses: s.recommendedPlays.losses,
          pushes: s.recommendedPlays.pushes,
          hitRatePct: s.recommendedPlays.hitRatePct,
          roiPct: s.recommendedPlays.roiPct,
          unitsProfit: s.recommendedPlays.unitsProfit,
          averageEdgePct: s.recommendedPlays.averageEdgePct,
          averageConfidence: s.recommendedPlays.averageConfidence,
          byPropType: (s.recommendedPlays.byPropType ?? []).map((r) => ({
            label: r.propType,
            count: r.count,
            wins: r.wins,
            losses: r.losses,
            pushes: r.pushes,
            hitRatePct: r.hitRatePct,
            roiPct: r.roiPct,
            unitsProfit: r.unitsProfit,
          })),
          byConfidenceTier: (s.recommendedPlays.byConfidenceTier ?? []).map(
            (r) => ({
              label: r.tier,
              count: r.count,
              wins: r.wins,
              losses: r.losses,
              pushes: r.pushes,
              hitRatePct: r.hitRatePct,
              roiPct: r.roiPct,
              unitsProfit: r.unitsProfit,
            }),
          ),
          byEdgeBucket: (s.recommendedPlays.byEdgeBucket ?? []).map((r) => ({
            label: r.label,
            count: r.count,
            wins: r.wins,
            losses: r.losses,
            pushes: r.pushes,
            hitRatePct: r.hitRatePct,
            roiPct: r.roiPct,
            unitsProfit: r.unitsProfit,
          })),
        }
      : {
          enabled: false,
          note: "Recommended-plays section not present in this graded payload.",
          count: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          hitRatePct: 0,
          roiPct: 0,
          unitsProfit: 0,
          averageEdgePct: 0,
          averageConfidence: 0,
          byPropType: [],
          byConfidenceTier: [],
          byEdgeBucket: [],
        },
    parlayPerformance: s.parlayPerformance ?? {
      enabled: false,
      note: "Parlay section not present in this graded payload.",
      evaluated: 0,
      selected: 0,
      rejected: 0,
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
    },
    disqualificationBreakdown: s.disqualificationBreakdown
      ? {
          edgeTooThin: s.disqualificationBreakdown.edgeTooThin,
          riskGate: s.disqualificationBreakdown.riskGate,
          roleStability: s.disqualificationBreakdown.roleStability,
          dataQualityGate: s.disqualificationBreakdown.dataQualityGate,
          roleStabilityGate: s.disqualificationBreakdown.roleStabilityGate,
          injuryContextGate: s.disqualificationBreakdown.injuryContextGate,
          correlationExposureGate:
            s.disqualificationBreakdown.correlationExposureGate,
          weatherEnvironmentGate:
            s.disqualificationBreakdown.weatherEnvironmentGate,
          gameScriptGate: s.disqualificationBreakdown.gameScriptGate,
          paceGate: s.disqualificationBreakdown.paceGate,
          marketContextGate: s.disqualificationBreakdown.marketContextGate,
          missingResult: s.disqualificationBreakdown.missingResult,
          ungradeable: s.disqualificationBreakdown.ungradeable,
          other: s.disqualificationBreakdown.other,
          totalRejected: s.disqualificationBreakdown.totalRejected,
        }
      : {
          edgeTooThin: 0,
          riskGate: 0,
          roleStability: 0,
          missingResult: s.candidatesMissingActual,
          ungradeable: s.candidatesPushed ?? 0,
          other: 0,
          totalRejected: s.candidatesMissingActual + (s.candidatesPushed ?? 0),
        },
    scorecardAudit: g.scorecardAudit,
    marketContextCalibration: g.marketContextCalibration,
    asOfReport: g.asOfReport,
  };
}

function readFile(season: number, week: number): FileShape | undefined {
  const p = path.join(
    process.cwd(),
    "data",
    "backtests",
    String(season),
    `week-${week}-data-mode-status.fixture.json`,
  );
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as FileShape;
  } catch {
    return undefined;
  }
}

/**
 * Load the latest stored Week-1 snapshot. Returns `undefined`
 * when neither Postgres nor the file mirror has a stored run,
 * letting the caller fall back to fixture starter-test data.
 */
export async function loadStoredWeek1MonitorSnapshot(args: {
  season: number;
  week: number;
  /** Inject a persistence client for tests. */
  client?: PersistenceClient;
}): Promise<StoredWeek1MonitorSnapshot | undefined> {
  const client = args.client ?? (await getPersistenceClient());
  if (client.isAvailable()) {
    const dbRun = await client.loadLatestStoredBacktestRunFromDb({
      season: args.season,
      week: args.week,
    });
    if (dbRun.ok && dbRun.run) {
      const run = dbRun.run;
      const candidatesJson = run.candidatesJson as
        | { candidates?: unknown[] }
        | null
        | undefined;
      const candidateCount = Array.isArray(candidatesJson?.candidates)
        ? candidatesJson.candidates.length
        : 0;
      const status = String(run.status);
      const ready = run.realWeek1BacktestReady === true;
      const missingStoredOdds = status === "MISSING_STORED_ODDS";
      const missingProcessedNfl = status === "MISSING_PROCESSED_NFL";
      // Graded summary lives in resultsJson when the
      // grade-week1-stored action has run. Fall back to the
      // file mirror so a redeploy that wipes only one source
      // still finds the data.
      const resultsJson = run.resultsJson as
        | {
            summary?: GradedFileShape["summary"];
            gradedSample?: GradedSampleRow[];
            scorecardAudit?: ScorecardAuditSnapshot;
            marketContextCalibration?: MarketContextCalibrationSnapshot;
            asOfReport?: AsOfReportSnapshot;
          }
        | null
        | undefined;
      const dbGraded = resultsJson?.summary
        ? toGradedSnapshot({
            gradedAt: new Date().toISOString(),
            season: args.season,
            week: args.week,
            summary: resultsJson.summary,
            gradedSample: resultsJson.gradedSample,
            scorecardAudit: resultsJson.scorecardAudit,
            marketContextCalibration: resultsJson.marketContextCalibration,
            asOfReport: resultsJson.asOfReport,
          })
        : undefined;
      const fileGraded = toGradedSnapshot(
        readGradedFile(args.season, args.week),
      );
      const graded = dbGraded ?? fileGraded;
      return {
        source: "postgres",
        dataMode: "stored",
        status,
        candidateCount,
        scheduleValidationStatus: run.scheduleValidationStatus ?? null,
        realWeek1BacktestReady: ready,
        syntheticFixture: false,
        storedOddsPresent: !missingStoredOdds,
        processedNflPresent: !missingProcessedNfl,
        missingStoredOdds,
        missingProcessedNfl,
        gradingStatus: graded ? "graded" : "ungraded",
        graded,
        notes: [],
      };
    }
  }
  const file = readFile(args.season, args.week);
  if (file && file.dataMode === "stored") {
    const graded = toGradedSnapshot(readGradedFile(args.season, args.week));
    return {
      source: "file",
      generatedAt: file.generatedAt,
      dataMode: "stored",
      status: file.status,
      candidateCount: file.candidateCount,
      scheduleValidationStatus: file.scheduleReport?.status ?? null,
      realWeek1BacktestReady: file.realWeek1BacktestReady,
      syntheticFixture: false,
      storedOddsPresent: !file.missingStoredOdds,
      processedNflPresent: !file.missingProcessedNfl,
      missingStoredOdds: file.missingStoredOdds,
      missingProcessedNfl: file.missingProcessedNfl,
      gradingStatus: graded ? "graded" : "ungraded",
      graded,
      notes: file.notes ?? [],
    };
  }
  return undefined;
}

// =====================================================================
// Multi-week season loaders + aggregator
// =====================================================================

/**
 * Snapshot of one stored backtest row, attached to its
 * (season, week) coordinate. Used by the monitor's
 * "all stored weeks" rollup.
 */
export interface StoredWeekSnapshot extends StoredWeek1MonitorSnapshot {
  season: number;
  week: number;
}

/**
 * Aggregate a list of per-week snapshots into season-level
 * totals. Pure function — does not mutate the inputs.
 *
 * Universe diagnostic numbers (totalCandidates, with-actual,
 * OVER / UNDER hit) sum across weeks. Recommended-plays
 * numbers (the model's actual bet count, hits, ROI, units)
 * sum the same way. Calibration replays (production /
 * gate040 / gate035) sum their respective qualified counts
 * and units profit across weeks; hit / ROI are recomputed
 * from the summed wins/losses so the rollup math matches
 * what users see per-week.
 */
export interface StoredSeasonAggregate {
  weeks: number[];
  weekCount: number;
  weeksGraded: number;
  totalCandidates: number;
  totalCandidatesWithActual: number;
  /** Universe rollup — diagnostic only. */
  universe: {
    overWins: number;
    overLosses: number;
    underWins: number;
    underLosses: number;
    pushes: number;
    overHitRatePct: number;
    underHitRatePct: number;
  };
  /** Recommended-plays rollup — the model's actual betting
   *  performance across stored weeks (production gate). */
  recommendedPlays: {
    enabled: boolean;
    count: number;
    wins: number;
    losses: number;
    pushes: number;
    hitRatePct: number;
    roiPct: number;
    unitsProfit: number;
    averageEdgePct: number;
    averageConfidence: number;
  };
  /** Per-gate calibration rollup across all stored weeks. */
  calibration: {
    available: boolean;
    productionGate: number;
    production: SeasonGateRollup;
    gate040: SeasonGateRollup;
    gate035: SeasonGateRollup;
  };
}

export interface SeasonGateRollup {
  gateThreshold: number;
  isProduction: boolean;
  weekCount: number;
  qualifiedCount: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
}

const SEASON_WEEK_RANGE = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
];

/**
 * Load every stored week's snapshot for `season`. When the
 * persistence layer is available, a single bulk DB fetch
 * returns the latest `StoredBacktestRun` per (season, week)
 * across the whole season — no week list cap, future weeks
 * appear automatically. When DB is unavailable, falls back to
 * iterating per-week file mirrors so the local sandbox still
 * works.
 *
 * `args.weeks` filters the result; default returns every week
 * the data layer has rows for.
 */
export async function loadAllStoredMonitorSnapshots(args: {
  season: number;
  client?: PersistenceClient;
  weeks?: number[];
}): Promise<StoredWeekSnapshot[]> {
  const client = args.client ?? (await getPersistenceClient());

  if (client.isAvailable()) {
    // Bulk fetch — one query for the whole season.
    const all = await client.loadAllStoredBacktestRunsFromDb({
      season: args.season,
    });
    if (all.ok && all.runs && all.runs.length > 0) {
      const filter = args.weeks ? new Set(args.weeks) : undefined;
      const results: StoredWeekSnapshot[] = [];
      for (const run of all.runs) {
        if (filter && !filter.has(run.week)) continue;
        // Re-use the per-week loader so the DB row → snapshot
        // mapping (graded payload, asOfReport, calibration,
        // breakdowns) stays in one place. This is a second
        // DB roundtrip per week but it's bounded by the
        // number of stored weeks, not by SEASON_WEEK_RANGE.
        const snap = await loadStoredWeek1MonitorSnapshot({
          season: args.season,
          week: run.week,
          client,
        });
        if (snap) {
          results.push({ ...snap, season: args.season, week: run.week });
        }
      }
      // Always include any weeks the caller explicitly asked
      // for that the DB didn't have a row for — they'll fall
      // through to the file mirror below in the next iteration
      // when DB is missing. But when DB returned rows, we
      // trust the DB list and skip the file scan to avoid
      // duplicates.
      results.sort((a, b) => a.week - b.week);
      return results;
    }
  }

  // No DB available, or DB returned zero rows — fall back to a
  // per-week scan. Limited to the explicit `weeks` list (or
  // SEASON_WEEK_RANGE) so we don't read 18 files unnecessarily.
  const weeks = args.weeks ?? SEASON_WEEK_RANGE;
  const results: StoredWeekSnapshot[] = [];
  for (const week of weeks) {
    const snap = await loadStoredWeek1MonitorSnapshot({
      season: args.season,
      week,
      client,
    });
    if (snap) {
      results.push({ ...snap, season: args.season, week });
    }
  }
  return results;
}

function emptyGateRollup(
  gate: number,
  isProduction: boolean,
): SeasonGateRollup {
  return {
    gateThreshold: gate,
    isProduction,
    weekCount: 0,
    qualifiedCount: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    hitRatePct: 0,
    roiPct: 0,
    unitsProfit: 0,
  };
}

function addGateRollup(
  agg: SeasonGateRollup,
  gate: NonNullable<
    StoredWeek1MonitorSnapshot["graded"]
  >["marketContextCalibration"] extends infer T
    ? T extends { production: infer P }
      ? P
      : never
    : never,
): void {
  if (!gate) return;
  agg.weekCount += 1;
  agg.qualifiedCount += gate.qualifiedCount;
  agg.wins += gate.wins;
  agg.losses += gate.losses;
  agg.pushes += gate.pushes;
  agg.unitsProfit += gate.unitsProfit;
}

function finalizeGateRollup(agg: SeasonGateRollup): SeasonGateRollup {
  const decisive = agg.wins + agg.losses;
  const graded = agg.wins + agg.losses + agg.pushes;
  agg.hitRatePct = decisive > 0 ? (agg.wins / decisive) * 100 : 0;
  agg.roiPct = graded > 0 ? (agg.unitsProfit / graded) * 100 : 0;
  return agg;
}

export function aggregateStoredSeason(
  snapshots: readonly StoredWeekSnapshot[],
): StoredSeasonAggregate {
  const weeks = snapshots.map((s) => s.week);
  let totalCandidates = 0;
  let totalCandidatesWithActual = 0;
  let universeOverWins = 0;
  let universeOverLosses = 0;
  let universeUnderWins = 0;
  let universeUnderLosses = 0;
  let universePushes = 0;
  let weeksGraded = 0;

  let recPlaysEnabled = false;
  let recPlaysCount = 0;
  let recPlaysWins = 0;
  let recPlaysLosses = 0;
  let recPlaysPushes = 0;
  let recPlaysUnitsProfit = 0;
  let recPlaysEdgeSum = 0;
  let recPlaysConfSum = 0;
  let recPlaysWeighted = 0;

  let calibrationAvailable = false;
  const aggProd = emptyGateRollup(0.45, true);
  const aggG040 = emptyGateRollup(0.4, false);
  const aggG035 = emptyGateRollup(0.35, false);

  for (const s of snapshots) {
    totalCandidates += s.candidateCount;
    const g = s.graded;
    if (!g) continue;
    weeksGraded += 1;
    const u = g.universeDiagnostics;
    totalCandidatesWithActual += u.candidatesWithActual;
    universeOverWins += u.overSide.wins;
    universeOverLosses += u.overSide.losses;
    universeUnderWins += u.underSide.wins;
    universeUnderLosses += u.underSide.losses;
    universePushes += u.candidatesPushed;

    if (g.recommendedPlays.enabled) {
      recPlaysEnabled = true;
      const r = g.recommendedPlays;
      recPlaysCount += r.count;
      recPlaysWins += r.wins;
      recPlaysLosses += r.losses;
      recPlaysPushes += r.pushes;
      recPlaysUnitsProfit += r.unitsProfit;
      recPlaysEdgeSum += r.averageEdgePct * r.count;
      recPlaysConfSum += r.averageConfidence * r.count;
      recPlaysWeighted += r.count;
    }

    if (g.marketContextCalibration) {
      calibrationAvailable = true;
      addGateRollup(aggProd, g.marketContextCalibration.production);
      addGateRollup(aggG040, g.marketContextCalibration.gate040);
      addGateRollup(aggG035, g.marketContextCalibration.gate035);
    }
  }
  finalizeGateRollup(aggProd);
  finalizeGateRollup(aggG040);
  finalizeGateRollup(aggG035);

  const recPlaysDecisive = recPlaysWins + recPlaysLosses;
  const recPlaysGraded = recPlaysWins + recPlaysLosses + recPlaysPushes;
  const universeOverDecisive = universeOverWins + universeOverLosses;
  const universeUnderDecisive = universeUnderWins + universeUnderLosses;

  return {
    weeks,
    weekCount: snapshots.length,
    weeksGraded,
    totalCandidates,
    totalCandidatesWithActual,
    universe: {
      overWins: universeOverWins,
      overLosses: universeOverLosses,
      underWins: universeUnderWins,
      underLosses: universeUnderLosses,
      pushes: universePushes,
      overHitRatePct:
        universeOverDecisive > 0
          ? (universeOverWins / universeOverDecisive) * 100
          : 0,
      underHitRatePct:
        universeUnderDecisive > 0
          ? (universeUnderWins / universeUnderDecisive) * 100
          : 0,
    },
    recommendedPlays: {
      enabled: recPlaysEnabled,
      count: recPlaysCount,
      wins: recPlaysWins,
      losses: recPlaysLosses,
      pushes: recPlaysPushes,
      hitRatePct:
        recPlaysDecisive > 0
          ? (recPlaysWins / recPlaysDecisive) * 100
          : 0,
      roiPct:
        recPlaysGraded > 0
          ? (recPlaysUnitsProfit / recPlaysGraded) * 100
          : 0,
      unitsProfit: recPlaysUnitsProfit,
      averageEdgePct:
        recPlaysWeighted > 0 ? recPlaysEdgeSum / recPlaysWeighted : 0,
      averageConfidence:
        recPlaysWeighted > 0 ? recPlaysConfSum / recPlaysWeighted : 0,
    },
    calibration: {
      available: calibrationAvailable,
      productionGate: 0.45,
      production: aggProd,
      gate040: aggG040,
      gate035: aggG035,
    },
  };
}

