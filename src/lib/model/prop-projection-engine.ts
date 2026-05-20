/**
 * Prop projection engine — turns a `ProjectionContext` into a typed
 * `PropProjectionOutput` (mean, σ, over/under probability, volatility
 * level, reasons, risks, data-quality, risk score) for any V1 prop
 * type.
 *
 * The math is intentionally simple — the goal of this file is *the
 * structure*, not the perfect model. Each prop type has its own
 * baseline formula, then a single generic `applyPropSpecificAdjustments`
 * step handles game-script / weather / injury / opponent factors.
 *
 * Pipeline:
 *
 *   ProjectionContext
 *        │
 *        ▼
 *   project<PropType>(ctx)        ── per-prop baseline (mean + σ_base)
 *        │
 *        ▼
 *   applyPropSpecificAdjustments  ── generic +/- factors
 *        │
 *        ▼
 *   estimateVolatilityByPropType  ── σ multiplier
 *        │
 *        ▼
 *   convertProjectionToProbability ── normal CDF over (mean, σ)
 *        │
 *        ▼
 *   PropProjectionOutput
 *
 * `projectProp({ propType, ctx, line })` is the single entry point; it
 * dispatches to the right `project*` function and runs the rest.
 *
 * The engine consumes only data passed in via `ProjectionContext` — no
 * file or network IO. The mock examples at the bottom of the file
 * exercise every prop type so we know the wiring works.
 */

import type { PropType } from "../types";
import {
  PROP_PROJECTION_RULES,
  type VolatilityLevel,
} from "./prop-projection-rules";

// =====================================================================
// Inputs / outputs
// =====================================================================

/**
 * Everything the engine consumes. Optional fields can be `null`/false
 * when we don't have the signal — the engine falls back to the player's
 * recent mean and skips the corresponding adjustments.
 */
export interface ProjectionContext {
  // --- player baselines (required) ---------------------------------
  /** Recent N-game mean of the stat we're projecting. */
  playerRecentMean: number;
  /** Recent N-game stddev of the stat we're projecting. */
  playerRecentStdDev: number;
  /** Season-to-date mean of the stat. */
  playerSeasonMean: number;

  // --- volume priors (optional) ------------------------------------
  /** 0..1 — used by receptions / receiving yards. */
  playerTargetShare: number | null;
  /** 0..1 — used by rushing attempts / yards. */
  playerCarryShare: number | null;
  /** 0..1 — used as a sanity check on the role. */
  playerSnapShare: number | null;

  // --- team-level projections (optional) ---------------------------
  projectedTeamPlays: number | null;
  projectedPassRate: number | null;

  // --- game-script context (optional) ------------------------------
  /** Negative = team favored, positive = team is a dog. */
  spread: number | null;
  total: number | null;

  // --- weather context (optional) ----------------------------------
  weatherWind: number | null;
  weatherPrecip: number | null;
  weatherDome: boolean;

  // --- injury context (optional) -----------------------------------
  selfStatus: "out" | "doubtful" | "questionable" | "active" | null;
  teammateAbsenceBoost: boolean;
  olInjuryOwn: boolean;
  dbInjuryOpponent: boolean;
}

export interface PropProjectionOutput {
  projectedMean: number;
  projectedStdDev: number;
  modelOverProbability: number;
  modelUnderProbability: number;
  volatilityLevel: VolatilityLevel;
  reasons: string[];
  risks: string[];
  /** 0..100 — how many optional inputs were populated. */
  dataQualityScore: number;
  /** 0..100 — higher = more risk (negative adjustments + volatility). */
  riskScore: number;
}

/** Intermediate shape used between the baseline and adjustment stages. */
interface RawProjection {
  mean: number;
  stddevBase: number;
  reasons: string[];
  risks: string[];
  positiveCount: number;
  negativeCount: number;
}

// =====================================================================
// Constants — kept as named numbers so reviewers can tune them
// =====================================================================

const DEFAULT_COMPLETION_RATE = 0.65;
const DEFAULT_YARDS_PER_COMPLETION = 11.0;
const DEFAULT_CATCH_RATE = 0.65;
const DEFAULT_YARDS_PER_RECEPTION = 12.0;
const DEFAULT_YARDS_PER_CARRY = 4.3;
const DEFAULT_PASS_RATE = 0.58;
const DEFAULT_TEAM_PLAYS = 64;
const PASSING_TYPES = new Set<PropType>([
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
]);
const RECEIVING_TYPES = new Set<PropType>(["RECEPTIONS", "RECEIVING_YARDS"]);
const RUSHING_TYPES = new Set<PropType>([
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
]);

