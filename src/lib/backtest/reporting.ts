/**
 * Backtest reporting — writes the summary + per-bet results to disk.
 *
 * Pure file IO; no API calls.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  BacktestGradedResult,
  BacktestSummary,
} from "./types";

export function writeSummaryJson(filePath: string, summary: BacktestSummary): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(summary, null, 2));
}

export function writeResultsJson(
  filePath: string,
  results: BacktestGradedResult[],
): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));
}

const RESULTS_CSV_COLUMNS = [
  "propMarketId",
  "playerName",
  "teamAbbr",
  "opponentAbbr",
  "propType",
  "season",
  "week",
  "marketLine",
  "recommendation",
  "qualified",
  "bet",
  "edgeAtRecommendation",
  "actualStat",
  "outcome",
  "profitLossUnits",
  "primaryDisqualifier",
];

export function writeResultsCsv(
  filePath: string,
  results: BacktestGradedResult[],
): void {
  ensureDir(path.dirname(filePath));
  const lines = [RESULTS_CSV_COLUMNS.join(",")];
  for (const r of results) {
    const c = r.candidate;
    const row = {
      propMarketId: c.propMarketId,
      playerName: c.playerName,
      teamAbbr: c.teamAbbr,
      opponentAbbr: c.opponentAbbr,
      propType: c.propType,
      season: c.season,
      week: c.week,
      marketLine: c.marketLine,
      recommendation: r.recommendation,
      qualified: r.qualified,
      bet: r.bet,
      edgeAtRecommendation: r.edgeAtRecommendation.toFixed(4),
      actualStat: r.actualStat ?? "",
      outcome: r.outcome,
      profitLossUnits: r.profitLossUnits.toFixed(4),
      primaryDisqualifier: r.primaryDisqualifier ?? "",
    };
    lines.push(
      RESULTS_CSV_COLUMNS.map((c2) => csvEscape((row as Record<string, unknown>)[c2])).join(","),
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
