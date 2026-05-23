/**
 * WR receptions analysis — assertions.
 *
 *   · buildWrReceptionsAnalysis only audits candidates with
 *     wrReceptionsSignals populated.
 *   · Five feature reports in canonical order (roleChange,
 *     routeParticipationSlope, targetShareVolatility,
 *     teamProe, marketLag).
 *   · Tercile bucketing with the small-pool fallback (< 6 →
 *     single medium bucket).
 *   · marketLag is positive when role rose and market
 *     probability didn't budge; ~0 when market moved a lot.
 *   · Four named combinations exist with the exact labels.
 *   · "edgeFound" verdict: when a subset clears plays ≥ 5,
 *     ROI > 0, hit > 55%, |cal| < baseline|cal| it surfaces;
 *     otherwise the formatted output says "No measurable
 *     edge found in WR receptions under current data".
 *   · Wires into edge-slice-diagnostic via the
 *     wrReceptionsAnalysis field on the EdgeSliceReport, and
 *     the formatted output includes the
 *     "=== WR RECEPTIONS SIGNAL ANALYSIS ===" header.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import {
  buildEdgeSliceReport,
  type EdgeSliceCandidate,
} from "../src/lib/backtest/edge-slice-diagnostic";
import {
  buildWrReceptionsAnalysis,
  computeMarketLagByCandidate,
} from "../src/lib/backtest/wr-receptions-analysis";
import type { WrReceptionsSignals } from "../src/lib/backtest/wr-receptions-signals";
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

function makeWrSignals(
  over: Partial<WrReceptionsSignals> = {},
): WrReceptionsSignals {
  return {
    roleChange: 0,
    routeParticipationSlope: 0,
    targetShareVolatility: 0.1,
    teamProe: 0,
    defensiveMatchup: undefined,
    historyRowsUsed: 5,
    hasNeutralFallback: false,
    defensiveMatchupAvailable: false,
    teamHistoryAvailable: true,
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
    signalFeatures: undefined,
    wrReceptionsSignals: makeWrSignals(),
    ...over,
  };
}

function main(): void {
  console.log("WR receptions analysis — assertions");
  console.log("====================================");

  // 1. Five feature reports in canonical order.
  {
    const r = makeReport("five feature reports");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 10; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          wrReceptionsSignals: makeWrSignals({
            roleChange: -0.5 + i * 0.1,
            routeParticipationSlope: -0.4 + i * 0.05,
            targetShareVolatility: 0.05 + i * 0.02,
            teamProe: -0.1 + i * 0.02,
          }),
          outcome: i % 2 === 0 ? "WIN" : "LOSS",
          profitPerUnit: i % 2 === 0 ? 0.91 : -1,
        }),
      );
    }
    const out = buildWrReceptionsAnalysis({ candidates: cs });
    const expected = [
      "roleChange",
      "routeParticipationSlope",
      "targetShareVolatility",
      "teamProe",
      "marketLag",
    ];
    check(
      r,
      out.features.length === 5,
      `features.length=${out.features.length}, expected 5`,
    );
    for (let i = 0; i < expected.length; i++) {
      check(
        r,
        out.features[i].feature === expected[i],
        `features[${i}].feature=${out.features[i].feature}, expected ${expected[i]}`,
      );
    }
    check(
      r,
      out.wrReceptionsTotal === 10,
      `wrReceptionsTotal=${out.wrReceptionsTotal}, expected 10`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — five feature reports in canonical order");
    else console.log("[1] FAIL — five feature reports");
  }

  // 2. WR filter: only candidates with wrReceptionsSignals
  //    enter the audit; RB receptions and PASSING_ATTEMPTS are
  //    skipped.
  {
    const r = makeReport("WR filter via wrReceptionsSignals presence");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 6; i++) {
      cs.push(
        makeCandidate({
          candidateId: `wr-${i}`,
          wrReceptionsSignals: makeWrSignals({ roleChange: i * 0.05 }),
        }),
      );
    }
    // RB receptions — no wrReceptionsSignals.
    for (let i = 0; i < 4; i++) {
      cs.push(
        makeCandidate({
          candidateId: `rb-${i}`,
          wrReceptionsSignals: undefined,
        }),
      );
    }
    // PASSING_ATTEMPTS — wrong prop type, no wrReceptionsSignals.
    cs.push(
      makeCandidate({
        candidateId: "qb-1",
        propType: "PASSING_ATTEMPTS",
        wrReceptionsSignals: undefined,
      }),
    );
    const out = buildWrReceptionsAnalysis({ candidates: cs });
    check(
      r,
      out.candidatesTotal === 11,
      `candidatesTotal=${out.candidatesTotal}, expected 11`,
    );
    check(
      r,
      out.wrReceptionsTotal === 6,
      `wrReceptionsTotal=${out.wrReceptionsTotal}, expected 6 (RB + PASSING excluded)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — WR filter excludes RB and other prop types");
    else console.log("[2] FAIL — WR filter");
  }

  // 3. tercile bucketing: 12-candidate pool with strictly
  //    increasing roleChange → low / medium / high all populated.
  {
    const r = makeReport("tercile bucketing");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 12; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          wrReceptionsSignals: makeWrSignals({ roleChange: i / 12 }),
          // Top tercile wins, rest losses.
          outcome: i >= 8 ? "WIN" : "LOSS",
          profitPerUnit: i >= 8 ? 0.91 : -1,
        }),
      );
    }
    const out = buildWrReceptionsAnalysis({ candidates: cs });
    const role = out.features.find((f) => f.feature === "roleChange");
    check(r, role !== undefined, "roleChange feature exists");
    if (role) {
      const low = role.buckets.find((b) => b.bucket === "low");
      const med = role.buckets.find((b) => b.bucket === "medium");
      const high = role.buckets.find((b) => b.bucket === "high");
      check(r, (low?.plays ?? 0) > 0, `low.plays=${low?.plays} expected > 0`);
      check(r, (med?.plays ?? 0) > 0, `medium.plays=${med?.plays} expected > 0`);
      check(r, (high?.plays ?? 0) > 0, `high.plays=${high?.plays} expected > 0`);
      check(
        r,
        (high?.roiPct ?? 0) > (low?.roiPct ?? 0),
        `high.roiPct=${high?.roiPct} should exceed low=${low?.roiPct}`,
      );
      check(
        r,
        role.highMinusLowRoiPp ===
          (high?.roiPct ?? 0) - (low?.roiPct ?? 0),
        `highMinusLowRoiPp=${role.highMinusLowRoiPp} should match high - low`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — tercile bucketing");
    else console.log("[3] FAIL — tercile bucketing");
  }

  // 4. Small pool fallback: <6 candidates → single medium bucket.
  {
    const r = makeReport("small pool fallback");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 3; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          wrReceptionsSignals: makeWrSignals({ roleChange: i * 0.1 }),
        }),
      );
    }
    const out = buildWrReceptionsAnalysis({ candidates: cs });
    const role = out.features.find((f) => f.feature === "roleChange");
    check(r, role !== undefined, "roleChange feature exists");
    if (role) {
      const med = role.buckets.find((b) => b.bucket === "medium");
      const low = role.buckets.find((b) => b.bucket === "low");
      const high = role.buckets.find((b) => b.bucket === "high");
      check(
        r,
        (med?.plays ?? 0) === 3,
        `medium.plays=${med?.plays}, expected 3 (whole pool)`,
      );
      check(r, (low?.plays ?? 0) === 0, `low.plays=${low?.plays}, expected 0`);
      check(r, (high?.plays ?? 0) === 0, `high.plays=${high?.plays}, expected 0`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — small pool fallback");
    else console.log("[4] FAIL — small pool fallback");
  }

  // 5. marketLag computation: role rose + market didn't move →
  //    high lag. Market moved a lot → ~0 lag.
  {
    const r = makeReport("marketLag computation");
    // Player A — week 1 baseline, week 2 role spike but market
    // unchanged → high lag.
    const a1 = makeCandidate({
      candidateId: "a-w1",
      playerName: "A",
      week: 1,
      marketProbability: 0.50,
      wrReceptionsSignals: makeWrSignals({ roleChange: 0 }),
    });
    const a2 = makeCandidate({
      candidateId: "a-w2",
      playerName: "A",
      week: 2,
      marketProbability: 0.51,
      wrReceptionsSignals: makeWrSignals({ roleChange: 0.6 }),
    });
    // Player B — week 1 baseline, week 2 role spike AND market
    // moved a lot → ~0 lag.
    const b1 = makeCandidate({
      candidateId: "b-w1",
      playerName: "B",
      week: 1,
      marketProbability: 0.50,
      wrReceptionsSignals: makeWrSignals({ roleChange: 0 }),
    });
    const b2 = makeCandidate({
      candidateId: "b-w2",
      playerName: "B",
      week: 2,
      marketProbability: 0.70,
      wrReceptionsSignals: makeWrSignals({ roleChange: 0.6 }),
    });
    const lag = computeMarketLagByCandidate([a1, a2, b1, b2]);
    check(
      r,
      (lag["a-w2"] ?? 0) > 0.3,
      `a-w2 lag=${lag["a-w2"]} expected > 0.3 (role rose, market didn't)`,
    );
    check(
      r,
      (lag["b-w2"] ?? 0) === 0,
      `b-w2 lag=${lag["b-w2"]} expected 0 (market moved 20pp)`,
    );
    // Week-1 candidates have no prior week — no lag entry.
    check(
      r,
      lag["a-w1"] === undefined,
      `a-w1 lag should be undefined (no prior week)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — marketLag computation");
    else console.log("[5] FAIL — marketLag");
  }

  // 6. Four named combinations exist with exact labels.
  {
    const r = makeReport("four named combinations");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 12; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          wrReceptionsSignals: makeWrSignals({ roleChange: i * 0.05 }),
        }),
      );
    }
    const out = buildWrReceptionsAnalysis({ candidates: cs });
    const labels = out.combinations.map((c) => c.label);
    check(
      r,
      out.combinations.length === 4,
      `combinations.length=${out.combinations.length}, expected 4`,
    );
    check(
      r,
      labels.includes("high roleChange + high route participation"),
      `missing "high roleChange + high route participation": ${labels.join(", ")}`,
    );
    check(
      r,
      labels.includes("high roleChange + market lag"),
      `missing "high roleChange + market lag": ${labels.join(", ")}`,
    );
    check(
      r,
      labels.includes("low volatility + edge ≥ 4%"),
      `missing "low volatility + edge ≥ 4%": ${labels.join(", ")}`,
    );
    check(
      r,
      labels.includes("high PROE + high roleChange"),
      `missing "high PROE + high roleChange": ${labels.join(", ")}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — four named combinations");
    else console.log("[6] FAIL — combinations");
  }

  // 7. "No measurable edge" verdict when no subset qualifies.
  {
    const r = makeReport("edgeFound = false → explicit message");
    // All losses → no subset has positive ROI.
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 12; i++) {
      cs.push(
        makeCandidate({
          candidateId: `c-${i}`,
          wrReceptionsSignals: makeWrSignals({ roleChange: i * 0.05 }),
          outcome: "LOSS",
          profitPerUnit: -1,
        }),
      );
    }
    const out = buildWrReceptionsAnalysis({ candidates: cs });
    check(r, out.edgeFound.found === false, "edgeFound.found should be false");
    check(r, out.edgeFound.label === null, "edgeFound.label should be null");
    check(
      r,
      out.formatted.includes(
        "No measurable edge found in WR receptions under current data",
      ),
      "formatted must surface the no-edge message verbatim",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — no-edge verdict surfaces explicit message");
    else console.log("[7] FAIL — no-edge verdict");
  }

  // 8. Edge-slice diagnostic embeds the WR receptions analysis
  //    in both the structured payload and the formatted output.
  {
    const r = makeReport("edge-slice report includes wrReceptionsAnalysis");
    const wrSig = {
      roleChange: 0.3,
      routeParticipationSlope: 0.1,
      targetShareVolatility: 0.1,
      teamProe: 0.05,
      defensiveMatchup: undefined,
      historyRowsUsed: 5,
      hasNeutralFallback: false,
      defensiveMatchupAvailable: false,
      teamHistoryAvailable: true,
    };
    const snap: StoredWeekSnapshot = {
      source: "postgres",
      dataMode: "stored",
      status: "READY",
      candidateCount: 6,
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
          totalCandidates: 6,
          candidatesWithActual: 6,
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
            qualifiedCount: 6,
            decisiveCount: 6,
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
            candidates: Array.from({ length: 6 }, (_, i) => ({
              candidateId: `c-${i}`,
              playerName: `WR ${i}`,
              team: "BUF",
              opponent: "NYJ",
              gameId: "2025-w1-test",
              propType: "RECEPTIONS",
              line: 4.5,
              recommendedSide: "OVER" as const,
              modelProbability: 0.55,
              marketProbability: 0.5,
              edge: 0.05,
              confidence: 0.6,
              riskScore: 0.65,
              dataQualityScore: 0.6,
              volatilityLevel: "medium" as const,
              wrReceptionsSignals: wrSig,
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
      out.wrReceptionsAnalysis !== undefined,
      "edge-slice report must include wrReceptionsAnalysis",
    );
    check(
      r,
      out.wrReceptionsAnalysis.wrReceptionsTotal === 6,
      `wrReceptionsTotal=${out.wrReceptionsAnalysis.wrReceptionsTotal}, expected 6`,
    );
    check(
      r,
      out.formatted.includes("=== WR RECEPTIONS SIGNAL ANALYSIS ==="),
      "edge-slice formatted output must embed the WR header",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — edge-slice wires wrReceptionsAnalysis");
    else console.log("[8] FAIL — edge-slice wiring");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 8 / 8 SCENARIOS PASSED");
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
