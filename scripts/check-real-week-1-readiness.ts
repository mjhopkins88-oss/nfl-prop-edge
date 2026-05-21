/**
 * Real-data readiness check for the 2025 Week 1 starter test.
 *
 * Surfaces a single READY / NOT_READY verdict the user can run
 * before deciding whether to invoke any paid ingestion. Reports:
 *
 *   · whether the stored Odds API quotes exist
 *   · whether the processed nflverse player stats exist
 *   · whether the schedule fixture exists
 *   · stored-mode status (READY / MISSING_*)
 *   · whether the next command would require a paid API call
 *
 * Never calls a network. Never spends credits. Always exits with
 * a useful summary even when nothing is ready.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildRealWeek1CandidatesFromStoredData,
  type BuildRealWeek1CandidatesResult,
} from "../src/lib/backtest/real-week-candidate-builder";

interface CliArgs {
  season: number;
  week: number;
  json: boolean;
  /** Optional repo root override — defaults to process.cwd() at call time. */
  repoRoot?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { season: 2025, week: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--season":
        args.season = Number(next());
        break;
      case "--week":
        args.week = Number(next());
        break;
      case "--json":
        args.json = true;
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: npx tsx scripts/check-real-week-1-readiness.ts [--season 2025] [--week 1] [--json]",
        );
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function existsIn(repoRoot: string, rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel));
}

export interface FileCheck {
  path: string;
  required: boolean;
  present: boolean;
  hint?: string;
}

export interface ReadinessReport {
  season: number;
  week: number;
  status: "READY" | "NOT_READY";
  syntheticFixture: boolean;
  realWeek1BacktestReady: boolean;
  missingStoredOdds: boolean;
  missingProcessedNfl: boolean;
  noTouchdownProps: true;
  noPaidApiCalls: true;
  noAutomatedBetting: true;
  storedBuilderStatus: BuildRealWeek1CandidatesResult["status"];
  files: FileCheck[];
  missingFiles: string[];
  nextCommand: string;
  nextCommandRequiresPaidApi: boolean;
  notes: string[];
}