// =====================================================================
// Per-prop-type projection functions
// =====================================================================

function baseSigma(ctx: ProjectionContext, mean: number): number {
  if (ctx.playerRecentStdDev > 0) return ctx.playerRecentStdDev;
  // Fallback: 15% of mean. Loose, but keeps σ > 0 when sample is tiny.
  return Math.max(0.5, Math.abs(mean) * 0.15);
}

export function projectPassingAttempts(ctx: ProjectionContext): RawProjection {
  const reasons: string[] = [];
  let mean: number;
  if (ctx.projectedTeamPlays != null && ctx.projectedPassRate != null) {
    mean = ctx.projectedTeamPlays * ctx.projectedPassRate;
    reasons.push(
      `Team-derived baseline: ${ctx.projectedTeamPlays.toFixed(0)} plays × ${(ctx.projectedPassRate * 100).toFixed(0)}% pass rate = ${mean.toFixed(1)}`,
    );
  } else {
    mean = ctx.playerRecentMean;
    reasons.push(
      `Recent-mean fallback: ${ctx.playerRecentMean.toFixed(1)} attempts`,
    );
  }
  return {
    mean,
    stddevBase: baseSigma(ctx, mean),
    reasons,
    risks: [],
    positiveCount: 0,
    negativeCount: 0,
  };
}

export function projectPassingCompletions(
  ctx: ProjectionContext,
): RawProjection {
  const reasons: string[] = [];
  let mean: number;
  // Composite formula only when we have team-level inputs. Otherwise
  // playerRecentMean is already the completions count — don't multiply.
  if (ctx.projectedTeamPlays != null && ctx.projectedPassRate != null) {
    const attempts = ctx.projectedTeamPlays * ctx.projectedPassRate;
    mean = attempts * DEFAULT_COMPLETION_RATE;
    reasons.push(
      `Attempts ${attempts.toFixed(0)} × ${(DEFAULT_COMPLETION_RATE * 100).toFixed(0)}% completion rate = ${mean.toFixed(1)}`,
    );
  } else {
    mean = ctx.playerRecentMean;
    reasons.push(
      `Recent-mean fallback: ${mean.toFixed(1)} completions`,
    );
  }
  return {
    mean,
    stddevBase: baseSigma(ctx, mean),
    reasons,
    risks: [],
    positiveCount: 0,
    negativeCount: 0,
  };
}

export function projectPassingYards(ctx: ProjectionContext): RawProjection {
  const reasons: string[] = [];
  let mean: number;
  if (ctx.projectedTeamPlays != null && ctx.projectedPassRate != null) {
    const completions =
      ctx.projectedTeamPlays * ctx.projectedPassRate * DEFAULT_COMPLETION_RATE;
    mean = completions * DEFAULT_YARDS_PER_COMPLETION;
    reasons.push(
      `Completions ${completions.toFixed(0)} × ${DEFAULT_YARDS_PER_COMPLETION.toFixed(1)} yards/completion = ${mean.toFixed(1)}`,
    );
  } else {
    mean = ctx.playerRecentMean;
    reasons.push(`Recent-mean fallback: ${mean.toFixed(1)} passing yards`);
  }
  return {
    mean,
    stddevBase: baseSigma(ctx, mean),
    reasons,
    risks: [],
    positiveCount: 0,
    negativeCount: 0,
  };
}

export function projectReceptions(ctx: ProjectionContext): RawProjection {
  const reasons: string[] = [];
  let mean: number;
  if (
    ctx.playerTargetShare != null &&
    ctx.projectedTeamPlays != null &&
    ctx.projectedPassRate != null
  ) {
    const teamPassAtt = ctx.projectedTeamPlays * ctx.projectedPassRate;
    mean = teamPassAtt * ctx.playerTargetShare * DEFAULT_CATCH_RATE;
    reasons.push(
      `Team pass att ${teamPassAtt.toFixed(0)} × target share ${(ctx.playerTargetShare * 100).toFixed(0)}% × catch rate ${(DEFAULT_CATCH_RATE * 100).toFixed(0)}% = ${mean.toFixed(1)}`,
    );
  } else {
    mean = ctx.playerRecentMean;
    reasons.push(
      `Recent-mean fallback: ${ctx.playerRecentMean.toFixed(1)} receptions`,
    );
  }
  return {
    mean,
    stddevBase: baseSigma(ctx, mean),
    reasons,
    risks: [],
    positiveCount: 0,
    negativeCount: 0,
  };
}

