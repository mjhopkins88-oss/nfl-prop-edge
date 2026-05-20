/**
 * Feature framework — the V2 projection pipeline's input schema.
 *
 * V1's projection engine (`src/lib/backtest/projection-engine.ts`)
 * applies a few specific adjustments inline (recent-vs-season blend,
 * weather, injuries, σ floors). It works, but the inputs are
 * intermixed with the logic and there's no single place to ask
 * "what features are we feeding the model, and how does each one
 * move the projection?"
 *
 * This file is that registry. For lower-variance V1 markets only —
 * passing attempts / completions / yards, receptions, receiving
 * yards, rushing attempts / yards. No TD props.
 *
 * The pattern:
 *
 *   - Every feature group has a typed `*Inputs` interface listing the
 *     raw signals we'd want from upstream data.
 *   - Every group has a `score<Group>(inputs, propType)` placeholder
 *     that returns a `FeatureScore` (neutral by default) plus comments
 *     and TODOs that describe the intended logic and the data source
 *     that will eventually feed it.
 *   - `aggregateFeatureScores` combines multiple group scores into one
 *     consolidated score the projection engine can consume.
 *   - `scoreAll(inputs, propType)` runs every group and returns both
 *     the per-group scores (for transparency) and the aggregate.
 *
 * Adopting this framework is a follow-up to this commit — V1 keeps
 * the inline logic in `projection-engine.ts`. This file is the
 * blueprint that swap will follow.
 */

import type { PropType } from "../types";

// --- common output shape ---------------------------------------------

/**
 * One feature group's contribution to a projection / bet decision.
 *
 *   meanMultiplier      — multiply the projection mean (1.0 = neutral)
 *   sigmaMultiplier     — multiply the projection σ   (1.0 = neutral)
 *   edgeAdjustment      — added to the signed edge AFTER no-vig calc
 *                         (positive favors OVER; 0.0 = neutral)
 *   exposurePenalty     — 0..1 multiplier on bet size or qualification
 *                         (1.0 = no penalty, 0.0 = block entirely)
 *   qualificationBlock  — true forces PASS regardless of edge
 *   notes               — short, human-readable reasons surfaced to
 *                         the UI's reasons / risks panels
 */
export interface FeatureScore {
  meanMultiplier: number;
  sigmaMultiplier: number;
  edgeAdjustment: number;
  exposurePenalty: number;
  qualificationBlock: boolean;
  notes: string[];
}

export const NEUTRAL_FEATURE_SCORE: FeatureScore = {
  meanMultiplier: 1.0,
  sigmaMultiplier: 1.0,
  edgeAdjustment: 0.0,
  exposurePenalty: 1.0,
  qualificationBlock: false,
  notes: [],
};

/** Convenience: build a partial-override FeatureScore. */
export function fs(partial: Partial<FeatureScore>): FeatureScore {
  return { ...NEUTRAL_FEATURE_SCORE, ...partial, notes: partial.notes ?? [] };
}

// =====================================================================
// 1. Role stability
// =====================================================================

/**
 * Role stability — is this player's usage pattern stable enough to
 * trust the rolling-average projection?
 *
 * Lower-variance props are usage-driven. If a WR's target share moved
 * from 22% to 14% over the last 3 weeks, the "season mean" is a
 * misleading prior. Likewise, a sudden snap-share spike (e.g. a
 * teammate hit IR) means the recent mean understates volume.
 *
 * V1 doesn't have any of these fields yet — they live in `snap_counts.csv`
 * (offense_pct), `team_week_stats.csv` (team-level denominators for
 * route / target / carry share), and the manual `injury_flags.csv`.
 */
export interface RoleStabilityInputs {
  /** Trend in offense snap %: +0.05 = up 5 percentage points L4. */
  snapShareTrend: number | null;
  /** Trend in pass-route participation rate on team dropbacks. */
  routeParticipationTrend: number | null;
  /** Trend in target share (player tgts / team pass attempts). */
  targetShareTrend: number | null;
  /** Trend in carry share (player carries / team rush attempts). */
  carryShareTrend: number | null;
  /** True if a higher-usage teammate is returning from absence. */
  teammateReturnPenalty: boolean;
  /** True if a higher-usage teammate is freshly absent. */
  teammateAbsenceBoost: boolean;
}

