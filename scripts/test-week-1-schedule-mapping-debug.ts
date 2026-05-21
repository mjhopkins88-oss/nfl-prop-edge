/**
 * Schedule-mapping debug + stale-row replacement assertions.
 *
 *   · the standalone debug script's diagnostic surfaces every
 *     invalid gameId, team-pair mismatch, and first 20
 *     problematic rows
 *   · stale canonical odds rows (LA-era gameIds / team values)
 *     left over from a pre-fix migration get DELETED by the
 *     `deleteCanonicalOddsRowsForWeek` helper before fresh
 *     rows are written
 *   · re-running the admin migrate-odds-to-canonical action
 *     replaces stale DB rows with normalized (LAR-era) rows
 *   · the stored-backtest admin action attaches a structured
 *     scheduleValidationDebug payload when validation fails,
 *     so the admin UI can surface the exact mismatch
 *   · the same payload reports zero invalid gameIds when the
 *     canonical odds + fixture line up
 *   · all four documented aliases (LA→LAR, JAC→JAX, ARZ→ARI,
 *     WSH→WAS) still normalize correctly
 *   · no paid API call, no banned content
 *
 * Pure file IO + in-memory persistence stub. No spawn, no
 * Prisma, no HTTP.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inMemoryPersistenceClient,
  type PersistenceClient,
} from "../src/lib/persistence/week-1-persistence";
import {
  runAdminAction,
  type SubprocessResult,
  type SubprocessRunner,
  type SubprocessSpec,
} from "../src/lib/admin/admin-runner";
import {
  normalizeTeamAbbreviation,
  validateCanonicalOddsGameIds,
} from "../src/lib/backtest/week-1-game-id-mapper";
import { getExpectedWeek1Schedule } from "../src/lib/backtest/week-1-schedule-validation";
import {
  canonicalMarketsPath,
  writeCanonicalOddsCsv,
} from "../src/lib/ingestion/canonical-odds-writer";

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
function makeTempRepo(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nfl-prop-edge-sched-debug-"),
  );
  fs.mkdirSync(path.join(dir, "data", "admin"), { recursive: true });
  fs.mkdirSync(path.join(dir, "data", "admin-ingestion"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "data", "processed", "odds", "2025"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(dir, "data", "processed", "nfl"), { recursive: true });
  return dir;
}
function writeCsv(p: string, headers: string[], rows: string[][]): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = [headers.join(",")]
    .concat(rows.map((r) => r.join(",")))
    .join("\n");
  fs.writeFileSync(p, body + "\n");
}

function seedRailwayLikeRepo(root: string): void {
  // Mirror the production legacy file layout: prop_markets +
  // prop_quotes (relational), plus the LA-era games.csv (which
  // is what nflverse emits and which a pre-LA-fix migration
  // would have keyed off of).
  writeCsv(
    path.join(root, "data", "processed", "prop_markets.csv"),
    [
      "market_key",
      "game_id",
      "event_id",
      "player_name",
      "prop_type",
      "line",
      "source",
      "snapshot_time",
    ],
    [
      [
        "evt-kc-lac:patrick-mahomes:PASSING_ATTEMPTS:33.5",
        "2025-w1-kc-at-lac",
        "evt-kc-lac",
        "Patrick Mahomes",
        "PASSING_ATTEMPTS",
        "33.5",
        "odds-api",
        "2025-09-05T20:30:00Z",
      ],
      [
        "evt-hou-la:matthew-stafford:PASSING_ATTEMPTS:33.5",
        "2025-w1-hou-at-la",
        "evt-hou-la",
        "Matthew Stafford",
        "PASSING_ATTEMPTS",
        "33.5",
        "odds-api",
        "2025-09-07T17:00:00Z",
      ],
    ],
  );
  writeCsv(
    path.join(root, "data", "processed", "prop_quotes.csv"),
    [
      "market_key",
      "book_name",
      "over_price",
      "under_price",
      "over_implied_probability",
      "under_implied_probability",
      "no_vig_over_probability",
      "no_vig_under_probability",
      "quote_time",
    ],
    [
      [
        "evt-kc-lac:patrick-mahomes:PASSING_ATTEMPTS:33.5",
        "DraftKings",
        "-110",
        "-110",
        "0.524",
        "0.524",
        "0.5",
        "0.5",
        "2025-09-05T20:30:00Z",
      ],
      [
        "evt-hou-la:matthew-stafford:PASSING_ATTEMPTS:33.5",
        "DraftKings",
        "-110",
        "-110",
        "0.524",
        "0.524",
        "0.5",
        "0.5",
        "2025-09-07T17:00:00Z",
      ],
    ],
  );
  writeCsv(
    path.join(root, "data", "processed", "nfl", "games.csv"),
    [
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
    ],
    [
      [
        "2025-w1-kc-at-lac",
        "2025",
        "1",
        "REG",
        "2025-09-06T00:00:00.000Z",
        "LAC",
        "KC",
        "27",
        "21",
        "dome",
        "",
        "SoFi Stadium",
        "-3",
        "47.5",
      ],
      [
        "2025-w1-hou-at-la",
        "2025",
        "1",
        "REG",
        "2025-09-07T20:25:00.000Z",
        "LA",
        "HOU",
        "14",
        "9",
        "dome",
        "matrixturf",
        "SoFi Stadium",
        "3.5",
        "43.5",
      ],
    ],
  );
  writeCsv(
    path.join(root, "data", "processed", "nfl", "rosters.csv"),
    [
      "playerId",
      "playerName",
      "position",
      "team",
      "season",
      "jerseyNumber",
      "status",
      "birthDate",
      "depthChartRank",
    ],
    [
      ["00-mahomes", "Patrick Mahomes", "QB", "KC", "2025", "15", "ACT", "", ""],
      [
        "00-stafford",
        "Matthew Stafford",
        "QB",
        "LA",
        "2025",
        "9",
        "ACT",
        "1988-02-07",
        "",
      ],
    ],
  );
  // Also seed processed player stats so the candidate builder
  // doesn't fail with MISSING_PROCESSED_NFL.
  writeCsv(
    path.join(root, "data", "processed", "nfl", "player_week_stats.csv"),
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
        "2024",
        "18",
        "2024-w18-kc",
        "HOME",
        "36",
      ],
      [
        "00-stafford",
        "Matthew Stafford",
        "QB",
        "LA",
        "BAL",
        "2024",
        "18",
        "2024-w18-la",
        "HOME",
        "33",
      ],
    ],
  );
}

async function main(): Promise<void> {
  console.log("Week 1 schedule-mapping debug — assertions");
  console.log("============================================");

  // 1. validateCanonicalOddsGameIds picks up the LA-era row
  //    even when most of the file is correct.
  {
    const r = makeReport("debug surfaces invalid LA-era gameId");
    const schedule = getExpectedWeek1Schedule().games;
    const report = validateCanonicalOddsGameIds({
      rows: [
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-kc-at-lac",
          team: "KC",
          opponent: "LAC",
        },
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-hou-at-la",
          team: "LA",
          opponent: "HOU",
        },
      ],
      schedule,
    });
    check(r, report.totalRows === 2, `totalRows=${report.totalRows}`);
    check(r, report.validRows === 1, `validRows=${report.validRows}`);
    check(
      r,
      report.invalidGameIds.length === 1 &&
        report.invalidGameIds[0] === "2025-w1-hou-at-la",
      `invalid: ${JSON.stringify(report.invalidGameIds)}`,
    );
    check(
      r,
      report.rebuildableRows === 1,
      `rebuildableRows=${report.rebuildableRows}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — debug reports the exact LA-era invalid row");
    else console.log("[1] FAIL — debug reporting");
  }

  // 2. Stale DB rows for (season, week) are deleted by the
  //    persistence helper.
  {
    const r = makeReport("deleteCanonicalOddsRowsForWeek clears stale state");
    const c = inMemoryPersistenceClient();
    // Pre-seed stale (LA-era) row.
    await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows: [
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-hou-at-la",
          kickoffTime: "",
          sportsbook: "DraftKings",
          playerName: "Matthew Stafford",
          team: "LA",
          opponent: "HOU",
          marketKey: "player_pass_attempts",
          propType: "PASSING_ATTEMPTS",
          line: 33.5,
          overOdds: -110,
          underOdds: -110,
          snapshotTime: "2025-09-07T17:00:00Z",
        },
      ],
    });
    // Add an unrelated week-2 row to verify it's NOT deleted.
    await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 2,
      rows: [
        {
          season: 2025,
          week: 2,
          gameId: "2025-w2-cle-at-bal",
          kickoffTime: "",
          sportsbook: "DraftKings",
          playerName: "Lamar Jackson",
          team: "BAL",
          opponent: "CLE",
          marketKey: "player_pass_attempts",
          propType: "PASSING_ATTEMPTS",
          line: 28.5,
          overOdds: -110,
          underOdds: -110,
          snapshotTime: "2025-09-14T13:30:00Z",
        },
      ],
    });
    const before = await c.loadCanonicalOddsRowsFromDb({ season: 2025, week: 1 });
    check(r, before.rows.length === 1, `before delete: ${before.rows.length} row(s)`);
    const del = await c.deleteCanonicalOddsRowsForWeek({ season: 2025, week: 1 });
    check(r, del.ok, "delete ok");
    check(r, del.deleted === 1, `deleted=${del.deleted}`);
    const after = await c.loadCanonicalOddsRowsFromDb({ season: 2025, week: 1 });
    check(r, after.rows.length === 0, `after delete: ${after.rows.length} row(s)`);
    const otherWeek = await c.loadCanonicalOddsRowsFromDb({ season: 2025, week: 2 });
    check(
      r,
      otherWeek.rows.length === 1,
      `week 2 row untouched: ${otherWeek.rows.length}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — stale week-1 rows deleted; other weeks untouched");
    else console.log("[2] FAIL — delete scope");
  }

  // 3. End-to-end migration via the admin runner with a pre-
  //    seeded stale DB row. After migration, DB has only the
  //    LAR-era row.
  {
    const r = makeReport("migration deletes stale + upserts normalized");
    const repoRoot = makeTempRepo();
    seedRailwayLikeRepo(repoRoot);
    const c: PersistenceClient = inMemoryPersistenceClient();
    // Pre-seed a stale LA-era row in the DB (simulating a
    // pre-fix migration that landed before LA→LAR normalization).
    await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows: [
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-hou-at-la",
          kickoffTime: "",
          sportsbook: "DraftKings",
          playerName: "Matthew Stafford",
          team: "LA",
          opponent: "HOU",
          marketKey: "player_pass_attempts",
          propType: "PASSING_ATTEMPTS",
          line: 33.5,
          overOdds: -110,
          underOdds: -110,
          snapshotTime: "stale-marker",
        },
      ],
    });
    const result = await runAdminAction({
      action: "migrate-odds-to-canonical",
      repoRoot,
      persistence: c,
    });
    check(r, result.ok === true, `migration ok=${result.ok}`);
    check(
      r,
      typeof result.data?.dbDeleted === "number" &&
        (result.data.dbDeleted as number) >= 1,
      `expected at least 1 stale row deleted, got dbDeleted=${result.data?.dbDeleted}`,
    );
    check(
      r,
      typeof result.data?.dbUpserted === "number" &&
        (result.data.dbUpserted as number) >= 2,
      `expected ≥2 fresh rows upserted, got dbUpserted=${result.data?.dbUpserted}`,
    );
    // After migration, the LAR row is in the DB.
    const after = await c.loadCanonicalOddsRowsFromDb({ season: 2025, week: 1 });
    const ids = new Set(after.rows.map((row) => row.gameId));
    check(r, ids.has("2025-w1-hou-at-lar"), "HOU@LAR row in DB");
    check(
      r,
      !ids.has("2025-w1-hou-at-la"),
      "stale HOU@LA row must NOT survive (got: " + [...ids].join(", ") + ")",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — migration deletes stale row + writes normalized");
    else console.log("[3] FAIL — stale replacement");
  }

  // 4. Stored backtest attaches scheduleValidationDebug when
  //    validation fails. Reproduce the failure with rows that
  //    DO pass the gameId filter but carry wrong team values —
  //    that's the SCHEDULE_VALIDATION_FAILED branch (rows with
  //    stale gameIds get filtered out earlier and become
  //    NO_CANDIDATES_AFTER_FILTER instead).
  {
    const r = makeReport("stored-backtest attaches scheduleValidationDebug");
    const repoRoot = makeTempRepo();
    seedRailwayLikeRepo(repoRoot);
    writeCanonicalOddsCsv({
      rows: [
        // Valid row — passes both filter + pair validation.
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-kc-at-lac",
          kickoffTime: "2025-09-06T00:00:00Z",
          sportsbook: "DraftKings",
          playerName: "Patrick Mahomes",
          team: "KC",
          opponent: "LAC",
          marketKey: "player_pass_attempts",
          propType: "PASSING_ATTEMPTS",
          line: 33.5,
          overOdds: -110,
          underOdds: -110,
          snapshotTime: "2025-09-05T20:30:00Z",
        },
        // Wrong team for a real gameId. The schedule fixture
        // says HOU @ LAR, so a row claiming the player is on
        // "ZZZ" against "QQQ" passes the gameId filter but
        // fails the team-pair validator → status FAIL.
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-hou-at-lar",
          kickoffTime: "2025-09-07T20:25:00Z",
          sportsbook: "DraftKings",
          playerName: "Bad Mapping Player",
          team: "ZZZ",
          opponent: "QQQ",
          marketKey: "player_pass_attempts",
          propType: "PASSING_ATTEMPTS",
          line: 33.5,
          overOdds: -110,
          underOdds: -110,
          snapshotTime: "2025-09-07T17:00:00Z",
        },
      ],
      season: 2025,
      week: 1,
      processedRoot: path.join(repoRoot, "data", "processed"),
    });
    const c = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      persistence: c,
    });
    check(
      r,
      result.status === "failure",
      `expected failure status, got ${result.status}`,
    );
    check(
      r,
      (result.data?.scheduleReportStatus as string) === "FAIL",
      `scheduleReportStatus=${result.data?.scheduleReportStatus}`,
    );
    const debug = result.data?.scheduleValidationDebug as
      | {
          invalidGameIds?: string[];
          teamPairIssues?: { gameId: string; badPairs: string[] }[];
          firstProblematicRows?: { gameId: string; team: string }[];
          canonicalRowCount?: number;
        }
      | null
      | undefined;
    check(r, debug !== null && debug !== undefined, "debug payload present");
    if (debug) {
      check(
        r,
        debug.canonicalRowCount === 2,
        `canonicalRowCount=${debug.canonicalRowCount}`,
      );
      // The "ZZZ" row has a valid gameId but a bad team pair —
      // should surface under teamPairIssues, not invalidGameIds.
      check(
        r,
        Array.isArray(debug.teamPairIssues) &&
          debug.teamPairIssues.some((i) => i.gameId === "2025-w1-hou-at-lar"),
        `teamPairIssues should include the HOU@LAR mismatch: ${JSON.stringify(debug.teamPairIssues)}`,
      );
      check(
        r,
        Array.isArray(debug.firstProblematicRows) &&
          debug.firstProblematicRows.some((r2) => r2.team === "ZZZ"),
        `firstProblematicRows should include the ZZZ row: ${JSON.stringify(debug.firstProblematicRows)}`,
      );
    }
    check(
      r,
      typeof result.detail === "string" &&
        result.detail.includes("schedule-validation debug"),
      "result.detail should include the debug section header",
    );
    check(
      r,
      typeof result.detail === "string" &&
        result.detail.includes("2025-w1-hou-at-lar"),
      "result.detail should name the offending gameId",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — stored-backtest failure surfaces the bad rows");
    else console.log("[4] FAIL — debug attachment");
  }

  // 5. After re-running migration (which deletes stale + writes
  //    normalized), the next stored-backtest passes validation.
  {
    const r = makeReport("re-migration → stored-backtest passes");
    const repoRoot = makeTempRepo();
    seedRailwayLikeRepo(repoRoot);
    const c = inMemoryPersistenceClient();
    // Pre-seed a stale row that should be wiped.
    await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows: [
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-hou-at-la",
          kickoffTime: "",
          sportsbook: "DraftKings",
          playerName: "Matthew Stafford",
          team: "LA",
          opponent: "HOU",
          marketKey: "player_pass_attempts",
          propType: "PASSING_ATTEMPTS",
          line: 33.5,
          overOdds: -110,
          underOdds: -110,
          snapshotTime: "stale-marker",
        },
      ],
    });
    const migration = await runAdminAction({
      action: "migrate-odds-to-canonical",
      repoRoot,
      persistence: c,
    });
    check(r, migration.ok === true, "migration ok");
    // Now run stored-backtest.
    const result = await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      persistence: c,
    });
    check(r, result.ok === true, `stored-backtest ok=${result.ok}; status=${result.status}`);
    check(
      r,
      (result.data?.scheduleReportStatus as string) === "PASS",
      `scheduleReportStatus=${result.data?.scheduleReportStatus}`,
    );
    check(
      r,
      (result.data?.candidateCount as number) >= 2,
      `candidateCount=${result.data?.candidateCount}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — re-migration fixes stored-backtest end-to-end");
    else console.log("[5] FAIL — end-to-end remigration");
  }

  // 6. All four documented team aliases still normalize.
  {
    const r = makeReport("all four aliases continue to normalize");
    check(r, normalizeTeamAbbreviation("LA") === "LAR", "LA → LAR");
    check(r, normalizeTeamAbbreviation("JAC") === "JAX", "JAC → JAX");
    check(r, normalizeTeamAbbreviation("ARZ") === "ARI", "ARZ → ARI");
    check(r, normalizeTeamAbbreviation("WSH") === "WAS", "WSH → WAS");
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — alias map unchanged: LA/JAC/ARZ/WSH all normalize");
    else console.log("[6] FAIL — aliases");
  }

  // 7. Successful stored-backtest does NOT attach the debug
  //    payload (it's only there on failure).
  {
    const r = makeReport("scheduleValidationDebug omitted on success");
    const repoRoot = makeTempRepo();
    seedRailwayLikeRepo(repoRoot);
    writeCanonicalOddsCsv({
      rows: [
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-kc-at-lac",
          kickoffTime: "2025-09-06T00:00:00Z",
          sportsbook: "DraftKings",
          playerName: "Patrick Mahomes",
          team: "KC",
          opponent: "LAC",
          marketKey: "player_pass_attempts",
          propType: "PASSING_ATTEMPTS",
          line: 33.5,
          overOdds: -110,
          underOdds: -110,
          snapshotTime: "2025-09-05T20:30:00Z",
        },
      ],
      season: 2025,
      week: 1,
      processedRoot: path.join(repoRoot, "data", "processed"),
    });
    const result = await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      persistence: inMemoryPersistenceClient(),
    });
    check(r, result.ok, `stored-backtest ok=${result.ok}`);
    check(
      r,
      result.data?.scheduleValidationDebug === null ||
        result.data?.scheduleValidationDebug === undefined,
      `debug should be null/undefined on success, got: ${JSON.stringify(result.data?.scheduleValidationDebug)}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — debug payload only attached on failure");
    else console.log("[7] FAIL — debug-on-success");
  }

  // 8. No banned hooks in the debug helper code path.
  {
    const r = makeReport("no banned hooks in debug helper");
    const text = readSrc("scripts/debug-week-1-schedule-mapping.ts");
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
      check(r, !re.test(text), `debug helper contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — debug helper has no banned hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 8 schedule-mapping-debug assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

// Silence lint warning that SubprocessRunner / SubprocessSpec
// imports aren't used (the test injects persistence, not spawn).
type _unused = SubprocessRunner | SubprocessResult | SubprocessSpec;
void (null as unknown as _unused);

main();
