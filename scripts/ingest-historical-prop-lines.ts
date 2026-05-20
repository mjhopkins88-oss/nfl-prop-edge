/**
 * ingest-historical-prop-lines.ts
 *
 * Pull one pregame historical snapshot of selected player-prop markets
 * for each 2025 NFL game and write normalized PropMarket + PropQuote
 * CSVs that the Prisma loader can consume.
 *
 * Usage:
 *   # See the plan + estimated credits without calling the API
 *   ODDS_API_KEY=*** npx tsx scripts/ingest-historical-prop-lines.ts \
 *       --season 2025 --weeks 1-10 --dry-run
 *
 *   # Real run (consumes credits). Default source: data/processed/games.csv.
 *   ODDS_API_KEY=*** npx tsx scripts/ingest-historical-prop-lines.ts \
 *       --season 2025 --weeks 1-10 --budget 200
 *
 *   # Pull games from the database (after `npm run db:seed`):
 *   ODDS_API_KEY=*** npx tsx scripts/ingest-historical-prop-lines.ts \
 *       --season 2025 --weeks 1-10 --source db --budget 200
 *
 *   # Demo mode — read games from the mock data instead:
 *   npx tsx scripts/ingest-historical-prop-lines.ts \
 *       --season 2025 --weeks 1-10 --source mock --dry-run
 *
 * Outputs:
 *   data/raw/odds-api/<snapshotISO>-events.json       (one per snapshot)
 *   data/raw/odds-api/<snapshotISO>-<eventId>-odds.json
 *   data/processed/prop_markets.csv                   (overwritten)
 *   data/processed/prop_quotes.csv                    (overwritten)
 *
 * Safeguards (enforced before any HTTP call):
 *   - Max 7 markets per request (cap in odds-api client).
 *   - regions=us only.
 *   - One snapshot per game (3.5h before kickoff, rounded down to
 *     the 5-minute grid).
 *   - Estimated credits computed up-front and the run aborts if it
 *     exceeds --budget.
 *
 * The script never logs the API key — `maskApiKey` is applied to every
 * URL written to stdout or to disk.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  ALLOW_REAL_ODDS_API_CALLS,
  ALLOWED_ODDS_REGIONS,
  MAX_ODDS_API_CREDITS_PER_RUN,
} from "../src/config/api-budget";
import {
  MAX_MARKETS_PER_REQUEST,
  NFL_TEAM_NAMES_BY_ABBR,
  ODDS_API_BASE_URL,
  SUPPORTED_MARKETS,
  SUPPORTED_REGION,
  buildEventOddsUrl,
  buildEventsUrl,
  computeSnapshotTime,
  estimateCredits,
  getHistoricalEventOdds,
  listHistoricalEvents,
  maskApiKey,
  normalizeEventOdds,
  type NormalizedPropMarket,
  type NormalizedPropQuote,
  type OddsApiEvent,
} from "../src/lib/ingestion/odds-api";
import { validateCreditBudget } from "../src/lib/ingestion/credit-estimator";

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
  out: string;
  budget: number;
  hoursBefore: number;
  dryRun: boolean;
}

// --- tiny utilities ---------------------------------------------------

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

function readJSON<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function writeJSON(p: string, value: unknown): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
}

/** Tiny CSV reader (handles quoted fields, no embedded newlines). */
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
  // Default to dry-run. The script REQUIRES --execute (and the
  // ALLOW_REAL_ODDS_API_CALLS env var) to spend credits.
  const args: Partial<CliArgs> & { weeksSpec?: string } = {
    source: "csv",
    input: "data/processed/games.csv",
    out: "data",
    budget: MAX_ODDS_API_CREDITS_PER_RUN,
    hoursBefore: 3.5,
    dryRun: true,
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
          throw new Error(`--source must be one of csv|db|mock`);
        }
        break;
      case "--input":
        args.input = eatValue();
        break;
      case "--out":
        args.out = eatValue();
        break;
      case "--budget":
        args.budget = Number(eatValue());
        break;
      case "--hours-before":
        args.hoursBefore = Number(eatValue());
        break;
      case "--dry-run":
        args.dryRun = true; // already the default; supported for explicitness
        break;
      case "--execute":
        args.dryRun = false;
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
  npx tsx scripts/ingest-historical-prop-lines.ts --season YYYY [options]

