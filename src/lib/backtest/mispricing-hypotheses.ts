/**
 * Multi-hypothesis sportsbook mispricing diagnostic.
 *
 * Tests five concrete inefficiency hypotheses against the
 * stored gate-0.40 candidate pool and compares each one to a
 * baseline of "edge ≥ 4% across all candidates". Also tests
 * four named combinations. Diagnostic only — never changes
 * production thresholds, calibration constants, or the
 * scorecard logic.
 *
 * Threshold conventions (absolute, NOT terciles — these are
 * concrete is-this-profitable tests, not relative comparisons):
 *
 *   · High roleChangeScore         ≥ 0.20  (recent usage rose
 *                                           ~20% vs prior baseline)
 *   · High usageMomentumScore      > 0      (slope is positive)
 *   · High scriptSensitivityScore  |score| ≥ 0.20
 *   · High marketResistanceScore   ≥ 0.40
 *   · Low volatility               volatilityBucket === "low"
 *                                  (i.e. volatilityScore < ~0.25)
 *
 * The five hypotheses:
 *   1. WR receptions + role-spike + positive momentum
 *   2. RB rushing attempts + role-spike + positive carry-share
 *      momentum (the existing usageMomentumScore routes to
 *      carryShare for RUSHING_ATTEMPTS)
 *   3. Low volatility UNDER bets
 *   4. QB or WR props inside a pass-heavy environment
 *      (high scriptSensitivity OR pass-heavy team signal)
 *   5. High marketResistance + positive roleChange (the
 *      "line stickiness" play — model + book disagree, book
 *      moved slowly)
 *
 * Pure function — no IO, no API, no DB. Reads the in-memory
 * candidate pool the edge-slice diagnostic already loads.
 */

import type { EdgeSliceCandidate } from "./edge-slice-diagnostic";

export const HIGH_ROLE_CHANGE_THRESHOLD = 0.2;
export const HIGH_SCRIPT_SENSITIVITY_THRESHOLD = 0.2;
export const HIGH_MARKET_RESISTANCE_THRESHOLD = 0.4;
export const BASE_EDGE_FLOOR = 0.04;
export const STRETCH_EDGE_FLOOR = 0.06;

export interface HypothesisMetrics {
  name: string;
  description: string;
  filterDescription: string;
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  avgEdgePct: number;
  avgModelProbPct: number;
  /** Same as hitRatePct — surfaced separately so the formatted
   *  output matches the spec's "Actual Hit:" row label. */
  actualHitRatePct: number;
  calibrationErrorPp: number;
}

export interface MispricingHypothesesReport {
  diagnosticOnly: true;
  generatedAt: string;
  candidatesTotal: number;
  /** "Control" baseline — every candidate with edge ≥ 4%. The
   *  spec's reference point. */
  control: HypothesisMetrics;
  /** The five hypothesis tests in canonical order. */
  hypotheses: HypothesisMetrics[];
  /** The four named combination tests in canonical order. */
  combinations: HypothesisMetrics[];
  /** Plain-English answers to the spec's five questions. */
  answers: {
    /** Hypothesis (or combination) with the highest ROI. Null
     *  when no test had any plays. */
    bestByRoi: { name: string; roiPct: number; plays: number } | null;
    /** True when at least one test produced ROI > 0. */
    anyPositiveRoi: boolean;
    /** Hypothesis that REDUCES calibration error the most vs
     *  control — `null` when no test had any plays. */
    bestCalibrationReduction:
      | { name: string; calErrPp: number; reductionPp: number }
      | null;
    /** Tests with hit rate strictly greater than 55%. */
    aboveFiftyFiveHit: string[];
    /** Whether any subset is worth promoting — requires plays ≥
     *  5, ROI > 0, hit > 55%, and calibration error magnitude
     *  smaller than the control's. */
    promotionCandidate:
      | { name: string; reason: string }
      | null;
  };
  formatted: string;
}

