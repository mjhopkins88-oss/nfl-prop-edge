/**
 * nflverse / nflfastR ingestion — TypeScript client.
 *
 * nflverse-data publishes free CSV + Parquet at static GitHub
 * release URLs. No API key required.
 *
 * This module scaffolds two modes:
 *
 *   1. LOCAL mode (default)
 *      Reads raw CSVs from `data/raw/nfl/{season}/<file>.csv`
 *      (or the path supplied to the loader). Used by the CLI's
 *      `--source local` flag and by `--dry-run`.
 *
 *   2. NETWORK mode (opt-in)
 *      Fetches the public nflverse-data release URLs. Off by
 *      default — the CLI must pass `--source nflverse` AND set
 *      `ALLOW_NFLVERSE_NETWORK_FETCH=true` in the environment to
 *      flip the kill-switch. This matches the existing
 *      ALLOW_REAL_ODDS_API_CALLS / dry-run-default pattern even
 *      though nflverse is free, so the script behaves predictably
 *      in CI.
 *
 * No paid APIs. No automated betting. No touchdown columns admitted
 * by the normalization step.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  NflGame,
  NflGameType,
  NflHomeAway,
  NflPlayerIdMap,
  NflPlayerWeekStat,
  NflPosition,
  NflProcessedBundle,
  NflRoofType,
  NflRosterPlayer,
  NflSnapCount,
  NflTeamWeekStat,
} from "./nflverse-types";

// --- public release URLs ------------------------------------------------

/**
 * Static URLs for the nflverse-data releases used by this scaffold.
 * The CLI substitutes `{season}` into the path. We expose the URL
 * builders so a future runner can verify them without hitting the
 * network.
 */
export const NFLVERSE_RELEASE_BASE =
  process.env.NFLVERSE_RELEASE_BASE ??
  "https://github.com/nflverse/nflverse-data/releases/download";

export const nflversePlayerStatsCsvUrl = (season: number): string =>
  `${NFLVERSE_RELEASE_BASE}/player_stats/player_stats_${season}.csv`;

export const nflverseSchedulesCsvUrl = (season: number): string =>
  `${NFLVERSE_RELEASE_BASE}/schedules/sched_${season}.csv`;

export const nflverseRostersCsvUrl = (season: number): string =>
  `${NFLVERSE_RELEASE_BASE}/rosters/roster_${season}.csv`;

export const nflverseSnapCountsCsvUrl = (season: number): string =>
  `${NFLVERSE_RELEASE_BASE}/snap_counts/snap_counts_${season}.csv`;

export const nflversePlayByPlayCsvUrl = (season: number): string =>
  `${NFLVERSE_RELEASE_BASE}/pbp/play_by_play_${season}.csv`;

// --- types --------------------------------------------------------------

export type NflverseSource = "nflverse" | "local";

export interface IngestionOptions {
  /** One or more seasons to ingest. */
  seasons: number[];
  /** Where to read raw CSVs from when in `local` mode. */
  rawDir: string;
  /** Where to write normalized CSVs. */
  processedDir: string;
  /** Live download is opt-in. Defaults to `local`. */
  source: NflverseSource;
  /** Dry-run prints the plan and the URLs but does NOT write files. */
  dryRun: boolean;
}

/**
 * The same warning the odds-api client uses — the network mode is
 * opt-in via env var, and any caller asking for it must also set
 * `ALLOW_NFLVERSE_NETWORK_FETCH=true`.
 */
export const NETWORK_FETCH_ENV_FLAG = "ALLOW_NFLVERSE_NETWORK_FETCH";

export function isNetworkFetchAllowed(): boolean {
  return process.env[NETWORK_FETCH_ENV_FLAG] === "true";
}

// --- CSV parsing --------------------------------------------------------

/**
 * Minimal RFC-4180 CSV parser — handles quoted fields with embedded
 * commas / newlines / escaped double quotes. Used because nflverse
 * CSV is straightforward and we don't need a dependency.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Parse a CSV string into an array of header-keyed records. Returns
 * an empty array on empty input. Skips touchdown columns at parse
 * time so we never even materialize them — V1 rule.
 */
