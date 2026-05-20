/**
 * Synthetic prop scenarios — hand-tuned input bundles that probe the
 * V1 model along specific axes. Each scenario carries everything the
 * pipeline needs to produce a recommendation, plus the recommendation
 * we *expect* to see and the reason / risk substring we expect the
 * pipeline to surface.
 *
 * The companion runner is `scripts/test-synthetic-model.ts`: it feeds
 * each scenario through `projectProp` + `qualifyWithFeatures`, then
 * checks (a) the recommendation matches and (b) the expected reason /
 * risk fragments appear in the combined narrative
 * (projection reasons + projection risks + feature-derived reasons +
 * feature-derived risks + qualifier pass-reasons).
 *
 * V1 covers lower-variance props only — no TDs:
 *   PASSING_ATTEMPTS, PASSING_COMPLETIONS, PASSING_YARDS,
 *   RECEPTIONS, RECEIVING_YARDS,
 *   RUSHING_ATTEMPTS, RUSHING_YARDS
 *
 * All scenarios use -110/-110 odds (no-vig over = 50%) so edge ≈
 * modelOverProbability − 0.5. That keeps the gate math obvious.
 */

import type { PropType, Recommendation } from "../types";
import {
  type FullFeatureInputs,
  NEUTRAL_CORRELATION_INPUTS,
  NEUTRAL_GAMESCRIPT_INPUTS,
  NEUTRAL_INJURY_INPUTS,
  NEUTRAL_MARKET_INPUTS,
  NEUTRAL_PACE_INPUTS,
  NEUTRAL_ROLE_INPUTS,
  NEUTRAL_WEATHER_INPUTS,
} from "./feature-framework";
import type { ProjectionContext } from "./prop-projection-engine";

// =====================================================================
// Scenario shape
// =====================================================================

export interface SyntheticScenario {
  name: string;
  description: string;
  propType: PropType;
  line: number;
  overOdds: number;
  underOdds: number;
  projection: ProjectionContext;
  featureInputs: FullFeatureInputs;
  expected: {
    recommendation: Recommendation;
    /** Lowercase-matched substring that should appear in the narrative. */
    reasonFragment?: string;
    /** Lowercase-matched substring that should appear in the narrative. */
    riskFragment?: string;
  };
}

// =====================================================================
// Defaults — every scenario starts here and overrides only what matters
// =====================================================================

const DEFAULT_PROJECTION: ProjectionContext = {
  playerRecentMean: 0,
  playerRecentStdDev: 0,
  playerSeasonMean: 0,
  playerTargetShare: null,
  playerCarryShare: null,
  playerSnapShare: null,
  projectedTeamPlays: 64,
  projectedPassRate: 0.58,
  spread: 0,
  total: 47,
  weatherWind: null,
  weatherPrecip: null,
  weatherDome: false,
  selfStatus: "active",
  teammateAbsenceBoost: false,
  olInjuryOwn: false,
  dbInjuryOpponent: false,
};

/**
 * "Populated neutral" defaults. The fully-null NEUTRAL_*_INPUTS would
 * tank the data-quality score; these defaults fill in benign values
 * (no trend, no movement, mild weather, no injury) so the gate sees a
 * realistic baseline. Each scenario overrides only the group it cares
 * about.
 */
const NEUTRAL_FEATURES: FullFeatureInputs = {
  roleStability: {
    ...NEUTRAL_ROLE_INPUTS,
    snapShareTrend: 0,
    targetShareTrend: 0,
  },
  gameScript: {
    ...NEUTRAL_GAMESCRIPT_INPUTS,
    spread: 0,
    total: 47,
    projectedTeamPlays: 64,
    projectedPassRate: 0.58,
  },
  pace: {
    ...NEUTRAL_PACE_INPUTS,
    projectedTotalPlays: 64,
    secondsPerPlay: 27,
  },
  marketContext: { ...NEUTRAL_MARKET_INPUTS, lineMovement: 0 },
  weatherEnvironment: {
    ...NEUTRAL_WEATHER_INPUTS,
    windSpeed: 8,
    temperature: 55,
    precipitation: 0,
    weatherImpactEligible: true,
  },
  injuryContext: {
    ...NEUTRAL_INJURY_INPUTS,
    playerInjuryUncertainty: 0,
    teammateInjuryRoleBoost: 0,
    offensiveLineInjuryScore: 0,
    defensiveBackInjuryScore: 0,
  },
  correlationExposure: NEUTRAL_CORRELATION_INPUTS,
};