function aggregate(
  candidates: ReadonlyArray<EdgeSliceCandidate>,
): {
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  noResult: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  avgEdgePct: number;
  avgModelProbPct: number;
  calibrationErrorPp: number;
} {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let noResult = 0;
  let units = 0;
  let sumEdge = 0;
  let sumModelProb = 0;
  for (const c of candidates) {
    if (c.outcome === "WIN") wins += 1;
    else if (c.outcome === "LOSS") losses += 1;
    else if (c.outcome === "PUSH") pushes += 1;
    else noResult += 1;
    units += c.profitPerUnit;
    sumEdge += c.edge;
    sumModelProb += c.modelProbability;
  }
  const decisive = wins + losses;
  const graded = wins + losses + pushes;
  const n = candidates.length;
  const hit = decisive > 0 ? (wins / decisive) * 100 : 0;
  const modelPct = n > 0 ? (sumModelProb / n) * 100 : 0;
  return {
    plays: n,
    wins,
    losses,
    pushes,
    noResult,
    hitRatePct: hit,
    roiPct: graded > 0 ? (units / graded) * 100 : 0,
    unitsProfit: units,
    avgEdgePct: n > 0 ? (sumEdge / n) * 100 : 0,
    avgModelProbPct: modelPct,
    calibrationErrorPp: modelPct - hit,
  };
}

function metric(
  name: string,
  description: string,
  filterDescription: string,
  candidates: EdgeSliceCandidate[],
): HypothesisMetrics {
  const agg = aggregate(candidates);
  return {
    name,
    description,
    filterDescription,
    plays: agg.plays,
    wins: agg.wins,
    losses: agg.losses,
    pushes: agg.pushes,
    noResult: agg.noResult,
    hitRatePct: agg.hitRatePct,
    roiPct: agg.roiPct,
    unitsProfit: agg.unitsProfit,
    avgEdgePct: agg.avgEdgePct,
    avgModelProbPct: agg.avgModelProbPct,
    actualHitRatePct: agg.hitRatePct,
    calibrationErrorPp: agg.calibrationErrorPp,
  };
}

function highRoleChange(c: EdgeSliceCandidate): boolean {
  return (
    typeof c.signalFeatures?.roleChangeScore === "number" &&
    c.signalFeatures.roleChangeScore >= HIGH_ROLE_CHANGE_THRESHOLD
  );
}

function positiveUsageMomentum(c: EdgeSliceCandidate): boolean {
  return (
    typeof c.signalFeatures?.usageMomentumScore === "number" &&
    c.signalFeatures.usageMomentumScore > 0
  );
}

function lowVolatility(c: EdgeSliceCandidate): boolean {
  return c.signalFeatures?.volatilityBucket === "low";
}

function highScriptSensitivity(c: EdgeSliceCandidate): boolean {
  return (
    typeof c.signalFeatures?.scriptSensitivityScore === "number" &&
    Math.abs(c.signalFeatures.scriptSensitivityScore) >=
      HIGH_SCRIPT_SENSITIVITY_THRESHOLD
  );
}

function highMarketResistance(c: EdgeSliceCandidate): boolean {
  return (
    typeof c.signalFeatures?.marketResistanceScore === "number" &&
    c.signalFeatures.marketResistanceScore >=
      HIGH_MARKET_RESISTANCE_THRESHOLD
  );
}

function positiveRoleChange(c: EdgeSliceCandidate): boolean {
  return (
    typeof c.signalFeatures?.roleChangeScore === "number" &&
    c.signalFeatures.roleChangeScore > 0
  );
}

function isWideReceiver(c: EdgeSliceCandidate): boolean {
  return c.playerPosition === "WR";
}

function isRunningBack(c: EdgeSliceCandidate): boolean {
  return c.playerPosition === "RB";
}

function isQuarterback(c: EdgeSliceCandidate): boolean {
  return c.playerPosition === "QB";
}

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function formatRow(m: HypothesisMetrics): string {
  const lines: string[] = [];
  lines.push(`=== ${m.name} ===`);
  lines.push(`Filter:           ${m.filterDescription}`);
  lines.push(`Plays:            ${m.plays}`);
  const tail =
    (m.pushes > 0 ? ` (${m.pushes}P)` : "") +
    (m.noResult > 0 ? ` (${m.noResult} NO_DATA)` : "");
  lines.push(`W-L:              ${m.wins}-${m.losses}${tail}`);
  lines.push(`Hit Rate:         ${m.hitRatePct.toFixed(1)}%`);
  lines.push(
    `ROI:              ${m.roiPct >= 0 ? "+" : ""}${m.roiPct.toFixed(1)}%`,
  );
  lines.push(
    `Units:            ${m.unitsProfit >= 0 ? "+" : ""}${m.unitsProfit.toFixed(2)}`,
  );
  lines.push(`Avg Edge:         ${m.avgEdgePct.toFixed(2)}%`);
  lines.push(`Avg Model Prob:   ${m.avgModelProbPct.toFixed(1)}%`);
  lines.push(`Actual Hit:       ${m.actualHitRatePct.toFixed(1)}%`);
  const calLabel =
    m.calibrationErrorPp > 0
      ? "(model OVERestimates)"
      : m.calibrationErrorPp < 0
        ? "(model UNDERestimates)"
        : "(calibrated)";
  lines.push(
    `Calibration Error:${m.calibrationErrorPp >= 0 ? " +" : " "}${m.calibrationErrorPp.toFixed(1)}pp ${calLabel}`,
  );
  return lines.join("\n");
}

