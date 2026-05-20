/**
 * Football Matchup Intelligence Layer.
 *
 * INTEGRATION CONTRACT
 * --------------------
 * The matchup adjustment is OPTIONAL and SUPPLEMENTAL. It cannot, by
 * itself, qualify a non-qualifying bet:
 *
 *   - `projectedMeanMultiplier` is REPORTED for transparency / UI
 *     display but is NOT applied to the scorecard's qualification
 *     math. (Applying it would let a strong positive matchup push a
 *     thin edge over threshold — the user explicitly forbids that.)
 *   - `projectedStdDevMultiplier` IS applied to the scorecard σ. It
 *     is clamped to ≥ 1.0, so widening uncertainty can only push a
 *     thin edge BELOW threshold, never above it.
 *   - reasons / risks are appended to the scorecard.
 *   - confidence / data quality drag is applied as a small bonus or
 *     malus to the existing scorecard values.
 *
 * MODELING RULES (per user spec)
 * ------------------------------
 *   1. Yardage props receive larger σ penalties than volume props.
 *   2. Volume props are more sensitive to role/pace/script than to
 *      matchup notes — matchup adjustments here are intentionally
 *      smaller for volume than for yardage.
 *   3. Low data quality caps matchup adjustments toward neutral.
 *   4. Role-stability conflict: matchup signals that depend on the
 *      player's role are dampened when role stability is low.
 *   5. Dome trumps weather — matchup weather signal is forced
 *      neutral when the game is in a dome.
 *   6. Pressure × pressure-sensitive QB: passing yards / receiving
 *      yards downgraded more than completions.
 *   7. Blitz × short-area role: small reception boost.
 *   8. Two-high / light box: deep receiving yards down, rushing
 *      efficiency up.
 *   9. Pass funnel: pass volume up only if game script supports it.
 *  10. Run funnel: rushing volume up only if team isn't trailing.
 *  11. OL injury risk: deep passing + rushing efficiency down.
 *  12. QB rushing cannibalization: RB rushing attempts / yards down.
 */

import type { PropType } from "../types";
import type {
  ImpactLabel,
  MatchupAdjustmentOutput,
  MatchupIntelligenceInput,
  MatchupScorecardComponent,
  PropImpactMap,
} from "./matchup-intelligence-types";
import {
  ALL_V1_PROP_TYPES,
  DEFENSIVE_PROP_IMPACTS,
  NEUTRAL_PROP_IMPACTS,
} from "./matchup-intelligence-data";

export type {
  CoverageProfile,
  DefensiveArchetypeKey,
  DefensiveFunnelProfile,
  ImpactLabel,
  MatchupAdjustmentOutput,
  MatchupArchetype,
  MatchupIntelligenceInput,
  MatchupScorecardComponent,
  PlayerRoleArchetypeKey,
  PressureProfile,
  PropImpactMap,
  ReceiverRoleProfile,
  RunGameMatchupProfile,
  WeatherArchetypeKey,
  WeatherStyleProfile,
} from "./matchup-intelligence-types";

const YARDAGE_PROP_TYPES = new Set<PropType>([
  "PASSING_YARDS",
  "RECEIVING_YARDS",
  "RUSHING_YARDS",
]);

const VOLUME_PROP_TYPES = new Set<PropType>([
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "RECEPTIONS",
  "RUSHING_ATTEMPTS",
]);

const MAX_MEAN_MULTIPLIER = 1.03;
const MIN_MEAN_MULTIPLIER = 0.97;
const MAX_STDDEV_MULTIPLIER = 1.3;
const MIN_STDDEV_MULTIPLIER = 1.0;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

const IMPACT_STRENGTH: Record<ImpactLabel, number> = {
  STRONG_POSITIVE: 2,
  POSITIVE: 1,
  NEUTRAL: 0,
  UNCERTAIN: 0,
  NEGATIVE: -1,
  STRONG_NEGATIVE: -2,
};

function strengthToLabel(
  strength: number,
  anyUncertain: boolean,
): ImpactLabel {
  if (strength >= 2) return "STRONG_POSITIVE";
  if (strength >= 1) return "POSITIVE";
  if (strength <= -2) return "STRONG_NEGATIVE";
  if (strength <= -1) return "NEGATIVE";
  return anyUncertain ? "UNCERTAIN" : "NEUTRAL";
}

