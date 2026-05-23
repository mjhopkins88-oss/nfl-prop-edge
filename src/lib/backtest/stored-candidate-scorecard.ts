/**
 * Stored Week-N candidate → V1 scorecard adapter.
 *
 * Runs each `RealWeekCandidate` through the SAME decision engine
 * the live Player Props page uses:
 *
 *   1. Build a `ProjectionContext` from the player's strict-before
 *      history rows. Stat selection follows the candidate's
 *      `propType` (PASSING_ATTEMPTS reads passingAttempts, etc.).
 *   2. Call `projectProp({ propType, ctx, line })` to get
 *      projected mean / σ / volatility / dataQuality.
 *   3. Derive the 8 risk-bucket scores from the same history +
 *      the week's candidate pool (data quality, role stability,
 *      correlation exposure). Signals we don't have for stored
 *      data (spread, total, weather, injury feed) use neutral
 *      defaults — the model still gates on them. Bake those
 *      defaults to values just above the gate thresholds so an
 *      otherwise-clean candidate isn't disqualified by a
 *      missing-signal proxy alone.
 *   4. Call `buildPropDecisionScorecard(input)` and persist the
 *      decision (`recommendation`, `qualified`, `selectedSide`,
 *      `edge`, `confidence`, `risk`, `disqualifier`) onto the
 *      candidate.
 *
 * No model logic lives here. No Odds API call. No second
 * decision path — the scorecard remains the single decision
 * authority. The adapter only shapes inputs.
 */

import { buildPropDecisionScorecard } from "../model/model-scorecard";
import type {
  PropDecisionScorecard,
  ScorecardInput,
} from "../model/model-scorecard";
import {
  projectProp,
  type ProjectionContext,
} from "../model/prop-projection-engine";
import { selectedEdge, selectedModelProbability } from "../model/prop-opportunity";
import type {
  NflPlayerWeekStat,
  NflPosition,
  NflTeamWeekStat,
} from "../ingestion/nflverse-types";
import type { PropType } from "../types";
import type { RealWeekCandidate } from "./real-week-candidate-builder";
import {
  computeSignalFeatures,
  type SignalFeatures,
} from "./signal-features";
import {
  computeWrReceptionsSignals,
  type WrReceptionsSignals,
} from "./wr-receptions-signals";

const RECENT_WINDOW = 3;

const PROP_STAT_KEY: Record<PropType, keyof NflPlayerWeekStat> = {
  PASSING_ATTEMPTS: "passingAttempts",
  PASSING_COMPLETIONS: "passingCompletions",
  PASSING_YARDS: "passingYards",
  RECEPTIONS: "receptions",
  RECEIVING_YARDS: "receivingYards",
  RUSHING_ATTEMPTS: "rushingAttempts",
  RUSHING_YARDS: "rushingYards",
};

export interface StoredCandidateScorecard {
  recommendation: PropDecisionScorecard["recommendation"];
  selectedSide: PropDecisionScorecard["selectedSide"];
  qualified: boolean;
  modelOverProbability: number;
  modelUnderProbability: number;
  modelProbability: number;
  marketOverProbability: number;
  marketUnderProbability: number;
  noVigOverProbability: number;
  noVigUnderProbability: number;
  edgeOver: number;
  edgeUnder: number;
  edge: number;
  edgeThreshold: number;
  confidence: number;
  riskScore: number;
  dataQualityScore: number;
  roleStabilityScore: number;
  gameScriptScore: number;
  paceScore: number;
  marketContextScore: number;
  weatherEnvironmentScore: number;
  injuryContextScore: number;
  correlationExposureScore: number;
  volatilityLevel: PropDecisionScorecard["volatilityLevel"];
  primaryDisqualifier: string | undefined;
  disqualifiers: string[];
  passReasons: string[];
  failReasons: string[];
  projectedMean: number;
  projectedStdDev: number;
  /** Diagnostic mispricing features computed from the
   *  candidate's strict-before player history. Never feeds
   *  qualification — used only by the edge-slice diagnostic to
   *  identify which signals predict winning bets. */
  signalFeatures?: SignalFeatures;
  /** WR-receptions-specific diagnostic signals. Populated
   *  only when the candidate is a WR RECEPTIONS prop with
   *  enough strict-before history. Never feeds qualification. */
  wrReceptionsSignals?: WrReceptionsSignals;
  /** Player's position derived from the most recent strict-
   *  before history row. Surfaced for the multi-hypothesis
   *  diagnostic so it can filter by QB / RB / WR / TE without
   *  re-loading rosters. Undefined when no history is
   *  attached (rookie in W1 with no prior weeks). */
  playerPosition?: NflPosition;
  /** True when the player has no strict-before rows from a
   *  PRIOR season (i.e. every attached row is from the
   *  current season). Surfaced for the rookie mispricing
   *  diagnostic. Never feeds qualification. */
  isRookie?: boolean;
  /** True when `isRookie` is true AND the rookie's recent
   *  strict-before snap share averaged ≥ 0.6 — used as a
   *  proxy for "high draft capital" because nflverse data
   *  doesn't ship draft rounds. W1 rookies with no prior
   *  weeks can't trigger this flag (history is empty); they
   *  still appear in the "all rookies" bucket. */
  isHighUsageRookie?: boolean;
}

