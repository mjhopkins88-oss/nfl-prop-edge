/**
 * Season-level aggregate report.
 *
 * Given the per-week pipeline outcomes + the stored
 * StoredWeekSnapshot rows (already loaded from Postgres / file
 * mirror), produces:
 *
 *   · the season-level recommended-plays summary
 *     (Plays / W-L / Hit / ROI / Units / avg edge / avg model
 *     prob / actual hit / calibration error)
 *   · season-level edge slices (≥4%, ≥6%, ≥8%, ≥10%)
 *   · season-level composite ranking + signal-quality audit +
 *     WR-receptions analysis + rookie mispricing analysis
 *     (all delegated to `buildEdgeSliceReport`, which already
 *     accepts a multi-week snapshot pool and merges the per-
 *     week candidates into a single pool internally)
 *   · the multi-hypothesis mispricing diagnostic (also bundled
 *     inside `buildEdgeSliceReport`)
 *   · a formatted multi-section string the admin panel renders
 *     verbatim — section headers match the spec exactly:
 *       === SEASON SUMMARY ===
 *       === EDGE SLICES (SEASON) ===
 *       === SIGNAL ANALYSIS (SEASON) ===
 *       === WR RECEPTIONS SIGNAL ANALYSIS ===
 *       === ROOKIE MISPRICING ANALYSIS ===
 *
 * Pure function — no IO, no API, no DB. Receives the per-week
 * rows + snapshots from the runner that already loaded them.
 */

import {
  buildEdgeSliceReport,
  type EdgeSliceReport,
} from "./edge-slice-diagnostic";
import type { StoredWeekSnapshot } from "./week-1-monitor-summary";
import type { SeasonBacktestPerWeekRow } from "./season-stored-backtest-runner";

export interface SeasonSummaryMetrics {
  /** Recommended-plays totals — what the model actually bet. */
  plays: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRatePct: number;
  roiPct: number;
  unitsProfit: number;
  /** Weighted (by per-week play count) averages. */
  avgEdgePct: number;
  avgModelProbPct: number;
  actualHitRatePct: number;
  calibrationErrorPp: number;
}

export interface SeasonAggregateReport {
  diagnosticOnly: true;
  generatedAt: string;
  season: number;
  weeksRequested: number[];
  weeksGraded: number[];
  weeksMissing: number[];
  seasonSummary: SeasonSummaryMetrics;
  perWeek: SeasonBacktestPerWeekRow[];
  /** Delegated edge-slice report — already includes:
   *    · edge slices (≥4%, ≥6%, ≥8%, ≥10%)
   *    · composite ranking
   *    · signal-quality audit
   *    · WR receptions analysis
   *    · multi-hypothesis mispricing diagnostic
   *    · rookie mispricing analysis
   *  All slices are computed over the merged multi-week
   *  gate-0.40 candidate pool. */
  edgeSlice: EdgeSliceReport;
  formatted: string;
}

function aggregateSeasonSummary(
  perWeek: ReadonlyArray<SeasonBacktestPerWeekRow>,
): SeasonSummaryMetrics {
  let plays = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let units = 0;
  for (const w of perWeek) {
    if (!w.ok) continue;
    plays += w.qualifiedCount ?? 0;
    wins += w.wins ?? 0;
    losses += w.losses ?? 0;
    pushes += w.pushes ?? 0;
    units += w.unitsProfit ?? 0;
  }
  const decisive = wins + losses;
  const graded = wins + losses + pushes;
  const hitRatePct = decisive > 0 ? (wins / decisive) * 100 : 0;
  const roiPct = graded > 0 ? (units / graded) * 100 : 0;
  return {
    plays,
    wins,
    losses,
    pushes,
    hitRatePct,
    roiPct,
    unitsProfit: units,
    // Edge / model prob / cal-error averages are tracked
    // per-week by recommendedPlays but the per-week row above
    // doesn't carry them — we read them from the edge-slice
    // report's slice-4% block which IS the season-merged pool.
    avgEdgePct: 0,
    avgModelProbPct: 0,
    actualHitRatePct: hitRatePct,
    calibrationErrorPp: 0,
  };
}

function compactWeekRow(w: SeasonBacktestPerWeekRow): string {
  if (!w.ok) {
    return `  W${w.week.toString().padStart(2, " ")}  ${pad("FAILED", 8)} ${w.failureReason ?? "?"}`;
  }
  const plays = w.qualifiedCount ?? 0;
  const wins = w.wins ?? 0;
  const losses = w.losses ?? 0;
  const pushes = w.pushes ?? 0;
  const hit = w.hitRatePct ?? 0;
  const roi = w.roiPct ?? 0;
  const units = w.unitsProfit ?? 0;
  return (
    `  W${w.week.toString().padStart(2, " ")}  ` +
    `plays=${pad(plays, 3, "R")}  ` +
    `${pad(`${wins}-${losses}${pushes > 0 ? `-${pushes}P` : ""}`, 9)}  ` +
    `hit=${pad(`${hit.toFixed(1)}%`, 6, "R")}  ` +
    `ROI=${pad(`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`, 7, "R")}  ` +
    `units=${pad(`${units >= 0 ? "+" : ""}${units.toFixed(2)}`, 7, "R")}`
  );
}