export function buildReadinessReport(args: {
  season: number;
  week: number;
  /** Resolved at call time so tests can sandbox under a temp dir. */
  repoRoot?: string;
}): ReadinessReport {
  const repoRoot = args.repoRoot ?? process.cwd();
  const files: FileCheck[] = [
    {
      path: `data/processed/odds/${args.season}/week-${args.week}-prop-markets.csv`,
      required: true,
      present: existsIn(repoRoot,
        `data/processed/odds/${args.season}/week-${args.week}-prop-markets.csv`,
      ),
      hint: "Produced by the paid Odds API ingestion with --execute. Stored, not live.",
    },
    {
      path: `data/processed/odds/${args.season}/week-${args.week}-prop-quotes.csv`,
      required: false,
      present: existsIn(repoRoot,
        `data/processed/odds/${args.season}/week-${args.week}-prop-quotes.csv`,
      ),
      hint: "Optional companion quotes file from the same ingestion run.",
    },
    {
      path: "data/processed/nfl/player_week_stats.csv",
      required: true,
      present: existsIn(repoRoot,"data/processed/nfl/player_week_stats.csv"),
      hint: "Produced by `npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run` after nflverse raw CSVs are dropped into data/raw/nfl/.",
    },
    {
      path: "data/processed/nfl/team_week_stats.csv",
      required: false,
      present: existsIn(repoRoot,"data/processed/nfl/team_week_stats.csv"),
      hint: "Optional team-week stats — lights up extra features.",
    },
    {
      path: "data/processed/nfl/games.csv",
      required: false,
      present: existsIn(repoRoot,"data/processed/nfl/games.csv"),
      hint: "Optional — when present, overrides the schedule fixture.",
    },
    {
      path: "data/processed/nfl/rosters.csv",
      required: false,
      present: existsIn(repoRoot,"data/processed/nfl/rosters.csv"),
      hint: "Optional — used for player-team mapping when present.",
    },
    {
      path: `data/fixtures/nfl/${args.season}-week-${args.week}-schedule.fixture.json`,
      required: true,
      present: existsIn(repoRoot,
        `data/fixtures/nfl/${args.season}-week-${args.week}-schedule.fixture.json`,
      ),
      hint: "Authoritative Week-N schedule fixture (16 real games).",
    },
  ];

  const missingFiles = files
    .filter((f) => f.required && !f.present)
    .map((f) => f.path);

  // Ask the builder what status it would return without writing
  // anything to disk.
  const probe = buildRealWeek1CandidatesFromStoredData({
    season: args.season,
    week: args.week,
    processedRoot: path.join(repoRoot, "data", "processed"),
  });

  // The builder short-circuits on the first missing input. For
  // the CLI's user-facing flags, prefer the actual file presence
  // so both checks read true when both are missing.
  const oddsFilePresent = existsIn(repoRoot,
    `data/processed/odds/${args.season}/week-${args.week}-prop-markets.csv`,
  );
  const nflFilePresent = existsIn(repoRoot,"data/processed/nfl/player_week_stats.csv");
  const missingStoredOdds = !oddsFilePresent;
  const missingProcessedNfl = !nflFilePresent;
  const isReady = probe.status === "READY";

  const notes: string[] = [];
  if (probe.notes.length > 0) notes.push(...probe.notes.slice(0, 4));

  // Next command depends on which input is missing.
  let nextCommand: string;
  let nextCommandRequiresPaidApi = false;
  if (!existsIn(repoRoot,"data/processed/nfl/player_week_stats.csv")) {
    nextCommand =
      "npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run";
    notes.push(
      "Drop nflverse CSVs into data/raw/nfl/<season>/ before this step. Network mode is opt-in via ALLOW_NFLVERSE_NETWORK_FETCH=true.",
    );
  } else if (
    !existsIn(repoRoot,
      `data/processed/odds/${args.season}/week-${args.week}-prop-markets.csv`,
    )
  ) {
    nextCommand =
      `ALLOW_REAL_ODDS_API_CALLS=true npx tsx scripts/ingest-historical-prop-lines.ts --season ${args.season} --scope week --week ${args.week} --execute`;
    nextCommandRequiresPaidApi = true;
    notes.push(
      `Run the smoke test first: \`ALLOW_REAL_ODDS_API_CALLS=true npx tsx scripts/ingest-historical-prop-lines.ts --season ${args.season} --scope smoke-test --execute\`. Both commands consume credits.`,
    );
  } else if (isReady) {
    nextCommand = `npx tsx scripts/run-week-1-starter-test.ts --phase full --data-mode stored --season ${args.season} --week ${args.week}`;
  } else {
    nextCommand = `npx tsx scripts/run-week-1-starter-test.ts --phase pregame --data-mode stored --season ${args.season} --week ${args.week}`;
  }

  return {
    season: args.season,
    week: args.week,
    status: isReady ? "READY" : "NOT_READY",
    syntheticFixture: !isReady,
    realWeek1BacktestReady: isReady,
    missingStoredOdds,
    missingProcessedNfl,
    noTouchdownProps: true,
    noPaidApiCalls: true,
    noAutomatedBetting: true,
    storedBuilderStatus: probe.status,
    files,
    missingFiles,
    nextCommand,
    nextCommandRequiresPaidApi,
    notes,
  };
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const report = buildReadinessReport(args);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
    return 0;
  }

  console.log("");
  console.log(
    `=== Real Week ${report.week} (${report.season}) readiness ===`,
  );
  console.log(`  status                 : ${report.status}`);
  console.log(
    `  realWeek1BacktestReady : ${report.realWeek1BacktestReady}`,
  );
  console.log(`  syntheticFixture       : ${report.syntheticFixture}`);
  console.log(`  missingStoredOdds      : ${report.missingStoredOdds}`);
  console.log(`  missingProcessedNfl    : ${report.missingProcessedNfl}`);
  console.log(`  storedBuilderStatus    : ${report.storedBuilderStatus}`);
  console.log("");
  console.log("  files inspected:");
  for (const f of report.files) {
    const tag = f.present
      ? "✓"
      : f.required
        ? "✗ REQUIRED"
        : "· optional";
    console.log(`    ${tag}  ${f.path}`);
  }
  if (report.missingFiles.length > 0) {
    console.log("");
    console.log("  missing required files:");
    for (const p of report.missingFiles) console.log(`    · ${p}`);
  }
  console.log("");
  console.log(
    `  next command           : ${report.nextCommand}`,
  );
  console.log(
    `  next requires paid API : ${report.nextCommandRequiresPaidApi}`,
  );
  if (report.notes.length > 0) {
    console.log("");
    console.log("  notes:");
    for (const n of report.notes) console.log(`    · ${n}`);
  }
  console.log("");
  console.log("  guardrails:");
  console.log("    · no touchdown props admitted");
  console.log("    · no paid API calls made by this check");
  console.log("    · no automated betting paths invoked");
  console.log("");
  console.log("=============================================");
  return 0;
}

if (require.main === module) {
  process.exit(main());
}
