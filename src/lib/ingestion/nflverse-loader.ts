/**
 * Loader for normalized nflverse data.
 *
 * Reads `data/processed/nfl/*.csv` (written by
 * `scripts/ingest-nfl-history.ts`) or `data/fixtures/nfl/*.json`
 * when the processed files are missing. Temporal-filter helpers
 * enforce the no-future-data-leakage rule used by the backtest:
 * features for week N of season S must only see (season < S) OR
 * (season === S AND week < N).
 *
 * Pure file IO. Never calls a network.
 */

import fs from "node:fs";
import path from "node:path";
import { parseCsvRows } from "./nflverse";
import type {
  NflGame,
  NflPlayerWeekStat,
  NflRosterPlayer,
  NflSnapCount,
  NflTeamWeekStat,
} from "./nflverse-types";

const DEFAULT_PROCESSED_DIR = path.join(
  process.cwd(),
  "data",
  "processed",
  "nfl",
);

const DEFAULT_FIXTURE_DIR = path.join(
  process.cwd(),
  "data",
  "fixtures",
  "nfl",
);

export interface LoadOptions {
  /** Override the processed CSV directory. */
  processedDir?: string;
  /** When the processed file is missing, fall back to fixtures. Default true. */
  fixtureFallback?: boolean;
}

