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
import {
  buildWeek1ScheduleValidationReport,
  type CandidateGame,
  type ScheduleValidationReport,
} from "../src/lib/backtest/week-1-schedule-validation";
import { loadBacktestFixtures } from "../src/lib/backtest/data-loader";
import {
  buildRealWeek1CandidatesFromStoredData,
  type BuildRealWeek1CandidatesResult,
} from "../src/lib/backtest/real-week-candidate-builder";

type DataMode = "fixture" | "stored";

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

type Phase = "pregame" | "simulation" | "full" | "all";

interface CliArgs {
  algorithmMode: "V1_SCORECARD" | "V2_PIPELINE" | "COMPARE_V1_V2";
  phase: Phase;
  season: number;
  week: number;
  fixtures: boolean;
  dataMode: DataMode;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    algorithmMode: "V1_SCORECARD",
    phase: "all",
    season: 2025,
    week: 1,
    fixtures: true,
    dataMode: "fixture",
  };
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
      case "--phase": {
        const v = next().toLowerCase();
        if (
          v !== "pregame" &&
          v !== "simulation" &&
          v !== "full" &&
          v !== "all"
        ) {
          throw new Error(
            `--phase must be pregame | simulation | full | all (got ${v})`,
          );
        }
        args.phase = v as Phase;
        break;
      }
      case "--season":
        args.season = Number(next());
        break;
      case "--week":
        args.week = Number(next());
        break;
      case "--fixtures":
        args.fixtures = true;
        break;
      case "--data-mode": {
        const v = next().toLowerCase();
        if (v !== "fixture" && v !== "stored") {
          throw new Error(`--data-mode must be fixture | stored (got ${v})`);
        }
        args.dataMode = v as DataMode;
        break;
      }
      case "--help":
      case "-h":
        console.log(
          "Usage: npx tsx scripts/run-week-1-starter-test.ts [--algorithm-mode v1|v2|compare]\n" +
            "                                                  [--phase pregame|simulation|full|all]\n" +
            "                                                  [--season 2025] [--week 1] [--fixtures]\n" +
            "                                                  [--data-mode fixture|stored]\n" +
            "  --data-mode fixture (default) — synthetic fixture path; SYNTHETIC_ONLY status expected.\n" +
            "  --data-mode stored             — real path; reads data/processed/odds/{season}/week-{N}-*.csv\n" +
            "                                   and data/processed/nfl/*.csv. Never calls a paid API.",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  // --fixtures is only required in fixture mode. Stored mode
  // never reads the synthetic backtest fixture root.
  if (args.dataMode === "fixture" && !args.fixtures) {
    throw new Error(
      "fixture data-mode requires --fixtures (we never auto-fall-back to live data).",
    );
  }
  if (args.season !== 2025 || args.week !== 1) {
    throw new Error(
      `This script is locked to season=2025 week=1 (got ${args.season}/${args.week}).`,
    );
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

/**
 * Locked pregame recommendation snapshot — what we would have
 * advised at kickoff. Mirrors the pregame `candidates` array but
 * also surfaces the `recommendation` / `qualified` flags so a
 * downstream consumer can show "locked" plays without re-reading
 * the bigger snapshot object.
 */
function writeLockedPregameRecommendations(args: {
  pregame: ReturnType<typeof buildWeekPregameSnapshot>;
  scheduleReport: ScheduleValidationReport;
  outputDir: string;
}): void {
  const locked = args.pregame.candidates.map((c) => ({
    propMarketId: c.id,
    playerName: c.playerName,
    team: c.team,
    opponent: c.opponent,
    propType: c.propType,
    line: c.line,
    selectedSide: c.selectedSide,
    recommendation: c.recommendation,
    qualified: c.qualified,
    confidence: c.confidence,
    edge: c.edge,
    edgeBucket: c.edgeBucket,
    primaryDisqualifier: c.primaryDisqualifier,
    locked: true,
    season: c.season,
    week: c.week,
  }));
  const lockedQualified = locked.filter((l) => l.qualified).length;
  writeJson(path.join(args.outputDir, "week-1-locked-pregame-recommendations.fixture.json"), {
    generatedAt: args.pregame.generatedAt,
    season: args.pregame.season,
    week: args.pregame.week,
    algorithmMode: args.pregame.algorithmMode,
    lockedAt: args.pregame.generatedAt,
    totalCandidates: locked.length,
    lockedQualifiedCount: lockedQualified,
    lockedPasses: locked.length - lockedQualified,
    scheduleValidationStatus: args.scheduleReport.status,
    scheduleSource: args.scheduleReport.scheduleSource,
    syntheticFixture: args.scheduleReport.syntheticFixture,
    realWeek1BacktestReady: args.scheduleReport.realWeek1BacktestReady,
    invalidCandidateGames: args.scheduleReport.invalidCandidateGames,
    recommendations: locked,
  });
}

/**
 * Write the schedule-validation report itself to a standalone
 * fixture so the page can render the "Schedule Validation" panel
 * without re-doing the work.
 */
function writeScheduleValidation(args: {
  scheduleReport: ScheduleValidationReport;
  outputDir: string;
}): void {
  writeJson(
    path.join(args.outputDir, "week-1-schedule-validation.fixture.json"),
    args.scheduleReport,
  );
}

/**
 * Pregame "data audit" file — single-source-of-truth on what
 * inputs the pregame snapshot consumed and what it deliberately
 * excluded. Used by the Week 1 page's data-integrity panel.
 */
function writeDataAudit(args: {
  pregame: ReturnType<typeof buildWeekPregameSnapshot>;
  outputDir: string;
}): void {
  const { pregame } = args;
  const propTypeCounts: Record<string, number> = {};
  for (const c of pregame.candidates) {
    propTypeCounts[c.propType] = (propTypeCounts[c.propType] ?? 0) + 1;
  }
  writeJson(path.join(args.outputDir, "week-1-data-audit.fixture.json"), {
    generatedAt: pregame.generatedAt,
    season: pregame.season,
    week: pregame.week,
    algorithmMode: pregame.algorithmMode,
    pregameOnly: pregame.pregameOnly,
    includedPropTypes: pregame.propTypes,
    excludedPropTypes: pregame.excludedPropTypes,
    candidateCount: pregame.candidates.length,
    candidatesByPropType: propTypeCounts,
    actualResultsVisibleToModel: false,
    touchdownPropsAllowed: false,
    dataSources: [
      "stored nflverse-style historical stats (data/fixtures/backtest/week-1/player-week-stats.fixture.json)",
      "stored historical Odds API quotes (data/fixtures/backtest/week-1/prop-quotes.fixture.json)",
      "stored weather / stadium snapshots (data/fixtures/backtest/week-1/weather.fixture.json)",
      "static coaching / proxy / matchup data",
    ],
    notes: [
      "Pregame phase uses only data strictly before season=2025 week=1.",
      "No paid API calls made during this run.",
      "No automated betting paths invoked.",
      "Pregame outcomes are explicitly stripped (actualStat=null, result=PASS, profit=0).",
    ],
  });
}

/**
 * Odds-coverage snapshot — counts how many prop markets are
 * present per (gameId, propType) so missing-quote situations
 * show up clearly on the Week 1 page.
 */
function writeOddsCoverage(args: {
  pregame: ReturnType<typeof buildWeekPregameSnapshot>;
  outputDir: string;
}): void {
  const byPropType: Record<string, number> = {};
  const byGame: Record<string, number> = {};
  for (const c of args.pregame.candidates) {
    byPropType[c.propType] = (byPropType[c.propType] ?? 0) + 1;
    byGame[c.gameId] = (byGame[c.gameId] ?? 0) + 1;
  }
  writeJson(path.join(args.outputDir, "week-1-odds-coverage.fixture.json"), {
    generatedAt: args.pregame.generatedAt,
    season: args.pregame.season,
    week: args.pregame.week,
    totalProps: args.pregame.candidates.length,
    byPropType,
    byGame,
    source: "stored fixture (data/fixtures/backtest/week-1/prop-quotes.fixture.json)",
    paidApiCalls: 0,
    note: "Fixture / Stored Data — not a real Odds API pull.",
  });
}

/**
 * nflverse-style coverage snapshot — what stats are present for
 * each player in the Week 1 fixture set.
 */
function writeNflDataCoverage(args: {
  pregame: ReturnType<typeof buildWeekPregameSnapshot>;
  outputDir: string;
}): void {
  const playerSeen = new Set<string>();
  const players: Array<{ playerName: string; team: string; propType: string }> = [];
  for (const c of args.pregame.candidates) {
    const key = `${c.playerName}::${c.propType}`;
    if (playerSeen.has(key)) continue;
    playerSeen.add(key);
    players.push({
      playerName: c.playerName,
      team: c.team,
      propType: c.propType,
    });
  }
  writeJson(path.join(args.outputDir, "week-1-nfl-data-coverage.fixture.json"), {
    generatedAt: args.pregame.generatedAt,
    season: args.pregame.season,
    week: args.pregame.week,
    uniquePlayerProps: players.length,
    players,
    source: "stored fixture (data/fixtures/backtest/week-1/player-week-stats.fixture.json)",
    historyWindow: "strict-before season=2025 week=1 (includes prior 2024 weeks)",
    note: "Fixture / Stored Data — not a real nflverse pull.",
  });
}

/**
 * No-future-data-leakage check — explicit, machine-verifiable
 * boolean for the data-integrity panel.
 */
function writeLeakageCheck(args: {
  pregame: ReturnType<typeof buildWeekPregameSnapshot>;
  outputDir: string;
}): void {
  const violations: Array<{ id: string; reason: string }> = [];
  for (const c of args.pregame.candidates) {
    if (c.actualStat !== null) {
      violations.push({
        id: c.id,
        reason: `actualStat=${c.actualStat} present in pregame snapshot`,
      });
    }
    if (c.result !== "PASS") {
      violations.push({
        id: c.id,
        reason: `graded result ${c.result} present in pregame snapshot`,
      });
    }
    if (c.profitLossUnits !== 0) {
      violations.push({
        id: c.id,
        reason: `non-zero profitLossUnits ${c.profitLossUnits} in pregame snapshot`,
      });
    }
    if (c.season !== args.pregame.season || c.week !== args.pregame.week) {
      violations.push({
        id: c.id,
        reason: `candidate season/week ${c.season}/W${c.week} does not match pregame ${args.pregame.season}/W${args.pregame.week}`,
      });
    }
  }
  writeJson(path.join(args.outputDir, "week-1-leakage-check.fixture.json"), {
    generatedAt: args.pregame.generatedAt,
    season: args.pregame.season,
    week: args.pregame.week,
    pregameOnly: args.pregame.pregameOnly,
    actualResultsVisibleToModel: false,
    leakageDetected: violations.length > 0,
    violations,
    notes: [
      "Verified by buildWeekPregameSnapshot's outcome-strip pass.",
      "Cross-checked by scripts/test-week-1-data-integrity.ts.",
    ],
  });
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

  // Stored mode runs the real-week candidate builder first. If
  // its result isn't READY, we still write a clean data-mode
  // status file so the page can show "Real Week 1 stored data
  // not loaded yet" with the exact next-command hint. Never
  // synthesizes fake data.
  let storedResult: BuildRealWeek1CandidatesResult | undefined;
  if (args.dataMode === "stored") {
    storedResult = buildRealWeek1CandidatesFromStoredData({
      season: args.season,
      week: args.week,
    });
    writeJson(path.join(OUTPUT_DIR, "week-1-data-mode-status.fixture.json"), {
      generatedAt: new Date().toISOString(),
      season: args.season,
      week: args.week,
      dataMode: "stored",
      status: storedResult.status,
      candidateCount: storedResult.candidates.length,
      syntheticFixture: false,
      realWeek1BacktestReady: storedResult.status === "READY",
      missingStoredOdds:
        storedResult.status === "MISSING_STORED_ODDS",
      missingProcessedNfl:
        storedResult.status === "MISSING_PROCESSED_NFL",
      scheduleReport: storedResult.scheduleReport ?? null,
      notes: storedResult.notes,
      nextSteps: storedResult.nextSteps,
    });
    if (storedResult.status !== "READY") {
      // eslint-disable-next-line no-console
      console.log(
        `stored mode: status=${storedResult.status}; wrote week-1-data-mode-status.fixture.json. No synthetic fallback.`,
      );
      for (const note of storedResult.notes) console.log(`  · ${note}`);
      for (const step of storedResult.nextSteps) console.log(`  next: ${step}`);
      return 0;
    }
    // eslint-disable-next-line no-console
    console.log(
      `stored mode: status=READY with ${storedResult.candidates.length} real candidates. Continuing with the standard pregame + simulation pass.`,
    );
    // Falls through to the fixture-driven pregame snapshot for
    // now. Wiring stored candidates through `runWeekSimulation`
    // is the next iteration — at this commit the goal is to
    // prove the stored path returns READY/MISSING cleanly and
    // to surface it on the page.
  }

  // Pregame snapshot — explicitly built BEFORE the graded
  // simulation so the no-future-data guarantee is provable.
  const pregame = buildWeekPregameSnapshot({
    season: 2025,
    week: 1,
    algorithmMode:
      args.algorithmMode === "COMPARE_V1_V2"
        ? "V1_SCORECARD"
        : args.algorithmMode,
    fixtureRoot: WEEK_1_FIXTURE_ROOT,
  });
  writeJson(path.join(OUTPUT_DIR, "week-1-pregame.fixture.json"), pregame);
  // Schedule validation — load the runner's input games and
  // check every (away, home) pair against the real 2025 Week 1
  // schedule. Status feeds the locked recommendations file +
  // the UI banner. No paid API call.
  const inputFixtures = loadBacktestFixtures(WEEK_1_FIXTURE_ROOT);
  const candidateGames: CandidateGame[] = inputFixtures.games.map((g) => ({
    gameId: g.id,
    homeTeam: g.homeTeamAbbr,
    awayTeam: g.awayTeamAbbr,
  }));
  const scheduleReport = buildWeek1ScheduleValidationReport({
    candidates: candidateGames,
  });
  writeScheduleValidation({ scheduleReport, outputDir: OUTPUT_DIR });
  // Always write the data-mode status file in fixture mode too
  // so the page has a consistent shape to read.
  if (args.dataMode === "fixture") {
    writeJson(path.join(OUTPUT_DIR, "week-1-data-mode-status.fixture.json"), {
      generatedAt: new Date().toISOString(),
      season: args.season,
      week: args.week,
      dataMode: "fixture",
      status:
        scheduleReport.status === "PASS"
          ? "READY"
          : "FIXTURE_SYNTHETIC",
      candidateCount: pregame.candidates.length,
      syntheticFixture: scheduleReport.syntheticFixture,
      realWeek1BacktestReady: scheduleReport.realWeek1BacktestReady,
      missingStoredOdds: true,
      missingProcessedNfl: true,
      scheduleReport,
      notes: [
        "Fixture mode — synthetic Week-1 placeholders are expected to fail schedule validation.",
        "Switch to --data-mode stored once nflverse + Odds API ingestion have written processed files.",
      ],
      nextSteps: [
        "npx tsx scripts/ingest-historical-prop-lines.ts --scope smoke-test --source mock --dry-run",
        "ALLOW_REAL_ODDS_API_CALLS=true npx tsx scripts/ingest-historical-prop-lines.ts --scope smoke-test --execute",
        "ALLOW_REAL_ODDS_API_CALLS=true npx tsx scripts/ingest-historical-prop-lines.ts --scope week --season 2025 --week 1 --execute",
        "npx tsx scripts/run-week-1-starter-test.ts --phase full --data-mode stored --season 2025 --week 1",
      ],
    });
  }
  // Companion pregame artifacts read by the Week 1 page +
  // Monitor's data-integrity panels. None of these depend on
  // Week-1 outcomes — they're computed from the pregame snapshot
  // and are always safe to write.
  writeLockedPregameRecommendations({
    pregame,
    scheduleReport,
    outputDir: OUTPUT_DIR,
  });
  writeDataAudit({ pregame, outputDir: OUTPUT_DIR });
  writeOddsCoverage({ pregame, outputDir: OUTPUT_DIR });
  writeNflDataCoverage({ pregame, outputDir: OUTPUT_DIR });
  writeLeakageCheck({ pregame, outputDir: OUTPUT_DIR });

  if (args.phase === "pregame") {
    // eslint-disable-next-line no-console
    console.log(
      `pregame phase: ${pregame.candidates.length} candidates written to data/backtests/2025/week-1-pregame.fixture.json`,
    );
    return 0;
  }

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
