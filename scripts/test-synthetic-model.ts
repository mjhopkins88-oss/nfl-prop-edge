import {
  buildPropDecisionScorecard,
  getPrimaryDisqualifier,
  type ScorecardInput,
} from "../src/lib/model/model-scorecard";
import {
  SAMPLE_NEW_HC_OC_QB,
  SAMPLE_SAME_STAFF,
  type CoachingContinuityInput,
} from "../src/lib/model/coaching-transition";
import type { PropType, Recommendation } from "../src/lib/types";

interface Scenario {
  scenarioName: string;
  playerName: string;
  propType: PropType;
  marketLine: number;
  overOdds: number;
  underOdds: number;
  coachingContext?: CoachingContinuityInput;
  projectedMean: number;
  projectedStdDev: number;
  dataQualityScore: number;
  roleStabilityScore: number;
  gameScriptScore: number;
  paceScore: number;
  marketContextScore: number;
  weatherEnvironmentScore: number;
  injuryContextScore: number;
  correlationExposureScore: number;
  expected: {
    qualified: boolean;
    recommendation: Recommendation;
    primaryDisqualifierIncludes?: string;
  };
}

interface RiskScores {
  dataQualityScore: number;
  roleStabilityScore: number;
  gameScriptScore: number;
  paceScore: number;
  marketContextScore: number;
  weatherEnvironmentScore: number;
  injuryContextScore: number;
  correlationExposureScore: number;
}

const GREEN: RiskScores = {
  dataQualityScore: 0.8,
  roleStabilityScore: 0.8,
  gameScriptScore: 0.8,
  paceScore: 0.8,
  marketContextScore: 0.8,
  weatherEnvironmentScore: 0.8,
  injuryContextScore: 0.8,
  correlationExposureScore: 0.8,
};

function risks(overrides: Partial<RiskScores> = {}): RiskScores {
  return { ...GREEN, ...overrides };
}