interface PartialAdjustment {
  meanMultiplier: number;
  stdDevMultiplier: number;
  confidenceAdjustment: number;
  dataQualityAdjustment: number;
  riskAdjustment: number;
  reasons: string[];
  risks: string[];
  propImpactStrength: Partial<Record<PropType, number>>;
  propImpactUncertain: Partial<Record<PropType, boolean>>;
  tags: string[];
}

function emptyAdjustment(): PartialAdjustment {
  return {
    meanMultiplier: 1,
    stdDevMultiplier: 1,
    confidenceAdjustment: 0,
    dataQualityAdjustment: 0,
    riskAdjustment: 0,
    reasons: [],
    risks: [],
    propImpactStrength: {},
    propImpactUncertain: {},
    tags: [],
  };
}

function bumpImpact(
  store: Partial<Record<PropType, number>>,
  propType: PropType,
  delta: number,
): void {
  store[propType] = (store[propType] ?? 0) + delta;
}

function isShortAreaPlayer(input: MatchupIntelligenceInput): boolean {
  const role = input.playerRole.archetype;
  return (
    role === "SLOT_VOLUME_WR" ||
    role === "POSSESSION_WR" ||
    role === "RECEIVING_TE" ||
    role === "RECEIVING_RB" ||
    role === "BELL_COW_RB"
  );
}

function isQB(input: MatchupIntelligenceInput): boolean {
  return (
    input.playerRole.archetype === "MOBILE_QB" ||
    input.playerRole.archetype === "POCKET_QB"
  );
}

// --- per-dimension functions -----------------------------------------

export function calculateDefensiveFunnelAdjustment(
  input: MatchupIntelligenceInput,
): PartialAdjustment {
  const adj = emptyAdjustment();
  const f = input.defensiveFunnel;
  const baseImpacts = DEFENSIVE_PROP_IMPACTS[input.defensiveArchetype];

  // Seed prop-impact strengths from the archetype's static table.
  for (const pt of ALL_V1_PROP_TYPES) {
    const label = baseImpacts[pt];
    if (label === "UNCERTAIN") adj.propImpactUncertain[pt] = true;
    bumpImpact(adj.propImpactStrength, pt, IMPACT_STRENGTH[label]);
  }

  // Pass funnel: only support pass volume if team isn't being forced
  // run-heavy by game script.
  if (f.passFunnel >= 0.65 && input.gameScript >= -0.3) {
    adj.reasons.push(
      "Defense funnels passing — pass volume supported by archetype",
    );
    adj.tags.push("PASS_FUNNEL");
    if (
      input.propType === "PASSING_ATTEMPTS" ||
      input.propType === "PASSING_COMPLETIONS"
    ) {
      adj.meanMultiplier *= 1.015;
    }
  } else if (f.passFunnel >= 0.65 && input.gameScript < -0.3) {
    adj.risks.push(
      "Pass-funnel defense, but team likely trailing — script may force passing anyway (already priced)",
    );
  }

  // Run funnel: only support rushing volume if team isn't likely to
  // trail heavily.
  if (f.runFunnel >= 0.65) {
    if (input.gameScript >= -0.3) {
      adj.reasons.push(
        "Defense funnels rushing — light boxes / weak run interior",
      );
      adj.tags.push("RUN_FUNNEL");
      if (input.propType === "RUSHING_ATTEMPTS") {
        adj.meanMultiplier *= 1.01;
      }
      if (input.propType === "RUSHING_YARDS") {
        adj.meanMultiplier *= 1.02;
      }
    } else {
      adj.risks.push(
        "Run-funnel defense, but team projected to trail — rushing volume capped by script",
      );
    }
  }

  // Slot funnel.
  if (f.slotFunnel >= 0.6) {
    bumpImpact(adj.propImpactStrength, "RECEPTIONS", 1);
    if (
      input.playerRole.archetype === "SLOT_VOLUME_WR" ||
      input.playerRole.archetype === "POSSESSION_WR"
    ) {
      adj.reasons.push(
        "Slot funnel matches player's slot / short-area role — receptions supported",
      );
      adj.tags.push("SLOT_FUNNEL_MATCH");
      if (input.propType === "RECEPTIONS") adj.meanMultiplier *= 1.015;
    }
  }

  // TE funnel.
  if (f.teFunnel >= 0.6 && input.playerRole.archetype === "RECEIVING_TE") {
    adj.reasons.push("TE funnel — defense yields targets to tight ends");
    adj.tags.push("TE_FUNNEL_MATCH");
    if (input.propType === "RECEPTIONS") adj.meanMultiplier *= 1.02;
    if (input.propType === "RECEIVING_YARDS") adj.meanMultiplier *= 1.01;
  }

  // RB receiving funnel — boosted further if pressure is high (QB
  // dumps off to RB).
  if (f.rbReceivingFunnel >= 0.6 && input.playerRole.archetype === "RECEIVING_RB") {
    adj.reasons.push("RB receiving funnel — defense allows targets to backs");
    adj.tags.push("RB_RECEIVING_FUNNEL");
    if (input.propType === "RECEPTIONS") adj.meanMultiplier *= 1.02;
    if (input.pressure.defensePressureRate >= 0.45) {
      adj.reasons.push(
        "High pressure + RB receiving funnel — checkdown environment lifts RB receptions",
      );
    }
  }

  // Deep pass suppression.
  if (f.deepPassSuppression >= 0.65) {
    adj.tags.push("DEEP_SUPPRESSION");
    if (input.propType === "PASSING_YARDS" || input.propType === "RECEIVING_YARDS") {
      adj.risks.push(
        "Defense suppresses deep passing — yardage upside limited",
      );
      adj.stdDevMultiplier *= 1.05;
      adj.meanMultiplier *= 0.99;
    }
    if (input.playerRole.archetype === "OUTSIDE_DEEP_WR") {
      adj.risks.push(
        "Deep WR vs deep-pass-suppression defense — explosive ceiling capped",
      );
      if (input.propType === "RECEIVING_YARDS") {
        adj.meanMultiplier *= 0.98;
        adj.stdDevMultiplier *= 1.05;
      }
    }
  }

  // Light box.
  if (f.lightBoxTendency >= 0.6) {
    adj.tags.push("LIGHT_BOX");
    if (input.propType === "RUSHING_YARDS") {
      adj.reasons.push("Light boxes from defense — RB lane efficiency up");
      adj.meanMultiplier *= 1.01;
    }
  }

  // Stacked box.
  if (f.stackedBoxTendency >= 0.6) {
    adj.tags.push("STACKED_BOX");
    if (input.propType === "RUSHING_YARDS") {
      adj.risks.push("Stacked boxes — RB efficiency at risk");
      adj.meanMultiplier *= 0.99;
      adj.stdDevMultiplier *= 1.05;
    }
  }

  return adj;
}

