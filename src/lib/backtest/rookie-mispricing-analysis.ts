/**
 * Rookie mispricing by timing — diagnostic only.
 *
 * Tests whether sportsbooks misprice rookies differently across
 * the season by bucketing rookie plays into EARLY (W1-3) and
 * MID (W4-8) windows, splitting by recommended side (OVER /
 * UNDER), and comparing against a baseline of "all candidates
 * with edge ≥ 4%".
 *
 * Rookie definition (set at the scorecard layer):
 *   isRookie = sortedHistory.length > 0 AND every history row
 *              is from the current season.
 * This is conservative — a W1 rookie with no prior weeks does
 * not trigger the flag (their history is empty and we can't
 * distinguish them from a missing-name-mismatch case). For
 * W2+ rookies the flag is reliable.
 *
 * Draft capital is NOT ingested in nflverse data. The spec
 * asked for a "high draft capital" proxy when draft data is
 * unavailable: we use `isHighUsageRookie` — true when the
 * rookie's average recent snap share ≥ 0.6 — as the closest
 * approximation. Buckets that depend on draft capital are
 * therefore labelled as a proxy in the formatted output so the
 * operator knows what they're reading.
 *
 * Filter on every bucket: edge ≥ 4%.
 *
 * Test groups (8 total — 4 early + 4 mid):
 *   1. High-usage rookies — UNDERS — EARLY (W1-3)
 *   2. High-usage rookies — OVERS  — EARLY (W1-3)
 *   3. All rookies        — UNDERS — EARLY (W1-3)
 *   4. All rookies        — OVERS  — EARLY (W1-3)
 *   5. High-usage rookies — UNDERS — MID   (W4-8)
 *   6. High-usage rookies — OVERS  — MID   (W4-8)
 *   7. All rookies        — UNDERS — MID   (W4-8)
 *   8. All rookies        — OVERS  — MID   (W4-8)
 *
 * Pure function — no IO, no API, no DB.
 */

import type { EdgeSliceCandidate } from "./edge-slice-diagnostic";

export const ROOKIE_EDGE_FLOOR = 0.04;
export const HIGH_USAGE_SNAP_SHARE_FLOOR = 0.6;
export const EARLY_SEASON_WEEKS: ReadonlyArray<number> = [1, 2, 3];
export const MID_SEASON_WEEKS: ReadonlyArray<number> = [4, 5, 6, 7, 8];

export interface RookieBucketMetrics {
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
  actualHitRatePct: number;
  calibrationErrorPp: number;
}