const scenarios: Scenario[] = [
  // 1. Qualified OVER — passing yards
  {
    scenarioName: "PY-OVER-strong",
    playerName: "Patrick Mahomes",
    propType: "PASSING_YARDS",
    marketLine: 248.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 268,
    projectedStdDev: 45,
    ...risks(),
    expected: { qualified: true, recommendation: "OVER" },
  },
  // 2. Qualified OVER — passing attempts (juiced)
  {
    scenarioName: "PA-OVER-strong",
    playerName: "Josh Allen",
    propType: "PASSING_ATTEMPTS",
    marketLine: 32.5,
    overOdds: -115,
    underOdds: -105,
    projectedMean: 36,
    projectedStdDev: 4.5,
    ...risks({
      dataQualityScore: 0.75,
      roleStabilityScore: 0.75,
      gameScriptScore: 0.75,
      paceScore: 0.75,
      marketContextScore: 0.75,
      weatherEnvironmentScore: 0.75,
      injuryContextScore: 0.75,
      correlationExposureScore: 0.75,
    }),
    expected: { qualified: true, recommendation: "OVER" },
  },
  // 3. Qualified UNDER — passing completions
  {
    scenarioName: "PC-UNDER-strong",
    playerName: "Joe Burrow",
    propType: "PASSING_COMPLETIONS",
    marketLine: 24.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 21,
    projectedStdDev: 3,
    ...risks({
      dataQualityScore: 0.75,
      roleStabilityScore: 0.75,
      gameScriptScore: 0.75,
      paceScore: 0.75,
      marketContextScore: 0.75,
      weatherEnvironmentScore: 0.75,
      injuryContextScore: 0.75,
      correlationExposureScore: 0.75,
    }),
    expected: { qualified: true, recommendation: "UNDER" },
  },
  // 4. Qualified OVER — receptions
  {
    scenarioName: "REC-OVER-strong",
    playerName: "Stefon Diggs",
    propType: "RECEPTIONS",
    marketLine: 5.5,
    overOdds: -120,
    underOdds: 100,
    projectedMean: 7.2,
    projectedStdDev: 2.0,
    ...risks({
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      gameScriptScore: 0.78,
      paceScore: 0.78,
      marketContextScore: 0.78,
      weatherEnvironmentScore: 0.78,
      injuryContextScore: 0.78,
      correlationExposureScore: 0.78,
    }),
    expected: { qualified: true, recommendation: "OVER" },
  },
  // 5. Qualified OVER — receiving yards
  {
    scenarioName: "RY-OVER-strong",
    playerName: "Justin Jefferson",
    propType: "RECEIVING_YARDS",
    marketLine: 68.5,
    overOdds: -115,
    underOdds: -105,
    projectedMean: 86,
    projectedStdDev: 24,
    ...risks({
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      gameScriptScore: 0.78,
      paceScore: 0.78,
      marketContextScore: 0.78,
      weatherEnvironmentScore: 0.78,
      injuryContextScore: 0.78,
      correlationExposureScore: 0.78,
    }),
    expected: { qualified: true, recommendation: "OVER" },
  },
  // 6. Qualified OVER — rushing attempts (workhorse)
  {
    scenarioName: "RA-OVER-workhorse",
    playerName: "Derrick Henry",
    propType: "RUSHING_ATTEMPTS",
    marketLine: 17.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 22,
    projectedStdDev: 3.5,
    ...risks({
      dataQualityScore: 0.82,
      roleStabilityScore: 0.82,
      gameScriptScore: 0.82,
      paceScore: 0.82,
      marketContextScore: 0.82,
      weatherEnvironmentScore: 0.82,
      injuryContextScore: 0.82,
      correlationExposureScore: 0.82,
    }),
    expected: { qualified: true, recommendation: "OVER" },
  },
  // 7. Qualified UNDER — rushing yards vs tough D
  {
    scenarioName: "RY-rush-UNDER-tough-D",
    playerName: "Christian McCaffrey",
    propType: "RUSHING_YARDS",
    marketLine: 75.5,
    overOdds: 100,
    underOdds: -120,
    projectedMean: 58,
    projectedStdDev: 22,
    ...risks({
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      gameScriptScore: 0.78,
      paceScore: 0.78,
      marketContextScore: 0.78,
      weatherEnvironmentScore: 0.78,
      injuryContextScore: 0.78,
      correlationExposureScore: 0.78,
    }),
    expected: { qualified: true, recommendation: "UNDER" },
  },
  // 8. Qualified OVER — second passing yards play
  {
    scenarioName: "PY-OVER-clean",
    playerName: "Justin Herbert",
    propType: "PASSING_YARDS",
    marketLine: 232.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 256,
    projectedStdDev: 45,
    ...risks({
      dataQualityScore: 0.7,
      roleStabilityScore: 0.7,
      gameScriptScore: 0.7,
      paceScore: 0.7,
      marketContextScore: 0.7,
      weatherEnvironmentScore: 0.7,
      injuryContextScore: 0.7,
      correlationExposureScore: 0.7,
    }),
    expected: { qualified: true, recommendation: "OVER" },
  },
  // 9. Qualified OVER — rushing yards
  {
    scenarioName: "RY-rush-OVER",
    playerName: "Joe Mixon",
    propType: "RUSHING_YARDS",
    marketLine: 62.5,
    overOdds: -105,
    underOdds: -115,
    projectedMean: 80,
    projectedStdDev: 22,
    ...risks({
      dataQualityScore: 0.74,
      roleStabilityScore: 0.74,
      gameScriptScore: 0.74,
      paceScore: 0.74,
      marketContextScore: 0.74,
      weatherEnvironmentScore: 0.74,
      injuryContextScore: 0.74,
      correlationExposureScore: 0.74,
    }),
    expected: { qualified: true, recommendation: "OVER" },
  },
  // 10. Qualified UNDER — receptions in shadow coverage
  {
    scenarioName: "REC-UNDER-shadow",
    playerName: "Cooper Kupp",
    propType: "RECEPTIONS",
    marketLine: 6.5,
    overOdds: -115,
    underOdds: -105,
    projectedMean: 4.5,
    projectedStdDev: 1.8,
    ...risks({
      dataQualityScore: 0.76,
      roleStabilityScore: 0.76,
      gameScriptScore: 0.76,
      paceScore: 0.76,
      marketContextScore: 0.76,
      weatherEnvironmentScore: 0.76,
      injuryContextScore: 0.76,
      correlationExposureScore: 0.76,
    }),
    expected: { qualified: true, recommendation: "UNDER" },
  },
  // 11. PASS — edge below threshold (passing yards)
  {
    scenarioName: "PY-thin-edge",
    playerName: "Jared Goff",
    propType: "PASSING_YARDS",
    marketLine: 248.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 252,
    projectedStdDev: 50,
    ...risks({
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      gameScriptScore: 0.78,
      paceScore: 0.78,
      marketContextScore: 0.78,
      weatherEnvironmentScore: 0.78,
      injuryContextScore: 0.78,
      correlationExposureScore: 0.78,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "edge",
    },
  },
  // 12. PASS — edge below threshold (receiving yards)
  {
    scenarioName: "RY-thin-edge",
    playerName: "Chris Olave",
    propType: "RECEIVING_YARDS",
    marketLine: 72.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 74,
    projectedStdDev: 25,
    ...risks({
      dataQualityScore: 0.72,
      roleStabilityScore: 0.72,
      gameScriptScore: 0.72,
      paceScore: 0.72,
      marketContextScore: 0.72,
      weatherEnvironmentScore: 0.72,
      injuryContextScore: 0.72,
      correlationExposureScore: 0.72,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "edge",
    },
  },
  // 13. PASS — edge below threshold (passing attempts)
  {
    scenarioName: "PA-thin-edge",
    playerName: "Tua Tagovailoa",
    propType: "PASSING_ATTEMPTS",
    marketLine: 32.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 32.85,
    projectedStdDev: 4,
    ...risks({
      dataQualityScore: 0.78,
      roleStabilityScore: 0.78,
      gameScriptScore: 0.78,
      paceScore: 0.78,
      marketContextScore: 0.78,
      weatherEnvironmentScore: 0.78,
      injuryContextScore: 0.78,
      correlationExposureScore: 0.78,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "edge",
    },
  },
  // 14. PASS — strong edge but role stability blocks (snap share unclear)
  {
    scenarioName: "RY-rush-role-instability",
    playerName: "Jamaal Williams",
    propType: "RUSHING_YARDS",
    marketLine: 60.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 78,
    projectedStdDev: 22,
    ...risks({
      roleStabilityScore: 0.35,
      dataQualityScore: 0.72,
      gameScriptScore: 0.72,
      paceScore: 0.72,
      marketContextScore: 0.72,
      weatherEnvironmentScore: 0.72,
      injuryContextScore: 0.72,
      correlationExposureScore: 0.72,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "role stability",
    },
  },
  // 15. PASS — strong edge but injury context blocks (questionable tag)
  {
    scenarioName: "RY-injury-questionable",
    playerName: "Garrett Wilson",
    propType: "RECEIVING_YARDS",
    marketLine: 65.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 82,
    projectedStdDev: 24,
    ...risks({
      injuryContextScore: 0.3,
      dataQualityScore: 0.72,
      roleStabilityScore: 0.72,
      gameScriptScore: 0.72,
      paceScore: 0.72,
      marketContextScore: 0.72,
      weatherEnvironmentScore: 0.72,
      correlationExposureScore: 0.72,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "injury context",
    },
  },
  // 16. PASS — strong edge but data quality blocks (rookie sample)
  {
    scenarioName: "PY-rookie-thin-data",
    playerName: "Will Levis",
    propType: "PASSING_YARDS",
    marketLine: 240.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 268,
    projectedStdDev: 48,
    ...risks({
      dataQualityScore: 0.4,
      roleStabilityScore: 0.72,
      gameScriptScore: 0.72,
      paceScore: 0.72,
      marketContextScore: 0.72,
      weatherEnvironmentScore: 0.72,
      injuryContextScore: 0.72,
      correlationExposureScore: 0.72,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "data quality",
    },
  },
  // 17. PASS — strong edge but correlation exposure blocks (already on QB)
  {
    scenarioName: "REC-correlated-stack",
    playerName: "Brandon Aiyuk",
    propType: "RECEPTIONS",
    marketLine: 5.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 7.0,
    projectedStdDev: 2.0,
    ...risks({
      correlationExposureScore: 0.3,
      dataQualityScore: 0.72,
      roleStabilityScore: 0.72,
      gameScriptScore: 0.72,
      paceScore: 0.72,
      marketContextScore: 0.72,
      weatherEnvironmentScore: 0.72,
      injuryContextScore: 0.72,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "correlation exposure",
    },
  },
  // 18. PASS — strong edge but weather blocks (heavy wind / rain)
  {
    scenarioName: "PY-weather-storm",
    playerName: "Trevor Lawrence",
    propType: "PASSING_YARDS",
    marketLine: 245.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 268,
    projectedStdDev: 50,
    ...risks({
      weatherEnvironmentScore: 0.25,
      dataQualityScore: 0.72,
      roleStabilityScore: 0.72,
      gameScriptScore: 0.72,
      paceScore: 0.72,
      marketContextScore: 0.72,
      injuryContextScore: 0.72,
      correlationExposureScore: 0.72,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "weather",
    },
  },
  // 19. PASS — strong edge but multiple soft gates fail (gameScript, pace, market)
  {
    scenarioName: "RA-blowout-flip-risk",
    playerName: "Tony Pollard",
    propType: "RUSHING_ATTEMPTS",
    marketLine: 14.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 18.5,
    projectedStdDev: 4,
    ...risks({
      gameScriptScore: 0.25,
      paceScore: 0.3,
      marketContextScore: 0.3,
      dataQualityScore: 0.72,
      roleStabilityScore: 0.72,
      weatherEnvironmentScore: 0.72,
      injuryContextScore: 0.72,
      correlationExposureScore: 0.72,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "game script",
    },
  },
  // 20. PASS — thin edge AND injury (edge gate is primary disqualifier)
  {
    scenarioName: "PC-thin-edge-and-injury",
    playerName: "Geno Smith",
    propType: "PASSING_COMPLETIONS",
    marketLine: 23.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 23.7,
    projectedStdDev: 3.2,
    ...risks({
      injuryContextScore: 0.3,
      dataQualityScore: 0.72,
      roleStabilityScore: 0.72,
      gameScriptScore: 0.72,
      paceScore: 0.72,
      marketContextScore: 0.72,
      weatherEnvironmentScore: 0.72,
      correlationExposureScore: 0.72,
    }),
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "edge",
    },
  },
  // 21. QUALIFY OVER — coaching context provided, full continuity does
  // not degrade the projection. Coaching transition scorecard attaches
  // but adds no uncertainty penalty worth flagging.
  {
    scenarioName: "PY-OVER-coaching-continuity",
    playerName: "Patrick Mahomes",
    propType: "PASSING_YARDS",
    marketLine: 248.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 268,
    projectedStdDev: 45,
    ...risks(),
    coachingContext: SAMPLE_SAME_STAFF,
    expected: { qualified: true, recommendation: "OVER" },
  },
  // 22. PASS — coaching chaos (new HC + new OC + new QB) inflates σ
  // enough to drag a thin OVER edge under the 4.0% threshold.
  {
    scenarioName: "PY-coaching-uncertainty-flips-to-pass",
    playerName: "Bryce Young",
    propType: "PASSING_YARDS",
    marketLine: 248.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 254,
    projectedStdDev: 45,
    ...risks(),
    coachingContext: SAMPLE_NEW_HC_OC_QB,
    expected: {
      qualified: false,
      recommendation: "PASS",
      primaryDisqualifierIncludes: "edge",
    },
  },
];

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

const useColor = process.stdout.isTTY === true;
const C_GREEN = useColor ? "\x1b[32m" : "";
const C_RED = useColor ? "\x1b[31m" : "";
const C_RESET = useColor ? "\x1b[0m" : "";

let passCount = 0;
const failures: string[] = [];

for (let i = 0; i < scenarios.length; i++) {
  const s = scenarios[i];
  const input: ScorecardInput = {
    scenarioName: s.scenarioName,
    playerName: s.playerName,
    propType: s.propType,
    marketLine: s.marketLine,
    overOdds: s.overOdds,
    underOdds: s.underOdds,
    projectedMean: s.projectedMean,
    projectedStdDev: s.projectedStdDev,
    dataQualityScore: s.dataQualityScore,
    roleStabilityScore: s.roleStabilityScore,
    gameScriptScore: s.gameScriptScore,
    paceScore: s.paceScore,
    marketContextScore: s.marketContextScore,
    weatherEnvironmentScore: s.weatherEnvironmentScore,
    injuryContextScore: s.injuryContextScore,
    correlationExposureScore: s.correlationExposureScore,
    coachingContext: s.coachingContext,
  };

  const sc = buildPropDecisionScorecard(input);
  const primary = getPrimaryDisqualifier(sc);

  const okQualified = sc.qualified === s.expected.qualified;
  const okReco = sc.recommendation === s.expected.recommendation;
  const okDisq =
    !s.expected.primaryDisqualifierIncludes ||
    (primary
      ? primary
          .toLowerCase()
          .includes(s.expected.primaryDisqualifierIncludes.toLowerCase())
      : false);
  const ok = okQualified && okReco && okDisq;

  const statusColor = ok ? C_GREEN : C_RED;
  const status = `${statusColor}${ok ? "PASS" : "FAIL"}${C_RESET}`;
  console.log(
    `\n[${status}] #${pad(String(i + 1), 2)} ${s.scenarioName} (${s.propType}, ${s.playerName})`,
  );
  console.log(`        recommendation: ${sc.recommendation}`);
  console.log(`        qualified:      ${sc.qualified}`);
  console.log(`        primary disq:   ${primary ?? "(none)"}`);
  console.log(`        explanation:    ${sc.finalExplanation}`);

  if (ok) {
    passCount++;
  } else {
    failures.push(
      `#${i + 1} ${s.scenarioName}: expected qualified=${s.expected.qualified} reco=${s.expected.recommendation}` +
        (s.expected.primaryDisqualifierIncludes
          ? ` primary~="${s.expected.primaryDisqualifierIncludes}"`
          : "") +
        `, got qualified=${sc.qualified} reco=${sc.recommendation} primary="${primary ?? ""}"`,
    );
  }
}

const summaryColor =
  passCount === scenarios.length ? C_GREEN : C_RED;
console.log(
  `\n${summaryColor}${passCount}/${scenarios.length} scenarios passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f}`);
  }
  process.exit(1);
}
process.exit(0);