export function calculateCoverageAdjustment(
  input: MatchupIntelligenceInput,
): PartialAdjustment {
  const adj = emptyAdjustment();
  const c = input.coverage;

  // Man-heavy: separator-dependent.
  if (c.manRate >= 0.6) {
    adj.tags.push("MAN_HEAVY");
    if (input.playerRole.separatorRating >= 0.7) {
      adj.reasons.push(
        "Man-heavy coverage matched by elite separator profile",
      );
      if (
        input.propType === "RECEPTIONS" ||
        input.propType === "RECEIVING_YARDS"
      ) {
        adj.meanMultiplier *= 1.015;
      }
    } else if (input.playerRole.separatorRating < 0.4 && !isQB(input)) {
      adj.risks.push(
        "Man-heavy coverage but player is not a strong separator",
      );
      if (
        input.propType === "RECEPTIONS" ||
        input.propType === "RECEIVING_YARDS"
      ) {
        adj.meanMultiplier *= 0.99;
        adj.stdDevMultiplier *= 1.05;
      }
    }
  }

  // Zone-heavy underneath: completions and short-area receptions.
  if (c.zoneRate >= 0.65) {
    adj.tags.push("ZONE_HEAVY");
    if (isShortAreaPlayer(input) && input.propType === "RECEPTIONS") {
      adj.reasons.push(
        "Zone-heavy underneath coverage favors short-area receptions",
      );
      adj.meanMultiplier *= 1.01;
    }
    if (input.propType === "PASSING_COMPLETIONS") {
      adj.reasons.push(
        "Zone coverage — completion percentage typically holds up",
      );
      adj.meanMultiplier *= 1.005;
    }
  }

  // Two-high.
  if (c.twoHighRate >= 0.65) {
    adj.tags.push("TWO_HIGH");
    if (
      input.propType === "PASSING_YARDS" ||
      input.propType === "RECEIVING_YARDS"
    ) {
      adj.risks.push("Two-high coverage caps deep passing yardage");
      adj.meanMultiplier *= 0.99;
      adj.stdDevMultiplier *= 1.05;
    }
    if (input.propType === "RUSHING_YARDS") {
      adj.reasons.push("Two-high coverage often leaves light boxes for runs");
      adj.meanMultiplier *= 1.005;
    }
  }

  // Blitz-heavy.
  if (c.blitzRate >= 0.4) {
    adj.tags.push("BLITZ_HEAVY");
    if (isShortAreaPlayer(input) && input.propType === "RECEPTIONS") {
      adj.reasons.push(
        "Blitz-heavy defense — quick-game checkdowns lift short-area receptions",
      );
      adj.meanMultiplier *= 1.01;
    }
    if (input.propType === "PASSING_YARDS") {
      adj.risks.push("Blitz pressure complicates deep passing yardage");
      adj.stdDevMultiplier *= 1.05;
    }
    if (input.propType === "RUSHING_YARDS") {
      adj.risks.push("Heavy blitz reduces clean RB lanes");
      adj.meanMultiplier *= 0.99;
    }
  }

  return adj;
}

