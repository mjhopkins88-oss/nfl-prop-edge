/**
 * Backtest stage 2 — Projection engine.
 *
 * Turns PropFeatures into a (mean, stddev) projection for the player's
 * stat in this game, plus structured reasons/risks the rest of the
 * pipeline surfaces to the UI and ledger.
 *
 * V1 logic (kept transparent and editable):
 *   base       = blend(recentMean, seasonMean) weighted 60/40
 *   sigma_base = blend(recentStdDev, seasonStdDev) weighted 60/40
 *   * team-pace scaling          (multiplicative, default 1.0)
 *   * weather adjustment         (only when weatherImpactEligible)
 *   * injury adjustments         (self / teammate / OL / DB / uncertainty)
 *   * opponent adjustment        (placeholder 1.0 in V1)
 *   sigma widened for small samples and uncertainty flags.
 */

import type { PropType } from "../types";
import type { PropFeatures } from "./feature-builder";

export interface Projection {
  mean: number;
  stddev: number;
  reasons: string[];
  risks: string[];
  /** True when role/usage is so uncertain we should refuse to bet. */
  roleUncertainty: boolean;
  /** True when injury context says step back. */
  injuryUncertainty: boolean;
}

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

const RECENT_WEIGHT = 0.6;
const SEASON_WEIGHT = 0.4;

/** Minimum sigma floor as a fraction of the mean (avoid zero-σ projections). */
const MIN_SIGMA_FRAC = 0.15;
const UNCERTAINTY_SIGMA_BOOST = 1.3;
const LOW_SAMPLE_SIGMA_BOOST = 1.25;

export function projectStats(
  features: PropFeatures,
  propType: PropType,
): Projection {
  const reasons: string[] = [];
  const risks: string[] = [];

  // --- base blend ----------------------------------------------------
  let mean =
    RECENT_WEIGHT * features.recentMean + SEASON_WEIGHT * features.seasonMean;
  let sigma =
    RECENT_WEIGHT * features.recentStdDev +
    SEASON_WEIGHT * features.seasonStdDev;

  reasons.push(
    `Base blend: recent ${features.recentMean.toFixed(1)} (60%) + season ${features.seasonMean.toFixed(1)} (40%) → ${mean.toFixed(1)}`,
  );

  // --- team pace scaling (placeholder = neutral) ---------------------
  // When team_week_stats.csv is wired in, multiply by
  //   (projectedTeamPlays / league_avg_plays) for volume markets,
  //   (projectedPassRate / 0.58) for passing markets.
  // V1: noop.

  // --- weather adjustment --------------------------------------------
  if (features.weather && features.flags.weatherImpactEligible) {
    const wind = features.weather.windSpeed ?? 0;
    const precip = features.weather.precipitation ?? 0;
    const snow = features.weather.snowfall ?? 0;

    if (PASSING_TYPES.has(propType) || RECEIVING_TYPES.has(propType)) {
      if (wind >= 20) {
        mean *= 0.9;
        sigma *= 1.1;
        reasons.push(`Wind ${wind.toFixed(0)} mph → passing volume -10%`);
      } else if (wind >= 15) {
        mean *= 0.95;
        reasons.push(`Wind ${wind.toFixed(0)} mph → passing volume -5%`);
      }
      if (precip >= 0.05 || snow >= 0.05) {
        mean *= 0.96;
        risks.push(`Precip ${precip.toFixed(2)}″ / snow ${snow.toFixed(2)}″ — passing efficiency drag`);
      }
    }
    if (RUSHING_TYPES.has(propType)) {
      if (wind >= 20 || precip >= 0.05) {
        mean *= 1.04;
        reasons.push("Wet/windy script → rushing volume +4%");
      }
    }
  }

  // --- injury adjustments --------------------------------------------
  const ic = features.injuryContext;

  if (ic.selfStatus) {
    const s = ic.selfStatus.status;
    if (s === "out") {
      mean = 0;
      sigma = 0.001;
      risks.push(`Player listed OUT — projection zeroed`);
    } else if (s === "doubtful") {
      mean *= 0.4;
      sigma *= 1.4;
      risks.push(`Player doubtful — heavy haircut applied`);
    } else if (s === "questionable") {
      mean *= 0.9;
      sigma *= 1.2;
      risks.push(`Player questionable — small downward adjustment`);
    }
  }

  for (const boost of ic.teammateBoosts) {
    mean *= 1.1;
    reasons.push(`Teammate boost (${boost.notes || "see CSV"}): +10%`);
  }

  if (ic.olInjuryOnOwnTeam) {
    if (PASSING_TYPES.has(propType)) {
      mean *= 0.97;
      sigma *= 1.05;
      risks.push("Own OL depleted — pressure rate up, passing efficiency down");
    } else if (RUSHING_TYPES.has(propType)) {
      mean *= 0.98;
      risks.push("Own OL depleted — minor rushing efficiency drag");
    }
  }

  if (ic.dbInjuryOnOpposingTeam) {
    if (RECEIVING_TYPES.has(propType)) {
      mean *= 1.05;
      reasons.push("Opposing DBs depleted — receiving boost +5%");
    } else if (PASSING_TYPES.has(propType)) {
      mean *= 1.03;
      reasons.push("Opposing DBs depleted — passing boost +3%");
    }
  }

  let injuryUncertainty = false;
  if (ic.uncertaintyForGame) {
    sigma *= UNCERTAINTY_SIGMA_BOOST;
    injuryUncertainty = true;
    risks.push("Game-level uncertainty flag — σ widened");
  }

  // --- opponent adjustment (placeholder) -----------------------------
  mean *= features.opponentAdjustment;

  // --- sigma floors + small-sample widening --------------------------
  let roleUncertainty = false;
  if (features.flags.lowSample) {
    sigma *= LOW_SAMPLE_SIGMA_BOOST;
    roleUncertainty = true;
    risks.push(
      `Low sample size (${features.gamesSampled} prior games) — role uncertain`,
    );
  }
  const minSigma = Math.max(0.5, Math.abs(mean) * MIN_SIGMA_FRAC);
  if (sigma < minSigma) sigma = minSigma;

  return {
    mean,
    stddev: sigma,
    reasons,
    risks,
    roleUncertainty,
    injuryUncertainty,
  };
}
