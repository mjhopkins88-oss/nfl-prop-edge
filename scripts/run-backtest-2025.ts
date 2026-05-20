/**
 * run-backtest-2025.ts
 *
 * Replays the 2025 season week-by-week through the V1 projection +
 * probability engine, grades every prop, and writes the results out
 * as both CSVs (always) and Prisma rows (with --persist).
 *
 * Strict no-leak rule: when evaluating week W we only ever look at
 * player logs from weeks < W (and earlier seasons), prop markets
 * snapshotted before kickoff, and injury / weather flags scoped to W.
 * The orchestrator slices the logs once at input-load time and passes
 * the slice down — no module below this script touches anything
 * beyond what it's handed.
 *
 * Usage:
 *   # demo run (mock data, CSVs only)
 *   npx tsx scripts/run-backtest-2025.ts --season 2025 --weeks 7-10
 *
 *   # also persist to Postgres
 *   DATABASE_URL=... npx tsx scripts/run-backtest-2025.ts \
 *     --season 2025 --weeks 7-10 --persist
 *
 * Outputs (under --out, default data/backtests/<season>):
 *   predictions.csv
 *   bets.csv
 *   summary_by_market.csv
 *   summary_by_confidence.csv
 *   summary_by_edge_bucket.csv
 *   summary_by_week.csv
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildFeatures,
  STAT_KEY_BY_PROP_TYPE,
  type FeatureBuildInput,
} from "../src/lib/backtest/feature-builder";
import { projectStats } from "../src/lib/backtest/projection-engine";
import { computeProbability } from "../src/lib/backtest/probability-engine";
import { gradePrediction } from "../src/lib/backtest/grading";
import {
  aggregateMetrics,
  type GradedPrediction,
} from "../src/lib/backtest/metrics";

import type { GameLog, PropType, Recommendation } from "../src/lib/types";
import {
  loadInjuryFlags,
  type InjuryFlag,
} from "../src/lib/ingestion/injuries";
import type { NormalizedWeatherSnapshot } from "../src/lib/ingestion/weather";
import type { BetResult } from "@prisma/client";

// --- CLI --------------------------------------------------------------

interface CliArgs {
  season: number;
  weeks: Set<number>;
  source: "mock" | "csv" | "db";
  out: string;
  modelName: string;
  modelVersion: string;
  injuriesPath: string;
  persist: boolean;
  dryRun: boolean;
}

function parseWeeks(spec: string): Set<number> {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes("-")) {
      const [lo, hi] = p.split("-", 2).map(Number);
      for (let w = lo; w <= hi; w++) out.add(w);
    } else {
      out.add(Number(p));
    }
  }
  return out;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> & { weeksSpec?: string } = {
    source: "mock",
    modelName: "baseline-v1",
    modelVersion: "1.0.0",
    injuriesPath: "data/manual/injury_flags.csv",
    persist: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eat = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--season":
        args.season = Number(eat());
        break;
      case "--weeks":
        args.weeksSpec = eat();
        break;
      case "--source":
        args.source = eat() as CliArgs["source"];
        if (!["mock", "csv", "db"].includes(args.source)) {
          throw new Error("--source must be mock|csv|db");
        }
        break;
      case "--out":
        args.out = eat();
        break;
      case "--model-name":
        args.modelName = eat();
        break;
      case "--model-version":
        args.modelVersion = eat();
        break;
      case "--injuries":
        args.injuriesPath = eat();
        break;
      case "--persist":
        args.persist = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (args.season === undefined) throw new Error("--season is required");
  if (!args.weeksSpec) throw new Error("--weeks is required (e.g. 7-10)");
  return {
    season: args.season,
    weeks: parseWeeks(args.weeksSpec),
    source: args.source ?? "mock",
    out: args.out ?? `data/backtests/${args.season}`,
    modelName: args.modelName!,
    modelVersion: args.modelVersion!,
    injuriesPath: args.injuriesPath!,
    persist: args.persist!,
    dryRun: args.dryRun!,
  };
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  npx tsx scripts/run-backtest-2025.ts --season YYYY --weeks SPEC [options]

Options:
  --season N           (required) NFL season
  --weeks SPEC         (required) e.g. "7-10,12"
  --source mock|csv|db source for games / props / logs (default: mock)
  --out DIR            CSV output dir (default: data/backtests/<season>)
  --model-name STR     ModelRun name (default: baseline-v1)
  --model-version STR  ModelRun version (default: 1.0.0)
  --injuries PATH      injury_flags CSV (default: data/manual/injury_flags.csv)
  --persist            also write to Postgres (requires DATABASE_URL)
  --dry-run            count inputs and exit
`);
}

// --- logging / IO helpers --------------------------------------------

function log(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console[level === "warn" ? "warn" : level === "error" ? "error" : "log"](
    `${ts} ${level.toUpperCase()} ${msg}`,
  );
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(
  p: string,
  columns: string[],
  rows: Record<string, unknown>[],
): number {
  ensureDir(path.dirname(p));
  const lines: string[] = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsv(row[c])).join(","));
  }
  fs.writeFileSync(p, lines.join("\n") + "\n");
  return rows.length;
}

function round(n: number, decimals: number): number {
  const k = 10 ** decimals;
  return Math.round(n * k) / k;
}

function round4Numbers(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "number" && !Number.isInteger(v)) {
      out[k] = round(v, 4);
    }
  }
  return out;
}

// --- input model ------------------------------------------------------

/**
 * A backtest item bundles the prop market with everything the engine
 * needs to score it. Building this once at input-load time keeps the
 * main loop clean — and lets us guarantee here that priorLogs only
 * contains weeks < this prop's week.
 */
