/**
 * Signal-quality audit — assertions.
 *
 *   · buildSignalQualityReport produces 6 featureBuckets — one
 *     per diagnostic mispricing feature.
 *   · Each feature splits its candidates into low / medium /
 *     high terciles when the pool has ≥6 candidates carrying
 *     the signal; falls back to a single "medium" bucket for
 *     smaller pools.
 *   · candidatesWithSignal correctly counts candidates that
 *     carry the signalFeatures payload — older persisted
 *     calibrations report 0.
 *   · Each bucket's W-L / ROI / hit rate math matches manual
 *     aggregation.
 *   · highMinusLowRoiPp = high.roiPct − low.roiPct.
 *   · The four explicit combination slices are present, named
 *     correctly, and use the exact predicate the operator
 *     asked for.
 *   · featureRankingByRoiDelta is sorted by |deltaPp| desc.
 *   · The formatted string contains the diagnostic banner and
 *     the combination header so the admin panel renders it.
 *   · Edge-slice diagnostic report includes signalQuality in
 *     both the structured payload and the formatted output.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import {
  buildEdgeSliceReport,
  type EdgeSliceCandidate,
} from "../src/lib/backtest/edge-slice-diagnostic";
import { buildSignalQualityReport } from "../src/lib/backtest/signal-quality-audit";
import type { SignalFeatures } from "../src/lib/backtest/signal-features";
import type { StoredWeekSnapshot } from "../src/lib/backtest/week-1-monitor-summary";

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
    volatilityScore: 0.3,
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
    ...over,
  };
}

function main(): void {
  console.log("Signal-quality audit — assertions");
  console.log("=================================");

  // 1. Six featureBuckets in the canonical order.
  {
    const r = makeReport("six feature reports");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 12; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          edge: 0.04 + (i % 4) * 0.01,
          signalFeatures: makeFeatures({
            roleChangeScore: -0.5 + i * 0.1,
            usageMomentumScore: -0.5 + i * 0.05,
            volatilityScore: 0.2 + i * 0.05,
            distributionBiasScore: -0.4 + i * 0.05,
            scriptSensitivityScore: -0.5 + i * 0.1,
            marketResistanceScore: 0.1 + i * 0.05,
          }),
          outcome: i % 2 === 0 ? "WIN" : "LOSS",
          profitPerUnit: i % 2 === 0 ? 0.91 : -1,
        }),
      );
    }
    const out = buildSignalQualityReport({ candidates: cs });
    const expected = [
      "roleChangeScore",
      "usageMomentumScore",
      "volatilityScore",
      "distributionBiasScore",
      "scriptSensitivityScore",
      "marketResistanceScore",
    ];
    check(
      r,
      out.featureBuckets.length === 6,
      `featureBuckets.length=${out.featureBuckets.length}, expected 6`,
    );
    for (let i = 0; i < expected.length; i++) {
      check(
        r,
        out.featureBuckets[i].feature === expected[i],
        `featureBuckets[${i}].feature=${out.featureBuckets[i].feature}, expected ${expected[i]}`,
      );
    }
    check(
      r,
      out.candidatesTotal === 12,
      `candidatesTotal=${out.candidatesTotal}, expected 12`,
    );
    check(
      r,
      out.candidatesWithFeatures === 12,
      `candidatesWithFeatures=${out.candidatesWithFeatures}, expected 12`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — six feature reports in canonical order");
    else console.log("[1] FAIL — six feature reports");
  }

  // 2. Tercile-bucket math: ≥6 candidates → low / medium /
  //    high. The top tercile of role-change scores must end
  //    up in the "high" bucket.
  {
    const r = makeReport("tercile buckets split into low/medium/high");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 12; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          signalFeatures: makeFeatures({
            // Strictly increasing role-change score.
            roleChangeScore: i / 12,
          }),
          // Top tercile (i=8..11) wins, rest losses.
          outcome: i >= 8 ? "WIN" : "LOSS",
          profitPerUnit: i >= 8 ? 0.91 : -1,
        }),
      );
    }
    const out = buildSignalQualityReport({ candidates: cs });
    const role = out.featureBuckets.find((f) => f.feature === "roleChangeScore");
    check(r, !!role, "roleChangeScore feature report exists");
    if (role) {
      const low = role.buckets.find((b) => b.bucket === "low");
      const med = role.buckets.find((b) => b.bucket === "medium");
      const high = role.buckets.find((b) => b.bucket === "high");
      check(r, !!low && !!med && !!high, "low/medium/high buckets exist");
      check(
        r,
        (high?.plays ?? 0) > 0 && (low?.plays ?? 0) > 0,
        "high + low buckets both populated",
      );
      // All wins are in the high tercile; ROI for high should
      // exceed ROI for low.
      check(
        r,
        (high?.roiPct ?? 0) > (low?.roiPct ?? 0),
        `high.roiPct=${high?.roiPct} should exceed low.roiPct=${low?.roiPct}`,
      );
      check(
        r,
        role.highMinusLowRoiPp ===
          (high?.roiPct ?? 0) - (low?.roiPct ?? 0),
        `highMinusLowRoiPp=${role.highMinusLowRoiPp} should match high.roiPct - low.roiPct`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — tercile buckets + ROI delta");
    else console.log("[2] FAIL — tercile buckets");
  }

  // 3. Small pool fallback: <6 candidates → all in "medium".
  {
    const r = makeReport("small pool fallback to medium");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 3; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          signalFeatures: makeFeatures({ roleChangeScore: i * 0.1 }),
        }),
      );
    }
    const out = buildSignalQualityReport({ candidates: cs });
    const role = out.featureBuckets.find((f) => f.feature === "roleChangeScore");
    check(r, role !== undefined, "role report exists");
    if (role) {
      const med = role.buckets.find((b) => b.bucket === "medium");
      const low = role.buckets.find((b) => b.bucket === "low");
      const high = role.buckets.find((b) => b.bucket === "high");
      check(
        r,
        (med?.plays ?? 0) === 3,
        `medium.plays=${med?.plays}, expected 3 (whole pool)`,
      );
      check(
        r,
        (low?.plays ?? 0) === 0,
        `low.plays=${low?.plays}, expected 0`,
      );
      check(
        r,
        (high?.plays ?? 0) === 0,
        `high.plays=${high?.plays}, expected 0`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — small-pool fallback");
    else console.log("[3] FAIL — small-pool fallback");
  }

  // 4. Candidates without signalFeatures count as "missing"
  //    and don't break the bucket math.
  {
    const r = makeReport("candidates without signalFeatures");
    const withSig: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 6; i++) {
      withSig.push(
        makeCandidate({
          candidateId: `with-${i}`,
          signalFeatures: makeFeatures({ roleChangeScore: i * 0.1 }),
        }),
      );
    }
    const withoutSig: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 4; i++) {
      const c = makeCandidate({ candidateId: `without-${i}` });
      delete c.signalFeatures;
      withoutSig.push(c);
    }
    const out = buildSignalQualityReport({
      candidates: [...withSig, ...withoutSig],
    });
    check(
      r,
      out.candidatesTotal === 10,
      `candidatesTotal=${out.candidatesTotal}, expected 10`,
    );
    check(
      r,
      out.candidatesWithFeatures === 6,
      `candidatesWithFeatures=${out.candidatesWithFeatures}, expected 6`,
    );
    const role = out.featureBuckets.find((f) => f.feature === "roleChangeScore");
    check(
      r,
      role?.candidatesWithSignal === 6,
      `roleChangeScore.candidatesWithSignal=${role?.candidatesWithSignal}, expected 6`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — missing signalFeatures handled");
    else console.log("[4] FAIL — missing signalFeatures");
  }

  // 5. The four combinations exist, named exactly as the
  //    operator asked.
  {
    const r = makeReport("four named combinations");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 12; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          signalFeatures: makeFeatures({ roleChangeScore: i * 0.05 }),
        }),
      );
    }
    const out = buildSignalQualityReport({ candidates: cs });
    const labels = out.combinations.map((c) => c.label);
    check(
      r,
      out.combinations.length === 4,
      `combinations.length=${out.combinations.length}, expected 4`,
    );
    check(
      r,
      labels.includes("high roleChange + positive usageMomentum"),
      `labels missing "high roleChange + positive usageMomentum": ${labels.join(",")}`,
    );
    check(
      r,
      labels.includes("low volatility + positive edge"),
      `labels missing "low volatility + positive edge": ${labels.join(",")}`,
    );
    check(
      r,
      labels.some((l) => l.startsWith("strong scriptSensitivity")),
      `labels missing strong scriptSensitivity: ${labels.join(",")}`,
    );
    check(
      r,
      labels.includes("strong marketResistance + edge ≥ 4%"),
      `labels missing "strong marketResistance + edge ≥ 4%": ${labels.join(",")}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — four named combinations");
    else console.log("[5] FAIL — combinations");
  }

  // 6. Combination predicate matching: marketResistance combo
  //    requires BOTH a high marketResistanceScore (top-tercile)
  //    AND edge ≥ 0.04. Build a 12-candidate pool with a clean
  //    distribution so the top tercile is unambiguous, then
  //    confirm only candidates clearing BOTH conditions land
  //    in the combo slice.
  {
    const r = makeReport("marketResistance combo requires both conditions");
    const cs: EdgeSliceCandidate[] = [];
    // 12 candidates with strictly increasing marketResistance.
    // Top tercile = indices 8..11. We give index 11 edge < 0.04
    // (clears resistance only) and index 8 edge ≥ 0.04 (clears
    // both); the rest of the top tercile have mixed edges.
    for (let i = 0; i < 12; i++) {
      const edge = i === 11 ? 0.02 : 0.05;
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          edge,
          signalFeatures: makeFeatures({
            // Score climbs linearly from 0.05 to 0.95.
            marketResistanceScore: 0.05 + i * 0.075,
          }),
        }),
      );
    }
    const out = buildSignalQualityReport({ candidates: cs });
    const combo = out.combinations.find(
      (c) => c.label === "strong marketResistance + edge ≥ 4%",
    );
    // Top tercile = 4 candidates (indices 8, 9, 10, 11). Of
    // those, index 11 has edge < 0.04, so 3 land in the combo.
    check(
      r,
      combo !== undefined,
      "marketResistance combo must exist",
    );
    check(
      r,
      combo?.plays === 3,
      `marketResistance combo plays=${combo?.plays}, expected 3 (4 in top tercile, one below edge floor)`,
    );

    // Cross-check: a candidate with high marketResistance but
    // edge < 0.04 must NOT appear in the slice. Build a
    // 12-candidate pool where the top tercile ALL have edge
    // < 0.04, and confirm zero plays.
    const lowEdgePool: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 12; i++) {
      lowEdgePool.push(
        makeCandidate({
          candidateId: `lep-${i}`,
          edge: i >= 8 ? 0.02 : 0.10,
          signalFeatures: makeFeatures({
            marketResistanceScore: 0.05 + i * 0.075,
          }),
        }),
      );
    }
    const out2 = buildSignalQualityReport({ candidates: lowEdgePool });
    const combo2 = out2.combinations.find(
      (c) => c.label === "strong marketResistance + edge ≥ 4%",
    );
    check(
      r,
      combo2?.plays === 0,
      `low-edge pool: combo plays=${combo2?.plays}, expected 0 (top tercile all sub-4%)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — combination predicates require all conditions");
    else console.log("[6] FAIL — combination predicates");
  }

  // 7. featureRankingByRoiDelta sorted by |deltaPp| desc.
  {
    const r = makeReport("ranking sorted by |delta| desc");
    const cs: EdgeSliceCandidate[] = [];
    // Make role-change a strong predictor (high tercile all
    // wins, low tercile all losses) and momentum mostly noise.
    for (let i = 0; i < 12; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          signalFeatures: makeFeatures({
            roleChangeScore: i / 12,
            // No signal for momentum.
            usageMomentumScore: 0.5,
          }),
          outcome: i >= 8 ? "WIN" : "LOSS",
          profitPerUnit: i >= 8 ? 0.91 : -1,
        }),
      );
    }
    const out = buildSignalQualityReport({ candidates: cs });
    check(
      r,
      out.featureRankingByRoiDelta.length === 6,
      `ranking.length=${out.featureRankingByRoiDelta.length}, expected 6`,
    );
    // Verify sort order: each entry has |deltaPp| ≤ predecessor.
    for (let i = 1; i < out.featureRankingByRoiDelta.length; i++) {
      const prev = Math.abs(out.featureRankingByRoiDelta[i - 1].deltaPp);
      const cur = Math.abs(out.featureRankingByRoiDelta[i].deltaPp);
      check(
        r,
        cur <= prev,
        `ranking[${i}]=${cur} should be ≤ ranking[${i - 1}]=${prev}`,
      );
    }
    // roleChangeScore should be at or near the top.
    check(
      r,
      out.featureRankingByRoiDelta[0].feature === "roleChangeScore",
      `top-ranked feature=${out.featureRankingByRoiDelta[0].feature}, expected roleChangeScore`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — ranking sorted by |delta| desc");
    else console.log("[7] FAIL — ranking sort");
  }

  // 8. Formatted output contains the diagnostic banner + the
  //    combination header.
  {
    const r = makeReport("formatted contains diagnostic banner");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 6; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          signalFeatures: makeFeatures({ roleChangeScore: i * 0.1 }),
        }),
      );
    }
    const out = buildSignalQualityReport({ candidates: cs });
    check(
      r,
      out.formatted.includes("Signal Quality Audit"),
      "formatted must include 'Signal Quality Audit' header",
    );
    check(
      r,
      out.formatted.includes("DIAGNOSTIC ONLY"),
      "formatted must call out diagnostic-only",
    );
    check(
      r,
      out.formatted.includes("Combination slices"),
      "formatted must include 'Combination slices' section",
    );
    check(
      r,
      out.formatted.includes("Feature ranking"),
      "formatted must include 'Feature ranking' section",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — formatted banner + sections");
    else console.log("[8] FAIL — formatted");
  }

  // 9. buildEdgeSliceReport returns signalQuality in the
  //    structured payload AND embeds it in the formatted
  //    output.
  {
    const r = makeReport("edge-slice report includes signalQuality");
    const snap: StoredWeekSnapshot = {
      source: "postgres",
      dataMode: "stored",
      status: "READY",
      candidateCount: 8,
      scheduleValidationStatus: "PASS",
      realWeek1BacktestReady: true,
      syntheticFixture: false,
      storedOddsPresent: true,
      processedNflPresent: true,
      missingStoredOdds: false,
      missingProcessedNfl: false,
      gradingStatus: "graded",
      notes: [],
      season: 2025,
      week: 1,
      graded: {
        gradedAt: new Date().toISOString(),
        universeDiagnostics: {
          totalCandidates: 8,
          candidatesWithActual: 8,
          candidatesMissingActual: 0,
          candidatesPushed: 0,
          overSide: {
            wins: 0,
            losses: 0,
            pushes: 0,
            graded: 0,
            hitRatePct: 0,
            roiPct: 0,
            unitsProfit: 0,
          },
          underSide: {
            wins: 0,
            losses: 0,
            pushes: 0,
            graded: 0,
            hitRatePct: 0,
            roiPct: 0,
            unitsProfit: 0,
          },
          betterSide: "TIE",
          byPropType: [],
          byLineBucket: [],
        },
        gradedSample: [],
        recommendedPlays: {
          enabled: false,
          note: "",
          count: 0,
          wins: 0,
          losses: 0,
          pushes: 0,
          hitRatePct: 0,
          roiPct: 0,
          unitsProfit: 0,
          averageEdgePct: 0,
          averageConfidence: 0,
          byPropType: [],
          byConfidenceTier: [],
          byEdgeBucket: [],
        },
        parlayPerformance: {
          enabled: false,
          note: "",
          evaluated: 0,
          selected: 0,
          rejected: 0,
          selectedAggregate: {
            wins: 0,
            losses: 0,
            pushes: 0,
            noResult: 0,
            hitRatePct: 0,
            roiPct: 0,
            unitsProfit: 0,
            averageModeledHitProbabilityPct: 0,
            averageRequiredHitProbabilityPct: 0,
            averagePayoutMultiplier: 0,
            averageEVPct: 0,
          },
          rejectionReasons: {},
        },
        disqualificationBreakdown: {
          edgeTooThin: 0,
          riskGate: 0,
          roleStability: 0,
          missingResult: 0,
          ungradeable: 0,
          other: 0,
          totalRejected: 0,
        },
        marketContextCalibration: {
          diagnosticOnly: true,
          generatedAt: new Date().toISOString(),
          productionGate: 0.45,
          note: "diagnostic only",
          production: {
            gateThreshold: 0.45,
            isProduction: true,
            qualifiedCount: 0,
            decisiveCount: 0,
            wins: 0,
            losses: 0,
            pushes: 0,
            noResult: 0,
            hitRatePct: 0,
            roiPct: 0,
            unitsProfit: 0,
            averageEdgePct: 0,
            averageConfidence: 0,
            byPropType: [],
            byConfidenceTier: [],
            byEdgeBucket: [],
            candidates: [],
          },
          gate040: {
            gateThreshold: 0.4,
            isProduction: false,
            qualifiedCount: 8,
            decisiveCount: 8,
            wins: 0,
            losses: 0,
            pushes: 0,
            noResult: 0,
            hitRatePct: 0,
            roiPct: 0,
            unitsProfit: 0,
            averageEdgePct: 0,
            averageConfidence: 0,
            byPropType: [],
            byConfidenceTier: [],
            byEdgeBucket: [],
            candidates: Array.from({ length: 8 }, (_, i) => ({
              candidateId: `c-${i}`,
              playerName: `Player ${i}`,
              team: "BUF",
              opponent: "NYJ",
              gameId: "2025-w1-test",
              propType: "RECEPTIONS",
              line: 4.5,
              recommendedSide: "OVER" as const,
              modelProbability: 0.55,
              marketProbability: 0.5,
              edge: 0.04 + i * 0.01,
              confidence: 0.6,
              riskScore: 0.65,
              dataQualityScore: 0.6,
              volatilityLevel: "medium" as const,
              signalFeatures: {
                roleChangeScore: i * 0.1,
                usageMomentumScore: i * 0.05,
                volatilityScore: 0.3,
                volatilityBucket: "medium" as const,
                distributionBiasScore: 0,
                scriptSensitivityScore: 0,
                marketResistanceScore: 0.4,
                historyRowsUsed: 6,
                hasNeutralFallback: false,
              },
              marketContextScoreClamped: 0.4,
              marketContextScoreRaw: 0.43,
              productionQualified: false,
              actualValue: 6,
              outcome: i % 2 === 0 ? ("WIN" as const) : ("LOSS" as const),
              profitPerUnit: i % 2 === 0 ? 0.91 : -1,
              removedDisqualifiers: [],
            })),
          },
          gate035: {
            gateThreshold: 0.35,
            isProduction: false,
            qualifiedCount: 0,
            decisiveCount: 0,
            wins: 0,
            losses: 0,
            pushes: 0,
            noResult: 0,
            hitRatePct: 0,
            roiPct: 0,
            unitsProfit: 0,
            averageEdgePct: 0,
            averageConfidence: 0,
            byPropType: [],
            byConfidenceTier: [],
            byEdgeBucket: [],
            candidates: [],
          },
        },
      },
    };
    const out = buildEdgeSliceReport({
      snapshots: [snap],
      weeksRequested: [1],
    });
    check(
      r,
      out.signalQuality !== undefined,
      "edge-slice report must include signalQuality",
    );
    check(
      r,
      out.signalQuality.candidatesTotal === 8,
      `signalQuality.candidatesTotal=${out.signalQuality.candidatesTotal}, expected 8`,
    );
    check(
      r,
      out.signalQuality.candidatesWithFeatures === 8,
      `signalQuality.candidatesWithFeatures=${out.signalQuality.candidatesWithFeatures}, expected 8`,
    );
    check(
      r,
      out.formatted.includes("Signal Quality Audit"),
      "edge-slice formatted output must embed the signal-quality section",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — edge-slice report wires signalQuality");
    else console.log("[9] FAIL — edge-slice wiring");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 9 / 9 SCENARIOS PASSED");
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
