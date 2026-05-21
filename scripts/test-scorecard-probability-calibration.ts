/**
 * Scorecard probability calibration assertions.
 *
 *   · calibrateModelProbability blends raw model + no-vig
 *     market at 60/40, then clamps to [0.30, 0.70].
 *   · The scorecard exposes rawModelOverProbability +
 *     rawModelUnderProbability ALONGSIDE the calibrated
 *     modelOverProbability + modelUnderProbability — both are
 *     "logged" on the output for diagnostics.
 *   · Edge math runs off the CALIBRATED probability, not the
 *     raw. A strong raw signal (e.g. 95%) is capped at 70%, so
 *     the edge is bounded by the calibration band.
 *   · The cap activates for over-confident projections — raw
 *     ≥ 0.95 → calibrated 0.70 max.
 *   · The floor activates for under-confident projections —
 *     raw ≤ 0.05 → calibrated 0.30 min.
 *   · OVER + UNDER stay coherent: under = 1 − over.
 *   · Distribution-based math is unchanged — same mean / σ →
 *     same raw probability via normalCdf.
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildPropDecisionScorecard,
  calibrateModelProbability,
  CALIBRATION_BLEND_WEIGHT_MODEL,
  CALIBRATION_BLEND_WEIGHT_MARKET,
  CALIBRATION_PROBABILITY_CAP,
  CALIBRATION_PROBABILITY_FLOOR,
  type ScorecardInput,
} from "../src/lib/model/model-scorecard";

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

/** Build a ScorecardInput that bypasses every risk gate so we
 *  can isolate the probability + edge math under test. */
function passingInput(over: Partial<ScorecardInput> = {}): ScorecardInput {
  return {
    propType: "PASSING_YARDS",
    marketLine: 248.5,
    overOdds: -110,
    underOdds: -110,
    projectedMean: 248.5,
    projectedStdDev: 30,
    dataQualityScore: 0.85,
    roleStabilityScore: 0.85,
    gameScriptScore: 0.8,
    paceScore: 0.7,
    marketContextScore: 0.7,
    weatherEnvironmentScore: 0.9,
    injuryContextScore: 0.9,
    correlationExposureScore: 0.85,
    ...over,
  };
}

