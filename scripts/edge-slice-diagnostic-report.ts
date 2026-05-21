/**
 * Edge-quality diagnostic slice report — CLI wrapper.
 *
 * Reads the stored + graded backtest rows for the requested
 * weeks from Postgres (file fallback for the local sandbox)
 * and prints the report produced by
 * `buildEdgeSliceReport({ snapshots, weeksRequested })`.
 *
 * Same logic as the admin `edge-slice-diagnostic` action;
 * both call into `src/lib/backtest/edge-slice-diagnostic.ts`.
 *
 * Pure read-only. No paid API calls. No re-grading.
 *
 * Usage:
 *   npx tsx scripts/edge-slice-diagnostic-report.ts
 *   npx tsx scripts/edge-slice-diagnostic-report.ts --weeks 1,2,3
 */

import { buildEdgeSliceReport } from "../src/lib/backtest/edge-slice-diagnostic";
import { loadAllStoredMonitorSnapshots } from "../src/lib/backtest/week-1-monitor-summary";

interface CliArgs {
  season: number;
  weeks: number[];
}

function parseArgs(argv: string[]): CliArgs {
  let season = 2025;
  let weeks = [1, 2];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--season" && argv[i + 1]) {
      season = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--weeks" && argv[i + 1]) {
      weeks = argv[i + 1]
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      i += 1;
    }
  }
  return { season, weeks };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log("Edge-quality diagnostic slice report");
  console.log("=====================================");
  const snapshots = await loadAllStoredMonitorSnapshots({
    season: args.season,
    weeks: args.weeks,
  });
  if (snapshots.length === 0) {
    console.log(
      `\nNo stored snapshots found for season ${args.season} weeks ${args.weeks.join(", ")}.`,
    );
    console.log(
      "Locally: no DB configured and no per-week file mirrors present.",
    );
    console.log(
      "On Railway: run /admin/ingestion → Grade Stored Backtest for the target week first.",
    );
    return;
  }
  const report = buildEdgeSliceReport({
    snapshots,
    weeksRequested: args.weeks,
  });
  console.log("");
  console.log(report.formatted);
}

void main();
