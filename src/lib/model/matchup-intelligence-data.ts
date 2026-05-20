/**
 * Static matchup archetype library.
 *
 * Each archetype defines a default profile + per-prop impact map.
 * Callers can either reference an archetype + override individual
 * fields, or pass a fully-built input directly.
 */

import type { PropType } from "../types";
import type {
  CoverageProfile,
  DefensiveArchetypeKey,
  DefensiveFunnelProfile,
  ImpactLabel,
  PlayerRoleArchetypeKey,
  PressureProfile,
  PropImpactMap,
  ReceiverRoleProfile,
  WeatherArchetypeKey,
  WeatherStyleProfile,
} from "./matchup-intelligence-types";

export interface DefensiveArchetypeBundle {
  funnel: DefensiveFunnelProfile;
  coverage: CoverageProfile;
  pressure: PressureProfile;
}

const neutralFunnel: DefensiveFunnelProfile = {
  passFunnel: 0.5,
  runFunnel: 0.5,
  slotFunnel: 0.5,
  teFunnel: 0.5,
  rbReceivingFunnel: 0.5,
  deepPassSuppression: 0.5,
  lightBoxTendency: 0.5,
  stackedBoxTendency: 0.5,
};

const neutralCoverage: CoverageProfile = {
  manRate: 0.4,
  zoneRate: 0.6,
  twoHighRate: 0.5,
  singleHighRate: 0.5,
  quartersMatchRate: 0.35,
  blitzRate: 0.27,
  pressureWithoutBlitzRate: 0.32,
};

const neutralPressure: PressureProfile = {
  defensePressureRate: 0.36,
  defensePressureWithoutBlitzRate: 0.30,
  offensePressureAllowedRate: 0.34,
  oLineContinuityRisk: 0.25,
  qbPressureSensitivity: 0.45,
  qbPressureToSackRate: 0.28,
  quickGameOutletBoost: 0.45,
};

export const DEFENSIVE_ARCHETYPES: Record<DefensiveArchetypeKey, DefensiveArchetypeBundle> = {
  PASS_FUNNEL_ZONE: {
    funnel: {
      ...neutralFunnel,
      passFunnel: 0.78,
      runFunnel: 0.32,
      slotFunnel: 0.7,
      teFunnel: 0.65,
      rbReceivingFunnel: 0.6,
      deepPassSuppression: 0.4,
      stackedBoxTendency: 0.6,
    },
    coverage: {
      ...neutralCoverage,
      zoneRate: 0.78,
      manRate: 0.22,
      twoHighRate: 0.55,
    },
    pressure: { ...neutralPressure },
  },
  RUN_FUNNEL_LIGHT_BOX: {
    funnel: {
      ...neutralFunnel,
      passFunnel: 0.3,
      runFunnel: 0.78,
      lightBoxTendency: 0.78,
      stackedBoxTendency: 0.18,
    },
    coverage: {
      ...neutralCoverage,
      twoHighRate: 0.65,
      singleHighRate: 0.35,
    },
    pressure: { ...neutralPressure },
  },
  TWO_HIGH_DEEP_SUPPRESSION: {
    funnel: {
      ...neutralFunnel,
      deepPassSuppression: 0.82,
      lightBoxTendency: 0.68,
      slotFunnel: 0.6,
      teFunnel: 0.55,
    },
    coverage: {
      ...neutralCoverage,
      twoHighRate: 0.82,
      singleHighRate: 0.18,
      quartersMatchRate: 0.6,
    },
    pressure: { ...neutralPressure },
  },
  PRESSURE_WITH_FOUR: {
    funnel: { ...neutralFunnel },
    coverage: { ...neutralCoverage, twoHighRate: 0.55 },
    pressure: {
      ...neutralPressure,
      defensePressureRate: 0.5,
      defensePressureWithoutBlitzRate: 0.55,
    },
  },
  BLITZ_HEAVY: {
    funnel: {
      ...neutralFunnel,
      rbReceivingFunnel: 0.65,
      slotFunnel: 0.6,
      teFunnel: 0.58,
    },
    coverage: {
      ...neutralCoverage,
      blitzRate: 0.45,
      manRate: 0.55,
      singleHighRate: 0.6,
    },
    pressure: {
      ...neutralPressure,
      defensePressureRate: 0.46,
      defensePressureWithoutBlitzRate: 0.22,
      quickGameOutletBoost: 0.72,
    },
  },
  MAN_HEAVY: {
    funnel: { ...neutralFunnel },
    coverage: {
      ...neutralCoverage,
      manRate: 0.7,
      zoneRate: 0.3,
      singleHighRate: 0.6,
    },
    pressure: { ...neutralPressure },
  },
  ZONE_HEAVY_UNDERNEATH: {
    funnel: {
      ...neutralFunnel,
      slotFunnel: 0.68,
      teFunnel: 0.62,
      rbReceivingFunnel: 0.58,
      deepPassSuppression: 0.62,
    },
    coverage: {
      ...neutralCoverage,
      zoneRate: 0.78,
      manRate: 0.22,
      twoHighRate: 0.55,
    },
    pressure: { ...neutralPressure },
  },
  STRONG_RUN_DEFENSE: {
    funnel: {
      ...neutralFunnel,
      runFunnel: 0.22,
      passFunnel: 0.72,
      stackedBoxTendency: 0.62,
      lightBoxTendency: 0.22,
    },
    coverage: { ...neutralCoverage, singleHighRate: 0.6 },
    pressure: { ...neutralPressure },
  },
  WEAK_SECONDARY_EXPLOSIVE: {
    funnel: {
      ...neutralFunnel,
      deepPassSuppression: 0.22,
      passFunnel: 0.6,
    },
    coverage: {
      ...neutralCoverage,
      manRate: 0.5,
      singleHighRate: 0.55,
      twoHighRate: 0.45,
    },
    pressure: { ...neutralPressure },
  },
  BALANCED_NEUTRAL: {
    funnel: { ...neutralFunnel },
    coverage: { ...neutralCoverage },
    pressure: { ...neutralPressure },
  },
};