export function parseCsvRows(
  text: string,
  options: { dropTouchdownColumns?: boolean } = {},
): Record<string, string>[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0];
  const tdColumns = new Set<number>();
  if (options.dropTouchdownColumns ?? true) {
    for (let i = 0; i < header.length; i++) {
      const h = header[i].toLowerCase();
      // Block obvious touchdown / TD columns. Includes
      // anytime_td_* / first_td_* / *_tds / passing_tds / etc.
      if (
        h.includes("touchdown") ||
        /(^|_)tds?($|_)/.test(h) ||
        /_td$/.test(h) ||
        h === "td"
      ) {
        tdColumns.add(i);
      }
    }
  }
  const out: Record<string, string>[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 1 && row[0] === "") continue;
    const rec: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) {
      if (tdColumns.has(c)) continue;
      rec[header[c]] = row[c] ?? "";
    }
    out.push(rec);
  }
  return out;
}

// --- normalization ------------------------------------------------------

function asNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "" || value === "NA" || value === "NaN")
    return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function asInt(value: string | undefined): number | null {
  const v = asNumber(value);
  if (v === undefined) return null;
  return Math.round(v);
}

function asPosition(value: string | undefined): NflPosition | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (upper === "QB" || upper === "RB" || upper === "WR" || upper === "TE")
    return upper;
  // Map common variants.
  if (upper === "FB") return "RB";
  if (upper === "HB") return "RB";
  return undefined;
}

function asGameType(value: string | undefined): NflGameType {
  if (!value) return "REG";
  const upper = value.toUpperCase();
  if (
    upper === "REG" ||
    upper === "WC" ||
    upper === "DIV" ||
    upper === "CON" ||
    upper === "SB"
  )
    return upper;
  return "POST";
}

function asRoof(value: string | undefined): NflRoofType {
  if (!value) return "unknown";
  const lower = value.toLowerCase();
  if (lower === "outdoors" || lower === "open") return "outdoors";
  if (lower === "dome" || lower === "closed") return "dome";
  if (lower === "retractable_open") return "retractable_open";
  if (lower === "retractable_closed") return "retractable_closed";
  return "unknown";
}

function asHomeAway(team: string, homeTeam: string): NflHomeAway {
  return team === homeTeam ? "HOME" : "AWAY";
}

/**
 * Normalize a single nflverse schedules row into our `NflGame`
 * shape. Rejects rows where season / week are missing.
 */
export function normalizeGameRow(
  row: Record<string, string>,
): NflGame | undefined {
  const season = asNumber(row.season);
  const week = asNumber(row.week);
  if (season === undefined || week === undefined) return undefined;
  const homeTeam = row.home_team ?? row.home;
  const awayTeam = row.away_team ?? row.away;
  if (!homeTeam || !awayTeam) return undefined;
  const gameId = row.game_id ?? `${season}-w${week}-${awayTeam}-at-${homeTeam}`;
  return {
    gameId,
    season,
    week,
    gameType: asGameType(row.game_type),
    startTimeUtc: row.gametime || row.start_time || undefined,
    homeTeam,
    awayTeam,
    homeScore: asInt(row.home_score),
    awayScore: asInt(row.away_score),
    roof: asRoof(row.roof),
    surface: row.surface || undefined,
    stadium: row.stadium || undefined,
    closingHomeSpread: asNumber(row.spread_line),
    closingTotal: asNumber(row.total_line),
  };
}

/**
 * Normalize an nflverse player_stats row. Drops touchdown stats
 * entirely (the CSV parser already removed them). Returns undefined
 * for positions outside V1 scope (we only ingest QB/RB/WR/TE).
 */
