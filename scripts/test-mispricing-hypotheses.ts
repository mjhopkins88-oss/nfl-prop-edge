/**
 * Multi-hypothesis mispricing diagnostic — assertions.
 *
 *   · buildMispricingHypothesesReport produces a control row +
 *     five hypothesis rows + four combination rows, all
 *     filtered to edge ≥ 4% (combinations 3 & 4 use edge ≥ 6%).
 *   · Each hypothesis honours its own filter:
 *       H1 WR ROLE SPIKE — RECEPTIONS + WR + high roleChange +
 *          positive usageMomentum
 *       H2 RB WORKLOAD SHIFT — RUSHING_ATTEMPTS + RB + high
 *          roleChange + positive usageMomentum
 *       H3 LOW VOLATILITY UNDERS — volatilityBucket=low +
 *          recommendedSide=UNDER
 *       H4 HIGH PASS-RATE ENVIRONMENT — (QB or WR) + high
 *          scriptSensitivity
 *       H5 MARKET LAG — high marketResistance + roleChange > 0
 *   · The four named combinations exist with exact labels.
 *   · "anyPositiveRoi" answer reflects the pool.
 *   · "bestCalibrationReduction" reports the test that lowered
 *     |calibration error| the most vs control.
 *   · "promotionCandidate" only fires when a test clears
 *     plays ≥ 5, ROI > 0, hit > 55%, AND |cal| < control |cal|.
 *   · Formatted output contains "=== MULTI-HYPOTHESIS
 *     MISPRICING DIAGNOSTIC ===" and the five hypothesis
 *     headers + the verbatim "No measurable edge found across
 *     tested hypotheses" verdict when nothing qualifies.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import {
  buildMispricingHypothesesReport,
  HIGH_ROLE_CHANGE_THRESHOLD,
  HIGH_MARKET_RESISTANCE_THRESHOLD,
} from "../src/lib/backtest/mispricing-hypotheses";
import type { EdgeSliceCandidate } from "../src/lib/backtest/edge-slice-diagnostic";
import type { SignalFeatures } from "../src/lib/backtest/signal-features";

interface Failure {
  scenario: string;
  reasons: string[];
}
const FAILURES: Failure[] = [];
function check(report: Failure, predicate: boolean, reason: string): void {
  if (!predicate) report.reasons.push(reason);
}
function record(report: Failure): void {
  if (report.reasons.length > 0) FAILURES.push(report);
}
function makeReport(scenario: string): Failure {
  return { scenario, reasons: [] };
}

function makeFeatures(over: Partial<SignalFeatures> = {}): SignalFeatures {
  return {
    roleChangeScore: 0,
    usageMomentumScore: 0,
    volatilityScore: 0.4,
    volatilityBucket: "medium",
    distributionBiasScore: 0,
    scriptSensitivityScore: 0,
    marketResistanceScore: 0,
    historyRowsUsed: 6,
    hasNeutralFallback: false,
    ...over,
  };
}

function makeCandidate(
  over: Partial<EdgeSliceCandidate> = {},
): EdgeSliceCandidate {
  return {
    week: 1,
    candidateId: "c-0",
    playerName: "Player A",
    propType: "RECEPTIONS",
    edge: 0.05,
    modelProbability: 0.55,
    marketProbability: 0.5,
    confidence: 0.6,
    dataQualityScore: 0.6,
    volatilityScore: 0.5,
    volatilityLevelPresent: true,
    dataQualityScorePresent: true,
    outcome: "WIN",
    profitPerUnit: 0.91,
    productionQualified: false,
    compositeScore: 0.3,
    signalFeatures: makeFeatures(),
    recommendedSide: "OVER",
    playerPosition: "WR",
    ...over,
  };
}

function main(): void {
  console.log("Multi-hypothesis mispricing diagnostic — assertions");
  console.log("===================================================");

  // 1. Report shape: control + 5 hypotheses + 4 combinations.
  {
    const r = makeReport("report shape");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 12; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          edge: 0.05,
          outcome: i % 2 === 0 ? "WIN" : "LOSS",
          profitPerUnit: i % 2 === 0 ? 0.91 : -1,
        }),
      );
    }
    const out = buildMispricingHypothesesReport({ candidates: cs });
    check(
      r,
      out.hypotheses.length === 5,
      `hypotheses.length=${out.hypotheses.length}, expected 5`,
    );
    check(
      r,
      out.combinations.length === 4,
      `combinations.length=${out.combinations.length}, expected 4`,
    );
    check(
      r,
      out.control.plays === 12,
      `control.plays=${out.control.plays}, expected 12`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — report shape");
    else console.log("[1] FAIL — report shape");
  }

  // 2. Hypothesis 1 filter: WR + RECEPTIONS + high roleChange
  //    + positive usageMomentum. RB-receptions and edge < 4%
  //    must be excluded.
  {
    const r = makeReport("H1 WR ROLE SPIKE filter");
    const cs: EdgeSliceCandidate[] = [];
    // Should match: WR receptions, high role + positive momentum,
    // edge ≥ 4%.
    cs.push(
      makeCandidate({
        candidateId: "match-1",
        playerPosition: "WR",
        propType: "RECEPTIONS",
        edge: 0.06,
        signalFeatures: makeFeatures({
          roleChangeScore: 0.3,
          usageMomentumScore: 0.1,
        }),
      }),
    );
    // Should NOT match: RB receptions (wrong position).
    cs.push(
      makeCandidate({
        candidateId: "no-rb",
        playerPosition: "RB",
        propType: "RECEPTIONS",
        edge: 0.06,
        signalFeatures: makeFeatures({
          roleChangeScore: 0.3,
          usageMomentumScore: 0.1,
        }),
      }),
    );
    // Should NOT match: edge below floor.
    cs.push(
      makeCandidate({
        candidateId: "no-edge",
        playerPosition: "WR",
        propType: "RECEPTIONS",
        edge: 0.02,
        signalFeatures: makeFeatures({
          roleChangeScore: 0.3,
          usageMomentumScore: 0.1,
        }),
      }),
    );
    // Should NOT match: roleChange below threshold.
    cs.push(
      makeCandidate({
        candidateId: "no-role",
        playerPosition: "WR",
        propType: "RECEPTIONS",
        edge: 0.06,
        signalFeatures: makeFeatures({
          roleChangeScore: 0.05,
          usageMomentumScore: 0.1,
        }),
      }),
    );
    const out = buildMispricingHypothesesReport({ candidates: cs });
    const h1 = out.hypotheses[0];
    check(
      r,
      h1.name.includes("WR ROLE SPIKE"),
      `H1 name=${h1.name}, expected WR ROLE SPIKE`,
    );
    check(
      r,
      h1.plays === 1,
      `H1 plays=${h1.plays}, expected 1 (only match-1 should qualify)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — H1 WR ROLE SPIKE filter");
    else console.log("[2] FAIL — H1 filter");
  }

  // 3. Hypothesis 2 filter: RB + RUSHING_ATTEMPTS + high
  //    roleChange + positive usageMomentum.
  {
    const r = makeReport("H2 RB WORKLOAD SHIFT filter");
    const cs: EdgeSliceCandidate[] = [];
    // Match: RB rushing, high role + positive momentum, edge ≥ 4%.
    cs.push(
      makeCandidate({
        candidateId: "match-rb",
        playerPosition: "RB",
        propType: "RUSHING_ATTEMPTS",
        edge: 0.05,
        signalFeatures: makeFeatures({
          roleChangeScore: 0.4,
          usageMomentumScore: 0.05,
        }),
      }),
    );
    // No match: WR rushing (wrong position).
    cs.push(
      makeCandidate({
        candidateId: "no-wr",
        playerPosition: "WR",
        propType: "RUSHING_ATTEMPTS",
        edge: 0.05,
        signalFeatures: makeFeatures({
          roleChangeScore: 0.4,
          usageMomentumScore: 0.05,
        }),
      }),
    );
    // No match: RB receptions (wrong propType).
    cs.push(
      makeCandidate({
        candidateId: "no-rec",
        playerPosition: "RB",
        propType: "RECEPTIONS",
        edge: 0.05,
        signalFeatures: makeFeatures({
          roleChangeScore: 0.4,
          usageMomentumScore: 0.05,
        }),
      }),
    );
    const out = buildMispricingHypothesesReport({ candidates: cs });
    const h2 = out.hypotheses[1];
    check(
      r,
      h2.name.includes("RB WORKLOAD SHIFT"),
      `H2 name=${h2.name}`,
    );
    check(r, h2.plays === 1, `H2 plays=${h2.plays}, expected 1`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — H2 RB WORKLOAD SHIFT filter");
    else console.log("[3] FAIL — H2 filter");
  }

  // 4. Hypothesis 3: LOW VOLATILITY UNDERS — volatility=low +
  //    recommendedSide=UNDER + edge ≥ 4%.
  {
    const r = makeReport("H3 LOW VOLATILITY UNDERS filter");
    const cs: EdgeSliceCandidate[] = [];
    cs.push(
      makeCandidate({
        candidateId: "match",
        recommendedSide: "UNDER",
        signalFeatures: makeFeatures({ volatilityBucket: "low" }),
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "no-over",
        recommendedSide: "OVER",
        signalFeatures: makeFeatures({ volatilityBucket: "low" }),
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "no-medium",
        recommendedSide: "UNDER",
        signalFeatures: makeFeatures({ volatilityBucket: "medium" }),
      }),
    );
    const out = buildMispricingHypothesesReport({ candidates: cs });
    const h3 = out.hypotheses[2];
    check(
      r,
      h3.name.includes("LOW VOLATILITY UNDERS"),
      `H3 name=${h3.name}`,
    );
    check(r, h3.plays === 1, `H3 plays=${h3.plays}, expected 1`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — H3 LOW VOLATILITY UNDERS filter");
    else console.log("[4] FAIL — H3 filter");
  }

  // 5. Hypothesis 4: QB or WR + high scriptSensitivity.
  {
    const r = makeReport("H4 HIGH PASS-RATE ENVIRONMENT filter");
    const cs: EdgeSliceCandidate[] = [];
    cs.push(
      makeCandidate({
        candidateId: "qb-match",
        playerPosition: "QB",
        propType: "PASSING_ATTEMPTS",
        signalFeatures: makeFeatures({ scriptSensitivityScore: 0.3 }),
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "wr-match",
        playerPosition: "WR",
        signalFeatures: makeFeatures({ scriptSensitivityScore: -0.25 }),
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "rb-no",
        playerPosition: "RB",
        signalFeatures: makeFeatures({ scriptSensitivityScore: 0.5 }),
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "wr-low-script",
        playerPosition: "WR",
        signalFeatures: makeFeatures({ scriptSensitivityScore: 0.05 }),
      }),
    );
    const out = buildMispricingHypothesesReport({ candidates: cs });
    const h4 = out.hypotheses[3];
    check(r, h4.plays === 2, `H4 plays=${h4.plays}, expected 2 (QB + WR matches)`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — H4 HIGH PASS-RATE filter");
    else console.log("[5] FAIL — H4 filter");
  }

  // 6. Hypothesis 5: high marketResistance + positive
  //    roleChange.
  {
    const r = makeReport("H5 MARKET LAG filter");
    const cs: EdgeSliceCandidate[] = [];
    cs.push(
      makeCandidate({
        candidateId: "match",
        signalFeatures: makeFeatures({
          marketResistanceScore: 0.6,
          roleChangeScore: 0.15,
        }),
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "no-resistance",
        signalFeatures: makeFeatures({
          marketResistanceScore: 0.1,
          roleChangeScore: 0.5,
        }),
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "no-role",
        signalFeatures: makeFeatures({
          marketResistanceScore: 0.6,
          roleChangeScore: -0.2,
        }),
      }),
    );
    const out = buildMispricingHypothesesReport({ candidates: cs });
    const h5 = out.hypotheses[4];
    check(
      r,
      h5.name.includes("MARKET LAG"),
      `H5 name=${h5.name}`,
    );
    check(r, h5.plays === 1, `H5 plays=${h5.plays}, expected 1`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — H5 MARKET LAG filter");
    else console.log("[6] FAIL — H5 filter");
  }

  // 7. Combinations: C1-C4 named exactly per spec.
  {
    const r = makeReport("four named combinations");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 8; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          edge: 0.05,
          signalFeatures: makeFeatures({ roleChangeScore: i * 0.05 }),
        }),
      );
    }
    const out = buildMispricingHypothesesReport({ candidates: cs });
    const labels = out.combinations.map((c) => c.name);
    check(
      r,
      labels[0].startsWith("C1.") && labels[0].includes("WR role spike + market lag"),
      `C1=${labels[0]}`,
    );
    check(
      r,
      labels[1].startsWith("C2.") && labels[1].includes("RB workload shift + low volatility"),
      `C2=${labels[1]}`,
    );
    check(
      r,
      labels[2].startsWith("C3.") && labels[2].includes("Low volatility + edge ≥ 6%"),
      `C3=${labels[2]}`,
    );
    check(
      r,
      labels[3].startsWith("C4.") && labels[3].includes("High role change + edge ≥ 6%"),
      `C4=${labels[3]}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — four named combinations");
    else console.log("[7] FAIL — combinations");
  }

  // 8. C3 uses edge ≥ 6% (not 4%) — confirm by including
  //    candidates between 4% and 6% that should be excluded.
  {
    const r = makeReport("C3 edge ≥ 6% floor");
    const cs: EdgeSliceCandidate[] = [];
    // Low volatility, edge 5% → NOT in C3, but IN H3-anchor.
    cs.push(
      makeCandidate({
        candidateId: "edge-5",
        edge: 0.05,
        recommendedSide: "UNDER",
        signalFeatures: makeFeatures({ volatilityBucket: "low" }),
      }),
    );
    // Low volatility, edge 7% → IN C3.
    cs.push(
      makeCandidate({
        candidateId: "edge-7",
        edge: 0.07,
        signalFeatures: makeFeatures({ volatilityBucket: "low" }),
      }),
    );
    const out = buildMispricingHypothesesReport({ candidates: cs });
    const c3 = out.combinations[2];
    check(r, c3.plays === 1, `C3 plays=${c3.plays}, expected 1 (only edge ≥ 6% qualifies)`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — C3 edge ≥ 6% floor");
    else console.log("[8] FAIL — C3 edge floor");
  }

  // 9. "promotionCandidate" verdict requires plays ≥ 5, ROI > 0,
  //    hit > 55%, and |cal| < control |cal|.
  {
    const r = makeReport("promotionCandidate verdict");
    // Pool with no qualifying subset (all losses).
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 10; i++) {
      cs.push(
        makeCandidate({
          candidateId: `loss-${i}`,
          edge: 0.05,
          outcome: "LOSS",
          profitPerUnit: -1,
          signalFeatures: makeFeatures({ roleChangeScore: 0.3 }),
        }),
      );
    }
    const out = buildMispricingHypothesesReport({ candidates: cs });
    check(
      r,
      out.answers.promotionCandidate === null,
      "promotionCandidate should be null when no subset qualifies",
    );
    check(
      r,
      out.formatted.includes(
        "No measurable edge found across tested hypotheses",
      ),
      "formatted should include verbatim no-edge message",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — promotionCandidate null + verbatim message");
    else console.log("[9] FAIL — promotionCandidate verdict");
  }

  // 10. Formatted output contains the diagnostic header.
  {
    const r = makeReport("formatted header");
    const cs: EdgeSliceCandidate[] = [makeCandidate({ candidateId: "c-0" })];
    const out = buildMispricingHypothesesReport({ candidates: cs });
    check(
      r,
      out.formatted.includes("=== MULTI-HYPOTHESIS MISPRICING DIAGNOSTIC ==="),
      "formatted must include the header",
    );
    check(
      r,
      out.formatted.includes("=== 1. WR ROLE SPIKE (Receptions) ==="),
      "formatted must include H1 header",
    );
    check(
      r,
      out.formatted.includes("=== COMBINATION TESTS ==="),
      "formatted must include combination header",
    );
    check(
      r,
      out.formatted.includes("=== FINAL SUMMARY ==="),
      "formatted must include FINAL SUMMARY block",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — formatted headers");
    else console.log("[10] FAIL — formatted headers");
  }

  // 11. Threshold constants exposed.
  {
    const r = makeReport("thresholds exposed");
    check(
      r,
      HIGH_ROLE_CHANGE_THRESHOLD === 0.2,
      `HIGH_ROLE_CHANGE_THRESHOLD=${HIGH_ROLE_CHANGE_THRESHOLD}`,
    );
    check(
      r,
      HIGH_MARKET_RESISTANCE_THRESHOLD === 0.4,
      `HIGH_MARKET_RESISTANCE_THRESHOLD=${HIGH_MARKET_RESISTANCE_THRESHOLD}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[11] PASS — thresholds exposed");
    else console.log("[11] FAIL — thresholds");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 11 / 11 SCENARIOS PASSED");
    return;
  }
  console.log(`FAIL — ${FAILURES.length} scenario(s) failed:`);
  for (const f of FAILURES) {
    console.log(`  · ${f.scenario}`);
    for (const reason of f.reasons) console.log(`    - ${reason}`);
  }
  process.exitCode = 1;
}

main();
