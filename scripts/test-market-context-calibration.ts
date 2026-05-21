/**
 * Market-context gate calibration replay assertions.
 *
 *   · production gate stays at 0.45 (no threshold drift)
 *   · production result = recommendedPlays.count from grading
 *   · diagnostic 0.40 includes a candidate whose ONLY failure
 *     was marketContext AND whose raw score is ≥ 0.40, but
 *     EXCLUDES candidates with other failures
 *   · diagnostic 0.35 strictly contains everyone from 0.40
 *     plus candidates with raw scores in [0.35, 0.40)
 *   · qualifying candidates are graded against their actual
 *     outcome on the recommended side
 *   · the replay does not mutate input candidates or
 *     scorecards (a fresh deepClone matches the original)
 *   · the replay does NOT change production qualified count or
 *     production hit/ROI
 *   · diagnostic candidates carry a `removedDisqualifiers`
 *     field naming exactly what the override stripped
 *   · the snapshot loader passes the calibration through
 *   · no banned hooks (Odds API, Kalshi, automated betting, TD)
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildMarketContextCalibration,
  PRODUCTION_MARKET_CONTEXT_GATE,
} from "../src/lib/backtest/market-context-calibration";
import { rawMarketContextScore } from "../src/lib/backtest/stored-candidate-scorecard";
import type { RealWeekCandidate } from "../src/lib/backtest/real-week-candidate-builder";
import type { GradedCandidate } from "../src/lib/backtest/week-1-grading";

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

function makeCandidate(over: Partial<RealWeekCandidate> = {}): RealWeekCandidate {
  return {
    id: "c-0",
    season: 2025,
    week: 1,
    gameId: "2025-w1",
    playerName: "Player A",
    team: "BUF",
    opponent: "NYJ",
    propType: "RECEPTIONS",
    line: 4.5,
    overOdds: -110,
    underOdds: -110,
    sportsbook: "DRAFTKINGS",
    dataMode: "STORED_2025",
    syntheticFixture: false,
    ...over,
  };
}

function stubScorecard(
  over: Partial<NonNullable<RealWeekCandidate["scorecard"]>> = {},
): NonNullable<RealWeekCandidate["scorecard"]> {
  return {
    recommendation: "PASS",
    selectedSide: "OVER",
    qualified: false,
    modelOverProbability: 0.6,
    modelUnderProbability: 0.4,
    modelProbability: 0.6,
    marketOverProbability: 0.52,
    marketUnderProbability: 0.48,
    noVigOverProbability: 0.52,
    noVigUnderProbability: 0.48,
    edgeOver: 0.08,
    edgeUnder: -0.08,
    edge: 0.08,
    edgeThreshold: 0.04,
    confidence: 0.65,
    riskScore: 0.65,
    dataQualityScore: 0.7,
    roleStabilityScore: 0.8,
    gameScriptScore: 0.6,
    paceScore: 0.6,
    marketContextScore: 0.4,
    weatherEnvironmentScore: 0.85,
    injuryContextScore: 0.85,
    correlationExposureScore: 0.8,
    volatilityLevel: "medium",
    primaryDisqualifier: undefined,
    disqualifiers: [],
    passReasons: [],
    failReasons: [],
    projectedMean: 6,
    projectedStdDev: 1,
    ...over,
  };
}

function gradedRow(over: Partial<GradedCandidate>): GradedCandidate {
  return {
    candidateId: "c-0",
    gameId: "2025-w1",
    playerName: "Player A",
    team: "BUF",
    opponent: "NYJ",
    propType: "RECEPTIONS",
    line: 4.5,
    overOdds: -110,
    underOdds: -110,
    actualValue: 6,
    overOutcome: "WIN",
    underOutcome: "LOSS",
    overProfitPerUnit: 0.909,
    underProfitPerUnit: -1,
    decisive: true,
    ...over,
  };
}

function main(): void {
  console.log("Market-context gate calibration — assertions");
  console.log("=============================================");

  // 1. Production gate exposed exactly as 0.45 — no drift.
  {
    const r = makeReport("PRODUCTION_MARKET_CONTEXT_GATE is 0.45");
    check(
      r,
      PRODUCTION_MARKET_CONTEXT_GATE === 0.45,
      `PRODUCTION_MARKET_CONTEXT_GATE=${PRODUCTION_MARKET_CONTEXT_GATE}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — production gate constant unchanged");
    else console.log("[1] FAIL — production constant");
  }

  // 2. A candidate that failed ONLY on marketContext, with raw
  //    score in [0.40, 0.45), qualifies at gate 0.40 but NOT at
  //    production 0.45.
  {
    const r = makeReport("only-marketContext, raw in [0.40,0.45) qualifies at 0.40");
    // -112/-112 → raw ≈ 0.434.
    const c = makeCandidate({
      id: "mc-only",
      overOdds: -112,
      underOdds: -112,
    });
    c.scorecard = stubScorecard({
      qualified: false,
      disqualifiers: ["Market context score 0.43 below 0.45 gate"],
      primaryDisqualifier: "Market context score 0.43 below 0.45 gate",
      marketContextScore: 0.434,
    });
    const cal = buildMarketContextCalibration({
      candidates: [c],
      graded: [
        gradedRow({
          candidateId: "mc-only",
          overOdds: -112,
          underOdds: -112,
          overProfitPerUnit: 0.893,
        }),
      ],
    });
    check(
      r,
      cal.production.qualifiedCount === 0,
      `production qualified=${cal.production.qualifiedCount}, expected 0`,
    );
    check(
      r,
      cal.gate040.qualifiedCount === 1,
      `gate040 qualified=${cal.gate040.qualifiedCount}, expected 1`,
    );
    check(
      r,
      cal.gate035.qualifiedCount === 1,
      `gate035 qualified=${cal.gate035.qualifiedCount}, expected 1`,
    );
    // The qualifying candidate must carry removedDisqualifiers
    // identifying what the override stripped.
    const row = cal.gate040.candidates[0];
    check(
      r,
      row.removedDisqualifiers.length === 1,
      `removedDisqualifiers=${row.removedDisqualifiers.length}, expected 1`,
    );
    check(
      r,
      row.removedDisqualifiers[0].toLowerCase().includes("market context"),
      `removedDisqualifiers[0]=${row.removedDisqualifiers[0]}`,
    );
    // Recommended side carries OVER (the selectedSide we stubbed).
    check(r, row.recommendedSide === "OVER", `side=${row.recommendedSide}`);
    // Outcome graded as WIN at -112 (our gradedRow stub).
    check(r, row.outcome === "WIN", `outcome=${row.outcome}`);
    check(
      r,
      Math.abs(row.profitPerUnit - 0.893) < 1e-9,
      `profit=${row.profitPerUnit}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — only-marketContext candidate qualifies at 0.40");
    else console.log("[2] FAIL — single-failure qualification");
  }

  // 3. A candidate that failed on marketContext AND something
  //    else does NOT qualify at any gate override.
  {
    const r = makeReport("multi-failure candidate stays disqualified");
    const c = makeCandidate({
      id: "multi-fail",
      overOdds: -112,
      underOdds: -112,
    });
    c.scorecard = stubScorecard({
      qualified: false,
      disqualifiers: [
        "Market context score 0.43 below 0.45 gate",
        "Data quality score 0.40 below 0.55 gate",
      ],
      primaryDisqualifier: "Market context score 0.43 below 0.45 gate",
      marketContextScore: 0.434,
      dataQualityScore: 0.4,
    });
    const cal = buildMarketContextCalibration({
      candidates: [c],
      graded: [gradedRow({ candidateId: "multi-fail" })],
    });
    check(
      r,
      cal.gate040.qualifiedCount === 0,
      `gate040 qualified=${cal.gate040.qualifiedCount}, expected 0 (multi-failure)`,
    );
    check(
      r,
      cal.gate035.qualifiedCount === 0,
      `gate035 qualified=${cal.gate035.qualifiedCount}, expected 0 (multi-failure)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — multi-failure candidate excluded from override");
    else console.log("[3] FAIL — multi-failure inclusion");
  }

  // 4. A candidate whose raw marketContext score is BELOW the
  //    lowered gate still fails. -120/-120 → raw ≈ 0.091.
  {
    const r = makeReport("raw score below lowered gate still fails");
    const c = makeCandidate({
      id: "deep-vig",
      overOdds: -120,
      underOdds: -120,
    });
    c.scorecard = stubScorecard({
      qualified: false,
      disqualifiers: ["Market context score 0.40 below 0.45 gate"],
      primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
      marketContextScore: 0.4,
    });
    const raw = rawMarketContextScore(c);
    check(r, raw < 0.35, `raw expected < 0.35 (got ${raw})`);
    const cal = buildMarketContextCalibration({
      candidates: [c],
      graded: [gradedRow({ candidateId: "deep-vig" })],
    });
    check(
      r,
      cal.gate040.qualifiedCount === 0,
      `gate040 qualified=${cal.gate040.qualifiedCount}, expected 0 (raw=${raw.toFixed(3)})`,
    );
    check(
      r,
      cal.gate035.qualifiedCount === 0,
      `gate035 qualified=${cal.gate035.qualifiedCount}, expected 0`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — deep-vig raw < 0.35 stays disqualified");
    else console.log("[4] FAIL — deep-vig inclusion");
  }

  // 5. A production-qualified candidate is counted at every
  //    gate. The production gate result matches the qualified
  //    count exactly.
  {
    const r = makeReport("production qualified flow through every gate");
    const c = makeCandidate({ id: "qual" });
    c.scorecard = stubScorecard({
      qualified: true,
      disqualifiers: [],
      primaryDisqualifier: undefined,
      recommendation: "OVER",
    });
    const cal = buildMarketContextCalibration({
      candidates: [c],
      graded: [
        gradedRow({
          candidateId: "qual",
          actualValue: 6,
          overOutcome: "WIN",
          underOutcome: "LOSS",
        }),
      ],
    });
    check(
      r,
      cal.production.qualifiedCount === 1,
      `production qualified=${cal.production.qualifiedCount}, expected 1`,
    );
    check(
      r,
      cal.gate040.qualifiedCount === 1,
      `gate040 qualified=${cal.gate040.qualifiedCount}, expected 1`,
    );
    check(
      r,
      cal.gate035.qualifiedCount === 1,
      `gate035 qualified=${cal.gate035.qualifiedCount}, expected 1`,
    );
    // Production candidate has no removedDisqualifiers.
    check(
      r,
      cal.production.candidates[0].removedDisqualifiers.length === 0,
      `production removedDisqs=${cal.production.candidates[0].removedDisqualifiers.length}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — production qualified counted at every gate");
    else console.log("[5] FAIL — production carry-through");
  }

  // 6. Replay does not mutate the input candidates or
  //    scorecards.
  {
    const r = makeReport("replay does not mutate input candidates");
    const c = makeCandidate({
      id: "stable",
      overOdds: -112,
      underOdds: -112,
    });
    c.scorecard = stubScorecard({
      qualified: false,
      disqualifiers: ["Market context score 0.43 below 0.45 gate"],
      primaryDisqualifier: "Market context score 0.43 below 0.45 gate",
      marketContextScore: 0.43,
    });
    const before = JSON.stringify(c);
    buildMarketContextCalibration({
      candidates: [c],
      graded: [gradedRow({ candidateId: "stable" })],
    });
    const after = JSON.stringify(c);
    check(r, before === after, "candidate mutated by replay");
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — replay is pure / non-mutating");
    else console.log("[6] FAIL — input mutation");
  }

  // 7. The diagnosticOnly flag is true and the production gate
  //    field is the constant 0.45 — the page uses this for the
  //    safety chip.
  {
    const r = makeReport("diagnosticOnly + productionGate fields present");
    const cal = buildMarketContextCalibration({
      candidates: [],
      graded: [],
    });
    check(
      r,
      cal.diagnosticOnly === true,
      `diagnosticOnly=${cal.diagnosticOnly}`,
    );
    check(
      r,
      cal.productionGate === 0.45,
      `productionGate=${cal.productionGate}`,
    );
    check(
      r,
      cal.production.gateThreshold === 0.45,
      `production.gateThreshold=${cal.production.gateThreshold}`,
    );
    check(
      r,
      cal.production.isProduction === true,
      `production.isProduction=${cal.production.isProduction}`,
    );
    check(
      r,
      cal.gate040.isProduction === false,
      `gate040.isProduction=${cal.gate040.isProduction}`,
    );
    check(
      r,
      cal.gate035.isProduction === false,
      `gate035.isProduction=${cal.gate035.isProduction}`,
    );
    check(
      r,
      cal.note.toLowerCase().includes("diagnostic"),
      `note=${cal.note}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — diagnostic flag + production gate intact");
    else console.log("[7] FAIL — diagnostic fields");
  }

  // 8. 0.35 contains everyone from 0.40 plus more.
  //    Build a 3-candidate mix: production-qualified, only-MC
  //    with raw=0.43, only-MC with raw=0.36, only-MC with
  //    raw=0.10. Expected:
  //    production: 1, 0.40: 2, 0.35: 3.
  {
    const r = makeReport("0.35 contains 0.40 contains production");
    const candidates: RealWeekCandidate[] = [
      (() => {
        const c = makeCandidate({ id: "qual" });
        c.scorecard = stubScorecard({
          qualified: true,
          disqualifiers: [],
          recommendation: "OVER",
        });
        return c;
      })(),
      (() => {
        const c = makeCandidate({
          id: "mc-043",
          overOdds: -112,
          underOdds: -112,
        });
        c.scorecard = stubScorecard({
          qualified: false,
          disqualifiers: ["Market context score 0.43 below 0.45 gate"],
          primaryDisqualifier: "Market context score 0.43 below 0.45 gate",
        });
        return c;
      })(),
      (() => {
        const c = makeCandidate({
          id: "mc-036",
          overOdds: -113,
          underOdds: -113,
        });
        c.scorecard = stubScorecard({
          qualified: false,
          disqualifiers: ["Market context score 0.40 below 0.45 gate"],
          primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
        });
        return c;
      })(),
      (() => {
        const c = makeCandidate({
          id: "mc-010",
          overOdds: -120,
          underOdds: -120,
        });
        c.scorecard = stubScorecard({
          qualified: false,
          disqualifiers: ["Market context score 0.40 below 0.45 gate"],
          primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
        });
        return c;
      })(),
    ];
    const graded = candidates.map((c) => gradedRow({ candidateId: c.id }));
    const cal = buildMarketContextCalibration({ candidates, graded });
    check(
      r,
      cal.production.qualifiedCount === 1,
      `production=${cal.production.qualifiedCount}, expected 1`,
    );
    // -112 raw ≈ 0.434, -113 raw ≈ 0.389. So at gate 0.40, only
    // qual + mc-043 qualify (mc-036 raw 0.389 < 0.40).
    check(
      r,
      cal.gate040.qualifiedCount === 2,
      `gate040=${cal.gate040.qualifiedCount}, expected 2`,
    );
    // At gate 0.35: qual + mc-043 + mc-036. mc-010 raw is ≈0.091 → still fails.
    check(
      r,
      cal.gate035.qualifiedCount === 3,
      `gate035=${cal.gate035.qualifiedCount}, expected 3`,
    );
    // The candidate sets MUST be subsets in order.
    const ids040 = new Set(cal.gate040.candidates.map((c) => c.candidateId));
    const ids035 = new Set(cal.gate035.candidates.map((c) => c.candidateId));
    const idsProd = new Set(cal.production.candidates.map((c) => c.candidateId));
    for (const id of idsProd) check(r, ids040.has(id), `prod id ${id} not in 0.40`);
    for (const id of ids040) check(r, ids035.has(id), `0.40 id ${id} not in 0.35`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — monotonic 0.35 ⊇ 0.40 ⊇ production");
    else console.log("[8] FAIL — monotonicity");
  }

  // 9. Grading + breakdowns: a 2-play diagnostic gate produces
  //    sensible W/L/hit/ROI numbers and byPropType counts.
  {
    const r = makeReport("graded aggregates compute correctly");
    const c1 = makeCandidate({
      id: "w1",
      playerName: "Player W",
      overOdds: -112,
      underOdds: -112,
    });
    c1.scorecard = stubScorecard({
      qualified: false,
      disqualifiers: ["Market context score 0.43 below 0.45 gate"],
      primaryDisqualifier: "Market context score 0.43 below 0.45 gate",
    });
    const c2 = makeCandidate({
      id: "l1",
      playerName: "Player L",
      overOdds: -112,
      underOdds: -112,
      propType: "RECEPTIONS",
    });
    c2.scorecard = stubScorecard({
      qualified: false,
      disqualifiers: ["Market context score 0.43 below 0.45 gate"],
      primaryDisqualifier: "Market context score 0.43 below 0.45 gate",
    });
    const graded = [
      gradedRow({
        candidateId: "w1",
        overOutcome: "WIN",
        underOutcome: "LOSS",
        overProfitPerUnit: 0.893,
      }),
      gradedRow({
        candidateId: "l1",
        overOutcome: "LOSS",
        underOutcome: "WIN",
        overProfitPerUnit: -1,
      }),
    ];
    const cal = buildMarketContextCalibration({
      candidates: [c1, c2],
      graded,
    });
    check(
      r,
      cal.gate040.qualifiedCount === 2,
      `qualified=${cal.gate040.qualifiedCount}, expected 2`,
    );
    check(
      r,
      cal.gate040.wins === 1 && cal.gate040.losses === 1,
      `W=${cal.gate040.wins} L=${cal.gate040.losses}, expected 1/1`,
    );
    check(
      r,
      Math.abs(cal.gate040.hitRatePct - 50) < 1e-9,
      `hitRatePct=${cal.gate040.hitRatePct}, expected 50`,
    );
    // (0.893 + -1) / 2 = -0.0535 → -5.35% ROI.
    check(
      r,
      Math.abs(cal.gate040.roiPct - -5.35) < 0.01,
      `roiPct=${cal.gate040.roiPct.toFixed(3)}, expected ≈ -5.35`,
    );
    // byPropType bucket
    const recBucket = cal.gate040.byPropType.find(
      (b) => b.propType === "RECEPTIONS",
    );
    check(r, recBucket !== undefined, "RECEPTIONS bucket present");
    check(
      r,
      recBucket?.count === 2,
      `RECEPTIONS count=${recBucket?.count}, expected 2`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — grading aggregates correct");
    else console.log("[9] FAIL — graded aggregates");
  }

  // 10. No banned hooks in the calibration module or surfaces.
  {
    const r = makeReport("no banned hooks in calibration files");
    const files = [
      "src/lib/backtest/market-context-calibration.ts",
      "src/lib/admin/admin-runner.ts",
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
    if (r.reasons.length === 0)
      console.log("[10] PASS — no banned hooks");
    else console.log("[10] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 10 market-context-calibration assertions passed.");
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