function asNum(v: string | undefined): number | undefined {
  if (v === undefined || v === "" || v === "NA") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function loadCsvOrFixture<T>(
  args: {
    processedFile: string;
    fixtureFile: string;
    fixtureFallback: boolean;
  },
  fromRow: (row: Record<string, string>) => T | undefined,
  fromFixtureRow: (row: unknown) => T | undefined,
): T[] {
  const { processedFile, fixtureFile, fixtureFallback } = args;
  if (fs.existsSync(processedFile)) {
    const text = fs.readFileSync(processedFile, "utf8");
    const rows = parseCsvRows(text);
    const out: T[] = [];
    for (const r of rows) {
      const item = fromRow(r);
      if (item) out.push(item);
    }
    return out;
  }
  if (!fixtureFallback) return [];
  if (!fs.existsSync(fixtureFile)) return [];
  const raw = JSON.parse(fs.readFileSync(fixtureFile, "utf8"));
  const arr = Array.isArray(raw) ? raw : [];
  const out: T[] = [];
  for (const r of arr) {
    const item = fromFixtureRow(r);
    if (item) out.push(item);
  }
  return out;
}

export function loadProcessedGames(options: LoadOptions = {}): NflGame[] {
  const processedDir = options.processedDir ?? DEFAULT_PROCESSED_DIR;
  return loadCsvOrFixture<NflGame>(
    {
      processedFile: path.join(processedDir, "games.csv"),
      fixtureFile: path.join(DEFAULT_FIXTURE_DIR, "games.fixture.json"),
      fixtureFallback: options.fixtureFallback ?? true,
    },
    (row) => {
      const season = asNum(row.season);
      const week = asNum(row.week);
      if (season === undefined || week === undefined) return undefined;
      return {
        gameId: row.gameId,
        season,
        week,
        gameType: (row.gameType as NflGame["gameType"]) || "REG",
        startTimeUtc: row.startTimeUtc || undefined,
        homeTeam: row.homeTeam,
        awayTeam: row.awayTeam,
        homeScore: asNum(row.homeScore) ?? null,
        awayScore: asNum(row.awayScore) ?? null,
        roof: (row.roof as NflGame["roof"]) || "unknown",
        surface: row.surface || undefined,
        stadium: row.stadium || undefined,
        closingHomeSpread: asNum(row.closingHomeSpread),
        closingTotal: asNum(row.closingTotal),
      };
    },
    (raw) => raw as NflGame,
  );
}

export function loadProcessedPlayerWeekStats(
  options: LoadOptions = {},
): NflPlayerWeekStat[] {
  const processedDir = options.processedDir ?? DEFAULT_PROCESSED_DIR;
  return loadCsvOrFixture<NflPlayerWeekStat>(
    {
      processedFile: path.join(processedDir, "player_week_stats.csv"),
      fixtureFile: path.join(
        DEFAULT_FIXTURE_DIR,
        "player-week-stats.fixture.json",
      ),
      fixtureFallback: options.fixtureFallback ?? true,
    },
    (row) => {
      const season = asNum(row.season);
      const week = asNum(row.week);
      if (season === undefined || week === undefined) return undefined;
      const position = row.position;
      if (
        position !== "QB" &&
        position !== "RB" &&
        position !== "WR" &&
        position !== "TE"
      ) {
        return undefined;
      }
      return {
        playerId: row.playerId,
        playerName: row.playerName,
        position,
        team: row.team,
        opponent: row.opponent,
        season,
        week,
        gameId: row.gameId,
        homeAway: (row.homeAway as NflPlayerWeekStat["homeAway"]) || "HOME",
        passingAttempts: asNum(row.passingAttempts),
        passingCompletions: asNum(row.passingCompletions),
        passingYards: asNum(row.passingYards),
        passingSacks: asNum(row.passingSacks),
        rushingAttempts: asNum(row.rushingAttempts),
        rushingYards: asNum(row.rushingYards),
        targets: asNum(row.targets),
        receptions: asNum(row.receptions),
        receivingYards: asNum(row.receivingYards),
        receivingAirYards: asNum(row.receivingAirYards),
        snapShare: asNum(row.snapShare),
        carryShare: asNum(row.carryShare),
        targetShare: asNum(row.targetShare),
        airYardsShare: asNum(row.airYardsShare),
        racr: asNum(row.racr),
        wopr: asNum(row.wopr),
        fantasyPoints: asNum(row.fantasyPoints),
      };
    },
    (raw) => raw as NflPlayerWeekStat,
  );
}

export function loadProcessedTeamWeekStats(
  options: LoadOptions = {},
): NflTeamWeekStat[] {
  const processedDir = options.processedDir ?? DEFAULT_PROCESSED_DIR;
  return loadCsvOrFixture<NflTeamWeekStat>(
    {
      processedFile: path.join(processedDir, "team_week_stats.csv"),
      fixtureFile: path.join(
        DEFAULT_FIXTURE_DIR,
        "team-week-stats.fixture.json",
      ),
      fixtureFallback: options.fixtureFallback ?? true,
    },
    (row) => {
      const season = asNum(row.season);
      const week = asNum(row.week);
      if (season === undefined || week === undefined) return undefined;
      return {
        team: row.team,
        opponent: row.opponent,
        season,
        week,
        gameId: row.gameId,
        homeAway: (row.homeAway as NflTeamWeekStat["homeAway"]) || "HOME",
        totalPlays: asNum(row.totalPlays),
        passAttempts: asNum(row.passAttempts),
        rushAttempts: asNum(row.rushAttempts),
        passRate: asNum(row.passRate),
        rushRate: asNum(row.rushRate),
        secondsPerPlay: asNum(row.secondsPerPlay),
        pointsFor: asNum(row.pointsFor),
        pointsAgainst: asNum(row.pointsAgainst),
      };
    },
    (raw) => raw as NflTeamWeekStat,
  );
}

export function loadProcessedRosters(
  options: LoadOptions = {},
): NflRosterPlayer[] {
  const processedDir = options.processedDir ?? DEFAULT_PROCESSED_DIR;
  return loadCsvOrFixture<NflRosterPlayer>(
    {
      processedFile: path.join(processedDir, "rosters.csv"),
      fixtureFile: path.join(DEFAULT_FIXTURE_DIR, "rosters.fixture.json"),
      fixtureFallback: options.fixtureFallback ?? true,
    },
    (row) => {
      const season = asNum(row.season);
      const position = row.position;
      if (
        season === undefined ||
        (position !== "QB" &&
          position !== "RB" &&
          position !== "WR" &&
          position !== "TE")
      ) {
        return undefined;
      }
      return {
        playerId: row.playerId,
        playerName: row.playerName,
        position,
        team: row.team,
        season,
        jerseyNumber: asNum(row.jerseyNumber),
        status: (row.status as NflRosterPlayer["status"]) || undefined,
        birthDate: row.birthDate || undefined,
        depthChartRank: asNum(row.depthChartRank),
      };
    },
    (raw) => raw as NflRosterPlayer,
  );
}

export function loadProcessedSnapCounts(
  options: LoadOptions = {},
): NflSnapCount[] {
  const processedDir = options.processedDir ?? DEFAULT_PROCESSED_DIR;
  return loadCsvOrFixture<NflSnapCount>(
    {
      processedFile: path.join(processedDir, "snap_counts.csv"),
      fixtureFile: path.join(
        DEFAULT_FIXTURE_DIR,
        "snap-counts.fixture.json",
      ),
      fixtureFallback: options.fixtureFallback ?? true,
    },
    (row) => {
      const season = asNum(row.season);
      const week = asNum(row.week);
      const position = row.position;
      if (
        season === undefined ||
        week === undefined ||
        (position !== "QB" &&
          position !== "RB" &&
          position !== "WR" &&
          position !== "TE")
      ) {
        return undefined;
      }
      return {
        playerId: row.playerId,
        playerName: row.playerName,
        position,
        team: row.team,
        season,
        week,
        gameId: row.gameId,
        offenseSnaps: asNum(row.offenseSnaps),
        offenseSnapShare: asNum(row.offenseSnapShare),
        defenseSnaps: asNum(row.defenseSnaps),
        stSnaps: asNum(row.stSnaps),
      };
    },
    (raw) => raw as NflSnapCount,
  );
}

// --- temporal filters (no-future-data-leakage) ---------------------------

/**
 * Strict-before predicate: returns rows where (season < currentSeason)
 * OR (season === currentSeason AND week < currentWeek).
 *
 * Used by every feature-builder to guarantee no Week-N stat leaks
 * into the pregame projection for Week N.
 */
export function isStrictlyBefore(args: {
  rowSeason: number;
  rowWeek: number;
  currentSeason: number;
  currentWeek: number;
}): boolean {
  if (args.rowSeason < args.currentSeason) return true;
  if (args.rowSeason === args.currentSeason && args.rowWeek < args.currentWeek)
    return true;
  return false;
}

export function getPlayerHistoryBeforeWeek(args: {
  playerId: string;
  currentSeason: number;
  currentWeek: number;
  playerWeekStats: NflPlayerWeekStat[];
}): NflPlayerWeekStat[] {
  return args.playerWeekStats.filter(
    (r) =>
      r.playerId === args.playerId &&
      isStrictlyBefore({
        rowSeason: r.season,
        rowWeek: r.week,
        currentSeason: args.currentSeason,
        currentWeek: args.currentWeek,
      }),
  );
}

export function getTeamHistoryBeforeWeek(args: {
  team: string;
  currentSeason: number;
  currentWeek: number;
  teamWeekStats: NflTeamWeekStat[];
}): NflTeamWeekStat[] {
  return args.teamWeekStats.filter(
    (r) =>
      r.team === args.team &&
      isStrictlyBefore({
        rowSeason: r.season,
        rowWeek: r.week,
        currentSeason: args.currentSeason,
        currentWeek: args.currentWeek,
      }),
  );
}

export function getGameBySeasonWeekTeam(args: {
  season: number;
  week: number;
  team: string;
  games: NflGame[];
}): NflGame | undefined {
  return args.games.find(
    (g) =>
      g.season === args.season &&
      g.week === args.week &&
      (g.homeTeam === args.team || g.awayTeam === args.team),
  );
}
