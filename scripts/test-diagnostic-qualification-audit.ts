/**
 * Diagnostic qualification audit assertions.
 *
 *   · For every candidate in the diagnostic gates (0.40, 0.35),
 *     the audit reports per-bucket gate statuses + the failing
 *     live gates set.
 *   · onlyMarketContextFailedLive === true for EVERY non-
 *     production-qualified candidate in the diagnostic gates
 *     — the calibration cannot bypass a second gate.
 *   · integrity.ok === true when the calibration is honest;
 *     integrity.violations is empty.
 *   · A candidate manually constructed to fail BOTH
 *     marketContext AND a second gate (e.g., roleStability)
 *     would be rejected by the calibration — proves the
 *     gate-only-marketContext filter is active.
 *   · Edge-filtered slices (≥ 4%, ≥ 6%, ≥ 8%, ≥ 10%)
 *     correctly narrow the candidate pool and re-compute hit
 *     rate / ROI / units off the smaller sample.
 *   · The elite-only slice contains exactly the production-
 *     qualified candidates from each gate view.
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildDiagnosticQualificationAudit,
  bucketScoresFromEvaluatedCandidates,
  LIVE_GATE_THRESHOLDS,
  type RiskBucket,
} from "../src/lib/backtest/diagnostic-qualification-audit";
import {
  buildMarketContextCalibration,
  type CalibrationCandidate,
} from "../src/lib/backtest/market-context-calibration";
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

function candidate(over: Partial<RealWeekCandidate> = {}): RealWeekCandidate {
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
    overOdds: -112,
    underOdds: -112,
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
    // All other bucket scores at-or-above their gate by default
    // (so the candidate's only failing gate is marketContext).
    dataQualityScore: 0.7,
    roleStabilityScore: 0.8,
    gameScriptScore: 0.6,
    paceScore: 0.6,
    marketContextScore: 0.4,
    weatherEnvironmentScore: 0.85,
    injuryContextScore: 0.85,
    correlationExposureScore: 0.8,
    volatilityLevel: "medium",
    primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
    disqualifiers: ["Market context score 0.40 below 0.45 gate"],
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
    overOdds: -112,
    underOdds: -112,
    actualValue: 6,
    overOutcome: "WIN",
    underOutcome: "LOSS",
    overProfitPerUnit: 0.893,
    underProfitPerUnit: -1,
    decisive: true,
    ...over,
  };
}

function main(): void {
  console.log("Diagnostic qualification audit — assertions");
  console.log("===========================================");

  // 1. Per-candidate gate statuses are present and accurate.
  {
    const r = makeReport("per-candidate gate statuses present");
    const c = candidate({ id: "c-1" });
    c.scorecard = stubScorecard();
    const replay = buildMarketContextCalibration({
      candidates: [c],
      graded: [gradedRow({ candidateId: "c-1" })],
    });
    const audit = buildDiagnosticQualificationAudit({
      replay,
      bucketScoresByCandidateId: bucketScoresFromEvaluatedCandidates([c]),
    });
    check(
      r,
      audit.gate040.candidates.length === 1,
      `gate040.candidates length=${audit.gate040.candidates.length}, expected 1`,
    );
    const a = audit.gate040.candidates[0];
    check(
      r,
      a.gateStatuses.length === 8,
      `gateStatuses length=${a.gateStatuses.length}, expected 8`,
    );
    // Every bucket score the scorecard reported must show up
    // with a matching pass/fail flag.
    for (const status of a.gateStatuses) {
      check(
        r,
        status.gate === LIVE_GATE_THRESHOLDS[status.bucket as RiskBucket],
        `${status.bucket} gate=${status.gate}, expected ${LIVE_GATE_THRESHOLDS[status.bucket as RiskBucket]}`,
      );
      check(
        r,
        status.passedLive === status.score >= status.gate,
        `${status.bucket} passedLive math drift`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — per-candidate gate statuses present");
    else console.log("[1] FAIL — gate statuses");
  }

  // 2. onlyMarketContextFailedLive === true for every diagnostic
  //    candidate that wasn't already production-qualified.
  {
    const r = makeReport("diagnostic candidates fail ONLY marketContext");
    const c = candidate({ id: "c-2", overOdds: -113, underOdds: -113 });
    c.scorecard = stubScorecard({
      disqualifiers: ["Market context score 0.40 below 0.45 gate"],
      primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
    });
    const replay = buildMarketContextCalibration({
      candidates: [c],
      graded: [gradedRow({ candidateId: "c-2" })],
    });
    const audit = buildDiagnosticQualificationAudit({
      replay,
      bucketScoresByCandidateId: bucketScoresFromEvaluatedCandidates([c]),
    });
    for (const a of audit.gate040.candidates) {
      if (a.productionQualified) continue;
      check(
        r,
        a.onlyMarketContextFailedLive === true,
        `${a.candidateId}: onlyMarketContextFailedLive=${a.onlyMarketContextFailedLive}, expected true`,
      );
      // Every gate other than marketContext must pass.
      const otherFails = a.failingLiveGates.filter(
        (g) => g !== "marketContext",
      );
      check(
        r,
        otherFails.length === 0,
        `${a.candidateId}: other failing gates ${JSON.stringify(otherFails)}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — diagnostic candidates fail only marketContext");
    else console.log("[2] FAIL — onlyMarketContext check");
  }

  // 3. Integrity check passes: no other gate was bypassed.
  {
    const r = makeReport("integrity.ok = true for honest replay");
    const c1 = candidate({ id: "c-3", overOdds: -112, underOdds: -112 });
    c1.scorecard = stubScorecard();
    const c2 = candidate({
      id: "c-4",
      playerName: "Player B",
      overOdds: -113,
      underOdds: -113,
    });
    c2.scorecard = stubScorecard();
    const replay = buildMarketContextCalibration({
      candidates: [c1, c2],
      graded: [gradedRow({ candidateId: "c-3" }), gradedRow({ candidateId: "c-4" })],
    });
    const audit = buildDiagnosticQualificationAudit({
      replay,
      bucketScoresByCandidateId: bucketScoresFromEvaluatedCandidates([c1, c2]),
    });
    check(r, audit.integrity.ok === true, `integrity.ok=${audit.integrity.ok}`);
    check(
      r,
      audit.integrity.violations.length === 0,
      `violations=${JSON.stringify(audit.integrity.violations)}`,
    );
    check(
      r,
      audit.integrity.overriddenGate === "marketContext",
      `overriddenGate=${audit.integrity.overriddenGate}`,
    );
    check(
      r,
      audit.gate040.failingOtherGateCount === 0,
      `gate040.failingOtherGateCount=${audit.gate040.failingOtherGateCount}, expected 0`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — integrity check passes for honest replay");
    else console.log("[3] FAIL — integrity check");
  }

  // 4. CALIBRATION CANNOT BYPASS A SECOND GATE. A candidate
  //    that fails BOTH marketContext AND roleStability is
  //    NOT included in the diagnostic gates — the calibration
  //    rejects it because `otherDisqs.length > 0`.
  {
    const r = makeReport("calibration rejects multi-gate failure");
    const c = candidate({ id: "double-fail", overOdds: -112, underOdds: -112 });
    c.scorecard = stubScorecard({
      qualified: false,
      // Two failing gates → calibration must reject.
      disqualifiers: [
        "Market context score 0.40 below 0.45 gate",
        "Role stability score 0.40 below 0.55 gate",
      ],
      primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
      roleStabilityScore: 0.4,
    });
    const replay = buildMarketContextCalibration({
      candidates: [c],
      graded: [gradedRow({ candidateId: "double-fail" })],
    });
    check(
      r,
      replay.gate040.qualifiedCount === 0,
      `gate040.qualifiedCount=${replay.gate040.qualifiedCount}, expected 0 (multi-gate failure)`,
    );
    check(
      r,
      replay.gate035.qualifiedCount === 0,
      `gate035.qualifiedCount=${replay.gate035.qualifiedCount}, expected 0`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — multi-gate failure rejected by calibration");
    else console.log("[4] FAIL — multi-gate rejection");
  }

  // 5. Edge-filtered slices narrow the pool correctly.
  {
    const r = makeReport("edge slices narrow correctly");
    // 4 candidates with edges 5%, 7%, 9%, 12%. Odds chosen so
    // raw marketContext score lands ≥ 0.40 (passes the gate 0.40
    // override) — -112/-112 → raw ≈ 0.434.
    const cs: RealWeekCandidate[] = [];
    for (const [i, edge] of [
      [1, 0.05],
      [2, 0.07],
      [3, 0.09],
      [4, 0.12],
    ] as Array<[number, number]>) {
      const c = candidate({
        id: `e-${i}`,
        playerName: `Player ${i}`,
        overOdds: -112,
        underOdds: -112,
      });
      c.scorecard = stubScorecard({
        edge,
        edgeOver: edge,
        marketContextScore: 0.4,
        disqualifiers: ["Market context score 0.40 below 0.45 gate"],
        primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
      });
      cs.push(c);
    }
    const replay = buildMarketContextCalibration({
      candidates: cs,
      graded: cs.map((c) =>
        gradedRow({
          candidateId: c.id,
          overOutcome: "WIN",
          underOutcome: "LOSS",
        }),
      ),
    });
    const audit = buildDiagnosticQualificationAudit({
      replay,
      bucketScoresByCandidateId: bucketScoresFromEvaluatedCandidates(cs),
    });
    const slices = audit.gate040.byMinEdge;
    const get = (label: string) =>
      slices.find((s) => s.label === label);
    // ≥ 4% includes all 4
    check(r, get("edge ≥ 4%")?.count === 4, `≥4% count=${get("edge ≥ 4%")?.count}`);
    // ≥ 6% includes edges 7%, 9%, 12% = 3
    check(r, get("edge ≥ 6%")?.count === 3, `≥6% count=${get("edge ≥ 6%")?.count}`);
    // ≥ 8% includes edges 9%, 12% = 2
    check(r, get("edge ≥ 8%")?.count === 2, `≥8% count=${get("edge ≥ 8%")?.count}`);
    // ≥ 10% includes edge 12% = 1
    check(r, get("edge ≥ 10%")?.count === 1, `≥10% count=${get("edge ≥ 10%")?.count}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — edge slices narrow correctly");
    else console.log("[5] FAIL — edge slices");
  }

  // 6. Elite-only slice = production-qualified count from the
  //    gate view.
  {
    const r = makeReport("elite-only slice = production-qualified");
    const cProd = candidate({ id: "prod-q" });
    cProd.scorecard = stubScorecard({
      qualified: true,
      disqualifiers: [],
      primaryDisqualifier: undefined,
      recommendation: "OVER",
    });
    const cDiag = candidate({
      id: "diag-only",
      playerName: "Diag",
      overOdds: -113,
      underOdds: -113,
    });
    cDiag.scorecard = stubScorecard();
    const replay = buildMarketContextCalibration({
      candidates: [cProd, cDiag],
      graded: [
        gradedRow({ candidateId: "prod-q" }),
        gradedRow({ candidateId: "diag-only" }),
      ],
    });
    const audit = buildDiagnosticQualificationAudit({
      replay,
      bucketScoresByCandidateId: bucketScoresFromEvaluatedCandidates([cProd, cDiag]),
    });
    check(
      r,
      audit.production.eliteOnly.count === 1,
      `production.eliteOnly.count=${audit.production.eliteOnly.count}, expected 1`,
    );
    check(
      r,
      audit.gate040.eliteOnly.count === 1,
      `gate040.eliteOnly.count=${audit.gate040.eliteOnly.count}, expected 1 (same elite set)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — elite-only slice = production-qualified count");
    else console.log("[6] FAIL — elite slice");
  }

  // 7. The audit module + admin runner reference each other —
  //    source-level guarantee that the audit is wired in.
  {
    const r = makeReport("admin runner wires the audit");
    const adminText = readSrc("src/lib/admin/admin-runner.ts");
    check(
      r,
      /buildDiagnosticQualificationAudit/.test(adminText),
      "admin runner must import buildDiagnosticQualificationAudit",
    );
    check(
      r,
      /bucketScoresFromEvaluatedCandidates/.test(adminText),
      "admin runner must build the bucket-scores map",
    );
    check(
      r,
      /diagnosticQualificationAudit/.test(adminText),
      "resultsJson + data must surface diagnosticQualificationAudit",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — admin runner wires the audit");
    else console.log("[7] FAIL — admin wiring");
  }

  // 8. No banned hooks anywhere.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/lib/backtest/diagnostic-qualification-audit.ts",
      "src/lib/admin/admin-runner.ts",
      "src/lib/backtest/market-context-calibration.ts",
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
    console.log("All 8 diagnostic-qualification-audit assertions passed.");
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