export function normalizePlayerWeekStatRow(
  row: Record<string, string>,
  gameLookup: Map<string, NflGame>,
): NflPlayerWeekStat | undefined {
  const position = asPosition(row.position);
  if (!position) return undefined;
  const season = asNumber(row.season);
  const week = asNumber(row.week);
  const team = row.recent_team || row.team;
  if (season === undefined || week === undefined || !team) return undefined;
  const opponent = row.opponent_team || row.opponent || "";
  const playerId = row.player_id || row.gsis_id || row.pfr_id || "";
  const playerName = row.player_display_name || row.player_name || "";
  if (!playerId || !playerName) return undefined;
  // Resolve the game ID by lookup (gameId is not always present on
  // player_stats rows). The fixture builder always sets it; downstream
  // backfill should run against schedules.
  const gameKey = `${season}-w${week}-${team}`;
  const gameRow = gameLookup.get(gameKey);
  const gameId = row.game_id || gameRow?.gameId || gameKey;
  const homeAway: NflHomeAway = gameRow
    ? asHomeAway(team, gameRow.homeTeam)
    : "HOME";
  return {
    playerId,
    playerName,
    position,
    team,
    opponent,
    season,
    week,
    gameId,
    homeAway,
    passingAttempts: asNumber(row.attempts ?? row.pass_attempts),
    passingCompletions: asNumber(row.completions),
    passingYards: asNumber(row.passing_yards),
    passingSacks: asNumber(row.sacks),
    rushingAttempts: asNumber(row.carries ?? row.rushing_attempts),
    rushingYards: asNumber(row.rushing_yards),
    targets: asNumber(row.targets),
    receptions: asNumber(row.receptions),
    receivingYards: asNumber(row.receiving_yards),
    receivingAirYards: asNumber(row.receiving_air_yards),
    snapShare: asNumber(row.snap_share ?? row.snap_pct),
    carryShare: asNumber(row.carry_share),
    targetShare: asNumber(row.target_share),
    airYardsShare: asNumber(row.air_yards_share),
    racr: asNumber(row.racr),
    wopr: asNumber(row.wopr),
    fantasyPoints: asNumber(row.fantasy_points),
  };
}

export function normalizeTeamWeekStatRow(
  row: Record<string, string>,
): NflTeamWeekStat | undefined {
  const season = asNumber(row.season);
  const week = asNumber(row.week);
  const team = row.team || row.posteam;
  const opponent = row.opponent || row.defteam || "";
  if (season === undefined || week === undefined || !team) return undefined;
  const gameId =
    row.game_id ?? `${season}-w${week}-${team}-vs-${opponent}`;
  const passAttempts = asNumber(row.pass_attempts);
  const rushAttempts = asNumber(row.rush_attempts);
  let passRate = asNumber(row.pass_rate);
  let rushRate = asNumber(row.rush_rate);
  if (
    passAttempts !== undefined &&
    rushAttempts !== undefined &&
    passRate === undefined
  ) {
    const total = passAttempts + rushAttempts;
    if (total > 0) {
      passRate = passAttempts / total;
      rushRate = rushAttempts / total;
    }
  }
  return {
    team,
    opponent,
    season,
    week,
    gameId,
    homeAway: (row.home_away as NflHomeAway) || "HOME",
    totalPlays: asNumber(row.total_plays ?? row.plays),
    passAttempts,
    rushAttempts,
    passRate,
    rushRate,
    secondsPerPlay: asNumber(row.seconds_per_play ?? row.sec_per_play),
    pointsFor: asNumber(row.points_for ?? row.score),
    pointsAgainst: asNumber(row.points_against ?? row.opp_score),
  };
}

export function normalizeRosterRow(
  row: Record<string, string>,
): NflRosterPlayer | undefined {
  const position = asPosition(row.position);
  const season = asNumber(row.season);
  const team = row.team || row.recent_team;
  const playerId = row.player_id || row.gsis_id || row.pfr_id || "";
  const playerName = row.full_name || row.player_name || "";
  if (!position || season === undefined || !team || !playerId || !playerName)
    return undefined;
  return {
    playerId,
    playerName,
    position,
    team,
    season,
    jerseyNumber: asNumber(row.jersey_number),
    status: (row.status as NflRosterPlayer["status"]) || undefined,
    birthDate: row.birth_date || undefined,
    depthChartRank: asNumber(row.depth_chart_position),
  };
}

export function normalizeSnapCountRow(
  row: Record<string, string>,
): NflSnapCount | undefined {
  const position = asPosition(row.position);
  const season = asNumber(row.season);
  const week = asNumber(row.week);
  const team = row.team || row.recent_team;
  const playerId = row.player_id || row.gsis_id || "";
  const playerName = row.player || row.player_name || "";
  if (
    !position ||
    season === undefined ||
    week === undefined ||
    !team ||
    !playerId
  )
    return undefined;
  const offenseSnaps = asNumber(row.offense_snaps);
  const offenseSnapShare =
    asNumber(row.offense_pct) ??
    (offenseSnaps !== undefined && asNumber(row.team_offense_snaps)
      ? offenseSnaps / (asNumber(row.team_offense_snaps) ?? 1)
      : undefined);
  return {
    playerId,
    playerName,
    position,
    team,
    season,
    week,
    gameId:
      row.game_id ?? `${season}-w${week}-${team}`,
    offenseSnaps,
    offenseSnapShare,
    defenseSnaps: asNumber(row.defense_snaps),
    stSnaps: asNumber(row.st_snaps),
  };
}