export const NEUTRAL_ROLE_INPUTS: RoleStabilityInputs = {
  snapShareTrend: null,
  routeParticipationTrend: null,
  targetShareTrend: null,
  carryShareTrend: null,
  teammateReturnPenalty: false,
  teammateAbsenceBoost: false,
};

/**
 * Score role stability.
 *
 * Intended logic:
 *   - Recent target/carry share trend swings ≥ ±5% → bias the blend
 *     toward the recent window (handled in the projection engine) AND
 *     widen σ by ~10%.
 *   - teammateAbsenceBoost: +5–10% on receiving / rushing volume for
 *     the beneficiary.
 *   - teammateReturnPenalty: -5–10% on the player who'd been absorbing
 *     the absent teammate's role.
 *   - All trends null → neutral, sigma floor stays at projection-engine
 *     default (no extra σ widening).
 *
 * TODO: feed from
 *   - snap_counts.csv (offense_pct)         — already a scaffold CSV
 *   - team_week_stats.csv (route / tgt / rush denominators) — planned
 *   - injury_flags.csv (teammate_absence / teammate_return)  — exists
 */
export function scoreRoleStability(
  _inputs: RoleStabilityInputs,
  _propType: PropType,
): FeatureScore {
  // V1 placeholder: neutral.
  return NEUTRAL_FEATURE_SCORE;
}

// =====================================================================
// 2. Game script
// =====================================================================

/**
 * Game script — how the projected flow of the game biases volume.
 *
 * Lower-variance props are heavily script-dependent: a team trailing
 * by 10+ throws ~5 more times per half; a team leading by 14+ rushes
 * ~4 more times. Both shift the volume markets noticeably without
 * touching the player's "true ability".
 *
 * V1 doesn't expose any of these fields to the projection engine.
 * The Odds-API + Kalshi ingestion will populate spread + total; pace
 * and team-level pass/rush rates come from team_week_stats.csv.
 */
export interface GameScriptInputs {
  /** Closing spread for the player's team (negative = favorite). */
  spread: number | null;
  /** Closing total (over/under). */
  total: number | null;
  /** Model's projected team plays (offense). */
  projectedTeamPlays: number | null;
  /** Projected team pass rate (0..1). */
  projectedPassRate: number | null;
  /** Projected team rush rate (0..1). Usually 1 - passRate. */
  projectedRushRate: number | null;
  /** Probability the game becomes a blowout (|margin| ≥ 14). 0..1. */
  blowoutRisk: number | null;
  /** Estimated extra pass attempts from a likely-trailing script. */
  trailingPassVolumeBoost: number | null;
}

export const NEUTRAL_GAMESCRIPT_INPUTS: GameScriptInputs = {
  spread: null,
  total: null,
  projectedTeamPlays: null,
  projectedPassRate: null,
  projectedRushRate: null,
  blowoutRisk: null,
  trailingPassVolumeBoost: null,
};

/**
 * Score game script.
 *
 * Intended logic (per propType):
 *   passing-volume markets (att/comp/yds):
 *     +1% per 1.0 of expected trailing-pass boost
 *     +0.5% per 2.0 above 47 total (more plays, more pass)
 *     blowoutRisk > 0.35 → σ × 1.10 (wide range)
 *   rushing markets (att/yds):
 *     spread ≤ -7 (heavy favorite) → +5% rush volume
 *     spread ≥ +7 (heavy dog)      → -5% rush volume, sigma × 1.05
 *   receiving markets:
 *     scale with team pass-rate-over-expectation
 *
 * TODO: feed from
 *   - games.csv (spread_line, total_line)            — already in scaffold
 *   - prop_markets.csv / prop_quotes.csv (closing)   — when CLV pull lands
 *   - team_week_stats.csv (pass-rate trailing/leading splits) — planned
 */
export function scoreGameScript(
  _inputs: GameScriptInputs,
  _propType: PropType,
): FeatureScore {
  return NEUTRAL_FEATURE_SCORE;
}

// =====================================================================
// 3. Pace
// =====================================================================

/**
 * Pace — how many plays will be run.
 *
 * Volume markets are linear in team plays. A team that runs 70
 * offensive plays vs one that runs 56 is a ~25% mean shift on every
 * count-stat market, holding role and game-script constant.
 *
 * V1 hardcodes `projectedTeamPlays = 64` in the feature builder.
 * Once team_week_stats.csv lands we replace that with this group's
 * `projectedTotalPlays` output.
 */