export function calculatePressureAdjustment(
  input: MatchupIntelligenceInput,
): PartialAdjustment {
  const adj = emptyAdjustment();
  const p = input.pressure;

  // Pressure-with-four × pressure-sensitive QB: passing yards / RY
  // downgraded more than completions.
  if (p.defensePressureWithoutBlitzRate >= 0.45 && p.qbPressureSensitivity >= 0.55) {
    adj.tags.push("PRESSURE_4_VS_SENSITIVE_QB");
    adj.risks.push(
      "Strong four-man rush vs a pressure-sensitive QB — passing yardage at risk",
    );
    if (input.propType === "PASSING_YARDS") {
      adj.meanMultiplier *= 0.98;
      adj.stdDevMultiplier *= 1.1;
      adj.confidenceAdjustment -= 0.05;
    }
    if (input.propType === "RECEIVING_YARDS") {
      adj.meanMultiplier *= 0.985;
      adj.stdDevMultiplier *= 1.08;
    }
    if (input.propType === "PASSING_COMPLETIONS") {
      // less affected than yards
      adj.meanMultiplier *= 0.995;
      adj.stdDevMultiplier *= 1.03;
    }
  }

  // OL injury / continuity risk.
  if (p.oLineContinuityRisk >= 0.5) {
    adj.tags.push("OL_INJURY_RISK");
    adj.risks.push(
      "Offensive line continuity risk — deep passing and run efficiency exposed",
    );
    if (input.propType === "PASSING_YARDS") {
      adj.meanMultiplier *= 0.985;
      adj.stdDevMultiplier *= 1.06;
      adj.confidenceAdjustment -= 0.04;
    }
    if (input.propType === "RUSHING_YARDS") {
      adj.meanMultiplier *= 0.99;
      adj.stdDevMultiplier *= 1.05;
      adj.confidenceAdjustment -= 0.03;
    }
  }

  // Quick-game outlet boost (when defense rushes 4 but QB releases quickly).
  if (p.quickGameOutletBoost >= 0.6 && isShortAreaPlayer(input)) {
    adj.reasons.push(
      "Quick-game outlet environment — short-area target gets schemed lifts",
    );
    if (input.propType === "RECEPTIONS") adj.meanMultiplier *= 1.005;
  }

  return adj;
}

