/**
 * Canonical stored-odds writer + legacy migration.
 *
 * The paid Odds API ingestion writes two relational CSV files:
 *
 *   · `data/processed/prop_markets.csv` — per (eventId, player,
 *     propType, line). No season/week/team — only `game_id`.
 *   · `data/processed/prop_quotes.csv` — per (market_key, book).
 *     Carries the over/under prices but no player or team.
 *
 * The stored-mode backtest expects ONE combined CSV per week
 * with `season, week, gameId, sportsbook, playerName, team,
 * opponent, marketKey, line, overOdds, underOdds, snapshotTime`
 * at `data/processed/odds/{season}/week-{N}-prop-markets.csv`.
 *
 * This module joins the two legacy files against `games.csv` +
 * `rosters.csv` and writes the canonical layout. Used both by
 * the live ingestion script (forward-going) and by an admin
 * migration helper (for already-landed legacy data).
 *
 * Pure file IO. No paid APIs. No model logic.
 */

import fs from "node:fs";
import path from "node:path";
import { parseCsvRows } from "./nflverse";
import type { PropType } from "../types";

export interface CanonicalPropRow {
  season: number;
  week: number;
  gameId: string;
  kickoffTime: string;
  sportsbook: string;
  playerName: string;
  team: string;
  opponent: string;
  marketKey: string;
  propType: string;
  line: number;
  overOdds: number;
  underOdds: number;
  snapshotTime: string;
}

export const CANONICAL_PROP_MARKETS_COLUMNS: (keyof CanonicalPropRow)[] = [
  "season",
  "week",
  "gameId",
  "kickoffTime",
  "sportsbook",
  "playerName",
  "team",
  "opponent",
  "marketKey",
  "propType",
  "line",
  "overOdds",
  "underOdds",
  "snapshotTime",
];

export interface CanonicalWriterInputs {
  /** Markets joined to the source eventId — must carry gameId
   *  (canonical kebab-case) so it lines up with games.csv. */
  markets: {
    market_key: string;
    game_id: string;
    player_name: string;
    prop_type: PropType;
    line: number;
    snapshot_time: string;
  }[];
  /** Quotes — one per (market_key, sportsbook). */
  quotes: {
    market_key: string;
    book_name: string;
    over_price: number;
    under_price: number;
    quote_time: string;
  }[];
  /** Per-gameId enrichment — season, week, kickoff, home/away. */
  games: {
    gameId: string;
    season: number;
    week: number;
    startTimeUtc?: string;
    homeTeam: string;
    awayTeam: string;
  }[];
  /** Optional roster lookup — playerName → team. When absent,
   *  the canonical row's team/opponent stay empty. */
  rosters?: {
    playerName: string;
    team: string;
    season: number;
  }[];
}

export interface CanonicalBuildResult {
  rows: CanonicalPropRow[];
  /** Diagnostics — counts of dropped quotes per reason. */
  diagnostics: {
    quotesProcessed: number;
    droppedMissingMarket: number;
    droppedMissingGame: number;
    droppedMissingTeam: number;
  };
}

/**
 * Join markets + quotes against games + rosters; return the
 * canonical row set. Player → team lookup uses the most recent
 * season's roster entry, scoped to the games' home/away teams
 * to disambiguate name collisions.
 */
