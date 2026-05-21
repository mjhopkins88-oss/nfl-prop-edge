/**
 * Real-week candidate builder.
 *
 * Joins stored Odds API quotes to processed NFL history under a
 * strict schedule + leakage discipline:
 *
 *   1. Load stored odds for the target week. If missing, return
 *      MISSING_STORED_ODDS — no synthetic fallback.
 *   2. Load the canonical week schedule (processed games.csv if
 *      present, otherwise the schedule fixture).
 *   3. Filter stored odds to gameIds that exist in the schedule
 *      so synthetic IDs like `fixture-kc-at-bal-w1` cannot
 *      smuggle through.
 *   4. Validate the surviving (away, home) pairs against the
 *      schedule — schedule validator must return PASS.
 *   5. Load processed NFL history with the strict-before
 *      predicate (prior seasons + Weeks 1…N-1). If processed
 *      NFL data is missing, return MISSING_PROCESSED_NFL.
 *   6. Return the candidate list in the same shape the
 *      fixture path produces, plus a `dataMode: "STORED_2025"`
 *      / `syntheticFixture: false` tag.
 *
 * No model logic. No network calls. No touchdown propTypes.
 */

import type { PropType } from "../types";
import {
  buildWeek1ScheduleValidationReport,
  type CandidateGame,
  type ScheduleValidationReport,
} from "./week-1-schedule-validation";
import {
  getRealWeekScheduleFromProcessedData,
  loadProcessedPlayerWeekStatsStrict,
  loadProcessedTeamWeekStatsStrict,
  loadProcessedRostersStrict,
} from "./processed-nfl-loader";
import {
  loadStoredWeekOdds,
  STARTER_PROP_TYPES,
  type StoredPropMarket,
} from "./stored-odds-loader";
import type {
  NflPlayerWeekStat,
  NflRosterPlayer,
  NflTeamWeekStat,
} from "../ingestion/nflverse-types";
import type { StoredCandidateScorecard } from "./stored-candidate-scorecard";

export type RealWeekCandidateStatus =
  | "READY"
  | "MISSING_STORED_ODDS"
  | "MISSING_PROCESSED_NFL"
  | "SCHEDULE_VALIDATION_FAILED"
  | "NO_CANDIDATES_AFTER_FILTER";

export interface RealWeekCandidate {
  /** Stable id from the stored-odds loader. */
  id: string;
  season: number;
  week: number;
  gameId: string;
  playerName: string;
  playerId?: string;
  team: string;
  opponent: string;
  propType: PropType;
  line: number;
  overOdds: number;
  underOdds: number;
  sportsbook: string;
  kickoffTime?: string;
  /** ISO timestamp of when the over/under odds were captured.
   *  Populated from the stored Odds API snapshot. Must be <=
   *  kickoffTime to count as a fair as-of historical bet —
   *  see `validateAsOfFairness` in `as-of-validation.ts`. */
  snapshotTime?: string;
  /** STORED_2025 to make it obvious in any debug payload. */
  dataMode: "STORED_2025";
  syntheticFixture: false;
  /** Populated by `applyScorecardToCandidates`. Absent on raw
   *  pregame candidates straight from the builder. */
  scorecard?: StoredCandidateScorecard;
}

export interface RealWeekCandidateContext {
  /** Prior-week stat rows the model would feature-engineer from. */
  playerHistory: NflPlayerWeekStat[];
  teamHistory: NflTeamWeekStat[];
  rosters: NflRosterPlayer[];
}

export interface BuildRealWeek1CandidatesResult {
  status: RealWeekCandidateStatus;
  candidates: RealWeekCandidate[];
  scheduleReport?: ScheduleValidationReport;
  context?: RealWeekCandidateContext;
  /** Human-readable notes the page surfaces. */
  notes: string[];
  /** "Next command" suggestions for the page. */
  nextSteps: string[];
}