/** Truly-empty inputs — used by the "low data quality" scenario. */
const SPARSE_FEATURES: FullFeatureInputs = {
  roleStability: NEUTRAL_ROLE_INPUTS,
  gameScript: NEUTRAL_GAMESCRIPT_INPUTS,
  pace: NEUTRAL_PACE_INPUTS,
  marketContext: NEUTRAL_MARKET_INPUTS,
  weatherEnvironment: NEUTRAL_WEATHER_INPUTS,
  injuryContext: NEUTRAL_INJURY_INPUTS,
  correlationExposure: NEUTRAL_CORRELATION_INPUTS,
};

function scenario(args: {
  name: string;
  description: string;
  propType: PropType;
  line: number;
  projection: Partial<ProjectionContext>;
  featureInputs?: Partial<FullFeatureInputs>;
  expected: SyntheticScenario["expected"];
}): SyntheticScenario {
  return {
    name: args.name,
    description: args.description,
    propType: args.propType,
    line: args.line,
    overOdds: -110,
    underOdds: -110,
    projection: { ...DEFAULT_PROJECTION, ...args.projection },
    featureInputs: {
      roleStability:
        args.featureInputs?.roleStability ?? NEUTRAL_FEATURES.roleStability,
      gameScript:
        args.featureInputs?.gameScript ?? NEUTRAL_FEATURES.gameScript,
      pace: args.featureInputs?.pace ?? NEUTRAL_FEATURES.pace,
      marketContext:
        args.featureInputs?.marketContext ?? NEUTRAL_FEATURES.marketContext,
      weatherEnvironment:
        args.featureInputs?.weatherEnvironment ??
        NEUTRAL_FEATURES.weatherEnvironment,
      injuryContext:
        args.featureInputs?.injuryContext ?? NEUTRAL_FEATURES.injuryContext,
      correlationExposure:
        args.featureInputs?.correlationExposure ??
        NEUTRAL_FEATURES.correlationExposure,
    },
    expected: args.expected,
  };
}

// =====================================================================
// The 20 scenarios
// =====================================================================