export function projectReceivingYards(ctx: ProjectionContext): RawProjection {
  const reasons: string[] = [];
  let mean: number;
  if (
    ctx.playerTargetShare != null &&
    ctx.projectedTeamPlays != null &&
    ctx.projectedPassRate != null
  ) {
    const teamPassAtt = ctx.projectedTeamPlays * ctx.projectedPassRate;
    const receptions = teamPassAtt * ctx.playerTargetShare * DEFAULT_CATCH_RATE;
    mean = receptions * DEFAULT_YARDS_PER_RECEPTION;
    reasons.push(
      `Receptions ${receptions.toFixed(1)} × ${DEFAULT_YARDS_PER_RECEPTION.toFixed(1)} yards/reception = ${mean.toFixed(1)}`,
    );
  } else {
    mean = ctx.playerRecentMean;
    reasons.push(`Recent-mean fallback: ${mean.toFixed(1)} receiving yards`);
  }
  return {
    mean,
    stddevBase: baseSigma(ctx, mean),
    reasons,
    risks: [],
    positiveCount: 0,
    negativeCount: 0,
  };
}

export function projectRushingAttempts(ctx: ProjectionContext): RawProjection {
  const reasons: string[] = [];
  let mean: number;
  if (
    ctx.playerCarryShare != null &&
    ctx.projectedTeamPlays != null &&
    ctx.projectedPassRate != null
  ) {
    const teamRushAtt =
      ctx.projectedTeamPlays * (1 - ctx.projectedPassRate);
    mean = teamRushAtt * ctx.playerCarryShare;
    reasons.push(
      `Team rush att ${teamRushAtt.toFixed(0)} × carry share ${(ctx.playerCarryShare * 100).toFixed(0)}% = ${mean.toFixed(1)}`,
    );
  } else {
    mean = ctx.playerRecentMean;
    reasons.push(
      `Recent-mean fallback: ${ctx.playerRecentMean.toFixed(1)} carries`,
    );
  }
  return {
    mean,
    stddevBase: baseSigma(ctx, mean),
    reasons,
    risks: [],
    positiveCount: 0,
    negativeCount: 0,
  };
}

export function projectRushingYards(ctx: ProjectionContext): RawProjection {
  const reasons: string[] = [];
  let mean: number;
  if (
    ctx.playerCarryShare != null &&
    ctx.projectedTeamPlays != null &&
    ctx.projectedPassRate != null
  ) {
    const teamRushAtt =
      ctx.projectedTeamPlays * (1 - ctx.projectedPassRate);
    const carries = teamRushAtt * ctx.playerCarryShare;
    mean = carries * DEFAULT_YARDS_PER_CARRY;
    reasons.push(
      `Carries ${carries.toFixed(1)} × ${DEFAULT_YARDS_PER_CARRY.toFixed(1)} yards/carry = ${mean.toFixed(1)}`,
    );
  } else {
    mean = ctx.playerRecentMean;
    reasons.push(`Recent-mean fallback: ${mean.toFixed(1)} rushing yards`);
  }
  return {
    mean,
    stddevBase: baseSigma(ctx, mean),
    reasons,
    risks: [],
    positiveCount: 0,
    negativeCount: 0,
  };
}

const PROJECTION_FN_BY_PROP: Record<
  PropType,
  (ctx: ProjectionContext) => RawProjection
> = {
  PASSING_ATTEMPTS: projectPassingAttempts,
  PASSING_COMPLETIONS: projectPassingCompletions,
  PASSING_YARDS: projectPassingYards,
  RECEPTIONS: projectReceptions,
  RECEIVING_YARDS: projectReceivingYards,
  RUSHING_ATTEMPTS: projectRushingAttempts,
  RUSHING_YARDS: projectRushingYards,
};

// =====================================================================
// Generic adjustments (game script / weather / injuries / opponent)
// =====================================================================

/**
 * Apply the +/- factors listed in `prop-projection-rules.ts` to a raw
 * projection. Each adjustment is a single multiplicative tweak — the
 * structure matters more than the magnitude in V1.
 */
