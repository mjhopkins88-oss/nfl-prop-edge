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
import { createHash } from "node:crypto";
import {
  ALLOW_REAL_ODDS_API_CALLS,
  ALLOWED_ODDS_REGIONS,
  CREDIT_OVERAGE_ABORT_RATIO,
  MAX_ODDS_API_CREDITS_PER_RUN,
  MIN_ODDS_API_CREDITS_REMAINING,
  SMOKE_CALIBRATION_MAX_CREDITS,
  SMOKE_CALIBRATION_MAX_ODDS_REQUESTS,
  V1_INGESTION_MARKETS,
  type V1IngestionMarket,
} from "../src/config/api-budget";
import {
  MAX_MARKETS_PER_REQUEST,
  NFL_TEAM_NAMES_BY_ABBR,
  ODDS_API_BASE_URL,
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
  type OddsApiMarketKey,
  type OddsApiUsage,
} from "../src/lib/ingestion/odds-api";
import { validateCreditBudget } from "../src/lib/ingestion/credit-estimator";
import {
  buildCanonicalOddsRows,
  writeCanonicalOddsCsv,
} from "../src/lib/ingestion/canonical-odds-writer";
import { parseCsvRows } from "../src/lib/ingestion/nflverse";

function parseCanonRosters(
  text: string,
): { playerName: string; team: string; season: number }[] {
  return parseCsvRows(text)
    .filter((r) => r.playerName && r.team && r.season)
    .map((r) => ({
      playerName: r.playerName,
      team: r.team,
      season: Number(r.season),
    }))
    .filter((r) => Number.isFinite(r.season));
}
import {
  buildCacheKey,
  getCachedResponse,
  hasCachedResponse,
  saveCachedResponse,
} from "../src/lib/ingestion/cache";

/** V1 ingestion runs use only the 4 lower-variance volume markets. */
const INGESTION_MARKETS: readonly V1IngestionMarket[] = V1_INGESTION_MARKETS;

type ScopeKind =
  | "smoke-test"
  | "week"
  | "four-weeks"
  | "half-season"
  | "full-season";

const SCOPE_VALUES: ScopeKind[] = [
  "smoke-test",
  "week",
  "four-weeks",
  "half-season",
  "full-season",
];

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
  scope?: ScopeKind;
  source: SourceKind;
  input: string;
  out: string;
  budget: number;
  hoursBefore: number;
  dryRun: boolean;
  /** When true, run the smallest paid sample: 1 events-list + 1
   *  event-odds call, then stop. Caps budget at
   *  SMOKE_CALIBRATION_MAX_CREDITS unless --budget overrides. */
  calibration: boolean;
  /** Hard cap on event-odds requests this run will make. */
  maxOddsRequests?: number;
  /** Hard cap on credits (defaults to budget). Pre-call guard:
   *  the run refuses to fire a request whose projected cumulative
   *  cost would push past this number. */
  maxCredits?: number;
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

/** Column contract for `data/processed/prop_markets.csv`. */
const PROP_MARKETS_COLUMNS = [
  "market_key",
  "game_id",
  "event_id",
  "player_name",
  "prop_type",
  "line",
  "source",
  "snapshot_time",
];

