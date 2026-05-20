/**
 * Experimental Correlated Parlay Model — scenario runner.
 *
 * 18 deterministic scenarios verifying the parlay builder's
 * qualification + classification rules. Plus universal invariants
 * checked across every scenario:
 *
 *   · no touchdown propType is admitted into a leg
 *   · every qualified parlay has positive confidence-adjusted EV
 *   · every qualified parlay has projectedHitRate ≥ requiredHitRate
 *   · high payout alone never qualifies (must clear EV gates)
 *   · correlation alone never qualifies (without positive EV)
 *   · scorecard.reasons and scorecard.risks are present
 *   · target-batch math math is correct (15% → 7.33x, 20% → 5.50x)
 *
 * Pure CPU. No APIs. No DB. No live state.
 */

import { buildParlayCandidates } from "../src/lib/model/parlay-builder";
import {
  PARLAY_LEG_FIXTURES,
  PARLAY_CANDIDATE_FIXTURES,
  getParlayLegById,
} from "../src/lib/model/parlay-data";
import { calculateTargetBatchMath } from "../src/lib/model/parlay-ev";
import { calculateRequiredPayoutMultiplier } from "../src/lib/model/parlay-config";
import type {
  ParlayCandidate,
  ParlayRecommendation,
} from "../src/lib/model/parlay-types";

interface Expectation {
  scenarioIndex: number;
  scenarioNote: string;
  expectedQualified?: boolean;
  expectedRecommendationIn?: ParlayRecommendation[];
  expectedDisqualifierContains?: string;
  minProjectedHitRate?: number;
  expectedCorrelationTypeIn?: Array<
    "POSITIVE" | "NEGATIVE" | "WEAK" | "CONFLICTING" | "UNKNOWN"
  >;
}

interface Failure {
  scenarioIndex: number;
  reasons: string[];
}

function fmt(s: string, n = 90): string {
  return s.length > n ? s.slice(0, n - 3) + "..." : s;
}

const FAILURES: Failure[] = [];

function check(report: Failure, predicate: boolean, reason: string): void {
  if (!predicate) report.reasons.push(reason);
}