export function applyPropSpecificAdjustments(
  propType: PropType,
  raw: RawProjection,
  ctx: ProjectionContext,
): RawProjection {
  let mean = raw.mean;
  let stddev = raw.stddevBase;
  const reasons = [...raw.reasons];
  const risks = [...raw.risks];
  let positive = raw.positiveCount;
  let negative = raw.negativeCount;

  const isPassing = PASSING_TYPES.has(propType);
  const isReceiving = RECEIVING_TYPES.has(propType);
  const isRushing = RUSHING_TYPES.has(propType);

  // --- Game script -------------------------------------------------
  if (ctx.spread != null) {
    if ((isPassing || isReceiving) && ctx.spread >= 5) {
      mean *= 1.05;
      reasons.push("Team dog (spread ≥ +5) → trailing-pass volume +5%");
      positive++;
    }
    if ((isPassing || isReceiving) && ctx.spread <= -7) {
      // Symmetric to the rushing-dog penalty below: a heavy favorite
      // tends to run more in the second half, capping passing volume.
      mean *= 0.95;
      risks.push("Heavy favorite (spread ≤ -7) → passing volume modest drag");
      negative++;
    }
    if (isRushing && ctx.spread <= -5) {
      mean *= 1.05;
      reasons.push("Team favored (spread ≤ -5) → leading-rush volume +5%");
      positive++;
    }
    if (isRushing && ctx.spread >= 5) {
      mean *= 0.95;
      risks.push("Team dog → negative rush script");
      negative++;
    }
  }
  if (ctx.total != null) {
    if (ctx.total >= 48) {
      mean *= 1.03;
      reasons.push(`High game total (${ctx.total.toFixed(1)}) — volume boost`);
      positive++;
    } else if (ctx.total <= 39) {
      mean *= 0.97;
      risks.push(`Low game total (${ctx.total.toFixed(1)}) — volume drag`);
      negative++;
    }
  }

  // --- Weather -----------------------------------------------------
  if (!ctx.weatherDome) {
    if (ctx.weatherWind != null && (isPassing || isReceiving)) {
      if (ctx.weatherWind >= 20) {
        mean *= 0.9;
        stddev *= 1.1;
        risks.push(
          `High wind (${ctx.weatherWind.toFixed(0)} mph) — passing accuracy + volume drop`,
        );
        negative++;
      } else if (ctx.weatherWind >= 15) {
        mean *= 0.95;
        risks.push(
          `Moderate wind (${ctx.weatherWind.toFixed(0)} mph) — small passing drag`,
        );
        negative++;
      }
    }
    if (ctx.weatherPrecip != null && ctx.weatherPrecip >= 0.05) {
      if (isPassing || isReceiving) {
        mean *= 0.96;
        risks.push(
          `Precipitation (${ctx.weatherPrecip.toFixed(2)}″/hr) — efficiency drag`,
        );
        negative++;
      }
      if (isRushing) {
        mean *= 1.03;
        reasons.push("Wet conditions favor rushing volume +3%");
        positive++;
      }
    }
  }

  // --- Injuries ----------------------------------------------------
  if (ctx.selfStatus === "out") {
    mean = 0;
    stddev = 0.001;
    risks.push("Player listed OUT — projection zeroed");
    negative++;
  } else if (ctx.selfStatus === "doubtful") {
    mean *= 0.3;
    stddev *= 1.5;
    risks.push("Player doubtful — heavy haircut applied");
    negative++;
  } else if (ctx.selfStatus === "questionable") {
    mean *= 0.9;
    stddev *= 1.15;
    risks.push("Player questionable — small downward adjustment");
    negative++;
  }

  if (ctx.teammateAbsenceBoost) {
    mean *= 1.1;
    reasons.push("Teammate absence — role boost +10%");
    positive++;
  }

  if (ctx.olInjuryOwn) {
    if (isPassing || isReceiving) {
      mean *= 0.97;
      stddev *= 1.05;
      risks.push("Own OL depleted — pressure rate up");
      negative++;
    }
    if (isRushing) {
      mean *= 0.96;
      risks.push("Own OL depleted — YPC drag");
      negative++;
    }
  }

  if (ctx.dbInjuryOpponent) {
    if (isReceiving) {
      mean *= 1.06;
      reasons.push("Opposing DBs depleted — receiving boost +6%");
      positive++;
    } else if (isPassing) {
      mean *= 1.03;
      reasons.push("Opposing DBs depleted — passing boost +3%");
      positive++;
    }
  }

  return {
    mean,
    stddevBase: stddev,
    reasons,
    risks,
    positiveCount: positive,
    negativeCount: negative,
  };
}