/** Column contract for `data/processed/prop_quotes.csv`. */
const PROP_QUOTES_COLUMNS = [
  "market_key",
  "book_name",
  "over_price",
  "under_price",
  "over_implied_probability",
  "under_implied_probability",
  "no_vig_over_probability",
  "no_vig_under_probability",
  "quote_time",
];

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
  const args: Partial<CliArgs> & {
    weeksSpec?: string;
    singleWeek?: number;
    startWeek?: number;
    endWeek?: number;
  } = {
    source: "csv",
    input: "data/processed/games.csv",
    out: "data",
    budget: MAX_ODDS_API_CREDITS_PER_RUN,
    hoursBefore: 3.5,
    dryRun: true,
    calibration: false,
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
      case "--scope": {
        const raw = eatValue();
        if (!SCOPE_VALUES.includes(raw as ScopeKind)) {
          throw new Error(
            `--scope must be one of ${SCOPE_VALUES.join("|")} (got "${raw}")`,
          );
        }
        args.scope = raw as ScopeKind;
        break;
      }
      case "--week":
        args.singleWeek = Number(eatValue());
        break;
      case "--start-week":
        args.startWeek = Number(eatValue());
        break;
      case "--end-week":
        args.endWeek = Number(eatValue());
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
      case "--calibration":
        args.calibration = true;
        break;
      case "--max-odds-requests":
        args.maxOddsRequests = Number(eatValue());
        break;
      case "--max-credits":
        args.maxCredits = Number(eatValue());
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
  // Calibration mode is the smallest paid sample we'll ever run.
  // It pins scope=smoke-test, caps odds requests to 1, and lowers
  // the credit ceiling unless the caller asked for a different
  // explicit budget/cap. The 50-credit cap exists so a wrong
  // estimate can never overspend.
  if (args.calibration) {
    if (args.scope === undefined) args.scope = "smoke-test";
    if (args.maxOddsRequests === undefined) {
      args.maxOddsRequests = SMOKE_CALIBRATION_MAX_ODDS_REQUESTS;
    }
    if (args.maxCredits === undefined) {
      args.maxCredits = SMOKE_CALIBRATION_MAX_CREDITS;
    }
    if (args.budget === MAX_ODDS_API_CREDITS_PER_RUN) {
      // Caller didn't override --budget; align it to the cap.
      args.budget = SMOKE_CALIBRATION_MAX_CREDITS;
    }
  }
  const weeks = resolveWeeks({
    weeksSpec: args.weeksSpec,
    scope: args.scope,
    singleWeek: args.singleWeek,
    startWeek: args.startWeek,
    endWeek: args.endWeek,
  });
  return {
    ...(args as Required<Omit<CliArgs, "weeks" | "scope">>),
    scope: args.scope,
    weeks,
  };
}

function resolveWeeks(opts: {
  weeksSpec?: string;
  scope?: ScopeKind;
  singleWeek?: number;
  startWeek?: number;
  endWeek?: number;
}): Set<number> | undefined {
  // Explicit --weeks wins outright (most precise).
  if (opts.weeksSpec) return parseWeeks(opts.weeksSpec);
  // --week N is shorthand for --weeks N.
  if (opts.singleWeek !== undefined) return new Set([opts.singleWeek]);
  // --start-week / --end-week describe a closed range.
  if (opts.startWeek !== undefined || opts.endWeek !== undefined) {
    const lo = opts.startWeek ?? 1;
    const hi = opts.endWeek ?? 18;
    const set = new Set<number>();
    for (let w = lo; w <= hi; w++) set.add(w);
    return set;
  }
  // --scope is the convenience flag — preselects a range.
  if (opts.scope) return resolveScope(opts.scope);
  return undefined;
}

