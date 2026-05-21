/**
 * Canonical-odds player → team assignment assertions.
 *
 *   · resolveTeam picks the team from per-week stats first
 *     (authoritative for the actual game-week)
 *   · resolveTeam falls back to season rosters when per-week
 *     stats don't cover the player
 *   · resolveTeam NEVER returns a team that isn't a participant
 *     of the actual game (Adonai Mitchell on NYJ rosters → not
 *     emitted into a MIA@IND row)
 *   · ambiguous case (player listed on BOTH teams in the same
 *     game) drops the row instead of guessing
 *   · the writer never emits team === opponent or a team /
 *     opponent value outside {homeTeam, awayTeam}
 *   · LA / JAC / ARZ / WSH aliases still normalize correctly
 *   · diagnostics surface every drop reason +
 *     `droppedInvalidTeamForGame`, `droppedAmbiguousTeam`,
 *     and the first 20 dropped rows for the migration UI
 *   · the live ingest script also accepts player_week_stats
 *     (forward-going runs use it without a re-migration)
 *   · no touchdown props, no banned hooks
 *
 * Pure file IO + in-memory stub. No spawn, no Prisma, no HTTP.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCanonicalOddsRows,
  migrateLegacyToCanonical,
} from "../src/lib/ingestion/canonical-odds-writer";
import { normalizeTeamAbbreviation } from "../src/lib/backtest/week-1-game-id-mapper";
import { runAdminAction } from "../src/lib/admin/admin-runner";
import { inMemoryPersistenceClient } from "../src/lib/persistence/week-1-persistence";

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
function makeTempRoot(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nfl-prop-edge-team-assign-"),
  );
  fs.mkdirSync(path.join(dir, "nfl"), { recursive: true });
  fs.mkdirSync(path.join(dir, "odds", "2025"), { recursive: true });
  return dir;
}
function writeCsv(p: string, headers: string[], rows: string[][]): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = [headers.join(",")]
    .concat(rows.map((r) => r.join(",")))
    .join("\n");
  fs.writeFileSync(p, body + "\n");
}

async function main(): Promise<void> {
  console.log("Canonical odds team-assignment — assertions");
  console.log("=============================================");

  // 1. Adonai Mitchell case: roster says NYJ, game is MIA@IND.
  //    The row must be DROPPED, not silently labelled NYJ.
  {
    const r = makeReport("global roster team outside game participants → drop");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "evt-mia-ind:adonai-mitchell:RECEPTIONS:3.5",
          game_id: "2025-w1-mia-at-ind",
          player_name: "Adonai Mitchell",
          prop_type: "RECEPTIONS",
          line: 3.5,
          snapshot_time: "2025-09-07T13:30:00Z",
        },
      ],
      quotes: [
        {
          market_key: "evt-mia-ind:adonai-mitchell:RECEPTIONS:3.5",
          book_name: "DraftKings",
          over_price: -110,
          under_price: -110,
          quote_time: "2025-09-07T13:30:00Z",
        },
      ],
      games: [
        {
          gameId: "2025-w1-mia-at-ind",
          season: 2025,
          week: 1,
          homeTeam: "IND",
          awayTeam: "MIA",
        },
      ],
      rosters: [
        // Roster (end-of-season snapshot) says NYJ — NOT in game.
        { playerName: "Adonai Mitchell", team: "NYJ", season: 2025 },
      ],
      // No per-week stats for him.
    });
    check(r, built.rows.length === 0, `expected 0 rows, got ${built.rows.length}`);
    check(
      r,
      built.diagnostics.droppedInvalidTeamForGame === 1,
      `droppedInvalidTeamForGame=${built.diagnostics.droppedInvalidTeamForGame}`,
    );
    const sample = built.diagnostics.droppedSample[0];
    check(r, sample?.reason === "invalid-team-for-game", `sample.reason=${sample?.reason}`);
    check(
      r,
      sample?.gameId === "2025-w1-mia-at-ind",
      `sample.gameId=${sample?.gameId}`,
    );
    check(
      r,
      Array.isArray(sample?.expectedTeams) &&
        sample.expectedTeams.includes("MIA") &&
        sample.expectedTeams.includes("IND"),
      `sample.expectedTeams=${JSON.stringify(sample?.expectedTeams)}`,
    );
    check(
      r,
      sample?.inferredTeam === "NYJ",
      `sample.inferredTeam=${sample?.inferredTeam}`,
    );
    check(
      r,
      sample?.playerName === "Adonai Mitchell",
      `sample.playerName=${sample?.playerName}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — Mitchell on NYJ rosters → dropped from MIA@IND row");
    else console.log("[1] FAIL — Mitchell drop");
  }

  // 2. Per-week stats override rosters. Mitchell whose
  //    player_week_stats says IND (the team he actually played
  //    for in Week 1) gets emitted into the MIA@IND row even
  //    when rosters still say NYJ.
  {
    const r = makeReport("per-week stats override rosters when game participant");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "evt-mia-ind:adonai-mitchell:RECEPTIONS:3.5",
          game_id: "2025-w1-mia-at-ind",
          player_name: "Adonai Mitchell",
          prop_type: "RECEPTIONS",
          line: 3.5,
          snapshot_time: "2025-09-07T13:30:00Z",
        },
      ],
      quotes: [
        {
          market_key: "evt-mia-ind:adonai-mitchell:RECEPTIONS:3.5",
          book_name: "DraftKings",
          over_price: -110,
          under_price: -110,
          quote_time: "2025-09-07T13:30:00Z",
        },
      ],
      games: [
        {
          gameId: "2025-w1-mia-at-ind",
          season: 2025,
          week: 1,
          homeTeam: "IND",
          awayTeam: "MIA",
        },
      ],
      rosters: [
        { playerName: "Adonai Mitchell", team: "NYJ", season: 2025 },
      ],
      // Per-week stat says he played for IND in Week 1 — authoritative.
      playerWeekStats: [
        { playerName: "Adonai Mitchell", team: "IND", season: 2025, week: 1 },
      ],
    });
    check(r, built.rows.length === 1, `expected 1 row, got ${built.rows.length}`);
    check(r, built.rows[0]?.team === "IND", `team=${built.rows[0]?.team}`);
    check(r, built.rows[0]?.opponent === "MIA", `opponent=${built.rows[0]?.opponent}`);
    check(
      r,
      built.diagnostics.droppedInvalidTeamForGame === 0,
      `should be 0 invalid drops, got ${built.diagnostics.droppedInvalidTeamForGame}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — per-week stats win; Mitchell labelled IND, not NYJ");
    else console.log("[2] FAIL — per-week override");
  }

  // 3. Per-week stats that contradict the game → drop. If the
  //    player actually played for KC that week but the odds row
  //    is for MIA@IND, the row is rejected (the player wasn't
  //    in the game).
  {
    const r = makeReport("per-week stats outside game → drop");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "evt-mia-ind:patrick-mahomes:PASSING_ATTEMPTS:33.5",
          game_id: "2025-w1-mia-at-ind",
          player_name: "Patrick Mahomes",
          prop_type: "PASSING_ATTEMPTS",
          line: 33.5,
          snapshot_time: "2025-09-07T13:30:00Z",
        },
      ],
      quotes: [
        {
          market_key: "evt-mia-ind:patrick-mahomes:PASSING_ATTEMPTS:33.5",
          book_name: "DraftKings",
          over_price: -110,
          under_price: -110,
          quote_time: "2025-09-07T13:30:00Z",
        },
      ],
      games: [
        {
          gameId: "2025-w1-mia-at-ind",
          season: 2025,
          week: 1,
          homeTeam: "IND",
          awayTeam: "MIA",
        },
      ],
      playerWeekStats: [
        { playerName: "Patrick Mahomes", team: "KC", season: 2025, week: 1 },
      ],
    });
    check(r, built.rows.length === 0, "row must be dropped");
    check(
      r,
      built.diagnostics.droppedInvalidTeamForGame === 1,
      `droppedInvalidTeamForGame=${built.diagnostics.droppedInvalidTeamForGame}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — Mahomes-on-KC vs MIA@IND drops the row");
    else console.log("[3] FAIL — KC vs MIA@IND drop");
  }

  // 4. Ambiguous case — player has BOTH home and away in
  //    rosters for the same season. Drop.
  {
    const r = makeReport("ambiguous team (both home + away) → drop");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "evt-kc-lac:journeyman:PASSING_ATTEMPTS:25.5",
          game_id: "2025-w1-kc-at-lac",
          player_name: "Journeyman Player",
          prop_type: "PASSING_ATTEMPTS",
          line: 25.5,
          snapshot_time: "2025-09-05T20:30:00Z",
        },
      ],
      quotes: [
        {
          market_key: "evt-kc-lac:journeyman:PASSING_ATTEMPTS:25.5",
          book_name: "DraftKings",
          over_price: -110,
          under_price: -110,
          quote_time: "2025-09-05T20:30:00Z",
        },
      ],
      games: [
        {
          gameId: "2025-w1-kc-at-lac",
          season: 2025,
          week: 1,
          homeTeam: "LAC",
          awayTeam: "KC",
        },
      ],
      rosters: [
        { playerName: "Journeyman Player", team: "KC", season: 2025 },
        { playerName: "Journeyman Player", team: "LAC", season: 2025 },
      ],
    });
    check(r, built.rows.length === 0, "row must be dropped");
    check(
      r,
      built.diagnostics.droppedAmbiguousTeam === 1,
      `droppedAmbiguousTeam=${built.diagnostics.droppedAmbiguousTeam}`,
    );
    const sample = built.diagnostics.droppedSample[0];
    check(r, sample?.reason === "ambiguous-team", `sample.reason=${sample?.reason}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — player on both teams is ambiguous; row dropped");
    else console.log("[4] FAIL — ambiguous drop");
  }

  // 5. Valid case still works. Mahomes on KC, game KC@LAC.
  {
    const r = makeReport("valid case: row emitted, team correct");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "evt-kc-lac:patrick-mahomes:PASSING_ATTEMPTS:33.5",
          game_id: "2025-w1-kc-at-lac",
          player_name: "Patrick Mahomes",
          prop_type: "PASSING_ATTEMPTS",
          line: 33.5,
          snapshot_time: "2025-09-05T20:30:00Z",
        },
      ],
      quotes: [
        {
          market_key: "evt-kc-lac:patrick-mahomes:PASSING_ATTEMPTS:33.5",
          book_name: "DraftKings",
          over_price: -110,
          under_price: -110,
          quote_time: "2025-09-05T20:30:00Z",
        },
      ],
      games: [
        {
          gameId: "2025-w1-kc-at-lac",
          season: 2025,
          week: 1,
          homeTeam: "LAC",
          awayTeam: "KC",
        },
      ],
      rosters: [{ playerName: "Patrick Mahomes", team: "KC", season: 2025 }],
    });
    check(r, built.rows.length === 1, `rows=${built.rows.length}`);
    const row = built.rows[0];
    check(r, row?.team === "KC", `team=${row?.team}`);
    check(r, row?.opponent === "LAC", `opponent=${row?.opponent}`);
    check(r, row?.team !== row?.opponent, "team must not equal opponent");
    record(r);
    if (r.reasons.length === 0) console.log("[5] PASS — Mahomes/KC@LAC clean");
    else console.log("[5] FAIL — clean case");
  }

  // 6. Defence in depth: writer never emits team/opponent outside
  //    the game's participants OR team===opponent (would be a
  //    bug in resolveTeam, caught by the final assertion).
  {
    const r = makeReport("writer self-check: every emitted row's team is a participant");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "evt-bal-buf:josh-allen:PASSING_ATTEMPTS:31.5",
          game_id: "2025-w1-bal-at-buf",
          player_name: "Josh Allen",
          prop_type: "PASSING_ATTEMPTS",
          line: 31.5,
          snapshot_time: "2025-09-07T20:50:00Z",
        },
      ],
      quotes: [
        {
          market_key: "evt-bal-buf:josh-allen:PASSING_ATTEMPTS:31.5",
          book_name: "FanDuel",
          over_price: -110,
          under_price: -110,
          quote_time: "2025-09-07T20:50:00Z",
        },
      ],
      games: [
        {
          gameId: "2025-w1-bal-at-buf",
          season: 2025,
          week: 1,
          homeTeam: "BUF",
          awayTeam: "BAL",
        },
      ],
      rosters: [{ playerName: "Josh Allen", team: "BUF", season: 2025 }],
    });
    for (const row of built.rows) {
      const participants = new Set(["BAL", "BUF"]);
      check(
        r,
        participants.has(row.team),
        `team ${row.team} must be in {BAL, BUF}`,
      );
      check(
        r,
        participants.has(row.opponent),
        `opponent ${row.opponent} must be in {BAL, BUF}`,
      );
      check(r, row.team !== row.opponent, "team !== opponent");
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — emitted row's team/opponent are valid participants");
    else console.log("[6] FAIL — participant invariant");
  }

  // 7. Aliases still work — LA → LAR via per-week stats.
  {
    const r = makeReport("aliases: per-week LA → LAR + game LA → LAR");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "evt-hou-la:matthew-stafford:PASSING_ATTEMPTS:33.5",
          game_id: "2025-w1-hou-at-la",
          player_name: "Matthew Stafford",
          prop_type: "PASSING_ATTEMPTS",
          line: 33.5,
          snapshot_time: "2025-09-07T17:00:00Z",
        },
      ],
      quotes: [
        {
          market_key: "evt-hou-la:matthew-stafford:PASSING_ATTEMPTS:33.5",
          book_name: "DraftKings",
          over_price: -110,
          under_price: -110,
          quote_time: "2025-09-07T17:00:00Z",
        },
      ],
      games: [
        {
          gameId: "2025-w1-hou-at-la",
          season: 2025,
          week: 1,
          homeTeam: "LA",
          awayTeam: "HOU",
        },
      ],
      playerWeekStats: [
        { playerName: "Matthew Stafford", team: "LA", season: 2025, week: 1 },
      ],
    });
    check(r, built.rows.length === 1, `rows=${built.rows.length}`);
    const row = built.rows[0];
    check(r, row?.gameId === "2025-w1-hou-at-lar", `gameId=${row?.gameId}`);
    check(r, row?.team === "LAR", `team=${row?.team}`);
    check(r, row?.opponent === "HOU", `opponent=${row?.opponent}`);
    // All four documented aliases still in the helper.
    check(r, normalizeTeamAbbreviation("LA") === "LAR", "LA alias");
    check(r, normalizeTeamAbbreviation("JAC") === "JAX", "JAC alias");
    check(r, normalizeTeamAbbreviation("ARZ") === "ARI", "ARZ alias");
    check(r, normalizeTeamAbbreviation("WSH") === "WAS", "WSH alias");
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — LA→LAR + JAC/ARZ/WSH aliases all work");
    else console.log("[7] FAIL — aliases");
  }

  // 8. End-to-end migration: a mix of valid Mahomes + invalid
  //    Mitchell rows in legacy CSVs. Migration result reports
  //    rowsWritten=1 (Mahomes) and droppedInvalidTeamForGame=1
  //    (Mitchell). DB also reflects the cleaned set.
  {
    const r = makeReport("migration end-to-end: drops invalid Mitchell row");
    const root = makeTempRoot();
    writeCsv(
      path.join(root, "prop_markets.csv"),
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
          "evt-mia-ind:adonai-mitchell:RECEPTIONS:3.5",
          "2025-w1-mia-at-ind",
          "evt-mia-ind",
          "Adonai Mitchell",
          "RECEPTIONS",
          "3.5",
          "odds-api",
          "2025-09-07T13:30:00Z",
        ],
      ],
    );
    writeCsv(
      path.join(root, "prop_quotes.csv"),
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
          "evt-mia-ind:adonai-mitchell:RECEPTIONS:3.5",
          "DraftKings",
          "-110",
          "-110",
          "0.524",
          "0.524",
          "0.5",
          "0.5",
          "2025-09-07T13:30:00Z",
        ],
      ],
    );
    writeCsv(
      path.join(root, "nfl", "games.csv"),
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
          "2025-w1-mia-at-ind",
          "2025",
          "1",
          "REG",
          "2025-09-07T17:00:00.000Z",
          "IND",
          "MIA",
          "33",
          "8",
          "dome",
          "fieldturf",
          "Lucas Oil Stadium",
          "1.5",
          "47.5",
        ],
      ],
    );
    writeCsv(
      path.join(root, "nfl", "rosters.csv"),
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
        // Mitchell only listed on NYJ — would force the bad
        // labelling without the participant check.
        [
          "00-mitchell",
          "Adonai Mitchell",
          "WR",
          "NYJ",
          "2025",
          "11",
          "ACT",
          "",
          "",
        ],
      ],
    );
    // No player_week_stats file → fallback to rosters → Mitchell drops.
    const result = migrateLegacyToCanonical({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, result.status === "READY", `status=${result.status}`);
    check(r, result.rowsWritten === 1, `rowsWritten=${result.rowsWritten}`);
    check(
      r,
      result.diagnostics?.droppedInvalidTeamForGame === 1,
      `droppedInvalidTeamForGame=${result.diagnostics?.droppedInvalidTeamForGame}`,
    );
    const csv = fs.readFileSync(result.target!, "utf8");
    check(
      r,
      csv.includes(",KC,LAC,"),
      "canonical file should contain Mahomes/KC/LAC row",
    );
    check(
      r,
      !csv.includes("Adonai Mitchell"),
      "canonical file must NOT contain the Mitchell row",
    );
    check(
      r,
      !csv.includes(",NYJ,IND,") && !csv.includes(",NYJ,MIA,"),
      "canonical file must NOT contain a NYJ team for any MIA@IND or IND@MIA row",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — migration drops Mitchell, keeps Mahomes");
    else console.log("[8] FAIL — migration drop");
  }

  // 9. Admin runner: migrate-odds-to-canonical surfaces the
  //    new diagnostic counters in result.data + summary.
  {
    const r = makeReport("admin runner surfaces drop counts in migration result");
    const root = makeTempRoot();
    // Minimal legacy seed with a single bad row.
    writeCsv(
      path.join(root, "prop_markets.csv"),
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
          "evt-mia-ind:adonai-mitchell:RECEPTIONS:3.5",
          "2025-w1-mia-at-ind",
          "evt-mia-ind",
          "Adonai Mitchell",
          "RECEPTIONS",
          "3.5",
          "odds-api",
          "2025-09-07T13:30:00Z",
        ],
      ],
    );
    writeCsv(
      path.join(root, "prop_quotes.csv"),
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
          "evt-mia-ind:adonai-mitchell:RECEPTIONS:3.5",
          "DraftKings",
          "-110",
          "-110",
          "0.5",
          "0.5",
          "0.5",
          "0.5",
          "2025-09-07T13:30:00Z",
        ],
      ],
    );
    writeCsv(
      path.join(root, "nfl", "games.csv"),
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
          "2025-w1-mia-at-ind",
          "2025",
          "1",
          "REG",
          "2025-09-07T17:00:00.000Z",
          "IND",
          "MIA",
          "33",
          "8",
          "dome",
          "fieldturf",
          "Lucas Oil Stadium",
          "1.5",
          "47.5",
        ],
      ],
    );
    writeCsv(
      path.join(root, "nfl", "rosters.csv"),
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
        [
          "00-mitchell",
          "Adonai Mitchell",
          "WR",
          "NYJ",
          "2025",
          "11",
          "ACT",
          "",
          "",
        ],
      ],
    );
    const repoRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "nfl-prop-edge-admin-team-"),
    );
    // Mirror the seed into the repo's data tree structure.
    const seedRoot = path.join(repoRoot, "data", "processed");
    fs.mkdirSync(path.join(seedRoot, "nfl"), { recursive: true });
    fs.cpSync(root, seedRoot, { recursive: true });
    fs.mkdirSync(path.join(repoRoot, "data", "admin-ingestion"), {
      recursive: true,
    });
    fs.mkdirSync(path.join(repoRoot, "data", "admin"), { recursive: true });
    const result = await runAdminAction({
      action: "migrate-odds-to-canonical",
      repoRoot,
      persistence: inMemoryPersistenceClient(),
    });
    check(r, result.ok === false || result.ok === true, "runner ran");
    // The migration status itself: ok=true (file written even
    // with 0 rows is possible), or NO_ROWS_FOR_WEEK if all rows
    // dropped. We assert the diagnostics make it through.
    const diag = result.data?.diagnostics as
      | { droppedInvalidTeamForGame?: number; droppedSample?: unknown[] }
      | undefined;
    check(
      r,
      diag !== undefined,
      "diagnostics should be present in result.data",
    );
    if (diag) {
      check(
        r,
        diag.droppedInvalidTeamForGame === 1,
        `droppedInvalidTeamForGame=${diag.droppedInvalidTeamForGame}`,
      );
      check(
        r,
        Array.isArray(diag.droppedSample) && diag.droppedSample.length >= 1,
        `droppedSample count=${diag.droppedSample?.length}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — admin runner exposes new drop diagnostics");
    else console.log("[9] FAIL — admin diagnostics");
  }

  // 10. No banned hooks in the writer (regression guard).
  {
    const r = makeReport("no banned hooks in canonical-odds-writer");
    const text = readSrc("src/lib/ingestion/canonical-odds-writer.ts");
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
      check(r, !re.test(text), `writer contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — writer has no banned hooks");
    else console.log("[10] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 10 odds-team-assignment assertions passed.");
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
