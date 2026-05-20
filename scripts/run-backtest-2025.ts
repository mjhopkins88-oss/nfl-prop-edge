/**
 * run-backtest-2025.ts
 *
 * Replay the 2025 NFL season (or a subrange) against the scorecard-
 * based model using stored / fixture data. Writes a JSON summary and
 * per-bet results to `data/backtests/2025/`.
 *
 * GUARDRAILS:
 *   - NEVER calls paid APIs. The runner reads stored data only.
 *   - Defaults to fixtures so the script works on a fresh clone.
 *   - Default prop types are the 4 V1 volume markets; yardage opts
 *     in with `--include-yardage`.
 */

import path from "node:path";
import process from "node:process";
import { loadBacktestFixtures } from "../src/lib/backtest/data-loader";
import {
  runBacktest,
  V1_STARTER_PROP_TYPES,
  V1_PROP_TYPES,
} from "../src/lib/backtest/runner";
import {
  writeResultsCsv,
  writeResultsJson,
  writeSummaryJson,
} from "../src/lib/backtest/reporting";
import type { PropType } from "../src/lib/types";

interface CliArgs {
  fixtures: boolean;
  season: number;
  startWeek: number;
  endWeek: number;
  includeYardage: boolean;
  propTypes: PropType[];
  outputJson: string;
  outputCsv: string;
}

const ALL_PROP_TYPES_SET = new Set<PropType>(V1_PROP_TYPES);

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    fixtures: true,
    season: 2025,
    startWeek: 1,
    endWeek: 18,
    includeYardage: false,
    propTypes: [...V1_STARTER_PROP_TYPES],
    outputJson: "data/backtests/2025/backtest-summary.fixture.json",
    outputCsv: "data/backtests/2025/backtest-results.fixture.csv",
  };
  let propTypesOverridden = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--fixtures":
        args.fixtures = true;
        break;
      case "--season":
        args.season = Number(eat());
        break;
      case "--start-week":
        args.startWeek = Number(eat());
        break;
      case "--end-week":
        args.endWeek = Number(eat());
        break;
      case "--include-yardage":
        args.includeYardage = true;
        break;
      case "--prop-types": {
        const parts = eat().split(",").map((s) => s.trim().toUpperCase());
        const valid: PropType[] = [];
        for (const p of parts) {
          if (ALL_PROP_TYPES_SET.has(p as PropType))
            valid.push(p as PropType);
          else throw new Error(`Unknown prop type: ${p}`);
        }
        args.propTypes = valid;
        propTypesOverridden = true;
        break;
      }
      case "--output-json":
        args.outputJson = eat();
        break;
      case "--output-csv":
        args.outputCsv = eat();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  // include-yardage extends the default prop type set unless the user
  // already specified --prop-types.
  if (args.includeYardage && !propTypesOverridden) {
    args.propTypes = [...V1_PROP_TYPES];
  }
  return args;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  npx tsx scripts/run-backtest-2025.ts [options]

Options:
  --fixtures            use the bundled fixture data (default; only mode for now)
  --season N            season year (default 2025)
  --start-week N        inclusive lower bound (default 1)
  --end-week N          inclusive upper bound (default 18)
  --include-yardage     enable PASSING_YARDS / RECEIVING_YARDS / RUSHING_YARDS
  --prop-types LIST     comma-separated PropType list (overrides the default)
  --output-json PATH    summary destination
                        (default data/backtests/2025/backtest-summary.fixture.json)
  --output-csv PATH     per-bet results destination
                        (default data/backtests/2025/backtest-results.fixture.csv)

Default prop types (without --include-yardage):
  ${V1_STARTER_PROP_TYPES.join(", ")}

All V1 prop types (--include-yardage):
  ${V1_PROP_TYPES.join(", ")}
`);
}

function fmtPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function main(): number {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${(err as Error).message}`);
    printHelp();
    return 2;
  }
  if (!args.fixtures) {
    // eslint-disable-next-line no-console
    console.error(
      "error: only --fixtures is supported right now; processed-data loading is scaffolded with TODOs.",
    );
    return 2;
  }

  const fixtures = loadBacktestFixtures();
  const { summary, results } = runBacktest({
    scope: {
      season: args.season,
      startWeek: args.startWeek,
      endWeek: args.endWeek,
      propTypes: args.propTypes,
      includeYardage: args.includeYardage,
      useFixtures: true,
    },
    fixtures,
  });

  writeSummaryJson(args.outputJson, summary);
  writeResultsCsv(args.outputCsv, results);
  writeResultsJson(
    path.join(
      path.dirname(args.outputJson),
      "backtest-results.fixture.json",
    ),
    results,
  );

  // eslint-disable-next-line no-console
  console.log(`
===== 2025 Backtest — ${args.fixtures ? "Fixture Data" : "Processed Data"} =====
  scope                  : season ${summary.scope.season}, weeks ${summary.scope.startWeek}–${summary.scope.endWeek}
  prop types             : ${summary.scope.propTypes.join(", ")}
  evaluated props        : ${summary.evaluated}
  qualified bets         : ${summary.qualifiedBets}
  passes                 : ${summary.passes}
  wins / losses / pushes : ${summary.wins} / ${summary.losses} / ${summary.pushes}
  hit rate               : ${fmtPct(summary.hitRate)}
  ROI                    : ${summary.roiPct >= 0 ? "+" : ""}${summary.roiPct.toFixed(1)}%
  profit (units)         : ${summary.profitUnits >= 0 ? "+" : ""}${summary.profitUnits.toFixed(2)}
  avg edge               : ${fmtPct(summary.averageEdge)}
  avg EV per unit        : ${summary.averageExpectedValueUnits.toFixed(3)}
  Brier score            : ${summary.brierScore.toFixed(3)}
  max drawdown (units)   : ${summary.maxDrawdownUnits.toFixed(2)}
  best prop type         : ${summary.bestPropType ?? "(n/a)"}
  worst prop type        : ${summary.worstPropType ?? "(n/a)"}
  most common disq       : ${summary.mostCommonDisqualifier ?? "(none)"}
  outputs                :
    summary: ${args.outputJson}
    results: ${args.outputCsv}
================================================
`);

  return 0;
}

process.exit(main());