interface BacktestItem {
  propMarketId: string;
  season: number;
  week: number;
  gameId: string;
  team: string;
  opponentTeam: string;
  playerName: string;
  position: string;
  propType: PropType;
  line: number;
  overOdds: number;
  underOdds: number;
  bookName: string;
  marketWellFormed: boolean;
  /** Logs from strictly prior weeks. */
  priorLogs: GameLog[];
  /** The actual log for this week, if available. Null for live preds. */
  actualLog: GameLog | null;
  /** Weather snapshot for this game, if any. */
  weather: NormalizedWeatherSnapshot | null;
}

// --- input loaders ----------------------------------------------------

const RELEVANT_PROP_TYPES_BY_POSITION: Record<string, PropType[]> = {
  QB: [
    "PASSING_ATTEMPTS",
    "PASSING_COMPLETIONS",
    "PASSING_YARDS",
    "RUSHING_ATTEMPTS",
    "RUSHING_YARDS",
  ],
  RB: ["RUSHING_ATTEMPTS", "RUSHING_YARDS", "RECEPTIONS", "RECEIVING_YARDS"],
  WR: ["RECEPTIONS", "RECEIVING_YARDS"],
  TE: ["RECEPTIONS", "RECEIVING_YARDS"],
};

// Deterministic bias in [-0.10, +0.10] keyed on (player, week, market).
// Used to give synthetic lines enough variety that the engine can find
// non-trivial edges in the demo.
function seededBias(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 2000) / 10000 - 0.1;
}

function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/**
 * Mock-source loader: synthesizes per-week prop markets from the
 * existing weekly logs in src/lib/mock-data. For each (player, week-in-
 * spec) it bundles strictly-prior logs as features, perturbs the prior
 * average into a "line" with the seeded bias above, and pairs it with
 * the actual log at week W as the truth.
 */
async function loadMockItems(
  season: number,
  weeks: Set<number>,
): Promise<BacktestItem[]> {
  const mod = await import("../src/lib/mock-data");
  const items: BacktestItem[] = [];

  for (const player of mod.players) {
    const allLogs = mod.getRecentLogsFromMock(player.id);
    for (const week of weeks) {
      const actual =
        allLogs.find((l) => l.season === season && l.week === week) ?? null;
      const prior = allLogs.filter(
        (l) => l.season < season || (l.season === season && l.week < week),
      );
      if (!actual || prior.length < 2) continue;

      const allowed = RELEVANT_PROP_TYPES_BY_POSITION[player.position] ?? [];
      for (const propType of allowed) {
        const statKey = STAT_KEY_BY_PROP_TYPE[propType];
        const priorAvg =
          prior.reduce((a, b) => a + Number(b[statKey] ?? 0), 0) /
          prior.length;
        if (priorAvg < 2) continue; // skip non-volume markets for this player

        const bias = seededBias(`${player.id}|${week}|${propType}`);
        const line = Math.max(0.5, roundToHalf(priorAvg * (1 + bias)));

        items.push({
          propMarketId: `synth-${player.id}-W${week}-${propType}`,
          season,
          week,
          gameId: `mock-${player.teamAbbr}-W${week}`,
          team: player.teamAbbr,
          opponentTeam: actual.opponentAbbr,
          playerName: player.fullName,
          position: player.position,
          propType,
          line,
          overOdds: -110,
          underOdds: -110,
          bookName: "MockBook",
          marketWellFormed: true,
          priorLogs: prior,
          actualLog: actual,
          weather: null, // weather wiring lands when weather_snapshots.csv is wired
        });
      }
    }
  }
  return items;
}

