/**
 * 2025 Week 1 schedule validation.
 *
 * Loads the authoritative Week 1 schedule from
 * `data/fixtures/nfl/2025-week-1-schedule.fixture.json` and
 * cross-checks the runner's candidate games against it. Used by:
 *
 *   - the Week 1 starter-test runner, which writes the
 *     validation report to disk and propagates the status into
 *     the locked recommendations file.
 *   - `/backtest/week-1`, which renders a "Schedule Validation"
 *     panel + a top-level synthetic-fixture banner when the
 *     status is FAIL / SYNTHETIC_ONLY.
 *   - `scripts/test-week-1-schedule-validation.ts`.
 *
 * Pure file IO + comparison logic. No network calls.
 */

import fs from "node:fs";
import path from "node:path";

export interface ExpectedWeek1Game {
  season: number;
  week: number;
  gameId: string;
  awayTeam: string;
  homeTeam: string;
  kickoffTime: string;
  venue: string;
  neutralSite: boolean;
  sourceNote: string;
}

export interface ExpectedWeek1Schedule {
  season: number;
  week: number;
  sourceNote: string;
  lastUpdated: string;
  games: ExpectedWeek1Game[];
}

export interface CandidateGame {
  /** Synthetic gameId from the runner's input fixtures. */
  gameId: string;
  homeTeam: string;
  awayTeam: string;
}

/**
 * Status enum surfaced through the locked-recommendations file
 * and the UI banner. PASS means every candidate game maps to a
 * real Week 1 matchup; FAIL means at least one candidate is
 * invalid; SYNTHETIC_ONLY means all candidate games are
 * structurally synthetic (every gameId is invalid).
 */
export type ScheduleValidationStatus = "PASS" | "FAIL" | "SYNTHETIC_ONLY";

export interface CandidateValidation {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  valid: boolean;
  matchedRealGameId?: string;
  reason?: string;
}

export interface ScheduleValidationReport {
  generatedAt: string;
  season: number;
  week: number;
  scheduleSource: string;
  expectedGames: number;
  candidateGames: number;
  validCandidateGames: number;
  invalidCandidateGames: number;
  status: ScheduleValidationStatus;
  /** True only when every candidate game appears in the real schedule. */
  realWeek1BacktestReady: boolean;
  /** True when the candidate set is structurally synthetic. */
  syntheticFixture: boolean;
  candidates: CandidateValidation[];
  notes: string[];
}

const DEFAULT_SCHEDULE_PATH = path.join(
  process.cwd(),
  "data",
  "fixtures",
  "nfl",
  "2025-week-1-schedule.fixture.json",
);

let cachedSchedule: ExpectedWeek1Schedule | undefined;

/**
 * Load the static 2025 Week 1 schedule. Cached on first read.
 * Throws when the schedule file is missing — it's a checked-in
 * fixture, so missing-file is a real bug worth surfacing.
 */
