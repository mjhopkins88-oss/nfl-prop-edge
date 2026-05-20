/**
 * 2025 Week 1 starter-test runner.
 *
 * Builds the Week 1 pregame snapshot, runs the simulation against
 * the dedicated Week-1 fixture set under
 * `data/fixtures/backtest/week-1/`, and writes the output files
 * the Model Monitor + Week 1 backtest page read.
 *
 * Pure CPU, no APIs. No automated betting. No touchdown props.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildWeekPregameSnapshot,
  runWeekSimulation,
  type WeekSimulationResult,
} from "../src/lib/backtest/week-simulation";

const WEEK_1_FIXTURE_ROOT = path.join(
  process.cwd(),
  "data",
  "fixtures",
  "backtest",
  "week-1",
);

const OUTPUT_DIR = path.join(
  process.cwd(),
  "data",
  "backtests",
  "2025",
);

interface CliArgs {
  algorithmMode: "V1_SCORECARD" | "V2_PIPELINE" | "COMPARE_V1_V2";
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { algorithmMode: "V1_SCORECARD" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--algorithm-mode": {
        const v = next().toLowerCase();
        args.algorithmMode =
          v === "v2" ? "V2_PIPELINE" : v === "compare" ? "COMPARE_V1_V2" : "V1_SCORECARD";
        break;
      }
      case "--help":
      case "-h":
        console.log("Usage: npx tsx scripts/run-week-1-starter-test.ts [--algorithm-mode v1|v2|compare]");
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function summarize(result: WeekSimulationResult): void {
  console.log("");
  console.log(`===== 2025 Week 1 starter test =====`);
  console.log(`  algorithm mode         : ${result.algorithmMode}`);
  console.log(`  evaluated props        : ${result.evaluatedProps.length}`);
  console.log(`  qualified bets         : ${result.qualifiedBets.length}`);
  console.log(`  passes                 : ${result.passedProps.length}`);
  console.log(
    `  wins / losses / pushes : ${result.wins} / ${result.losses} / ${result.pushes}`,
  );
  console.log(`  hit rate               : ${fmtPct(result.hitRate)}`);
  console.log(`  ROI                    : ${result.roiPct.toFixed(1)}%`);
  console.log(`  average edge           : ${fmtPct(result.averageEdge)}`);
  console.log(`  best prop type         : ${result.bestPropType ?? "(none)"}`);
  console.log(`  worst prop type        : ${result.worstPropType ?? "(none)"}`);
  if (result.commonDisqualifiers.length > 0) {
    console.log(
      `  top disqualifiers      : ${result.commonDisqualifiers
        .slice(0, 3)
        .map((d) => `${d.disqualifier} (×${d.count})`)
        .join("; ")}`,
    );
  }
  if (result.v1v2Comparison) {
    const c = result.v1v2Comparison;
    console.log(
      `  V1 vs V2 changes       : ${c.anyChanges ? `${c.recommendationChanges.length} props` : "no changes"}`,
    );
    console.log(
      `  V1 qualified bets      : ${c.v1Summary.qualifiedBets}, V2 qualified bets: ${c.v2Summary.qualifiedBets}`,
    );
  }
  console.log(
    `  parlay candidates      : ${result.parlayPreview.candidates.length} (selected ${result.parlayPreview.portfolioSummary.selectedCount})`,
  );
  console.log(
    `  game-edge candidates   : ${result.gameEdgePreview.games.length} (qualified ${result.gameEdgePreview.qualifiedCount}, upset watch ${result.gameEdgePreview.upsetWatchCount})`,
  );
  console.log(`====================================`);
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  // Pregame snapshot — explicitly built BEFORE the graded
  // simulation so the no-future-data guarantee is provable.
  const pregame = buildWeekPregameSnapshot({
    season: 2025,
    week: 1,
    algorithmMode: args.algorithmMode === "COMPARE_V1_V2" ? "V1_SCORECARD" : args.algorithmMode,
    fixtureRoot: WEEK_1_FIXTURE_ROOT,
  });
  writeJson(
    path.join(OUTPUT_DIR, "week-1-pregame.fixture.json"),
    pregame,
  );

  const simulation = runWeekSimulation({
    season: 2025,
    week: 1,
    algorithmMode: args.algorithmMode,
    fixtureRoot: WEEK_1_FIXTURE_ROOT,
  });
  writeJson(
    path.join(OUTPUT_DIR, "week-1-results.fixture.json"),
    {
      season: simulation.season,
      week: simulation.week,
      algorithmMode: simulation.algorithmMode,
      generatedAt: simulation.generatedAt,
      evaluatedProps: simulation.evaluatedProps,
      qualifiedBets: simulation.qualifiedBets.map((p) => p.id),
      passedProps: simulation.passedProps.map((p) => p.id),
      wins: simulation.wins,
      losses: simulation.losses,
      pushes: simulation.pushes,
      hitRate: simulation.hitRate,
      roiPct: simulation.roiPct,
      averageEdge: simulation.averageEdge,
      averageConfidenceAdjustedEdge: simulation.averageConfidenceAdjustedEdge,
      bestPropType: simulation.bestPropType,
      worstPropType: simulation.worstPropType,
      commonDisqualifiers: simulation.commonDisqualifiers,
    },
  );

  if (simulation.v1v2Comparison) {
    writeJson(
      path.join(OUTPUT_DIR, "week-1-v1-v2-comparison.fixture.json"),
      {
        generatedAt: simulation.generatedAt,
        v1: {
          evaluated: simulation.v1v2Comparison.v1Summary.evaluated,
          qualifiedBets: simulation.v1v2Comparison.v1Summary.qualifiedBets,
          hitRate: simulation.v1v2Comparison.v1Summary.hitRate,
          roiPct: simulation.v1v2Comparison.v1Summary.roiPct,
          profitUnits: simulation.v1v2Comparison.v1Summary.profitUnits,
        },
        v2: {
          evaluated: simulation.v1v2Comparison.v2Summary.evaluated,
          qualifiedBets: simulation.v1v2Comparison.v2Summary.qualifiedBets,
          hitRate: simulation.v1v2Comparison.v2Summary.hitRate,
          roiPct: simulation.v1v2Comparison.v2Summary.roiPct,
          profitUnits: simulation.v1v2Comparison.v2Summary.profitUnits,
        },
        delta: simulation.v1v2Comparison.deltaSummary,
        recommendationChanges: simulation.v1v2Comparison.recommendationChanges,
        recommendationChangeSummary:
          simulation.v1v2Comparison.recommendationChangeSummary,
      },
    );
  }

  writeJson(
    path.join(OUTPUT_DIR, "week-1-parlay-preview.fixture.json"),
    {
      generatedAt: simulation.generatedAt,
      portfolioSummary: simulation.parlayPreview.portfolioSummary,
      batchSimulation: simulation.parlayPreview.batchSimulation,
      candidates: simulation.parlayPreview.candidates.map((c) => ({
        id: c.id,
        parlayType: c.parlayType,
        legCount: c.legCount,
        gameIds: c.gameIds,
        teams: c.teams,
        combinedOddsAmerican: c.combinedOddsAmerican,
        combinedOddsDecimal: c.combinedOddsDecimal,
        independentJointProbability: c.independentJointProbability,
        correlationAdjustedJointProbability:
          c.correlationAdjustedJointProbability,
        marketJointProbability: c.marketJointProbability,
        expectedValue: c.expectedValue,
        confidenceAdjustedExpectedValue: c.confidenceAdjustedExpectedValue,
        payoutMultiplier: c.payoutMultiplier,
        requiredHitRate: c.requiredHitRate,
        projectedHitRate: c.projectedHitRate,
        correlationScore: c.correlationScore,
        correlationType: c.correlationType,
        recommendation: c.recommendation,
        qualified: c.qualified,
        primaryDisqualifier: c.primaryDisqualifier,
        reasons: c.reasons,
        risks: c.risks,
        legs: c.legs.map((l) => ({
          id: l.id,
          playerName: l.playerName,
          team: l.team,
          opponent: l.opponent,
          gameId: l.gameId,
          propType: l.propType,
          side: l.side,
          line: l.line,
          odds: l.odds,
        })),
      })),
    },
  );

  writeJson(
    path.join(OUTPUT_DIR, "week-1-game-edge-preview.fixture.json"),
    {
      generatedAt: simulation.generatedAt,
      qualifiedCount: simulation.gameEdgePreview.qualifiedCount,
      upsetWatchCount: simulation.gameEdgePreview.upsetWatchCount,
      passCount: simulation.gameEdgePreview.passCount,
      games: simulation.gameEdgePreview.games.map((g) => ({
        gameId: g.gameId,
        homeTeam: g.scorecard.homeTeam,
        awayTeam: g.scorecard.awayTeam,
        recommendation: g.recommendation,
        recommendationLabel: g.recommendationLabel,
        selectedSide: g.selectedSide,
        selectedMarket: g.selectedMarket,
        marketHomeWinProbability: g.marketHomeWinProbability,
        marketAwayWinProbability: g.marketAwayWinProbability,
        modelHomeWinProbability: g.modelHomeWinProbability,
        modelAwayWinProbability: g.modelAwayWinProbability,
        homeMoneylineEdge: g.homeMoneylineEdge,
        awayMoneylineEdge: g.awayMoneylineEdge,
        spreadEdgeHome: g.spreadEdgeHome,
        spreadEdgeAway: g.spreadEdgeAway,
        upsetScore: g.upsetScore,
        underdogSide: g.underdogSide,
        confidence: g.confidence,
        riskScore: g.riskScore,
        dataQualityScore: g.dataQualityScore,
        reasons: g.reasons.slice(0, 3),
        risks: g.risks.slice(0, 3),
      })),
    },
  );

  summarize(simulation);
  return 0;
}

process.exit(main());
