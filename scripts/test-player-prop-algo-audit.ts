/**
 * Player Prop Algorithm v2 — audit-driven test runner.
 *
 * 22 deterministic scenarios designed to verify the audit
 * commitments:
 *   - market is the baseline
 *   - confidence-adjusted edge gates plays (not raw edge alone)
 *   - role stability + line sensitivity are real gates
 *   - proxy / matchup / coaching signals cannot force a bet
 *   - prop-specific thresholds apply
 *   - no touchdown markets are admitted
 *
 * Pure CPU. No API calls. No DB.
 */

import { runPlayerPropPipeline } from "../src/lib/model/player-prop-pipeline";
import type {
  PlayerPropPipelineDecision,
  PlayerPropPipelineInput,
} from "../src/lib/model/player-prop-pipeline";
import type { PropType, Recommendation } from "../src/lib/types";

interface Expectation {
  description: string;
  expectedRecommendation: Recommendation;
  expectedQualified: boolean;
  expectedDisqualifierContains?: string;
  expectedEdgeQualityIn?: Array<
    | "NO_EDGE"
    | "THIN_EDGE"
    | "USABLE_EDGE"
    | "STRONG_EDGE"
    | "SUSPICIOUS_EDGE"
  >;
  expectedMarketDisagreementIn?: Array<
    | "MARKET_ALIGNED"
    | "SMALL_DIFFERENCE"
    | "HEALTHY_EDGE"
    | "DANGEROUS_DISAGREEMENT"
    | "LIKELY_MODEL_OVERCONFIDENCE"
  >;
  expectedLineSensitivityIn?: Array<
    | "STABLE_EDGE"
    | "MILDLY_SENSITIVE"
    | "FRAGILE_EDGE"
    | "EVAPORATES_ON_MOVE"
    | "INSUFFICIENT_DATA"
  >;
  expectedRoleTrendIn?: Array<
    | "STABLE_ROLE"
    | "EXPANDING_ROLE"
    | "DECLINING_ROLE"
    | "VOLATILE_ROLE"
    | "UNKNOWN_ROLE"
  >;
}

interface Scenario {
  name: string;
  input: PlayerPropPipelineInput;
  expectation: Expectation;
}

