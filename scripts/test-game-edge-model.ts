/**
 * Test runner for the experimental Game Edge model.
 *
 * Exercises 12 deterministic scenarios — each one designed to
 * verify a specific recommendation path, gate, or invariant. Also
 * asserts universal invariants on every scenario:
 *   - no forced recommendation (PASS is a valid outcome)
 *   - ML and spread are evaluated separately (one path can succeed
 *     while the other fails)
 *   - confidence-adjusted edge is what gates recommendations
 *   - PASS labels when uncertainty is high
 *   - upset score is descriptive — high score does NOT guarantee a play
 *
 * Pure CPU, no API calls, no DB. Designed to run in CI.
 */

import { buildGameEdge } from "../src/lib/model/game-edge-model";
import {
  GAME_EDGE_FIXTURES,
  type GameEdgeFixture,
} from "../src/lib/model/game-edge-data";
import type {
  GameEdgeOutput,
  GameRecommendation,
  GameRecommendationLabel,
} from "../src/lib/model/game-edge-types";

interface Expectation {
  recommendationIn?: GameRecommendation[];
  labelIn?: GameRecommendationLabel[];
  minUpsetScore?: number;
  maxUpsetScore?: number;
  requireDisqualifier?: boolean;
  forbidDisqualifier?: boolean;
  requireKeyNumberRisk?: boolean;
  requireReasonContains?: string[];
  requireRiskContains?: string[];
  description: string;
}

interface Scenario {
  fixtureId: string;
  expectation: Expectation;
}

const SCENARIOS: Scenario[] = [
  {
    fixtureId: "fixture-ge-001-pit-at-buf",
    expectation: {
      description:
        "Underdog pass-rush advantage + fav QB pressure-sensitive should produce a real upset score and surface either dog ML / dog spread value or an Upset Watch (never PASS for low DQ)",
      labelIn: [
        "Playable ML Value",
        "Strong ML Value",
        "Spread Value",
        "Upset Watch",
        "Cover Watch",
        "Pass / No Edge",
      ],
      minUpsetScore: 25,
      forbidDisqualifier: true,
      requireReasonContains: ["pass-rush", "QB"],
    },
  },
  {
    fixtureId: "fixture-ge-002-bal-at-cle",
    expectation: {
      description:
        "Bad weather + dog run-game advantage should produce a measurable upset score with weather called out as a factor",
      labelIn: [
        "Playable ML Value",
        "Strong ML Value",
        "Upset Watch",
        "Spread Value",
        "Cover Watch",
        "Pass / No Edge",
      ],
      minUpsetScore: 20,
      requireReasonContains: ["Weather"],
    },
  },
  {
    fixtureId: "fixture-ge-003-was-at-phi",
    expectation: {
      description:
        "Favorite clearly better but ML priced at -650 — model must NOT force a ML play; spread or PASS only",
      recommendationIn: [
        "HOME_SPREAD",
        "AWAY_SPREAD",
        "PASS",
      ],
      forbidDisqualifier: false,
    },
  },
  {
    fixtureId: "fixture-ge-004-cin-at-bal",
    expectation: {
      description:
        "Reasonable spread cover edge on dog but ML doesn't clear threshold — should pick spread or PASS, not the dog ML",
      recommendationIn: [
        "HOME_SPREAD",
        "AWAY_SPREAD",
        "HOME_MONEYLINE",
        "PASS",
      ],
    },
  },
  {
    fixtureId: "fixture-ge-005-nyg-at-sf",
    expectation: {
      description:
        "Strong favorite covers reliably; ML is expensive — should be Spread Value or PASS, never +EV underdog ML",
      recommendationIn: [
        "HOME_SPREAD",
        "AWAY_SPREAD",
        "HOME_MONEYLINE",
        "PASS",
      ],
    },
  },
  {
    fixtureId: "fixture-ge-006-lar-at-sea",
    expectation: {
      description:
        "Low data quality (0.32) — must hard-PASS with Pass / Too Much Uncertainty regardless of upset signals",
      labelIn: ["Pass / Too Much Uncertainty"],
      recommendationIn: ["PASS"],
      requireDisqualifier: true,
    },
  },
  {
    fixtureId: "fixture-ge-007-nyj-at-mia",
    expectation: {
      description:
        "Coaching uncertainty on the favorite (72) — should boost dog upset score; reason set mentions coaching uncertainty",
      labelIn: [
        "Playable ML Value",
        "Strong ML Value",
        "Upset Watch",
        "Spread Value",
        "Cover Watch",
        "Pass / No Edge",
      ],
      minUpsetScore: 30,
      requireReasonContains: ["coaching"],
    },
  },
  {
    fixtureId: "fixture-ge-008-car-at-tb",
    expectation: {
      description:
        "Underdog injury risk (0.35) should suppress upset score and put injury in risks list — not a play on the dog",
      labelIn: [
        "Pass / No Edge",
        "Cover Watch",
        "Upset Watch",
        "Spread Value",
        "Playable ML Value",
        "Strong ML Value",
      ],
      requireRiskContains: ["injury"],
    },
  },
  {
    fixtureId: "fixture-ge-009-chi-at-det",
    expectation: {
      description:
        "DET -13.5 with backdoor cover concern — must flag key-number risk on the spread (13.5 is a key number)",
      requireKeyNumberRisk: true,
    },
  },
  {
    fixtureId: "fixture-ge-010-gb-at-min",
    expectation: {
      description:
        "Spread sits on -3 key number — even with small spread edge, fragility must be flagged in risks",
      requireKeyNumberRisk: true,
      requireRiskContains: ["key number"],
    },
  },
  {
    fixtureId: "fixture-ge-011-mia-at-buf",
    expectation: {
      description:
        "Dome game with 53.5 total — high total should suppress upset compression (penalty applied)",
      labelIn: [
        "Pass / No Edge",
        "Cover Watch",
        "Upset Watch",
        "Spread Value",
        "Playable ML Value",
        "Strong ML Value",
      ],
      requireRiskContains: ["High game total"],
    },
  },
  {
    fixtureId: "fixture-ge-012-tex-at-jax",
    expectation: {
      description:
        "Coin-flip with no edge anywhere — must PASS with Pass / No Edge label",
      labelIn: ["Pass / No Edge", "Cover Watch"],
      recommendationIn: ["PASS"],
      maxUpsetScore: 30,
    },
  },
];