const SCENARIO_EXPECTATIONS: Expectation[] = [
  {
    scenarioIndex: 0,
    scenarioNote: "QB passing yards OVER + WR receiving yards OVER qualifies",
    expectedQualified: true,
    expectedRecommendationIn: ["PLAYABLE_PARLAY_VALUE", "STRONG_PARLAY_VALUE"],
    expectedCorrelationTypeIn: ["POSITIVE"],
  },
  {
    scenarioIndex: 1,
    scenarioNote:
      "QB completions OVER + slot WR receptions OVER qualifies",
    expectedQualified: true,
    expectedRecommendationIn: ["PLAYABLE_PARLAY_VALUE", "STRONG_PARLAY_VALUE"],
  },
  {
    scenarioIndex: 2,
    scenarioNote: "QB attempts OVER + WR receptions OVER qualifies",
    expectedQualified: true,
    expectedRecommendationIn: ["PLAYABLE_PARLAY_VALUE", "STRONG_PARLAY_VALUE"],
  },
  {
    scenarioIndex: 3,
    scenarioNote:
      "RB attempts OVER + RB yards OVER qualifies when favorite script supports it",
    expectedQualified: true,
    expectedRecommendationIn: ["PLAYABLE_PARLAY_VALUE", "STRONG_PARLAY_VALUE"],
  },
  {
    scenarioIndex: 4,
    scenarioNote:
      "RB attempts OVER + RB yards OVER passes when underdog script conflicts",
    expectedQualified: false,
    expectedRecommendationIn: [
      "PASS_LOW_EV",
      "PASS_TOO_MUCH_RISK",
      "PASS_BAD_CORRELATION",
      "PASS_LEG_NOT_QUALIFIED",
      "PASS_TOO_FRAGILE",
      "CORRELATED_WATCH",
    ],
  },
  {
    scenarioIndex: 5,
    scenarioNote:
      "QB passing yards UNDER + deep WR yards UNDER qualifies in windy/pressure setup",
    expectedQualified: true,
    expectedRecommendationIn: ["PLAYABLE_PARLAY_VALUE", "STRONG_PARLAY_VALUE"],
    expectedCorrelationTypeIn: ["POSITIVE"],
  },
  {
    scenarioIndex: 6,
    scenarioNote:
      "QB yards UNDER + RB receptions OVER becomes correlated watch in pressure setup",
    expectedRecommendationIn: [
      "CORRELATED_WATCH",
      "PLAYABLE_PARLAY_VALUE",
      "STRONG_PARLAY_VALUE",
    ],
  },
  {
    scenarioIndex: 7,
    scenarioNote: "Overstacked QB + multiple WR overs is blocked",
    expectedQualified: false,
    expectedRecommendationIn: [
      "PASS_BAD_CORRELATION",
      "PASS_TOO_MUCH_RISK",
      "PASS_LOW_EV",
    ],
  },
  {
    scenarioIndex: 8,
    scenarioNote:
      "Conflicting QB over + RB attempts over is blocked unless high play volume",
    expectedQualified: false,
  },
  {
    scenarioIndex: 9,
    scenarioNote: "One low-data-quality leg blocks parlay",
    expectedQualified: false,
    expectedDisqualifierContains: "data quality",
  },
  {
    scenarioIndex: 10,
    scenarioNote: "High payout but low projected hit rate blocks parlay",
    expectedQualified: false,
    expectedRecommendationIn: ["PASS_LOW_EV", "PASS_LEG_NOT_QUALIFIED"],
  },
  {
    scenarioIndex: 11,
    scenarioNote: "Positive EV but low confidence becomes watch/pass",
    expectedQualified: false,
  },
  {
    scenarioIndex: 12,
    scenarioNote: "Unknown correlation does not qualify by itself",
    expectedQualified: false,
    expectedRecommendationIn: [
      "CORRELATED_WATCH",
      "PASS_LOW_EV",
      "PASS_TOO_MUCH_RISK",
    ],
  },
  {
    scenarioIndex: 13,
    scenarioNote:
      "Same player attempts/yards stack qualifies with strong role/game script",
    expectedQualified: true,
    expectedRecommendationIn: ["PLAYABLE_PARLAY_VALUE", "STRONG_PARLAY_VALUE"],
    expectedCorrelationTypeIn: ["POSITIVE"],
  },
  {
    scenarioIndex: 14,
    scenarioNote:
      "Different-game parlay treated as weak correlation",
    expectedRecommendationIn: [
      "CORRELATED_WATCH",
      "PASS_LOW_EV",
      "PASS_TOO_MUCH_RISK",
    ],
  },
  {
    scenarioIndex: 15,
    scenarioNote: "Line fragility on one leg blocks thin parlay",
    expectedQualified: false,
    expectedRecommendationIn: ["PASS_TOO_FRAGILE", "PASS_LEG_NOT_QUALIFIED"],
    expectedDisqualifierContains: "fragility",
  },
];

function evaluateScenario(
  index: number,
  candidate: ParlayCandidate,
  exp: Expectation,
): Failure {
  const report: Failure = { scenarioIndex: index, reasons: [] };
  if (
    exp.expectedQualified !== undefined &&
    candidate.qualified !== exp.expectedQualified
  ) {
    check(
      report,
      false,
      `qualified ${candidate.qualified} ≠ expected ${exp.expectedQualified}`,
    );
  }
  if (exp.expectedRecommendationIn) {
    check(
      report,
      exp.expectedRecommendationIn.includes(candidate.recommendation),
      `recommendation ${candidate.recommendation} not in [${exp.expectedRecommendationIn.join(", ")}]`,
    );
  }
  if (exp.expectedDisqualifierContains) {
    const text = (
      candidate.primaryDisqualifier ?? candidate.disqualifiers.join(" ; ")
    ).toLowerCase();
    check(
      report,
      text.includes(exp.expectedDisqualifierContains.toLowerCase()),
      `expected disqualifier substring "${exp.expectedDisqualifierContains}" — got "${text || "(none)"}"`,
    );
  }
  if (
    exp.minProjectedHitRate !== undefined &&
    candidate.projectedHitRate < exp.minProjectedHitRate
  ) {
    check(
      report,
      false,
      `projected hit rate ${(candidate.projectedHitRate * 100).toFixed(1)}% below ${(exp.minProjectedHitRate * 100).toFixed(1)}%`,
    );
  }
  if (exp.expectedCorrelationTypeIn) {
    check(
      report,
      exp.expectedCorrelationTypeIn.includes(candidate.correlationType),
      `correlation type ${candidate.correlationType} not in [${exp.expectedCorrelationTypeIn.join(", ")}]`,
    );
  }
  return report;
}