const SCENARIOS: Scenario[] = [
  // 1. Strong reception edge with stable role qualifies.
  {
    name: "RC-stable-role-strong-edge",
    input: {
      propType: "RECEPTIONS",
      marketLine: 5.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 6.6,
      projectedStdDev: 1.4,
      dataQualityScore: 0.75,
      roleStabilityScore: 0.8,
      injuryContextScore: 0.8,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.75,
      coachingUncertaintyPenalty: 10,
      matchupConfidence: 0.7,
      roleTrendInput: {
        weeklyTargetShare: [0.24, 0.26, 0.27, 0.25, 0.26],
        weeklySnapShare: [0.88, 0.9, 0.92, 0.9, 0.91],
      },
      signals: [
        {
          name: "stable_target_share",
          category: "ROLE",
          deltaPp: 2.5,
          confidence: 0.8,
          independent: true,
        },
        {
          name: "team_pass_volume_lift",
          category: "VOLUME",
          deltaPp: 1.5,
          confidence: 0.7,
          independent: true,
        },
      ],
    },
    expectation: {
      description:
        "Stable target share + strong recent receptions trend → qualifies",
      expectedRecommendation: "OVER",
      expectedQualified: true,
      expectedRoleTrendIn: ["STABLE_ROLE"],
      expectedEdgeQualityIn: ["USABLE_EDGE", "STRONG_EDGE"],
    },
  },
  // 2. Strong reception edge with unstable role passes.
  {
    name: "RC-unstable-role-passes",
    input: {
      propType: "RECEPTIONS",
      marketLine: 4.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 5.8,
      projectedStdDev: 1.8,
      dataQualityScore: 0.7,
      roleStabilityScore: 0.45,
      injuryContextScore: 0.75,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      roleTrendInput: {
        weeklyTargetShare: [0.08, 0.22, 0.05, 0.28, 0.07],
        weeklySnapShare: [0.6, 0.85, 0.5, 0.8, 0.55],
      },
      signals: [],
    },
    expectation: {
      description: "Volatile usage swings block the play even with raw edge",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedDisqualifierContains: "role",
      expectedRoleTrendIn: ["VOLATILE_ROLE", "DECLINING_ROLE"],
    },
  },
  // 3. Strong passing attempts edge in trailing script qualifies.
  {
    name: "PA-trailing-script-qualifies",
    input: {
      propType: "PASSING_ATTEMPTS",
      marketLine: 33.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 38,
      projectedStdDev: 4,
      dataQualityScore: 0.8,
      roleStabilityScore: 0.85,
      injuryContextScore: 0.8,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      coachingUncertaintyPenalty: 12,
      signals: [
        {
          name: "trailing_script_volume",
          category: "VOLUME",
          deltaPp: 3,
          confidence: 0.8,
          independent: true,
        },
        {
          name: "passing_play_caller_lift",
          category: "COACHING",
          deltaPp: 1.5,
          confidence: 0.6,
          independent: true,
        },
      ],
    },
    expectation: {
      description: "Volume + script lift, clean inputs → qualified OVER",
      expectedRecommendation: "OVER",
      expectedQualified: true,
      expectedEdgeQualityIn: ["USABLE_EDGE", "STRONG_EDGE"],
    },
  },
  // 4. Passing attempts huge gap with low confidence → PASS.
  {
    name: "PA-overconfident-disagreement-passes",
    input: {
      propType: "PASSING_ATTEMPTS",
      marketLine: 30.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 42,
      projectedStdDev: 4,
      dataQualityScore: 0.35,
      roleStabilityScore: 0.6,
      injuryContextScore: 0.6,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      coachingUncertaintyPenalty: 40,
      signals: [
        {
          name: "speculative_pass_rate_lift",
          category: "COACHING",
          deltaPp: 6,
          confidence: 0.3,
          independent: false,
        },
      ],
    },
    expectation: {
      description:
        "Huge raw lift but low confidence + low data quality → PASS",
      expectedRecommendation: "PASS",
      expectedQualified: false,
    },
  },
  // 5. Receiving yards in windy weather downgraded.
  {
    name: "RY-wind-downgrade",
    input: {
      propType: "RECEIVING_YARDS",
      marketLine: 72.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 85,
      projectedStdDev: 32,
      dataQualityScore: 0.65,
      roleStabilityScore: 0.7,
      injuryContextScore: 0.7,
      weatherEnvironmentScore: 0.35,
      correlationExposureScore: 0.65,
      signals: [
        {
          name: "weather_wind_suppression",
          category: "WEATHER",
          deltaPp: -3,
          confidence: 0.7,
          independent: true,
        },
      ],
    },
    expectation: {
      description:
        "Wind risk + yardage volatility → PASS via weather floor",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedDisqualifierContains: "Weather",
    },
  },
  // 6. Receiving yards deep-WR in dome remains playable.
  {
    name: "RY-deep-WR-dome-playable",
    input: {
      propType: "RECEIVING_YARDS",
      marketLine: 65.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 82,
      projectedStdDev: 25,
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      injuryContextScore: 0.8,
      weatherEnvironmentScore: 1.0,
      correlationExposureScore: 0.7,
      roleTrendInput: {
        weeklyTargetShare: [0.22, 0.24, 0.26, 0.25, 0.26],
        weeklySnapShare: [0.86, 0.88, 0.9, 0.88, 0.9],
      },
      signals: [
        {
          name: "deep_wr_aDOT_advantage",
          category: "EFFICIENCY",
          deltaPp: 2.5,
          confidence: 0.75,
          independent: true,
        },
        {
          name: "secondary_pressure_proxy",
          category: "MATCHUP",
          deltaPp: 1.5,
          confidence: 0.6,
          independent: true,
        },
      ],
    },
    expectation: {
      description: "Dome + deep WR aDOT clears yardage threshold",
      expectedRecommendation: "OVER",
      expectedQualified: true,
    },
  },
  // 7. Rushing attempts for favored bellcow qualifies.
  {
    name: "RA-favored-bellcow-qualifies",
    input: {
      propType: "RUSHING_ATTEMPTS",
      marketLine: 17.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 20.5,
      projectedStdDev: 3.5,
      dataQualityScore: 0.78,
      roleStabilityScore: 0.85,
      injuryContextScore: 0.8,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      coachingUncertaintyPenalty: 15,
      roleTrendInput: {
        weeklyCarryShare: [0.7, 0.72, 0.7, 0.74, 0.72],
        weeklySnapShare: [0.74, 0.78, 0.76, 0.78, 0.76],
      },
      signals: [
        {
          name: "favorite_game_script",
          category: "VOLUME",
          deltaPp: 3,
          confidence: 0.8,
          independent: true,
        },
        {
          name: "stable_carry_share",
          category: "ROLE",
          deltaPp: 1.5,
          confidence: 0.8,
          independent: true,
        },
      ],
    },
    expectation: {
      description: "Bellcow + favored script → qualified OVER",
      expectedRecommendation: "OVER",
      expectedQualified: true,
    },
  },
  // 8. Rushing attempts underdog committee back passes.
  {
    name: "RA-underdog-committee-passes",
    input: {
      propType: "RUSHING_ATTEMPTS",
      marketLine: 12.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 14,
      projectedStdDev: 4,
      dataQualityScore: 0.6,
      roleStabilityScore: 0.4,
      injuryContextScore: 0.7,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      roleTrendInput: {
        weeklyCarryShare: [0.3, 0.45, 0.25, 0.5, 0.3],
        weeklySnapShare: [0.5, 0.7, 0.45, 0.65, 0.5],
      },
      signals: [],
    },
    expectation: {
      description: "Underdog committee back with role instability → PASS",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedDisqualifierContains: "role",
    },
  },
  // 9. Passing yards with pressure risk downgraded.
  //    Projection is strongly bullish (μ=285 vs line 234.5) so the
  //    raw edge clears its threshold — the disqualifier should be
  //    INJURY CONTEXT, not edge threshold.
  {
    name: "PY-pressure-downgrade",
    input: {
      propType: "PASSING_YARDS",
      marketLine: 234.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 285,
      projectedStdDev: 60,
      dataQualityScore: 0.7,
      roleStabilityScore: 0.78,
      injuryContextScore: 0.45,
      weatherEnvironmentScore: 0.75,
      correlationExposureScore: 0.6,
      coachingUncertaintyPenalty: 12,
      signals: [
        {
          name: "ol_injury_pressure",
          category: "MATCHUP",
          deltaPp: -3,
          confidence: 0.7,
          independent: true,
        },
        {
          name: "opp_pressure_advantage",
          category: "MATCHUP",
          deltaPp: -2.5,
          confidence: 0.7,
          independent: true,
        },
      ],
    },
    expectation: {
      description: "Pressure + OL injury hits PY → PASS via injury context",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedDisqualifierContains: "Injury",
    },
  },
  // 10. Passing completions with quick-game proxy qualifies.
  {
    name: "PC-quick-game-qualifies",
    input: {
      propType: "PASSING_COMPLETIONS",
      marketLine: 23.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 26.5,
      projectedStdDev: 3,
      dataQualityScore: 0.78,
      roleStabilityScore: 0.8,
      injuryContextScore: 0.78,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      proxyConfidence: 0.75,
      signals: [
        {
          name: "quick_game_proxy",
          category: "EFFICIENCY",
          deltaPp: 2.5,
          confidence: 0.75,
          independent: true,
        },
        {
          name: "completion_friendly_matchup",
          category: "MATCHUP",
          deltaPp: 1.5,
          confidence: 0.65,
          independent: true,
        },
      ],
    },
    expectation: {
      description: "Quick game + completion-friendly matchup → qualified",
      expectedRecommendation: "OVER",
      expectedQualified: true,
    },
  },
  // 11. Coaching uncertainty turns marginal edge into PASS.
  //     Projection is only mildly bullish; coaching penalty 65 bumps
  //     the edge threshold from 4pp to 5.5pp so the marginal raw
  //     edge can't clear.
  {
    name: "PA-coaching-uncertainty-flips-pass",
    input: {
      propType: "PASSING_ATTEMPTS",
      marketLine: 32.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 33.5,
      projectedStdDev: 4.5,
      dataQualityScore: 0.7,
      roleStabilityScore: 0.75,
      injuryContextScore: 0.7,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.65,
      coachingUncertaintyPenalty: 65,
      signals: [],
    },
    expectation: {
      description: "Marginal edge swamped by coaching uncertainty",
      expectedRecommendation: "PASS",
      expectedQualified: false,
    },
  },
  // 12. High data quality allows a larger market adjustment.
  {
    name: "RY-high-DQ-allows-bigger-adjustment",
    input: {
      propType: "RECEIVING_YARDS",
      marketLine: 70.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 84,
      projectedStdDev: 26,
      dataQualityScore: 0.85,
      roleStabilityScore: 0.78,
      injuryContextScore: 0.78,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      matchupConfidence: 0.75,
      signals: [
        {
          name: "elite_target_share",
          category: "ROLE",
          deltaPp: 2.5,
          confidence: 0.8,
          independent: true,
        },
        {
          name: "weak_secondary_matchup",
          category: "MATCHUP",
          deltaPp: 2.5,
          confidence: 0.75,
          independent: true,
        },
        {
          name: "aDOT_advantage",
          category: "EFFICIENCY",
          deltaPp: 2,
          confidence: 0.7,
          independent: true,
        },
      ],
    },
    expectation: {
      description: "High DQ + multi-signal → larger adjustment, qualifies",
      expectedRecommendation: "OVER",
      expectedQualified: true,
      expectedMarketDisagreementIn: [
        "SMALL_DIFFERENCE",
        "HEALTHY_EDGE",
        "MARKET_ALIGNED",
      ],
    },
  },
  // 13. Low data quality caps the market adjustment.
  {
    name: "RY-low-DQ-caps-adjustment",
    input: {
      propType: "RECEIVING_YARDS",
      marketLine: 60.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 95,
      projectedStdDev: 30,
      dataQualityScore: 0.35,
      roleStabilityScore: 0.55,
      injuryContextScore: 0.6,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.65,
      signals: [
        {
          name: "speculative_role_lift",
          category: "ROLE",
          deltaPp: 8,
          confidence: 0.4,
          independent: false,
        },
      ],
    },
    expectation: {
      description: "Low DQ disqualifies even with a strong projection",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedDisqualifierContains: "Data quality",
    },
  },
  // 14. Proxy-only signal cannot qualify a bet.
  {
    name: "PA-proxy-only-passes",
    input: {
      propType: "PASSING_ATTEMPTS",
      marketLine: 31.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 31.8,
      projectedStdDev: 4.5,
      dataQualityScore: 0.65,
      roleStabilityScore: 0.7,
      injuryContextScore: 0.7,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.65,
      proxyConfidence: 0.5,
      signals: [
        {
          name: "proxy_only_pass_rate_lift",
          category: "MATCHUP",
          deltaPp: 4,
          confidence: 0.5,
          independent: false,
        },
      ],
    },
    expectation: {
      description: "Proxy-only signal cannot bridge to a play",
      expectedRecommendation: "PASS",
      expectedQualified: false,
    },
  },
  // 15. Matchup-only signal cannot qualify a bet.
  {
    name: "PY-matchup-only-passes",
    input: {
      propType: "PASSING_YARDS",
      marketLine: 240.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 245,
      projectedStdDev: 55,
      dataQualityScore: 0.6,
      roleStabilityScore: 0.7,
      injuryContextScore: 0.7,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.65,
      matchupConfidence: 0.55,
      signals: [
        {
          name: "matchup_only_pass_lift",
          category: "MATCHUP",
          deltaPp: 4,
          confidence: 0.5,
          independent: false,
        },
      ],
    },
    expectation: {
      description: "Matchup signal alone cannot bridge to a play",
      expectedRecommendation: "PASS",
      expectedQualified: false,
    },
  },
  // 16. Line fragility turns thin edge into pass.
  {
    name: "RC-line-fragility-passes",
    input: {
      propType: "RECEPTIONS",
      marketLine: 4.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 4.7,
      projectedStdDev: 0.5,
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      injuryContextScore: 0.78,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      roleTrendInput: {
        weeklyTargetShare: [0.18, 0.2, 0.19, 0.2, 0.21],
        weeklySnapShare: [0.78, 0.8, 0.78, 0.8, 0.78],
      },
      signals: [],
    },
    expectation: {
      description: "Tiny mean offset + razor σ → fragile edge passes",
      expectedRecommendation: "PASS",
      expectedQualified: false,
    },
  },
  // 17. Confidence-adjusted edge < raw edge under high risk.
  {
    name: "RY-confidence-adjusted-less-than-raw",
    input: {
      propType: "RECEIVING_YARDS",
      marketLine: 72.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 100,
      projectedStdDev: 36,
      dataQualityScore: 0.4,
      roleStabilityScore: 0.5,
      injuryContextScore: 0.55,
      weatherEnvironmentScore: 0.6,
      correlationExposureScore: 0.6,
      coachingUncertaintyPenalty: 40,
      signals: [
        {
          name: "single_efficiency_signal",
          category: "EFFICIENCY",
          deltaPp: 4,
          confidence: 0.5,
          independent: true,
        },
      ],
    },
    expectation: {
      description:
        "High raw edge but confidence-adjusted edge is much smaller — PASS",
      expectedRecommendation: "PASS",
      expectedQualified: false,
    },
  },
  // 18. Huge raw edge with low confidence → SUSPICIOUS.
  {
    name: "PA-suspicious-edge",
    input: {
      propType: "PASSING_ATTEMPTS",
      marketLine: 30.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 45,
      projectedStdDev: 4,
      dataQualityScore: 0.35,
      roleStabilityScore: 0.5,
      injuryContextScore: 0.55,
      weatherEnvironmentScore: 0.6,
      correlationExposureScore: 0.55,
      coachingUncertaintyPenalty: 40,
      signals: [
        {
          name: "speculative_volume_lift",
          category: "VOLUME",
          deltaPp: 10,
          confidence: 0.35,
          independent: false,
        },
      ],
    },
    expectation: {
      description:
        "Huge model lift with low confidence — must classify SUSPICIOUS and PASS",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedEdgeQualityIn: ["SUSPICIOUS_EDGE"],
    },
  },
  // 19. Stable but tiny target share does not qualify as role stability.
  {
    name: "RC-tiny-but-flat-target-share",
    input: {
      propType: "RECEPTIONS",
      marketLine: 1.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 2.1,
      projectedStdDev: 0.9,
      dataQualityScore: 0.65,
      roleStabilityScore: 0.7,
      injuryContextScore: 0.7,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.65,
      roleTrendInput: {
        weeklyTargetShare: [0.03, 0.03, 0.04, 0.03, 0.03],
        weeklySnapShare: [0.4, 0.42, 0.41, 0.4, 0.4],
      },
      signals: [],
    },
    expectation: {
      description:
        "Tiny but flat target share → UNKNOWN_ROLE, blocked despite raw edge",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedRoleTrendIn: ["UNKNOWN_ROLE"],
    },
  },
  // 20. Correlation risk blocks an otherwise qualified prop.
  {
    name: "RY-correlation-blocks-otherwise-good",
    input: {
      propType: "RECEIVING_YARDS",
      marketLine: 65.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 80,
      projectedStdDev: 26,
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      injuryContextScore: 0.78,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.3,
      signals: [],
    },
    expectation: {
      description: "Same-game correlation blocks the play",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedDisqualifierContains: "Correlation",
    },
  },
  // 21. Yardage prop requires stronger threshold than volume prop.
  //     The exact same projection profile that would clear the
  //     RECEPTIONS threshold (5pp) is below the RECEIVING_YARDS
  //     threshold (6.5pp + 0.5pp yardage bump = 7pp).
  {
    name: "RY-tighter-threshold-than-volume",
    input: {
      propType: "RECEIVING_YARDS",
      marketLine: 64.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 70,
      projectedStdDev: 30,
      dataQualityScore: 0.68,
      roleStabilityScore: 0.7,
      injuryContextScore: 0.7,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      roleTrendInput: {
        weeklyTargetShare: [0.18, 0.2, 0.19, 0.2, 0.19],
        weeklySnapShare: [0.8, 0.82, 0.8, 0.82, 0.8],
      },
      signals: [],
    },
    expectation: {
      description:
        "Yardage prop with thin edge fails its higher threshold",
      expectedRecommendation: "PASS",
      expectedQualified: false,
    },
  },
  // 22. Market-aligned prop becomes PASS.
  {
    name: "RC-market-aligned-passes",
    input: {
      propType: "RECEPTIONS",
      marketLine: 5.5,
      overOdds: -110,
      underOdds: -110,
      projectedMean: 5.55,
      projectedStdDev: 1.5,
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      injuryContextScore: 0.78,
      weatherEnvironmentScore: 0.85,
      correlationExposureScore: 0.7,
      roleTrendInput: {
        weeklyTargetShare: [0.22, 0.23, 0.22, 0.24, 0.22],
        weeklySnapShare: [0.82, 0.84, 0.82, 0.84, 0.84],
      },
      signals: [],
    },
    expectation: {
      description: "Model aligned with market → PASS / No Edge",
      expectedRecommendation: "PASS",
      expectedQualified: false,
      expectedMarketDisagreementIn: ["MARKET_ALIGNED", "SMALL_DIFFERENCE"],
    },
  },
];

