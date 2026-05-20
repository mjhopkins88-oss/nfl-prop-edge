/**
 * Experimental Game Edge model.
 *
 * EXPERIMENTAL — Separate from the player prop scorecard. Treats
 * market win probability as the BASELINE, applies capped football-
 * context adjustments around it, and produces:
 *   - per-side moneyline edges
 *   - per-side spread cover probabilities + edges
 *   - an upset score (0..100) for the underdog (descriptive, not
 *     prescriptive — a high upset score does NOT force a bet)
 *   - a single recommendation chosen across moneyline vs spread by
 *     confidence-adjusted edge, with explicit "PASS" labels when
 *     uncertainty is too high.
 *
 * Reuses where possible:
 *   - `buildMarketAnchoredProbability` for the moneyline anchor and
 *     cap discipline
 *   - same risk-score / data-quality / confidence semantics as the
 *     player prop scorecard
 */

import {
  buildMarketAnchoredProbability,
  type FootballAdjustmentComponent,
  type MarketAnchoredProbabilityOutput,
} from "./market-anchored-probability";
import type {
  GameEdgeInput,
  GameEdgeOutput,
  GameEdgeScorecard,
  GameRecommendation,
  GameRecommendationLabel,
  GameSide,
} from "./game-edge-types";

// --- shared helpers --------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function americanToImpliedProbability(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function moneylinePayoutMultiplier(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

function impliedSpreadCoverProbability(odds: number): number {
  // Convert spread juice into a breakeven cover probability.
  return americanToImpliedProbability(odds);
}

// Standard NFL game margin variance — rough but well-calibrated for
// margins around the spread, given win probability and game total.
function expectedMarginStdDev(input: GameEdgeInput): number {
  const total = input.gameTotal ?? 47;
  // Higher totals → more variance.
  let sigma = 10 + (total - 47) * 0.18;
  // Bad weather compresses variance.
  if (input.weatherRiskScore < 0.55) sigma *= 0.92;
  // Coaching uncertainty raises variance.
  const avgCoaching =
    (input.coachingUncertaintyHome + input.coachingUncertaintyAway) / 2;
  if (avgCoaching >= 50) sigma *= 1.08;
  return clamp(sigma, 8, 16);
}

// Map win probability → expected margin (home perspective). Log-odds
// approximation: ~3 NFL points per 10pp shift in win probability.
function expectedHomeMargin(homeWinProbability: number): number {
  const odds = clamp(homeWinProbability, 1e-4, 1 - 1e-4) /
    (1 - clamp(homeWinProbability, 1e-4, 1 - 1e-4));
  const logit = Math.log(odds);
  return logit * 4.5; // 4.5 ≈ NFL points per logit unit
}

