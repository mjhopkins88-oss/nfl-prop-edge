/**
 * Week 1 stored-backtest grading assertions.
 *
 *   · gradeStoredWeek1Backtest looks up actuals from
 *     player_week_stats and grades each candidate's OVER + UNDER
 *     sides at the recorded book odds
 *   · candidate count is unchanged after grading (grading never
 *     adds, drops, or reorders the pregame set)
 *   · push / no-stat / clear-winner outcomes are classified
 *     correctly
 *   · profit-per-unit math respects American odds (positive +
 *     negative)
 *   · aggregate hit rate and ROI match the per-candidate sum
 *   · admin runner's grade-week1-stored action saves to DB +
 *     writes a file mirror that the monitor loader picks up
 *   · /monitor snapshot reports gradingStatus="graded" with the
 *     populated `graded` block
 *   · the fixture starter-test's hit rate / ROI never leak into
 *     the graded snapshot type (snapshot has no .hitRate /
 *     .roiPct field on the root)
 *   · no Odds API call, no Kalshi, no touchdown markets, no
 *     automated betting hooks
 *
 * Pure file IO + arithmetic. No paid API. No spawn (the admin
 * action runs in-process for `grade-week1-stored` since it
 * doesn't need a subprocess).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  americanToDecimal,
  americanToProfit,
  gradeStoredWeek1Backtest,
} from "../src/lib/backtest/week-1-grading";
import { inMemoryPersistenceClient } from "../src/lib/persistence/week-1-persistence";
import { runAdminAction } from "../src/lib/admin/admin-runner";
import { loadStoredWeek1MonitorSnapshot } from "../src/lib/backtest/week-1-monitor-summary";
import type { RealWeekCandidate } from "../src/lib/backtest/real-week-candidate-builder";

interface Failure {
  scenario: string;
  reasons: string[];
}
const FAILURES: Failure[] = [];
function check(report: Failure, predicate: boolean, reason: string): void {
  if (!predicate) report.reasons.push(reason);
}
function record(report: Failure): void {
  if (report.reasons.length > 0) FAILURES.push(report);
}
function makeReport(scenario: string): Failure {
  return { scenario, reasons: [] };
}
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function candidate(
  partial: Partial<RealWeekCandidate> & {
    playerName: string;
    propType: RealWeekCandidate["propType"];
    line: number;
  },
): RealWeekCandidate {
  const base: RealWeekCandidate = {
    id: `cand-${partial.playerName.replace(/\s+/g, "-")}-${partial.propType}-${partial.line}`,
    season: 2025,
    week: 1,
    gameId: "2025-w1-kc-at-lac",
    playerName: partial.playerName,
    team: "KC",
    opponent: "LAC",
    propType: partial.propType,
    line: partial.line,
    overOdds: -110,
    underOdds: -110,
    sportsbook: "DraftKings",
    kickoffTime: "2025-09-06T00:00:00Z",
    dataMode: "STORED_2025",
    syntheticFixture: false,
  };
  return { ...base, ...partial };
}

interface FakeStat {
  playerId: string;
  playerName: string;
  position: "QB" | "RB" | "WR" | "TE";
  team: string;
  opponent: string;
  season: number;
  week: number;
  gameId: string;
  homeAway: "HOME" | "AWAY";
  passingAttempts?: number;
  passingCompletions?: number;
  receptions?: number;
  rushingAttempts?: number;
}

function statRow(p: {
  playerName: string;
  team: string;
  passingAttempts?: number;
  passingCompletions?: number;
  receptions?: number;
  rushingAttempts?: number;
}): FakeStat {
  return {
    playerId: `00-${p.playerName.toLowerCase().replace(/\s+/g, "-")}`,
    playerName: p.playerName,
    position: "QB",
    team: p.team,
    opponent: "",
    season: 2025,
    week: 1,
    gameId: "2025-w1-kc-at-lac",
    homeAway: "AWAY",
    passingAttempts: p.passingAttempts,
    passingCompletions: p.passingCompletions,
    receptions: p.receptions,
    rushingAttempts: p.rushingAttempts,
  };
}

function makeTempRepo(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nfl-prop-edge-grading-"),
  );
  fs.mkdirSync(path.join(dir, "data", "backtests", "2025"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "data", "processed", "odds", "2025"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "data", "processed", "nfl"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "data", "admin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "admin-ingestion"), {
    recursive: true,
  });
  return dir;
}

function writeCsv(p: string, header: string[], rows: (string | number)[][]): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = [header.join(",")]
    .concat(rows.map((r) => r.map(String).join(",")))
    .join("\n");
  fs.writeFileSync(p, body + "\n");
}

async function main(): Promise<void> {
  console.log("Week 1 stored-backtest grading — assertions");
  console.log("=============================================");

  // 1. American-odds helpers.
  {
    const r = makeReport("americanToDecimal / americanToProfit");
    check(
      r,
      Math.abs(americanToDecimal(-110) - 1.90909) < 0.001,
      `decimal(-110)=${americanToDecimal(-110)}`,
    );
    check(
      r,
      Math.abs(americanToProfit(-110) - 0.90909) < 0.001,
      `profit(-110)=${americanToProfit(-110)}`,
    );
    check(
      r,
      Math.abs(americanToDecimal(150) - 2.5) < 0.001,
      `decimal(150)=${americanToDecimal(150)}`,
    );
    check(
      r,
      Math.abs(americanToProfit(150) - 1.5) < 0.001,
      `profit(150)=${americanToProfit(150)}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — American odds math correct");
    else console.log("[1] FAIL — odds math");
  }

  // 2. OVER wins / UNDER wins / push / no-data outcomes.
  {
    const r = makeReport("per-side outcome classification");
    const candidates = [
      candidate({
        playerName: "OverWinner",
        propType: "PASSING_ATTEMPTS",
        line: 30,
      }),
      candidate({
        playerName: "UnderWinner",
        propType: "PASSING_ATTEMPTS",
        line: 40,
      }),
      candidate({
        playerName: "Pusher",
        propType: "PASSING_ATTEMPTS",
        line: 35,
      }),
      candidate({
        playerName: "NoData",
        propType: "PASSING_ATTEMPTS",
        line: 30,
      }),
    ];
    const grade = gradeStoredWeek1Backtest({
      candidates,
      season: 2025,
      week: 1,
      playerWeekStats: [
        statRow({ playerName: "OverWinner", team: "KC", passingAttempts: 35 }),
        statRow({ playerName: "UnderWinner", team: "KC", passingAttempts: 35 }),
        statRow({ playerName: "Pusher", team: "KC", passingAttempts: 35 }),
      ],
    });
    const byId = new Map(grade.graded.map((g) => [g.candidateId, g]));
    const overWinner = byId.get(candidates[0].id)!;
    const underWinner = byId.get(candidates[1].id)!;
    const pusher = byId.get(candidates[2].id)!;
    const noData = byId.get(candidates[3].id)!;
    check(r, overWinner.overOutcome === "WIN", `overWinner.over=${overWinner.overOutcome}`);
    check(r, overWinner.underOutcome === "LOSS", `overWinner.under=${overWinner.underOutcome}`);
    check(r, overWinner.decisive === true, "overWinner.decisive=true");
    check(r, underWinner.overOutcome === "LOSS", `underWinner.over=${underWinner.overOutcome}`);
    check(r, underWinner.underOutcome === "WIN", `underWinner.under=${underWinner.underOutcome}`);
    check(r, pusher.overOutcome === "PUSH", `pusher.over=${pusher.overOutcome}`);
    check(r, pusher.underOutcome === "PUSH", `pusher.under=${pusher.underOutcome}`);
    check(r, pusher.decisive === false, "pusher.decisive=false");
    check(r, noData.overOutcome === "NO_DATA", `noData.over=${noData.overOutcome}`);
    check(r, noData.actualValue === null, `noData.actual=${noData.actualValue}`);
    check(r, noData.decisive === false, "noData.decisive=false");
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — outcomes classify correctly");
    else console.log("[2] FAIL — outcome classification");
  }

  // 3. Candidate count never changes after grading. Aggregate
  //    matches per-candidate sums.
  {
    const r = makeReport("candidate count + aggregate invariants");
    const candidates = [
      candidate({ playerName: "A", propType: "PASSING_ATTEMPTS", line: 30 }),
      candidate({ playerName: "B", propType: "RECEPTIONS", line: 5, overOdds: 150 }),
      candidate({ playerName: "C", propType: "RUSHING_ATTEMPTS", line: 12 }),
    ];
    const grade = gradeStoredWeek1Backtest({
      candidates,
      season: 2025,
      week: 1,
      playerWeekStats: [
        statRow({ playerName: "A", team: "KC", passingAttempts: 33 }), // OVER wins
        statRow({ playerName: "B", team: "KC", receptions: 4 }), // UNDER wins (at +150 on OVER, -110 on UNDER → user lost OVER at +150)
        statRow({ playerName: "C", team: "KC", rushingAttempts: 12 }), // PUSH
      ],
    });
    check(
      r,
      grade.graded.length === candidates.length,
      `graded.length=${grade.graded.length} candidates=${candidates.length}`,
    );
    check(
      r,
      grade.summary.totalCandidates === candidates.length,
      `summary.totalCandidates=${grade.summary.totalCandidates}`,
    );
    // OVER: A wins (profit +0.909), B loses (-1), C pushes (0) → +(-0.091)
    const expectedOverProfit =
      americanToProfit(-110) + -1 + 0;
    check(
      r,
      Math.abs(grade.summary.overSide.unitsProfit - expectedOverProfit) < 0.001,
      `over units profit=${grade.summary.overSide.unitsProfit} vs ${expectedOverProfit}`,
    );
    check(
      r,
      grade.summary.overSide.wins === 1,
      `over wins=${grade.summary.overSide.wins}`,
    );
    check(
      r,
      grade.summary.overSide.losses === 1,
      `over losses=${grade.summary.overSide.losses}`,
    );
    check(
      r,
      grade.summary.overSide.pushes === 1,
      `over pushes=${grade.summary.overSide.pushes}`,
    );
    check(
      r,
      grade.summary.qualifiedPlays === 2,
      `qualifiedPlays=${grade.summary.qualifiedPlays} (A + B are decisive)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — invariants + arithmetic match");
    else console.log("[3] FAIL — invariants");
  }

  // 4. Market + line buckets surface in summary.
  {
    const r = makeReport("by-prop-type + by-line bucket breakdown");
    const candidates = [
      candidate({ playerName: "A", propType: "PASSING_ATTEMPTS", line: 35 }),
      candidate({ playerName: "B", propType: "RECEPTIONS", line: 5 }),
      candidate({ playerName: "C", propType: "RECEPTIONS", line: 7 }),
    ];
    const grade = gradeStoredWeek1Backtest({
      candidates,
      season: 2025,
      week: 1,
      playerWeekStats: [
        statRow({ playerName: "A", team: "KC", passingAttempts: 37 }),
        statRow({ playerName: "B", team: "KC", receptions: 6 }),
        statRow({ playerName: "C", team: "KC", receptions: 8 }),
      ],
    });
    const pa = grade.summary.byPropType.find((p) => p.propType === "PASSING_ATTEMPTS");
    const rec = grade.summary.byPropType.find((p) => p.propType === "RECEPTIONS");
    check(r, pa?.total === 1, `PA bucket total=${pa?.total}`);
    check(r, rec?.total === 2, `REC bucket total=${rec?.total}`);
    check(
      r,
      rec?.overSide.wins === 2,
      `REC over wins=${rec?.overSide.wins}`,
    );
    check(
      r,
      grade.summary.byLineBucket.length > 0,
      "byLineBucket has at least one entry",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — market + line buckets populated");
    else console.log("[4] FAIL — breakdown");
  }

  // 5. End-to-end via the admin runner: grade-week1-stored
  //    fails cleanly when the pregame run isn't ready, and
  //    succeeds when it is.
  {
    const r = makeReport("admin runner grade action: end-to-end");
    const repoRoot = makeTempRepo();
    // Seed: canonical odds + games.csv + player_week_stats so
    // the candidate builder returns READY.
    writeCsv(
      path.join(
        repoRoot,
        "data",
        "processed",
        "odds",
        "2025",
        "week-1-prop-markets.csv",
      ),
      [
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
      ],
      [
        [
          2025,
          1,
          "2025-w1-kc-at-lac",
          "2025-09-06T00:00:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "LAC",
          "player_pass_attempts",
          "PASSING_ATTEMPTS",
          33.5,
          -110,
          -110,
          "2025-09-05T20:30:00Z",
        ],
      ],
    );
    writeCsv(
      path.join(repoRoot, "data", "processed", "nfl", "player_week_stats.csv"),
      [
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
      ],
      [
        // Prior-year history row for the strict-before filter.
        [
          "00-mahomes",
          "Patrick Mahomes",
          "QB",
          "KC",
          "BUF",
          2024,
          18,
          "2024-w18-kc",
          "HOME",
          36,
        ],
        // Current Week 1 stat used by the grader (OVER 33.5 wins).
        [
          "00-mahomes",
          "Patrick Mahomes",
          "QB",
          "KC",
          "LAC",
          2025,
          1,
          "2025-w1-kc-at-lac",
          "AWAY",
          37,
        ],
      ],
    );
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "grade-week1-stored",
      repoRoot,
      persistence: client,
    });
    check(r, result.ok === true, `grading ok=${result.ok}; status=${result.status}`);
    const summary = result.data?.summary as
      | {
          totalCandidates?: number;
          overSide?: { wins?: number; hitRate?: number };
        }
      | undefined;
    check(
      r,
      summary?.totalCandidates === 1,
      `summary.totalCandidates=${summary?.totalCandidates}`,
    );
    check(
      r,
      summary?.overSide?.wins === 1,
      `summary.overSide.wins=${summary?.overSide?.wins}`,
    );
    // The file mirror must be present.
    const gradedFile = path.join(
      repoRoot,
      "data",
      "backtests",
      "2025",
      "week-1-graded-summary.fixture.json",
    );
    check(r, fs.existsSync(gradedFile), `graded summary file at ${gradedFile}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — admin runner end-to-end grading");
    else console.log("[5] FAIL — admin grading");
  }

  // 6. /monitor snapshot reports gradingStatus="graded" with
  //    populated `graded` block after the action runs. DB
  //    survives a file wipe (redeploy simulation).
  {
    const r = makeReport("snapshot loader reports graded after grading runs");
    const repoRoot = makeTempRepo();
    writeCsv(
      path.join(
        repoRoot,
        "data",
        "processed",
        "odds",
        "2025",
        "week-1-prop-markets.csv",
      ),
      [
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
      ],
      [
        [
          2025,
          1,
          "2025-w1-kc-at-lac",
          "2025-09-06T00:00:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "LAC",
          "player_pass_attempts",
          "PASSING_ATTEMPTS",
          33.5,
          -110,
          -110,
          "2025-09-05T20:30:00Z",
        ],
      ],
    );
    writeCsv(
      path.join(repoRoot, "data", "processed", "nfl", "player_week_stats.csv"),
      [
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
      ],
      [
        [
          "00-mahomes",
          "Patrick Mahomes",
          "QB",
          "KC",
          "BUF",
          2024,
          18,
          "2024-w18-kc",
          "HOME",
          36,
        ],
        [
          "00-mahomes",
          "Patrick Mahomes",
          "QB",
          "KC",
          "LAC",
          2025,
          1,
          "2025-w1-kc-at-lac",
          "AWAY",
          37,
        ],
      ],
    );
    const client = inMemoryPersistenceClient();
    // Step 1: stored-backtest (pregame only).
    await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      persistence: client,
    });
    // Step 2: grade — must add the resultsJson without
    // overwriting the pregame candidates.
    await runAdminAction({
      action: "grade-week1-stored",
      repoRoot,
      persistence: client,
    });
    const original = process.cwd();
    process.chdir(repoRoot);
    try {
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(r, snap?.gradingStatus === "graded", `gradingStatus=${snap?.gradingStatus}`);
      check(
        r,
        snap?.graded?.universeDiagnostics.overSide.wins === 1,
        `graded.universeDiagnostics.overSide.wins=${snap?.graded?.universeDiagnostics.overSide.wins}`,
      );
      check(
        r,
        typeof snap?.graded?.universeDiagnostics.overSide.roiPct === "number",
        "graded.universeDiagnostics.overSide.roiPct must be a number",
      );
      // Admin runner now applies the V1 scorecard to stored
      // candidates before grading. recommendedPlays.enabled
      // depends on whether the synthetic candidate qualifies
      // through the scorecard pipeline — but the field MUST be
      // a boolean and the structure MUST be intact whether or
      // not the synthetic prop happens to qualify.
      check(
        r,
        typeof snap?.graded?.recommendedPlays.enabled === "boolean",
        `recommendedPlays.enabled must be boolean, got ${typeof snap?.graded?.recommendedPlays.enabled}`,
      );
      check(
        r,
        Array.isArray(snap?.graded?.recommendedPlays.byPropType),
        "recommendedPlays.byPropType must be an array",
      );
      check(
        r,
        snap?.graded?.parlayPerformance.enabled === false,
        `parlayPerformance.enabled=${snap?.graded?.parlayPerformance.enabled}`,
      );
      check(
        r,
        snap?.candidateCount === 1,
        `candidateCount preserved=${snap?.candidateCount}`,
      );
      // Survives file wipe.
      const fileMirror = path.join(
        repoRoot,
        "data",
        "backtests",
        "2025",
        "week-1-graded-summary.fixture.json",
      );
      if (fs.existsSync(fileMirror)) fs.rmSync(fileMirror);
      const snap2 = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(
        r,
        snap2?.gradingStatus === "graded",
        `post-file-wipe gradingStatus=${snap2?.gradingStatus}`,
      );
    } finally {
      process.chdir(original);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — graded snapshot survives file wipe via DB");
    else console.log("[6] FAIL — graded survival");
  }

  // 7. Snapshot type still has no fixture-style root fields.
  //    The graded data must live on `.graded.*`, not bleed up
  //    to the snapshot root.
  {
    const r = makeReport("snapshot root never carries fixture-style hit/ROI fields");
    const repoRoot = makeTempRepo();
    writeCsv(
      path.join(
        repoRoot,
        "data",
        "processed",
        "odds",
        "2025",
        "week-1-prop-markets.csv",
      ),
      [
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
      ],
      [
        [
          2025,
          1,
          "2025-w1-kc-at-lac",
          "2025-09-06T00:00:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "LAC",
          "player_pass_attempts",
          "PASSING_ATTEMPTS",
          33.5,
          -110,
          -110,
          "2025-09-05T20:30:00Z",
        ],
      ],
    );
    writeCsv(
      path.join(repoRoot, "data", "processed", "nfl", "player_week_stats.csv"),
      [
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
      ],
      [
        [
          "00-mahomes",
          "Patrick Mahomes",
          "QB",
          "KC",
          "BUF",
          2024,
          18,
          "2024-w18-kc",
          "HOME",
          36,
        ],
        [
          "00-mahomes",
          "Patrick Mahomes",
          "QB",
          "KC",
          "LAC",
          2025,
          1,
          "2025-w1-kc-at-lac",
          "AWAY",
          37,
        ],
      ],
    );
    const client = inMemoryPersistenceClient();
    await runAdminAction({ action: "stored-backtest", repoRoot, persistence: client });
    await runAdminAction({ action: "grade-week1-stored", repoRoot, persistence: client });
    const original = process.cwd();
    process.chdir(repoRoot);
    try {
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      const obj = snap as unknown as Record<string, unknown>;
      check(r, !("hitRate" in obj), "hitRate must not be on snapshot root");
      check(r, !("roiPct" in obj), "roiPct must not be on snapshot root");
      check(r, !("wins" in obj), "wins must not be on snapshot root");
      check(r, !("losses" in obj), "losses must not be on snapshot root");
    } finally {
      process.chdir(original);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — fixture-style fields stay off snapshot root");
    else console.log("[7] FAIL — root contamination");
  }

  // 8. Grader is pure data — no API hooks, no banned content.
  {
    const r = makeReport("no banned hooks in grading module");
    const text = readSrc("src/lib/backtest/week-1-grading.ts");
    for (const re of [
      /the-odds-api/i,
      /odds-api\.com/i,
      /placeBet|placeWager/i,
      /from\s+["'][^"']*kalshi[^"']*["']/i,
      /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
      /fetch\(/,
      /https?:\/\/[a-z0-9\-]+\.[a-z]+/i,
      /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
    ]) {
      check(r, !re.test(text), `grading contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — no API / Kalshi / TD hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  // 9. Universe Diagnostics vs Recommended Plays separation:
  //    universe numbers populate without recommended-plays
  //    being enabled. Recommended plays + parlay sections stay
  //    disabled with a clear note.
  {
    const r = makeReport("diagnostic vs betting performance sections");
    const candidates = [
      candidate({ playerName: "A", propType: "PASSING_ATTEMPTS", line: 30 }),
      candidate({ playerName: "B", propType: "RECEPTIONS", line: 5 }),
      candidate({ playerName: "Pusher", propType: "RUSHING_ATTEMPTS", line: 12 }),
      candidate({ playerName: "NoStats", propType: "PASSING_COMPLETIONS", line: 20 }),
    ];
    const grade = gradeStoredWeek1Backtest({
      candidates,
      season: 2025,
      week: 1,
      playerWeekStats: [
        statRow({ playerName: "A", team: "KC", passingAttempts: 35 }),
        statRow({ playerName: "B", team: "KC", receptions: 6 }),
        statRow({ playerName: "Pusher", team: "KC", rushingAttempts: 12 }),
      ],
    });
    // Universe diagnostics block carries the per-side numbers.
    check(
      r,
      grade.summary.universeDiagnostics.totalCandidates === 4,
      `universe total=${grade.summary.universeDiagnostics.totalCandidates}`,
    );
    check(
      r,
      grade.summary.universeDiagnostics.candidatesMissingActual === 1,
      `universe missing=${grade.summary.universeDiagnostics.candidatesMissingActual}`,
    );
    check(
      r,
      grade.summary.universeDiagnostics.candidatesPushed === 1,
      `universe pushed=${grade.summary.universeDiagnostics.candidatesPushed}`,
    );
    // Recommended plays disabled with non-empty note + zero numbers.
    check(
      r,
      grade.summary.recommendedPlays.enabled === false,
      "recommendedPlays must be disabled when no recommendation field exists",
    );
    check(
      r,
      grade.summary.recommendedPlays.note.length > 20,
      "recommendedPlays.note should explain the gap",
    );
    check(
      r,
      grade.summary.recommendedPlays.count === 0,
      `recommendedPlays.count=${grade.summary.recommendedPlays.count} (must be 0 when disabled)`,
    );
    check(
      r,
      grade.summary.recommendedPlays.roiPct === 0 &&
        grade.summary.recommendedPlays.hitRatePct === 0 &&
        grade.summary.recommendedPlays.unitsProfit === 0,
      "recommendedPlays metrics must all be 0 when disabled (no fake numbers)",
    );
    // Parlay performance same treatment.
    check(
      r,
      grade.summary.parlayPerformance.enabled === false,
      "parlayPerformance must be disabled",
    );
    check(
      r,
      grade.summary.parlayPerformance.note.length > 20,
      "parlayPerformance.note should explain the gap",
    );
    check(
      r,
      grade.summary.parlayPerformance.evaluated === 0 &&
        grade.summary.parlayPerformance.selected === 0,
      "parlayPerformance counts must be 0 when disabled",
    );
    // Disqualification breakdown reflects the data-side reasons
    // we can compute today; model-gate counts stay 0.
    check(
      r,
      grade.summary.disqualificationBreakdown.missingResult === 1,
      `disq.missingResult=${grade.summary.disqualificationBreakdown.missingResult}`,
    );
    check(
      r,
      grade.summary.disqualificationBreakdown.ungradeable === 1,
      `disq.ungradeable=${grade.summary.disqualificationBreakdown.ungradeable}`,
    );
    check(
      r,
      grade.summary.disqualificationBreakdown.edgeTooThin === 0 &&
        grade.summary.disqualificationBreakdown.riskGate === 0 &&
        grade.summary.disqualificationBreakdown.roleStability === 0,
      "model-gate counters stay 0 until the scorecard pass lands",
    );
    check(
      r,
      grade.summary.disqualificationBreakdown.totalRejected === 2,
      `disq.totalRejected=${grade.summary.disqualificationBreakdown.totalRejected}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — universe diagnostics + recommended-plays / parlay gating + disq breakdown");
    else console.log("[9] FAIL — diagnostic/betting separation");
  }

  // 10. The headline "betting ROI" must never appear on the
  //     universe diagnostics block. The structure separates the
  //     fields so the page CANNOT render fake betting performance
  //     from the universe side.
  {
    const r = makeReport("universe diagnostics carry no `betting` labels");
    const candidates = [
      candidate({ playerName: "A", propType: "PASSING_ATTEMPTS", line: 30 }),
    ];
    const grade = gradeStoredWeek1Backtest({
      candidates,
      season: 2025,
      week: 1,
      playerWeekStats: [
        statRow({ playerName: "A", team: "KC", passingAttempts: 35 }),
      ],
    });
    // The universe block has overSide / underSide aggregates.
    // The recommendedPlays block has the betting-shaped fields
    // (hitRatePct, roiPct, unitsProfit). They are STRUCTURALLY
    // separated, so the page can label them differently.
    const u = grade.summary.universeDiagnostics as unknown as Record<
      string,
      unknown
    >;
    check(
      r,
      !("hitRatePct" in u),
      "universe diagnostics must not have a root hitRatePct (it's per-side)",
    );
    check(
      r,
      !("roiPct" in u),
      "universe diagnostics must not have a root roiPct",
    );
    const rec = grade.summary.recommendedPlays as unknown as Record<
      string,
      unknown
    >;
    check(r, "hitRatePct" in rec, "recommendedPlays has hitRatePct field");
    check(r, "roiPct" in rec, "recommendedPlays has roiPct field");
    check(r, "averageEdgePct" in rec, "recommendedPlays has averageEdgePct field");
    check(
      r,
      "averageConfidence" in rec,
      "recommendedPlays has averageConfidence field",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — diagnostic vs betting fields structurally separated");
    else console.log("[10] FAIL — structural separation");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 10 week-1-grading assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

void main();