export function calculateReceiverRoleAdjustment(
  input: MatchupIntelligenceInput,
): PartialAdjustment {
  const adj = emptyAdjustment();
  const role = input.playerRole;

  switch (role.archetype) {
    case "OUTSIDE_DEEP_WR":
      if (input.defensiveArchetype === "WEAK_SECONDARY_EXPLOSIVE") {
        adj.reasons.push(
          "Outside deep WR vs explosive-secondary matchup — yardage upside",
        );
        adj.tags.push("DEEP_VS_WEAK_SECONDARY");
        if (input.propType === "RECEIVING_YARDS") {
          adj.meanMultiplier *= 1.02;
        }
      }
      if (input.defensiveFunnel.deepPassSuppression >= 0.65) {
        adj.risks.push(
          "Deep WR role hit by deep-suppression defense — yardage capped",
        );
        adj.tags.push("DEEP_VS_TWO_HIGH");
      }
      break;
    case "SLOT_VOLUME_WR":
      if (
        input.defensiveArchetype === "ZONE_HEAVY_UNDERNEATH" ||
        input.defensiveFunnel.slotFunnel >= 0.6
      ) {
        adj.reasons.push(
          "Slot volume role vs zone / slot-funnel defense — short-area receptions supported",
        );
        adj.tags.push("SLOT_VS_ZONE");
        if (input.propType === "RECEPTIONS") adj.meanMultiplier *= 1.015;
      }
      break;
    case "RECEIVING_TE":
      if (
        input.defensiveArchetype === "PASS_FUNNEL_ZONE" ||
        input.defensiveFunnel.teFunnel >= 0.6
      ) {
        adj.reasons.push(
          "Receiving TE vs TE funnel — receptions favored",
        );
        adj.tags.push("TE_VS_FUNNEL");
        if (input.propType === "RECEPTIONS") adj.meanMultiplier *= 1.015;
      }
      break;
    case "RECEIVING_RB":
      if (input.coverage.blitzRate >= 0.4) {
        adj.reasons.push(
          "Receiving RB vs blitz-heavy defense — checkdown bias",
        );
        adj.tags.push("RB_VS_BLITZ");
        if (input.propType === "RECEPTIONS") adj.meanMultiplier *= 1.02;
      }
      break;
    case "POSSESSION_WR":
      if (input.coverage.zoneRate >= 0.6) {
        adj.reasons.push(
          "Possession WR vs zone-heavy defense — sit-down windows available",
        );
        if (input.propType === "RECEPTIONS") adj.meanMultiplier *= 1.005;
      }
      break;
    default:
      break;
  }

  return adj;
}

export function calculateRunGameAdjustment(
  input: MatchupIntelligenceInput,
): PartialAdjustment {
  const adj = emptyAdjustment();
  const r = input.runGame;

  if (input.propType === "RUSHING_ATTEMPTS" || input.propType === "RUSHING_YARDS") {
    // QB rushing cannibalization.
    if (r.qbRushingCannibalization >= 0.55) {
      adj.risks.push(
        "Mobile QB cannibalizes RB rushing volume — RB attempts/yards capped",
      );
      adj.tags.push("QB_CANNIBALIZATION");
      adj.meanMultiplier *= 0.985;
      adj.confidenceAdjustment -= 0.04;
    }
    // Game script support.
    if (r.gameScriptRushingSupport >= 0.6 && input.gameScript >= 0) {
      adj.reasons.push(
        "Game script supports rushing — favored team likely to grind clock",
      );
      adj.tags.push("SCRIPT_SUPPORTS_RUN");
      adj.meanMultiplier *= 1.015;
    } else if (input.gameScript <= -0.3) {
      adj.risks.push(
        "Team likely to trail — rushing volume / efficiency capped by script",
      );
    }
    // Weather support.
    if (r.weatherRushingSupport >= 0.6 && !input.weather.isDome) {
      adj.reasons.push("Bad weather + heavy run script — rushing volume supported");
      adj.tags.push("WEATHER_BOOSTS_RUN");
    }
    // Run defense.
    if (
      input.defensiveArchetype === "STRONG_RUN_DEFENSE" ||
      r.defenseRunSuccessAllowed <= 0.4
    ) {
      adj.risks.push(
        "Strong run defense — rushing yards efficiency capped",
      );
      if (input.propType === "RUSHING_YARDS") {
        adj.meanMultiplier *= 0.98;
        adj.stdDevMultiplier *= 1.08;
      }
      // Attempts can still hold if team is favored.
      if (input.spreadFavor <= -3) {
        adj.reasons.push(
          "Heavy favorite — RB attempts can hold even vs strong run defense",
        );
      }
    }
  }
  return adj;
}

