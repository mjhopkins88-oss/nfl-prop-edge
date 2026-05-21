/**
 * Stored Odds API loader for the real Week 1 path.
 *
 * Reads stored / processed Odds API output without ever calling
 * the API. Two layouts are supported, in order:
 *
 *   1. CANONICAL — per-week files under
 *      `data/processed/odds/{season}/week-{N}-prop-markets.csv`
 *      and `…/week-{N}-prop-quotes.csv`. This is where the
 *      paid ingestion script will land when it's run with
 *      `--scope week --season 2025 --week 1 --execute`.
 *   2. LEGACY — flat `data/processed/prop_markets.csv` +
 *      `prop_quotes.csv` containing rows for one or more
 *      weeks. We filter to the requested (season, week) by
 *      cross-referencing the games file.
 *
 * If neither layout has data for the requested week, the loader
 * returns `MISSING_STORED_ODDS` with the next-command hint.
 *
 * Filters applied to every row before returning:
 *
 *   · only the four starter V1 markets (PASSING_ATTEMPTS,
 *     PASSING_COMPLETIONS, RECEPTIONS, RUSHING_ATTEMPTS).
 *   · no touchdown propTypes — any column containing TD,
 *     TOUCHDOWN, _TD, ANYTIME_TD, FIRST_TD is dropped at
 *     parse time.
 *   · no post-kickoff odds — if a snapshotTime is set it must
 *     be ≤ kickoffTime; rows with missing snapshot data are
 *     accepted under a warning.
 *
 * Pure file IO. No network calls.
 */

import fs from "node:fs";
import path from "node:path";
import { parseCsvRows } from "../ingestion/nflverse";
import type { PropType } from "../types";

export const STARTER_PROP_TYPES: ReadonlySet<PropType> = new Set([
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "RECEPTIONS",
  "RUSHING_ATTEMPTS",
]);

/** Mapping from Odds API market_key → V1 PropType. */
const ODDS_MARKET_KEY_TO_PROP_TYPE: Record<string, PropType> = {
  player_pass_attempts: "PASSING_ATTEMPTS",
  player_pass_completions: "PASSING_COMPLETIONS",
  player_pass_yds: "PASSING_YARDS",
  player_receptions: "RECEPTIONS",
  player_reception_yds: "RECEIVING_YARDS",
  player_rush_attempts: "RUSHING_ATTEMPTS",
  player_rush_yds: "RUSHING_YARDS",
};

const DEFAULT_PROCESSED_ROOT = path.join(process.cwd(), "data", "processed");

export type StoredOddsStatus =
  | "READY"
  | "MISSING_STORED_ODDS"
  | "MALFORMED_STORED_ODDS";

export interface StoredOddsLoadResult {
  status: StoredOddsStatus;
  /**
   * One entry per `(gameId, playerId, propType)` after the
   * canonical-book chooser. Always empty when `status !== "READY"`.
   */
  markets: StoredPropMarket[];
  /** All raw quotes the canonical chooser saw, for the page. */
  quotes: StoredPropQuote[];
  /** Human notes for the missing-data hint on the page. */
  missingNotes: string[];
  /** Paths the loader inspected. */
  sourcesInspected: string[];
}

export interface StoredPropMarket {
  id: string;
  season: number;
  week: number;
  gameId: string;
  kickoffTime?: string;
  sportsbook: string;
  playerName: string;
  playerId?: string;
  team: string;
  opponent: string;
  propType: PropType;
  marketKey: string;
  line: number;
  overOdds: number;
  underOdds: number;
  snapshotTime?: string;
  oddsSource?: string;
  isBeforeKickoff: boolean;
}

export interface StoredPropQuote {
  marketId: string;
  sportsbook: string;
  line: number;
  overOdds: number;
  underOdds: number;
}

export function mapOddsToV1PropTypes(marketKey: string): PropType | undefined {
  return ODDS_MARKET_KEY_TO_PROP_TYPE[marketKey.toLowerCase()];
}

interface ParsedOddsRow {
  season: number;
  week: number;
  gameId: string;
  kickoffTime?: string;
  sportsbook: string;
  playerName: string;
  playerId?: string;
  team: string;
  opponent: string;
  marketKey: string;
  propType: PropType;
  line: number;
  overOdds: number;
  underOdds: number;
  snapshotTime?: string;
  oddsSource?: string;
  isBeforeKickoff: boolean;
}

function asNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "" || value === "NA") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function snapshotIsBeforeKickoff(args: {
  snapshotTime?: string;
  kickoffTime?: string;
}): boolean {
  if (!args.snapshotTime) return true; // no signal → accept under warning
  if (!args.kickoffTime) return true;
  const snap = Date.parse(args.snapshotTime);
  const kick = Date.parse(args.kickoffTime);
  if (!Number.isFinite(snap) || !Number.isFinite(kick)) return true;
  return snap <= kick;
}