const _N: ImpactLabel = "NEUTRAL";

export const DEFENSIVE_PROP_IMPACTS: Record<DefensiveArchetypeKey, PropImpactMap> = {
  PASS_FUNNEL_ZONE: {
    PASSING_ATTEMPTS: "POSITIVE",
    PASSING_COMPLETIONS: "POSITIVE",
    PASSING_YARDS: "NEUTRAL",
    RECEPTIONS: "POSITIVE",
    RECEIVING_YARDS: "NEUTRAL",
    RUSHING_ATTEMPTS: "NEGATIVE",
    RUSHING_YARDS: "NEGATIVE",
  },
  RUN_FUNNEL_LIGHT_BOX: {
    PASSING_ATTEMPTS: "NEGATIVE",
    PASSING_COMPLETIONS: "NEUTRAL",
    PASSING_YARDS: "NEGATIVE",
    RECEPTIONS: "NEGATIVE",
    RECEIVING_YARDS: "NEGATIVE",
    RUSHING_ATTEMPTS: "STRONG_POSITIVE",
    RUSHING_YARDS: "STRONG_POSITIVE",
  },
  TWO_HIGH_DEEP_SUPPRESSION: {
    PASSING_ATTEMPTS: _N,
    PASSING_COMPLETIONS: "POSITIVE",
    PASSING_YARDS: "STRONG_NEGATIVE",
    RECEPTIONS: "POSITIVE",
    RECEIVING_YARDS: "NEGATIVE",
    RUSHING_ATTEMPTS: "POSITIVE",
    RUSHING_YARDS: "POSITIVE",
  },
  PRESSURE_WITH_FOUR: {
    PASSING_ATTEMPTS: _N,
    PASSING_COMPLETIONS: "NEGATIVE",
    PASSING_YARDS: "STRONG_NEGATIVE",
    RECEPTIONS: "NEGATIVE",
    RECEIVING_YARDS: "STRONG_NEGATIVE",
    RUSHING_ATTEMPTS: _N,
    RUSHING_YARDS: _N,
  },
  BLITZ_HEAVY: {
    PASSING_ATTEMPTS: _N,
    PASSING_COMPLETIONS: _N,
    PASSING_YARDS: "NEGATIVE",
    RECEPTIONS: "POSITIVE",
    RECEIVING_YARDS: "UNCERTAIN",
    RUSHING_ATTEMPTS: _N,
    RUSHING_YARDS: "NEGATIVE",
  },
  MAN_HEAVY: {
    PASSING_ATTEMPTS: _N,
    PASSING_COMPLETIONS: _N,
    PASSING_YARDS: "UNCERTAIN",
    RECEPTIONS: "UNCERTAIN",
    RECEIVING_YARDS: "UNCERTAIN",
    RUSHING_ATTEMPTS: _N,
    RUSHING_YARDS: _N,
  },
  ZONE_HEAVY_UNDERNEATH: {
    PASSING_ATTEMPTS: _N,
    PASSING_COMPLETIONS: "POSITIVE",
    PASSING_YARDS: _N,
    RECEPTIONS: "POSITIVE",
    RECEIVING_YARDS: "NEGATIVE",
    RUSHING_ATTEMPTS: _N,
    RUSHING_YARDS: _N,
  },
  STRONG_RUN_DEFENSE: {
    PASSING_ATTEMPTS: "POSITIVE",
    PASSING_COMPLETIONS: "POSITIVE",
    PASSING_YARDS: _N,
    RECEPTIONS: "POSITIVE",
    RECEIVING_YARDS: _N,
    RUSHING_ATTEMPTS: "NEGATIVE",
    RUSHING_YARDS: "STRONG_NEGATIVE",
  },
  WEAK_SECONDARY_EXPLOSIVE: {
    PASSING_ATTEMPTS: _N,
    PASSING_COMPLETIONS: "POSITIVE",
    PASSING_YARDS: "STRONG_POSITIVE",
    RECEPTIONS: "POSITIVE",
    RECEIVING_YARDS: "STRONG_POSITIVE",
    RUSHING_ATTEMPTS: _N,
    RUSHING_YARDS: _N,
  },
  BALANCED_NEUTRAL: {
    PASSING_ATTEMPTS: _N,
    PASSING_COMPLETIONS: _N,
    PASSING_YARDS: _N,
    RECEPTIONS: _N,
    RECEIVING_YARDS: _N,
    RUSHING_ATTEMPTS: _N,
    RUSHING_YARDS: _N,
  },
};