function assertUniversalInvariants(candidate: ParlayCandidate): string[] {
  const failures: string[] = [];
  // No touchdown propType anywhere.
  for (const leg of candidate.legs) {
    const tag = String(leg.propType).toUpperCase();
    if (tag.includes("TD") || tag.includes("TOUCHDOWN")) {
      failures.push(`touchdown propType leaked: ${leg.propType}`);
    }
    if (!leg.id || !leg.playerName) {
      failures.push("leg missing identifier");
    }
  }
  if (candidate.qualified) {
    if (candidate.confidenceAdjustedExpectedValue <= 0) {
      failures.push(
        `qualified parlay has non-positive conf-adj EV ${candidate.confidenceAdjustedExpectedValue}`,
      );
    }
    if (candidate.projectedHitRate < candidate.requiredHitRate - 1e-9) {
      failures.push(
        `qualified parlay projected hit rate ${candidate.projectedHitRate} < required ${candidate.requiredHitRate}`,
      );
    }
  }
  // High payout never qualifies on its own — qualified requires EV
  // and hit-rate gates. We re-check the inverse: if EV <= 0 we must
  // not be qualified.
  if (candidate.expectedValue <= 0 && candidate.qualified) {
    failures.push(
      "qualified parlay has non-positive raw EV — payout alone slipped through",
    );
  }
  // Correlation alone never qualifies — a parlay needs positive EV
  // even if correlation is strong.
  if (
    candidate.correlationType === "POSITIVE" &&
    candidate.qualified &&
    candidate.confidenceAdjustedExpectedValue <= 0
  ) {
    failures.push(
      "qualified parlay has positive correlation but non-positive conf-adj EV",
    );
  }
  if (!candidate.scorecard.reasons || !candidate.scorecard.risks) {
    failures.push("scorecard missing reasons / risks");
  }
  return failures;
}

function targetMathAssertions(report: Failure): void {
  // 15% hit rate at 10% ROI → 7.33x.
  const req15 = calculateRequiredPayoutMultiplier({ expectedHitRate: 0.15 });
  check(
    report,
    Math.abs(req15 - 7.3333) < 0.01,
    `15% hit rate should require ~7.33x payout (got ${req15.toFixed(2)})`,
  );
  const req20 = calculateRequiredPayoutMultiplier({ expectedHitRate: 0.2 });
  check(
    report,
    Math.abs(req20 - 5.5) < 0.01,
    `20% hit rate should require 5.50x payout (got ${req20.toFixed(2)})`,
  );
  const req175 = calculateRequiredPayoutMultiplier({ expectedHitRate: 0.175 });
  check(
    report,
    Math.abs(req175 - 6.2857) < 0.01,
    `17.5% hit rate should require ~6.29x payout (got ${req175.toFixed(2)})`,
  );
  const batch = calculateTargetBatchMath({});
  check(
    report,
    Math.abs(batch.requiredPayoutLow - 7.3333) < 0.01,
    `target batch math low should be ~7.33x (got ${batch.requiredPayoutLow.toFixed(2)})`,
  );
  check(
    report,
    Math.abs(batch.requiredPayoutHigh - 5.5) < 0.01,
    `target batch math high should be 5.50x (got ${batch.requiredPayoutHigh.toFixed(2)})`,
  );
}