// =====================================================================
// Volatility
// =====================================================================

export function estimateVolatilityByPropType(
  propType: PropType,
): { level: VolatilityLevel; multiplier: number } {
  const rule = PROP_PROJECTION_RULES[propType];
  return {
    level: rule.volatilityLevel,
    multiplier: rule.volatilityMultiplier,
  };
}

// =====================================================================
// Probability conversion (normal CDF)
// =====================================================================

/**
 * Standard normal CDF (Abramowitz & Stegun 26.2.17, error < 7.5e-8).
 * Kept inline here so the model/ directory stays self-contained.
 */
function normalCdf(z: number): number {
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + p * x);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

export function convertProjectionToProbability(args: {
  mean: number;
  stddev: number;
  line: number;
}): { modelOverProbability: number; modelUnderProbability: number } {
  const sigma = Math.max(0.001, args.stddev);
  const z = (args.line - args.mean) / sigma;
  const overProb = 1 - normalCdf(z);
  return {
    modelOverProbability: overProb,
    modelUnderProbability: 1 - overProb,
  };
}

// =====================================================================
// Data-quality + risk scoring (engine-side)
// =====================================================================

const OPTIONAL_FIELDS: Array<keyof ProjectionContext> = [
  "playerTargetShare",
  "playerCarryShare",
  "playerSnapShare",
  "projectedTeamPlays",
  "projectedPassRate",
  "spread",
  "total",
  "weatherWind",
  "weatherPrecip",
];

function computeDataQuality(ctx: ProjectionContext): number {
  // Dome flag and injury booleans always carry a value (false ≠ missing),
  // so they don't count toward the optional-input completeness score.
  // selfStatus = null counts as missing.
  const filled = OPTIONAL_FIELDS.filter(
    (f) => ctx[f] !== null && ctx[f] !== undefined,
  ).length + (ctx.selfStatus != null ? 1 : 0);
  const total = OPTIONAL_FIELDS.length + 1; // +1 for selfStatus
  return Math.round((filled / total) * 100);
}

function computeRiskScore(
  negativeCount: number,
  volatility: VolatilityLevel,
): number {
  const volContrib =
    volatility === "HIGH" ? 30 : volatility === "MEDIUM" ? 15 : 0;
  const score = Math.min(100, volContrib + negativeCount * 15);
  return score;
}

// =====================================================================
// Single entry point
// =====================================================================

export interface ProjectPropArgs {
  propType: PropType;
  ctx: ProjectionContext;
  line: number;
}

/**
 * Top-level entry. Picks the right `project*` function, runs the
 * generic adjustments, applies the volatility multiplier, and produces
 * the over/under probability via normal CDF.
 */
export function projectProp(args: ProjectPropArgs): PropProjectionOutput {
  const baseline = PROJECTION_FN_BY_PROP[args.propType](args.ctx);
  const adjusted = applyPropSpecificAdjustments(
    args.propType,
    baseline,
    args.ctx,
  );

  const { level, multiplier } = estimateVolatilityByPropType(args.propType);
  const stddev = Math.max(0.5, adjusted.stddevBase * multiplier);

  const probs = convertProjectionToProbability({
    mean: adjusted.mean,
    stddev,
    line: args.line,
  });

  return {
    projectedMean: adjusted.mean,
    projectedStdDev: stddev,
    modelOverProbability: probs.modelOverProbability,
    modelUnderProbability: probs.modelUnderProbability,
    volatilityLevel: level,
    reasons: adjusted.reasons,
    risks: adjusted.risks,
    dataQualityScore: computeDataQuality(args.ctx),
    riskScore: computeRiskScore(adjusted.negativeCount, level),
  };
}

// =====================================================================
// Mock examples — one ProjectionContext per prop type, useful for
// reviewing the engine without spinning up the full backtest.
// =====================================================================