function normalCdf(z: number): number {
  // Abramowitz & Stegun approximation.
  const sign = z >= 0 ? 1 : -1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

const KEY_SPREAD_NUMBERS = [2.5, 3, 3.5, 6.5, 7, 7.5, 9.5, 10, 10.5, 13.5, 14, 14.5];

function nearestKeyNumber(spread: number): {
  fragile: boolean;
  key?: number;
} {
  const abs = Math.abs(spread);
  for (const k of KEY_SPREAD_NUMBERS) {
    if (Math.abs(abs - k) <= 0.5) return { fragile: true, key: k };
  }
  return { fragile: false };
}

// --- derived data quality + risk score ------------------------------

function deriveDataQualityScore(input: GameEdgeInput): number {
  if (input.gameDataQualityScore !== undefined) return input.gameDataQualityScore;
  const stabilityScores: number[] = [];
  for (const v of [
    input.homeOffensiveContinuityScore,
    input.awayOffensiveContinuityScore,
    input.homeDefensiveContinuityScore,
    input.awayDefensiveContinuityScore,
    input.homeQBStabilityScore,
    input.awayQBStabilityScore,
  ]) {
    if (v !== undefined) stabilityScores.push(v);
  }
  if (stabilityScores.length === 0) return 0.6; // neutral when nothing supplied
  const m = stabilityScores.reduce((a, b) => a + b, 0) / stabilityScores.length;
  return clamp(m, 0, 1);
}

function deriveRiskScore(input: GameEdgeInput): number {
  // 0..1 (1 = clean). Combine weather + coaching + injury + turnover
  // volatility on both teams.
  const components: number[] = [input.weatherRiskScore];
  const avgCoachingUncertainty =
    (input.coachingUncertaintyHome + input.coachingUncertaintyAway) / 2;
  components.push(clamp(1 - avgCoachingUncertainty / 100, 0, 1));
  for (const v of [
    input.homeInjuryRiskScore,
    input.awayInjuryRiskScore,
    input.homeTurnoverVolatilityScore,
    input.awayTurnoverVolatilityScore,
  ]) {
    if (v !== undefined) components.push(v);
  }
  const m = components.reduce((a, b) => a + b, 0) / components.length;
  return clamp(m, 0, 1);
}

function deriveBaseConfidence(input: GameEdgeInput): number {
  // Coarse confidence: data quality × risk × continuity. Floored at
  // 0.3 so the framework can still produce output for noisy games.
  const dq = deriveDataQualityScore(input);
  const risk = deriveRiskScore(input);
  return clamp(0.4 * dq + 0.4 * risk + 0.2 * 0.7, 0.3, 0.95);
}

// --- football adjustment components ---------------------------------

function buildHomeAdjustmentComponents(
  input: GameEdgeInput,
): FootballAdjustmentComponent[] {
  const components: FootballAdjustmentComponent[] = [];
  // Pressure advantage (home pressure better than away pressure).
  if (
    input.homePressureAdvantageScore !== undefined &&
    input.awayPressureAdvantageScore !== undefined
  ) {
    const adv = input.homePressureAdvantageScore - input.awayPressureAdvantageScore;
    if (Math.abs(adv) >= 0.15) {
      components.push({
        name: "pressure_advantage",
        deltaPp: adv * 7,
        confidence: 0.7,
        independent: true,
        explanation:
          adv > 0
            ? "Home pass-rush advantage on the road QB"
            : "Away pass-rush advantage vs home OL",
      });
    }
  }
  // Run-game advantage.
  if (
    input.homeRunGameAdvantageScore !== undefined &&
    input.awayRunGameAdvantageScore !== undefined
  ) {
    const adv = input.homeRunGameAdvantageScore - input.awayRunGameAdvantageScore;
    if (Math.abs(adv) >= 0.15) {
      components.push({
        name: "run_game_advantage",
        deltaPp: adv * 5,
        confidence: 0.6,
        independent: true,
        explanation:
          adv > 0
            ? "Home run-game advantage"
            : "Away run-game advantage",
      });
    }
  }
  // Pass-game advantage.
  if (
    input.homePassGameAdvantageScore !== undefined &&
    input.awayPassGameAdvantageScore !== undefined
  ) {
    const adv = input.homePassGameAdvantageScore - input.awayPassGameAdvantageScore;
    if (Math.abs(adv) >= 0.15) {
      components.push({
        name: "pass_game_advantage",
        deltaPp: adv * 6,
        confidence: 0.65,
        independent: true,
        explanation:
          adv > 0 ? "Home pass-game advantage" : "Away pass-game advantage",
      });
    }
  }
  // QB stability advantage.
  if (
    input.homeQBStabilityScore !== undefined &&
    input.awayQBStabilityScore !== undefined
  ) {
    const adv = input.homeQBStabilityScore - input.awayQBStabilityScore;
    if (Math.abs(adv) >= 0.15) {
      components.push({
        name: "qb_stability",
        deltaPp: adv * 6,
        confidence: 0.7,
        independent: true,
        explanation:
          adv > 0 ? "Home QB more stable" : "Away QB more stable",
      });
    }
  }
  // Coaching uncertainty: away has more uncertainty → home benefits.
  const coachingDelta =
    input.coachingUncertaintyAway - input.coachingUncertaintyHome;
  if (Math.abs(coachingDelta) >= 15) {
    components.push({
      name: "coaching_uncertainty",
      deltaPp: (coachingDelta / 100) * 6,
      confidence: 0.6,
      independent: true,
      explanation:
        coachingDelta > 0
          ? "Away coaching transition uncertainty"
          : "Home coaching transition uncertainty",
    });
  }
  // Injury risk advantage.
  if (
    input.homeInjuryRiskScore !== undefined &&
    input.awayInjuryRiskScore !== undefined
  ) {
    const adv = input.homeInjuryRiskScore - input.awayInjuryRiskScore;
    if (Math.abs(adv) >= 0.15) {
      components.push({
        name: "injury_risk",
        deltaPp: adv * 5,
        confidence: 0.55,
        independent: true,
        explanation:
          adv > 0
            ? "Home injury report cleaner"
            : "Away injury report cleaner",
      });
    }
  }
  // Rest / travel.
  if (
    input.homeRestDays !== undefined &&
    input.awayRestDays !== undefined
  ) {
    const adv = input.homeRestDays - input.awayRestDays;
    if (Math.abs(adv) >= 2) {
      components.push({
        name: "rest_advantage",
        deltaPp: Math.sign(adv) * 1.5,
        confidence: 0.55,
        independent: true,
        explanation: adv > 0 ? "Home rest advantage" : "Away rest advantage",
      });
    }
  }
  if (
    input.homeTravelPenalty !== undefined &&
    input.awayTravelPenalty !== undefined
  ) {
    const adv = input.awayTravelPenalty - input.homeTravelPenalty;
    if (Math.abs(adv) >= 0.15) {
      components.push({
        name: "travel_advantage",
        deltaPp: adv * 3,
        confidence: 0.5,
        independent: true,
        explanation:
          adv > 0 ? "Home travel advantage" : "Away travel advantage",
      });
    }
  }
  return components;
}

// --- moneyline calculation ------------------------------------------

interface MoneylineEvaluation {
  modelHomeWinProbability: number;
  modelAwayWinProbability: number;
  homeAdjustment: MarketAnchoredProbabilityOutput;
  homeEdgePp: number;
  awayEdgePp: number;
  confidenceAdjustedHomeEdgePp: number;
  confidenceAdjustedAwayEdgePp: number;
}

function evaluateMoneyline(
  input: GameEdgeInput,
  confidence: number,
  riskScore: number,
  dataQualityScore: number,
): MoneylineEvaluation {
  const components = buildHomeAdjustmentComponents(input);
  const homeAdjustment = buildMarketAnchoredProbability({
    // Use PASSING_ATTEMPTS as the prop-type tag for cap purposes —
    // game-level moneyline matches the volume-prop cap behavior
    // (max 12pp with multiple agreeing high-confidence signals).
    propType: "PASSING_ATTEMPTS",
    marketProbability: input.marketHomeWinProbability,
    components,
    confidence,
    riskScore,
    dataQualityScore,
  });
  const modelHome = homeAdjustment.finalModelProbability;
  const modelAway = clamp(1 - modelHome, 0, 1);
  const homeEdgePp =
    (modelHome - americanToImpliedProbability(input.homeMoneylineOdds)) * 100;
  const awayEdgePp =
    (modelAway - americanToImpliedProbability(input.awayMoneylineOdds)) * 100;
  // Confidence-adjusted edge applies same discipline as
  // market-anchored layer.
  const confMul = clamp(confidence / 0.7, 0.4, 1.0);
  const riskMul = clamp(riskScore / 0.7, 0.5, 1.0);
  return {
    modelHomeWinProbability: modelHome,
    modelAwayWinProbability: modelAway,
    homeAdjustment,
    homeEdgePp,
    awayEdgePp,
    confidenceAdjustedHomeEdgePp: homeEdgePp * confMul * riskMul,
    confidenceAdjustedAwayEdgePp: awayEdgePp * confMul * riskMul,
  };
}

// --- spread calculation ---------------------------------------------

interface SpreadEvaluation {
  homeCoverProbability: number;
  awayCoverProbability: number;
  homeEdgePp: number;
  awayEdgePp: number;
  confidenceAdjustedHomeEdgePp: number;
  confidenceAdjustedAwayEdgePp: number;
  keyNumberRisk: boolean;
  keyNumber?: number;
}

function evaluateSpread(
  input: GameEdgeInput,
  modelHomeWinProbability: number,
  confidence: number,
  riskScore: number,
): SpreadEvaluation {
  const sigma = expectedMarginStdDev(input);
  const expectedMargin = expectedHomeMargin(modelHomeWinProbability);
  // homeSpread is negative when home is favored. Home covers if
  // margin > -homeSpread (e.g., home -3 → home covers if margin > 3).
  const homeCoverThreshold = -input.homeSpread;
  const zHome = (homeCoverThreshold - expectedMargin) / sigma;
  const homeCoverProbability = clamp(1 - normalCdf(zHome), 0, 1);
  const awayCoverProbability = clamp(1 - homeCoverProbability, 0, 1);

  const homeBreakeven = impliedSpreadCoverProbability(input.homeSpreadOdds);
  const awayBreakeven = impliedSpreadCoverProbability(input.awaySpreadOdds);
  const homeEdgePp = (homeCoverProbability - homeBreakeven) * 100;
  const awayEdgePp = (awayCoverProbability - awayBreakeven) * 100;
  const confMul = clamp(confidence / 0.7, 0.4, 1.0);
  const riskMul = clamp(riskScore / 0.7, 0.5, 1.0);

  const homeKey = nearestKeyNumber(input.homeSpread);
  const awayKey = nearestKeyNumber(input.awaySpread);
  const keyNumberRisk = homeKey.fragile || awayKey.fragile;
  return {
    homeCoverProbability,
    awayCoverProbability,
    homeEdgePp,
    awayEdgePp,
    confidenceAdjustedHomeEdgePp: homeEdgePp * confMul * riskMul,
    confidenceAdjustedAwayEdgePp: awayEdgePp * confMul * riskMul,
    keyNumberRisk,
    keyNumber: homeKey.key ?? awayKey.key,
  };
}

// --- upset score ----------------------------------------------------

interface UpsetEvaluation {
  score: number;
  underdogSide: GameSide | undefined;
  factors: string[];
  risks: string[];
}

function evaluateUpset(input: GameEdgeInput): UpsetEvaluation {
  const homeIsDog = input.marketHomeWinProbability < input.marketAwayWinProbability;
  const dogSide: GameSide = homeIsDog ? "HOME" : "AWAY";
  const favSide: GameSide = homeIsDog ? "AWAY" : "HOME";
  const dogProb = homeIsDog
    ? input.marketHomeWinProbability
    : input.marketAwayWinProbability;
  // Only a meaningful upset analysis when there's a real dog.
  if (dogProb >= 0.45) {
    return {
      score: 0,
      underdogSide: undefined,
      factors: ["Game is too close to a coin flip — no underdog spread to consider"],
      risks: [],
    };
  }
  const factors: string[] = [];
  const risks: string[] = [];
  let score = 0;

  // Sliding underdog bonus.
  const dogBonus = clamp((0.45 - dogProb) * 50, 0, 15);
  if (dogBonus > 0) {
    score += dogBonus;
    factors.push(
      `Real underdog: market implies ${(dogProb * 100).toFixed(0)}% win probability`,
    );
  }

  const side = (s: GameSide) => (s === "HOME" ? "home" : "away");
  const pick = <T,>(s: GameSide, h: T, a: T) => (s === "HOME" ? h : a);

  const dogPressure = pick(
    dogSide,
    input.homePressureAdvantageScore,
    input.awayPressureAdvantageScore,
  );
  if (dogPressure !== undefined && dogPressure >= 0.6) {
    score += 12;
    factors.push(`Underdog (${side(dogSide)}) has pass-rush advantage`);
  }

  const favQbStability = pick(
    favSide,
    input.homeQBStabilityScore,
    input.awayQBStabilityScore,
  );
  if (favQbStability !== undefined && favQbStability < 0.45) {
    score += 10;
    factors.push(`Favorite (${side(favSide)}) QB instability — pressure-sensitive`);
  }

  if (input.weatherRiskScore < 0.55) {
    score += 8;
    factors.push("Weather compresses scoring — favors underdog");
  }

  const dogRunAdv = pick(
    dogSide,
    input.homeRunGameAdvantageScore,
    input.awayRunGameAdvantageScore,
  );
  if (dogRunAdv !== undefined && dogRunAdv >= 0.6) {
    score += 8;
    factors.push(`Underdog (${side(dogSide)}) can shorten the game with run`);
  }

  const favCoachingUncertainty = pick(
    favSide,
    input.coachingUncertaintyHome,
    input.coachingUncertaintyAway,
  );
  if (favCoachingUncertainty >= 40) {
    score += 8;
    factors.push(`Coaching uncertainty on favorite (${side(favSide)})`);
  }

  const favInjury = pick(
    favSide,
    input.homeInjuryRiskScore,
    input.awayInjuryRiskScore,
  );
  if (favInjury !== undefined && favInjury < 0.5) {
    score += 6;
    factors.push(`Injury risk on favorite (${side(favSide)})`);
  }

  const restAdvForDog = (() => {
    const dogRest = pick(dogSide, input.homeRestDays, input.awayRestDays);
    const favRest = pick(favSide, input.homeRestDays, input.awayRestDays);
    if (dogRest === undefined || favRest === undefined) return 0;
    return dogRest - favRest;
  })();
  if (restAdvForDog >= 2) {
    score += 4;
    factors.push(`Underdog has rest advantage (+${restAdvForDog} days)`);
  }

  const favoriteSpread = pick(favSide, input.homeSpread, input.awaySpread);
  if (Math.abs(favoriteSpread) >= 7) {
    score += 5;
    factors.push("Spread is large enough to create natural value");
  }

  // --- PENALTIES (subtract from upset score) ---

  const dogQbStability = pick(
    dogSide,
    input.homeQBStabilityScore,
    input.awayQBStabilityScore,
  );
  if (dogQbStability !== undefined && dogQbStability < 0.45) {
    score -= 12;
    risks.push(`Underdog (${side(dogSide)}) QB instability is a real concern`);
  }

  const dogOlContinuity = pick(
    dogSide,
    input.homeOffensiveContinuityScore,
    input.awayOffensiveContinuityScore,
  );
  if (dogOlContinuity !== undefined && dogOlContinuity < 0.4) {
    score -= 6;
    risks.push(`Underdog (${side(dogSide)}) offensive line continuity at risk`);
  }

  if (dogRunAdv !== undefined && dogRunAdv < 0.4) {
    score -= 6;
    risks.push(`Underdog (${side(dogSide)}) cannot reliably run / shorten game`);
  }

  const favPressureAdv = pick(
    favSide,
    input.homePressureAdvantageScore,
    input.awayPressureAdvantageScore,
  );
  const favRunAdv = pick(
    favSide,
    input.homeRunGameAdvantageScore,
    input.awayRunGameAdvantageScore,
  );
  if (
    favPressureAdv !== undefined &&
    favRunAdv !== undefined &&
    favPressureAdv >= 0.7 &&
    favRunAdv >= 0.7
  ) {
    score -= 10;
    risks.push(`Favorite (${side(favSide)}) has major trench advantage`);
  }

  if (dogPressure !== undefined && dogPressure < 0.4) {
    score -= 6;
    risks.push(`Underdog defense cannot create pressure`);
  }

  if (input.gameTotal !== undefined && input.gameTotal >= 50) {
    score -= 6;
    risks.push("High game total — more possessions reduce compression");
  }

  const dogInjury = pick(
    dogSide,
    input.homeInjuryRiskScore,
    input.awayInjuryRiskScore,
  );
  if (dogInjury !== undefined && dogInjury < 0.5) {
    score -= 8;
    risks.push(`Underdog injury risk`);
  }

  const dq = deriveDataQualityScore(input);
  if (dq < 0.55) {
    score -= 8;
    risks.push("Low data quality — treat upset score as approximation");
  }

  return {
    score: clamp(score, 0, 100),
    underdogSide: dogSide,
    factors,
    risks,
  };
}

// --- recommendation logic ------------------------------------------

const ML_FAVORITE_THRESHOLD_PP = 3;
const ML_UNDERDOG_THRESHOLD_PP = 5;
const ML_LONGSHOT_THRESHOLD_PP = 7;
const SPREAD_THRESHOLD_PP = 4;
const UPSET_WATCH_THRESHOLD = 55;

function moneylineThresholdForSide(
  marketProbability: number,
  side: GameSide,
  homeIsFav: boolean,
): number {
  const isFav =
    (side === "HOME" && homeIsFav) || (side === "AWAY" && !homeIsFav);
  if (isFav) return ML_FAVORITE_THRESHOLD_PP;
  if (marketProbability < 0.3) return ML_LONGSHOT_THRESHOLD_PP;
  return ML_UNDERDOG_THRESHOLD_PP;
}

interface RecommendationDecision {
  recommendation: GameRecommendation;
  label: GameRecommendationLabel;
  selectedSide?: GameSide;
  reasons: string[];
  disqualifiers: string[];
}

function decideRecommendation(args: {
  input: GameEdgeInput;
  moneyline: MoneylineEvaluation;
  spread: SpreadEvaluation;
  upset: UpsetEvaluation;
  confidence: number;
  riskScore: number;
  dataQualityScore: number;
}): RecommendationDecision {
  const reasons: string[] = [];
  const disqualifiers: string[] = [];
  const homeIsFav =
    args.input.marketHomeWinProbability > args.input.marketAwayWinProbability;

  // Hard PASS gates: data quality / risk too low.
  if (args.dataQualityScore < 0.45 || args.riskScore < 0.45) {
    if (args.dataQualityScore < 0.45)
      disqualifiers.push(
        `Data quality ${args.dataQualityScore.toFixed(2)} below 0.45 — game-level model unreliable`,
      );
    if (args.riskScore < 0.45)
      disqualifiers.push(
        `Composite risk ${args.riskScore.toFixed(2)} below 0.45 — too much uncertainty`,
      );
    return {
      recommendation: "PASS",
      label: "Pass / Too Much Uncertainty",
      reasons,
      disqualifiers,
    };
  }

  // Candidate edges.
  type Candidate = {
    label: GameRecommendationLabel;
    recommendation: GameRecommendation;
    side: GameSide;
    market: "MONEYLINE" | "SPREAD";
    edgePp: number;
    confidenceAdjustedEdgePp: number;
    threshold: number;
    reason: string;
  };
  const candidates: Candidate[] = [];

  // Moneyline candidates.
  const homeMLThreshold = moneylineThresholdForSide(
    args.input.marketHomeWinProbability,
    "HOME",
    homeIsFav,
  );
  const awayMLThreshold = moneylineThresholdForSide(
    args.input.marketAwayWinProbability,
    "AWAY",
    homeIsFav,
  );
  if (args.moneyline.confidenceAdjustedHomeEdgePp >= homeMLThreshold) {
    candidates.push({
      label:
        args.moneyline.confidenceAdjustedHomeEdgePp >= 8
          ? "Strong ML Value"
          : "Playable ML Value",
      recommendation: "HOME_MONEYLINE",
      side: "HOME",
      market: "MONEYLINE",
      edgePp: args.moneyline.homeEdgePp,
      confidenceAdjustedEdgePp: args.moneyline.confidenceAdjustedHomeEdgePp,
      threshold: homeMLThreshold,
      reason: `Home ML edge ${args.moneyline.confidenceAdjustedHomeEdgePp.toFixed(1)}pp clears ${homeMLThreshold}pp threshold`,
    });
  }
  if (args.moneyline.confidenceAdjustedAwayEdgePp >= awayMLThreshold) {
    candidates.push({
      label:
        args.moneyline.confidenceAdjustedAwayEdgePp >= 8
          ? "Strong ML Value"
          : "Playable ML Value",
      recommendation: "AWAY_MONEYLINE",
      side: "AWAY",
      market: "MONEYLINE",
      edgePp: args.moneyline.awayEdgePp,
      confidenceAdjustedEdgePp: args.moneyline.confidenceAdjustedAwayEdgePp,
      threshold: awayMLThreshold,
      reason: `Away ML edge ${args.moneyline.confidenceAdjustedAwayEdgePp.toFixed(1)}pp clears ${awayMLThreshold}pp threshold`,
    });
  }

  // Spread candidates. Tightened threshold when uncertainty is high.
  const spreadThreshold =
    args.confidence < 0.5 || args.riskScore < 0.55
      ? SPREAD_THRESHOLD_PP + 2
      : SPREAD_THRESHOLD_PP;
  if (args.spread.confidenceAdjustedHomeEdgePp >= spreadThreshold) {
    candidates.push({
      label: "Spread Value",
      recommendation: "HOME_SPREAD",
      side: "HOME",
      market: "SPREAD",
      edgePp: args.spread.homeEdgePp,
      confidenceAdjustedEdgePp: args.spread.confidenceAdjustedHomeEdgePp,
      threshold: spreadThreshold,
      reason: `Home cover edge ${args.spread.confidenceAdjustedHomeEdgePp.toFixed(1)}pp clears ${spreadThreshold}pp threshold`,
    });
  }
  if (args.spread.confidenceAdjustedAwayEdgePp >= spreadThreshold) {
    candidates.push({
      label: "Spread Value",
      recommendation: "AWAY_SPREAD",
      side: "AWAY",
      market: "SPREAD",
      edgePp: args.spread.awayEdgePp,
      confidenceAdjustedEdgePp: args.spread.confidenceAdjustedAwayEdgePp,
      threshold: spreadThreshold,
      reason: `Away cover edge ${args.spread.confidenceAdjustedAwayEdgePp.toFixed(1)}pp clears ${spreadThreshold}pp threshold`,
    });
  }

  if (candidates.length > 0) {
    candidates.sort(
      (a, b) => b.confidenceAdjustedEdgePp - a.confidenceAdjustedEdgePp,
    );
    const winner = candidates[0];
    reasons.push(winner.reason);
    if (args.spread.keyNumberRisk && winner.market === "SPREAD") {
      reasons.push(
        `Key-number risk near ${args.spread.keyNumber} — cover edge fragile`,
      );
    }
    return {
      recommendation: winner.recommendation,
      label: winner.label,
      selectedSide: winner.side,
      reasons,
      disqualifiers,
    };
  }

  // No candidate cleared — Upset watch?
  if (
    args.upset.score >= UPSET_WATCH_THRESHOLD &&
    args.upset.underdogSide !== undefined
  ) {
    reasons.push(
      `Upset score ${args.upset.score.toFixed(0)} ≥ ${UPSET_WATCH_THRESHOLD} — track the underdog`,
    );
    reasons.push(
      "Edge thresholds not cleared at current odds — no recommended play",
    );
    return {
      recommendation: "PASS",
      label: "Upset Watch",
      selectedSide: args.upset.underdogSide,
      reasons,
      disqualifiers,
    };
  }

  // Anything close but below thresholds → Cover Watch / Pass.
  const bestSpread = Math.max(
    args.spread.confidenceAdjustedHomeEdgePp,
    args.spread.confidenceAdjustedAwayEdgePp,
  );
  if (bestSpread >= 1.5) {
    reasons.push(
      `Spread edge ${bestSpread.toFixed(1)}pp below ${spreadThreshold}pp threshold`,
    );
    return {
      recommendation: "PASS",
      label: "Cover Watch",
      reasons,
      disqualifiers,
    };
  }
  reasons.push(
    "Moneyline and spread both within tolerance of market — no edge",
  );
  return {
    recommendation: "PASS",
    label: "Pass / No Edge",
    reasons,
    disqualifiers,
  };
}

// --- public API -----------------------------------------------------

export function buildGameEdge(input: GameEdgeInput): GameEdgeOutput {
  const dataQualityScore = deriveDataQualityScore(input);
  const riskScore = deriveRiskScore(input);
  const confidence = deriveBaseConfidence(input);

  const moneyline = evaluateMoneyline(
    input,
    confidence,
    riskScore,
    dataQualityScore,
  );
  const spread = evaluateSpread(
    input,
    moneyline.modelHomeWinProbability,
    confidence,
    riskScore,
  );
  const upset = evaluateUpset(input);

  const decision = decideRecommendation({
    input,
    moneyline,
    spread,
    upset,
    confidence,
    riskScore,
    dataQualityScore,
  });

  // Aggregate reasons / risks / disqualifiers from all paths.
  const reasons = [...decision.reasons];
  const risks: string[] = [];
  for (const r of moneyline.homeAdjustment.risks) risks.push(r);
  for (const r of upset.risks) risks.push(r);
  if (spread.keyNumberRisk && spread.keyNumber !== undefined) {
    risks.push(
      `Spread near key number ${spread.keyNumber} — backdoor / pushed cover risk`,
    );
  }
  if (decision.recommendation === "PASS" && upset.score >= UPSET_WATCH_THRESHOLD) {
    risks.push("Upset score is descriptive — not a buy signal at current price");
  }
  for (const f of upset.factors) {
    if (f.startsWith("BUT:") || f.includes("not enough")) continue;
    reasons.push(`Upset factor: ${f}`);
  }

  const whatWouldChange: string[] = [];
  if (decision.recommendation === "PASS") {
    if (
      Math.max(
        moneyline.confidenceAdjustedHomeEdgePp,
        moneyline.confidenceAdjustedAwayEdgePp,
      ) < ML_UNDERDOG_THRESHOLD_PP
    ) {
      whatWouldChange.push(
        "Moneyline price improvement on the side with positive edge",
      );
    }
    if (
      Math.max(
        spread.confidenceAdjustedHomeEdgePp,
        spread.confidenceAdjustedAwayEdgePp,
      ) < SPREAD_THRESHOLD_PP
    ) {
      whatWouldChange.push(
        "Spread movement of 0.5–1 point in the favorable direction",
      );
    }
    if (riskScore < 0.55) {
      whatWouldChange.push(
        "Lower risk profile (clean injury report, lower coaching uncertainty)",
      );
    }
    if (dataQualityScore < 0.55) {
      whatWouldChange.push(
        "More games of stable data on both teams",
      );
    }
  } else {
    whatWouldChange.push(
      "Risk spikes (late injuries, weather change) could move the recommendation back to PASS",
    );
    if (spread.keyNumberRisk) {
      whatWouldChange.push(
        "Line moves off the key number — current edge is fragile",
      );
    }
  }

  const finalExplanation = buildFinalExplanation({
    input,
    decision,
    moneyline,
    spread,
    upset,
    confidence,
    riskScore,
    dataQualityScore,
  });

  const scorecard: GameEdgeScorecard = {
    gameId: input.gameId,
    season: input.season,
    week: input.week,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    recommendation: decision.recommendation,
    recommendationLabel: decision.label,
    marketBaseline: {
      homeWinProbability: input.marketHomeWinProbability,
      awayWinProbability: input.marketAwayWinProbability,
      homeMoneylineOdds: input.homeMoneylineOdds,
      awayMoneylineOdds: input.awayMoneylineOdds,
      homeSpread: input.homeSpread,
      awaySpread: input.awaySpread,
    },
    modelProbability: {
      home: moneyline.modelHomeWinProbability,
      away: moneyline.modelAwayWinProbability,
    },
    moneyline: {
      homeEdgePp: moneyline.homeEdgePp,
      awayEdgePp: moneyline.awayEdgePp,
      confidenceAdjustedHomeEdgePp: moneyline.confidenceAdjustedHomeEdgePp,
      confidenceAdjustedAwayEdgePp: moneyline.confidenceAdjustedAwayEdgePp,
    },
    spread: {
      homeCoverProbability: spread.homeCoverProbability,
      awayCoverProbability: spread.awayCoverProbability,
      homeEdgePp: spread.homeEdgePp,
      awayEdgePp: spread.awayEdgePp,
      confidenceAdjustedHomeEdgePp: spread.confidenceAdjustedHomeEdgePp,
      confidenceAdjustedAwayEdgePp: spread.confidenceAdjustedAwayEdgePp,
      keyNumberRisk: spread.keyNumberRisk,
      keyNumber: spread.keyNumber,
    },
    upset: {
      score: upset.score,
      underdogSide: upset.underdogSide,
      factors: upset.factors,
      risks: upset.risks,
    },
    confidence,
    riskScore,
    dataQualityScore,
    reasons,
    risks,
    disqualifiers: decision.disqualifiers,
    whatWouldChange,
    finalExplanation,
  };

  return {
    gameId: input.gameId,
    recommendation: decision.recommendation,
    recommendationLabel: decision.label,
    selectedSide: decision.selectedSide,
    selectedMarket: decision.selectedSide
      ? decision.recommendation === "HOME_MONEYLINE" ||
        decision.recommendation === "AWAY_MONEYLINE"
        ? "MONEYLINE"
        : "SPREAD"
      : undefined,
    modelHomeWinProbability: moneyline.modelHomeWinProbability,
    modelAwayWinProbability: moneyline.modelAwayWinProbability,
    marketHomeWinProbability: input.marketHomeWinProbability,
    marketAwayWinProbability: input.marketAwayWinProbability,
    homeMoneylineEdge: moneyline.homeEdgePp,
    awayMoneylineEdge: moneyline.awayEdgePp,
    spreadCoverProbabilityHome: spread.homeCoverProbability,
    spreadCoverProbabilityAway: spread.awayCoverProbability,
    spreadEdgeHome: spread.homeEdgePp,
    spreadEdgeAway: spread.awayEdgePp,
    upsetScore: upset.score,
    underdogSide: upset.underdogSide,
    confidence,
    riskScore,
    dataQualityScore,
    reasons,
    risks,
    disqualifiers: decision.disqualifiers,
    upsetFactors: upset.factors,
    scorecard,
  };
}

function buildFinalExplanation(args: {
  input: GameEdgeInput;
  decision: RecommendationDecision;
  moneyline: MoneylineEvaluation;
  spread: SpreadEvaluation;
  upset: UpsetEvaluation;
  confidence: number;
  riskScore: number;
  dataQualityScore: number;
}): string {
  const matchup = `${args.input.awayTeam} @ ${args.input.homeTeam}`;
  const conf = `confidence ${(args.confidence * 100).toFixed(0)}%`;
  const risk = `risk ${args.riskScore.toFixed(2)}`;
  const dq = `data quality ${args.dataQualityScore.toFixed(2)}`;
  if (args.decision.recommendation === "PASS") {
    if (args.decision.label === "Upset Watch") {
      return `Upset Watch on ${matchup}: upset score ${args.upset.score.toFixed(0)}/100 but moneyline price + spread thresholds not cleared at current odds. ${conf}, ${risk}, ${dq}.`;
    }
    if (args.decision.label === "Pass / Too Much Uncertainty") {
      return `PASS — too much uncertainty on ${matchup}: ${conf}, ${risk}, ${dq}.`;
    }
    if (args.decision.label === "Cover Watch") {
      return `Cover Watch on ${matchup}: spread edge is positive but below threshold — track price movement. ${conf}, ${risk}.`;
    }
    return `No edge on ${matchup}: moneyline and spread both within tolerance of the market. ${conf}.`;
  }
  return `${args.decision.label} on ${matchup} (${args.decision.recommendation}). ${conf}, ${risk}, ${dq}.`;
}
