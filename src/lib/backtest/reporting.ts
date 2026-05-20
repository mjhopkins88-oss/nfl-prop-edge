/**
 * Backtest reporting — writes the summary + per-bet results + per-
 * bucket breakdowns to disk.
 *
 * Pure file IO; no API calls.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  BacktestEvaluatedProp,
  BacktestSummary,
} from "./types";

export function writeSummaryJson(filePath: string, summary: BacktestSummary): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
}

export function writeResultsJson(
  filePath: string,
  results: BacktestEvaluatedProp[],
): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
}

export function writeBreakdownJson<T>(filePath: string, data: T): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

const RESULTS_CSV_COLUMNS = [
  "id",
  "season",
  "week",
  "playerName",
  "team",
  "opponent",
  "propType",
  "line",
  "lineBucket",
  "selectedSide",
  "selectedOdds",
  "edge",
  "edgeBucket",
  "confidence",
  "confidenceBucket",
  "recommendation",
  "qualified",
  "primaryDisqualifier",
  "actualStat",
  "result",
  "profitLossUnits",
  "counterfactualResult",
  "counterfactualProfitLossUnits",
  "postmortemTags",
];

export function writeResultsCsv(
  filePath: string,
  results: BacktestEvaluatedProp[],
): void {
  ensureDir(path.dirname(filePath));
  const lines = [RESULTS_CSV_COLUMNS.join(",")];
  for (const r of results) {
    const row = {
      id: r.id,
      season: r.season,
      week: r.week,
      playerName: r.playerName,
      team: r.team,
      opponent: r.opponent,
      propType: r.propType,
      line: r.line,
      lineBucket: r.lineBucket,
      selectedSide: r.selectedSide,
      selectedOdds: r.selectedOdds,
      edge: r.edge.toFixed(4),
      edgeBucket: r.edgeBucket,
      confidence: r.confidence.toFixed(3),
      confidenceBucket: r.confidenceBucket,
      recommendation: r.recommendation,
      qualified: r.qualified,
      primaryDisqualifier: r.primaryDisqualifier ?? "",
      actualStat: r.actualStat ?? "",
      result: r.result,
      profitLossUnits: r.profitLossUnits.toFixed(4),
      counterfactualResult: r.counterfactualResult,
      counterfactualProfitLossUnits: r.counterfactualProfitLossUnits.toFixed(4),
      postmortemTags: r.postmortemTags.join("|"),
    };
    lines.push(
      RESULTS_CSV_COLUMNS.map((c) =>
        csvEscape((row as Record<string, unknown>)[c]),
      ).join(","),
    );
  }
  fs.writeFileSync(filePath, lines.join("\n") + "\n");
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}