export function buildCanonicalOddsRows(
  inputs: CanonicalWriterInputs,
): CanonicalBuildResult {
  const marketsByKey = new Map<string, CanonicalWriterInputs["markets"][number]>();
  for (const m of inputs.markets) marketsByKey.set(m.market_key, m);

  const gamesById = new Map<string, CanonicalWriterInputs["games"][number]>();
  for (const g of inputs.games) gamesById.set(g.gameId, g);

  // Player → team lookup, partitioned by season for stability.
  // Within a season, multiple rosters rows for the same player +
  // team (different weeks) collapse to one entry.
  const playerTeamBySeason = new Map<number, Map<string, Set<string>>>();
  for (const r of inputs.rosters ?? []) {
    const seasonMap =
      playerTeamBySeason.get(r.season) ??
      (() => {
        const m = new Map<string, Set<string>>();
        playerTeamBySeason.set(r.season, m);
        return m;
      })();
    const set = seasonMap.get(r.playerName) ?? new Set<string>();
    set.add(r.team);
    seasonMap.set(r.playerName, set);
  }

  function resolveTeam(args: {
    playerName: string;
    season: number;
    gameHome: string;
    gameAway: string;
  }): string {
    const seasonMap = playerTeamBySeason.get(args.season);
    const candidates = seasonMap?.get(args.playerName);
    if (!candidates || candidates.size === 0) return "";
    // Common case: one team. Use it.
    if (candidates.size === 1) {
      return [...candidates][0]!;
    }
    // Player switched teams mid-season. Pick the one that matches
    // this game's home/away pair.
    if (candidates.has(args.gameHome)) return args.gameHome;
    if (candidates.has(args.gameAway)) return args.gameAway;
    return "";
  }

  const out: CanonicalPropRow[] = [];
  const diag = {
    quotesProcessed: 0,
    droppedMissingMarket: 0,
    droppedMissingGame: 0,
    droppedMissingTeam: 0,
  };

  for (const q of inputs.quotes) {
    diag.quotesProcessed += 1;
    const m = marketsByKey.get(q.market_key);
    if (!m) {
      diag.droppedMissingMarket += 1;
      continue;
    }
    const g = gamesById.get(m.game_id);
    if (!g) {
      diag.droppedMissingGame += 1;
      continue;
    }
    const team = resolveTeam({
      playerName: m.player_name,
      season: g.season,
      gameHome: g.homeTeam,
      gameAway: g.awayTeam,
    });
    if (!team) {
      diag.droppedMissingTeam += 1;
      continue;
    }
    const opponent = team === g.homeTeam ? g.awayTeam : g.homeTeam;
    // The canonical `marketKey` is the short Odds API key
    // (player_pass_attempts etc.) — that's what the stored
    // loader's lookup expects. The legacy `market_key` column is
    // a compound (eventId:player:propType:line) used only to
    // join markets → quotes.
    const shortMarketKey = propTypeToShortMarketKey(m.prop_type);
    if (!shortMarketKey) continue;
    out.push({
      season: g.season,
      week: g.week,
      gameId: g.gameId,
      kickoffTime: g.startTimeUtc ?? "",
      sportsbook: q.book_name,
      playerName: m.player_name,
      team,
      opponent,
      marketKey: shortMarketKey,
      propType: m.prop_type,
      line: m.line,
      overOdds: q.over_price,
      underOdds: q.under_price,
      snapshotTime: q.quote_time,
    });
  }
  return { rows: out, diagnostics: diag };
}

/** Map V1 PropType → short Odds API key, mirroring the inverse
 *  of `ODDS_MARKET_KEY_TO_PROP_TYPE` in stored-odds-loader.ts. */
function propTypeToShortMarketKey(propType: string): string | undefined {
  return PROP_TYPE_TO_SHORT_MARKET_KEY[propType];
}

