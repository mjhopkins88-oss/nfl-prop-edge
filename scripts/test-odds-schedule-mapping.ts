/**
 * Week 1 odds → schedule mapping assertions.
 *
 *   · normalizeTeamAbbreviation maps LA → LAR and leaves
 *     fixture-canonical codes alone
 *   · canonical odds writer emits gameIds that match the
 *     schedule fixture even when games.csv uses the nflverse
 *     "LA" code
 *   · player team from rosters is normalized too — Stafford on
 *     "LA" becomes "LAR" in the canonical output
 *   · validateCanonicalOddsGameIds reports invalid IDs the way
 *     the admin UI would surface them
 *   · getRealWeekScheduleFromProcessedData rewrites games.csv's
 *     "LA" → "LAR" so the in-schedule filter and the team-pair
 *     validator agree
 *   · stored mode end-to-end: real-week candidate builder
 *     status=READY, schedule report=PASS, candidates > 0 when
 *     the canonical odds reference all 16 games (including the
 *     HOU @ Rams game that previously broke validation)
 *   · no touchdown propTypes, no automated betting, no API
 *     hooks in the new mapper module
 *
 * Pure file IO + module import. No spawn. No HTTP. No paid
 * call.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TEAM_ALIASES,
  buildWeek1GameLookupByTeams,
  mapOddsGameToScheduleGame,
  normalizeTeamAbbreviation,
  validateCanonicalOddsGameIds,
} from "../src/lib/backtest/week-1-game-id-mapper";
import {
  buildCanonicalOddsRows,
  migrateLegacyToCanonical,
} from "../src/lib/ingestion/canonical-odds-writer";
import { getRealWeekScheduleFromProcessedData } from "../src/lib/backtest/processed-nfl-loader";
import { getExpectedWeek1Schedule } from "../src/lib/backtest/week-1-schedule-validation";
import { buildRealWeek1CandidatesFromStoredData } from "../src/lib/backtest/real-week-candidate-builder";

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
function makeTempProcessedRoot(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nfl-prop-edge-schedule-mapping-"),
  );
  fs.mkdirSync(path.join(dir, "odds", "2025"), { recursive: true });
  fs.mkdirSync(path.join(dir, "nfl"), { recursive: true });
  return dir;
}
function writeCsv(p: string, headers: string[], rows: string[][]): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const body = [headers.join(",")]
    .concat(rows.map((r) => r.join(",")))
    .join("\n");
  fs.writeFileSync(p, body + "\n");
}

function main(): void {
  console.log("Odds → schedule mapping — assertions");
  console.log("=====================================");

  // 1. Team alias map: LA → LAR, others pass through.
  {
    const r = makeReport("normalizeTeamAbbreviation aliases");
    check(r, TEAM_ALIASES.LA === "LAR", `TEAM_ALIASES.LA = ${TEAM_ALIASES.LA}`);
    check(r, normalizeTeamAbbreviation("LA") === "LAR", "LA → LAR");
    check(r, normalizeTeamAbbreviation("la") === "LAR", "lowercase la → LAR");
    check(r, normalizeTeamAbbreviation("LAR") === "LAR", "LAR stays");
    check(r, normalizeTeamAbbreviation("KC") === "KC", "KC pass-through");
    check(r, normalizeTeamAbbreviation("BUF") === "BUF", "BUF pass-through");
    check(r, normalizeTeamAbbreviation("JAC") === "JAX", "JAC → JAX defensive");
    check(r, normalizeTeamAbbreviation("WSH") === "WAS", "WSH → WAS defensive");
    check(r, normalizeTeamAbbreviation("ARZ") === "ARI", "ARZ → ARI defensive");
    check(r, normalizeTeamAbbreviation("") === "", "empty stays empty");
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — LA → LAR + defensive aliases");
    else console.log("[1] FAIL — alias map");
  }

  // 2. mapOddsGameToScheduleGame — team-pair lookup works in both orientations.
  {
    const r = makeReport("mapOddsGameToScheduleGame");
    const schedule = getExpectedWeek1Schedule().games;
    // The LA Rams game in the fixture: HOU @ LAR.
    const houAtLar = mapOddsGameToScheduleGame({
      team: "HOU",
      opponent: "LAR",
      schedule,
    });
    check(r, houAtLar?.gameId === "2025-w1-hou-at-lar", `HOU/LAR mapped to ${houAtLar?.gameId}`);
    // Player on the Rams (nflverse "LA") opponent Texans.
    const laAtHou = mapOddsGameToScheduleGame({
      team: "LA",
      opponent: "HOU",
      schedule,
    });
    check(
      r,
      laAtHou?.gameId === "2025-w1-hou-at-lar",
      `LA/HOU mapped to ${laAtHou?.gameId}`,
    );
    // Sanity — KC @ LAC works either way.
    const kc = mapOddsGameToScheduleGame({
      team: "KC",
      opponent: "LAC",
      schedule,
    });
    check(r, kc?.gameId === "2025-w1-kc-at-lac", `KC/LAC mapped to ${kc?.gameId}`);
    // Bogus team pair → undefined.
    const bogus = mapOddsGameToScheduleGame({
      team: "KC",
      opponent: "BAL",
      schedule,
    });
    check(r, bogus === undefined, `bogus pair returned ${bogus?.gameId ?? "undefined"}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — pair lookup tolerates LA / LAR and either orientation");
    else console.log("[2] FAIL — pair lookup");
  }

  // 3. Canonical writer emits the LAR gameId even when the game's
  //    home/away come in as the nflverse "LA" code.
  {
    const r = makeReport("canonical writer rewrites LA → LAR");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "evt-hou-la:matthew-stafford:PASSING_ATTEMPTS:33.5",
          game_id: "2025-w1-hou-at-la",
          player_name: "Matthew Stafford",
          prop_type: "PASSING_ATTEMPTS",
          line: 33.5,
          snapshot_time: "2025-09-07T17:30:00Z",
        },
      ],
      quotes: [
        {
          market_key: "evt-hou-la:matthew-stafford:PASSING_ATTEMPTS:33.5",
          book_name: "DraftKings",
          over_price: -110,
          under_price: -110,
          quote_time: "2025-09-07T17:30:00Z",
        },
      ],
      games: [
        {
          gameId: "2025-w1-hou-at-la",
          season: 2025,
          week: 1,
          startTimeUtc: "2025-09-07T20:25:00Z",
          homeTeam: "LA",
          awayTeam: "HOU",
        },
      ],
      rosters: [
        { playerName: "Matthew Stafford", team: "LA", season: 2025 },
      ],
    });
    check(r, built.rows.length === 1, `expected 1 row, got ${built.rows.length}`);
    const row = built.rows[0];
    check(
      r,
      row?.gameId === "2025-w1-hou-at-lar",
      `gameId should be 2025-w1-hou-at-lar, got ${row?.gameId}`,
    );
    check(r, row?.team === "LAR", `team should be LAR, got ${row?.team}`);
    check(r, row?.opponent === "HOU", `opponent should be HOU, got ${row?.opponent}`);
    // GameId must be one of the schedule fixture's IDs.
    const fixtureIds = new Set(
      getExpectedWeek1Schedule().games.map((g) => g.gameId),
    );
    check(
      r,
      fixtureIds.has(row?.gameId ?? ""),
      `canonical gameId must be in fixture; got ${row?.gameId}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — canonical writer normalizes LA → LAR end-to-end");
    else console.log("[3] FAIL — canonical writer");
  }

  // 4. validateCanonicalOddsGameIds surfaces the count of rows
  //    that would still fail after normalization.
  {
    const r = makeReport("validateCanonicalOddsGameIds diagnostic");
    const schedule = getExpectedWeek1Schedule().games;
    const report = validateCanonicalOddsGameIds({
      rows: [
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-hou-at-lar",
          team: "LAR",
          opponent: "HOU",
        },
        {
          season: 2025,
          week: 1,
          gameId: "2025-w1-kc-at-lac",
          team: "KC",
          opponent: "LAC",
        },
        // The legacy-id form — should be flagged invalid but
        // rebuildable from the team pair.
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
    check(r, report.totalRows === 3, `totalRows=${report.totalRows}`);
    check(r, report.validRows === 2, `validRows=${report.validRows}`);
    check(
      r,
      report.invalidGameIds.length === 1 &&
        report.invalidGameIds[0] === "2025-w1-hou-at-la",
      `invalid: ${JSON.stringify(report.invalidGameIds)}`,
    );
    check(
      r,
      report.rebuildableRows === 1,
      `rebuildableRows=${report.rebuildableRows} (should be 1 for LA→LAR case)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — validator surfaces the LA→LAR rebuildable row");
    else console.log("[4] FAIL — validator");
  }

  // 5. getRealWeekScheduleFromProcessedData rewrites games.csv
  //    "LA" → "LAR" + canonical gameId.
  {
    const r = makeReport("schedule loader normalizes processed games.csv");
    const root = makeTempProcessedRoot();
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
    const r2 = getRealWeekScheduleFromProcessedData({
      season: 2025,
      week: 1,
      processedDir: path.join(root, "nfl"),
    });
    check(r, r2.status === "READY", `status=${r2.status}`);
    const game = r2.games[0];
    check(
      r,
      game?.gameId === "2025-w1-hou-at-lar",
      `gameId should be 2025-w1-hou-at-lar, got ${game?.gameId}`,
    );
    check(r, game?.homeTeam === "LAR", `homeTeam=${game?.homeTeam}`);
    check(r, game?.awayTeam === "HOU", `awayTeam=${game?.awayTeam}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — processed schedule loader normalizes LA → LAR");
    else console.log("[5] FAIL — schedule loader normalization");
  }

  // 6. End-to-end: stored mode succeeds when canonical odds use
  //    LA-era gameIds — the writer normalizes on the way out and
  //    the schedule loader's normalized view agrees.
  {
    const r = makeReport("end-to-end: builder READY after normalization");
    const root = makeTempProcessedRoot();
    // Write a Week 1 games.csv that includes HOU@LA (nflverse).
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
      ],
    );
    // Player history for the strict-before filter.
    writeCsv(
      path.join(root, "nfl", "player_week_stats.csv"),
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
          "00-stafford",
          "Matthew Stafford",
          "QB",
          "LA",
          "BAL",
          "2024",
          "18",
          "2024-w18-bal-at-la",
          "HOME",
          "33",
        ],
      ],
    );
    // Canonical odds — written WITH the normalized gameId/team
    // (the format the post-fix writer produces).
    writeCsv(
      path.join(root, "odds", "2025", "week-1-prop-markets.csv"),
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
          "2025",
          "1",
          "2025-w1-hou-at-lar",
          "2025-09-07T20:25:00Z",
          "DraftKings",
          "Matthew Stafford",
          "LAR",
          "HOU",
          "player_pass_attempts",
          "PASSING_ATTEMPTS",
          "33.5",
          "-110",
          "-110",
          "2025-09-07T17:00:00Z",
        ],
        [
          "2025",
          "1",
          "2025-w1-kc-at-lac",
          "2025-09-06T00:00:00Z",
          "DraftKings",
          "Patrick Mahomes",
          "KC",
          "LAC",
          "player_pass_attempts",
          "PASSING_ATTEMPTS",
          "33.5",
          "-110",
          "-110",
          "2025-09-05T20:30:00Z",
        ],
      ],
    );
    const result = buildRealWeek1CandidatesFromStoredData({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, result.status === "READY", `status=${result.status} (notes: ${result.notes.join("; ")})`);
    check(
      r,
      result.scheduleReport?.status === "PASS",
      `schedule report=${result.scheduleReport?.status}`,
    );
    check(
      r,
      result.candidates.length === 2,
      `expected 2 candidates (one per game), got ${result.candidates.length}`,
    );
    const ids = new Set(result.candidates.map((c) => c.gameId));
    check(
      r,
      ids.has("2025-w1-hou-at-lar"),
      "HOU@LAR candidate must survive validation",
    );
    check(
      r,
      ids.has("2025-w1-kc-at-lac"),
      "KC@LAC candidate must survive validation",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[6] PASS — stored mode READY with ${result.candidates.length} candidates after normalization`,
      );
    else console.log("[6] FAIL — stored mode end-to-end");
  }

  // 7. Migration end-to-end: legacy game_id "2025-w1-hou-at-la"
  //    becomes canonical "2025-w1-hou-at-lar" in the output file.
  {
    const r = makeReport("legacy → canonical migration normalizes LA → LAR");
    const root = makeTempProcessedRoot();
    // Legacy ingest output — what the script wrote pre-fix.
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
    const m = migrateLegacyToCanonical({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, m.status === "READY", `status=${m.status}`);
    check(r, m.rowsWritten === 1, `rowsWritten=${m.rowsWritten}`);
    const text = fs.readFileSync(m.target!, "utf8");
    check(
      r,
      text.includes("2025-w1-hou-at-lar"),
      "canonical file must contain the LAR gameId",
    );
    check(
      r,
      !text.includes("2025-w1-hou-at-la,"),
      "canonical file must NOT contain the LA gameId (with trailing comma to avoid lar substring match)",
    );
    check(r, text.includes(",LAR,HOU,"), "team must be LAR, opponent HOU");
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — migration rewrites LA → LAR in canonical output");
    else console.log("[7] FAIL — migration normalization");
  }

  // 8. buildWeek1GameLookupByTeams covers both ordered and
  //    unordered keys.
  {
    const r = makeReport("buildWeek1GameLookupByTeams keys");
    const lookup = buildWeek1GameLookupByTeams(getExpectedWeek1Schedule().games);
    check(r, lookup.has("HOU@LAR"), "HOU@LAR pair key");
    check(r, lookup.has("HOU+LAR"), "HOU+LAR set key");
    check(r, lookup.has("KC@LAC"), "KC@LAC pair key");
    check(r, lookup.has("KC+LAC"), "KC+LAC set key");
    check(r, !lookup.has("HOU@LA"), "non-canonical LA key must not be present");
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — lookup keys use canonical abbreviations only");
    else console.log("[8] FAIL — lookup keys");
  }

  // 9. No paid API / Kalshi / TD / fetch hooks in the mapper.
  {
    const r = makeReport("no banned hooks in week-1-game-id-mapper");
    const text = readSrc("src/lib/backtest/week-1-game-id-mapper.ts");
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
      check(r, !re.test(text), `mapper contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — no API / betting / TD hooks in mapper");
    else console.log("[9] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 9 odds-schedule-mapping assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

main();