// --- prediction row type ----------------------------------------------

interface PredictionRow {
  propMarketId: string;
  season: number;
  week: number;
  gameId: string;
  team: string;
  playerName: string;
  propType: PropType;
  line: number;
  bookName: string;
  overPrice: number;
  underPrice: number;
  projectedMean: number;
  projectedStdDev: number;
  modelOverProbability: number;
  modelUnderProbability: number;
  bookOverProbability: number;
  bookUnderProbability: number;
  edge: number;
  expectedValue: number;
  recommendation: Recommendation;
  confidence: number;
  qualified: boolean;
  reasons: string;
  risks: string;
  passReasons: string;
  actualValue: number | null;
  result: BetResult;
  unitsStaked: number;
  unitsReturned: number;
  brierComponent: number | null;
}

// --- main flow --------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    log("error", (err as Error).message);
    printHelp();
    return 2;
  }

  log(
    "info",
    `season=${args.season} weeks=${Array.from(args.weeks).sort((a, b) => a - b).join(",")} source=${args.source} out=${args.out} persist=${args.persist} dryRun=${args.dryRun}`,
  );

  // --- injury flags
  let injuryFlags: InjuryFlag[] = [];
  if (fs.existsSync(args.injuriesPath)) {
    injuryFlags = loadInjuryFlags(args.injuriesPath);
    log("info", `loaded ${injuryFlags.length} injury flags`);
  } else {
    log("warn", `${args.injuriesPath} not found — running without injury context`);
  }

  // --- load items
  let items: BacktestItem[];
  if (args.source === "mock") {
    items = await loadMockItems(args.season, args.weeks);
  } else {
    log(
      "error",
      `--source ${args.source} not wired yet — populate games.csv / prop_markets.csv / player_week_stats.csv first, or use --source mock for the V1 demo.`,
    );
    return 1;
  }

  log("info", `loaded ${items.length} backtest items`);
  if (args.dryRun || items.length === 0) {
    log("info", "dry-run / empty input — no engine execution");
    return 0;
  }

  // --- run the engine
  const predictions: PredictionRow[] = [];
  const graded: GradedPrediction[] = [];

  for (const item of items) {
    const featureInput: FeatureBuildInput = {
      season: item.season,
      week: item.week,
      gameId: item.gameId,
      team: item.team,
      opponentTeam: item.opponentTeam,
      playerName: item.playerName,
      propType: item.propType,
      line: item.line,
      priorLogs: item.priorLogs,
      weather: item.weather,
      injuryFlags,
      marketWellFormed: item.marketWellFormed,
    };

    const features = buildFeatures(featureInput);
    const projection = projectStats(features, item.propType);
    const probability = computeProbability({
      propType: item.propType,
      line: item.line,
      overOdds: item.overOdds,
      underOdds: item.underOdds,
      marketWellFormed: item.marketWellFormed,
      projection,
    });

    const statKey = STAT_KEY_BY_PROP_TYPE[item.propType];
    const actualValue = item.actualLog == null
      ? null
      : Number(item.actualLog[statKey] ?? 0);

    const grade = gradePrediction({
      recommendation: probability.recommendation,
      line: item.line,
      overOdds: item.overOdds,
      underOdds: item.underOdds,
      actualValue,
      modelOverProbability: probability.modelOverProbability,
    });

    const row: PredictionRow = {
      propMarketId: item.propMarketId,
      season: item.season,
      week: item.week,
      gameId: item.gameId,
      team: item.team,
      playerName: item.playerName,
      propType: item.propType,
      line: item.line,
      bookName: item.bookName,
      overPrice: item.overOdds,
      underPrice: item.underOdds,
      projectedMean: round(projection.mean, 2),
      projectedStdDev: round(projection.stddev, 2),
      modelOverProbability: round(probability.modelOverProbability, 4),
      modelUnderProbability: round(probability.modelUnderProbability, 4),
      bookOverProbability: round(probability.bookOverProbability, 4),
      bookUnderProbability: round(probability.bookUnderProbability, 4),
      edge: round(probability.edge, 4),
      expectedValue: round(probability.expectedValue, 4),
      recommendation: probability.recommendation,
      confidence: round(probability.confidence, 3),
      qualified: probability.qualified,
      reasons: projection.reasons.join(" | "),
      risks: projection.risks.join(" | "),
      passReasons: probability.passReasons.join(" | "),
      actualValue,
      result: grade.result,
      unitsStaked: grade.unitsStaked,
      unitsReturned: round(grade.unitsReturned, 4),
      brierComponent:
        grade.brierComponent != null ? round(grade.brierComponent, 4) : null,
    };
    predictions.push(row);
    graded.push({
      season: item.season,
      week: item.week,
      propType: item.propType,
      recommendation: probability.recommendation,
      qualified: probability.qualified,
      edge: probability.edge,
      confidence: probability.confidence,
      unitsStaked: grade.unitsStaked,
      unitsReturned: grade.unitsReturned,
      result: grade.result,
      brierComponent: grade.brierComponent,
    });
  }

  log("info", `engine done — ${predictions.length} predictions`);

  // --- aggregate + log
  const metrics = aggregateMetrics(graded);
  log(
    "info",
    `overall: plays=${metrics.plays} (${metrics.wins}W/${metrics.losses}L/${metrics.pushes}P) noBets=${metrics.noBets} hitRate=${(metrics.hitRate * 100).toFixed(1)}% roi=${metrics.roiPct.toFixed(2)}% avgEdge=${(metrics.averageEdge * 100).toFixed(2)}% brier=${metrics.brierScore != null ? metrics.brierScore.toFixed(4) : "n/a"}`,
  );

  // --- CSVs (always)
  ensureDir(args.out);

  const PRED_COLS = [
    "propMarketId", "season", "week", "gameId", "team", "playerName",
    "propType", "line", "bookName", "overPrice", "underPrice",
    "projectedMean", "projectedStdDev",
    "modelOverProbability", "modelUnderProbability",
    "bookOverProbability", "bookUnderProbability",
    "edge", "expectedValue", "recommendation", "confidence", "qualified",
    "reasons", "risks", "passReasons",
    "actualValue", "result", "unitsStaked", "unitsReturned", "brierComponent",
  ];
  const np = writeCsv(
    path.join(args.out, "predictions.csv"),
    PRED_COLS,
    predictions as unknown as Record<string, unknown>[],
  );

  const bets = predictions.filter((p) => p.qualified);
  const BET_COLS = [
    "propMarketId", "season", "week", "gameId", "playerName", "propType",
    "line", "recommendation", "edge", "expectedValue", "confidence",
    "unitsStaked", "unitsReturned", "result",
  ];
  const nb = writeCsv(
    path.join(args.out, "bets.csv"),
    BET_COLS,
    bets as unknown as Record<string, unknown>[],
  );

  const SUMMARY_COLS = [
    "plays", "wins", "losses", "pushes", "noBets", "hitRate",
    "unitsStaked", "unitsReturned", "roiPct", "averageEdge",
  ];

  writeCsv(
    path.join(args.out, "summary_by_market.csv"),
    ["propType", ...SUMMARY_COLS],
    metrics.byPropType.map(round4Numbers) as Record<string, unknown>[],
  );
  writeCsv(
    path.join(args.out, "summary_by_confidence.csv"),
    ["tier", ...SUMMARY_COLS],
    metrics.byConfidence.map(round4Numbers) as Record<string, unknown>[],
  );
  writeCsv(
    path.join(args.out, "summary_by_edge_bucket.csv"),
    ["bucket", ...SUMMARY_COLS],
    metrics.byEdgeBucket.map(round4Numbers) as Record<string, unknown>[],
  );
  writeCsv(
    path.join(args.out, "summary_by_week.csv"),
    ["season", "week", ...SUMMARY_COLS],
    metrics.byWeek.map(round4Numbers) as Record<string, unknown>[],
  );

  log("info", `wrote ${np} predictions + ${nb} bets to ${args.out}`);

  // --- persist (optional)
  if (args.persist) {
    if (!process.env.DATABASE_URL) {
      log(
        "error",
        "--persist set but DATABASE_URL is not — skipping DB writes",
      );
      return 1;
    }
    await persistToDb({
      modelName: args.modelName,
      modelVersion: args.modelVersion,
      season: args.season,
      predictions,
    });
  }

  return 0;
}