function pad(s: string | number, n: number, align: "L" | "R" = "L"): string {
  const str = String(s);
  if (str.length >= n) return str;
  const fill = " ".repeat(n - str.length);
  return align === "L" ? str + fill : fill + str;
}

function pickSection(
  formatted: string,
  startMarker: string,
  /** Optional end marker — when supplied the section is sliced
   *  up to (but not including) that marker. */
  endMarker?: string,
): string {
  const startIdx = formatted.indexOf(startMarker);
  if (startIdx === -1) return "";
  const rest = formatted.slice(startIdx);
  if (!endMarker) return rest;
  const endIdx = rest.indexOf(endMarker, startMarker.length);
  if (endIdx === -1) return rest;
  return rest.slice(0, endIdx).trimEnd();
}

/**
 * Build the season aggregate report. Pure — every metric is
 * derived from the per-week rows (for the headline summary)
 * and the pre-loaded snapshots (for the diagnostic merging).
 */
export function buildSeasonAggregateReport(args: {
  season: number;
  weeksRequested: number[];
  perWeek: ReadonlyArray<SeasonBacktestPerWeekRow>;
  snapshots: ReadonlyArray<StoredWeekSnapshot>;
}): SeasonAggregateReport {
  const seasonSummary = aggregateSeasonSummary(args.perWeek);
  const edgeSlice = buildEdgeSliceReport({
    snapshots: args.snapshots,
    weeksRequested: args.weeksRequested,
  });

  // Pull edge / model-prob / calibration averages from the
  // edge-slice ≥ 4% slice — it's the same gate-0.40 candidate
  // pool merged across all weeks. The per-week recommended-
  // plays aggregator above already gave us plays/W-L/units;
  // these averages just complement the summary.
  const slice4 = edgeSlice.slices.find((s) => s.edgeFloor === 0.04);
  if (slice4) {
    seasonSummary.avgEdgePct = slice4.avgEdgePct;
    seasonSummary.avgModelProbPct = slice4.avgModelProbPct;
  }

  const weeksGraded = args.perWeek.filter((w) => w.ok).map((w) => w.week);
  const weeksMissing = args.perWeek
    .filter((w) => !w.ok)
    .map((w) => w.week);

  // Section headers per the spec.
  const lines: string[] = [];
  lines.push("=== SEASON SUMMARY ===");
  lines.push(
    `Weeks: ${args.weeksRequested[0]}-${args.weeksRequested[args.weeksRequested.length - 1]} (${weeksGraded.length}/${args.weeksRequested.length} graded)`,
  );
  lines.push(`Total Plays:       ${seasonSummary.plays}`);
  const tail =
    seasonSummary.pushes > 0 ? ` (${seasonSummary.pushes}P)` : "";
  lines.push(
    `W-L:               ${seasonSummary.wins}-${seasonSummary.losses}${tail}`,
  );
  lines.push(`Hit Rate:          ${seasonSummary.hitRatePct.toFixed(1)}%`);
  lines.push(
    `ROI:               ${seasonSummary.roiPct >= 0 ? "+" : ""}${seasonSummary.roiPct.toFixed(1)}%`,
  );
  lines.push(
    `Units:             ${seasonSummary.unitsProfit >= 0 ? "+" : ""}${seasonSummary.unitsProfit.toFixed(2)}`,
  );
  lines.push(
    `Avg Edge:          ${seasonSummary.avgEdgePct.toFixed(2)}%`,
  );
  lines.push(
    `Avg Model Prob:    ${seasonSummary.avgModelProbPct.toFixed(1)}%`,
  );
  lines.push(
    `Actual Hit:        ${seasonSummary.actualHitRatePct.toFixed(1)}%`,
  );
  const calLabel =
    seasonSummary.calibrationErrorPp > 0
      ? "(model OVERestimates)"
      : seasonSummary.calibrationErrorPp < 0
        ? "(model UNDERestimates)"
        : "(no decisive plays)";
  // Recompute season calibration error using the same convention
  // the edge-slice diagnostic uses (avg model prob − actual hit).
  seasonSummary.calibrationErrorPp =
    seasonSummary.plays > 0
      ? seasonSummary.avgModelProbPct - seasonSummary.actualHitRatePct
      : 0;
  lines.push(
    `Calibration Error:${seasonSummary.calibrationErrorPp >= 0 ? " +" : " "}${seasonSummary.calibrationErrorPp.toFixed(1)}pp ${calLabel}`,
  );
  if (weeksMissing.length > 0) {
    lines.push(
      `Missing weeks:     ${weeksMissing.map((w) => `W${w}`).join(", ")} (see per-week breakdown)`,
    );
  }
  lines.push("");
  lines.push("Per-week breakdown:");
  for (const w of args.perWeek) lines.push(compactWeekRow(w));
  lines.push("");

  lines.push("=== EDGE SLICES (SEASON) ===");
  for (const s of edgeSlice.slices) {
    lines.push(
      `${pad(s.label, 36)}  plays=${pad(s.plays, 4, "R")}  ${pad(`${s.wins}-${s.losses}${s.pushes > 0 ? `-${s.pushes}P` : ""}`, 9)}  ` +
        `hit=${pad(`${s.hitRatePct.toFixed(1)}%`, 6, "R")}  ROI=${pad(`${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(1)}%`, 7, "R")}  ` +
        `units=${pad(`${s.unitsProfit >= 0 ? "+" : ""}${s.unitsProfit.toFixed(2)}`, 7, "R")}  ` +
        `edge=${pad(`${s.avgEdgePct.toFixed(1)}%`, 6, "R")}  modelP=${pad(`${s.avgModelProbPct.toFixed(1)}%`, 6, "R")}  ` +
        `cal=${pad(`${s.calibrationErrorPp >= 0 ? "+" : ""}${s.calibrationErrorPp.toFixed(1)}pp`, 7, "R")}`,
    );
  }
  lines.push("");

  // The edge-slice diagnostic's formatted output already
  // bundles signal-quality + WR-receptions + mispricing
  // hypotheses + rookie analysis. We surface its multi-section
  // string verbatim under the spec's section headers below —
  // each section is sliced out of the merged formatted string
  // so the season report has its own clearly labelled blocks.
  lines.push("=== SIGNAL ANALYSIS (SEASON) ===");
  const signalQualityBlock = pickSection(
    edgeSlice.formatted,
    "=== Signal Quality Audit",
    "=== WR RECEPTIONS SIGNAL ANALYSIS ===",
  );
  lines.push(signalQualityBlock || "(no signal-quality data available)");
  lines.push("");

  lines.push("=== WR RECEPTIONS SIGNAL ANALYSIS ===");
  // The WR receptions block already starts with its own header
  // in the edge-slice formatted output; skip the duplicate
  // header line by trimming up to the first newline.
  const wrBlock = pickSection(
    edgeSlice.formatted,
    "=== WR RECEPTIONS SIGNAL ANALYSIS ===",
    "=== MULTI-HYPOTHESIS MISPRICING DIAGNOSTIC ===",
  );
  const wrBlockBody = wrBlock
    .slice(wrBlock.indexOf("\n") + 1)
    .trimStart();
  lines.push(wrBlockBody || "(no WR receptions data available)");
  lines.push("");

  // The multi-hypothesis diagnostic gets its own header so the
  // season report keeps the same five-question framing.
  lines.push("=== MULTI-HYPOTHESIS MISPRICING DIAGNOSTIC (SEASON) ===");
  const mhBlock = pickSection(
    edgeSlice.formatted,
    "=== MULTI-HYPOTHESIS MISPRICING DIAGNOSTIC ===",
    "=== ROOKIE MISPRICING ANALYSIS ===",
  );
  const mhBlockBody = mhBlock
    .slice(mhBlock.indexOf("\n") + 1)
    .trimStart();
  lines.push(mhBlockBody || "(no hypothesis data available)");
  lines.push("");

  lines.push("=== ROOKIE MISPRICING ANALYSIS ===");
  const rookieBlock = pickSection(
    edgeSlice.formatted,
    "=== ROOKIE MISPRICING ANALYSIS ===",
    "=== Answers ===",
  );
  const rookieBlockBody = rookieBlock
    .slice(rookieBlock.indexOf("\n") + 1)
    .trimStart();
  lines.push(rookieBlockBody || "(no rookie data available)");
  lines.push("");

  lines.push(
    "--- DIAGNOSTIC ONLY · production thresholds (edge 4%, marketContext 0.45) unchanged · read-only ---",
  );

  return {
    diagnosticOnly: true,
    generatedAt: new Date().toISOString(),
    season: args.season,
    weeksRequested: [...args.weeksRequested],
    weeksGraded,
    weeksMissing,
    seasonSummary,
    perWeek: args.perWeek.slice(),
    edgeSlice,
    formatted: lines.join("\n"),
  };
}