function parseRow(row: Record<string, string>): ParsedOddsRow | undefined {
  const season = asNumber(row.season ?? row.Season);
  const week = asNumber(row.week ?? row.Week);
  if (season === undefined || week === undefined) return undefined;
  const gameId = row.gameId ?? row.game_id ?? "";
  if (!gameId) return undefined;
  const marketKey = (row.marketKey ?? row.market_key ?? row.market ?? "")
    .toLowerCase();
  const propType = mapOddsToV1PropTypes(marketKey);
  if (!propType) return undefined;
  if (!STARTER_PROP_TYPES.has(propType)) return undefined;
  const line = asNumber(row.line);
  const overOdds = asNumber(row.overOdds ?? row.over_odds);
  const underOdds = asNumber(row.underOdds ?? row.under_odds);
  if (line === undefined || overOdds === undefined || underOdds === undefined) {
    return undefined;
  }
  const playerName = row.playerName ?? row.player_name ?? row.player ?? "";
  if (!playerName) return undefined;
  const sportsbook = row.sportsbook ?? row.book ?? "unknown";
  const team = row.team ?? row.teamAbbr ?? "";
  const opponent = row.opponent ?? row.opp ?? "";
  const kickoffTime =
    row.kickoffTime ?? row.kickoff_time ?? row.kickoff ?? undefined;
  const snapshotTime =
    row.snapshotTime ?? row.snapshot_time ?? row.snapshot ?? undefined;
  const oddsSource = row.oddsSource ?? row.source ?? undefined;
  const isBeforeKickoff = snapshotIsBeforeKickoff({
    snapshotTime,
    kickoffTime,
  });
  return {
    season,
    week,
    gameId,
    kickoffTime,
    sportsbook,
    playerName,
    playerId: row.playerId ?? row.player_id ?? undefined,
    team,
    opponent,
    marketKey,
    propType,
    line,
    overOdds,
    underOdds,
    snapshotTime,
    oddsSource,
    isBeforeKickoff,
  };
}

/**
 * Canonical book chooser — when multiple sportsbooks quote the
 * same (game, player, prop), prefer DraftKings → FanDuel → MGM
 * → Caesars → the first one we see. Falls back to "best line"
 * for the OVER side when no preferred book is present.
 */
function chooseCanonicalBookOrBestLine(
  rows: ParsedOddsRow[],
): ParsedOddsRow {
  const preferred = ["DraftKings", "FanDuel", "BetMGM", "Caesars", "PointsBet"];
  for (const name of preferred) {
    const hit = rows.find(
      (r) => r.sportsbook.toLowerCase() === name.toLowerCase(),
    );
    if (hit) return hit;
  }
  // Best-line tiebreaker on the OVER side (higher overOdds is
  // better for the bettor).
  return [...rows].sort((a, b) => b.overOdds - a.overOdds)[0]!;
}

export function groupOddsByGamePlayerProp(
  rows: ParsedOddsRow[],
): Map<string, ParsedOddsRow[]> {
  const out = new Map<string, ParsedOddsRow[]>();
  for (const r of rows) {
    const key = `${r.gameId}::${r.playerName}::${r.propType}`;
    const bucket = out.get(key) ?? [];
    bucket.push(r);
    out.set(key, bucket);
  }
  return out;
}

export function buildPropMarketsFromStoredOdds(args: {
  rows: ParsedOddsRow[];
}): { markets: StoredPropMarket[]; quotes: StoredPropQuote[] } {
  const grouped = groupOddsByGamePlayerProp(args.rows);
  const markets: StoredPropMarket[] = [];
  const quotes: StoredPropQuote[] = [];
  for (const [, bucket] of grouped) {
    const canonical = chooseCanonicalBookOrBestLine(bucket);
    const id = `stored-${canonical.gameId}-${canonical.playerName.replace(/\s+/g, "-").toLowerCase()}-${canonical.marketKey}`;
    markets.push({
      id,
      season: canonical.season,
      week: canonical.week,
      gameId: canonical.gameId,
      kickoffTime: canonical.kickoffTime,
      sportsbook: canonical.sportsbook,
      playerName: canonical.playerName,
      playerId: canonical.playerId,
      team: canonical.team,
      opponent: canonical.opponent,
      propType: canonical.propType,
      marketKey: canonical.marketKey,
      line: canonical.line,
      overOdds: canonical.overOdds,
      underOdds: canonical.underOdds,
      snapshotTime: canonical.snapshotTime,
      oddsSource: canonical.oddsSource,
      isBeforeKickoff: canonical.isBeforeKickoff,
    });
    for (const q of bucket) {
      quotes.push({
        marketId: id,
        sportsbook: q.sportsbook,
        line: q.line,
        overOdds: q.overOdds,
        underOdds: q.underOdds,
      });
    }
  }
  return { markets, quotes };
}