// --- writers ------------------------------------------------------------

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function toCsvLine(values: (string | number | null | undefined)[]): string {
  return values
    .map((v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    })
    .join(",");
}

export function writeCsv<T extends object>(
  filePath: string,
  rows: T[],
  headers: (keyof T)[],
): void {
  ensureDir(path.dirname(filePath));
  const headerLine = headers.map(String).join(",");
  const body = rows
    .map((r) => toCsvLine(headers.map((h) => r[h] as never)))
    .join("\n");
  fs.writeFileSync(filePath, body.length === 0 ? headerLine + "\n" : `${headerLine}\n${body}\n`);
}

// --- raw → processed pipeline -------------------------------------------

/**
 * Load and normalize all available raw CSVs under `rawDir` for the
 * supplied seasons. Returns the in-memory bundle so callers can
 * decide whether to write it out.
 */
export function loadAndNormalizeRaw(args: {
  seasons: number[];
  rawDir: string;
}): NflProcessedBundle {
  const games: NflGame[] = [];
  const playerWeekStats: NflPlayerWeekStat[] = [];
  const teamWeekStats: NflTeamWeekStat[] = [];
  const rosters: NflRosterPlayer[] = [];
  const snapCounts: NflSnapCount[] = [];
  const gameLookup = new Map<string, NflGame>();
  const playerIdMap = new Map<string, NflPlayerIdMap>();

  for (const season of args.seasons) {
    const seasonDir = path.join(args.rawDir, String(season));
    const scheduleCsv = path.join(seasonDir, "schedules.csv");
    if (fs.existsSync(scheduleCsv)) {
      const rows = parseCsvRows(fs.readFileSync(scheduleCsv, "utf8"));
      for (const r of rows) {
        const game = normalizeGameRow(r);
        if (game) {
          games.push(game);
          gameLookup.set(`${game.season}-w${game.week}-${game.homeTeam}`, game);
          gameLookup.set(`${game.season}-w${game.week}-${game.awayTeam}`, game);
        }
      }
    }
    const playerStatsCsv = path.join(seasonDir, "player_stats.csv");
    if (fs.existsSync(playerStatsCsv)) {
      const rows = parseCsvRows(fs.readFileSync(playerStatsCsv, "utf8"));
      for (const r of rows) {
        const stat = normalizePlayerWeekStatRow(r, gameLookup);
        if (stat) {
          playerWeekStats.push(stat);
          playerIdMap.set(stat.playerId, {
            playerId: stat.playerId,
            playerName: stat.playerName,
            position: stat.position,
            team: stat.team,
            lastSeason: stat.season,
          });
        }
      }
    }
    const teamStatsCsv = path.join(seasonDir, "team_stats.csv");
    if (fs.existsSync(teamStatsCsv)) {
      const rows = parseCsvRows(fs.readFileSync(teamStatsCsv, "utf8"));
      for (const r of rows) {
        const ts = normalizeTeamWeekStatRow(r);
        if (ts) teamWeekStats.push(ts);
      }
    }
    const rosterCsv = path.join(seasonDir, "rosters.csv");
    if (fs.existsSync(rosterCsv)) {
      const rows = parseCsvRows(fs.readFileSync(rosterCsv, "utf8"));
      for (const r of rows) {
        const p = normalizeRosterRow(r);
        if (p) rosters.push(p);
      }
    }
    const snapsCsv = path.join(seasonDir, "snap_counts.csv");
    if (fs.existsSync(snapsCsv)) {
      const rows = parseCsvRows(fs.readFileSync(snapsCsv, "utf8"));
      for (const r of rows) {
        const s = normalizeSnapCountRow(r);
        if (s) snapCounts.push(s);
      }
    }
  }

  return {
    games,
    playerWeekStats,
    teamWeekStats,
    rosters,
    snapCounts: snapCounts.length > 0 ? snapCounts : undefined,
    playerIds: playerIdMap.size > 0 ? Array.from(playerIdMap.values()) : undefined,
  };
}