export function calculateWeatherStyleAdjustment(
  input: MatchupIntelligenceInput,
): PartialAdjustment {
  const adj = emptyAdjustment();
  const w = input.weather;

  // Dome trumps weather — force neutral.
  if (w.isDome) {
    adj.reasons.push("Dome / closed roof — weather signal neutralized");
    adj.tags.push("DOME");
    return adj;
  }

  const isPassingProp =
    input.propType === "PASSING_ATTEMPTS" ||
    input.propType === "PASSING_COMPLETIONS" ||
    input.propType === "PASSING_YARDS" ||
    input.propType === "RECEPTIONS" ||
    input.propType === "RECEIVING_YARDS";
  const isYardageProp = YARDAGE_PROP_TYPES.has(input.propType);

  if (w.windMph >= 15 && isPassingProp) {
    adj.tags.push("WIND");
    adj.risks.push(
      `Wind ~${w.windMph.toFixed(0)} mph — deep passing exposed`,
    );
    if (input.propType === "PASSING_YARDS" || input.propType === "RECEIVING_YARDS") {
      adj.meanMultiplier *= 0.985;
      adj.stdDevMultiplier *= isYardageProp ? 1.12 : 1.06;
      adj.confidenceAdjustment -= 0.04;
    } else if (input.propType === "RECEPTIONS") {
      // Wind hurts short-area receptions LESS than deep yardage —
      // small σ widening, no mean shift.
      adj.stdDevMultiplier *= 1.04;
    }
  }
  if (w.precipitationMm >= 5 && isPassingProp) {
    adj.tags.push("RAIN");
    adj.risks.push("Significant precipitation — ball handling at risk");
    if (input.propType === "PASSING_YARDS" || input.propType === "RECEIVING_YARDS") {
      adj.stdDevMultiplier *= 1.06;
    }
  }
  if (w.snowfallCm >= 2 && isPassingProp) {
    adj.tags.push("SNOW");
    adj.risks.push("Snowfall — deep passing volatility up");
    if (isYardageProp) adj.stdDevMultiplier *= 1.06;
  }
  if (w.temperatureF <= 25) {
    adj.tags.push("COLD");
    if (input.propType === "PASSING_YARDS") {
      adj.risks.push("Sub-25°F game — ball flight degrades");
      adj.stdDevMultiplier *= 1.03;
    }
  }
  // Bad weather may boost rushing volume.
  if (
    (w.windMph >= 18 || w.precipitationMm >= 5 || w.snowfallCm >= 2) &&
    input.propType === "RUSHING_ATTEMPTS"
  ) {
    if (input.runGame.gameScriptRushingSupport >= 0.5) {
      adj.reasons.push(
        "Bad weather + game-script support — rushing attempts favored",
      );
      adj.meanMultiplier *= 1.01;
    }
  }
  return adj;
}

// --- combiner ---------------------------------------------------------

function dampenByDataQuality(
  adj: PartialAdjustment,
  dataQualityScore: number,
): void {
  if (dataQualityScore >= 0.65) return;
  // Below 0.65 data quality, every adjustment is pulled toward neutral.
  const dampening = clamp(dataQualityScore / 0.65, 0.3, 1);
  adj.meanMultiplier = 1 + (adj.meanMultiplier - 1) * dampening;
  adj.stdDevMultiplier = 1 + (adj.stdDevMultiplier - 1) * dampening;
  adj.confidenceAdjustment *= dampening;
  // Risk is allowed to remain — uncertainty doesn't shrink with low data.
}

function dampenRoleDependentSignals(
  adj: PartialAdjustment,
  input: MatchupIntelligenceInput,
): void {
  if (input.roleStabilityScore >= 0.55) return;
  // Low role stability — role-tagged matchup signals dampened toward
  // neutral. Risk is preserved as a warning.
  const roleTags = [
    "SLOT_FUNNEL_MATCH",
    "TE_FUNNEL_MATCH",
    "RB_RECEIVING_FUNNEL",
    "SLOT_VS_ZONE",
    "TE_VS_FUNNEL",
    "RB_VS_BLITZ",
    "DEEP_VS_WEAK_SECONDARY",
  ];
  const hasRoleTag = adj.tags.some((t) => roleTags.includes(t));
  if (!hasRoleTag) return;
  adj.meanMultiplier = 1 + (adj.meanMultiplier - 1) * 0.4;
  adj.risks.push(
    "Role stability low — role-dependent matchup signals dampened",
  );
}

export interface BuildMatchupAdjustmentArgs {
  input: MatchupIntelligenceInput;
}