async function persistToDb(args: {
  modelName: string;
  modelVersion: string;
  season: number;
  predictions: PredictionRow[];
}): Promise<void> {
  const { PrismaClient, ModelRunType } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const run = await prisma.modelRun.create({
      data: {
        name: args.modelName,
        version: args.modelVersion,
        runType: ModelRunType.BACKTEST,
        notes: `Backtest of ${args.season} — ${args.predictions.length} predictions`,
      },
    });

    for (const p of args.predictions) {
      const pred = await prisma.propPrediction.create({
        data: {
          modelRunId: run.id,
          season: p.season,
          week: p.week,
          gameId: p.gameId,
          team: p.team,
          playerName: p.playerName,
          propType: p.propType,
          line: p.line,
          bookName: p.bookName,
          overPrice: p.overPrice,
          underPrice: p.underPrice,
          projectedMean: p.projectedMean,
          projectedStdDev: p.projectedStdDev,
          modelOverProbability: p.modelOverProbability,
          modelUnderProbability: p.modelUnderProbability,
          bookOverProbability: p.bookOverProbability,
          bookUnderProbability: p.bookUnderProbability,
          edge: p.edge,
          expectedValue: p.expectedValue,
          recommendation: p.recommendation,
          confidence: p.confidence,
          qualified: p.qualified,
          reasons: p.reasons.split(" | ").filter(Boolean),
          risks: p.risks.split(" | ").filter(Boolean),
          passReasons: p.passReasons.split(" | ").filter(Boolean),
          actualValue: p.actualValue,
          result: p.result,
          unitsStaked: p.unitsStaked,
          unitsReturned: p.unitsReturned,
          brierComponent: p.brierComponent,
        },
      });
      if (p.qualified) {
        await prisma.betCandidate.create({
          data: {
            predictionId: pred.id,
            modelRunId: run.id,
            season: p.season,
            week: p.week,
            gameId: p.gameId,
            playerName: p.playerName,
            propType: p.propType,
            line: p.line,
            recommendedSide: p.recommendation,
            recommendedOdds:
              p.recommendation === "UNDER" ? p.underPrice : p.overPrice,
            edge: p.edge,
            expectedValue: p.expectedValue,
            confidence: p.confidence,
            staked: p.unitsStaked,
            returned: p.unitsReturned,
            result: p.result,
          },
        });
      }
    }

    // BacktestResult: one row per (propType, week)
    interface SliceAcc {
      propType: PropType; season: number; week: number;
      plays: number; wins: number; losses: number; pushes: number;
      staked: number; returned: number;
    }
    const grouped = new Map<string, SliceAcc>();
    for (const p of args.predictions) {
      const key = `${p.season}|${p.week}|${p.propType}`;
      const g: SliceAcc = grouped.get(key) ?? {
        propType: p.propType, season: p.season, week: p.week,
        plays: 0, wins: 0, losses: 0, pushes: 0, staked: 0, returned: 0,
      };
      if (p.result === "WIN") { g.wins++; g.plays++; }
      else if (p.result === "LOSS") { g.losses++; g.plays++; }
      else if (p.result === "PUSH") { g.pushes++; g.plays++; }
      g.staked += p.unitsStaked;
      g.returned += p.unitsReturned;
      grouped.set(key, g);
    }
    for (const g of grouped.values()) {
      const decided = g.wins + g.losses;
      const hitRate = decided > 0 ? g.wins / decided : 0;
      const roiPct = g.staked > 0 ? ((g.returned - g.staked) / g.staked) * 100 : 0;
      await prisma.backtestResult.upsert({
        where: {
          modelRunId_propType_season_week: {
            modelRunId: run.id,
            propType: g.propType,
            season: g.season,
            week: g.week,
          },
        },
        create: {
          modelRunId: run.id,
          propType: g.propType,
          season: g.season,
          week: g.week,
          plays: g.plays,
          wins: g.wins,
          losses: g.losses,
          pushes: g.pushes,
          unitsStaked: g.staked,
          unitsReturn: g.returned,
          roiPct,
          hitRate,
        },
        update: {
          plays: g.plays,
          wins: g.wins,
          losses: g.losses,
          pushes: g.pushes,
          unitsStaked: g.staked,
          unitsReturn: g.returned,
          roiPct,
          hitRate,
        },
      });
    }

    log(
      "info",
      `persisted ModelRun=${run.id} predictions=${args.predictions.length} backtestResults=${grouped.size}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    log("error", (err as Error).stack ?? String(err));
    process.exit(1);
  },
);
