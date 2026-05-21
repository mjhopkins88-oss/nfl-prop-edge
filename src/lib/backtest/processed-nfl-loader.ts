/**
 * Strict (no-fixture-fallback) NFL data loader for the real
 * Week 1 stored-data path.
 *
 * Wraps the existing `src/lib/ingestion/nflverse-loader.ts`
 * helpers but disables the fixture fallback so the runner can
 * tell the difference between "real processed data present" and
 * "missing — fall back to synthetic." Used by the real-week
 * candidate builder.
 *
 * Pure file IO. No network calls.
 */

import fs from "node:fs";
import path from "node:path";
import {
  getGameBySeasonWeekTeam,
  getPlayerHistoryBeforeWeek,
  getTeamHistoryBeforeWeek,
  isStrictlyBefore,
  loadProcessedGames,
  loadProcessedPlayerWeekStats,
  loadProcessedRosters,
  loadProcessedSnapCounts,
  loadProcessedTeamWeekStats,
} from "../ingestion/nflverse-loader";
import type {
  NflGame,
  NflPlayerWeekStat,
  NflRosterPlayer,
  NflSnapCount,
  NflTeamWeekStat,
} from "../ingestion/nflverse-types";
import {
  getExpectedWeek1Schedule,
  type ExpectedWeek1Game,
} from "./week-1-schedule-validation";

const DEFAULT_PROCESSED_DIR = path.join(
  process.cwd(),
  "data",
  "processed",
  "nfl",
);

export interface ProcessedNflLoadResult<T> {
  status: "READY" | "MISSING";
  rows: T[];
  /** Path the loader looked at — surfaced for hints + tests. */
  source: string;
}

/**
 * Re-export the underlying loaders + temporal predicate so
 * callers can grab everything from one module.
 */
export {
  getGameBySeasonWeekTeam,
  getPlayerHistoryBeforeWeek,
  getTeamHistoryBeforeWeek,
  isStrictlyBefore,
  loadProcessedGames,
  loadProcessedPlayerWeekStats,
  loadProcessedRosters,
  loadProcessedSnapCounts,
  loadProcessedTeamWeekStats,
};

function hasProcessedFile(processedDir: string, name: string): boolean {
  return fs.existsSync(path.join(processedDir, name));
}

/**
 * Load processed games WITHOUT fixture fallback. Returns
 * `MISSING` when `data/processed/nfl/games.csv` is absent.
 */
export function loadProcessedNflGames(
  processedDir = DEFAULT_PROCESSED_DIR,
): ProcessedNflLoadResult<NflGame> {
  const source = path.join(processedDir, "games.csv");
  if (!hasProcessedFile(processedDir, "games.csv")) {
    return { status: "MISSING", rows: [], source };
  }
  const rows = loadProcessedGames({ processedDir, fixtureFallback: false });
  return { status: "READY", rows, source };
}

export function loadProcessedPlayerWeekStatsStrict(
  processedDir = DEFAULT_PROCESSED_DIR,
): ProcessedNflLoadResult<NflPlayerWeekStat> {
  const source = path.join(processedDir, "player_week_stats.csv");
  if (!hasProcessedFile(processedDir, "player_week_stats.csv")) {
    return { status: "MISSING", rows: [], source };
  }
  const rows = loadProcessedPlayerWeekStats({
    processedDir,
    fixtureFallback: false,
  });
  return { status: "READY", rows, source };
}

export function loadProcessedTeamWeekStatsStrict(
  processedDir = DEFAULT_PROCESSED_DIR,
): ProcessedNflLoadResult<NflTeamWeekStat> {
  const source = path.join(processedDir, "team_week_stats.csv");
  if (!hasProcessedFile(processedDir, "team_week_stats.csv")) {
    return { status: "MISSING", rows: [], source };
  }
  const rows = loadProcessedTeamWeekStats({
    processedDir,
    fixtureFallback: false,
  });
  return { status: "READY", rows, source };
}

export function loadProcessedRostersStrict(
  processedDir = DEFAULT_PROCESSED_DIR,
): ProcessedNflLoadResult<NflRosterPlayer> {
  const source = path.join(processedDir, "rosters.csv");
  if (!hasProcessedFile(processedDir, "rosters.csv")) {
    return { status: "MISSING", rows: [], source };
  }
  const rows = loadProcessedRosters({
    processedDir,
    fixtureFallback: false,
  });
  return { status: "READY", rows, source };
}

export function loadProcessedSnapCountsStrict(
  processedDir = DEFAULT_PROCESSED_DIR,
): ProcessedNflLoadResult<NflSnapCount> {
  const source = path.join(processedDir, "snap_counts.csv");
  if (!hasProcessedFile(processedDir, "snap_counts.csv")) {
    return { status: "MISSING", rows: [], source };
  }
  const rows = loadProcessedSnapCounts({
    processedDir,
    fixtureFallback: false,
  });
  return { status: "READY", rows, source };
}

/**
 * Strict-before player history. Wraps the existing predicate so
 * callers don't import from two places.
 */
export function getPriorPlayerHistoryForWeek(args: {
  playerId: string;
  currentSeason: number;
  currentWeek: number;
  playerWeekStats: NflPlayerWeekStat[];
}): NflPlayerWeekStat[] {
  return getPlayerHistoryBeforeWeek(args);
}

export function getPriorTeamHistoryForWeek(args: {
  team: string;
  currentSeason: number;
  currentWeek: number;
  teamWeekStats: NflTeamWeekStat[];
}): NflTeamWeekStat[] {
  return getTeamHistoryBeforeWeek(args);
}

/**
 * Get the canonical Week-N schedule. Prefers processed
 * `games.csv` rows for the target week when present, falls back
 * to the static schedule fixture (Week 1 2025 only today).
 *
 * Returns the games as plain `ExpectedWeek1Game` shape so the
 * schedule validator can consume them without conversion.
 */
export function getRealWeekScheduleFromProcessedData(args: {
  season: number;
  week: number;
  processedDir?: string;
}): {
  status: "READY" | "MISSING_FOR_WEEK" | "PROCESSED_ABSENT";
  source: string;
  games: ExpectedWeek1Game[];
} {
  const processedDir = args.processedDir ?? DEFAULT_PROCESSED_DIR;
  const processedGames = loadProcessedNflGames(processedDir);
  if (processedGames.status === "READY") {
    const weekGames = processedGames.rows.filter(
      (g) => g.season === args.season && g.week === args.week,
    );
    if (weekGames.length === 0) {
      return {
        status: "MISSING_FOR_WEEK",
        source: processedGames.source,
        games: [],
      };
    }
    return {
      status: "READY",
      source: processedGames.source,
      games: weekGames.map((g) => ({
        season: g.season,
        week: g.week,
        gameId: g.gameId,
        awayTeam: g.awayTeam,
        homeTeam: g.homeTeam,
        kickoffTime: g.startTimeUtc ?? "",
        venue: g.stadium ?? "",
        neutralSite: false,
        sourceNote: "processed data/processed/nfl/games.csv",
      })),
    };
  }
  // Fall back to the schedule fixture — Week 1 2025 only today.
  if (args.season === 2025 && args.week === 1) {
    const fixture = getExpectedWeek1Schedule();
    return {
      status: "READY",
      source: "data/fixtures/nfl/2025-week-1-schedule.fixture.json",
      games: fixture.games,
    };
  }
  return {
    status: "PROCESSED_ABSENT",
    source: processedGames.source,
    games: [],
  };
}