function main(): void {
  console.log("Scorecard probability calibration — assertions");
  console.log("==============================================");

  // 1. Calibration constants documented and exported.
  {
    const r = makeReport("calibration constants exported");
    check(
      r,
      CALIBRATION_BLEND_WEIGHT_MODEL === 0.6,
      `MODEL weight=${CALIBRATION_BLEND_WEIGHT_MODEL}, expected 0.6`,
    );
    check(
      r,
      CALIBRATION_BLEND_WEIGHT_MARKET === 0.4,
      `MARKET weight=${CALIBRATION_BLEND_WEIGHT_MARKET}, expected 0.4`,
    );
    check(
      r,
      Math.abs(
        CALIBRATION_BLEND_WEIGHT_MODEL + CALIBRATION_BLEND_WEIGHT_MARKET - 1,
      ) < 1e-9,
      "weights must sum to 1",
    );
    check(
      r,
      CALIBRATION_PROBABILITY_CAP === 0.7,
      `cap=${CALIBRATION_PROBABILITY_CAP}, expected 0.7`,
    );
    check(
      r,
      CALIBRATION_PROBABILITY_FLOOR === 0.3,
      `floor=${CALIBRATION_PROBABILITY_FLOOR}, expected 0.3`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — calibration constants exported");
    else console.log("[1] FAIL — constants");
  }

  // 2. Blend math: 0.6 × raw + 0.4 × market.
  //    raw = 0.65, market = 0.50 → 0.6×0.65 + 0.4×0.50 = 0.59.
  {
    const r = makeReport("blend math: 60/40");
    const v = calibrateModelProbability({
      rawModelProbability: 0.65,
      noVigMarketProbability: 0.5,
    });
    check(r, Math.abs(v - 0.59) < 1e-9, `calibrated=${v}, expected 0.59`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — blend math (60/40)");
    else console.log("[2] FAIL — blend");
  }

  // 3. Cap at 0.70 when raw is high.
  //    raw = 0.95, market = 0.55 → blend = 0.79 → clamp to 0.70.
  {
    const r = makeReport("cap at 0.70 for over-confident raw");
    const v = calibrateModelProbability({
      rawModelProbability: 0.95,
      noVigMarketProbability: 0.55,
    });
    check(r, Math.abs(v - 0.7) < 1e-9, `calibrated=${v}, expected 0.70 (cap)`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — cap at 0.70");
    else console.log("[3] FAIL — cap");
  }

  // 4. Floor at 0.30 when raw is low.
  //    raw = 0.05, market = 0.45 → blend = 0.21 → clamp to 0.30.
  {
    const r = makeReport("floor at 0.30 for under-confident raw");
    const v = calibrateModelProbability({
      rawModelProbability: 0.05,
      noVigMarketProbability: 0.45,
    });
    check(r, Math.abs(v - 0.3) < 1e-9, `calibrated=${v}, expected 0.30 (floor)`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — floor at 0.30");
    else console.log("[4] FAIL — floor");
  }

  // 5. Scorecard EXPOSES both raw + calibrated. The output
  //    carries the four fields the user asked us to "log":
  //    rawModelOverProbability, rawModelUnderProbability,
  //    modelOverProbability (calibrated), modelUnderProbability
  //    (calibrated). Plus marketOverProbability for the market
  //    side.
  {
    const r = makeReport("scorecard exposes raw + calibrated + market");
    const sc = buildPropDecisionScorecard(
      passingInput({
        // Strong OVER projection: μ much higher than line so
        // raw OVER prob > calibrated cap.
        projectedMean: 285,
        projectedStdDev: 25,
        marketLine: 248.5,
      }),
    );
    check(
      r,
      typeof sc.rawModelOverProbability === "number",
      "rawModelOverProbability field present",
    );
    check(
      r,
      typeof sc.rawModelUnderProbability === "number",
      "rawModelUnderProbability field present",
    );
    check(
      r,
      typeof sc.modelOverProbability === "number",
      "modelOverProbability (calibrated) field present",
    );
    check(
      r,
      typeof sc.marketOverProbability === "number",
      "marketOverProbability field present",
    );
    // For the constructed input the raw OVER probability is
    // very high (~93%) and must exceed the calibrated value,
    // which should be at the cap.
    check(
      r,
      sc.rawModelOverProbability > 0.85,
      `rawModelOverProbability=${sc.rawModelOverProbability}, expected > 0.85`,
    );
    check(
      r,
      sc.modelOverProbability <= CALIBRATION_PROBABILITY_CAP + 1e-9,
      `modelOverProbability=${sc.modelOverProbability} must not exceed cap 0.70`,
    );
    check(
      r,
      Math.abs(sc.modelOverProbability - CALIBRATION_PROBABILITY_CAP) < 1e-9,
      `modelOverProbability should be at the cap exactly for this strong projection`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — raw + calibrated + market all on output");
    else console.log("[5] FAIL — output fields");
  }

  // 6. Edge math runs off CALIBRATED, not raw. Strong raw
  //    edge (model 0.93 - market 0.52 = +41%) gets bounded by
  //    the cap (calibrated 0.70 - market 0.52 = +18%).
  {
    const r = makeReport("edge math uses calibrated probability");
    const sc = buildPropDecisionScorecard(
      passingInput({
        projectedMean: 285,
        projectedStdDev: 25,
        marketLine: 248.5,
      }),
    );
    // The OVER edge should equal calibratedOver − noVigOver.
    const expectedEdge =
      sc.modelOverProbability - sc.noVigOverProbability;
    check(
      r,
      Math.abs(sc.edgeOver - expectedEdge) < 1e-9,
      `edgeOver=${sc.edgeOver}, expected ${expectedEdge}`,
    );
    // It must NOT equal raw − noVig.
    const rawEdge =
      sc.rawModelOverProbability - sc.noVigOverProbability;
    check(
      r,
      Math.abs(sc.edgeOver - rawEdge) > 0.01,
      `edge must NOT equal raw edge (${rawEdge}), got ${sc.edgeOver}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — edge math = calibrated − no-vig market");
    else console.log("[6] FAIL — edge math");
  }

  // 7. OVER + UNDER stay coherent: calibratedUnder = 1 − over.
  {
    const r = makeReport("OVER + UNDER coherence");
    const sc = buildPropDecisionScorecard(
      passingInput({
        projectedMean: 260,
        projectedStdDev: 30,
        marketLine: 248.5,
      }),
    );
    check(
      r,
      Math.abs(sc.modelOverProbability + sc.modelUnderProbability - 1) < 1e-9,
      `OVER + UNDER ≠ 1: ${sc.modelOverProbability + sc.modelUnderProbability}`,
    );
    check(
      r,
      Math.abs(
        sc.rawModelOverProbability + sc.rawModelUnderProbability - 1,
      ) < 1e-9,
      `raw OVER + raw UNDER ≠ 1: ${sc.rawModelOverProbability + sc.rawModelUnderProbability}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — OVER + UNDER coherence");
    else console.log("[7] FAIL — coherence");
  }

  // 8. Distribution-based math: same mean / σ → same raw
  //    probability (no hidden state). The raw probability still
  //    comes from normalCdf((line − mean) / σ).
  {
    const r = makeReport("distribution-based raw math is stable");
    const a = buildPropDecisionScorecard(
      passingInput({ projectedMean: 260, projectedStdDev: 25 }),
    );
    const b = buildPropDecisionScorecard(
      passingInput({ projectedMean: 260, projectedStdDev: 25 }),
    );
    check(
      r,
      a.rawModelOverProbability === b.rawModelOverProbability,
      `raw probability not deterministic: ${a.rawModelOverProbability} vs ${b.rawModelOverProbability}`,
    );
    // Quick math check: μ=260, line=248.5, σ=25 → z=(248.5-260)/25 = -0.46
    // normalCdf(-0.46) ≈ 0.3228, so rawUnder ≈ 0.32, rawOver ≈ 0.68.
    check(
      r,
      a.rawModelOverProbability > 0.65 && a.rawModelOverProbability < 0.72,
      `rawModelOverProbability=${a.rawModelOverProbability}, expected ~0.68`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — distribution-based raw is deterministic");
    else console.log("[8] FAIL — raw determinism");
  }

  // 9. The calibrated probability is BETWEEN the raw and the
  //    market when both lie inside the [0.3, 0.7] band — pure
  //    blend behaviour, no clamping.
  {
    const r = makeReport("calibrated between raw and market when un-clamped");
    const sc = buildPropDecisionScorecard(
      passingInput({
        projectedMean: 256,
        projectedStdDev: 30,
        marketLine: 248.5,
      }),
    );
    // raw ≈ 0.60, market ≈ 0.52 → calibrated 0.6*0.60 + 0.4*0.52 = 0.568
    const minVal = Math.min(
      sc.rawModelOverProbability,
      sc.noVigOverProbability,
    );
    const maxVal = Math.max(
      sc.rawModelOverProbability,
      sc.noVigOverProbability,
    );
    check(
      r,
      sc.modelOverProbability >= minVal - 1e-9 &&
        sc.modelOverProbability <= maxVal + 1e-9,
      `calibrated ${sc.modelOverProbability} not between raw ${sc.rawModelOverProbability} and market ${sc.noVigOverProbability}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — calibrated lies between raw and market");
    else console.log("[9] FAIL — blend behaviour");
  }

  // 10. No banned hooks anywhere in the touched files.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/lib/model/model-scorecard.ts",
      "src/lib/backtest/v2-pipeline-adapter.ts",
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
    if (r.reasons.length === 0) console.log("[10] PASS — no banned hooks");
    else console.log("[10] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 10 scorecard-probability-calibration assertions passed.");
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
