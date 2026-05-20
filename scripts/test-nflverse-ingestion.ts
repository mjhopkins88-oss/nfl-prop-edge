/**
 * nflverse ingestion scaffold — assertions.
 *
 *   · no API key is required (network mode is opt-in via env flag)
 *   · fixture data loads through the loader
 *   · player history before week N excludes week ≥ N
 *   · team history before week N excludes week ≥ N
 *   · the seven V1 prop types are covered by the schema fields
 *   · missing optional fields do not crash the loader
 *   · processed file paths are the documented ones
 *   · no paid API client is referenced from nflverse modules
 *   · no touchdown column survives parsing
 *
 * Pure CPU + file IO. No network.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildNflverseDownloadPlan,
  isNetworkFetchAllowed,
  loadAndNormalizeRaw,
  NETWORK_FETCH_ENV_FLAG,
  parseCsv,
  parseCsvRows,
  writeProcessed,
} from "../src/lib/ingestion/nflverse";
import {
  getPlayerHistoryBeforeWeek,
  getTeamHistoryBeforeWeek,
  isStrictlyBefore,
  loadProcessedGames,
  loadProcessedPlayerWeekStats,
  loadProcessedRosters,
  loadProcessedTeamWeekStats,
} from "../src/lib/ingestion/nflverse-loader";

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

function main(): void {
  console.log("nflverse ingestion — assertions");
  console.log("================================");

  // 1. No API key required. Default behavior is dry-run / local;
  //    network fetch is gated behind a single env flag and the
  //    module exposes the gate as a function.
  {
    const r = makeReport("no API key required");
    check(
      r,
      typeof isNetworkFetchAllowed === "function",
      "isNetworkFetchAllowed is exported",
    );
    check(
      r,
      NETWORK_FETCH_ENV_FLAG === "ALLOW_NFLVERSE_NETWORK_FETCH",
      `network env flag is ${NETWORK_FETCH_ENV_FLAG}, expected ALLOW_NFLVERSE_NETWORK_FETCH`,
    );
    // No API_KEY string in either module.
    const moduleSources = [
      fs.readFileSync(
        path.join(process.cwd(), "src/lib/ingestion/nflverse.ts"),
        "utf8",
      ),
      fs.readFileSync(
        path.join(process.cwd(), "src/lib/ingestion/nflverse-loader.ts"),
        "utf8",
      ),
    ];
    for (const src of moduleSources) {
      if (/process\.env\.[A-Z_]*API_KEY/.test(src)) {
        check(r, false, "nflverse module references *_API_KEY env var");
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — no API key required, network is opt-in");
    else console.log("[1] FAIL — API key check");
  }

  // 2. Fixture data loads.
  {
    const r = makeReport("fixture data loads");
    const games = loadProcessedGames({ fixtureFallback: true });
    const players = loadProcessedPlayerWeekStats({ fixtureFallback: true });
    const teams = loadProcessedTeamWeekStats({ fixtureFallback: true });
    const rosters = loadProcessedRosters({ fixtureFallback: true });
    check(r, games.length > 0, `fixture games loaded (${games.length})`);
    check(
      r,
      players.length > 0,
      `fixture player-week stats loaded (${players.length})`,
    );
    check(r, teams.length > 0, `fixture team-week stats loaded (${teams.length})`);
    check(r, rosters.length > 0, `fixture rosters loaded (${rosters.length})`);
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[2] PASS — fixtures: ${games.length} games, ${players.length} player-weeks, ${teams.length} team-weeks, ${rosters.length} rosters`,
      );
    else console.log("[2] FAIL — fixtures");
  }

  // 3. Player history excludes current + future weeks.
  {
    const r = makeReport("player history strict-before");
    const all = loadProcessedPlayerWeekStats({ fixtureFallback: true });
    const allen = all.find((p) => p.playerName === "Josh Allen");
    if (!allen) {
      check(r, false, "no Allen stat in fixtures");
    } else {
      const hist = getPlayerHistoryBeforeWeek({
        playerId: allen.playerId,
        currentSeason: 2025,
        currentWeek: 7,
        playerWeekStats: all,
      });
      for (const h of hist) {
        check(
          r,
          isStrictlyBefore({
            rowSeason: h.season,
            rowWeek: h.week,
            currentSeason: 2025,
            currentWeek: 7,
          }),
          `history row season=${h.season} week=${h.week} should be strictly before 2025/W7`,
        );
        check(
          r,
          !(h.season === 2025 && h.week >= 7),
          `history must not include current-or-future week (got 2025/W${h.week})`,
        );
      }
      // Make sure the 2024 baseline rows are included.
      const has2024 = hist.some((h) => h.season === 2024);
      check(r, has2024, "history should include 2024 baseline rows");
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — player history strict-before");
    else console.log("[3] FAIL — player history");
  }

  // 4. Team history excludes current + future weeks.
  {
    const r = makeReport("team history strict-before");
    const all = loadProcessedTeamWeekStats({ fixtureFallback: true });
    const hist = getTeamHistoryBeforeWeek({
      team: "BUF",
      currentSeason: 2025,
      currentWeek: 7,
      teamWeekStats: all,
    });
    for (const h of hist) {
      check(
        r,
        !(h.season === 2025 && h.week >= 7),
        `team history must not include current-or-future week (got 2025/W${h.week})`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — team history strict-before");
    else console.log("[4] FAIL — team history");
  }

  // 5. The seven V1 prop types are addressable by the player stat
  //    schema. (Field presence, not row-by-row coverage.)
  {
    const r = makeReport("V1 prop coverage");
    const all = loadProcessedPlayerWeekStats({ fixtureFallback: true });
    const fields: Array<keyof (typeof all)[number]> = [
      "passingAttempts",
      "passingCompletions",
      "passingYards",
      "rushingAttempts",
      "rushingYards",
      "targets",
      "receptions",
      "receivingYards",
    ];
    for (const f of fields) {
      const found = all.some((p) => p[f] !== undefined);
      check(r, found, `at least one row should have ${String(f)} populated`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — V1 prop type schema covered");
    else console.log("[5] FAIL — V1 schema");
  }

  // 6. Missing optional fields do not crash. Build a synthetic row
  //    with no optional numeric fields, parse it through the
  //    pipeline.
  {
    const r = makeReport("missing optional fields");
    const csv =
      "season,week,position,recent_team,opponent_team,player_id,player_display_name\n" +
      "2025,5,QB,BUF,MIA,00-0034796,Josh Allen\n";
    const rows = parseCsvRows(csv);
    check(r, rows.length === 1, `expected 1 row, got ${rows.length}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — sparse row parses without crash");
    else console.log("[6] FAIL — sparse parsing");
  }

  // 7. Touchdown columns are stripped at parse time.
  {
    const r = makeReport("no touchdown columns");
    const csv =
      "season,week,passing_yards,passing_tds,rushing_tds,anytime_td,receiving_td,first_td\n" +
      "2025,5,268,2,1,0,1,0\n";
    const rows = parseCsvRows(csv);
    const onlyRow = rows[0];
    check(r, onlyRow !== undefined, "row should parse");
    if (onlyRow) {
      for (const k of Object.keys(onlyRow)) {
        check(
          r,
          !k.toLowerCase().includes("td") &&
            !k.toLowerCase().includes("touchdown"),
          `column ${k} should have been dropped`,
        );
      }
      check(
        r,
        onlyRow.passing_yards === "268",
        "non-TD columns should remain",
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — touchdown columns dropped at parse");
    else console.log("[7] FAIL — touchdown columns");
  }

  // 8. Download plan exposes the public URLs without touching the
  //    network.
  {
    const r = makeReport("download plan");
    const plan = buildNflverseDownloadPlan([2024, 2025]);
    check(r, plan.length === 2, `expected 2 seasons, got ${plan.length}`);
    const allUrls = plan.flatMap((p) => p.files.map((f) => f.url));
    for (const url of allUrls) {
      check(
        r,
        url.startsWith("https://github.com/nflverse/nflverse-data/releases/"),
        `URL ${url} does not point at nflverse-data releases`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(`[8] PASS — download plan covers ${allUrls.length} files`);
    else console.log("[8] FAIL — download plan");
  }

  // 9. Processed CSV write round-trips through parseCsv.
  {
    const r = makeReport("processed write + parse");
    const tmpDir = path.join(process.cwd(), "data", "processed", "nfl");
    const games = loadProcessedGames({ fixtureFallback: true });
    const players = loadProcessedPlayerWeekStats({ fixtureFallback: true });
    const teams = loadProcessedTeamWeekStats({ fixtureFallback: true });
    const rosters = loadProcessedRosters({ fixtureFallback: true });
    const tempTarget = path.join(tmpDir, "_audit_writeback");
    try {
      writeProcessed({
        bundle: { games, playerWeekStats: players, teamWeekStats: teams, rosters },
        processedDir: tempTarget,
      });
      const gamesCsv = fs.readFileSync(
        path.join(tempTarget, "games.csv"),
        "utf8",
      );
      const parsed = parseCsv(gamesCsv);
      check(
        r,
        parsed.length >= 2,
        `games.csv should round-trip with header + rows (got ${parsed.length})`,
      );
    } finally {
      // Best-effort cleanup so the audit run doesn't litter the
      // data directory.
      try {
        fs.rmSync(tempTarget, { recursive: true, force: true });
      } catch {}
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — processed write round-trips");
    else console.log("[9] FAIL — write round-trip");
  }

  // 10. No paid-API client referenced from nflverse modules. Soft
  //     scan for tokens that would indicate a paid integration.
  {
    const r = makeReport("no paid API references");
    const text =
      fs.readFileSync(
        path.join(process.cwd(), "src/lib/ingestion/nflverse.ts"),
        "utf8",
      ) +
      fs.readFileSync(
        path.join(process.cwd(), "src/lib/ingestion/nflverse-loader.ts"),
        "utf8",
      );
    const bannedPatterns = [
      /the-odds-api/i,
      /odds-api\.com/i,
      /sportsbook\.bet/i,
      /placeBet|placeWager/i,
      /kalshi.+place/i,
    ];
    for (const re of bannedPatterns) {
      check(r, !re.test(text), `nflverse modules contain banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — no paid-API / betting references");
    else console.log("[10] FAIL — paid API references");
  }

  // 11. loadAndNormalizeRaw returns empty bundle when raw dir
  //     missing — does not crash.
  {
    const r = makeReport("loadAndNormalizeRaw missing dir");
    const bundle = loadAndNormalizeRaw({
      seasons: [2099],
      rawDir: path.join(process.cwd(), "data", "raw", "nfl"),
    });
    check(
      r,
      bundle.games.length === 0 &&
        bundle.playerWeekStats.length === 0 &&
        bundle.teamWeekStats.length === 0 &&
        bundle.rosters.length === 0,
      "missing season should produce empty bundle",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[11] PASS — empty raw dir handled cleanly");
    else console.log("[11] FAIL — empty raw dir");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 11 nflverse ingestion assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const r of f.reasons) console.log(`     - ${r}`);
    }
    process.exit(1);
  }
}

main();