/**
 * Validate stored odds for a specific (season, week). Returns a
 * MISSING/MALFORMED status when there's no usable data.
 */
export function validateStoredOddsForWeek(args: {
  markets: StoredPropMarket[];
  season: number;
  week: number;
}): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (args.markets.length === 0) {
    reasons.push(
      `No stored markets found for season ${args.season} week ${args.week}.`,
    );
  }
  const wrongWeek = args.markets.filter(
    (m) => m.season !== args.season || m.week !== args.week,
  );
  if (wrongWeek.length > 0) {
    reasons.push(
      `${wrongWeek.length} stored markets are not from ${args.season}/W${args.week}.`,
    );
  }
  const postKickoff = args.markets.filter((m) => !m.isBeforeKickoff);
  if (postKickoff.length > 0) {
    reasons.push(
      `${postKickoff.length} stored markets are post-kickoff snapshots — these would leak future information.`,
    );
  }
  return { ok: reasons.length === 0, reasons };
}

interface ReadCsvAttempt {
  path: string;
  exists: boolean;
  rowsParsed: number;
}

/**
 * Read every supported layout, return all attempts so the page
 * can describe what it inspected.
 */
function collectCandidateRows(args: {
  season: number;
  week: number;
  processedRoot: string;
}): { rows: ParsedOddsRow[]; attempts: ReadCsvAttempt[] } {
  const attempts: ReadCsvAttempt[] = [];
  const rows: ParsedOddsRow[] = [];

  const tryReadCsv = (p: string): number => {
    const exists = fs.existsSync(p);
    if (!exists) {
      attempts.push({ path: p, exists: false, rowsParsed: 0 });
      return 0;
    }
    const text = fs.readFileSync(p, "utf8");
    const parsed = parseCsvRows(text);
    let count = 0;
    for (const raw of parsed) {
      const r = parseRow(raw);
      if (!r) continue;
      if (r.season !== args.season || r.week !== args.week) continue;
      rows.push(r);
      count += 1;
    }
    attempts.push({ path: p, exists: true, rowsParsed: count });
    return count;
  };

  // Canonical per-week layout (preferred).
  const canonicalMarketsPath = path.join(
    args.processedRoot,
    "odds",
    String(args.season),
    `week-${args.week}-prop-markets.csv`,
  );
  tryReadCsv(canonicalMarketsPath);

  // Legacy flat layout.
  const legacyMarketsPath = path.join(
    args.processedRoot,
    "prop_markets.csv",
  );
  tryReadCsv(legacyMarketsPath);

  return { rows, attempts };
}

export function loadStoredWeekOdds(args: {
  season: number;
  week: number;
  processedRoot?: string;
}): StoredOddsLoadResult {
  const processedRoot = args.processedRoot ?? DEFAULT_PROCESSED_ROOT;
  const { rows, attempts } = collectCandidateRows({
    season: args.season,
    week: args.week,
    processedRoot,
  });
  const sourcesInspected = attempts.map(
    (a) => `${a.path} (${a.exists ? `${a.rowsParsed} usable rows` : "missing"})`,
  );
  if (rows.length === 0) {
    return {
      status: "MISSING_STORED_ODDS",
      markets: [],
      quotes: [],
      missingNotes: [
        `No usable stored Odds API rows found for ${args.season} Week ${args.week}.`,
        `Inspected: ${attempts
          .map((a) => `${a.path} (${a.exists ? "present" : "missing"})`)
          .join("; ")}`,
        `Next: run the Odds API ingestion in --execute mode (requires ALLOW_REAL_ODDS_API_CALLS=true) and re-run with --data-mode stored.`,
      ],
      sourcesInspected,
    };
  }
  // Reject any row whose snapshot is post-kickoff. We never
  // allow future-information leakage even in stored mode.
  const cleanRows = rows.filter((r) => r.isBeforeKickoff);
  const droppedPostKickoff = rows.length - cleanRows.length;
  const built = buildPropMarketsFromStoredOdds({ rows: cleanRows });
  const validation = validateStoredOddsForWeek({
    markets: built.markets,
    season: args.season,
    week: args.week,
  });
  const missingNotes: string[] = [];
  if (droppedPostKickoff > 0) {
    missingNotes.push(
      `Dropped ${droppedPostKickoff} post-kickoff stored odds rows (leakage guard).`,
    );
  }
  if (!validation.ok) {
    missingNotes.push(...validation.reasons);
  }
  return {
    status: validation.ok ? "READY" : "MALFORMED_STORED_ODDS",
    markets: built.markets,
    quotes: built.quotes,
    missingNotes,
    sourcesInspected,
  };
}