interface FailureReport {
  scenarioName: string;
  reasons: string[];
}

const ALLOWED: PropType[] = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
];

function universalInvariants(
  scenario: Scenario,
  decision: PlayerPropPipelineDecision,
): string[] {
  const failures: string[] = [];
  if (!ALLOWED.includes(decision.propType)) {
    failures.push(`UNIVERSAL: rejected non-V1 propType ${decision.propType}`);
  }
  if (decision.confidenceAdjustedEdge === undefined) {
    failures.push("UNIVERSAL: confidence-adjusted edge missing");
  }
  if (!decision.marketDisagreement.classification) {
    failures.push("UNIVERSAL: market disagreement classification missing");
  }
  if (!decision.lineSensitivity.lineSensitivityLabel) {
    failures.push("UNIVERSAL: line sensitivity label missing");
  }
  if (decision.trace.length < 10) {
    failures.push(
      `UNIVERSAL: debug trace incomplete (${decision.trace.length} steps)`,
    );
  }
  // Heuristic: confidence-adjusted edge should never exceed |raw edge|.
  if (
    Math.abs(decision.confidenceAdjustedEdge) >
    Math.abs(decision.rawEdge) + 1e-6
  ) {
    failures.push(
      `UNIVERSAL: confidenceAdjustedEdge ${decision.confidenceAdjustedEdge.toFixed(4)} > rawEdge ${decision.rawEdge.toFixed(4)}`,
    );
  }
  // No touchdown leaks: scenario inputs cannot have TD-like propType.
  const propTypeText = String(decision.propType).toUpperCase();
  if (propTypeText.includes("TD")) {
    failures.push("UNIVERSAL: touchdown propType detected");
  }
  return failures;
}