function resolveScope(scope: ScopeKind): Set<number> {
  switch (scope) {
    case "smoke-test":
      // Just week 1; combined with the runner's per-snapshot grouping
      // this is the single cheapest meaningful exercise of the pipeline.
      return new Set([1]);
    case "week":
      // Default to opening week if --week was not also passed.
      return new Set([1]);
    case "four-weeks":
      return new Set([1, 2, 3, 4]);
    case "half-season":
      return new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    case "full-season":
      return new Set(
        Array.from({ length: 18 }, (_, i) => i + 1),
      );
  }
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

Scope (one of, presets a week range):
  --scope smoke-test    week 1 only (cheapest meaningful run)
  --scope week          one week (use --week N to pick which; default 1)
  --scope four-weeks    weeks 1-4
  --scope half-season   weeks 1-9
  --scope full-season   weeks 1-18

Week selection (any one of, overrides --scope):
  --weeks SPEC          comma/dash list, e.g. "1-10,12"
  --week N              single week shorthand
  --start-week N        inclusive lower bound
  --end-week N          inclusive upper bound

Data source / output:
  --source csv|db|mock  where to load games from (default: csv)
  --input PATH          path to games.csv when --source=csv (default: data/processed/games.csv)
  --out DIR             root output dir (default: data)

Cost controls:
  --budget N            max estimated credits before aborting (default: ${MAX_ODDS_API_CREDITS_PER_RUN})
  --hours-before N      hours before kickoff for snapshot (default: 3.5)

Mode:
  --dry-run             plan + URLs, no API calls (this is the default)
  --execute             actually call the API (also requires
                        ALLOW_REAL_ODDS_API_CALLS=true in env)

V1 markets pulled by this script (fixed): ${INGESTION_MARKETS.join(", ")}

Env:
  ODDS_API_KEY                  required for --execute
  ODDS_API_BASE_URL             override base URL (default: ${ODDS_API_BASE_URL})
  ALLOW_REAL_ODDS_API_CALLS     master kill-switch; must be "true" to --execute
  DATABASE_URL                  optional — Prisma ApiUsageLog rows written when set
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
      `${filePath} not found. Run scripts/ingest-nfl-history.ts (TypeScript) or scripts/ingest-nfl-history.py to populate it, or pass --source db / --source mock.`,
    );
  }
  const rows = parseCsv(fs.readFileSync(filePath, "utf8"));
  if (rows.length === 0) {
    log(
      "warn",
      `${filePath} has 0 data rows. Populate it with scripts/ingest-nfl-history.ts or use --source db / --source mock.`,
    );
    return [];
  }
  // Two schemas in the wild:
  //   - legacy Python script: game_id, season, week, kickoff_utc, home_team, away_team
  //   - TypeScript nflverse normalizer: gameId, season, week, startTimeUtc, homeTeam, awayTeam
  // Accept both. Skip rows without a parseable kickoff timestamp.
  const out: GameRow[] = [];
  let skippedMissingTime = 0;
  let skippedInvalidTime = 0;
  for (const r of rows) {
    if (Number(r.season) !== season) continue;
    if (weeks && !weeks.has(Number(r.week))) continue;
    const gameId = r.game_id || r.gameId;
    const kickoffISO = r.kickoff_utc || r.startTimeUtc;
    const homeTeam = r.home_team || r.homeTeam;
    const awayTeam = r.away_team || r.awayTeam;
    if (!gameId || !homeTeam || !awayTeam) continue;
    if (!kickoffISO) {
      skippedMissingTime += 1;
      continue;
    }
    const ts = Date.parse(kickoffISO);
    if (!Number.isFinite(ts)) {
      skippedInvalidTime += 1;
      continue;
    }
    out.push({
      gameId,
      season: Number(r.season),
      week: Number(r.week),
      kickoffISO: new Date(ts).toISOString(),
      homeTeamAbbr: homeTeam,
      awayTeamAbbr: awayTeam,
    });
  }
  if (skippedMissingTime > 0) {
    log("warn", `${filePath}: skipped ${skippedMissingTime} rows with no kickoff time`);
  }
  if (skippedInvalidTime > 0) {
    log("warn", `${filePath}: skipped ${skippedInvalidTime} rows with unparseable kickoff time`);
  }
  return out;
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

// --- cache pre-flight + cache-aware fetchers --------------------------

interface CacheReport {
  hits: number;
  eventsMisses: number;
  oddsMisses: number;
}

function eventsCacheKey(snapshotISO: string): string {
  return buildCacheKey({
    source: "odds-api",
    endpoint: "historical-events",
    params: { snapshotISO },
  });
}

function oddsCacheKey(
  eventId: string,
  snapshotISO: string,
  markets: readonly string[],
): string {
  return buildCacheKey({
    source: "odds-api",
    endpoint: "historical-event-odds",
    params: {
      eventId,
      snapshotISO,
      markets: [...markets].sort(),
      regions: "us",
    },
  });
}

/**
 * Walk the planned request list, count how many would already be served
 * from `data/cache/odds-api/`. Used to refine the summary block before
 * any paid call. The odds-level cache lookup needs an `eventId` — at
 * planning time we don't have it yet, so we under-count oddsMisses
 * (treat every game as a miss). The actual cache check on the live path
 * is what guarantees no double-spend.
 */
function inspectCacheCoverage(
  snapshots: SnapshotGroup[],
  games: GameRow[],
  _markets: readonly string[],
): CacheReport {
  let hits = 0;
  let eventsMisses = 0;
  for (const snap of snapshots) {
    if (hasCachedResponse(eventsCacheKey(snap.snapshotISO))) hits++;
    else eventsMisses++;
  }
  // Odds-level keys depend on the event id that comes back from the
  // events list, so we can't introspect them here without making the
  // call. Treat every game as a probable miss for budget purposes.
  const oddsMisses = games.length;
  return { hits, eventsMisses, oddsMisses };
}

interface CachedResult<T> {
  response: T;
  fromCache: boolean;
  url: string;
  status: number | null;
  usage?: OddsApiUsage;
}