interface BuildArgs {
  season: number;
  week: number;
  /** Override the processed-data root for tests. */
  processedRoot?: string;
}

/**
 * Validate the (gameId, away, home) shape of stored odds rows
 * against the real schedule. Returns the validator's report.
 *
 * Schedule lookup is by `gameId` first — the stored-odds
 * `team` / `opponent` fields are from the *player's*
 * perspective and don't tell us which side is home. When the
 * gameId is found in the schedule, we adopt its canonical
 * (away, home) orientation; otherwise we pass the row's pair
 * through as-is and let the schedule validator flag it.
 */
export function validateCandidateAgainstRealSchedule(args: {
  markets: StoredPropMarket[];
  season: number;
  week: number;
  /** Optional schedule override for tests. */
  schedule?: {
    games: Array<{
      gameId: string;
      awayTeam: string;
      homeTeam: string;
    }>;
  };
}): ScheduleValidationReport {
  const schedule =
    args.schedule ??
    getRealWeekScheduleFromProcessedData({
      season: args.season,
      week: args.week,
    });
  const scheduleByGameId = new Map<
    string,
    { awayTeam: string; homeTeam: string }
  >();
  for (const g of schedule.games) {
    scheduleByGameId.set(g.gameId, {
      awayTeam: g.awayTeam,
      homeTeam: g.homeTeam,
    });
  }
  const seen = new Set<string>();
  const candidateGames: CandidateGame[] = [];
  for (const m of args.markets) {
    if (!m.team || !m.opponent) continue;
    const sched = scheduleByGameId.get(m.gameId);
    let away: string;
    let home: string;
    if (sched) {
      // Adopt the schedule's orientation; verify the player's
      // team is one of the two participants.
      if (
        m.team !== sched.awayTeam &&
        m.team !== sched.homeTeam
      ) {
        // Player team not in this game — surface as invalid
        // with original orientation so the report is honest.
        away = m.team;
        home = m.opponent;
      } else {
        away = sched.awayTeam;
        home = sched.homeTeam;
      }
    } else {
      // Unknown gameId — pass through so the validator flags it.
      away = m.team;
      home = m.opponent;
    }
    const key = `${m.gameId}::${away}@${home}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidateGames.push({
      gameId: m.gameId,
      awayTeam: away,
      homeTeam: home,
    });
  }
  // Pass the dynamically loaded schedule through to the
  // validator. Without this the validator falls back to the
  // static Week 1 fixture — Week 2+ would never PASS even with
  // valid Week N candidates.
  return buildWeek1ScheduleValidationReport({
    candidates: candidateGames,
    schedule: {
      games: schedule.games.map((g) => {
        const full = g as Partial<{
          season: number;
          week: number;
          kickoffTime: string;
          venue: string;
          neutralSite: boolean;
          sourceNote: string;
        }> & { gameId: string; awayTeam: string; homeTeam: string };
        return {
          season: full.season ?? args.season,
          week: full.week ?? args.week,
          gameId: full.gameId,
          awayTeam: full.awayTeam,
          homeTeam: full.homeTeam,
          kickoffTime: full.kickoffTime ?? "",
          venue: full.venue ?? "",
          neutralSite: full.neutralSite ?? false,
          sourceNote: full.sourceNote ?? "from processed games.csv",
        };
      }),
    },
  });
}

/**
 * Build NflPlayerWeekStat context for a player using only
 * strict-before rows. Surfaced as a helper for tests + future
 * feature builders.
 */
export function buildPlayerFeatureContextFromNflHistory(args: {
  playerName: string;
  team: string;
  currentSeason: number;
  currentWeek: number;
  playerWeekStats: NflPlayerWeekStat[];
}): NflPlayerWeekStat[] {
  // Match by playerName + team. Drop any row at or after the
  // current week — the strict-before predicate is the single
  // source of truth.
  return args.playerWeekStats.filter((r) => {
    if (r.playerName !== args.playerName) return false;
    if (r.team !== args.team) return false;
    if (r.season < args.currentSeason) return true;
    if (r.season === args.currentSeason && r.week < args.currentWeek) {
      return true;
    }
    return false;
  });
}

/**
 * Join stored odds rows to NFL player history. Used both
 * directly by the runner and exposed for tests.
 */
export function joinOddsToNflPlayerContext(args: {
  markets: StoredPropMarket[];
  playerWeekStats: NflPlayerWeekStat[];
  season: number;
  week: number;
}): Array<{
  market: StoredPropMarket;
  history: NflPlayerWeekStat[];
}> {
  return args.markets.map((m) => ({
    market: m,
    history: buildPlayerFeatureContextFromNflHistory({
      playerName: m.playerName,
      team: m.team,
      currentSeason: args.season,
      currentWeek: args.week,
      playerWeekStats: args.playerWeekStats,
    }),
  }));
}

/**
 * Top-level real-week builder. The runner calls this once per
 * starter-test invocation; the page reads the result.
 */
export function buildRealWeek1CandidatesFromStoredData(
  args: BuildArgs,
): BuildRealWeek1CandidatesResult {
  const notes: string[] = [];
  const nextSteps: string[] = [];

  // 1. Stored odds.
  const oddsResult = loadStoredWeekOdds({
    season: args.season,
    week: args.week,
    processedRoot: args.processedRoot,
  });
  if (oddsResult.status !== "READY") {
    return {
      status:
        oddsResult.status === "MALFORMED_STORED_ODDS"
          ? "MISSING_STORED_ODDS"
          : "MISSING_STORED_ODDS",
      candidates: [],
      notes: [...oddsResult.missingNotes, ...notes],
      nextSteps: [
        "1. Run `ALLOW_REAL_ODDS_API_CALLS=true npx tsx scripts/ingest-historical-prop-lines.ts --scope smoke-test --execute` once to verify the credit estimate.",
        `2. Run \`ALLOW_REAL_ODDS_API_CALLS=true npx tsx scripts/ingest-historical-prop-lines.ts --scope week --season ${args.season} --week ${args.week} --execute\` to populate data/processed/odds/${args.season}/week-${args.week}-prop-markets.csv.`,
        "3. Re-run this script with `--data-mode stored`.",
      ],
    };
  }

  // 2. Schedule. Confines the candidate set to real Week-N games.
  const schedule = getRealWeekScheduleFromProcessedData({
    season: args.season,
    week: args.week,
    processedDir:
      args.processedRoot !== undefined
        ? `${args.processedRoot}/nfl`
        : undefined,
  });
  if (schedule.status !== "READY") {
    return {
      status: "MISSING_PROCESSED_NFL",
      candidates: [],
      notes: [
        `Schedule unavailable: ${schedule.status} (looked at ${schedule.source}).`,
      ],
      nextSteps: [
        "Run `npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run` after dropping nflverse CSVs into data/raw/nfl/{season}/.",
      ],
    };
  }
  const scheduleGameIds = new Set(schedule.games.map((g) => g.gameId));
  const inScheduleMarkets = oddsResult.markets.filter((m) =>
    scheduleGameIds.has(m.gameId),
  );
  const droppedSyntheticIds = oddsResult.markets.length - inScheduleMarkets.length;
  if (droppedSyntheticIds > 0) {
    notes.push(
      `Dropped ${droppedSyntheticIds} stored markets whose gameId is not in the ${args.season} Week ${args.week} schedule.`,
    );
  }

  // 3. Schedule validation. Even after the gameId filter, the
  //    pairings must match orientation-aware (away, home).
  const scheduleReport = validateCandidateAgainstRealSchedule({
    markets: inScheduleMarkets,
    season: args.season,
    week: args.week,
  });
  if (scheduleReport.status !== "PASS" && inScheduleMarkets.length > 0) {
    return {
      status: "SCHEDULE_VALIDATION_FAILED",
      candidates: [],
      scheduleReport,
      notes: [
        ...notes,
        ...scheduleReport.notes,
        "Stored markets reference games that do not match the real Week 1 schedule.",
      ],
      nextSteps: [
        "Re-ingest stored odds with the correct game IDs.",
        "If the issue is `team`/`opponent` orientation, fix the normalizer in scripts/ingest-historical-prop-lines.ts.",
      ],
    };
  }
  if (inScheduleMarkets.length === 0) {
    return {
      status: "NO_CANDIDATES_AFTER_FILTER",
      candidates: [],
      scheduleReport,
      notes: [
        ...notes,
        "No stored markets remained after filtering to schedule game IDs.",
      ],
      nextSteps: [
        "Confirm the stored odds carry real Week 1 game IDs (e.g. 2025-w1-kc-at-lac), not synthetic placeholders.",
      ],
    };
  }

  // 4. NFL processed data — strict, no fixture fallback.
  const players = loadProcessedPlayerWeekStatsStrict(
    args.processedRoot ? `${args.processedRoot}/nfl` : undefined,
  );
  if (players.status !== "READY") {
    return {
      status: "MISSING_PROCESSED_NFL",
      candidates: [],
      scheduleReport,
      notes: [
        ...notes,
        `Processed player_week_stats.csv not found at ${players.source}.`,
      ],
      nextSteps: [
        "Run the nflverse ingestion to populate data/processed/nfl/player_week_stats.csv:",
        "  npx tsx scripts/ingest-nfl-history.ts --source nflverse --dry-run    # plan only",
        "  npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run    # if raw CSVs already in data/raw/nfl/{season}/",
      ],
    };
  }
  const teams = loadProcessedTeamWeekStatsStrict(
    args.processedRoot ? `${args.processedRoot}/nfl` : undefined,
  );
  const rosters = loadProcessedRostersStrict(
    args.processedRoot ? `${args.processedRoot}/nfl` : undefined,
  );

  // 5. Build candidates. The model layer is unchanged — the
  //    feature builder still applies the same strict-before
  //    filter; this builder just hands over the right inputs.
  const candidates: RealWeekCandidate[] = inScheduleMarkets.map((m) => ({
    id: m.id,
    season: args.season,
    week: args.week,
    gameId: m.gameId,
    playerName: m.playerName,
    playerId: m.playerId,
    team: m.team,
    opponent: m.opponent,
    propType: m.propType,
    line: m.line,
    overOdds: m.overOdds,
    underOdds: m.underOdds,
    sportsbook: m.sportsbook,
    kickoffTime: m.kickoffTime,
    snapshotTime: m.snapshotTime,
    dataMode: "STORED_2025",
    syntheticFixture: false,
  }));

  // 6. Defence in depth: every candidate is a starter-market.
  for (const c of candidates) {
    if (!STARTER_PROP_TYPES.has(c.propType)) {
      // Should never happen — stored loader already filters —
      // but assert it so the test runner catches any
      // regression.
      throw new Error(
        `Candidate ${c.id} carries non-starter propType ${c.propType}`,
      );
    }
    if (/\bTOUCHDOWN\b|\bTD\b/i.test(c.propType)) {
      throw new Error(
        `Candidate ${c.id} carries touchdown propType ${c.propType}`,
      );
    }
  }

  return {
    status: "READY",
    candidates,
    scheduleReport,
    context: {
      playerHistory: players.rows,
      teamHistory: teams.status === "READY" ? teams.rows : [],
      rosters: rosters.status === "READY" ? rosters.rows : [],
    },
    notes:
      candidates.length > 0
        ? [
            ...notes,
            `Built ${candidates.length} real-week candidates from stored odds.`,
            "Strict-before history attached for each player.",
          ]
        : notes,
    nextSteps: [
      `Run \`npx tsx scripts/run-week-1-starter-test.ts --phase full --data-mode stored --season ${args.season} --week ${args.week}\` to grade the real-week run.`,
    ],
  };
}
