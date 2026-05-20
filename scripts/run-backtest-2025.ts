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
import fs from "node:fs";
import process from "node:process";
import { loadBacktestFixtures } from "../src/lib/backtest/data-loader";
import {
  runBacktest,
  V1_STARTER_PROP_TYPES,
  V1_PROP_TYPES,
  type BacktestAlgorithmMode,
} from "../src/lib/backtest/runner";
import {
  runBacktestComparison,
  summarizeAlgorithmDelta,
} from "../src/lib/backtest/algorithm-comparison";
import {
  writeBreakdownJson,
  writeResultsCsv,
  writeResultsJson,
  writeSummaryJson,
} from "../src/lib/backtest/reporting";
import type { PropType } from "../src/lib/types";

type AlgorithmModeArg = "v1" | "v2" | "compare";

interface CliArgs {
  fixtures: boolean;
  season: number;
  startWeek: number;
  endWeek: number;
  includeYardage: boolean;
  propTypes: PropType[];
  outputJson: string;
  outputCsv: string;
  algorithmMode: AlgorithmModeArg;
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
    algorithmMode: "v1",
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
      case "--algorithm-mode": {
        const raw = eat().toLowerCase();
        if (raw === "v1" || raw === "v2" || raw === "compare") {
          args.algorithmMode = raw;
        } else {
          throw new Error(
            `Unknown --algorithm-mode value: ${raw}. Use v1, v2, or compare.`,
          );
        }
        break;
      }
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
  --algorithm-mode MODE v1 (default, existing scorecard), v2 (opt-in
                        Player Prop Algorithm v2 pipeline), or
                        compare (A/B both, write v1/v2/diff files)

Default prop types (without --include-yardage):
  ${V1_STARTER_PROP_TYPES.join(", ")}

All V1 prop types (--include-yardage):
  ${V1_PROP_TYPES.join(", ")}
`);
}

function fmtPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

function runCompareFlow(args: {
  scope: ReturnType<typeof buildScope>;
  fixtures: ReturnType<typeof loadBacktestFixtures>;
  outputDir: string;
}): number {
  const result = runBacktestComparison({
    scope: args.scope,
    fixtures: args.fixtures,
  });
  if (!fs.existsSync(args.outputDir)) fs.mkdirSync(args.outputDir, { recursive: true });
  const v1Path = path.join(args.outputDir, "v1-summary.fixture.json");
  const v2Path = path.join(args.outputDir, "v2-summary.fixture.json");
  const cmpPath = path.join(args.outputDir, "v1-v2-comparison.fixture.json");
  const changePath = path.join(
    args.outputDir,
    "recommendation-changes.fixture.json",
  );
  writeSummaryJson(v1Path, result.v1Summary);
  writeSummaryJson(v2Path, result.v2Summary);
  writeBreakdownJson(cmpPath, {
    generatedAt: result.generatedAt,
    scope: result.scope,
    deltaSummary: result.deltaSummary,
    v1: {
      evaluated: result.v1Summary.evaluated,
      qualifiedBets: result.v1Summary.qualifiedBets,
      hitRate: result.v1Summary.hitRate,
      roiPct: result.v1Summary.roiPct,
      profitUnits: result.v1Summary.profitUnits,
    },
    v2: {
      evaluated: result.v2Summary.evaluated,
      qualifiedBets: result.v2Summary.qualifiedBets,
      hitRate: result.v2Summary.hitRate,
      roiPct: result.v2Summary.roiPct,
      profitUnits: result.v2Summary.profitUnits,
    },
  });
  writeBreakdownJson(changePath, {
    generatedAt: result.generatedAt,
    totalEvaluated: result.recommendationChangeSummary.totalEvaluated,
    counts: result.recommendationChangeSummary.counts,
    v1OnlyBets: result.recommendationChangeSummary.v1OnlyBets,
    v2OnlyBets: result.recommendationChangeSummary.v2OnlyBets,
    oppositeSides: result.recommendationChangeSummary.oppositeSides,
    topNewV2Disqualifiers:
      result.recommendationChangeSummary.topNewV2Disqualifiers,
    changes: result.recommendationChangeSummary.changes,
  });

  const lines = summarizeAlgorithmDelta(result);
  // eslint-disable-next-line no-console
  console.log(`
===== 2025 Backtest — A/B Comparison (V1_SCORECARD vs V2_PIPELINE) =====
  scope                  : season ${result.scope.season}, weeks ${result.scope.startWeek}–${result.scope.endWeek}
  prop types             : ${result.scope.propTypes.join(", ")}
${lines.map((l) => `  ${l}`).join("\n")}
  outputs                :
    v1 summary: ${v1Path}
    v2 summary: ${v2Path}
    comparison: ${cmpPath}
    changes  : ${changePath}
================================================
`);
  return 0;
}

function buildScope(args: CliArgs): {
  season: number;
  startWeek: number;
  endWeek: number;
  propTypes: PropType[];
  includeYardage: boolean;
  useFixtures: boolean;
} {
  return {
    season: args.season,
    startWeek: args.startWeek,
    endWeek: args.endWeek,
    propTypes: args.propTypes,
    includeYardage: args.includeYardage,
    useFixtures: true,
  };
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
  const scope = {
    season: args.season,
    startWeek: args.startWeek,
    endWeek: args.endWeek,
    propTypes: args.propTypes,
    includeYardage: args.includeYardage,
    useFixtures: true,
  };

  if (args.algorithmMode === "compare") {
    return runCompareFlow({ scope, fixtures, outputDir: path.dirname(args.outputJson) });
  }

  const algoMode: BacktestAlgorithmMode =
    args.algorithmMode === "v2" ? "V2_PIPELINE" : "V1_SCORECARD";
  const { summary, results } = runBacktest({
    scope,
    fixtures,
    algorithmMode: algoMode,
  });

  const outDir = path.dirname(args.outputJson);
  writeSummaryJson(args.outputJson, summary);
  writeResultsCsv(args.outputCsv, results);
  writeResultsJson(
    path.join(outDir, "backtest-results.fixture.json"),
    results,
  );
  writeBreakdownJson(
    path.join(outDir, "performance-by-prop-type.fixture.json"),
    summary.byPropType,
  );
  writeBreakdownJson(
    path.join(outDir, "performance-by-line-bucket.fixture.json"),
    summary.byLineBucket,
  );
  writeBreakdownJson(
    path.join(outDir, "performance-by-edge-bucket.fixture.json"),
    summary.byEdgeBucket,
  );
  writeBreakdownJson(
    path.join(outDir, "performance-by-confidence.fixture.json"),
    summary.byConfidence,
  );
  writeBreakdownJson(
    path.join(outDir, "performance-by-disqualifier.fixture.json"),
    summary.byDisqualifier,
  );
  writeBreakdownJson(
    path.join(outDir, "performance-by-postmortem.fixture.json"),
    summary.byPostmortem,
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