/**
 * Write a normalized bundle into `processedDir` as a fixed set of
 * CSV files. Idempotent — overwrites existing files.
 */
export function writeProcessed(args: {
  bundle: NflProcessedBundle;
  processedDir: string;
}): { written: string[]; skipped: string[] } {
  const written: string[] = [];
  const skipped: string[] = [];
  const { bundle, processedDir } = args;
  ensureDir(processedDir);
  if (bundle.games.length > 0) {
    const file = path.join(processedDir, "games.csv");
    writeCsv(file, bundle.games, [
      "gameId",
      "season",
      "week",
      "gameType",
      "startTimeUtc",
      "homeTeam",
      "awayTeam",
      "homeScore",
      "awayScore",
      "roof",
      "surface",
      "stadium",
      "closingHomeSpread",
      "closingTotal",
    ]);
    written.push(file);
  } else {
    skipped.push("games.csv (no rows)");
  }
  if (bundle.playerWeekStats.length > 0) {
    const file = path.join(processedDir, "player_week_stats.csv");
    writeCsv(file, bundle.playerWeekStats, [
      "playerId",
      "playerName",
      "position",
      "team",
      "opponent",
      "season",
      "week",
      "gameId",
      "homeAway",
      "passingAttempts",
      "passingCompletions",
      "passingYards",
      "passingSacks",
      "rushingAttempts",
      "rushingYards",
      "targets",
      "receptions",
      "receivingYards",
      "receivingAirYards",
      "snapShare",
      "carryShare",
      "targetShare",
      "airYardsShare",
      "racr",
      "wopr",
      "fantasyPoints",
    ]);
    written.push(file);
  } else {
    skipped.push("player_week_stats.csv (no rows)");
  }
  if (bundle.teamWeekStats.length > 0) {
    const file = path.join(processedDir, "team_week_stats.csv");
    writeCsv(file, bundle.teamWeekStats, [
      "team",
      "opponent",
      "season",
      "week",
      "gameId",
      "homeAway",
      "totalPlays",
      "passAttempts",
      "rushAttempts",
      "passRate",
      "rushRate",
      "secondsPerPlay",
      "pointsFor",
      "pointsAgainst",
    ]);
    written.push(file);
  } else {
    skipped.push("team_week_stats.csv (no rows)");
  }
  if (bundle.rosters.length > 0) {
    const file = path.join(processedDir, "rosters.csv");
    writeCsv(file, bundle.rosters, [
      "playerId",
      "playerName",
      "position",
      "team",
      "season",
      "jerseyNumber",
      "status",
      "birthDate",
      "depthChartRank",
    ]);
    written.push(file);
  } else {
    skipped.push("rosters.csv (no rows)");
  }
  if (bundle.snapCounts && bundle.snapCounts.length > 0) {
    const file = path.join(processedDir, "snap_counts.csv");
    writeCsv(file, bundle.snapCounts, [
      "playerId",
      "playerName",
      "position",
      "team",
      "season",
      "week",
      "gameId",
      "offenseSnaps",
      "offenseSnapShare",
      "defenseSnaps",
      "stSnaps",
    ]);
    written.push(file);
  } else {
    skipped.push("snap_counts.csv (none)");
  }
  if (bundle.playerIds && bundle.playerIds.length > 0) {
    const file = path.join(processedDir, "player_ids.csv");
    writeCsv(file, bundle.playerIds, [
      "playerId",
      "playerName",
      "position",
      "team",
      "lastSeason",
    ]);
    written.push(file);
  }
  return { written, skipped };
}

/**
 * Build the per-season download plan WITHOUT touching the network.
 * Used by `--dry-run` and by tests.
 */
export interface NflverseDownloadPlanEntry {
  season: number;
  files: Array<{ filename: string; url: string }>;
}

export function buildNflverseDownloadPlan(
  seasons: number[],
): NflverseDownloadPlanEntry[] {
  return seasons.map((season) => ({
    season,
    files: [
      { filename: "schedules.csv", url: nflverseSchedulesCsvUrl(season) },
      { filename: "player_stats.csv", url: nflversePlayerStatsCsvUrl(season) },
      { filename: "rosters.csv", url: nflverseRostersCsvUrl(season) },
      { filename: "snap_counts.csv", url: nflverseSnapCountsCsvUrl(season) },
    ],
  }));
}