export interface PaceInputs {
  /** Offensive seconds per play (lower = faster). */
  secondsPerPlay: number | null;
  /** Neutral-script pace (excluding garbage time). */
  neutralPace: number | null;
  /** Opponent plays allowed per game (defense). */
  opponentPlaysAllowed: number | null;
  /** Combined projected team plays. */
  projectedTotalPlays: number | null;
}

export const NEUTRAL_PACE_INPUTS: PaceInputs = {
  secondsPerPlay: null,
  neutralPace: null,
  opponentPlaysAllowed: null,
  projectedTotalPlays: null,
};

/**
 * Score pace.
 *
 * Intended logic:
 *   meanMultiplier = (projectedTotalPlays / league_avg_plays).
 *   Applied to every volume market; sigma stays neutral (pace shifts
 *   are a mean shift, not an uncertainty widening).
 *
 * TODO: feed from
 *   - team_week_stats.csv (plays_offense, seconds_per_play_off,
 *     plays_defense aggregated weekly)               — planned model
 *   - games.csv (total_line)                         — coarser proxy
 */
export function scorePace(
  _inputs: PaceInputs,
  _propType: PropType,
): FeatureScore {
  return NEUTRAL_FEATURE_SCORE;
}

// =====================================================================
// 4. Market context
// =====================================================================

/**
 * Market context — what the books and our peers are signaling.
 *
 * V1's probability engine treats the snapshot line as the truth and
 * computes edge against it. That misses:
 *   - Line movement: if the line opened at 274.5 and is now 268.5, the
 *     market has incorporated information our snapshot doesn't capture.
 *   - Book outliers: if six books say 268.5 and one says 274.5, the
 *     outlier is either stale or a soft book — taking that line is
 *     near-arbitrage.
 *   - Liquidity / spread: a Kalshi market with $200 on each side at
 *     0.05 spread is not the same as one with $50k at 0.01.
 *
 * V1 doesn't read movement or multi-book consensus yet. PropQuote
 * supports it (one row per book), but we only snapshot once per game.
 */
export interface MarketContextInputs {
  /** Earliest line we have for this market. */
  openingLine: number | null;
  /** Latest line we have. */
  currentLine: number | null;
  /** Best (player-relative) line across all sampled books. */
  bestAvailableLine: number | null;
  /** currentLine − openingLine. */
  lineMovement: number | null;
  /** 0..1: how far the focal book is from the consensus (z-score-ish). */
  bookOutlierScore: number | null;
  /** Penalty 0..1 derived from Kalshi inside-spread + depth. */
  liquiditySpreadPenalty: number | null;
}

export const NEUTRAL_MARKET_INPUTS: MarketContextInputs = {
  openingLine: null,
  currentLine: null,
  bestAvailableLine: null,
  lineMovement: null,
  bookOutlierScore: null,
  liquiditySpreadPenalty: null,
};

/**
 * Score market context.
 *
 * Intended logic:
 *   - Big adverse line movement (|move| ≥ 1.5σ on the market's natural
 *     volatility) → +0.005 edgeAdjustment OR sigmaMultiplier 1.1.
 *   - bookOutlierScore ≥ 0.8 with a favorable line for our side →
 *     +0.005 edgeAdjustment.
 *   - liquiditySpreadPenalty > 0.5 → exposurePenalty = 1 − penalty AND
 *     potentially qualificationBlock at penalty > 0.7.
 *
 * TODO: feed from
 *   - prop_quotes.csv with multiple snapshots per market (open + close)
 *   - kalshi_orderbook.csv (depth + inside spread)    — already shipped
 */
export function scoreMarketContext(
  _inputs: MarketContextInputs,
  _propType: PropType,
): FeatureScore {
  return NEUTRAL_FEATURE_SCORE;
}

// =====================================================================
// 5. Weather / environment
// =====================================================================

/**
 * Weather / environment.
 *
 * V1's projection engine already applies basic wind / precip
 * adjustments inline. This interface formalizes the inputs so the
 * eventual swap is a drop-in replacement.
 */
export interface WeatherInputs {
  windSpeed: number | null; // mph
  windGust: number | null; // mph
  temperature: number | null; // °F
  precipitation: number | null; // inches (hourly)
  /** True for dome / closed retractable roof. */
  domeRoofFlag: boolean;
  /** Eligibility decided up-front in `weather.ts`. */
  weatherImpactEligible: boolean;
  /**
   * Forecast confidence — wide bands or rapidly evolving systems
   * should widen σ. 0..1; 0 = fully uncertain, 1 = confident.
   */
  weatherUncertainty: number | null;
}