function main(): void {
  console.log("Experimental Correlated Parlay Model — scenario runner");
  console.log("=========================================================");

  // Build all fixture candidates in their declared order (so we can
  // index assertions by scenario number).
  const candidates = PARLAY_CANDIDATE_FIXTURES.map((spec) => {
    const legs = spec.legIds
      .map((id) => getParlayLegById(id))
      .filter((l): l is NonNullable<typeof l> => l !== undefined);
    if (legs.length < 2) {
      throw new Error(
        `Fixture for "${spec.scenarioNote}" missing legs`,
      );
    }
    const c = buildParlayCandidates({
      legs,
      candidateSpecs: [
        { legIds: spec.legIds, parlayType: spec.parlayType },
      ],
      maxLegsPerParlay: 3,
    });
    if (!c[0]) {
      throw new Error(
        `Builder rejected fixture "${spec.scenarioNote}" — got 0 candidates`,
      );
    }
    return c[0];
  });

  const total = SCENARIO_EXPECTATIONS.length;
  let pass = 0;
  for (let i = 0; i < total; i++) {
    const candidate = candidates[i];
    const expectation = SCENARIO_EXPECTATIONS[i];
    const report = evaluateScenario(i, candidate, expectation);
    const invariantFailures = assertUniversalInvariants(candidate);
    for (const f of invariantFailures) report.reasons.push(`UNIVERSAL: ${f}`);

    const labelHead = `[${i + 1}/${total}]`;
    if (report.reasons.length === 0) {
      pass += 1;
      console.log(
        `${labelHead} PASS — ${candidate.parlayType} ${candidate.recommendation} (EV ${(candidate.expectedValue * 100).toFixed(1)}%, conf-adj ${(candidate.confidenceAdjustedExpectedValue * 100).toFixed(1)}%, hit ${(candidate.projectedHitRate * 100).toFixed(1)}% vs req ${(candidate.requiredHitRate * 100).toFixed(1)}%, corr ${candidate.correlationType})`,
      );
    } else {
      FAILURES.push(report);
      console.log(
        `${labelHead} FAIL — ${candidate.parlayType} ${candidate.recommendation} (EV ${(candidate.expectedValue * 100).toFixed(1)}%, conf-adj ${(candidate.confidenceAdjustedExpectedValue * 100).toFixed(1)}%)`,
      );
      for (const r of report.reasons) console.log(`     · ${r}`);
    }
    console.log(`     scenario: ${fmt(expectation.scenarioNote)}`);
  }

  // Target-math scenarios 17 & 18: explicit math.
  const mathReport: Failure = { scenarioIndex: total, reasons: [] };
  targetMathAssertions(mathReport);
  if (mathReport.reasons.length === 0) {
    pass += 1;
    console.log(
      `[${total + 1}/${total + 2}] PASS — 15% hit rate → 7.33x payout for 10% ROI`,
    );
  } else {
    FAILURES.push(mathReport);
    console.log(
      `[${total + 1}/${total + 2}] FAIL — target-batch math`,
    );
    for (const r of mathReport.reasons) console.log(`     · ${r}`);
  }
  // Same set covers the 20% → 5.50x assertion (already in mathReport).
  const math20Report: Failure = { scenarioIndex: total + 1, reasons: [] };
  const req20 = calculateRequiredPayoutMultiplier({ expectedHitRate: 0.2 });
  check(
    math20Report,
    Math.abs(req20 - 5.5) < 0.01,
    `20% hit rate should require 5.50x payout (got ${req20.toFixed(2)})`,
  );
  if (math20Report.reasons.length === 0) {
    pass += 1;
    console.log(
      `[${total + 2}/${total + 2}] PASS — 20% hit rate → 5.50x payout for 10% ROI`,
    );
  } else {
    FAILURES.push(math20Report);
    console.log(`[${total + 2}/${total + 2}] FAIL — 20% target math`);
    for (const r of math20Report.reasons) console.log(`     · ${r}`);
  }

  // Cross-fixture sanity checks.
  const totalLegs = PARLAY_LEG_FIXTURES.length;
  console.log("");
  console.log(`Result: ${pass}/${total + 2} scenarios passed`);
  console.log(`Leg pool size: ${totalLegs}`);
  console.log("Universal invariants asserted across every candidate:");
  console.log("  · no touchdown propTypes admitted");
  console.log("  · qualified ⇒ confidence-adjusted EV > 0");
  console.log("  · qualified ⇒ projected hit rate ≥ required hit rate");
  console.log("  · high payout alone does not qualify (EV gates enforced)");
  console.log(
    "  · correlation alone does not qualify (positive EV + hit-rate gate required)",
  );
  console.log("  · scorecard exposes reasons + risks for every parlay");

  if (FAILURES.length > 0) {
    console.log(`\n${FAILURES.length} scenario(s) failed. Exiting non-zero.`);
    process.exit(1);
  }
}

main();