function compactRow(m: HypothesisMetrics): string {
  return (
    pad(m.name, 50) +
    pad(m.plays, 7, "R") +
    pad(`${m.wins}-${m.losses}`, 10, "R") +
    pad(`${m.hitRatePct.toFixed(1)}%`, 8, "R") +
    pad(`${m.roiPct >= 0 ? "+" : ""}${m.roiPct.toFixed(1)}%`, 9, "R") +
    pad(
      `${m.unitsProfit >= 0 ? "+" : ""}${m.unitsProfit.toFixed(2)}`,
      9,
      "R",
    ) +
    pad(`${m.avgEdgePct.toFixed(1)}%`, 8, "R") +
    pad(`${m.avgModelProbPct.toFixed(1)}%`, 9, "R") +
    pad(
      `${m.calibrationErrorPp >= 0 ? "+" : ""}${m.calibrationErrorPp.toFixed(1)}pp`,
      9,
      "R",
    )
  );
}

/**
 * Build the multi-hypothesis report. Pure — every metric is
 * derived from the in-memory candidate pool. No IO.
 */
export function buildMispricingHypothesesReport(args: {
  candidates: ReadonlyArray<EdgeSliceCandidate>;
}): MispricingHypothesesReport {
  const edge4 = args.candidates.filter((c) => c.edge >= BASE_EDGE_FLOOR);
  const edge6 = args.candidates.filter((c) => c.edge >= STRETCH_EDGE_FLOOR);

  const control = metric(
    "Control: edge ≥ 4%",
    "Every candidate with edge ≥ 4% (the spec's reference baseline).",
    "edge ≥ 4%",
    edge4,
  );

  // === Hypothesis 1: WR ROLE SPIKE (receptions) ===
  const h1 = metric(
    "1. WR ROLE SPIKE (Receptions)",
    "WR receptions with rising recent role and positive usage momentum.",
    `propType=RECEPTIONS AND position=WR AND roleChangeScore ≥ ${HIGH_ROLE_CHANGE_THRESHOLD} AND usageMomentumScore > 0 AND edge ≥ ${BASE_EDGE_FLOOR}`,
    edge4.filter(
      (c) =>
        c.propType === "RECEPTIONS" &&
        isWideReceiver(c) &&
        highRoleChange(c) &&
        positiveUsageMomentum(c),
    ),
  );

  // === Hypothesis 2: RB WORKLOAD SHIFT (rushing attempts) ===
  // usageMomentumScore for RUSHING_ATTEMPTS routes to carryShare,
  // so positiveUsageMomentum here = increasing carry share.
  const h2 = metric(
    "2. RB WORKLOAD SHIFT (Rushing Attempts)",
    "RB rushing attempts with rising recent role and increasing carry share.",
    `propType=RUSHING_ATTEMPTS AND position=RB AND roleChangeScore ≥ ${HIGH_ROLE_CHANGE_THRESHOLD} AND usageMomentumScore > 0 AND edge ≥ ${BASE_EDGE_FLOOR}`,
    edge4.filter(
      (c) =>
        c.propType === "RUSHING_ATTEMPTS" &&
        isRunningBack(c) &&
        highRoleChange(c) &&
        positiveUsageMomentum(c),
    ),
  );

  // === Hypothesis 3: LOW VOLATILITY UNDERS ===
  const h3 = metric(
    "3. LOW VOLATILITY UNDERS",
    "Low-volatility candidates where the model recommends UNDER.",
    `volatilityBucket=low AND recommendedSide=UNDER AND edge ≥ ${BASE_EDGE_FLOOR}`,
    edge4.filter((c) => lowVolatility(c) && c.recommendedSide === "UNDER"),
  );

  // === Hypothesis 4: HIGH PASS-RATE ENVIRONMENT (QB or WR props) ===
  const h4 = metric(
    "4. HIGH PASS-RATE ENVIRONMENT",
    "QB or WR props in a pass-heavy environment (high scriptSensitivity).",
    `(position=QB OR position=WR) AND |scriptSensitivityScore| ≥ ${HIGH_SCRIPT_SENSITIVITY_THRESHOLD} AND edge ≥ ${BASE_EDGE_FLOOR}`,
    edge4.filter(
      (c) =>
        (isQuarterback(c) || isWideReceiver(c)) && highScriptSensitivity(c),
    ),
  );

  // === Hypothesis 5: MARKET LAG / LINE STICKINESS ===
  const h5 = metric(
    "5. MARKET LAG / LINE STICKINESS",
    "High marketResistance + positive roleChange — book hadn't moved on emerging usage.",
    `marketResistanceScore ≥ ${HIGH_MARKET_RESISTANCE_THRESHOLD} AND roleChangeScore > 0 AND edge ≥ ${BASE_EDGE_FLOOR}`,
    edge4.filter((c) => highMarketResistance(c) && positiveRoleChange(c)),
  );

  const hypotheses = [h1, h2, h3, h4, h5];

  // === Combinations ===
  const c1 = metric(
    "C1. WR role spike + market lag",
    "Hypothesis 1 candidates that ALSO clear the marketResistance bar.",
    `H1 filter AND marketResistanceScore ≥ ${HIGH_MARKET_RESISTANCE_THRESHOLD}`,
    edge4.filter(
      (c) =>
        c.propType === "RECEPTIONS" &&
        isWideReceiver(c) &&
        highRoleChange(c) &&
        positiveUsageMomentum(c) &&
        highMarketResistance(c),
    ),
  );
  const c2 = metric(
    "C2. RB workload shift + low volatility",
    "Hypothesis 2 candidates that ALSO sit in the low-volatility bucket.",
    `H2 filter AND volatilityBucket=low`,
    edge4.filter(
      (c) =>
        c.propType === "RUSHING_ATTEMPTS" &&
        isRunningBack(c) &&
        highRoleChange(c) &&
        positiveUsageMomentum(c) &&
        lowVolatility(c),
    ),
  );
  const c3 = metric(
    "C3. Low volatility + edge ≥ 6%",
    "Low-volatility candidates with a stretch-edge floor of 6%.",
    `volatilityBucket=low AND edge ≥ ${STRETCH_EDGE_FLOOR}`,
    edge6.filter((c) => lowVolatility(c)),
  );
  const c4 = metric(
    "C4. High role change + edge ≥ 6%",
    "High roleChange candidates with stretch-edge floor of 6%.",
    `roleChangeScore ≥ ${HIGH_ROLE_CHANGE_THRESHOLD} AND edge ≥ ${STRETCH_EDGE_FLOOR}`,
    edge6.filter((c) => highRoleChange(c)),
  );
  const combinations = [c1, c2, c3, c4];

  // === Answers ===
  const allTests = [...hypotheses, ...combinations];
  const populated = allTests.filter((t) => t.plays > 0);
  const bestByRoi =
    populated.length === 0
      ? null
      : populated.reduce((acc, t) =>
          t.roiPct > acc.roiPct ? t : acc,
        );
  const bestRoiAnswer = bestByRoi
    ? { name: bestByRoi.name, roiPct: bestByRoi.roiPct, plays: bestByRoi.plays }
    : null;
  const anyPositiveRoi = populated.some((t) => t.roiPct > 0);
  const controlAbsCalErr = Math.abs(control.calibrationErrorPp);
  const calibrationReductionCandidates = populated
    .map((t) => ({
      name: t.name,
      calErrPp: t.calibrationErrorPp,
      reductionPp: controlAbsCalErr - Math.abs(t.calibrationErrorPp),
    }))
    .filter((x) => x.reductionPp > 0);
  calibrationReductionCandidates.sort(
    (a, b) => b.reductionPp - a.reductionPp,
  );
  const bestCalibrationReduction =
    calibrationReductionCandidates[0] ?? null;
  const aboveFiftyFiveHit = populated
    .filter((t) => t.hitRatePct > 55)
    .map((t) => t.name);
  const promotionRanked = populated
    .filter(
      (t) =>
        t.plays >= 5 &&
        t.roiPct > 0 &&
        t.hitRatePct > 55 &&
        Math.abs(t.calibrationErrorPp) < controlAbsCalErr,
    )
    .sort((a, b) => b.roiPct - a.roiPct);
  const promotionCandidate = promotionRanked[0]
    ? {
        name: promotionRanked[0].name,
        reason:
          `plays=${promotionRanked[0].plays}, ROI=${promotionRanked[0].roiPct >= 0 ? "+" : ""}${promotionRanked[0].roiPct.toFixed(1)}%, ` +
          `hit=${promotionRanked[0].hitRatePct.toFixed(1)}%, |cal|=${Math.abs(promotionRanked[0].calibrationErrorPp).toFixed(1)}pp ` +
          `(beats control |cal|=${controlAbsCalErr.toFixed(1)}pp)`,
      }
    : null;

  const lines: string[] = [];
  lines.push("=== MULTI-HYPOTHESIS MISPRICING DIAGNOSTIC ===");
  lines.push(
    `Pool: ${args.candidates.length} candidates · ${edge4.length} clear edge ≥ ${BASE_EDGE_FLOOR * 100}% · ${edge6.length} clear edge ≥ ${STRETCH_EDGE_FLOOR * 100}%`,
  );
  lines.push("");
  lines.push(formatRow(control));
  lines.push("");
  for (const h of hypotheses) {
    lines.push(formatRow(h));
    lines.push("");
  }
  lines.push("=== COMBINATION TESTS ===");
  for (const c of combinations) {
    lines.push(formatRow(c));
    lines.push("");
  }
  lines.push("=== Compact summary (sorted best→worst by ROI) ===");
  lines.push(
    pad("Test", 50) +
      pad("Plays", 7, "R") +
      pad("W-L", 10, "R") +
      pad("Hit", 8, "R") +
      pad("ROI", 9, "R") +
      pad("Units", 9, "R") +
      pad("Edge", 8, "R") +
      pad("ModelP", 9, "R") +
      pad("CalErr", 9, "R"),
  );
  lines.push("-".repeat(118));
  const sorted = [control, ...allTests].sort(
    (a, b) => b.roiPct - a.roiPct,
  );
  for (const t of sorted) lines.push(compactRow(t));
  lines.push("");
  lines.push("=== FINAL SUMMARY ===");
  lines.push(
    `1. Best by ROI:          ${
      bestRoiAnswer
        ? `${bestRoiAnswer.name} → ${bestRoiAnswer.roiPct >= 0 ? "+" : ""}${bestRoiAnswer.roiPct.toFixed(1)}% (${bestRoiAnswer.plays} plays)`
        : "(no test had any plays)"
    }`,
  );
  lines.push(
    `2. Any positive ROI?     ${anyPositiveRoi ? "YES" : "NO"}`,
  );
  lines.push(
    `3. Best calibration cut: ${
      bestCalibrationReduction
        ? `${bestCalibrationReduction.name} → |cal|=${Math.abs(bestCalibrationReduction.calErrPp).toFixed(1)}pp (control |cal|=${controlAbsCalErr.toFixed(1)}pp, reduction ${bestCalibrationReduction.reductionPp.toFixed(1)}pp)`
        : "(no test reduced calibration error vs control)"
    }`,
  );
  lines.push(
    `4. Hit rate > 55%:       ${aboveFiftyFiveHit.length === 0 ? "(none)" : aboveFiftyFiveHit.join("; ")}`,
  );
  if (promotionCandidate) {
    lines.push(
      `5. Worth promoting:      YES → ${promotionCandidate.name} (${promotionCandidate.reason})`,
    );
  } else {
    lines.push(
      "5. Worth promoting:      NO. No measurable edge found across tested hypotheses",
    );
  }
  lines.push(
    "\n--- DIAGNOSTIC ONLY · No threshold or model logic changed · Read-only ---",
  );

  return {
    diagnosticOnly: true,
    generatedAt: new Date().toISOString(),
    candidatesTotal: args.candidates.length,
    control,
    hypotheses,
    combinations,
    answers: {
      bestByRoi: bestRoiAnswer,
      anyPositiveRoi,
      bestCalibrationReduction,
      aboveFiftyFiveHit,
      promotionCandidate,
    },
    formatted: lines.join("\n"),
  };
}