export const NEUTRAL_WEATHER_INPUTS: WeatherInputs = {
  windSpeed: null,
  windGust: null,
  temperature: null,
  precipitation: null,
  domeRoofFlag: false,
  weatherImpactEligible: false,
  weatherUncertainty: null,
};

/**
 * Score weather. Placeholder mirrors the V1 inline logic at a high
 * level but returns neutral — projection engine still owns the
 * authoritative weather logic until this framework is adopted.
 *
 *   passing/receiving: wind ≥ 20 → mean × 0.90, σ × 1.10
 *                      wind 15–20 → mean × 0.95
 *                      precip ≥ 0.05 → mean × 0.96, σ × 1.05
 *   rushing:           wind ≥ 20 or precip ≥ 0.05 → mean × 1.04
 *   weatherUncertainty < 0.5 → σ × (1 + (1 − uncertainty) × 0.2)
 *
 * TODO: feed from
 *   - weather_snapshots.csv                          — already shipped
 *   - per-game retractable roof state                — TBD (PBP join)
 */
export function scoreWeather(
  _inputs: WeatherInputs,
  _propType: PropType,
): FeatureScore {
  return NEUTRAL_FEATURE_SCORE;
}

// =====================================================================
// 6. Injury / role context
// =====================================================================

/**
 * Injury / role context.
 *
 * V1 already loads manual injury flags via `injuries.ts` and applies
 * them inline in the projection engine. This interface formalizes the
 * numeric inputs so we can replace the boolean / string-based logic
 * with continuous scores once we have a fuller feed.
 */
export interface InjuryContextInputs {
  /** 0..1 — our confidence that the player will perform normally. */
  playerInjuryUncertainty: number | null;
  /** Cumulative boost from teammate absences (0+). */
  teammateInjuryRoleBoost: number | null;
  /** 0..1 — severity of OL injuries on the player's own team. */
  offensiveLineInjuryScore: number | null;
  /** 0..1 — severity of DB injuries on the OPPOSING team. */
  defensiveBackInjuryScore: number | null;
}

export const NEUTRAL_INJURY_INPUTS: InjuryContextInputs = {
  playerInjuryUncertainty: null,
  teammateInjuryRoleBoost: null,
  offensiveLineInjuryScore: null,
  defensiveBackInjuryScore: null,
};

/**
 * Score injuries.
 *
 * Intended logic:
 *   playerInjuryUncertainty ≥ 0.7 → qualificationBlock = true
 *   teammateInjuryRoleBoost > 0   → mean × (1 + boost)
 *   offensiveLineInjuryScore ≥ 0.5 (own team):
 *     passing → mean × 0.97, σ × 1.05
 *     rushing → mean × 0.98
 *   defensiveBackInjuryScore ≥ 0.5 (opposing team):
 *     receiving → mean × 1.05
 *     passing   → mean × 1.03
 *
 * TODO: feed from
 *   - injury_flags.csv → `getPlayerContext()`        — already shipped
 *   - paid injury feed (priority %, snap projections) — future
 */
export function scoreInjuryContext(
  _inputs: InjuryContextInputs,
  _propType: PropType,
): FeatureScore {
  return NEUTRAL_FEATURE_SCORE;
}

// =====================================================================
// 7. Correlation / exposure
// =====================================================================

/**
 * Correlation / exposure.
 *
 * Bankroll / portfolio management, not projection. V1 grades each
 * prop independently and a backtest result of "+30% ROI" can mask
 * dangerous concentration: e.g. five OVERs on QB pass yards + WR
 * receiving yards in the same blowout-risk game.
 *
 * This group never moves the projection — it only adjusts exposure
 * (bet sizing) and qualification at the portfolio level. The
 * projection engine is unaware of it; the bet-sizing layer (not yet
 * built) consumes it.
 */
export interface CorrelationExposureInputs {
  /** Number of bets we already have on this game. */
  sameGameExposure: number;
  /** Number of bets we already have on this team's pass volume. */
  sameTeamPassVolumeExposure: number;
  /** Max bets we'll take on a single game before flagging. */
  maxBetsPerGame: number;
}