export interface RookieMispricingReport {
  diagnosticOnly: true;
  generatedAt: string;
  candidatesTotal: number;
  /** Count of candidates the audit identified as rookies (any
   *  timing, both sides). Useful for "is the sample big enough"
   *  judgements. */
  rookieCandidatesTotal: number;
  /** Count of candidates classified as high-usage rookies. */
  highUsageRookiesTotal: number;
  /** True when the draft-capital proxy was used (i.e. always,
   *  since draft data isn't in nflverse ingestion). */
  draftCapitalProxyApplied: boolean;
  /** Pool baseline — every candidate with edge ≥ 4%. */
  control: RookieBucketMetrics;
  /** The 8 rookie buckets (4 early + 4 mid). Mid buckets will
   *  show plays=0 until later weeks land. */
  buckets: RookieBucketMetrics[];
  /** Plain-English answers to the spec's four questions. */
  answers: {
    /** roi > 0 on the "All rookies UNDERS EARLY" bucket. */
    rookieUndersEarlyProfitable: "yes" | "no" | "insufficient-data";
    /** roi < 0 on "All rookies OVERS EARLY" bucket. */
    rookieOversEarlyUnprofitable: "yes" | "no" | "insufficient-data";
    /** "Does draft capital matter?" Compares high-usage vs all
     *  rookies on the EARLY UNDERS bucket. `unknown` when the
     *  draft proxy was used and the high-usage sample is empty
     *  or too small (< 5 plays). */
    draftCapitalMatters: "yes" | "no" | "unknown";
    /** Whether any rookie bucket beats the pool control on
     *  ROI by more than 1pp. */
    timingMispricingEvidence: "yes" | "no" | "insufficient-data";
    /** Verdict — `null` when no rookie subset showed an edge. */
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
): RookieBucketMetrics {
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

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function formatBucket(m: RookieBucketMetrics): string {
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
  lines.push(
    `Calibration Error:${m.calibrationErrorPp >= 0 ? " +" : " "}${m.calibrationErrorPp.toFixed(1)}pp`,
  );
  return lines.join("\n");
}

function compactRow(m: RookieBucketMetrics): string {
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
 * Build the rookie mispricing report. Pure — every metric is
 * derived from the in-memory candidate pool. No IO.
 */
export function buildRookieMispricingReport(args: {
  candidates: ReadonlyArray<EdgeSliceCandidate>;
}): RookieMispricingReport {
  const edge4 = args.candidates.filter((c) => c.edge >= ROOKIE_EDGE_FLOOR);
  const rookies = edge4.filter((c) => c.isRookie === true);
  const highUsageRookies = edge4.filter(
    (c) => c.isHighUsageRookie === true,
  );

  const isEarly = (c: EdgeSliceCandidate) =>
    EARLY_SEASON_WEEKS.includes(c.week);
  const isMid = (c: EdgeSliceCandidate) =>
    MID_SEASON_WEEKS.includes(c.week);
  const isUnder = (c: EdgeSliceCandidate) =>
    c.recommendedSide === "UNDER";
  const isOver = (c: EdgeSliceCandidate) =>
    c.recommendedSide === "OVER";

  const control = metric(
    "Control: all candidates · edge ≥ 4%",
    "Every candidate with edge ≥ 4% (the spec's baseline).",
    "edge ≥ 4%",
    edge4,
  );

  const buckets: RookieBucketMetrics[] = [
    metric(
      "1. High-usage rookies · UNDERS · EARLY (W1-3)",
      "Rookies with avg snap share ≥ 0.6 (high-draft proxy) on UNDER bets, W1-3.",
      `isHighUsageRookie AND recommendedSide=UNDER AND week ∈ {1,2,3} AND edge ≥ ${ROOKIE_EDGE_FLOOR}`,
      highUsageRookies.filter((c) => isEarly(c) && isUnder(c)),
    ),
    metric(
      "2. High-usage rookies · OVERS · EARLY (W1-3)",
      "Rookies with avg snap share ≥ 0.6 (high-draft proxy) on OVER bets, W1-3.",
      `isHighUsageRookie AND recommendedSide=OVER AND week ∈ {1,2,3} AND edge ≥ ${ROOKIE_EDGE_FLOOR}`,
      highUsageRookies.filter((c) => isEarly(c) && isOver(c)),
    ),
    metric(
      "3. All rookies · UNDERS · EARLY (W1-3)",
      "Every rookie (any usage level) on UNDER bets, W1-3.",
      `isRookie AND recommendedSide=UNDER AND week ∈ {1,2,3} AND edge ≥ ${ROOKIE_EDGE_FLOOR}`,
      rookies.filter((c) => isEarly(c) && isUnder(c)),
    ),
    metric(
      "4. All rookies · OVERS · EARLY (W1-3)",
      "Every rookie (any usage level) on OVER bets, W1-3.",
      `isRookie AND recommendedSide=OVER AND week ∈ {1,2,3} AND edge ≥ ${ROOKIE_EDGE_FLOOR}`,
      rookies.filter((c) => isEarly(c) && isOver(c)),
    ),
    metric(
      "5. High-usage rookies · UNDERS · MID (W4-8)",
      "High-usage rookies on UNDER bets, W4-8.",
      `isHighUsageRookie AND recommendedSide=UNDER AND week ∈ {4..8} AND edge ≥ ${ROOKIE_EDGE_FLOOR}`,
      highUsageRookies.filter((c) => isMid(c) && isUnder(c)),
    ),
    metric(
      "6. High-usage rookies · OVERS · MID (W4-8)",
      "High-usage rookies on OVER bets, W4-8.",
      `isHighUsageRookie AND recommendedSide=OVER AND week ∈ {4..8} AND edge ≥ ${ROOKIE_EDGE_FLOOR}`,
      highUsageRookies.filter((c) => isMid(c) && isOver(c)),
    ),
    metric(
      "7. All rookies · UNDERS · MID (W4-8)",
      "Every rookie on UNDER bets, W4-8.",
      `isRookie AND recommendedSide=UNDER AND week ∈ {4..8} AND edge ≥ ${ROOKIE_EDGE_FLOOR}`,
      rookies.filter((c) => isMid(c) && isUnder(c)),
    ),
    metric(
      "8. All rookies · OVERS · MID (W4-8)",
      "Every rookie on OVER bets, W4-8.",
      `isRookie AND recommendedSide=OVER AND week ∈ {4..8} AND edge ≥ ${ROOKIE_EDGE_FLOOR}`,
      rookies.filter((c) => isMid(c) && isOver(c)),
    ),
  ];

  const undersEarly = buckets[2]; // "All rookies · UNDERS · EARLY"
  const oversEarly = buckets[3]; // "All rookies · OVERS · EARLY"
  const highUsageUndersEarly = buckets[0];

  const rookieUndersEarlyProfitable: RookieMispricingReport["answers"]["rookieUndersEarlyProfitable"] =
    undersEarly.plays < 3
      ? "insufficient-data"
      : undersEarly.roiPct > 0
        ? "yes"
        : "no";
  const rookieOversEarlyUnprofitable: RookieMispricingReport["answers"]["rookieOversEarlyUnprofitable"] =
    oversEarly.plays < 3
      ? "insufficient-data"
      : oversEarly.roiPct < 0
        ? "yes"
        : "no";

  // Draft capital test: compare high-usage UNDERS vs all rookies
  // UNDERS in the early window. "Matters" when the high-usage
  // ROI exceeds the all-rookies ROI by ≥ 5pp (and we have at
  // least 5 plays in each bucket).
  let draftCapitalMatters: RookieMispricingReport["answers"]["draftCapitalMatters"] =
    "unknown";
  if (highUsageUndersEarly.plays >= 5 && undersEarly.plays >= 5) {
    draftCapitalMatters =
      Math.abs(highUsageUndersEarly.roiPct - undersEarly.roiPct) >= 5
        ? "yes"
        : "no";
  }

  // Timing-mispricing test: any rookie bucket whose ROI is more
  // than 1pp above the pool control.
  const anyTimingEdge = buckets.some(
    (b) => b.plays >= 5 && b.roiPct > control.roiPct + 1,
  );
  const anyPopulated = buckets.some((b) => b.plays > 0);
  const timingMispricingEvidence: RookieMispricingReport["answers"]["timingMispricingEvidence"] =
    !anyPopulated
      ? "insufficient-data"
      : anyTimingEdge
        ? "yes"
        : "no";

  const controlAbsCalErr = Math.abs(control.calibrationErrorPp);
  const promotionRanked = buckets
    .filter(
      (b) =>
        b.plays >= 5 &&
        b.roiPct > 0 &&
        b.hitRatePct > 55 &&
        Math.abs(b.calibrationErrorPp) < controlAbsCalErr,
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
  lines.push("=== ROOKIE MISPRICING ANALYSIS ===");
  lines.push(
    `Pool: ${args.candidates.length} candidates · ${edge4.length} clear edge ≥ ${ROOKIE_EDGE_FLOOR * 100}% · ` +
      `${rookies.length} rookies · ${highUsageRookies.length} high-usage rookies.`,
  );
  lines.push(
    `NOTE: Draft capital not in nflverse ingestion — "high draft" buckets use ` +
      `the snap-share ≥ ${HIGH_USAGE_SNAP_SHARE_FLOOR} proxy. W1 rookies with no prior weeks ` +
      `cannot trigger isRookie under the conservative definition (avoids ` +
      `missing-history false positives).`,
  );
  lines.push("");
  lines.push(formatBucket(control));
  lines.push("");
  for (const b of buckets) {
    lines.push(formatBucket(b));
    lines.push("");
  }
  lines.push("=== Compact summary (sorted best→worst by ROI) ===");
  lines.push(
    pad("Bucket", 50) +
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
  const sorted = [control, ...buckets].sort(
    (a, b) => b.roiPct - a.roiPct,
  );
  for (const b of sorted) lines.push(compactRow(b));
  lines.push("");
  lines.push("=== ROOKIE MISPRICING — QUESTIONS ===");
  lines.push(
    `1. Are rookie UNDERS profitable early season? ${rookieUndersEarlyProfitable.toUpperCase()}`,
  );
  lines.push(
    `2. Are rookie OVERS unprofitable early season?  ${rookieOversEarlyUnprofitable.toUpperCase()}`,
  );
  lines.push(
    `3. Does draft capital matter?                   ${draftCapitalMatters.toUpperCase()}`,
  );
  lines.push(
    `4. Evidence of timing-based mispricing?         ${timingMispricingEvidence.toUpperCase()}`,
  );
  if (promotionCandidate) {
    lines.push(
      `5. Worth promoting to production filtering?     YES → ${promotionCandidate.name} (${promotionCandidate.reason})`,
    );
  } else {
    lines.push(
      "5. Worth promoting to production filtering?     NO. No measurable rookie mispricing edge in early season",
    );
  }
  lines.push(
    "\n--- DIAGNOSTIC ONLY · No threshold or model logic changed · Read-only ---",
  );

  return {
    diagnosticOnly: true,
    generatedAt: new Date().toISOString(),
    candidatesTotal: args.candidates.length,
    rookieCandidatesTotal: rookies.length,
    highUsageRookiesTotal: highUsageRookies.length,
    draftCapitalProxyApplied: true,
    control,
    buckets,
    answers: {
      rookieUndersEarlyProfitable,
      rookieOversEarlyUnprofitable,
      draftCapitalMatters,
      timingMispricingEvidence,
      promotionCandidate,
    },
    formatted: lines.join("\n"),
  };
}
