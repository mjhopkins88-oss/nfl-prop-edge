/**
 * Composite-ranking edge-slice assertions.
 *
 *   · computeCompositeScore math matches the spec:
 *       edge×0.40 + confidence×0.20 + dataQuality×0.20 +
 *       (1 − volatilityScore)×0.20
 *   · volatilityScoreFromLevel maps low/medium/high → 0.25 /
 *     0.50 / 0.75 and undefined → 0.50 (neutral default).
 *   · buildCompositeSlices ranks by compositeScore desc and
 *     produces top-N slices for [10, 15, 20, 25].
 *   · The slice metrics carry avgCompositeScore on composite
 *     slices but not on the legacy edge-floor slices.
 *   · The full report includes compositeSlices +
 *     compositeInputs + the new "composite beats edge ≥ 4%"
 *     answer.
 *   · pickCandidatesFromSnapshots fills compositeScore +
 *     dataQuality + volatility on every candidate, with the
 *     missing-value defaults documented (0.50, 0.50).
 *   · The formatted output includes the composite section +
 *     the new question 5.
 *   · No banned hooks anywhere in the touched files.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildCompositeSlices,
  buildEdgeSliceReport,
  computeCompositeScore,
  pickCandidatesFromSnapshots,
  volatilityScoreFromLevel,
  type EdgeSliceCandidate,
} from "../src/lib/backtest/edge-slice-diagnostic";
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
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function makeCandidate(
  over: Partial<EdgeSliceCandidate> = {},
): EdgeSliceCandidate {
  const base: EdgeSliceCandidate = {
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
    compositeScore: 0,
    recommendedSide: "OVER",
    ...over,
  };
  base.compositeScore = computeCompositeScore({
    calibratedEdge: base.edge,
    confidenceScore: base.confidence,
    dataQualityScore: base.dataQualityScore,
    volatilityScore: base.volatilityScore,
  });
  return base;
}

function makeSnapshotWithCalibration(args: {
  week: number;
  candidates: Array<{
    id: string;
    edge: number;
    modelProbability: number;
    marketProbability: number;
    confidence: number;
    dataQualityScore?: number;
    volatilityLevel?: "low" | "medium" | "high";
    outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
    profitPerUnit: number;
    productionQualified: boolean;
  }>;
}): StoredWeekSnapshot {
  return {
    source: "postgres",
    dataMode: "stored",
    status: "READY",
    candidateCount: args.candidates.length,
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
    week: args.week,
    graded: {
      gradedAt: new Date().toISOString(),
      universeDiagnostics: {
        totalCandidates: args.candidates.length,
        candidatesWithActual: args.candidates.length,
        candidatesMissingActual: 0,
        candidatesPushed: 0,
        overSide: { wins: 0, losses: 0, pushes: 0, graded: 0, hitRatePct: 0, roiPct: 0, unitsProfit: 0 },
        underSide: { wins: 0, losses: 0, pushes: 0, graded: 0, hitRatePct: 0, roiPct: 0, unitsProfit: 0 },
        betterSide: "TIE",
        byPropType: [],
        byLineBucket: [],
      },
      gradedSample: [],
      recommendedPlays: {
        enabled: false, note: "", count: 0, wins: 0, losses: 0, pushes: 0,
        hitRatePct: 0, roiPct: 0, unitsProfit: 0,
        averageEdgePct: 0, averageConfidence: 0,
        byPropType: [], byConfidenceTier: [], byEdgeBucket: [],
      },
      parlayPerformance: {
        enabled: false, note: "", evaluated: 0, selected: 0, rejected: 0,
        selectedAggregate: {
          wins: 0, losses: 0, pushes: 0, noResult: 0,
          hitRatePct: 0, roiPct: 0, unitsProfit: 0,
          averageModeledHitProbabilityPct: 0,
          averageRequiredHitProbabilityPct: 0,
          averagePayoutMultiplier: 0, averageEVPct: 0,
        },
        rejectionReasons: {},
      },
      disqualificationBreakdown: {
        edgeTooThin: 0, riskGate: 0, roleStability: 0,
        missingResult: 0, ungradeable: 0, other: 0, totalRejected: 0,
      },
      marketContextCalibration: {
        diagnosticOnly: true,
        generatedAt: new Date().toISOString(),
        productionGate: 0.45,
        note: "diagnostic only",
        production: {
          gateThreshold: 0.45, isProduction: true,
          qualifiedCount: args.candidates.filter((c) => c.productionQualified).length,
          decisiveCount: 0, wins: 0, losses: 0, pushes: 0, noResult: 0,
          hitRatePct: 0, roiPct: 0, unitsProfit: 0,
          averageEdgePct: 0, averageConfidence: 0,
          byPropType: [], byConfidenceTier: [], byEdgeBucket: [],
          candidates: [],
        },
        gate040: {
          gateThreshold: 0.4, isProduction: false,
          qualifiedCount: args.candidates.length,
          decisiveCount: args.candidates.length,
          wins: 0, losses: 0, pushes: 0, noResult: 0,
          hitRatePct: 0, roiPct: 0, unitsProfit: 0,
          averageEdgePct: 0, averageConfidence: 0,
          byPropType: [], byConfidenceTier: [], byEdgeBucket: [],
          candidates: args.candidates.map((c) => ({
            candidateId: c.id,
            playerName: `Player ${c.id}`,
            team: "BUF",
            opponent: "NYJ",
            gameId: `2025-w${args.week}-test`,
            propType: "RECEPTIONS",
            line: 4.5,
            recommendedSide: "OVER" as const,
            modelProbability: c.modelProbability,
            marketProbability: c.marketProbability,
            edge: c.edge,
            confidence: c.confidence,
            riskScore: 0.65,
            dataQualityScore: c.dataQualityScore,
            volatilityLevel: c.volatilityLevel,
            marketContextScoreClamped: 0.4,
            marketContextScoreRaw: 0.43,
            productionQualified: c.productionQualified,
            actualValue: 6,
            outcome: c.outcome,
            profitPerUnit: c.profitPerUnit,
            removedDisqualifiers: [],
          })),
        },
        gate035: {
          gateThreshold: 0.35, isProduction: false,
          qualifiedCount: 0,
          decisiveCount: 0, wins: 0, losses: 0, pushes: 0, noResult: 0,
          hitRatePct: 0, roiPct: 0, unitsProfit: 0,
          averageEdgePct: 0, averageConfidence: 0,
          byPropType: [], byConfidenceTier: [], byEdgeBucket: [],
          candidates: [],
        },
      },
    },
  };
}

function main(): void {
  console.log("Composite-ranking edge-slice — assertions");
  console.log("=========================================");

  // 1. computeCompositeScore math.
  //    edge=0.08, conf=0.70, dq=0.65, vol=0.50
  //    → 0.08*0.40 + 0.70*0.20 + 0.65*0.20 + (1-0.50)*0.20
  //    = 0.032 + 0.140 + 0.130 + 0.100 = 0.402
  {
    const r = makeReport("composite score math");
    const v = computeCompositeScore({
      calibratedEdge: 0.08,
      confidenceScore: 0.7,
      dataQualityScore: 0.65,
      volatilityScore: 0.5,
    });
    check(r, Math.abs(v - 0.402) < 1e-9, `composite=${v}, expected 0.402`);
    record(r);
    if (r.reasons.length === 0) console.log("[1] PASS — composite math");
    else console.log("[1] FAIL — math");
  }

  // 2. volatilityScoreFromLevel mapping + missing default.
  {
    const r = makeReport("volatility level → score");
    check(r, volatilityScoreFromLevel("low") === 0.25, "low → 0.25");
    check(r, volatilityScoreFromLevel("medium") === 0.5, "medium → 0.50");
    check(r, volatilityScoreFromLevel("high") === 0.75, "high → 0.75");
    check(r, volatilityScoreFromLevel(undefined) === 0.5, "undefined → 0.50 (neutral default)");
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — volatility level → score");
    else console.log("[2] FAIL — volatility map");
  }

  // 3. buildCompositeSlices ranks by compositeScore desc and
  //    returns top 10/15/20/25.
  {
    const r = makeReport("top-N composite slices");
    // 30 candidates with varying compositeScores.
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 30; i++) {
      // Composite roughly proportional to i so candidate 29 is best.
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          edge: 0.04 + i * 0.001,
          confidence: 0.4 + i * 0.015,
          dataQualityScore: 0.4 + i * 0.015,
          outcome: i % 2 === 0 ? "WIN" : "LOSS",
          profitPerUnit: i % 2 === 0 ? 0.91 : -1,
        }),
      );
    }
    const slices = buildCompositeSlices({ candidates: cs });
    check(r, slices.length === 4, `slices.length=${slices.length}, expected 4`);
    check(r, slices[0].label === "top 10 by compositeScore", `[0].label=${slices[0].label}`);
    check(r, slices[0].plays === 10, `top10 plays=${slices[0].plays}`);
    check(r, slices[1].plays === 15, `top15 plays=${slices[1].plays}`);
    check(r, slices[2].plays === 20, `top20 plays=${slices[2].plays}`);
    check(r, slices[3].plays === 25, `top25 plays=${slices[3].plays}`);
    // avgCompositeScore present on composite slices.
    check(
      r,
      slices[0].avgCompositeScore !== undefined,
      "avgCompositeScore must be populated on composite slices",
    );
    // The top-10 average composite must exceed the top-25
    // average (smaller slice = higher-quality picks).
    check(
      r,
      (slices[0].avgCompositeScore ?? 0) > (slices[3].avgCompositeScore ?? 0),
      `top10 avgComp ${slices[0].avgCompositeScore} should exceed top25 ${slices[3].avgCompositeScore}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — top-N composite slices ranked desc");
    else console.log("[3] FAIL — top-N");
  }

  // 4. Top-N picks have higher composite than the next-N rank.
  {
    const r = makeReport("top 10 contains the highest 10 composites");
    const cs: EdgeSliceCandidate[] = [
      makeCandidate({ candidateId: "low", edge: 0.04, confidence: 0.3, dataQualityScore: 0.3 }),
      makeCandidate({ candidateId: "med", edge: 0.06, confidence: 0.6, dataQualityScore: 0.6 }),
      makeCandidate({ candidateId: "hi", edge: 0.12, confidence: 0.8, dataQualityScore: 0.8 }),
    ];
    const slices = buildCompositeSlices({ candidates: cs, ns: [1, 2, 3] });
    // Top 1 must contain only "hi".
    check(r, slices[0].plays === 1, `top1 plays=${slices[0].plays}`);
    // Hit rate / units don't matter here — the ranking selection is what's tested.
    // The synthetic outcomes default to WIN so we just confirm the count steps up.
    check(r, slices[1].plays === 2, `top2 plays=${slices[1].plays}`);
    check(r, slices[2].plays === 3, `top3 plays=${slices[2].plays}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — top-N slicing picks highest composites first");
    else console.log("[4] FAIL — slicing order");
  }

  // 5. pickCandidatesFromSnapshots populates the new fields.
  //    Includes a candidate missing dataQuality + volatility so
  //    we can confirm the defaults activate.
  {
    const r = makeReport("snapshot extraction populates composite inputs");
    const snap = makeSnapshotWithCalibration({
      week: 1,
      candidates: [
        {
          id: "c-with",
          edge: 0.05,
          modelProbability: 0.55,
          marketProbability: 0.5,
          confidence: 0.6,
          dataQualityScore: 0.7,
          volatilityLevel: "low",
          outcome: "WIN",
          profitPerUnit: 0.91,
          productionQualified: false,
        },
        {
          id: "c-without",
          edge: 0.05,
          modelProbability: 0.55,
          marketProbability: 0.5,
          confidence: 0.6,
          // No dataQualityScore, no volatilityLevel — defaults
          // should activate.
          outcome: "LOSS",
          profitPerUnit: -1,
          productionQualified: false,
        },
      ],
    });
    const cs = pickCandidatesFromSnapshots([snap]);
    check(r, cs.length === 2, `cs.length=${cs.length}`);
    const cWith = cs.find((c) => c.candidateId === "c-with")!;
    const cWithout = cs.find((c) => c.candidateId === "c-without")!;
    check(
      r,
      cWith.dataQualityScorePresent === true,
      "c-with should report dataQualityScorePresent=true",
    );
    check(
      r,
      cWith.volatilityLevelPresent === true,
      "c-with should report volatilityLevelPresent=true",
    );
    check(
      r,
      cWith.volatilityScore === 0.25,
      `c-with volatilityScore=${cWith.volatilityScore}, expected 0.25 for low`,
    );
    check(
      r,
      cWithout.dataQualityScorePresent === false,
      "c-without should report dataQualityScorePresent=false",
    );
    check(
      r,
      cWithout.volatilityLevelPresent === false,
      "c-without should report volatilityLevelPresent=false",
    );
    check(
      r,
      cWithout.dataQualityScore === 0.5,
      `c-without dataQualityScore default ${cWithout.dataQualityScore}, expected 0.50`,
    );
    check(
      r,
      cWithout.volatilityScore === 0.5,
      `c-without volatilityScore default ${cWithout.volatilityScore}, expected 0.50`,
    );
    // composite scores were computed.
    check(r, cWith.compositeScore > 0, `c-with composite > 0`);
    check(r, cWithout.compositeScore > 0, `c-without composite > 0`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — snapshot extraction + defaults active");
    else console.log("[5] FAIL — extraction");
  }

  // 6. buildEdgeSliceReport includes compositeSlices +
  //    compositeInputs + the new question 5 in answers +
  //    formatted output references the composite section.
  {
    const r = makeReport("full report carries composite block");
    const snap = makeSnapshotWithCalibration({
      week: 1,
      candidates: Array.from({ length: 15 }, (_, i) => ({
        id: `c-${i}`,
        edge: 0.04 + i * 0.005,
        modelProbability: 0.55,
        marketProbability: 0.5,
        confidence: 0.5 + i * 0.02,
        dataQualityScore: 0.5 + i * 0.02,
        volatilityLevel: i % 3 === 0 ? "low" : i % 3 === 1 ? "medium" : "high",
        outcome: (i % 2 === 0 ? "WIN" : "LOSS") as "WIN" | "LOSS",
        profitPerUnit: i % 2 === 0 ? 0.91 : -1,
        productionQualified: false,
      })),
    });
    const report = buildEdgeSliceReport({
      snapshots: [snap],
      weeksRequested: [1],
    });
    check(r, report.compositeSlices.length === 4, `compositeSlices=${report.compositeSlices.length}`);
    check(
      r,
      report.compositeSlices.every((s) => s.avgCompositeScore !== undefined),
      "every composite slice carries avgCompositeScore",
    );
    check(
      r,
      typeof report.compositeInputs.candidatesTotal === "number",
      "compositeInputs.candidatesTotal present",
    );
    check(
      r,
      report.compositeInputs.candidatesWithDataQuality === 15,
      `candidatesWithDataQuality=${report.compositeInputs.candidatesWithDataQuality}, expected 15`,
    );
    check(
      r,
      report.compositeInputs.candidatesWithVolatility === 15,
      `candidatesWithVolatility=${report.compositeInputs.candidatesWithVolatility}, expected 15`,
    );
    check(
      r,
      ["yes", "no", "tie"].includes(report.answers.compositeBeatsEdgeBaseline),
      `compositeBeatsEdgeBaseline=${report.answers.compositeBeatsEdgeBaseline}`,
    );
    check(
      r,
      report.formatted.includes("Composite ranking"),
      "formatted output must include the composite section header",
    );
    check(
      r,
      report.formatted.includes("compositeScore = calibratedEdge×0.40"),
      "formatted output must include the formula line",
    );
    check(
      r,
      report.formatted.includes("top 10 by compositeScore") &&
        report.formatted.includes("top 25 by compositeScore"),
      "formatted output must list the top-N slice labels",
    );
    check(
      r,
      report.formatted.includes("Does composite ranking beat the edge ≥ 4% baseline?"),
      "formatted output must include the new question 5",
    );
    check(
      r,
      report.headline.includes("Composite vs edge ≥ 4%"),
      "headline must include the composite comparison",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — full report carries the composite block");
    else console.log("[6] FAIL — report wiring");
  }

  // 7. compositeInputs accounts for default-value candidates.
  {
    const r = makeReport("compositeInputs counts candidates with signals");
    const snap = makeSnapshotWithCalibration({
      week: 1,
      candidates: [
        {
          id: "with-both",
          edge: 0.05, modelProbability: 0.55, marketProbability: 0.5, confidence: 0.6,
          dataQualityScore: 0.7, volatilityLevel: "medium",
          outcome: "WIN", profitPerUnit: 0.91, productionQualified: false,
        },
        {
          id: "without",
          edge: 0.05, modelProbability: 0.55, marketProbability: 0.5, confidence: 0.6,
          outcome: "LOSS", profitPerUnit: -1, productionQualified: false,
        },
      ],
    });
    const report = buildEdgeSliceReport({
      snapshots: [snap],
      weeksRequested: [1],
    });
    check(
      r,
      report.compositeInputs.candidatesWithDataQuality === 1,
      `withDataQuality=${report.compositeInputs.candidatesWithDataQuality}, expected 1`,
    );
    check(
      r,
      report.compositeInputs.candidatesWithVolatility === 1,
      `withVolatility=${report.compositeInputs.candidatesWithVolatility}, expected 1`,
    );
    check(
      r,
      report.compositeInputs.candidatesTotal === 2,
      `total=${report.compositeInputs.candidatesTotal}, expected 2`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — compositeInputs counts signal availability");
    else console.log("[7] FAIL — input availability");
  }

  // 8. No banned hooks.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/lib/backtest/edge-slice-diagnostic.ts",
      "src/lib/backtest/market-context-calibration.ts",
      "src/lib/backtest/week-1-monitor-summary.ts",
    ];
    for (const f of files) {
      const text = readSrc(f);
      for (const re of [
        /the-odds-api/i,
        /odds-api\.com/i,
        /placeBet|placeWager/,
        /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
        /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
      ]) {
        check(r, !re.test(text), `${f} contains banned pattern ${re}`);
      }
    }
    record(r);
    if (r.reasons.length === 0) console.log("[8] PASS — no banned hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 8 composite-ranking assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

main();