function escapeCsv(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function canonicalMarketsPath(args: {
  season: number;
  week: number;
  processedRoot?: string;
}): string {
  const root = args.processedRoot ?? path.join(process.cwd(), "data", "processed");
  return path.join(
    root,
    "odds",
    String(args.season),
    `week-${args.week}-prop-markets.csv`,
  );
}

export function writeCanonicalOddsCsv(args: {
  rows: CanonicalPropRow[];
  season: number;
  week: number;
  processedRoot?: string;
}): { target: string; rowsWritten: number } {
  const target = canonicalMarketsPath({
    season: args.season,
    week: args.week,
    processedRoot: args.processedRoot,
  });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const header = CANONICAL_PROP_MARKETS_COLUMNS.join(",");
  const lines = [header];
  for (const row of args.rows) {
    if (row.season !== args.season || row.week !== args.week) continue;
    lines.push(
      CANONICAL_PROP_MARKETS_COLUMNS.map((c) => escapeCsv(row[c])).join(","),
    );
  }
  fs.writeFileSync(target, lines.join("\n") + "\n");
  return { target, rowsWritten: lines.length - 1 };
}

// ---- legacy migration --------------------------------------------------

export interface MigrationResult {
  status:
    | "READY"
    | "MISSING_LEGACY_MARKETS"
    | "MISSING_LEGACY_QUOTES"
    | "MISSING_GAMES"
    | "NO_ROWS_FOR_WEEK";
  target?: string;
  rowsWritten?: number;
  diagnostics?: CanonicalBuildResult["diagnostics"];
  sourcesInspected: string[];
}

/**
 * Read legacy prop_markets.csv + prop_quotes.csv + games.csv (+
 * rosters.csv) and write the canonical
 * `data/processed/odds/{season}/week-{N}-prop-markets.csv` file.
 *
 * Pure file IO. No paid API, no network, no model logic.
 *
 * Filters applied to the output (defence in depth — the loader
 * also enforces these):
 *
 *   · only rows matching (season, week)
 *   · only the four V1 starter prop_types (PASSING_ATTEMPTS,
 *     PASSING_COMPLETIONS, RECEPTIONS, RUSHING_ATTEMPTS) — no
 *     touchdowns, no yardage
 *   · only rows whose gameId is in the canonical games.csv for
 *     the target week (rejects synthetic IDs)
 *
 * The legacy `market_key` column is a compound
 * `eventId:player:propType:line` — the filter uses `prop_type`,
 * which IS the V1 enum value. The canonical file's `marketKey`
 * column carries the short Odds API key (`player_pass_attempts`,
 * etc.) so the stored-odds loader's `ODDS_MARKET_KEY_TO_PROP_TYPE`
 * lookup succeeds.
 */
const V1_STARTER_PROP_TYPES = new Set<PropType>([
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "RECEPTIONS",
  "RUSHING_ATTEMPTS",
]);

const PROP_TYPE_TO_SHORT_MARKET_KEY: Record<string, string> = {
  PASSING_ATTEMPTS: "player_pass_attempts",
  PASSING_COMPLETIONS: "player_pass_completions",
  RECEPTIONS: "player_receptions",
  RUSHING_ATTEMPTS: "player_rush_attempts",
};

export function migrateLegacyToCanonical(args: {
  season: number;
  week: number;
  processedRoot?: string;
  /** Optional override for tests. */
  legacyMarketsPath?: string;
  legacyQuotesPath?: string;
  gamesCsvPath?: string;
  rostersCsvPath?: string;
}): MigrationResult {
  const root = args.processedRoot ?? path.join(process.cwd(), "data", "processed");
  const legacyMarkets =
    args.legacyMarketsPath ?? path.join(root, "prop_markets.csv");
  const legacyQuotes =
    args.legacyQuotesPath ?? path.join(root, "prop_quotes.csv");
  const gamesCsv =
    args.gamesCsvPath ?? path.join(root, "nfl", "games.csv");
  const rostersCsv =
    args.rostersCsvPath ?? path.join(root, "nfl", "rosters.csv");
  const sourcesInspected = [legacyMarkets, legacyQuotes, gamesCsv, rostersCsv];

  if (!fs.existsSync(legacyMarkets)) {
    return { status: "MISSING_LEGACY_MARKETS", sourcesInspected };
  }
  if (!fs.existsSync(legacyQuotes)) {
    return { status: "MISSING_LEGACY_QUOTES", sourcesInspected };
  }
  if (!fs.existsSync(gamesCsv)) {
    return { status: "MISSING_GAMES", sourcesInspected };
  }

  const markets = parseCsvRows(fs.readFileSync(legacyMarkets, "utf8"))
    .map((r) => ({
      market_key: r.market_key,
      game_id: r.game_id,
      player_name: r.player_name,
      prop_type: r.prop_type as PropType,
      line: Number(r.line),
      snapshot_time: r.snapshot_time,
    }))
    .filter((r) => V1_STARTER_PROP_TYPES.has(r.prop_type));

  const quotes = parseCsvRows(fs.readFileSync(legacyQuotes, "utf8"))
    .map((r) => ({
      market_key: r.market_key,
      book_name: r.book_name,
      over_price: Number(r.over_price),
      under_price: Number(r.under_price),
      quote_time: r.quote_time,
    }))
    .filter((q) => Number.isFinite(q.over_price) && Number.isFinite(q.under_price));

  const games = parseCsvRows(fs.readFileSync(gamesCsv, "utf8"))
    .map((r) => ({
      gameId: r.gameId,
      season: Number(r.season),
      week: Number(r.week),
      startTimeUtc: r.startTimeUtc || undefined,
      homeTeam: r.homeTeam,
      awayTeam: r.awayTeam,
    }))
    .filter(
      (g) =>
        g.season === args.season &&
        g.week === args.week &&
        g.gameId &&
        g.homeTeam &&
        g.awayTeam,
    );

  const rosters = fs.existsSync(rostersCsv)
    ? parseCsvRows(fs.readFileSync(rostersCsv, "utf8")).map((r) => ({
        playerName: r.playerName,
        team: r.team,
        season: Number(r.season),
      }))
    : undefined;

  const built = buildCanonicalOddsRows({
    markets,
    quotes,
    games,
    rosters,
  });

  const inWeek = built.rows.filter(
    (r) => r.season === args.season && r.week === args.week,
  );
  if (inWeek.length === 0) {
    return {
      status: "NO_ROWS_FOR_WEEK",
      diagnostics: built.diagnostics,
      sourcesInspected,
    };
  }

  const writeOut = writeCanonicalOddsCsv({
    rows: inWeek,
    season: args.season,
    week: args.week,
    processedRoot: root,
  });

  return {
    status: "READY",
    target: writeOut.target,
    rowsWritten: writeOut.rowsWritten,
    diagnostics: built.diagnostics,
    sourcesInspected,
  };
}