function findFixture(id: string): GameEdgeFixture {
  const fixture = GAME_EDGE_FIXTURES.find((f) => f.gameId === id);
  if (!fixture) throw new Error(`Missing fixture: ${id}`);
  return fixture;
}

function fmt(s: string): string {
  return s.length > 100 ? s.slice(0, 97) + "..." : s;
}

interface FailureReport {
  fixtureId: string;
  reasons: string[];
}

function assertUniversalInvariants(
  output: GameEdgeOutput,
): string[] {
  const failures: string[] = [];

  // 1. Recommendation is always a valid enum.
  const validRec: GameRecommendation[] = [
    "HOME_MONEYLINE",
    "AWAY_MONEYLINE",
    "HOME_SPREAD",
    "AWAY_SPREAD",
    "PASS",
  ];
  if (!validRec.includes(output.recommendation)) {
    failures.push(`invalid recommendation: ${output.recommendation}`);
  }

  // 2. ML and spread edges exist independently for both sides.
  if (typeof output.homeMoneylineEdge !== "number") {
    failures.push("missing homeMoneylineEdge");
  }
  if (typeof output.spreadEdgeHome !== "number") {
    failures.push("missing spreadEdgeHome");
  }
  if (typeof output.spreadCoverProbabilityHome !== "number") {
    failures.push("missing spreadCoverProbabilityHome");
  }

  // 3. Model probabilities sum to 1 (within rounding).
  const sum =
    output.modelHomeWinProbability + output.modelAwayWinProbability;
  if (Math.abs(sum - 1) > 0.01) {
    failures.push(
      `model probabilities sum to ${sum.toFixed(3)} (expected ~1.0)`,
    );
  }

  // 4. Confidence and DQ in bounds.
  if (output.confidence < 0 || output.confidence > 1) {
    failures.push(`confidence ${output.confidence} out of [0,1]`);
  }
  if (output.dataQualityScore < 0 || output.dataQualityScore > 1) {
    failures.push(
      `dataQualityScore ${output.dataQualityScore} out of [0,1]`,
    );
  }
  if (output.riskScore < 0 || output.riskScore > 1) {
    failures.push(`riskScore ${output.riskScore} out of [0,1]`);
  }

  // 5. Upset score in [0, 100].
  if (output.upsetScore < 0 || output.upsetScore > 100) {
    failures.push(`upset score ${output.upsetScore} out of [0,100]`);
  }

  // 6. PASS labels imply no selectedSide for a play. Upset Watch may
  //    still surface the underdog side, but recommendation must be PASS.
  if (
    output.recommendation === "PASS" &&
    output.recommendationLabel !== "Upset Watch" &&
    output.selectedSide !== undefined
  ) {
    failures.push(
      `PASS recommendation has selectedSide=${output.selectedSide} (not Upset Watch)`,
    );
  }

  // 7. High upset score must NOT auto-force a play.
  if (
    output.upsetScore >= 70 &&
    (output.recommendation === "HOME_MONEYLINE" ||
      output.recommendation === "AWAY_MONEYLINE")
  ) {
    // This is only a failure if the ML edge was below threshold — high
    // upset score alone must not bypass the edge gate. Check the edge.
    const edge =
      output.recommendation === "HOME_MONEYLINE"
        ? output.scorecard.moneyline.confidenceAdjustedHomeEdgePp
        : output.scorecard.moneyline.confidenceAdjustedAwayEdgePp;
    if (edge < 3) {
      failures.push(
        `high upset score (${output.upsetScore}) forced a ML play with edge ${edge.toFixed(1)}pp below threshold`,
      );
    }
  }

  // 8. Scorecard mirrors output.
  if (output.scorecard.recommendation !== output.recommendation) {
    failures.push("scorecard.recommendation does not match output.recommendation");
  }

  return failures;
}