export const NEUTRAL_CORRELATION_INPUTS: CorrelationExposureInputs = {
  sameGameExposure: 0,
  sameTeamPassVolumeExposure: 0,
  maxBetsPerGame: 3,
};

/**
 * Score correlation / exposure.
 *
 * Intended logic:
 *   sameGameExposure ≥ maxBetsPerGame   → qualificationBlock = true
 *   sameGameExposure ≥ maxBetsPerGame−1 → exposurePenalty = 0.5
 *   sameTeamPassVolumeExposure ≥ 2 with another pass-volume prop
 *     pending → exposurePenalty *= 0.7 (correlated; reduce stake)
 *
 * TODO: feed from
 *   - BetCandidate rows for the current modelRun / week / game
 *   - propType set comparison (passing markets cluster vs rushing)
 */
export function scoreCorrelationExposure(
  _inputs: CorrelationExposureInputs,
  _propType: PropType,
): FeatureScore {
  return NEUTRAL_FEATURE_SCORE;
}

// =====================================================================
// Aggregation
// =====================================================================

/**
 * Combine N feature scores into one. Mean / σ multipliers compose
 * multiplicatively; edge adjustments compose additively; exposure
 * penalties compose multiplicatively; qualification blocks OR; notes
 * concatenate.
 */
export function aggregateFeatureScores(scores: FeatureScore[]): FeatureScore {
  return scores.reduce<FeatureScore>(
    (acc, s) => ({
      meanMultiplier: acc.meanMultiplier * s.meanMultiplier,
      sigmaMultiplier: acc.sigmaMultiplier * s.sigmaMultiplier,
      edgeAdjustment: acc.edgeAdjustment + s.edgeAdjustment,
      exposurePenalty: acc.exposurePenalty * s.exposurePenalty,
      qualificationBlock: acc.qualificationBlock || s.qualificationBlock,
      notes: [...acc.notes, ...s.notes],
    }),
    { ...NEUTRAL_FEATURE_SCORE, notes: [] },
  );
}

// --- the one-stop input bundle ---------------------------------------

export interface FullFeatureInputs {
  roleStability: RoleStabilityInputs;
  gameScript: GameScriptInputs;
  pace: PaceInputs;
  marketContext: MarketContextInputs;
  weather: WeatherInputs;
  injuryContext: InjuryContextInputs;
  correlationExposure: CorrelationExposureInputs;
}

export const NEUTRAL_FULL_INPUTS: FullFeatureInputs = {
  roleStability: NEUTRAL_ROLE_INPUTS,
  gameScript: NEUTRAL_GAMESCRIPT_INPUTS,
  pace: NEUTRAL_PACE_INPUTS,
  marketContext: NEUTRAL_MARKET_INPUTS,
  weather: NEUTRAL_WEATHER_INPUTS,
  injuryContext: NEUTRAL_INJURY_INPUTS,
  correlationExposure: NEUTRAL_CORRELATION_INPUTS,
};

export interface FullFeatureScores {
  groups: {
    roleStability: FeatureScore;
    gameScript: FeatureScore;
    pace: FeatureScore;
    marketContext: FeatureScore;
    weather: FeatureScore;
    injuryContext: FeatureScore;
    correlationExposure: FeatureScore;
  };
  aggregate: FeatureScore;
}

/**
 * Run every feature group's scorer and return both the per-group
 * scores (for transparency in the UI's reasons/risks panels) and the
 * aggregated score the projection / bet-sizing layer applies.
 *
 * V1 placeholder: every group returns neutral, so the aggregate is
 * also neutral. As each group's scorer is filled in, the projection
 * engine adopts this framework one group at a time without changing
 * the call site.
 */
export function scoreAll(
  inputs: FullFeatureInputs,
  propType: PropType,
): FullFeatureScores {
  const groups = {
    roleStability: scoreRoleStability(inputs.roleStability, propType),
    gameScript: scoreGameScript(inputs.gameScript, propType),
    pace: scorePace(inputs.pace, propType),
    marketContext: scoreMarketContext(inputs.marketContext, propType),
    weather: scoreWeather(inputs.weather, propType),
    injuryContext: scoreInjuryContext(inputs.injuryContext, propType),
    correlationExposure: scoreCorrelationExposure(
      inputs.correlationExposure,
      propType,
    ),
  };
  const aggregate = aggregateFeatureScores(Object.values(groups));
  return { groups, aggregate };
}
