/**
 * ingest-nfl-history.ts
 *
 * TypeScript companion to the existing Python scaffold. Reads raw
 * nflverse CSVs from `data/raw/nfl/<season>/` (or fetches them in
 * opt-in network mode), normalizes the rows, and writes the
 * processed CSV bundle to `data/processed/nfl/`.
 *
 * Defaults to `--source local --dry-run`. Network fetch is opt-in
 * via `--source nflverse` AND `ALLOW_NFLVERSE_NETWORK_FETCH=true`.
 *
 *   npx tsx scripts/ingest-nfl-history.ts --season 2025
 *   npx tsx scripts/ingest-nfl-history.ts --start-season 2022 --end-season 2025
 *   npx tsx scripts/ingest-nfl-history.ts --season 2025 --source local
 *   npx tsx scripts/ingest-nfl-history.ts --season 2025 --source nflverse --dry-run
 *
 * No paid APIs. No touchdown columns. No automated betting.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildNflverseDownloadPlan,
  isNetworkFetchAllowed,
  loadAndNormalizeRaw,
  NETWORK_FETCH_ENV_FLAG,
  writeProcessed,
  type IngestionOptions,
  type NflverseSource,
} from "../src/lib/ingestion/nflverse";

interface CliArgs {
  seasons: number[];
  source: NflverseSource;
  dryRun: boolean;
  rawDir: string;
  outputDir: string;
}

function rangeInclusive(lo: number, hi: number): number[] {
  if (lo > hi) return [];
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    seasons: [],
    source: "local",
    dryRun: true,
    rawDir: path.join(process.cwd(), "data", "raw", "nfl"),
    outputDir: path.join(process.cwd(), "data", "processed", "nfl"),
  };
  let startSeason: number | undefined;
  let endSeason: number | undefined;
  let seasonOverridden = false;
  let dryRunExplicit = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--season":
        args.seasons = [Number(next())];
        seasonOverridden = true;
        break;
      case "--seasons": {
        const value = next();
        args.seasons = value.split(",").map((v) => Number(v.trim()));
        seasonOverridden = true;
        break;
      }
      case "--start-season":
        startSeason = Number(next());
        break;
      case "--end-season":
        endSeason = Number(next());
        break;
      case "--source": {
        const v = next();
        if (v !== "local" && v !== "nflverse") {
          throw new Error(`Unknown --source value: ${v}`);
        }
        args.source = v;
        break;
      }
      case "--dry-run":
        args.dryRun = true;
        dryRunExplicit = true;
        break;
      case "--no-dry-run":
        args.dryRun = false;
        dryRunExplicit = true;
        break;
      case "--raw":
      case "--raw-dir":
        args.rawDir = next();
        break;
      case "--output":
      case "--out":
      case "--output-dir":
        args.outputDir = next();
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  if (!seasonOverridden && (startSeason !== undefined || endSeason !== undefined)) {
    const lo = startSeason ?? endSeason!;
    const hi = endSeason ?? startSeason!;
    args.seasons = rangeInclusive(lo, hi);
  }
  if (args.seasons.length === 0) args.seasons = [2025];

  // Network mode requires explicit env opt-in unless dry-run.
  if (args.source === "nflverse" && !args.dryRun && !isNetworkFetchAllowed()) {
    // Don't silently switch behaviour; surface the gate.
    if (!dryRunExplicit) args.dryRun = true;
  }
  return args;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  npx tsx scripts/ingest-nfl-history.ts [options]

Options:
  --season N              ingest a single season (default 2025)
  --seasons 2024,2025     ingest multiple specific seasons
  --start-season N        inclusive lower bound (range mode)
  --end-season N          inclusive upper bound (range mode)
  --source local          read raw CSVs from --raw (default)
  --source nflverse       fetch from public nflverse-data releases
                          (requires --no-dry-run AND
                           ${NETWORK_FETCH_ENV_FLAG}=true)
  --dry-run               default. Print the plan, write nothing.
  --no-dry-run            actually write processed CSVs
  --raw DIR               raw CSV directory (default data/raw/nfl)
  --output DIR            processed CSV directory
                          (default data/processed/nfl)

Where to put raw nflverse CSVs (one folder per season):
  data/raw/nfl/{season}/schedules.csv
  data/raw/nfl/{season}/player_stats.csv
  data/raw/nfl/{season}/team_stats.csv     (optional)
  data/raw/nfl/{season}/rosters.csv
  data/raw/nfl/{season}/snap_counts.csv    (optional)

Public nflverse-data release URLs (no API key required):
  https://github.com/nflverse/nflverse-data/releases
    /download/schedules/sched_{season}.csv
    /download/player_stats/player_stats_{season}.csv
    /download/rosters/roster_{season}.csv
    /download/snap_counts/snap_counts_{season}.csv

We do NOT ingest touchdown columns. They are dropped at parse time.
`);
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error: ${(err as Error).message}`);
    printHelp();
    return 2;
  }

  const opts: IngestionOptions = {
    seasons: args.seasons,
    rawDir: args.rawDir,
    processedDir: args.outputDir,
    source: args.source,
    dryRun: args.dryRun,
  };

  // eslint-disable-next-line no-console
  console.log(
    `nflverse ingest — seasons ${args.seasons.join(", ")}, source=${args.source}, dryRun=${args.dryRun}`,
  );

  if (args.source === "nflverse") {
    const plan = buildNflverseDownloadPlan(args.seasons);
    // eslint-disable-next-line no-console
    console.log("Download plan (no network call until --no-dry-run):");
    for (const entry of plan) {
      // eslint-disable-next-line no-console
      console.log(`  Season ${entry.season}:`);
      for (const f of entry.files) {
        // eslint-disable-next-line no-console
        console.log(`    ${f.filename} -> ${f.url}`);
      }
    }
    if (!args.dryRun) {
      if (!isNetworkFetchAllowed()) {
        // eslint-disable-next-line no-console
        console.error(
          `\nerror: network fetch requires ${NETWORK_FETCH_ENV_FLAG}=true. Set the env var and re-run.`,
        );
        return 3;
      }
      // eslint-disable-next-line no-console
      console.error(
        "\nnote: network fetch is scaffolded but not wired in. Drop the files listed above into the --raw directory and re-run with --source local --no-dry-run.",
      );
      return 0;
    }
    // dry-run path returns without writing.
    return 0;
  }

  // local mode — read raw, normalize, optionally write.
  const haveAny = args.seasons.some((s) =>
    fs.existsSync(path.join(opts.rawDir, String(s))),
  );
  if (!haveAny) {
    // eslint-disable-next-line no-console
    console.log(
      `note: no raw season folders found under ${opts.rawDir}. Drop nflverse CSVs there (per --help) and re-run.`,
    );
  }
  const bundle = loadAndNormalizeRaw({
    seasons: args.seasons,
    rawDir: opts.rawDir,
  });
  // eslint-disable-next-line no-console
  console.log(
    `normalized: ${bundle.games.length} games, ${bundle.playerWeekStats.length} player-weeks, ${bundle.teamWeekStats.length} team-weeks, ${bundle.rosters.length} roster entries, ${bundle.snapCounts?.length ?? 0} snap rows`,
  );
  if (args.dryRun) {
    // eslint-disable-next-line no-console
    console.log("dry-run — not writing processed files. Use --no-dry-run to commit.");
    return 0;
  }
  const result = writeProcessed({
    bundle,
    processedDir: opts.processedDir,
  });
  // eslint-disable-next-line no-console
  console.log("written:");
  for (const f of result.written) console.log(`  ${f}`);
  for (const s of result.skipped) console.log(`  skipped: ${s}`);
  return 0;
}

main().then((code) => process.exit(code));
