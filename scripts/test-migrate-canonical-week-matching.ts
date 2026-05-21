/**
 * Canonical migration week-matching assertions.
 *
 *   · When the legacy CSV contains markets from a DIFFERENT week
 *     than the one being migrated, the result is
 *     NO_ROWS_FOR_WEEK with a clear diagnostic: marketWeekHisto-
 *     gram, droppedWrongWeek, sampleMarketGameIds, and
 *     sampleScheduleGameIds — NOT the confusing
 *     "droppedMissingGame" path that previously fired.
 *   · The targetSeason / targetWeek fields are echoed on every
 *     result so the operator can confirm the action used the
 *     week the UI sent.
 *   · The success path includes the same enrichment fields so
 *     downstream tooling can reuse them.
 *   · Markets with an unparseable gameId fall through to the
 *     writer's normal join (legacy "missing-game" still flags
 *     true joining problems).
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { migrateLegacyToCanonical } from "../src/lib/ingestion/canonical-odds-writer";

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

function makeTempRoot(): { root: string; processed: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-test-"));
  const processed = path.join(root, "data", "processed");
  fs.mkdirSync(path.join(processed, "nfl"), { recursive: true });
  return { root, processed };
}

function seedLegacy(args: {
  processed: string;
  markets: Array<{
    market_key: string;
    game_id: string;
    player_name: string;
    prop_type: string;
    line: number;
    snapshot_time: string;
  }>;
  quotes: Array<{
    market_key: string;
    book_name: string;
    over_price: number;
    under_price: number;
    quote_time: string;
  }>;
  games: Array<{
    gameId: string;
    season: number;
    week: number;
    startTimeUtc: string;
    homeTeam: string;
    awayTeam: string;
  }>;
  rosters?: Array<{ playerName: string; team: string; season: number }>;
}): void {
  const marketsCsv = [
    "market_key,game_id,player_name,prop_type,line,snapshot_time",
    ...args.markets.map(
      (m) =>
        `${m.market_key},${m.game_id},${m.player_name},${m.prop_type},${m.line},${m.snapshot_time}`,
    ),
  ].join("\n");
  fs.writeFileSync(path.join(args.processed, "prop_markets.csv"), marketsCsv);
  const quotesCsv = [
    "market_key,book_name,over_price,under_price,quote_time",
    ...args.quotes.map(
      (q) =>
        `${q.market_key},${q.book_name},${q.over_price},${q.under_price},${q.quote_time}`,
    ),
  ].join("\n");
  fs.writeFileSync(path.join(args.processed, "prop_quotes.csv"), quotesCsv);
  const gamesCsv = [
    "gameId,season,week,startTimeUtc,homeTeam,awayTeam",
    ...args.games.map(
      (g) =>
        `${g.gameId},${g.season},${g.week},${g.startTimeUtc},${g.homeTeam},${g.awayTeam}`,
    ),
  ].join("\n");
  fs.writeFileSync(path.join(args.processed, "nfl", "games.csv"), gamesCsv);
  if (args.rosters) {
    const rostersCsv = [
      "playerName,team,season",
      ...args.rosters.map((r) => `${r.playerName},${r.team},${r.season}`),
    ].join("\n");
    fs.writeFileSync(path.join(args.processed, "nfl", "rosters.csv"), rostersCsv);
  }
}

function main(): void {
  console.log("Canonical migration week-matching — assertions");
  console.log("==============================================");

  // 1. CORE BUG REPRO: CSV has 2 Week 1 markets but operator
  //    selects Week 2 to migrate. NO_ROWS_FOR_WEEK with the
  //    week-mismatch diagnostic, NOT droppedMissingGame=122.
  {
    const r = makeReport("week mismatch flagged clearly");
    const { root, processed } = makeTempRoot();
    try {
      seedLegacy({
        processed,
        markets: [
          {
            market_key: "mk1",
            game_id: "2025-w1-buf-at-mia",
            player_name: "Tua Tagovailoa",
            prop_type: "PASSING_ATTEMPTS",
            line: 33.5,
            snapshot_time: "2025-09-06T17:00:00Z",
          },
          {
            market_key: "mk2",
            game_id: "2025-w1-buf-at-mia",
            player_name: "Josh Allen",
            prop_type: "PASSING_COMPLETIONS",
            line: 22.5,
            snapshot_time: "2025-09-06T17:00:00Z",
          },
        ],
        quotes: [
          {
            market_key: "mk1",
            book_name: "DraftKings",
            over_price: -110,
            under_price: -110,
            quote_time: "2025-09-06T17:30:00Z",
          },
          {
            market_key: "mk2",
            book_name: "DraftKings",
            over_price: -110,
            under_price: -110,
            quote_time: "2025-09-06T17:30:00Z",
          },
        ],
        games: [
          {
            gameId: "2025-w2-kc-at-buf",
            season: 2025,
            week: 2,
            startTimeUtc: "2025-09-14T17:00:00Z",
            homeTeam: "BUF",
            awayTeam: "KC",
          },
        ],
      });
      const result = migrateLegacyToCanonical({
        season: 2025,
        week: 2,
        processedRoot: processed,
      });
      check(
        r,
        result.status === "NO_ROWS_FOR_WEEK",
        `status=${result.status}, expected NO_ROWS_FOR_WEEK`,
      );
      check(r, result.targetSeason === 2025, `targetSeason=${result.targetSeason}`);
      check(r, result.targetWeek === 2, `targetWeek=${result.targetWeek}`);
      check(
        r,
        (result.droppedWrongWeek ?? 0) >= 2,
        `droppedWrongWeek=${result.droppedWrongWeek}, expected >= 2 (both Week 1 markets dropped pre-join)`,
      );
      check(
        r,
        (result.marketWeekHistogram?.["2025-w1"] ?? 0) >= 2,
        `marketWeekHistogram['2025-w1']=${result.marketWeekHistogram?.["2025-w1"]}`,
      );
      check(
        r,
        result.sampleMarketGameIds?.includes("2025-w1-buf-at-mia") === true,
        `sampleMarketGameIds should include the Week 1 gameId, got ${JSON.stringify(result.sampleMarketGameIds)}`,
      );
      check(
        r,
        result.sampleScheduleGameIds?.includes("2025-w2-kc-at-buf") === true,
        `sampleScheduleGameIds should include the Week 2 gameId, got ${JSON.stringify(result.sampleScheduleGameIds)}`,
      );
      // The legacy droppedMissingGame counter should NOT be
      // inflated by the wrong-week markets — they were dropped
      // BEFORE the join step.
      check(
        r,
        (result.diagnostics?.droppedMissingGame ?? 0) === 0,
        `droppedMissingGame=${result.diagnostics?.droppedMissingGame}, expected 0 (wrong-week markets handled separately)`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — wrong-week flagged with rich diagnostics");
    else console.log("[1] FAIL — wrong-week diagnostic");
  }

  // 2. Happy path: CSV markets and schedule both for the target
  //    week → status=READY, marketWeekHistogram populated.
  {
    const r = makeReport("matching week migrates cleanly");
    const { root, processed } = makeTempRoot();
    try {
      seedLegacy({
        processed,
        markets: [
          {
            market_key: "mk1",
            game_id: "2025-w2-kc-at-buf",
            player_name: "Patrick Mahomes",
            prop_type: "PASSING_ATTEMPTS",
            line: 34.5,
            snapshot_time: "2025-09-13T17:00:00Z",
          },
        ],
        quotes: [
          {
            market_key: "mk1",
            book_name: "DraftKings",
            over_price: -110,
            under_price: -110,
            quote_time: "2025-09-13T17:30:00Z",
          },
        ],
        games: [
          {
            gameId: "2025-w2-kc-at-buf",
            season: 2025,
            week: 2,
            startTimeUtc: "2025-09-14T17:00:00Z",
            homeTeam: "BUF",
            awayTeam: "KC",
          },
        ],
        rosters: [
          { playerName: "Patrick Mahomes", team: "KC", season: 2025 },
        ],
      });
      const result = migrateLegacyToCanonical({
        season: 2025,
        week: 2,
        processedRoot: processed,
      });
      check(r, result.status === "READY", `status=${result.status}`);
      check(r, (result.rowsWritten ?? 0) >= 1, `rowsWritten=${result.rowsWritten}`);
      check(
        r,
        (result.marketWeekHistogram?.["2025-w2"] ?? 0) === 1,
        `marketWeekHistogram['2025-w2']=${result.marketWeekHistogram?.["2025-w2"]}`,
      );
      check(
        r,
        (result.droppedWrongWeek ?? 0) === 0,
        `droppedWrongWeek=${result.droppedWrongWeek}, expected 0`,
      );
      check(r, result.targetSeason === 2025, `targetSeason=${result.targetSeason}`);
      check(r, result.targetWeek === 2, `targetWeek=${result.targetWeek}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — happy path produces READY + enriched fields");
    else console.log("[2] FAIL — happy path");
  }

  // 3. Mixed CSV (some Week 1, some Week 2 markets), migrating
  //    Week 2 → only the Week 2 markets join; Week 1 markets
  //    are bucketed as droppedWrongWeek, not droppedMissingGame.
  {
    const r = makeReport("mixed-week CSV splits cleanly");
    const { root, processed } = makeTempRoot();
    try {
      seedLegacy({
        processed,
        markets: [
          {
            market_key: "mk-w1",
            game_id: "2025-w1-buf-at-mia",
            player_name: "Tua Tagovailoa",
            prop_type: "PASSING_ATTEMPTS",
            line: 33.5,
            snapshot_time: "2025-09-06T17:00:00Z",
          },
          {
            market_key: "mk-w2",
            game_id: "2025-w2-kc-at-buf",
            player_name: "Patrick Mahomes",
            prop_type: "PASSING_ATTEMPTS",
            line: 34.5,
            snapshot_time: "2025-09-13T17:00:00Z",
          },
        ],
        quotes: [
          {
            market_key: "mk-w1",
            book_name: "DraftKings",
            over_price: -110,
            under_price: -110,
            quote_time: "2025-09-06T17:30:00Z",
          },
          {
            market_key: "mk-w2",
            book_name: "DraftKings",
            over_price: -115,
            under_price: -105,
            quote_time: "2025-09-13T17:30:00Z",
          },
        ],
        games: [
          {
            gameId: "2025-w2-kc-at-buf",
            season: 2025,
            week: 2,
            startTimeUtc: "2025-09-14T17:00:00Z",
            homeTeam: "BUF",
            awayTeam: "KC",
          },
        ],
        rosters: [
          { playerName: "Patrick Mahomes", team: "KC", season: 2025 },
        ],
      });
      const result = migrateLegacyToCanonical({
        season: 2025,
        week: 2,
        processedRoot: processed,
      });
      check(r, result.status === "READY", `status=${result.status}`);
      check(
        r,
        (result.droppedWrongWeek ?? 0) === 1,
        `droppedWrongWeek=${result.droppedWrongWeek}, expected 1 (the Week 1 market)`,
      );
      check(
        r,
        (result.marketWeekHistogram?.["2025-w1"] ?? 0) === 1,
        `histogram w1=${result.marketWeekHistogram?.["2025-w1"]}`,
      );
      check(
        r,
        (result.marketWeekHistogram?.["2025-w2"] ?? 0) === 1,
        `histogram w2=${result.marketWeekHistogram?.["2025-w2"]}`,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — mixed-week CSV splits correctly");
    else console.log("[3] FAIL — mixed split");
  }

  // 4. The admin runner surfaces the NO_ROWS_FOR_WEEK hint in
  //    the failure summary + detail (source-level guarantee).
  {
    const r = makeReport("admin runner surfaces week-mismatch hint");
    const text = readSrc("src/lib/admin/admin-runner.ts");
    check(
      r,
      /NO_ROWS_FOR_WEEK/.test(text),
      "admin runner must reference NO_ROWS_FOR_WEEK status",
    );
    check(
      r,
      /marketWeekHistogram/.test(text),
      "admin runner must surface marketWeekHistogram in the result",
    );
    check(
      r,
      /sampleMarketGameIds/.test(text),
      "admin runner must surface sampleMarketGameIds",
    );
    check(
      r,
      /sampleScheduleGameIds/.test(text),
      "admin runner must surface sampleScheduleGameIds",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — admin surface wires the diagnostics");
    else console.log("[4] FAIL — admin surface");
  }

  // 5. No banned hooks in the touched files.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/lib/ingestion/canonical-odds-writer.ts",
      "src/lib/admin/admin-runner.ts",
    ];
    for (const f of files) {
      const text = readSrc(f);
      for (const re of [
        /the-odds-api/i,
        /odds-api\.com/i,
        /placeBet|placeWager/,
        /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
        /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
      ]) {
        check(r, !re.test(text), `${f} contains banned pattern ${re}`);
      }
    }
    record(r);
    if (r.reasons.length === 0) console.log("[5] PASS — no banned hooks");
    else console.log("[5] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 5 migrate-canonical-week-matching assertions passed.");
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