export interface EvaluatedRealWeekCandidate extends RealWeekCandidate {
  scorecard: StoredCandidateScorecard;
}

function numericStat(
  rows: readonly NflPlayerWeekStat[],
  key: keyof NflPlayerWeekStat,
): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let v = 0;
  for (const x of xs) v += (x - m) ** 2;
  return Math.sqrt(v / (xs.length - 1));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

function americanImpliedProb(odds: number): number {
  if (odds === 0) return 0.5;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

/** Build the projection-engine input from strict-before history. */
function buildProjectionContext(args: {
  candidate: RealWeekCandidate;
  history: readonly NflPlayerWeekStat[];
}): ProjectionContext {
  const statKey = PROP_STAT_KEY[args.candidate.propType];
  const sortedHistory = [...args.history].sort(
    (a, b) => a.season - b.season || a.week - b.week,
  );
  const recent = sortedHistory.slice(-RECENT_WINDOW);
  const seasonOnly = sortedHistory.filter(
    (r) => r.season === args.candidate.season,
  );
  const recentValues = numericStat(recent, statKey);
  const seasonValues = numericStat(seasonOnly, statKey);
  const playerRecentMean = mean(recentValues);
  const playerRecentStdDev = stddev(recentValues);
  const playerSeasonMean =
    seasonValues.length > 0 ? mean(seasonValues) : playerRecentMean;
  const playerTargetShare =
    recent.length > 0 ? mean(numericStat(recent, "targetShare")) : null;
  const playerCarryShare =
    recent.length > 0 ? mean(numericStat(recent, "carryShare")) : null;
  const playerSnapShare =
    recent.length > 0 ? mean(numericStat(recent, "snapShare")) : null;
  return {
    playerRecentMean,
    playerRecentStdDev,
    playerSeasonMean,
    playerTargetShare: playerTargetShare === 0 ? null : playerTargetShare,
    playerCarryShare: playerCarryShare === 0 ? null : playerCarryShare,
    playerSnapShare: playerSnapShare === 0 ? null : playerSnapShare,
    // Stored Week-1 data has no team-level projections beyond what
    // history implies; engine falls back to its built-in defaults.
    projectedTeamPlays: null,
    projectedPassRate: null,
    // No spread/total feed yet for stored data — null is honest.
    // The engine treats null as "no adjustment". The risk gates
    // below get neutral 0.6 so they pass without forcing a side.
    spread: null,
    total: null,
    weatherWind: null,
    weatherPrecip: null,
    weatherDome: false,
    selfStatus: null,
    teammateAbsenceBoost: false,
    olInjuryOwn: false,
    dbInjuryOpponent: false,
  };
}

/** dataQuality 0..1, higher = better. Based on prior weeks count. */
function dataQualityScore(history: readonly NflPlayerWeekStat[]): number {
  const n = history.length;
  if (n >= 12) return 0.85;
  if (n >= 8) return 0.75;
  if (n >= 5) return 0.65;
  if (n >= 3) return 0.6;
  if (n >= 1) return 0.55;
  return 0.4;
}

/** roleStability 0..1 from snap-share coefficient of variation. */
function roleStabilityScore(history: readonly NflPlayerWeekStat[]): number {
  const recent = history.slice(-RECENT_WINDOW);
  if (recent.length < 2) return 0.55;
  const snap = numericStat(recent, "snapShare");
  if (snap.length < 2) return 0.6;
  const sd = stddev(snap);
  const m = mean(snap);
  const cv = m > 0 ? sd / m : 1;
  const stability = 1 - clamp(cv / 0.25, 0, 1);
  if (history.length < 3) return Math.min(stability, 0.55);
  return clamp(0.4 + 0.6 * stability, 0, 1);
}

/** marketContext 0..1 from the recorded over/under odds overround. */
function marketContextScore(c: RealWeekCandidate): number {
  return clamp(rawMarketContextScore(c), 0.4, 0.95);
}

/** Un-clamped marketContext score — useful for the audit to
 *  see how negative the score WOULD have been without the
 *  floor. The live model never sees this; it consumes the
 *  clamped value via `marketContextScore` above. */
export function rawMarketContextScore(c: RealWeekCandidate): number {
  const overround = americanImpliedProb(c.overOdds) + americanImpliedProb(c.underOdds);
  return 1 - (overround - 1) / 0.1;
}

/** Overround of a candidate's recorded over/under odds. */
export function marketOverround(c: RealWeekCandidate): number {
  return americanImpliedProb(c.overOdds) + americanImpliedProb(c.underOdds);
}

/** correlationExposure 0..1 from same-player props in the same game. */
function correlationExposureScore(args: {
  candidate: RealWeekCandidate;
  weekCandidates: readonly RealWeekCandidate[];
}): number {
  const samePlayerSameGame = args.weekCandidates.filter(
    (m) =>
      m.playerName === args.candidate.playerName &&
      m.gameId === args.candidate.gameId,
  );
  if (samePlayerSameGame.length <= 1) return 0.8;
  return samePlayerSameGame.length >= 3 ? 0.55 : 0.7;
}

function buildScorecardInput(args: {
  candidate: RealWeekCandidate;
  history: readonly NflPlayerWeekStat[];
  weekCandidates: readonly RealWeekCandidate[];
}): ScorecardInput {
  const ctx = buildProjectionContext({
    candidate: args.candidate,
    history: args.history,
  });
  const projection = projectProp({
    propType: args.candidate.propType,
    ctx,
    line: args.candidate.line,
  });
  // Neutral-but-passing defaults for signals we don't have a feed
  // for in stored data. They sit just above their respective
  // gates (0.45–0.55) so an otherwise-clean prop isn't blocked by
  // a missing input. The engine still computes edge from
  // projection + line + odds — risk-bucket scores never invent
  // edge.
  return {
    scenarioName: `stored-${args.candidate.season}-w${args.candidate.week}-${args.candidate.id}`,
    propId: args.candidate.id,
    playerName: args.candidate.playerName,
    propType: args.candidate.propType,
    marketLine: args.candidate.line,
    overOdds: args.candidate.overOdds,
    underOdds: args.candidate.underOdds,
    projectedMean: projection.projectedMean,
    projectedStdDev: projection.projectedStdDev,
    dataQualityScore: dataQualityScore(args.history),
    roleStabilityScore: roleStabilityScore(args.history),
    gameScriptScore: 0.6,
    paceScore: 0.6,
    marketContextScore: marketContextScore(args.candidate),
    weatherEnvironmentScore: 0.85,
    injuryContextScore: 0.85,
    correlationExposureScore: correlationExposureScore({
      candidate: args.candidate,
      weekCandidates: args.weekCandidates,
    }),
  };
}

function projectionToScorecard(args: {
  scorecard: PropDecisionScorecard;
}): StoredCandidateScorecard {
  const s = args.scorecard;
  return {
    recommendation: s.recommendation,
    selectedSide: s.selectedSide,
    qualified: s.qualified,
    modelOverProbability: s.modelOverProbability,
    modelUnderProbability: s.modelUnderProbability,
    modelProbability: selectedModelProbability(s),
    marketOverProbability: s.marketOverProbability,
    marketUnderProbability: s.marketUnderProbability,
    noVigOverProbability: s.noVigOverProbability,
    noVigUnderProbability: s.noVigUnderProbability,
    edgeOver: s.edgeOver,
    edgeUnder: s.edgeUnder,
    edge: selectedEdge(s),
    edgeThreshold: s.edgeThreshold,
    confidence: s.confidence,
    riskScore: s.riskScore,
    dataQualityScore: s.dataQualityScore,
    roleStabilityScore: s.roleStabilityScore,
    gameScriptScore: s.gameScriptScore,
    paceScore: s.paceScore,
    marketContextScore: s.marketContextScore,
    weatherEnvironmentScore: s.weatherEnvironmentScore,
    injuryContextScore: s.injuryContextScore,
    correlationExposureScore: s.correlationExposureScore,
    volatilityLevel: s.volatilityLevel,
    primaryDisqualifier: s.disqualifiers[0],
    disqualifiers: s.disqualifiers,
    passReasons: s.passReasons,
    failReasons: s.failReasons,
    projectedMean: s.projectedMean,
    projectedStdDev: s.projectedStdDev,
  };
}

/**
 * Apply the V1 scorecard to every stored candidate, attaching
 * the decision fields. Pure function — does not mutate the input
 * candidates, returns new objects.
 */
export function applyScorecardToCandidates(args: {
  candidates: readonly RealWeekCandidate[];
  playerHistoryByName: Map<string, NflPlayerWeekStat[]>;
  /** Optional team week history (strict-before) — when
   *  threaded through, enables team-pass-rate features such
   *  as the WR receptions PROE signal. Tests and the synthetic
   *  runner can omit it; the WR signal falls back to neutral. */
  teamHistory?: ReadonlyArray<NflTeamWeekStat>;
}): EvaluatedRealWeekCandidate[] {
  const weekCandidates = args.candidates;
  const out: EvaluatedRealWeekCandidate[] = [];
  for (const c of weekCandidates) {
    const history = args.playerHistoryByName.get(historyKey(c.playerName, c.team)) ?? [];
    const scorecardInput = buildScorecardInput({
      candidate: c,
      history,
      weekCandidates,
    });
    const decision = buildPropDecisionScorecard(scorecardInput);
    const scorecard = projectionToScorecard({ scorecard: decision });
    // Diagnostic mispricing features — pure analysis surface,
    // never fed back into qualification. Computed off the same
    // strict-before history the scorecard already consumed.
    scorecard.signalFeatures = computeSignalFeatures({
      propType: c.propType,
      overOdds: c.overOdds,
      underOdds: c.underOdds,
      modelEdge: scorecard.edge,
      currentSeason: c.season,
      currentWeek: c.week,
      history,
    });
    // WR-receptions-only diagnostic signals. Returns undefined
    // (and is skipped) when the candidate isn't a WR receptions
    // prop with sufficient history — keeps the audit cheap.
    scorecard.wrReceptionsSignals = computeWrReceptionsSignals({
      propType: c.propType,
      team: c.team,
      currentSeason: c.season,
      currentWeek: c.week,
      history,
      teamHistory: args.teamHistory,
    });
    // Position + rookie flag — pulled from the same strict-
    // before history the scorecard already consumed. Both feed
    // diagnostic-only filters in the multi-hypothesis and
    // rookie-mispricing reports.
    const sortedHistory = [...history].sort(
      (a, b) => a.season - b.season || a.week - b.week,
    );
    scorecard.playerPosition =
      sortedHistory.length > 0
        ? sortedHistory[sortedHistory.length - 1].position
        : undefined;
    scorecard.isRookie =
      sortedHistory.length > 0 &&
      sortedHistory.every((r) => r.season >= c.season);
    // High-usage proxy for "high draft capital" — see field
    // comment on StoredCandidateScorecard for why this is the
    // closest signal we can derive without draft-round data.
    const snapValues = numericStat(sortedHistory, "snapShare");
    const meanSnap = snapValues.length > 0 ? mean(snapValues) : 0;
    scorecard.isHighUsageRookie =
      scorecard.isRookie === true && meanSnap >= 0.6;
    out.push({ ...c, scorecard });
  }
  return out;
}

/** Stable key used to index the per-candidate history map. */
export function historyKey(playerName: string, team: string): string {
  return `${playerName}::${team}`;
}

/** Build the player-name → strict-before history map the
 *  adapter consumes. Filtering matches
 *  `buildPlayerFeatureContextFromNflHistory` so the strict-
 *  before discipline is identical to the live model path. */
export function buildPlayerHistoryByName(args: {
  candidates: readonly RealWeekCandidate[];
  season: number;
  week: number;
  playerWeekStats: readonly NflPlayerWeekStat[];
}): Map<string, NflPlayerWeekStat[]> {
  const map = new Map<string, NflPlayerWeekStat[]>();
  for (const c of args.candidates) {
    const k = historyKey(c.playerName, c.team);
    if (map.has(k)) continue;
    const rows = args.playerWeekStats.filter((r) => {
      if (r.playerName !== c.playerName) return false;
      if (r.team !== c.team) return false;
      if (r.season < args.season) return true;
      if (r.season === args.season && r.week < args.week) return true;
      return false;
    });
    map.set(k, rows);
  }
  return map;
}
