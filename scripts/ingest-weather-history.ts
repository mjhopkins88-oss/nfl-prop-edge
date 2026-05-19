/**
 * ingest-weather-history.ts
 *
 * For each 2025 NFL game, look up its home stadium in
 * `data/manual/stadiums.csv`, decide whether the game is weather-
 * impact-eligible (based on roof type), and — if so — pull one hour of
 * historical weather from Open-Meteo near kickoff. Emit a single
 * normalized snapshot row per game.
 *
 * Usage:
 *   # dry-run — prints request URLs, no API calls
 *   npx tsx scripts/ingest-weather-history.ts \
 *       --season 2025 --weeks 1-10 --source mock --dry-run
 *
 *   # live run (default source: data/processed/games.csv)
 *   npx tsx scripts/ingest-weather-history.ts --season 2025 --weeks 1-10
 *
 *   # live run from the database
 *   npx tsx scripts/ingest-weather-history.ts --season 2025 --weeks 1-10 --source db
 *
 * Outputs:
 *   data/raw/weather/<team>-<date>.json       (one per outdoor game)
 *   data/processed/weather_snapshots.csv       (overwritten)
 *
 * Open-Meteo has no API key and no auth — `OPEN_METEO_BASE_URL` is the
 * only env knob and only needs setting if you're proxying.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildArchiveUrl,
  buildIneligibleSnapshot,
  fetchArchive,
  isWeatherImpactEligible,
  normalizeWeatherSnapshot,
  utcDateString,
  type NormalizedWeatherSnapshot,
  type RoofType,
  type Stadium,
} from "../src/lib/ingestion/weather";

// --- types ------------------------------------------------------------

interface GameRow {
  gameId: string;
  season: number;
  week: number;
  kickoffISO: string;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
}

type SourceKind = "csv" | "db" | "mock";

interface CliArgs {
  season: number;
  weeks?: Set<number>;
  source: SourceKind;
  input: string;
  stadiums: string;
  out: string;
  dryRun: boolean;
}

// --- utilities --------------------------------------------------------

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

function writeJSON(p: string, value: unknown): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
}

function parseCsv(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"' && cur === "") {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(p: string, columns: string[], rows: Record<string, unknown>[]): number {
  ensureDir(path.dirname(p));
  const lines: string[] = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsv(row[c])).join(","));
  }
  fs.writeFileSync(p, lines.join("\n") + "\n");
  return rows.length;
}

// --- CLI parser -------------------------------------------------------

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> & { weeksSpec?: string } = {
    source: "csv",
    input: "data/processed/games.csv",
    stadiums: "data/manual/stadiums.csv",
    out: "data",
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eatValue = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--season":
        args.season = Number(eatValue());
        break;
      case "--weeks":
        args.weeksSpec = eatValue();
        break;
      case "--source":
        args.source = eatValue() as SourceKind;
        if (!["csv", "db", "mock"].includes(args.source)) {
          throw new Error("--source must be one of csv|db|mock");
        }
        break;
      case "--input":
        args.input = eatValue();
        break;
      case "--stadiums":
        args.stadiums = eatValue();
        break;
      case "--out":
        args.out = eatValue();
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
  if (args.season === undefined) {
    throw new Error("--season is required");
  }
  const weeks = args.weeksSpec ? parseWeeks(args.weeksSpec) : undefined;
  return { ...(args as Required<Omit<CliArgs, "weeks">>), weeks };
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

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  npx tsx scripts/ingest-weather-history.ts --season YYYY [options]

Options:
  --season N            (required) NFL season year
  --weeks SPEC          comma/dash list, e.g. "1-10,12"
  --source csv|db|mock  where to load games from (default: csv)
  --input PATH          games.csv when --source=csv (default: data/processed/games.csv)
  --stadiums PATH       stadium master CSV (default: data/manual/stadiums.csv)
  --out DIR             root output dir (default: data)
  --dry-run             print URLs without calling Open-Meteo

Env:
  OPEN_METEO_BASE_URL   override the API base URL (default: archive-api.open-meteo.com)
`);
}

// --- loaders ----------------------------------------------------------

function loadStadiums(p: string): Map<string, Stadium> {
  if (!fs.existsSync(p)) {
    throw new Error(`stadium CSV not found at ${p}`);
  }
  const rows = parseCsv(fs.readFileSync(p, "utf8"));
  const byTeam = new Map<string, Stadium>();
  for (const row of rows) {
    const roof = row.roofType as RoofType;
    if (!["outdoor", "dome", "retractable"].includes(roof)) {
      log("warn", `unknown roofType "${row.roofType}" for team=${row.team}; treating as outdoor`);
    }
    byTeam.set(row.team, {
      stadiumName: row.stadiumName,
      team: row.team,
      city: row.city,
      state: row.state,
      latitude: Number(row.latitude),
      longitude: Number(row.longitude),
      roofType: roof,
      surface: row.surface,
    });
  }
  return byTeam;
}

async function loadGames(args: CliArgs): Promise<GameRow[]> {
  switch (args.source) {
    case "csv":
      return loadGamesFromCsv(args.input, args.season, args.weeks);
    case "db":
      return loadGamesFromDb(args.season, args.weeks);
    case "mock":
      return loadGamesFromMock(args.season, args.weeks);
  }
}

function loadGamesFromCsv(
  filePath: string,
  season: number,
  weeks: Set<number> | undefined,
): GameRow[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `${filePath} not found. Run scripts/ingest-nfl-history.py to populate it, or pass --source db / --source mock.`,
    );
  }
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (rows.length === 0) {
    log(
      "warn",
      `${filePath} has 0 data rows. Populate it with scripts/ingest-nfl-history.py or use --source db / --source mock.`,
    );
    return [];
  }
  return rows
    .filter((r) => Number(r.season) === season)
    .filter((r) => !weeks || weeks.has(Number(r.week)))
    .map<GameRow>((r) => ({
      gameId: r.game_id,
      season: Number(r.season),
      week: Number(r.week),
      kickoffISO: r.kickoff_utc,
      homeTeamAbbr: r.home_team,
      awayTeamAbbr: r.away_team,
    }));
}

async function loadGamesFromDb(
  season: number,
  weeks: Set<number> | undefined,
): Promise<GameRow[]> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const games = await prisma.game.findMany({
      where: {
        season,
        ...(weeks ? { week: { in: Array.from(weeks) } } : {}),
      },
      include: { homeTeam: true, awayTeam: true },
      orderBy: { kickoff: "asc" },
    });
    return games.map<GameRow>((g) => ({
      gameId: g.id,
      season: g.season,
      week: g.week,
      kickoffISO: g.kickoff.toISOString(),
      homeTeamAbbr: g.homeTeam.abbreviation,
      awayTeamAbbr: g.awayTeam.abbreviation,
    }));
  } finally {
    await prisma.$disconnect();
  }
}

async function loadGamesFromMock(
  season: number,
  weeks: Set<number> | undefined,
): Promise<GameRow[]> {
  const mod = await import("../src/lib/mock-data");
  return mod.games
    .filter((g) => g.season === season)
    .filter((g) => !weeks || weeks.has(g.week))
    .map<GameRow>((g) => ({
      gameId: g.id,
      season: g.season,
      week: g.week,
      kickoffISO: g.kickoff,
      homeTeamAbbr: g.homeTeamAbbr,
      awayTeamAbbr: g.awayTeamAbbr,
    }));
}

// --- main flow --------------------------------------------------------

const SNAPSHOT_COLUMNS = [
  "gameId",
  "team",
  "stadiumName",
  "roofType",
  "kickoffUtc",
  "snapshotUtc",
  "weatherImpactEligible",
  "temperature",
  "windSpeed",
  "windGust",
  "precipitation",
  "snowfall",
  "weatherCode",
];

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
    `Season=${args.season} weeks=${args.weeks ? Array.from(args.weeks).sort((a, b) => a - b).join(",") : "ALL"} source=${args.source} dryRun=${args.dryRun}`,
  );

  // --- load stadium master
  let stadiums: Map<string, Stadium>;
  try {
    stadiums = loadStadiums(args.stadiums);
    log("info", `Loaded ${stadiums.size} stadiums from ${args.stadiums}`);
  } catch (err) {
    log("error", (err as Error).message);
    return 1;
  }

  // --- load games
  let games: GameRow[];
  try {
    games = await loadGames(args);
  } catch (err) {
    log("error", (err as Error).message);
    return 1;
  }
  log("info", `Loaded ${games.length} games`);
  if (games.length === 0) return 0;

  // --- classify games up-front
  const ineligible: { game: GameRow; stadium: Stadium }[] = [];
  const eligible: { game: GameRow; stadium: Stadium }[] = [];
  const missing: GameRow[] = [];

  for (const g of games) {
    const stadium = stadiums.get(g.homeTeamAbbr);
    if (!stadium) {
      missing.push(g);
      continue;
    }
    if (isWeatherImpactEligible(stadium.roofType)) {
      eligible.push({ game: g, stadium });
    } else {
      ineligible.push({ game: g, stadium });
    }
  }

  log(
    "info",
    `Plan: ${eligible.length} fetches (outdoor/retractable) · ${ineligible.length} dome/closed (skipped) · ${missing.length} missing stadium`,
  );
  for (const g of missing) {
    log(
      "warn",
      `no stadium row for home team "${g.homeTeamAbbr}" (game ${g.gameId}); skipping`,
    );
  }

  // --- dry-run: print URLs and exit
  if (args.dryRun) {
    for (const { game, stadium } of eligible) {
      const date = utcDateString(game.kickoffISO);
      const url = buildArchiveUrl({
        latitude: stadium.latitude,
        longitude: stadium.longitude,
        startDate: date,
        endDate: date,
      });
      log(
        "info",
        `[dry] game=${game.gameId}  stadium=${stadium.stadiumName}  kickoff=${game.kickoffISO}  url=${url}`,
      );
    }
    log(
      "info",
      `Dry-run complete. ${eligible.length} would fetch, ${ineligible.length} skipped (dome/closed).`,
    );
    return 0;
  }

  // --- live mode
  const rawRoot = path.join(args.out, "raw", "weather");
  const processedRoot = path.join(args.out, "processed");
  ensureDir(rawRoot);
  ensureDir(processedRoot);

  const snapshots: NormalizedWeatherSnapshot[] = [];

  // ineligible rows still appear in the output for join completeness
  for (const { game, stadium } of ineligible) {
    snapshots.push(
      buildIneligibleSnapshot({
        gameId: game.gameId,
        kickoffISO: game.kickoffISO,
        stadium,
      }),
    );
  }

  let fetchedOk = 0;
  let fetchedErr = 0;
  for (const { game, stadium } of eligible) {
    const date = utcDateString(game.kickoffISO);
    try {
      const resp = await fetchArchive({
        latitude: stadium.latitude,
        longitude: stadium.longitude,
        startDate: date,
        endDate: date,
      });
      writeJSON(
        path.join(rawRoot, `${stadium.team}-${date}-${safeName(game.gameId)}.json`),
        resp,
      );
      const snap = normalizeWeatherSnapshot(resp, {
        gameId: game.gameId,
        kickoffISO: game.kickoffISO,
        stadium,
      });
      snapshots.push(snap);
      fetchedOk++;
      log(
        "info",
        `  ${game.gameId} @ ${stadium.team}  T=${fmt(snap.temperature)}°F  wind=${fmt(snap.windSpeed)}mph  precip=${fmt(snap.precipitation)}in  code=${snap.weatherCode ?? "-"}`,
      );
    } catch (err) {
      fetchedErr++;
      log(
        "warn",
        `fetch failed for ${game.gameId} @ ${stadium.team}: ${(err as Error).message}`,
      );
    }
  }

  const outPath = path.join(processedRoot, "weather_snapshots.csv");
  const n = writeCsv(
    outPath,
    SNAPSHOT_COLUMNS,
    snapshots as unknown as Record<string, unknown>[],
  );
  log(
    "info",
    `Wrote ${outPath} (${n} rows: ${eligible.length - fetchedErr} fetched, ${ineligible.length} dome/closed, ${fetchedErr} fetch errors)`,
  );
  return fetchedErr > 0 ? 4 : 0;
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function fmt(v: number | null): string {
  return v == null ? "-" : v.toFixed(1);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    log("error", (err as Error).stack ?? String(err));
    process.exit(1);
  },
);