export function buildMatchupAdjustment(
  args: BuildMatchupAdjustmentArgs,
): MatchupAdjustmentOutput {
  const { input } = args;
  const parts: PartialAdjustment[] = [
    calculateDefensiveFunnelAdjustment(input),
    calculateCoverageAdjustment(input),
    calculatePressureAdjustment(input),
    calculateReceiverRoleAdjustment(input),
    calculateRunGameAdjustment(input),
    calculateWeatherStyleAdjustment(input),
  ];

  // Merge.
  const merged: PartialAdjustment = emptyAdjustment();
  for (const p of parts) {
    merged.meanMultiplier *= p.meanMultiplier;
    merged.stdDevMultiplier *= p.stdDevMultiplier;
    merged.confidenceAdjustment += p.confidenceAdjustment;
    merged.dataQualityAdjustment += p.dataQualityAdjustment;
    merged.riskAdjustment += p.riskAdjustment;
    merged.reasons.push(...p.reasons);
    merged.risks.push(...p.risks);
    merged.tags.push(...p.tags);
    for (const [pt, strength] of Object.entries(p.propImpactStrength)) {
      merged.propImpactStrength[pt as PropType] =
        (merged.propImpactStrength[pt as PropType] ?? 0) + (strength ?? 0);
    }
    for (const [pt, uncertain] of Object.entries(p.propImpactUncertain)) {
      if (uncertain) merged.propImpactUncertain[pt as PropType] = true;
    }
  }

  // Apply context dampening.
  dampenByDataQuality(merged, input.dataQualityScore);
  dampenRoleDependentSignals(merged, input);

  // Yardage-vs-volume σ bias: yardage σ is allowed a wider band.
  if (VOLUME_PROP_TYPES.has(input.propType)) {
    merged.stdDevMultiplier = clamp(
      merged.stdDevMultiplier,
      MIN_STDDEV_MULTIPLIER,
      1.15,
    );
  } else {
    merged.stdDevMultiplier = clamp(
      merged.stdDevMultiplier,
      MIN_STDDEV_MULTIPLIER,
      MAX_STDDEV_MULTIPLIER,
    );
  }

  // Final clamps.
  merged.meanMultiplier = clamp(
    merged.meanMultiplier,
    MIN_MEAN_MULTIPLIER,
    MAX_MEAN_MULTIPLIER,
  );
  merged.confidenceAdjustment = clamp(
    merged.confidenceAdjustment,
    -0.2,
    0.05,
  );
  merged.dataQualityAdjustment = clamp(
    merged.dataQualityAdjustment,
    -0.1,
    0.05,
  );
  merged.riskAdjustment = clamp(merged.riskAdjustment, 0, 0.3);

  // Build the per-prop impact map.
  const propImpacts: PropImpactMap = { ...NEUTRAL_PROP_IMPACTS };
  for (const pt of ALL_V1_PROP_TYPES) {
    const strength = merged.propImpactStrength[pt] ?? 0;
    const uncertain = merged.propImpactUncertain[pt] ?? false;
    propImpacts[pt] = strengthToLabel(strength, uncertain);
  }

  // Deduplicate tags / reasons / risks (preserve order).
  const uniq = (xs: string[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of xs) {
      if (!seen.has(x)) {
        seen.add(x);
        out.push(x);
      }
    }
    return out;
  };

  return {
    projectedMeanMultiplier: merged.meanMultiplier,
    projectedStdDevMultiplier: merged.stdDevMultiplier,
    confidenceAdjustment: merged.confidenceAdjustment,
    dataQualityAdjustment: merged.dataQualityAdjustment,
    riskAdjustment: merged.riskAdjustment,
    reasons: uniq(merged.reasons),
    risks: uniq(merged.risks),
    propImpacts,
    matchupTags: uniq(merged.tags),
  };
}

export function buildMatchupScorecardComponent(
  input: MatchupIntelligenceInput,
  adjustment?: MatchupAdjustmentOutput,
): MatchupScorecardComponent {
  const adj = adjustment ?? buildMatchupAdjustment({ input });
  const summary = `${input.defensiveArchetype} vs ${input.playerRole.archetype} (${input.weather.archetype}); ` +
    `mean ${(adj.projectedMeanMultiplier * 100).toFixed(1)}%, σ ${(adj.projectedStdDevMultiplier * 100).toFixed(0)}%`;
  return {
    defensiveArchetype: input.defensiveArchetype,
    playerRole: input.playerRole.archetype,
    weatherArchetype: input.weather.archetype,
    projectedMeanMultiplier: adj.projectedMeanMultiplier,
    projectedStdDevMultiplier: adj.projectedStdDevMultiplier,
    confidenceAdjustment: adj.confidenceAdjustment,
    propImpacts: adj.propImpacts,
    reasons: adj.reasons,
    risks: adj.risks,
    matchupTags: adj.matchupTags,
    summary,
  };
}
