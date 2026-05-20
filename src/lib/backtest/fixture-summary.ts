/**
 * Server-side helper to surface the latest fixture backtest summary on
 * the /backtest page. Reads `data/backtests/2025/backtest-summary.fixture.json`
 * if present; returns undefined otherwise.
 *
 * Never calls any external service. Pure file IO.
 */

import fs from "node:fs";
import path from "node:path";
import type { BacktestSummary } from "./types";

const FIXTURE_SUMMARY_PATH = path.join(
  process.cwd(),
  "data",
  "backtests",
  "2025",
  "backtest-summary.fixture.json",
);

export function loadFixtureBacktestSummary(): BacktestSummary | undefined {
  if (!fs.existsSync(FIXTURE_SUMMARY_PATH)) return undefined;
  try {
    const raw = fs.readFileSync(FIXTURE_SUMMARY_PATH, "utf8");
    return JSON.parse(raw) as BacktestSummary;
  } catch {
    return undefined;
  }
}