function evaluate(scenario: Scenario): FailureReport | null {
  const decision = runPlayerPropPipeline(scenario.input);
  const failures = universalInvariants(scenario, decision);
  const exp = scenario.expectation;
  if (decision.recommendation !== exp.expectedRecommendation) {
    failures.push(
      `recommendation ${decision.recommendation} ≠ expected ${exp.expectedRecommendation}`,
    );
  }
  if (decision.qualified !== exp.expectedQualified) {
    failures.push(
      `qualified ${decision.qualified} ≠ expected ${exp.expectedQualified}`,
    );
  }
  if (!exp.expectedQualified && exp.expectedDisqualifierContains) {
    const text = decision.qualification.primaryDisqualifier ?? "";
    if (!text.toLowerCase().includes(exp.expectedDisqualifierContains.toLowerCase())) {
      failures.push(
        `primary disqualifier "${text}" does not contain "${exp.expectedDisqualifierContains}"`,
      );
    }
  }
  if (
    exp.expectedEdgeQualityIn &&
    !exp.expectedEdgeQualityIn.includes(
      decision.confidenceAdjusted.edgeQualityClassification,
    )
  ) {
    failures.push(
      `edge quality ${decision.confidenceAdjusted.edgeQualityClassification} not in [${exp.expectedEdgeQualityIn.join(", ")}]`,
    );
  }
  if (
    exp.expectedMarketDisagreementIn &&
    !exp.expectedMarketDisagreementIn.includes(
      decision.marketDisagreement.classification,
    )
  ) {
    failures.push(
      `market disagreement ${decision.marketDisagreement.classification} not in [${exp.expectedMarketDisagreementIn.join(", ")}]`,
    );
  }
  if (
    exp.expectedLineSensitivityIn &&
    !exp.expectedLineSensitivityIn.includes(
      decision.lineSensitivity.lineSensitivityLabel,
    )
  ) {
    failures.push(
      `line sensitivity ${decision.lineSensitivity.lineSensitivityLabel} not in [${exp.expectedLineSensitivityIn.join(", ")}]`,
    );
  }
  if (
    exp.expectedRoleTrendIn &&
    !exp.expectedRoleTrendIn.includes(
      decision.roleTrend?.classification ?? "UNKNOWN_ROLE",
    )
  ) {
    failures.push(
      `role trend ${decision.roleTrend?.classification ?? "UNKNOWN_ROLE"} not in [${exp.expectedRoleTrendIn.join(", ")}]`,
    );
  }

  if (failures.length === 0) return null;
  return { scenarioName: scenario.name, reasons: failures };
}