async function fetchEventsCached(args: {
  apiKey: string;
  snapshotISO: string;
}): Promise<CachedResult<Awaited<ReturnType<typeof listHistoricalEvents>>>> {
  const url = buildEventsUrl({
    apiKey: args.apiKey,
    snapshotISO: args.snapshotISO,
  });
  const key = eventsCacheKey(args.snapshotISO);
  type R = Awaited<ReturnType<typeof listHistoricalEvents>>;
  if (hasCachedResponse(key)) {
    const cached = getCachedResponse<R>(key);
    if (cached) {
      return {
        response: cached,
        fromCache: true,
        url: maskApiKey(url),
        status: null,
      };
    }
  }
  const live = await listHistoricalEvents({
    apiKey: args.apiKey,
    snapshotISO: args.snapshotISO,
  });
  saveCachedResponse<R>(key, live, { url });
  return {
    response: live,
    fromCache: false,
    url: maskApiKey(url),
    status: 200,
    usage: live.usage,
  };
}

async function fetchOddsCached(args: {
  apiKey: string;
  eventId: string;
  snapshotISO: string;
  markets: readonly OddsApiMarketKey[];
}): Promise<CachedResult<Awaited<ReturnType<typeof getHistoricalEventOdds>>>> {
  const marketsArr: OddsApiMarketKey[] = [...args.markets];
  const url = buildEventOddsUrl({
    apiKey: args.apiKey,
    eventId: args.eventId,
    snapshotISO: args.snapshotISO,
    markets: marketsArr,
  });
  const key = oddsCacheKey(args.eventId, args.snapshotISO, args.markets);
  type R = Awaited<ReturnType<typeof getHistoricalEventOdds>>;
  if (hasCachedResponse(key)) {
    const cached = getCachedResponse<R>(key);
    if (cached) {
      return {
        response: cached,
        fromCache: true,
        url: maskApiKey(url),
        status: null,
      };
    }
  }
  const live = await getHistoricalEventOdds({
    apiKey: args.apiKey,
    eventId: args.eventId,
    snapshotISO: args.snapshotISO,
    markets: marketsArr,
  });
  saveCachedResponse<R>(key, live, { url });
  return {
    response: live,
    fromCache: false,
    url: maskApiKey(url),
    status: 200,
    usage: live.usage,
  };
}

// --- plan summary -----------------------------------------------------

interface PlanSummaryArgs {
  scope?: ScopeKind;
  weeks?: Set<number>;
  gamesRequested: number;
  markets: readonly string[];
  region: string;
  estimatedCredits: number;
  creditsForUncachedCalls: number;
  cachedResponses: number;
  plannedRequests: number;
  newApiCalls: number;
  maxAllowedCredits: number;
}

function printPlanSummary(args: PlanSummaryArgs): void {
  const weeks = args.weeks
    ? Array.from(args.weeks).sort((a, b) => a - b).join(",")
    : "(all)";
  const lines = [
    "",
    "===== Historical Odds Ingestion — Run Plan =====",
    `  scope                  : ${args.scope ?? "(none)"}`,
    `  weeks                  : ${weeks}`,
    `  games requested        : ${args.gamesRequested}`,
    `  markets requested      : ${args.markets.length} (${args.markets.join(", ")})`,
    `  region                 : ${args.region}`,
    `  estimated credits      : ${args.estimatedCredits}`,
    `  cached responses found : ${args.cachedResponses}`,
    `  new API calls required : ${args.newApiCalls}`,
    `  credits for new calls  : ${args.creditsForUncachedCalls}`,
    `  max allowed credits    : ${args.maxAllowedCredits}`,
    `  min remaining floor    : ${MIN_ODDS_API_CREDITS_REMAINING}`,
    "================================================",
    "",
  ];
  for (const l of lines) {
    // eslint-disable-next-line no-console
    console.log(l);
  }
}

// --- runtime credit safety -------------------------------------------

function checkOverageOrFloor(args: {
  estimated: number;
  actual: number;
  remaining: number | null;
}): string | null {
  if (
    args.estimated > 0 &&
    args.actual > args.estimated * CREDIT_OVERAGE_ABORT_RATIO
  ) {
    return `actual credits ${args.actual} exceed estimate ${args.estimated} by >${Math.round((CREDIT_OVERAGE_ABORT_RATIO - 1) * 100)}% (cap ${args.estimated * CREDIT_OVERAGE_ABORT_RATIO})`;
  }
  if (
    args.remaining != null &&
    args.remaining < MIN_ODDS_API_CREDITS_REMAINING
  ) {
    return `x-requests-remaining=${args.remaining} below MIN_ODDS_API_CREDITS_REMAINING=${MIN_ODDS_API_CREDITS_REMAINING}`;
  }
  return null;
}

// --- ApiUsageLog persistence -----------------------------------------

interface UsageRecord {
  endpoint: string;
  url: string;
  fromCache: boolean;
  estimatedCredits: number;
  usage?: OddsApiUsage;
  status: number | null;
}