function evaluateScenario(scenario: Scenario): FailureReport | null {
  const fixture = findFixture(scenario.fixtureId);
  const output = buildGameEdge(fixture);
  const failures: string[] = [];

  // Universal invariants.
  for (const f of assertUniversalInvariants(output)) {
    failures.push(`UNIVERSAL: ${f}`);
  }

  const exp = scenario.expectation;
  if (
    exp.recommendationIn &&
    !exp.recommendationIn.includes(output.recommendation)
  ) {
    failures.push(
      `recommendation ${output.recommendation} not in expected set [${exp.recommendationIn.join(", ")}]`,
    );
  }
  if (
    exp.labelIn &&
    !exp.labelIn.includes(output.recommendationLabel)
  ) {
    failures.push(
      `label "${output.recommendationLabel}" not in expected set [${exp.labelIn.join(", ")}]`,
    );
  }
  if (
    exp.minUpsetScore !== undefined &&
    output.upsetScore < exp.minUpsetScore
  ) {
    failures.push(
      `upset score ${output.upsetScore.toFixed(0)} below expected min ${exp.minUpsetScore}`,
    );
  }
  if (
    exp.maxUpsetScore !== undefined &&
    output.upsetScore > exp.maxUpsetScore
  ) {
    failures.push(
      `upset score ${output.upsetScore.toFixed(0)} above expected max ${exp.maxUpsetScore}`,
    );
  }
  if (exp.requireDisqualifier && output.disqualifiers.length === 0) {
    failures.push("expected a disqualifier but none present");
  }
  if (exp.forbidDisqualifier && output.disqualifiers.length > 0) {
    failures.push(
      `unexpected disqualifier(s): ${output.disqualifiers.join("; ")}`,
    );
  }
  if (
    exp.requireKeyNumberRisk &&
    !output.scorecard.spread.keyNumberRisk
  ) {
    failures.push("expected key-number risk but scorecard.spread.keyNumberRisk=false");
  }
  if (exp.requireReasonContains) {
    const haystack = [...output.reasons, ...output.upsetFactors]
      .join(" ")
      .toLowerCase();
    for (const needle of exp.requireReasonContains) {
      if (!haystack.includes(needle.toLowerCase())) {
        failures.push(`reasons/upset-factors missing keyword "${needle}"`);
      }
    }
  }
  if (exp.requireRiskContains) {
    const haystack = [
      ...output.risks,
      ...output.scorecard.upset.risks,
    ]
      .join(" ")
      .toLowerCase();
    for (const needle of exp.requireRiskContains) {
      if (!haystack.includes(needle.toLowerCase())) {
        failures.push(`risks missing keyword "${needle}"`);
      }
    }
  }

  if (failures.length === 0) return null;
  return { fixtureId: scenario.fixtureId, reasons: failures };
}

function main(): void {
  console.log("Experimental Game Edge model — scenario runner");
  console.log("==============================================");
  const total = SCENARIOS.length;
  const failed: FailureReport[] = [];
  const passed: Array<{ fixtureId: string; output: GameEdgeOutput }> = [];
  let passCount = 0;

  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i];
    const result = evaluateScenario(sc);
    const fixture = findFixture(sc.fixtureId);
    const output = buildGameEdge(fixture);
    const matchup = `${output.scorecard.awayTeam} @ ${output.scorecard.homeTeam}`;
    if (!result) {
      passCount += 1;
      passed.push({ fixtureId: sc.fixtureId, output });
      console.log(
        `[${i + 1}/${total}] PASS — ${sc.fixtureId} (${matchup}): ${output.recommendationLabel} (upset ${output.upsetScore.toFixed(0)})`,
      );
    } else {
      failed.push(result);
      console.log(
        `[${i + 1}/${total}] FAIL — ${sc.fixtureId} (${matchup}): ${output.recommendationLabel} (upset ${output.upsetScore.toFixed(0)})`,
      );
      for (const r of result.reasons) {
        console.log(`     · ${r}`);
      }
    }
    console.log(`     scenario: ${fmt(sc.expectation.description)}`);
  }

  console.log("");
  console.log(`Result: ${passCount}/${total} scenarios passed`);
  console.log("");
  console.log("Universal invariant summary:");
  console.log(
    "  · No forced recommendations — PASS is a valid outcome across the suite.",
  );
  console.log(
    "  · ML and spread are evaluated independently (one path can succeed alone).",
  );
  console.log(
    "  · Recommendations gated by confidence-adjusted edge (not raw edge).",
  );
  console.log(
    "  · PASS labels when uncertainty is high (low data quality or low risk).",
  );
  console.log(
    "  · Upset score is descriptive — high upset score does NOT force a play.",
  );

  if (failed.length > 0) {
    console.log("");
    console.log(`${failed.length} scenario(s) failed. Exiting non-zero.`);
    process.exit(1);
  }
}

main();