Options:
  --season N            (required) NFL season year
  --weeks SPEC          comma/dash list, e.g. "1-10,12"
  --source csv|db|mock  where to load games from (default: csv)
  --input PATH          path to games.csv when --source=csv (default: data/processed/games.csv)
  --out DIR             root output dir (default: data)
  --budget N            max estimated credits before aborting (default: 200)
  --hours-before N      hours before kickoff for snapshot (default: 3.5)
  --dry-run             plan + URLs, no API calls (this is the default)
  --execute             actually call the API (also requires
                        ALLOW_REAL_ODDS_API_CALLS=true in env)

Env:
  ODDS_API_KEY                  required for --execute
  ODDS_API_BASE_URL             override base URL (default: ${ODDS_API_BASE_URL})
  ALLOW_REAL_ODDS_API_CALLS     master kill-switch; must be "true" to --execute
`);
}

// --- game loaders -----------------------------------------------------

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

// --- planning ---------------------------------------------------------

interface SnapshotGroup {
  snapshotISO: string;
  games: GameRow[];
}

function groupBySnapshot(games: GameRow[], hoursBefore: number): SnapshotGroup[] {
  const map = new Map<string, GameRow[]>();
  for (const g of games) {
    const snap = computeSnapshotTime(g.kickoffISO, hoursBefore);
    const existing = map.get(snap) ?? [];
    existing.push(g);
    map.set(snap, existing);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([snapshotISO, games]) => ({ snapshotISO, games }));
}

function matchEvent(
  events: OddsApiEvent[],
  game: GameRow,
): OddsApiEvent | undefined {
  const homeFull = NFL_TEAM_NAMES_BY_ABBR[game.homeTeamAbbr];
  const awayFull = NFL_TEAM_NAMES_BY_ABBR[game.awayTeamAbbr];
  if (!homeFull || !awayFull) return undefined;
  return events.find(
    (e) => e.home_team === homeFull && e.away_team === awayFull,
  );
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
    `Season=${args.season} weeks=${args.weeks ? Array.from(args.weeks).sort((a, b) => a - b).join(",") : "ALL"} source=${args.source} budget=${args.budget} dryRun=${args.dryRun}`,
  );

  // --- safeguards
  if (SUPPORTED_MARKETS.length > MAX_MARKETS_PER_REQUEST) {
    log(
      "error",
      `SUPPORTED_MARKETS (${SUPPORTED_MARKETS.length}) exceeds MAX_MARKETS_PER_REQUEST (${MAX_MARKETS_PER_REQUEST}).`,
    );
    return 1;
  }

  const apiKey = process.env.ODDS_API_KEY;
  if (!args.dryRun && !apiKey) {
    log(
      "error",
      "ODDS_API_KEY env var is required for --execute mode. Omit --execute to see the plan, or set the env var.",
    );
    return 2;
  }
  if (!args.dryRun && !ALLOW_REAL_ODDS_API_CALLS) {
    log(
      "error",
      "ABORT: --execute was passed but ALLOW_REAL_ODDS_API_CALLS env var is not 'true'. " +
        "This is the master kill-switch for paid Odds-API calls (see src/config/api-budget.ts). " +
        "Re-run without --execute to dry-run, or set ALLOW_REAL_ODDS_API_CALLS=true to spend credits.",
    );
    return 2;
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
  if (games.length === 0) {
    return 0;
  }

  // --- group by snapshot, build the plan
  const snapshots = groupBySnapshot(games, args.hoursBefore);
  const plan = estimateCredits({
    uniqueSnapshots: snapshots.length,
    totalEvents: games.length,
    marketsPerEvent: SUPPORTED_MARKETS.length,
  });

  // Planned request count = one /events per unique snapshot + one
  // /events/{id}/odds per game.
  const plannedRequestCount = snapshots.length + games.length;

  log(
    "info",
    `Plan: ${games.length} games across ${snapshots.length} unique snapshots × ${plan.marketsPerEvent} markets (region=${SUPPORTED_REGION}).`,
  );
  log(
    "info",
    `Planned HTTP requests: ${plannedRequestCount} (${snapshots.length} events-list + ${games.length} per-event odds).`,
  );
  log(
    "info",
    `Estimated credits: ${plan.estimatedCredits} (snapshots=${plan.uniqueSnapshots}, events=${plan.totalEvents}). Budget: ${args.budget}.`,
  );

  // Hard policy check from src/config/api-budget.ts.
  const validation = validateCreditBudget({
    markets: SUPPORTED_MARKETS.length,
    regions: [...ALLOWED_ODDS_REGIONS],
    estimatedCredits: plan.estimatedCredits,
  });
  if (!validation.ok) {
    log(
      "error",
      `ABORT: budget policy violated. ${validation.reasons.join("; ")}`,
    );
    return 3;
  }
  if (plan.estimatedCredits > args.budget) {
    log(
      "error",
      `ABORT: estimated ${plan.estimatedCredits} credits exceeds --budget ${args.budget}. Pass --budget ${plan.estimatedCredits} or narrow --weeks.`,
    );
    return 3;
  }

  // --- dry-run: print URLs (api key masked) and exit
  if (args.dryRun) {
    const keyForUrl = apiKey ?? "DRY_RUN_PLACEHOLDER";
    for (const group of snapshots) {
      const eventsUrl = buildEventsUrl({
        apiKey: keyForUrl,
        snapshotISO: group.snapshotISO,
      });
      log("info", `[dry] events  snap=${group.snapshotISO}  url=${maskApiKey(eventsUrl)}`);
      for (const g of group.games) {
        const oddsUrl = buildEventOddsUrl({
          apiKey: keyForUrl,
          eventId: `<EVENT_FOR_${g.awayTeamAbbr}_AT_${g.homeTeamAbbr}>`,
          snapshotISO: group.snapshotISO,
          markets: SUPPORTED_MARKETS,
        });
        log("info", `[dry] odds   game=${g.gameId}  url=${maskApiKey(oddsUrl)}`);
      }
    }
    log(
      "info",
      `Dry-run complete. Estimated credits: ${plan.estimatedCredits} (budget ${args.budget}).`,
    );
    return 0;
  }

  // --- live mode
  const rawRoot = path.join(args.out, "raw", "odds-api");
  const processedRoot = path.join(args.out, "processed");
  ensureDir(rawRoot);
  ensureDir(processedRoot);

  const allMarkets: NormalizedPropMarket[] = [];
  const allQuotes: NormalizedPropQuote[] = [];
  let creditsUsed = 0;

  for (const group of snapshots) {
    log("info", `Snapshot ${group.snapshotISO}: fetching events list (${group.games.length} games target)`);
    const eventsResp = await listHistoricalEvents({
      apiKey: apiKey!,
      snapshotISO: group.snapshotISO,
    });
    creditsUsed += 1; // events list per snapshot
    writeJSON(
      path.join(rawRoot, `${safeName(group.snapshotISO)}-events.json`),
      eventsResp,
    );

    for (const game of group.games) {
      const event = matchEvent(eventsResp.data, game);
      if (!event) {
        log(
          "warn",
          `No matching event in snapshot ${group.snapshotISO} for ${game.awayTeamAbbr}@${game.homeTeamAbbr} (${game.gameId}). Skipping.`,
        );
        continue;
      }
      log(
        "info",
        `  ${game.awayTeamAbbr}@${game.homeTeamAbbr}  event=${event.id}  fetching odds for ${SUPPORTED_MARKETS.length} markets`,
      );
      const oddsResp = await getHistoricalEventOdds({
        apiKey: apiKey!,
        eventId: event.id,
        snapshotISO: group.snapshotISO,
        markets: SUPPORTED_MARKETS,
      });
      creditsUsed += SUPPORTED_MARKETS.length; // 1 per market per region; region=1
      writeJSON(
        path.join(
          rawRoot,
          `${safeName(group.snapshotISO)}-${event.id}-odds.json`,
        ),
        oddsResp,
      );

      const norm = normalizeEventOdds(oddsResp.data, {
        gameId: game.gameId,
        snapshotISO: group.snapshotISO,
      });
      allMarkets.push(...norm.markets);
      allQuotes.push(...norm.quotes);
    }
  }

  const marketsPath = path.join(processedRoot, "prop_markets.csv");
  const quotesPath = path.join(processedRoot, "prop_quotes.csv");

  const nMarkets = writeCsv(
    marketsPath,
    [
      "market_key",
      "game_id",
      "event_id",
      "player_name",
      "prop_type",
      "line",
      "source",
      "snapshot_time",
    ],
    allMarkets as unknown as Record<string, unknown>[],
  );
  const nQuotes = writeCsv(
    quotesPath,
    [
      "market_key",
      "book_name",
      "over_price",
      "under_price",
      "over_implied_probability",
      "under_implied_probability",
      "no_vig_over_probability",
      "no_vig_under_probability",
      "quote_time",
    ],
    allQuotes as unknown as Record<string, unknown>[],
  );

  log("info", `Wrote ${marketsPath} (${nMarkets} rows)`);
  log("info", `Wrote ${quotesPath} (${nQuotes} rows)`);
  log(
    "info",
    `Done. Credits used (estimated): ${creditsUsed} / budget ${args.budget}.`,
  );
  return 0;
}

function safeName(iso: string): string {
  return iso.replace(/[:]/g, "-");
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    log("error", (err as Error).stack ?? String(err));
    process.exit(1);
  },
);
