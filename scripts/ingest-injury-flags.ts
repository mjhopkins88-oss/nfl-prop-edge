/**
 * ingest-injury-flags.ts
 *
 * Reads the manual `data/manual/injury_flags.csv`, validates it through
 * `src/lib/ingestion/injuries.ts` (warning on rows with unknown status
 * / impact values), and emits the same schema to
 * `data/processed/injury_flags.csv`. The processed copy becomes the
 * canonical input for the Prisma loader and the backtest's injury
 * context.
 *
 * No external APIs. No paid surface. Idempotent — re-running rewrites
 * the processed file.
 *
 * Usage:
 *   npx tsx scripts/ingest-injury-flags.ts
 *   npx tsx scripts/ingest-injury-flags.ts --input data/manual/injury_flags.csv --out data
 *   npx tsx scripts/ingest-injury-flags.ts --dry-run
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadInjuryFlags } from "../src/lib/ingestion/injuries";

// --- CLI -------------------------------------------------------------

interface CliArgs {
  input: string;
  out: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: "data/manual/injury_flags.csv",
    out: "data",
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
      case "--input":
        args.input = eat();
        break;
      case "--out":
        args.out = eat();
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
  return args;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  npx tsx scripts/ingest-injury-flags.ts [options]

Options:
  --input PATH   manual CSV (default: data/manual/injury_flags.csv)
  --out DIR      root output dir (default: data)
  --dry-run      validate and report counts; write schema-only CSV
`);
}

function log(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console[level === "warn" ? "warn" : level === "error" ? "error" : "log"](
    `${ts} ${level.toUpperCase()} ${msg}`,
  );
}

// --- CSV writer (stdlib-only) ----------------------------------------

const COLUMNS = [
  "season",
  "week",
  "gameId",
  "team",
  "playerName",
  "position",
  "status",
  "injuryImpact",
  "roleImpact",
  "notes",
];

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(p: string, rows: Record<string, unknown>[]): number {
  ensureDir(path.dirname(p));
  const lines: string[] = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((c) => escapeCsv(row[c])).join(","));
  }
  fs.writeFileSync(p, lines.join("\n") + "\n");
  return rows.length;
}

// --- main flow -------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    log("error", (err as Error).message);
    printHelp();
    return 2;
  }

  log("info", `input=${args.input} out=${args.out} dryRun=${args.dryRun}`);

  if (!fs.existsSync(args.input)) {
    log("error", `manual injuries CSV not found at ${args.input}`);
    return 1;
  }

  // `loadInjuryFlags` already warns + skips rows with unknown enum
  // values. We just take what comes back and re-emit.
  const flags = loadInjuryFlags(args.input);
  log("info", `loaded ${flags.length} valid injury flags`);

  const outPath = path.join(args.out, "processed", "injury_flags.csv");

  if (args.dryRun) {
    ensureDir(path.dirname(outPath));
    writeCsv(outPath, []);
    log(
      "info",
      `[dry] wrote schema-only ${outPath} (${COLUMNS.length} cols). Re-run without --dry-run to emit ${flags.length} rows.`,
    );
    return 0;
  }

  const rows: Record<string, unknown>[] = flags.map((f) => ({
    season: f.season,
    week: f.week,
    gameId: f.gameId,
    team: f.team,
    playerName: f.playerName,
    position: f.position,
    status: f.status,
    injuryImpact: f.injuryImpact,
    roleImpact: f.roleImpact,
    notes: f.notes,
  }));

  const n = writeCsv(outPath, rows);
  log("info", `wrote ${outPath} (${n} rows)`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    log("error", (err as Error).stack ?? String(err));
    process.exit(1);
  },
);
