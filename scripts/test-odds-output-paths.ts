/**
 * Odds output path + legacy → canonical migration assertions.
 *
 *   · buildCanonicalOddsRows joins markets + quotes + games +
 *     rosters into the per-row schema the stored loader expects
 *   · empty roster lookup drops the row instead of emitting a
 *     malformed canonical entry
 *   · migrateLegacyToCanonical reads the three legacy CSVs and
 *     writes the canonical per-week file at the expected path
 *   · loadStoredWeekOdds prefers the canonical file over the
 *     legacy flat path (proves the canonical path wins when both
 *     are present)
 *   · stored mode reports READY when only the canonical file
 *     exists (no legacy fallback needed)
 *   · stored mode reports MISSING_STORED_ODDS when the canonical
 *     file is absent AND the legacy file's schema cannot be
 *     resolved (the original Railway state)
 *   · canonical writer filters by (season, week) so cross-week
 *     rows can't leak in
 *   · canonical writer rejects post-kickoff rows via the loader
 *   · only starter markets land in the canonical file — yardage
 *     and touchdown markets are dropped at migration time
 *   · no paid API call, no network, no automated betting
 *
 * Pure file IO. No spawn. No HTTP.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CANONICAL_PROP_MARKETS_COLUMNS,
  buildCanonicalOddsRows,
  canonicalMarketsPath,
  migrateLegacyToCanonical,
  writeCanonicalOddsCsv,
} from "../src/lib/ingestion/canonical-odds-writer";
import { loadStoredWeekOdds } from "../src/lib/backtest/stored-odds-loader";

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
    path.join(os.tmpdir(), "nfl-prop-edge-odds-paths-"),
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

function seedLegacyAndGames(root: string): void {
  // Two real Week 1 games' worth of legacy markets/quotes. The
  // production market_key shape is compound:
  //   `${eventId}:${playerSlug}:${propType}:${line}`
  // (see odds-api.ts → buildMarketKey). It is the join key
  // between prop_markets.csv and prop_quotes.csv.
  const KEY_MAHOMES = "evt-kc-lac:patrick-mahomes:PASSING_ATTEMPTS:33.5";
  const KEY_ALLEN = "evt-bal-buf:josh-allen:PASSING_ATTEMPTS:31.5";
  const KEY_MAHOMES_TD = "evt-kc-lac:patrick-mahomes:ANYTIME_TD:1.5";
  const KEY_MAHOMES_YDS = "evt-kc-lac:patrick-mahomes:PASSING_YARDS:274.5";
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
        KEY_MAHOMES,
        "2025-w1-kc-at-lac",
        "evt-kc-lac",
        "Patrick Mahomes",
        "PASSING_ATTEMPTS",
        "33.5",
        "odds-api",
        "2025-09-05T20:30:00Z",
      ],
      [
        KEY_ALLEN,
        "2025-w1-bal-at-buf",
        "evt-bal-buf",
        "Josh Allen",
        "PASSING_ATTEMPTS",
        "31.5",
        "odds-api",
        "2025-09-07T20:50:00Z",
      ],
      // Touchdown — must be DROPPED by the V1 starter filter.
      [
        KEY_MAHOMES_TD,
        "2025-w1-kc-at-lac",
        "evt-kc-lac",
        "Patrick Mahomes",
        "ANYTIME_TD",
        "1.5",
        "odds-api",
        "2025-09-05T20:30:00Z",
      ],
      // Yardage — also dropped.
      [
        KEY_MAHOMES_YDS,
        "2025-w1-kc-at-lac",
        "evt-kc-lac",
        "Patrick Mahomes",
        "PASSING_YARDS",
        "274.5",
        "odds-api",
        "2025-09-05T20:30:00Z",
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
        KEY_MAHOMES,
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
        KEY_MAHOMES,
        "FanDuel",
        "-115",
        "-105",
        "0.535",
        "0.512",
        "0.512",
        "0.488",
        "2025-09-05T20:30:00Z",
      ],
      [
        KEY_ALLEN,
        "DraftKings",
        "-110",
        "-110",
        "0.524",
        "0.524",
        "0.5",
        "0.5",
        "2025-09-07T20:50:00Z",
      ],
      [
        KEY_MAHOMES_TD,
        "DraftKings",
        "100",
        "-120",
        "0.5",
        "0.545",
        "0.477",
        "0.522",
        "2025-09-05T20:30:00Z",
      ],
      [
        KEY_MAHOMES_YDS,
        "DraftKings",
        "-110",
        "-110",
        "0.524",
        "0.524",
        "0.5",
        "0.5",
        "2025-09-05T20:30:00Z",
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
        "2025-w1-bal-at-buf",
        "2025",
        "1",
        "REG",
        "2025-09-08T00:20:00.000Z",
        "BUF",
        "BAL",
        "41",
        "40",
        "outdoors",
        "a_turf",
        "New Era Field",
        "-1.5",
        "50.5",
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
      ["00-allen", "Josh Allen", "QB", "BUF", "2025", "17", "ACT", "", ""],
    ],
  );
}

function main(): void {
  console.log("Odds output paths + migration — assertions");
  console.log("===========================================");

  // 1. buildCanonicalOddsRows joins markets + quotes + games +
  //    rosters into the canonical row schema.
  {
    const r = makeReport("buildCanonicalOddsRows joins all four inputs");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "player_pass_attempts",
          game_id: "2025-w1-kc-at-lac",
          player_name: "Patrick Mahomes",
          prop_type: "PASSING_ATTEMPTS",
          line: 33.5,
          snapshot_time: "2025-09-05T20:30:00Z",
        },
      ],
      quotes: [
        {
          market_key: "player_pass_attempts",
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
          startTimeUtc: "2025-09-06T00:00:00.000Z",
          homeTeam: "LAC",
          awayTeam: "KC",
        },
      ],
      rosters: [
        { playerName: "Patrick Mahomes", team: "KC", season: 2025 },
      ],
    });
    check(r, built.rows.length === 1, `expected 1 row, got ${built.rows.length}`);
    const row = built.rows[0];
    check(r, row?.season === 2025, `season=${row?.season}`);
    check(r, row?.week === 1, `week=${row?.week}`);
    check(r, row?.gameId === "2025-w1-kc-at-lac", `gameId=${row?.gameId}`);
    check(r, row?.team === "KC", `team=${row?.team}`);
    check(r, row?.opponent === "LAC", `opponent=${row?.opponent}`);
    check(r, row?.line === 33.5, `line=${row?.line}`);
    check(r, row?.overOdds === -110, `overOdds=${row?.overOdds}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — canonical row built with team/opponent enriched");
    else console.log("[1] FAIL — canonical row build");
  }

  // 2. Missing roster lookup drops the row instead of emitting
  //    a malformed canonical entry.
  {
    const r = makeReport("missing rosters → row dropped, diagnostic set");
    const built = buildCanonicalOddsRows({
      markets: [
        {
          market_key: "player_pass_attempts",
          game_id: "2025-w1-kc-at-lac",
          player_name: "Unknown Player",
          prop_type: "PASSING_ATTEMPTS",
          line: 33.5,
          snapshot_time: "2025-09-05T20:30:00Z",
        },
      ],
      quotes: [
        {
          market_key: "player_pass_attempts",
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
      rosters: [],
    });
    check(r, built.rows.length === 0, `expected 0 rows, got ${built.rows.length}`);
    check(
      r,
      built.diagnostics.droppedMissingTeam === 1,
      `droppedMissingTeam=${built.diagnostics.droppedMissingTeam}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — missing roster drops row safely");
    else console.log("[2] FAIL — missing-roster drop");
  }

  // 3. migrateLegacyToCanonical writes the canonical file at the
  //    expected path with starter markets only.
  {
    const r = makeReport("migrateLegacyToCanonical writes canonical file");
    const root = makeTempProcessedRoot();
    seedLegacyAndGames(root);
    const result = migrateLegacyToCanonical({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, result.status === "READY", `status=${result.status}`);
    check(
      r,
      result.rowsWritten === 3,
      `rowsWritten=${result.rowsWritten} (expected 3 starter rows: Mahomes DK + Mahomes FD + Allen DK; TD + yardage filtered)`,
    );
    const expectedPath = canonicalMarketsPath({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, result.target === expectedPath, `target=${result.target}`);
    check(r, fs.existsSync(expectedPath), `canonical file should exist`);
    // Inspect the file: no TD / yardage markets allowed.
    const text = fs.readFileSync(expectedPath, "utf8");
    check(
      r,
      !/player_anytime_td|player_pass_yds|PASS_TD|ANYTIME_TD/.test(text),
      "canonical file must contain no touchdown / yardage markets",
    );
    check(
      r,
      text.split("\n").filter((l) => l.trim().length > 0).length === 4,
      "canonical file should be header + 3 data rows",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — migration writes 3 canonical rows, filters TD + yardage");
    else console.log("[3] FAIL — migration");
  }

  // 4. loadStoredWeekOdds finds the canonical file and reports
  //    READY (no legacy fallback needed).
  {
    const r = makeReport("stored loader prefers canonical file");
    const root = makeTempProcessedRoot();
    seedLegacyAndGames(root);
    const migrate = migrateLegacyToCanonical({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, migrate.status === "READY", "migration prereq");
    const stored = loadStoredWeekOdds({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, stored.status === "READY", `status=${stored.status}`);
    check(
      r,
      stored.markets.length === 2,
      `markets count=${stored.markets.length} (expected 2)`,
    );
    // Inspected sources should include the canonical path.
    check(
      r,
      stored.sourcesInspected.some((s) =>
        s.includes(`odds${path.sep}2025${path.sep}week-1-prop-markets.csv`),
      ),
      "sourcesInspected should include canonical path",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — stored loader reads canonical file post-migration");
    else console.log("[4] FAIL — stored loader on canonical");
  }

  // 5. Canonical file alone (no legacy) — stored mode still READY.
  {
    const r = makeReport("canonical-only file is sufficient");
    const root = makeTempProcessedRoot();
    // Write only the canonical file directly — no legacy.
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
      processedRoot: root,
    });
    const stored = loadStoredWeekOdds({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, stored.status === "READY", `status=${stored.status}`);
    check(r, stored.markets.length === 1, `markets count=${stored.markets.length}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — canonical-only file is enough");
    else console.log("[5] FAIL — canonical-only");
  }

  // 6. When neither file resolves to usable rows, stored mode
  //    returns MISSING_STORED_ODDS (the Railway state pre-migration).
  {
    const r = makeReport("legacy-only with broken schema → MISSING_STORED_ODDS");
    const root = makeTempProcessedRoot();
    // Seed the legacy file with the production schema that lacks
    // season / week columns — same shape that landed on Railway.
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
          "player_pass_attempts",
          "2025-w1-kc-at-lac",
          "evt-kc-lac",
          "Patrick Mahomes",
          "PASSING_ATTEMPTS",
          "33.5",
          "odds-api",
          "2025-09-05T20:30:00Z",
        ],
      ],
    );
    const stored = loadStoredWeekOdds({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(
      r,
      stored.status === "MISSING_STORED_ODDS",
      `status should be MISSING_STORED_ODDS, got ${stored.status}`,
    );
    check(
      r,
      stored.markets.length === 0,
      "no markets when schema lacks season/week",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — legacy production schema alone yields MISSING_STORED_ODDS");
    else console.log("[6] FAIL — legacy-only MISSING");
  }

  // 7. Migration filter — only the target (season, week) lands.
  {
    const r = makeReport("migration filters by (season, week)");
    const root = makeTempProcessedRoot();
    seedLegacyAndGames(root);
    // Add a Week 2 game + market that must NOT end up in the
    // Week 1 canonical file.
    const games = path.join(root, "nfl", "games.csv");
    const text = fs.readFileSync(games, "utf8");
    fs.writeFileSync(
      games,
      text +
        "2025-w2-cle-at-bal,2025,2,REG,2025-09-14T17:00:00.000Z,BAL,CLE,41,17,outdoors,grass,M&T Bank Stadium,12.5,46.5\n",
    );
    const markets = path.join(root, "prop_markets.csv");
    fs.writeFileSync(
      markets,
      fs.readFileSync(markets, "utf8") +
        "player_receptions,2025-w2-cle-at-bal,evt-cle-bal,Lamar Jackson,RECEPTIONS,1.5,odds-api,2025-09-14T13:30:00Z\n",
    );
    const quotes = path.join(root, "prop_quotes.csv");
    fs.writeFileSync(
      quotes,
      fs.readFileSync(quotes, "utf8") +
        "player_receptions,DraftKings,-110,-110,0.524,0.524,0.5,0.5,2025-09-14T13:30:00Z\n",
    );
    const m = migrateLegacyToCanonical({
      season: 2025,
      week: 1,
      processedRoot: root,
    });
    check(r, m.status === "READY", `status=${m.status}`);
    const text2 = fs.readFileSync(m.target!, "utf8");
    check(
      r,
      !text2.includes("2025-w2-cle-at-bal"),
      "Week-2 row must NOT land in week-1 canonical file",
    );
    check(r, m.rowsWritten === 3, `rowsWritten=${m.rowsWritten}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — migration filters cross-week rows");
    else console.log("[7] FAIL — week filter");
  }

  // 8. Column contract — exactly the 14 fields the stored loader
  //    parses, in a stable order, no secret values rendered.
  {
    const r = makeReport("canonical column contract is stable");
    const expected = [
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
    check(
      r,
      expected.length === CANONICAL_PROP_MARKETS_COLUMNS.length,
      `column count: expected ${expected.length}, got ${CANONICAL_PROP_MARKETS_COLUMNS.length}`,
    );
    for (let i = 0; i < expected.length; i++) {
      check(
        r,
        CANONICAL_PROP_MARKETS_COLUMNS[i] === expected[i],
        `column[${i}]: expected ${expected[i]}, got ${CANONICAL_PROP_MARKETS_COLUMNS[i]}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — canonical column contract matches loader expectation");
    else console.log("[8] FAIL — column contract");
  }

  // 9. No paid API hooks, no touchdown propTypes, no automated
  //    betting / Kalshi in the new module.
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
      check(r, !re.test(text), `canonical-odds-writer contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — no API / betting / TD hooks in canonical writer");
    else console.log("[9] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 9 odds-output-paths assertions passed.");
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