function main(): void {
  console.log("Player prop algorithm v2 — scenario runner");
  console.log("============================================");
  const failed: FailureReport[] = [];
  let pass = 0;
  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const decision = runPlayerPropPipeline(sc.input);
    const result = evaluate(sc);
    if (!result) {
      pass += 1;
      console.log(
        `[${i + 1}/${SCENARIOS.length}] PASS — ${sc.name} (${sc.input.propType}): ${decision.recommendation} ${decision.qualified ? "QUALIFIED" : "PASS"} (edge ${(decision.rawEdge * 100).toFixed(2)}pp, conf-adj ${(decision.confidenceAdjustedEdge * 100).toFixed(2)}pp, ${decision.confidenceAdjusted.edgeQualityClassification})`,
      );
    } else {
      failed.push(result);
      console.log(
        `[${i + 1}/${SCENARIOS.length}] FAIL — ${sc.name} (${sc.input.propType}): ${decision.recommendation}`,
      );
      for (const r of result.reasons) console.log(`     · ${r}`);
    }
    console.log(`     scenario: ${sc.expectation.description}`);
  }
  console.log("");
  console.log(`Result: ${pass}/${SCENARIOS.length} scenarios passed`);
  console.log("Universal invariants asserted across every scenario:");
  console.log("  · only V1 prop types — no touchdown props");
  console.log("  · confidence-adjusted edge exists and ≤ |raw edge|");
  console.log("  · market disagreement classification present");
  console.log("  · line sensitivity classification present");
  console.log("  · debug trace ≥ 10 steps");

  if (failed.length > 0) {
    console.log(`\n${failed.length} scenario(s) failed. Exiting non-zero.`);
    process.exit(1);
  }
}

main();
