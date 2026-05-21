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
import { normalizeTeamAbbreviation } from "../backtest/week-1-game-id-mapper";
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
  /** Optional per-week player stats. Used as the PRIMARY
   *  player → team source because rosters are end-of-season
   *  snapshots and miss mid-season trades. A row in
   *  player_week_stats is the actual team the player played
   *  for that week. */
  playerWeekStats?: {
    playerName: string;
    team: string;
    season: number;
    week: number;
  }[];
  /** Optional roster lookup — playerName → team. Fallback only;
   *  used when player_week_stats has no matching entry. */
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
    droppedInvalidTeamForGame: number;
    droppedAmbiguousTeam: number;
    /** First 20 drop events with enough detail to debug a
     *  schedule-validation failure post-hoc. */
    droppedSample: {
      reason:
        | "missing-market"
        | "missing-game"
        | "missing-team"
        | "invalid-team-for-game"
        | "ambiguous-team";
      gameId?: string;
      expectedTeams?: string[];
      inferredTeam?: string;
      playerName?: string;
      propType?: string;
      sportsbook?: string;
    }[];
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

  // Normalize home/away team abbreviations at lookup-build time
  // (LA → LAR, etc.) and re-derive the canonical gameId from the
  // normalized pair. The schedule fixture is the source of truth
  // for team naming, so every downstream row will match it.
  const normalizedGameById = new Map<
    string,
    {
      gameId: string;
      season: number;
      week: number;
      startTimeUtc?: string;
      homeTeam: string;
      awayTeam: string;
    }
  >();
  for (const g of inputs.games) {
    const homeTeam = normalizeTeamAbbreviation(g.homeTeam);
    const awayTeam = normalizeTeamAbbreviation(g.awayTeam);
    const canonicalId = `${g.season}-w${g.week}-${awayTeam.toLowerCase()}-at-${homeTeam.toLowerCase()}`;
    const normalized = {
      gameId: canonicalId,
      season: g.season,
      week: g.week,
      startTimeUtc: g.startTimeUtc,
      homeTeam,
      awayTeam,
    };
    // Index by both the source gameId (so legacy markets that
    // carry the un-normalized id still join) AND the canonical
    // id (for forward-compatible callers).
    normalizedGameById.set(g.gameId, normalized);
    normalizedGameById.set(canonicalId, normalized);
  }

  // Per-week player → team lookup (the PRIMARY source). One
  // entry per (playerName, season, week) → set of teams seen.
  // Per-week stats reflect the team the player ACTUALLY played
  // for in that week, so they handle mid-season trades that the
  // end-of-season rosters file would miss.
  const playerTeamByWeek = new Map<string, Set<string>>();
  const weekKey = (n: string, s: number, w: number): string =>
    `${n}|${s}|${w}`;
  for (const r of inputs.playerWeekStats ?? []) {
    const team = normalizeTeamAbbreviation(r.team);
    if (!team) continue;
    const key = weekKey(r.playerName, r.season, r.week);
    const set = playerTeamByWeek.get(key) ?? new Set<string>();
    set.add(team);
    playerTeamByWeek.set(key, set);
  }

  // Player → team lookup, partitioned by season for stability.
  // Within a season, multiple rosters rows for the same player +
  // team (different weeks) collapse to one entry. Team values are
  // normalized as they're indexed so the resolver can match
  // against the normalized game. FALLBACK only — used when no
  // per-week stat row exists for the player.
  const playerTeamBySeason = new Map<number, Map<string, Set<string>>>();
  for (const r of inputs.rosters ?? []) {
    const team = normalizeTeamAbbreviation(r.team);
    const seasonMap =
      playerTeamBySeason.get(r.season) ??
      (() => {
        const m = new Map<string, Set<string>>();
        playerTeamBySeason.set(r.season, m);
        return m;
      })();
    const set = seasonMap.get(r.playerName) ?? new Set<string>();
    set.add(team);
    seasonMap.set(r.playerName, set);
  }

  type TeamResolution =
    | { team: string; status: "ok" }
    | { team: ""; status: "missing" | "invalid" | "ambiguous" };

  /**
   * Strict participant-aware resolver. Only returns a team when
   * it is one of the two teams in THIS game. A player whose
   * roster entry shows a team that isn't a participant is
   * dropped — never silently labelled with the wrong team.
   *
   *   · "missing"   — player not in rosters for this season at
   *                   all (canonical writer just doesn't know
   *                   who they are)
   *   · "invalid"   — rosters knows the player but every team
   *                   they appear on is NOT a participant of
   *                   the actual game (e.g., Adonai Mitchell
   *                   listed on NYJ but the prop is for the
   *                   MIA @ IND game)
   *   · "ambiguous" — player appears on BOTH the home and away
   *                   team in the rosters (extremely rare —
   *                   mid-season trade between the two teams in
   *                   the same week). Drop rather than guess.
   *   · "ok"        — exactly one of home/away matches.
   */
  function resolveTeam(args: {
    playerName: string;
    season: number;
    week: number;
    gameHome: string;
    gameAway: string;
  }): TeamResolution {
    // Primary: per-week stats. The player actually played for
    // that team that week, so this is authoritative.
    const weekCandidates = playerTeamByWeek.get(
      weekKey(args.playerName, args.season, args.week),
    );
    if (weekCandidates && weekCandidates.size > 0) {
      const hasHome = weekCandidates.has(args.gameHome);
      const hasAway = weekCandidates.has(args.gameAway);
      if (hasHome && hasAway) return { team: "", status: "ambiguous" };
      if (hasHome) return { team: args.gameHome, status: "ok" };
      if (hasAway) return { team: args.gameAway, status: "ok" };
      // Per-week stats exist but place the player on a team that
      // isn't in this game. This is real signal (the player
      // didn't actually play in this game) — drop.
      return { team: "", status: "invalid" };
    }
    // Fallback: season-level rosters.
    const seasonMap = playerTeamBySeason.get(args.season);
    const candidates = seasonMap?.get(args.playerName);
    if (!candidates || candidates.size === 0) {
      return { team: "", status: "missing" };
    }
    const hasHome = candidates.has(args.gameHome);
    const hasAway = candidates.has(args.gameAway);
    if (hasHome && hasAway) return { team: "", status: "ambiguous" };
    if (hasHome) return { team: args.gameHome, status: "ok" };
    if (hasAway) return { team: args.gameAway, status: "ok" };
    return { team: "", status: "invalid" };
  }

  const out: CanonicalPropRow[] = [];
  const diag: CanonicalBuildResult["diagnostics"] = {
    quotesProcessed: 0,
    droppedMissingMarket: 0,
    droppedMissingGame: 0,
    droppedMissingTeam: 0,
    droppedInvalidTeamForGame: 0,
    droppedAmbiguousTeam: 0,
    droppedSample: [],
  };
  const SAMPLE_CAP = 20;
  const recordDrop = (entry: CanonicalBuildResult["diagnostics"]["droppedSample"][number]): void => {
    if (diag.droppedSample.length < SAMPLE_CAP) diag.droppedSample.push(entry);
  };

  for (const q of inputs.quotes) {
    diag.quotesProcessed += 1;
    const m = marketsByKey.get(q.market_key);
    if (!m) {
      diag.droppedMissingMarket += 1;
      recordDrop({
        reason: "missing-market",
        sportsbook: q.book_name,
      });
      continue;
    }
    const g = normalizedGameById.get(m.game_id);
    if (!g) {
      diag.droppedMissingGame += 1;
      recordDrop({
        reason: "missing-game",
        playerName: m.player_name,
        propType: m.prop_type,
        sportsbook: q.book_name,
      });
      continue;
    }
    const resolved = resolveTeam({
      playerName: m.player_name,
      season: g.season,
      week: g.week,
      gameHome: g.homeTeam,
      gameAway: g.awayTeam,
    });
    if (resolved.status !== "ok") {
      // Count by reason so the migration result can explain
      // exactly why rows were dropped.
      const seasonMap = playerTeamBySeason.get(g.season);
      const inferred = seasonMap?.get(m.player_name);
      const inferredTeam =
        inferred && inferred.size > 0 ? [...inferred].join("/") : undefined;
      if (resolved.status === "missing") {
        diag.droppedMissingTeam += 1;
        recordDrop({
          reason: "missing-team",
          gameId: g.gameId,
          expectedTeams: [g.awayTeam, g.homeTeam],
          playerName: m.player_name,
          propType: m.prop_type,
          sportsbook: q.book_name,
        });
      } else if (resolved.status === "invalid") {
        diag.droppedInvalidTeamForGame += 1;
        recordDrop({
          reason: "invalid-team-for-game",
          gameId: g.gameId,
          expectedTeams: [g.awayTeam, g.homeTeam],
          inferredTeam,
          playerName: m.player_name,
          propType: m.prop_type,
          sportsbook: q.book_name,
        });
      } else {
        diag.droppedAmbiguousTeam += 1;
        recordDrop({
          reason: "ambiguous-team",
          gameId: g.gameId,
          expectedTeams: [g.awayTeam, g.homeTeam],
          inferredTeam,
          playerName: m.player_name,
          propType: m.prop_type,
          sportsbook: q.book_name,
        });
      }
      continue;
    }
    const team = resolved.team;
    const opponent = team === g.homeTeam ? g.awayTeam : g.homeTeam;
    // Final defence-in-depth: the writer never emits a row
    // where team/opponent aren't valid participants or where
    // team === opponent. resolveTeam already guarantees this,
    // but the assert is cheap.
    if (
      (team !== g.homeTeam && team !== g.awayTeam) ||
      (opponent !== g.homeTeam && opponent !== g.awayTeam) ||
      team === opponent
    ) {
      diag.droppedInvalidTeamForGame += 1;
      recordDrop({
        reason: "invalid-team-for-game",
        gameId: g.gameId,
        expectedTeams: [g.awayTeam, g.homeTeam],
        inferredTeam: `${team}/${opponent}`,
        playerName: m.player_name,
        propType: m.prop_type,
        sportsbook: q.book_name,
      });
      continue;
    }
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
  /** Resolved (season, week) the migration actually operated
   *  on. Surfaced even on failure so the operator can confirm
   *  the UI sent the week they expected. */
  targetSeason?: number;
  targetWeek?: number;
  /** Counts of how many legacy-CSV markets live in each week
   *  (parsed from the gameId prefix `YYYY-w{N}-...`). Helps
   *  operators see "your CSV has 122 Week 1 markets but you
   *  migrated Week 2 → 0 rows expected." */
  marketWeekHistogram?: Record<string, number>;
  /** Markets dropped because their parsed week ≠ target week.
   *  Counted separately from `droppedMissingGame`. */
  droppedWrongWeek?: number;
  /** First 20 distinct gameIds from the legacy markets CSV. */
  sampleMarketGameIds?: string[];
  /** First 20 distinct gameIds from games.csv for the target
   *  (season, week). When `sampleMarketGameIds` and this list
   *  contain similar-but-different strings (e.g., LA vs LAR),
   *  the join failure is a normalization issue, not a missing-
   *  data issue. */
  sampleScheduleGameIds?: string[];
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
  playerWeekStatsCsvPath?: string;
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
  const playerWeekStatsCsv =
    args.playerWeekStatsCsvPath ?? path.join(root, "nfl", "player_week_stats.csv");
  const sourcesInspected = [
    legacyMarkets,
    legacyQuotes,
    gamesCsv,
    rostersCsv,
    playerWeekStatsCsv,
  ];

  if (!fs.existsSync(legacyMarkets)) {
    return { status: "MISSING_LEGACY_MARKETS", sourcesInspected };
  }
  if (!fs.existsSync(legacyQuotes)) {
    return { status: "MISSING_LEGACY_QUOTES", sourcesInspected };
  }
  if (!fs.existsSync(gamesCsv)) {
    return { status: "MISSING_GAMES", sourcesInspected };
  }

  const allMarkets = parseCsvRows(fs.readFileSync(legacyMarkets, "utf8"))
    .map((r) => ({
      market_key: r.market_key,
      game_id: r.game_id,
      player_name: r.player_name,
      prop_type: r.prop_type as PropType,
      line: Number(r.line),
      snapshot_time: r.snapshot_time,
    }))
    .filter((r) => V1_STARTER_PROP_TYPES.has(r.prop_type));

  // Pre-filter markets to the target week by parsing the
  // gameId prefix. Legacy gameIds are `{season}-w{N}-...`; any
  // market whose extracted week ≠ args.week is dropped here
  // with a clear `wrong-week` reason instead of falling through
  // to the writer's confusing `missing-game` bucket. We also
  // collect a per-week histogram so the operator can see
  // "your CSV has 122 Week 1 markets, 0 Week 2 markets" at a
  // glance.
  const gameIdWeekRegex = /^(\d{4})-w(\d+)-/;
  const marketWeekHistogram: Record<string, number> = {};
  let droppedWrongWeek = 0;
  const sampleMarketGameIdSet = new Set<string>();
  const markets: typeof allMarkets = [];
  for (const m of allMarkets) {
    if (sampleMarketGameIdSet.size < 20) sampleMarketGameIdSet.add(m.game_id);
    const match = gameIdWeekRegex.exec(m.game_id);
    if (!match) {
      // Unparseable gameId — keep the market so the writer's
      // existing diagnostic surfaces the drop reason. Bucket
      // it under "unknown" in the histogram for visibility.
      marketWeekHistogram.unknown = (marketWeekHistogram.unknown ?? 0) + 1;
      markets.push(m);
      continue;
    }
    const marketSeason = Number(match[1]);
    const marketWeek = Number(match[2]);
    const key = `${marketSeason}-w${marketWeek}`;
    marketWeekHistogram[key] = (marketWeekHistogram[key] ?? 0) + 1;
    if (marketSeason !== args.season || marketWeek !== args.week) {
      droppedWrongWeek += 1;
      continue;
    }
    markets.push(m);
  }
  const sampleMarketGameIds = [...sampleMarketGameIdSet];

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

  // Per-week stats — the authoritative source for which team
  // a player ACTUALLY played for in a given week. Filtered to
  // the target (season, week) at load time so the writer's
  // weekly map stays small.
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
            r.season === args.season &&
            r.week === args.week &&
            r.playerName &&
            r.team,
        )
    : undefined;

  const built = buildCanonicalOddsRows({
    markets,
    quotes,
    games,
    rosters,
    playerWeekStats,
  });

  const inWeek = built.rows.filter(
    (r) => r.season === args.season && r.week === args.week,
  );
  const sampleScheduleGameIds: string[] = [];
  {
    const seen = new Set<string>();
    for (const g of games) {
      if (seen.has(g.gameId) || seen.size >= 20) break;
      seen.add(g.gameId);
      sampleScheduleGameIds.push(g.gameId);
    }
  }
  if (inWeek.length === 0) {
    return {
      status: "NO_ROWS_FOR_WEEK",
      diagnostics: built.diagnostics,
      sourcesInspected,
      targetSeason: args.season,
      targetWeek: args.week,
      marketWeekHistogram,
      droppedWrongWeek,
      sampleMarketGameIds,
      sampleScheduleGameIds,
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
    targetSeason: args.season,
    targetWeek: args.week,
    marketWeekHistogram,
    droppedWrongWeek,
    sampleMarketGameIds,
    sampleScheduleGameIds,
  };
}