export const SYNTHETIC_SCENARIOS: SyntheticScenario[] = [
  // -------------------------------------------------------------------
  // 1. Strong edge AND stable role -> OVER
  // -------------------------------------------------------------------
  scenario({
    name: "1. Strong edge and stable role",
    description:
      "QB with full role + team-baseline projection well above the posted line.",
    propType: "PASSING_ATTEMPTS",
    line: 32,
    projection: {
      playerRecentMean: 36,
      playerRecentStdDev: 4,
      playerSeasonMean: 35,
      playerSnapShare: 0.98,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
    },
    featureInputs: {
      roleStability: {
        ...NEUTRAL_ROLE_INPUTS,
        snapShareTrend: 0.02,
        targetShareTrend: 0,
      },
      gameScript: { ...NEUTRAL_GAMESCRIPT_INPUTS, spread: -1, total: 47 },
    },
    expected: {
      recommendation: "OVER",
      reasonFragment: "team-derived baseline",
    },
  }),

  // -------------------------------------------------------------------
  // 2. Strong edge BUT unstable role -> PASS
  // -------------------------------------------------------------------
  scenario({
    name: "2. Strong edge but unstable role",
    description:
      "TE with collapsing target share — engine still projects above line, but role score below floor.",
    propType: "RECEPTIONS",
    line: 5.5,
    projection: {
      playerRecentMean: 7,
      playerRecentStdDev: 1.6,
      playerSeasonMean: 6.5,
      playerTargetShare: 0.27,
      projectedTeamPlays: 64,
      projectedPassRate: 0.62,
    },
    featureInputs: {
      roleStability: {
        ...NEUTRAL_ROLE_INPUTS,
        snapShareTrend: -0.06,
        targetShareTrend: -0.1,
        routeParticipationTrend: -0.05,
      },
    },
    expected: {
      recommendation: "PASS",
      reasonFragment: "role stability",
    },
  }),

  // -------------------------------------------------------------------
  // 3. Strong edge BUT injury uncertainty -> PASS
  // -------------------------------------------------------------------
  scenario({
    name: "3. Strong edge but injury uncertainty",
    description:
      "Lead-back with strong volume baseline but flagged with high injury uncertainty.",
    propType: "RUSHING_ATTEMPTS",
    line: 13.5,
    projection: {
      playerRecentMean: 18,
      playerRecentStdDev: 3,
      playerSeasonMean: 17,
      playerCarryShare: 0.65,
      projectedTeamPlays: 62,
      projectedPassRate: 0.55,
    },
    featureInputs: {
      injuryContext: {
        ...NEUTRAL_INJURY_INPUTS,
        playerInjuryUncertainty: 0.75,
      },
    },
    expected: {
      recommendation: "PASS",
      reasonFragment: "injury uncertainty",
    },
  }),

  // -------------------------------------------------------------------
  // 4. Strong edge BUT weather risk -> PASS
  // -------------------------------------------------------------------
  scenario({
    name: "4. Strong edge but weather risk",
    description:
      "Passing-yards prop with strong baseline but high wind at an outdoor stadium.",
    propType: "PASSING_YARDS",
    line: 220,
    projection: {
      playerRecentMean: 290,
      playerRecentStdDev: 40,
      playerSeasonMean: 280,
      projectedTeamPlays: 66,
      projectedPassRate: 0.62,
      weatherWind: 22,
    },
    featureInputs: {
      weatherEnvironment: {
        ...NEUTRAL_WEATHER_INPUTS,
        windSpeed: 22,
        windGust: 30,
        weatherImpactEligible: true,
      },
    },
    expected: {
      recommendation: "PASS",
      reasonFragment: "weather risk",
    },
  }),

  // -------------------------------------------------------------------
  // 5. Strong edge BUT adverse line movement -> OVER (with surfaced risk)
  // Market context doesn't have a hard floor in qualifyWithFeatures,
  // so a strong edge still qualifies; the line-move risk surfaces in
  // the derived risks for the UI.
  // -------------------------------------------------------------------
  scenario({
    name: "5. Strong edge but bad market movement",
    description:
      "Receiving-yards with strong matchup; line moved +1.5 against the model since open.",
    propType: "RECEIVING_YARDS",
    line: 70,
    projection: {
      playerRecentMean: 88,
      playerRecentStdDev: 28,
      playerSeasonMean: 82,
      playerTargetShare: 0.28,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
      dbInjuryOpponent: true,
    },
    featureInputs: {
      marketContext: {
        ...NEUTRAL_MARKET_INPUTS,
        openingLine: 68.5,
        currentLine: 70,
        lineMovement: 1.5,
      },
    },
    expected: {
      recommendation: "OVER",
      riskFragment: "line moved against",
    },
  }),

  // -------------------------------------------------------------------
  // 6. QB attempts boosted by trailing script -> OVER
  // -------------------------------------------------------------------
  scenario({
    name: "6. QB attempts boosted by trailing script",
    description:
      "QB on a team favored to trail; +6 spread triggers the trailing-pass volume boost.",
    propType: "PASSING_ATTEMPTS",
    line: 34,
    projection: {
      playerRecentMean: 34,
      playerRecentStdDev: 4,
      playerSeasonMean: 33,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
      spread: 6,
      total: 49,
    },
    featureInputs: {
      gameScript: {
        ...NEUTRAL_GAMESCRIPT_INPUTS,
        spread: 6,
        total: 49,
        trailingPassVolumeBoost: 3,
      },
    },
    expected: {
      recommendation: "OVER",
      reasonFragment: "trailing-pass",
    },
  }),

  // -------------------------------------------------------------------
  // 7. QB attempts downgraded by big favorite script -> UNDER
  // -------------------------------------------------------------------
  scenario({
    name: "7. QB attempts downgraded by big favorite script",
    description:
      "QB on a heavy favorite (spread -10) — passing volume is dragged down by leading-script run game.",
    propType: "PASSING_ATTEMPTS",
    line: 37,
    projection: {
      playerRecentMean: 36,
      playerRecentStdDev: 4,
      playerSeasonMean: 35,
      projectedTeamPlays: 64,
      projectedPassRate: 0.58,
      spread: -10,
    },
    featureInputs: {
      gameScript: { ...NEUTRAL_GAMESCRIPT_INPUTS, spread: -10, total: 45 },
    },
    expected: {
      recommendation: "UNDER",
      riskFragment: "heavy favorite",
    },
  }),

  // -------------------------------------------------------------------
  // 8. Receptions boosted by teammate injury -> OVER
  // -------------------------------------------------------------------
  scenario({
    name: "8. Receptions boosted by teammate injury",
    description:
      "WR2 absent — alpha receiver absorbs the vacated target share.",
    propType: "RECEPTIONS",
    line: 5.5,
    projection: {
      playerRecentMean: 6.2,
      playerRecentStdDev: 1.6,
      playerSeasonMean: 5.9,
      playerTargetShare: 0.22,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
      teammateAbsenceBoost: true,
    },
    featureInputs: {
      injuryContext: {
        ...NEUTRAL_INJURY_INPUTS,
        teammateInjuryRoleBoost: 0.5,
      },
    },
    expected: {
      recommendation: "OVER",
      reasonFragment: "teammate absence",
    },
  }),

  // -------------------------------------------------------------------
  // 9. Receptions downgraded by teammate return -> PASS (role floor)
  // -------------------------------------------------------------------
  scenario({
    name: "9. Receptions downgraded by teammate return",
    description:
      "Alpha WR2 returning from absence; role-stability score drops below floor.",
    propType: "RECEPTIONS",
    line: 6.5,
    projection: {
      playerRecentMean: 7.2,
      playerRecentStdDev: 1.8,
      playerSeasonMean: 6.4,
      playerTargetShare: 0.27,
      projectedTeamPlays: 64,
      projectedPassRate: 0.62,
    },
    featureInputs: {
      roleStability: {
        ...NEUTRAL_ROLE_INPUTS,
        teammateReturnPenalty: true,
        targetShareTrend: -0.04,
      },
    },
    expected: {
      recommendation: "PASS",
      reasonFragment: "role stability",
    },
  }),

  // -------------------------------------------------------------------
  // 10. Rushing attempts boosted by favorite script -> OVER
  // -------------------------------------------------------------------
  scenario({
    name: "10. Rushing attempts boosted by favorite script",
    description:
      "Lead RB on a -7 favorite — leading-rush volume bump kicks in.",
    propType: "RUSHING_ATTEMPTS",
    line: 14.5,
    projection: {
      playerRecentMean: 18,
      playerRecentStdDev: 3.2,
      playerSeasonMean: 17,
      playerCarryShare: 0.65,
      projectedTeamPlays: 62,
      projectedPassRate: 0.55,
      spread: -7,
    },
    featureInputs: {
      gameScript: { ...NEUTRAL_GAMESCRIPT_INPUTS, spread: -7, total: 44 },
    },
    expected: {
      recommendation: "OVER",
      reasonFragment: "team favored",
    },
  }),

  // -------------------------------------------------------------------
  // 11. Rushing attempts downgraded by underdog script -> UNDER
  // -------------------------------------------------------------------
  scenario({
    name: "11. Rushing attempts downgraded by underdog script",
    description:
      "Lead RB on a +7 dog — engine drags rushing volume and surfaces the negative-script risk.",
    propType: "RUSHING_ATTEMPTS",
    line: 20.5,
    projection: {
      playerRecentMean: 18,
      playerRecentStdDev: 3.4,
      playerSeasonMean: 17,
      playerCarryShare: 0.65,
      projectedTeamPlays: 62,
      projectedPassRate: 0.55,
      spread: 7,
    },
    featureInputs: {
      gameScript: { ...NEUTRAL_GAMESCRIPT_INPUTS, spread: 7, total: 47 },
    },
    expected: {
      recommendation: "UNDER",
      riskFragment: "negative rush script",
    },
  }),

  // -------------------------------------------------------------------
  // 12. Receiving yards downgraded by wind -> PASS (weather floor)
  // -------------------------------------------------------------------
  scenario({
    name: "12. Receiving yards downgraded by wind",
    description:
      "WR1 outdoors with 22 mph wind — weather feature score collapses past the floor.",
    propType: "RECEIVING_YARDS",
    line: 80,
    projection: {
      playerRecentMean: 88,
      playerRecentStdDev: 28,
      playerSeasonMean: 82,
      playerTargetShare: 0.27,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
      weatherWind: 22,
    },
    featureInputs: {
      weatherEnvironment: {
        ...NEUTRAL_WEATHER_INPUTS,
        windSpeed: 22,
        windGust: 32,
        weatherImpactEligible: true,
      },
    },
    expected: {
      recommendation: "PASS",
      riskFragment: "wind",
    },
  }),

  // -------------------------------------------------------------------
  // 13. Passing yards downgraded by pressure + weather -> PASS
  // -------------------------------------------------------------------
  scenario({
    name: "13. Passing yards downgraded by pressure/weather",
    description:
      "QB outdoors with wind 20 mph plus own OL injury — passing-yards mean drops while risk score climbs.",
    propType: "PASSING_YARDS",
    line: 250,
    projection: {
      playerRecentMean: 290,
      playerRecentStdDev: 45,
      playerSeasonMean: 280,
      projectedTeamPlays: 66,
      projectedPassRate: 0.62,
      weatherWind: 20,
      olInjuryOwn: true,
    },
    featureInputs: {
      weatherEnvironment: {
        ...NEUTRAL_WEATHER_INPUTS,
        windSpeed: 20,
        windGust: 28,
        weatherImpactEligible: true,
      },
      injuryContext: {
        ...NEUTRAL_INJURY_INPUTS,
        offensiveLineInjuryScore: 0.6,
      },
    },
    expected: {
      recommendation: "PASS",
      riskFragment: "ol depleted",
    },
  }),

  // -------------------------------------------------------------------
  // 14. Passing completions boosted by clean short-area passing -> OVER
  // -------------------------------------------------------------------
  scenario({
    name: "14. Passing completions boosted by short-area passing",
    description:
      "QB in dome vs depleted secondary — completion baseline holds and DB-injury boost stacks.",
    propType: "PASSING_COMPLETIONS",
    line: 22.5,
    projection: {
      playerRecentMean: 25,
      playerRecentStdDev: 3.4,
      playerSeasonMean: 24,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
      weatherDome: true,
      dbInjuryOpponent: true,
    },
    featureInputs: {
      weatherEnvironment: {
        ...NEUTRAL_WEATHER_INPUTS,
        domeRoofFlag: true,
        weatherImpactEligible: false,
      },
      injuryContext: {
        ...NEUTRAL_INJURY_INPUTS,
        defensiveBackInjuryScore: 0.6,
      },
    },
    expected: {
      recommendation: "OVER",
      reasonFragment: "dbs depleted",
    },
  }),

  // -------------------------------------------------------------------
  // 15. Correlation risk causing downgrade -> PASS
  // -------------------------------------------------------------------
  scenario({
    name: "15. Correlation risk causing downgrade",
    description:
      "Same-game exposure cap reached — strong-edge prop is blocked by the correlation gate.",
    propType: "PASSING_YARDS",
    line: 240,
    projection: {
      playerRecentMean: 285,
      playerRecentStdDev: 40,
      playerSeasonMean: 278,
      projectedTeamPlays: 66,
      projectedPassRate: 0.62,
    },
    featureInputs: {
      correlationExposure: {
        ...NEUTRAL_CORRELATION_INPUTS,
        sameGameExposure: 3,
        sameTeamPassVolumeExposure: 2,
        maxBetsPerGame: 3,
      },
    },
    expected: {
      recommendation: "PASS",
      reasonFragment: "correlation exposure",
    },
  }),

  // -------------------------------------------------------------------
  // 16. Edge too small causing PASS -> PASS
  // -------------------------------------------------------------------
  // Null team-level so the engine falls back to playerRecentMean and
  // the mean lands ~3 yards above the line for a sub-threshold edge.
  scenario({
    name: "16. Edge too small causing PASS",
    description:
      "Yardage prop where model and line are essentially aligned — edge falls below the 6% floor.",
    propType: "PASSING_YARDS",
    line: 290,
    projection: {
      playerRecentMean: 293,
      playerRecentStdDev: 50,
      playerSeasonMean: 291,
      projectedTeamPlays: null,
      projectedPassRate: null,
    },
    expected: {
      recommendation: "PASS",
      reasonFragment: "below 6",
    },
  }),

  // -------------------------------------------------------------------
  // 17. Low data quality causing PASS -> PASS
  // -------------------------------------------------------------------
  scenario({
    name: "17. Low data quality causing PASS",
    description:
      "Every optional input null — data quality drops below the 20 floor.",
    propType: "RECEPTIONS",
    line: 4.5,
    projection: {
      playerRecentMean: 6,
      playerRecentStdDev: 1.6,
      playerSeasonMean: 5.5,
      projectedTeamPlays: null,
      projectedPassRate: null,
      spread: null,
      total: null,
      selfStatus: null,
    },
    // Explicitly opt out of the populated NEUTRAL_FEATURES baseline.
    featureInputs: SPARSE_FEATURES,
    expected: {
      recommendation: "PASS",
      reasonFragment: "data quality",
    },
  }),

  // -------------------------------------------------------------------
  // 18. High-vol yardage prop requiring larger edge -> PASS
  // -------------------------------------------------------------------
  // Null team-level so the engine uses playerRecentMean=84, σ=28.
  // line=80 → edge ≈ +5%, which clears 4-5% thresholds but not the
  // 7% threshold this market demands.
  scenario({
    name: "18. High volatility yardage prop requiring larger edge",
    description:
      "Receiving yards at +5% edge — over the 4-5% thresholds but under the 7% threshold for this market.",
    propType: "RECEIVING_YARDS",
    line: 80,
    projection: {
      playerRecentMean: 84,
      playerRecentStdDev: 28,
      playerSeasonMean: 82,
      projectedTeamPlays: null,
      projectedPassRate: null,
    },
    expected: {
      recommendation: "PASS",
      reasonFragment: "below 7",
    },
  }),

  // -------------------------------------------------------------------
  // 19. Stable volume prop qualifying with smaller edge -> OVER
  // -------------------------------------------------------------------
  // Null team-level so the engine uses playerRecentMean=33.5 σ=3.2.
  // line=32.5 → edge ≈ +5%, which clears the 4% threshold this
  // low-volatility market uses.
  scenario({
    name: "19. Stable volume prop qualifying with smaller edge",
    description:
      "Pass attempts at ~5% edge — clears the 4% threshold even though yardage props wouldn't.",
    propType: "PASSING_ATTEMPTS",
    line: 32.5,
    projection: {
      playerRecentMean: 33.5,
      playerRecentStdDev: 3.2,
      playerSeasonMean: 33,
      playerSnapShare: 0.97,
      projectedTeamPlays: null,
      projectedPassRate: null,
    },
    expected: {
      recommendation: "OVER",
    },
  }),

  // -------------------------------------------------------------------
  // 20. Role trend improving over recent weeks -> OVER
  // -------------------------------------------------------------------
  scenario({
    name: "20. Role trend improving over recent weeks",
    description:
      "WR whose snap and target shares are trending up — role score moves into the positive zone.",
    propType: "RECEPTIONS",
    line: 5.5,
    projection: {
      playerRecentMean: 6.8,
      playerRecentStdDev: 1.5,
      playerSeasonMean: 5.9,
      playerTargetShare: 0.25,
      projectedTeamPlays: 64,
      projectedPassRate: 0.6,
    },
    featureInputs: {
      roleStability: {
        ...NEUTRAL_ROLE_INPUTS,
        snapShareTrend: 0.08,
        targetShareTrend: 0.1,
      },
    },
    expected: {
      recommendation: "OVER",
      reasonFragment: "usage trending up",
    },
  }),
];