export const PLAYER_ROLE_ARCHETYPES: Record<PlayerRoleArchetypeKey, ReceiverRoleProfile> = {
  SLOT_VOLUME_WR: {
    archetype: "SLOT_VOLUME_WR",
    separatorRating: 0.72,
    deepThreatRating: 0.25,
    shortAreaRating: 0.85,
  },
  OUTSIDE_DEEP_WR: {
    archetype: "OUTSIDE_DEEP_WR",
    separatorRating: 0.65,
    deepThreatRating: 0.88,
    shortAreaRating: 0.4,
  },
  POSSESSION_WR: {
    archetype: "POSSESSION_WR",
    separatorRating: 0.6,
    deepThreatRating: 0.35,
    shortAreaRating: 0.75,
  },
  RECEIVING_TE: {
    archetype: "RECEIVING_TE",
    separatorRating: 0.55,
    deepThreatRating: 0.35,
    shortAreaRating: 0.7,
  },
  BLOCKING_TE: {
    archetype: "BLOCKING_TE",
    separatorRating: 0.3,
    deepThreatRating: 0.18,
    shortAreaRating: 0.25,
  },
  RECEIVING_RB: {
    archetype: "RECEIVING_RB",
    separatorRating: 0.5,
    deepThreatRating: 0.18,
    shortAreaRating: 0.72,
  },
  EARLY_DOWN_RB: {
    archetype: "EARLY_DOWN_RB",
    separatorRating: 0.3,
    deepThreatRating: 0.1,
    shortAreaRating: 0.3,
  },
  BELL_COW_RB: {
    archetype: "BELL_COW_RB",
    separatorRating: 0.45,
    deepThreatRating: 0.15,
    shortAreaRating: 0.55,
  },
  MOBILE_QB: {
    archetype: "MOBILE_QB",
    separatorRating: 0,
    deepThreatRating: 0,
    shortAreaRating: 0,
  },
  POCKET_QB: {
    archetype: "POCKET_QB",
    separatorRating: 0,
    deepThreatRating: 0,
    shortAreaRating: 0,
  },
};

export const WEATHER_ARCHETYPES: Record<WeatherArchetypeKey, WeatherStyleProfile> = {
  DOME_NEUTRAL: {
    archetype: "DOME_NEUTRAL",
    isDome: true,
    windMph: 0,
    precipitationMm: 0,
    snowfallCm: 0,
    temperatureF: 70,
  },
  WINDY_OUTDOOR: {
    archetype: "WINDY_OUTDOOR",
    isDome: false,
    windMph: 22,
    precipitationMm: 0,
    snowfallCm: 0,
    temperatureF: 48,
  },
  COLD_WINDY: {
    archetype: "COLD_WINDY",
    isDome: false,
    windMph: 18,
    precipitationMm: 0,
    snowfallCm: 1,
    temperatureF: 24,
  },
  RAINY: {
    archetype: "RAINY",
    isDome: false,
    windMph: 10,
    precipitationMm: 8,
    snowfallCm: 0,
    temperatureF: 52,
  },
  EXTREME_WEATHER: {
    archetype: "EXTREME_WEATHER",
    isDome: false,
    windMph: 30,
    precipitationMm: 4,
    snowfallCm: 8,
    temperatureF: 18,
  },
  WARM_FAST_TRACK: {
    archetype: "WARM_FAST_TRACK",
    isDome: false,
    windMph: 5,
    precipitationMm: 0,
    snowfallCm: 0,
    temperatureF: 78,
  },
};

export const NEUTRAL_PROP_IMPACTS: PropImpactMap = {
  PASSING_ATTEMPTS: _N,
  PASSING_COMPLETIONS: _N,
  PASSING_YARDS: _N,
  RECEPTIONS: _N,
  RECEIVING_YARDS: _N,
  RUSHING_ATTEMPTS: _N,
  RUSHING_YARDS: _N,
};

/** All 7 V1 prop types — used by helpers that need to iterate. */
export const ALL_V1_PROP_TYPES: PropType[] = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
];