export function getExpectedWeek1Schedule(
  options: { schedulePath?: string; forceReload?: boolean } = {},
): ExpectedWeek1Schedule {
  if (!options.forceReload && cachedSchedule) return cachedSchedule;
  const filePath = options.schedulePath ?? DEFAULT_SCHEDULE_PATH;
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Expected Week 1 schedule fixture not found at ${filePath}`,
    );
  }
  const parsed = JSON.parse(
    fs.readFileSync(filePath, "utf8"),
  ) as ExpectedWeek1Schedule;
  // Defence in depth: the schedule fixture must not carry final
  // scores. This module is for pregame validation only.
  for (const g of parsed.games as unknown as Array<Record<string, unknown>>) {
    if (
      g.homeScore !== undefined ||
      g.awayScore !== undefined ||
      g.winner !== undefined ||
      g.score !== undefined
    ) {
      throw new Error(
        `Schedule fixture for game ${g.gameId} carries a forbidden score / winner field`,
      );
    }
  }
  cachedSchedule = parsed;
  return parsed;
}

/**
 * Is this {away,home} pairing a Week 1 game in the loaded
 * schedule? Returns the canonical real gameId when matched.
 */
export function validateCandidateGamesAgainstSchedule(
  candidates: CandidateGame[],
  schedule: ExpectedWeek1Schedule = getExpectedWeek1Schedule(),
): CandidateValidation[] {
  const pairKey = (away: string, home: string): string =>
    `${away.toUpperCase()}@${home.toUpperCase()}`;
  const expectedByPair = new Map<string, ExpectedWeek1Game>();
  const expectedByTeamSet = new Map<string, ExpectedWeek1Game>();
  for (const g of schedule.games) {
    expectedByPair.set(pairKey(g.awayTeam, g.homeTeam), g);
    const teamSetKey = [g.awayTeam, g.homeTeam].sort().join("+");
    expectedByTeamSet.set(teamSetKey, g);
  }
  return candidates.map((c) => {
    const direct = expectedByPair.get(pairKey(c.awayTeam, c.homeTeam));
    if (direct) {
      return {
        gameId: c.gameId,
        homeTeam: c.homeTeam,
        awayTeam: c.awayTeam,
        valid: true,
        matchedRealGameId: direct.gameId,
      };
    }
    const swapped = expectedByPair.get(pairKey(c.homeTeam, c.awayTeam));
    if (swapped) {
      return {
        gameId: c.gameId,
        homeTeam: c.homeTeam,
        awayTeam: c.awayTeam,
        valid: false,
        reason: `Home/away reversed — real Week 1 was ${swapped.awayTeam} @ ${swapped.homeTeam}`,
      };
    }
    const teamSetKey = [c.awayTeam, c.homeTeam].sort().join("+");
    const sameTeams = expectedByTeamSet.get(teamSetKey);
    if (sameTeams) {
      return {
        gameId: c.gameId,
        homeTeam: c.homeTeam,
        awayTeam: c.awayTeam,
        valid: false,
        reason: `Same teams but different orientation — real Week 1 was ${sameTeams.awayTeam} @ ${sameTeams.homeTeam}`,
      };
    }
    return {
      gameId: c.gameId,
      homeTeam: c.homeTeam,
      awayTeam: c.awayTeam,
      valid: false,
      reason: `${c.awayTeam} did not play ${c.homeTeam} in 2025 Week 1`,
    };
  });
}

/**
 * Convenience wrapper. Returns PASS / FAIL / SYNTHETIC_ONLY
 * given a candidate-validation list.
 */
export function validateWeek1FixtureSchedule(
  candidates: CandidateGame[],
  schedule: ExpectedWeek1Schedule = getExpectedWeek1Schedule(),
): ScheduleValidationStatus {
  if (candidates.length === 0) return "SYNTHETIC_ONLY";
  const results = validateCandidateGamesAgainstSchedule(candidates, schedule);
  const validCount = results.filter((r) => r.valid).length;
  if (validCount === results.length) return "PASS";
  if (validCount === 0) return "SYNTHETIC_ONLY";
  return "FAIL";
}

/**
 * Full validation report — what the runner writes to
 * `data/backtests/2025/week-1-schedule-validation.fixture.json`
 * and what the page renders.
 */
export function buildWeek1ScheduleValidationReport(args: {
  candidates: CandidateGame[];
  schedulePath?: string;
  scheduleSource?: string;
}): ScheduleValidationReport {
  const schedule = getExpectedWeek1Schedule({
    schedulePath: args.schedulePath,
  });
  const candidateResults = validateCandidateGamesAgainstSchedule(
    args.candidates,
    schedule,
  );
  const validCount = candidateResults.filter((r) => r.valid).length;
  const invalidCount = candidateResults.length - validCount;
  const status: ScheduleValidationStatus =
    candidateResults.length === 0
      ? "SYNTHETIC_ONLY"
      : validCount === candidateResults.length
        ? "PASS"
        : validCount === 0
          ? "SYNTHETIC_ONLY"
          : "FAIL";
  const realWeek1BacktestReady = status === "PASS";
  const syntheticFixture = status !== "PASS";
  const notes: string[] = [];
  if (status === "SYNTHETIC_ONLY") {
    notes.push(
      "All candidate games are synthetic placeholders — no overlap with the real 2025 Week 1 schedule.",
    );
  } else if (status === "FAIL") {
    notes.push(
      "At least one candidate game does not match the real 2025 Week 1 schedule.",
    );
  } else {
    notes.push("Every candidate game maps to a real 2025 Week 1 matchup.");
  }
  if (!realWeek1BacktestReady) {
    notes.push(
      "Real Week 1 backtest is NOT ready — wire processed Odds API + nflverse data and re-run.",
    );
    notes.push("Real Week 1 odds not loaded yet.");
    notes.push("Run stored odds ingestion before real Week 1 simulation.");
  }
  return {
    generatedAt: new Date().toISOString(),
    season: schedule.season,
    week: schedule.week,
    scheduleSource:
      args.scheduleSource ??
      "data/fixtures/nfl/2025-week-1-schedule.fixture.json",
    expectedGames: schedule.games.length,
    candidateGames: candidateResults.length,
    validCandidateGames: validCount,
    invalidCandidateGames: invalidCount,
    status,
    realWeek1BacktestReady,
    syntheticFixture,
    candidates: candidateResults,
    notes,
  };
}