function neutralCtx(overrides: Partial<ProjectionContext> = {}): ProjectionContext {
  return {
    playerRecentMean: 0,
    playerRecentStdDev: 0,
    playerSeasonMean: 0,
    playerTargetShare: null,
    playerCarryShare: null,
    playerSnapShare: null,
    projectedTeamPlays: DEFAULT_TEAM_PLAYS,
    projectedPassRate: DEFAULT_PASS_RATE,
    spread: 0,
    total: 47,
    weatherWind: null,
    weatherPrecip: null,
    weatherDome: false,
    selfStatus: "active",
    teammateAbsenceBoost: false,
    olInjuryOwn: false,
    dbInjuryOpponent: false,
    ...overrides,
  };
}

/** Example contexts hand-tuned to exercise every prop type's pipeline. */
export const EXAMPLE_CONTEXTS: Record<
  PropType,
  { line: number; ctx: ProjectionContext; description: string }
> = {
  PASSING_ATTEMPTS: {
    description: "Mahomes-like QB vs blitz-heavy defense, mild weather",
    line: 34.5,
    ctx: neutralCtx({
      playerRecentMean: 36,
      playerRecentStdDev: 4.2,
      playerSeasonMean: 35.4,
      playerSnapShare: 0.98,
      projectedTeamPlays: 66,
      projectedPassRate: 0.62,
      spread: -2.5,
      total: 48.5,
    }),
  },
  PASSING_COMPLETIONS: {
    description: "Mid-tier QB, dome game, opposing CB out",
    line: 22.5,
    ctx: neutralCtx({
      playerRecentMean: 23.6,
      playerRecentStdDev: 3.4,
      playerSeasonMean: 22.1,
      playerSnapShare: 0.97,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
      weatherDome: true,
      dbInjuryOpponent: true,
    }),
  },
  PASSING_YARDS: {
    description: "Team dog, high total, soft secondary",
    line: 268.5,
    ctx: neutralCtx({
      playerRecentMean: 280,
      playerRecentStdDev: 39,
      playerSeasonMean: 271,
      projectedTeamPlays: 66,
      projectedPassRate: 0.62,
      spread: 5.5,
      total: 51,
      dbInjuryOpponent: true,
    }),
  },
  RECEPTIONS: {
    description: "Alpha WR after WR2 absence, dome",
    line: 6.5,
    ctx: neutralCtx({
      playerRecentMean: 6.8,
      playerRecentStdDev: 1.6,
      playerSeasonMean: 6.4,
      playerTargetShare: 0.27,
      playerSnapShare: 0.92,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
      weatherDome: true,
      teammateAbsenceBoost: true,
    }),
  },
  RECEIVING_YARDS: {
    description: "WR1 vs depleted secondary, slight wind",
    line: 84.5,
    ctx: neutralCtx({
      playerRecentMean: 88,
      playerRecentStdDev: 28,
      playerSeasonMean: 81,
      playerTargetShare: 0.26,
      projectedTeamPlays: 64,
      projectedPassRate: 0.58,
      weatherWind: 12,
      dbInjuryOpponent: true,
    }),
  },
  RUSHING_ATTEMPTS: {
    description: "Lead-back on a 7-point favorite",
    line: 17.5,
    ctx: neutralCtx({
      playerRecentMean: 19.2,
      playerRecentStdDev: 3.4,
      playerSeasonMean: 18.4,
      playerCarryShare: 0.7,
      playerSnapShare: 0.65,
      projectedTeamPlays: 62,
      projectedPassRate: 0.55,
      spread: -7,
      total: 44,
    }),
  },
  RUSHING_YARDS: {
    description: "Lead-back, rainy/windy game, healthy OL",
    line: 88.5,
    ctx: neutralCtx({
      playerRecentMean: 96,
      playerRecentStdDev: 28,
      playerSeasonMean: 91,
      playerCarryShare: 0.65,
      projectedTeamPlays: 62,
      projectedPassRate: 0.52,
      spread: -3,
      total: 41,
      weatherWind: 16,
      weatherPrecip: 0.07,
    }),
  },
};

/** Run the engine on every example. Returns one output per prop type. */
export function runExampleProjections(): Record<PropType, PropProjectionOutput> {
  const out: Partial<Record<PropType, PropProjectionOutput>> = {};
  for (const [propType, example] of Object.entries(EXAMPLE_CONTEXTS)) {
    out[propType as PropType] = projectProp({
      propType: propType as PropType,
      ctx: example.ctx,
      line: example.line,
    });
  }
  return out as Record<PropType, PropProjectionOutput>;
}