interface UsageLog {
  record(args: UsageRecord): Promise<void>;
  close(): Promise<void>;
}

async function openUsageLog(jsonlPath: string): Promise<UsageLog> {
  ensureDir(path.dirname(jsonlPath));
  const stream = fs.createWriteStream(jsonlPath, { flags: "a" });

  // Best-effort Prisma writer. Only enabled if DATABASE_URL is set; on
  // any failure we silently fall back to JSONL only.
  interface MinimalPrisma {
    apiUsageLog: {
      create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
    };
    $disconnect: () => Promise<void>;
  }
  let prisma: MinimalPrisma | null = null;
  if (process.env.DATABASE_URL) {
    try {
      const { PrismaClient } = await import("@prisma/client");
      prisma = new PrismaClient() as unknown as MinimalPrisma;
    } catch {
      prisma = null;
    }
  }

  return {
    async record(args: UsageRecord): Promise<void> {
      const urlHash = createHash("sha256").update(args.url).digest("hex");
      const entry = {
        source: "odds-api",
        endpoint: args.endpoint,
        requestUrlHash: urlHash,
        estimatedCredits: args.estimatedCredits,
        actualCredits: args.usage?.last ?? (args.fromCache ? 0 : args.estimatedCredits),
        creditsRemaining: args.usage?.remaining ?? null,
        creditsUsed: args.usage?.used ?? null,
        creditsLast: args.usage?.last ?? null,
        status: args.status,
        message: args.fromCache ? "cache-hit" : null,
        createdAt: new Date().toISOString(),
      };
      stream.write(JSON.stringify(entry) + "\n");
      if (prisma) {
        try {
          await prisma.apiUsageLog.create({
            data: { ...entry, createdAt: new Date(entry.createdAt) },
          });
        } catch (err) {
          log(
            "warn",
            `ApiUsageLog Prisma write failed (continuing to JSONL only): ${(err as Error).message}`,
          );
        }
      }
    },
    async close(): Promise<void> {
      await new Promise<void>((resolve) => stream.end(resolve));
      if (prisma) {
        try {
          await prisma.$disconnect();
        } catch {
          // ignore
        }
      }
    },
  };
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
    `Season=${args.season} scope=${args.scope ?? "(none)"} weeks=${args.weeks ? Array.from(args.weeks).sort((a, b) => a - b).join(",") : "ALL"} source=${args.source} budget=${args.budget} dryRun=${args.dryRun}`,
  );

  // --- safeguards
  if (INGESTION_MARKETS.length > MAX_MARKETS_PER_REQUEST) {
    log(
      "error",
      `V1_INGESTION_MARKETS (${INGESTION_MARKETS.length}) exceeds MAX_MARKETS_PER_REQUEST (${MAX_MARKETS_PER_REQUEST}).`,
    );
    return 1;
  }
  if (INGESTION_MARKETS.length > 4) {
    log(
      "error",
      `Refusing to run: ingestion is pinned to ≤4 markets in the first version (got ${INGESTION_MARKETS.length}).`,
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
  // When `--max-odds-requests` (or `--calibration`) caps the run,
  // the plan estimate must reflect that ceiling — otherwise the
  // up-front budget guard refuses the run even though we'd only
  // actually fire a handful of requests.
  const cappedTotalEvents =
    args.maxOddsRequests !== undefined
      ? Math.min(games.length, args.maxOddsRequests)
      : games.length;
  const cappedSnapshots =
    args.maxOddsRequests !== undefined
      ? Math.min(snapshots.length, args.maxOddsRequests)
      : snapshots.length;
  const plan = estimateCredits({
    uniqueSnapshots: cappedSnapshots,
    totalEvents: cappedTotalEvents,
    marketsPerEvent: INGESTION_MARKETS.length,
    marketKeys: INGESTION_MARKETS,
  });

  // Planned request count = one /events per unique snapshot + one
  // /events/{id}/odds per game. The cache lookup below tells us how
  // many of those would actually hit the network.
  const plannedRequestCount = snapshots.length + games.length;

  // Cache pre-flight — count what we'd skip vs what we'd actually call.
  const cacheReport = inspectCacheCoverage(
    snapshots,
    games,
    INGESTION_MARKETS,
  );
  const cappedEventsMisses =
    args.maxOddsRequests !== undefined
      ? Math.min(cacheReport.eventsMisses, args.maxOddsRequests)
      : cacheReport.eventsMisses;
  const cappedOddsMisses =
    args.maxOddsRequests !== undefined
      ? Math.min(cacheReport.oddsMisses, args.maxOddsRequests)
      : cacheReport.oddsMisses;
  const newApiCalls = cappedEventsMisses + cappedOddsMisses;
  const creditsForUncachedCalls =
    cappedEventsMisses * 1 +
    cappedOddsMisses * plan.perEventOddsCallCredits;

  printPlanSummary({
    scope: args.scope,
    weeks: args.weeks,
    gamesRequested: games.length,
    markets: INGESTION_MARKETS,
    region: SUPPORTED_REGION,
    estimatedCredits: plan.estimatedCredits,
    creditsForUncachedCalls,
    cachedResponses: cacheReport.hits,
    plannedRequests: plannedRequestCount,
    newApiCalls,
    maxAllowedCredits: args.budget,
  });

  // Hard policy check from src/config/api-budget.ts. When the
  // caller explicitly raised the cap via --max-credits (only the
  // admin runner does this, with hard-coded values per action),
  // the validator honours that override instead of the global
  // constant.
  const validation = validateCreditBudget({
    markets: INGESTION_MARKETS.length,
    regions: [...ALLOWED_ODDS_REGIONS],
    estimatedCredits: plan.estimatedCredits,
    maxCreditsOverride: args.maxCredits,
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

  // --- dry-run: print URLs (api key masked), write schema-only CSVs, exit
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
          markets: [...INGESTION_MARKETS],
        });
        log("info", `[dry] odds   game=${g.gameId}  url=${maskApiKey(oddsUrl)}`);
      }
    }

    // Emit schema-only CSVs so the downstream loader has its contract
    // visible even before the first paid call. Matches the nflverse
    // stub's pattern.
    const processedRoot = path.join(args.out, "processed");
    const marketsPath = path.join(processedRoot, "prop_markets.csv");
    const quotesPath = path.join(processedRoot, "prop_quotes.csv");
    writeCsv(marketsPath, PROP_MARKETS_COLUMNS, []);
    writeCsv(quotesPath, PROP_QUOTES_COLUMNS, []);
    log("info", `[dry] wrote schema-only ${marketsPath} (${PROP_MARKETS_COLUMNS.length} cols)`);
    log("info", `[dry] wrote schema-only ${quotesPath} (${PROP_QUOTES_COLUMNS.length} cols)`);
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

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const usageLogPath = path.join(args.out, "raw", "api-usage", `${runId}.jsonl`);
  ensureDir(path.dirname(usageLogPath));
  const usageLog = await openUsageLog(usageLogPath);

  const allMarkets: NormalizedPropMarket[] = [];
  const allQuotes: NormalizedPropQuote[] = [];
  let creditsUsedActual = 0;
  let creditsUsedEstimated = 0;
  let oddsRequestsMade = 0;
  let firstOddsCallCost: number | null = null;
  let lastRemaining: number | null = null;
  const runStartedAt = new Date().toISOString();

  for (const group of snapshots) {
    if (
      args.maxOddsRequests !== undefined &&
      oddsRequestsMade >= args.maxOddsRequests
    ) {
      log(
        "info",
        `Hit --max-odds-requests=${args.maxOddsRequests} before next snapshot. Stopping.`,
      );
      break;
    }
    log("info", `Snapshot ${group.snapshotISO}: fetching events list (${group.games.length} games target)`);
    const eventsRes = await fetchEventsCached({
      apiKey: apiKey!,
      snapshotISO: group.snapshotISO,
    });
    creditsUsedEstimated += eventsRes.fromCache ? 0 : 1;
    creditsUsedActual += eventsRes.fromCache ? 0 : eventsRes.usage?.last ?? 1;
    if (eventsRes.usage?.remaining != null)
      lastRemaining = eventsRes.usage.remaining;
    await usageLog.record({
      endpoint: "historical-events",
      url: eventsRes.url,
      fromCache: eventsRes.fromCache,
      estimatedCredits: eventsRes.fromCache ? 0 : 1,
      usage: eventsRes.usage,
      status: eventsRes.status,
    });

    writeJSON(
      path.join(rawRoot, `${safeName(group.snapshotISO)}-events.json`),
      eventsRes.response,
    );

    const overage = checkOverageOrFloor({
      estimated: creditsUsedEstimated,
      actual: creditsUsedActual,
      remaining: lastRemaining,
    });
    if (overage) {
      log("error", `ABORT mid-run: ${overage}`);
      await usageLog.close();
      return 4;
    }

    for (const game of group.games) {
      const event = matchEvent(eventsRes.response.data, game);
      if (!event) {
        log(
          "warn",
          `No matching event in snapshot ${group.snapshotISO} for ${game.awayTeamAbbr}@${game.homeTeamAbbr} (${game.gameId}). Skipping.`,
        );
        continue;
      }
      // Per-call estimate under the corrected model: each market in
      // the V1 set is player_* → 10 credits × 1 region.
      const estCost = plan.perEventOddsCallCredits;
      // Pre-call budget guard: refuse if projected cumulative actual
      // would exceed maxCredits. Catches an overspend BEFORE we send
      // the request, instead of only after the response comes back.
      const maxCredits = args.maxCredits ?? args.budget;
      const projected = creditsUsedActual + estCost;
      if (projected > maxCredits) {
        log(
          "error",
          `ABORT before request: projected cumulative actual ${projected} would exceed --max-credits ${maxCredits} (per-call estimate ${estCost} for ${INGESTION_MARKETS.length} player-prop markets).`,
        );
        await usageLog.close();
        return 4;
      }
      if (
        args.maxOddsRequests !== undefined &&
        oddsRequestsMade >= args.maxOddsRequests
      ) {
        log(
          "info",
          `Hit --max-odds-requests=${args.maxOddsRequests}. Stopping after ${oddsRequestsMade} odds call(s).`,
        );
        break;
      }
      log(
        "info",
        `  ${game.awayTeamAbbr}@${game.homeTeamAbbr}  event=${event.id}  fetching odds for ${INGESTION_MARKETS.length} markets (est ${estCost} credits)`,
      );
      const oddsRes = await fetchOddsCached({
        apiKey: apiKey!,
        eventId: event.id,
        snapshotISO: group.snapshotISO,
        markets: INGESTION_MARKETS,
      });
      oddsRequestsMade += 1;
      const actCost = oddsRes.fromCache
        ? 0
        : oddsRes.usage?.last ?? estCost;
      creditsUsedEstimated += oddsRes.fromCache ? 0 : estCost;
      creditsUsedActual += actCost;
      if (oddsRes.usage?.remaining != null)
        lastRemaining = oddsRes.usage.remaining;
      if (firstOddsCallCost === null && !oddsRes.fromCache) {
        firstOddsCallCost = actCost;
      }
      await usageLog.record({
        endpoint: "historical-event-odds",
        url: oddsRes.url,
        fromCache: oddsRes.fromCache,
        estimatedCredits: oddsRes.fromCache ? 0 : estCost,
        usage: oddsRes.usage,
        status: oddsRes.status,
      });

      writeJSON(
        path.join(
          rawRoot,
          `${safeName(group.snapshotISO)}-${event.id}-odds.json`,
        ),
        oddsRes.response,
      );

      const norm = normalizeEventOdds(oddsRes.response.data, {
        gameId: game.gameId,
        snapshotISO: group.snapshotISO,
      });
      allMarkets.push(...norm.markets);
      allQuotes.push(...norm.quotes);

      const overage2 = checkOverageOrFloor({
        estimated: creditsUsedEstimated,
        actual: creditsUsedActual,
        remaining: lastRemaining,
      });
      if (overage2) {
        log("error", `ABORT mid-run: ${overage2}`);
        await usageLog.close();
        return 4;
      }
    }
  }

  const marketsPath = path.join(processedRoot, "prop_markets.csv");
  const quotesPath = path.join(processedRoot, "prop_quotes.csv");

  const nMarkets = writeCsv(
    marketsPath,
    PROP_MARKETS_COLUMNS,
    allMarkets as unknown as Record<string, unknown>[],
  );
  const nQuotes = writeCsv(
    quotesPath,
    PROP_QUOTES_COLUMNS,
    allQuotes as unknown as Record<string, unknown>[],
  );

  log("info", `Wrote ${marketsPath} (${nMarkets} rows)`);
  log("info", `Wrote ${quotesPath} (${nQuotes} rows)`);

  // Also write the canonical per-week file the stored backtest
  // expects. Joins allMarkets + allQuotes against the same games
  // we already loaded, plus rosters (if present) to resolve
  // player → team. Skipped when --weeks spans more than one
  // week (the per-week schema is single-week).
  try {
    const seasons = new Set(games.map((g) => g.season));
    const weeks = new Set(games.map((g) => g.week));
    if (seasons.size === 1 && weeks.size === 1) {
      const onlySeason = [...seasons][0]!;
      const onlyWeek = [...weeks][0]!;
      const rostersCsv = path.join(process.cwd(), "data", "processed", "nfl", "rosters.csv");
      const rosters = fs.existsSync(rostersCsv)
        ? parseCanonRosters(fs.readFileSync(rostersCsv, "utf8"))
        : undefined;
      const playerWeekStatsCsv = path.join(
        process.cwd(),
        "data",
        "processed",
        "nfl",
        "player_week_stats.csv",
      );
      const playerWeekStats = fs.existsSync(playerWeekStatsCsv)
        ? parseCsvRows(fs.readFileSync(playerWeekStatsCsv, "utf8"))
            .map((r) => ({
              playerName: r.playerName,
              team: r.team,
              season: Number(r.season),
              week: Number(r.week),
            }))
            .filter(
              (r) =>
                r.season === onlySeason &&
                r.week === onlyWeek &&
                r.playerName &&
                r.team,
            )
        : undefined;
      const built = buildCanonicalOddsRows({
        markets: allMarkets.map((m) => ({
          market_key: m.market_key,
          game_id: m.game_id,
          player_name: m.player_name,
          prop_type: m.prop_type,
          line: m.line,
          snapshot_time: m.snapshot_time,
        })),
        quotes: allQuotes.map((q) => ({
          market_key: q.market_key,
          book_name: q.book_name,
          over_price: q.over_price,
          under_price: q.under_price,
          quote_time: q.quote_time,
        })),
        games: games.map((g) => ({
          gameId: g.gameId,
          season: g.season,
          week: g.week,
          startTimeUtc: g.kickoffISO,
          homeTeam: g.homeTeamAbbr,
          awayTeam: g.awayTeamAbbr,
        })),
        rosters,
        playerWeekStats,
      });
      const wrote = writeCanonicalOddsCsv({
        rows: built.rows,
        season: onlySeason,
        week: onlyWeek,
      });
      log(
        "info",
        `Wrote ${wrote.target} (${wrote.rowsWritten} canonical rows; quotes=${built.diagnostics.quotesProcessed} dropMissingTeam=${built.diagnostics.droppedMissingTeam} dropInvalidTeam=${built.diagnostics.droppedInvalidTeamForGame} dropAmbiguousTeam=${built.diagnostics.droppedAmbiguousTeam} dropMissingGame=${built.diagnostics.droppedMissingGame})`,
      );
    }
  } catch (err) {
    log("warn", `Canonical writer failed (continuing): ${(err as Error).message}`);
  }

  log(
    "info",
    `Done. Credits estimated=${creditsUsedEstimated} actual=${creditsUsedActual} remaining=${lastRemaining ?? "?"} budget=${args.budget}. ` +
      `Usage log: ${usageLogPath}`,
  );
  if (args.calibration) {
    writeCalibrationResult({
      mode: "calibration",
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      status: "success",
      markets: INGESTION_MARKETS,
      perMarketEstimatedRate: plan.perEventOddsCallCredits / INGESTION_MARKETS.length,
      firstOddsCallActualCost: firstOddsCallCost,
      perMarketObservedRate:
        firstOddsCallCost !== null
          ? firstOddsCallCost / INGESTION_MARKETS.length
          : null,
      creditsUsedActual,
      creditsRemaining: lastRemaining,
      oddsRequestsMade,
      maxCredits: args.maxCredits ?? args.budget,
    });
  }
  await usageLog.close();
  return 0;
}

interface CalibrationResult {
  mode: "calibration";
  startedAt: string;
  finishedAt: string;
  status: "success" | "failure";
  markets: readonly string[];
  perMarketEstimatedRate: number;
  firstOddsCallActualCost: number | null;
  perMarketObservedRate: number | null;
  creditsUsedActual: number;
  creditsRemaining: number | null;
  oddsRequestsMade: number;
  maxCredits: number;
  errorMessage?: string;
}

function writeCalibrationResult(args: CalibrationResult): string {
  const target = path.join(
    process.cwd(),
    "data",
    "admin-ingestion",
    "latest-odds-calibration.json",
  );
  ensureDir(path.dirname(target));
  const payload = {
    ...args,
    paidApiCallAttempted: true,
    guardrails: {
      noTouchdownProps: true,
      noAutomatedBetting: true,
      noKalshiIntegration: true,
    },
  };
  fs.writeFileSync(target, JSON.stringify(payload, null, 2) + "\n");
  log("info", `Wrote calibration result: ${target}`);
  return target;
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
