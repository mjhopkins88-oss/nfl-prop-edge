/**
 * nflverse schedule kickoff-time normalization assertions.
 *
 *   · gameday + gametime combine into a valid UTC ISO 8601 string
 *   · EDT (Sept) and EST (late Nov) offsets land on the right
 *     wall-clock-to-UTC mapping
 *   · DST boundary days resolve correctly (March / November)
 *   · pre-existing valid ISO strings pass through unchanged
 *   · missing inputs surface as MISSING (never silently invalid)
 *   · malformed inputs surface as INVALID
 *   · computeSnapshotTime no longer crashes on Week 1 2025
 *     normalized games.csv rows
 *   · normalizeGameRow produces toISOString-safe values
 *   · no API calls / fetch hooks in the new module
 *   · no touchdown columns surface anywhere in the helper
 *
 * Pure date arithmetic. No network. No paid calls.
 */

import fs from "node:fs";
import path from "node:path";
import {
  combineEasternToUtcIso,
  easternOffsetHours,
  isUSEasternDST,
  isValidIsoDateTime,
  normalizeNflKickoffTime,
  parseNflverseKickoffTime,
} from "../src/lib/ingestion/nfl-schedule-time";
import { normalizeGameRow } from "../src/lib/ingestion/nflverse";
import { computeSnapshotTime } from "../src/lib/ingestion/odds-api";

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

function main(): void {
  console.log("nflverse kickoff-time normalization — assertions");
  console.log("=================================================");

  // 1. The canonical example from the user's bug report.
  {
    const r = makeReport("user example: 2025-09-04 20:20 ET → 2025-09-05T00:20:00Z");
    const iso = combineEasternToUtcIso({
      gameday: "2025-09-04",
      gametime: "20:20",
    });
    check(r, iso === "2025-09-05T00:20:00.000Z", `got ${iso}`);
    check(
      r,
      iso !== undefined && !Number.isNaN(new Date(iso).getTime()),
      "result must be a valid Date",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — DAL@PHI Thursday Night → 2025-09-05T00:20:00.000Z");
    else console.log("[1] FAIL — user example");
  }

  // 2. DST-on Sunday 1 PM ET game (mid-September).
  {
    const r = makeReport("Sunday 1 PM ET in September → 17:00 UTC");
    const iso = combineEasternToUtcIso({
      gameday: "2025-09-07",
      gametime: "13:00",
    });
    check(r, iso === "2025-09-07T17:00:00.000Z", `got ${iso}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — Sunday 1 PM EDT → 17:00 UTC");
    else console.log("[2] FAIL — Sunday 1 PM EDT");
  }

  // 3. EST (after DST ends) — Thursday Nov 6 2025 8:15 PM ET → next day 01:15 UTC.
  //    First Sunday of November 2025 is Nov 2, so Nov 6 is EST.
  {
    const r = makeReport("EST: Nov 6 2025 20:15 ET → Nov 7 01:15 UTC");
    const iso = combineEasternToUtcIso({
      gameday: "2025-11-06",
      gametime: "20:15",
    });
    check(r, iso === "2025-11-07T01:15:00.000Z", `got ${iso}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — Nov 6 EST → next-day 01:15 UTC");
    else console.log("[3] FAIL — Nov EST");
  }

  // 4. DST boundary days are classified correctly.
  {
    const r = makeReport("DST boundary days");
    // 2025: DST starts March 9, ends November 2.
    check(r, isUSEasternDST(2025, 3, 8) === false, "March 8 should be EST");
    check(r, isUSEasternDST(2025, 3, 9) === true, "March 9 should be EDT");
    check(r, isUSEasternDST(2025, 11, 1) === true, "Nov 1 should be EDT");
    check(r, isUSEasternDST(2025, 11, 2) === false, "Nov 2 should be EST");
    check(r, easternOffsetHours(2025, 9, 7) === -4, "Sep 7 EDT offset = -4");
    check(r, easternOffsetHours(2025, 12, 25) === -5, "Dec 25 EST offset = -5");
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — DST boundaries (2025: Mar 9, Nov 2)");
    else console.log("[4] FAIL — DST boundaries");
  }

  // 5. Pass-through: a row with a pre-existing valid ISO startTimeUtc.
  {
    const r = makeReport("pass-through valid ISO startTimeUtc");
    const parsed = parseNflverseKickoffTime({
      startTimeUtc: "2025-09-08T00:20:00Z",
    });
    check(r, parsed.status === "VALID", `status=${parsed.status}`);
    check(r, parsed.source === "iso-utc", `source=${parsed.source}`);
    check(
      r,
      parsed.isoUtc === "2025-09-08T00:20:00.000Z",
      `isoUtc=${parsed.isoUtc}`,
    );
    record(r);
    if (r.reasons.length === 0) console.log("[5] PASS — valid ISO passes through");
    else console.log("[5] FAIL — pass-through");
  }

  // 6. Missing inputs return MISSING.
  {
    const r = makeReport("missing inputs return MISSING");
    const noDate = parseNflverseKickoffTime({ gametime: "20:20" });
    check(r, noDate.status === "MISSING", `noDate status=${noDate.status}`);
    const noTime = parseNflverseKickoffTime({ gameday: "2025-09-04" });
    check(r, noTime.status === "MISSING", `noTime status=${noTime.status}`);
    check(
      r,
      noTime.reason !== undefined && noTime.reason.length > 0,
      "missing should carry a reason",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — missing inputs surface as MISSING");
    else console.log("[6] FAIL — missing inputs");
  }

  // 7. Malformed inputs return INVALID.
  {
    const r = makeReport("malformed inputs return INVALID");
    const bad = parseNflverseKickoffTime({
      gameday: "Sept 4, 2025",
      gametime: "8:20 PM",
    });
    check(r, bad.status === "INVALID", `bad status=${bad.status}`);
    const badTime = parseNflverseKickoffTime({
      gameday: "2025-09-04",
      gametime: "25:99",
    });
    check(r, badTime.status === "INVALID", `badTime status=${badTime.status}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — malformed inputs surface as INVALID");
    else console.log("[7] FAIL — malformed inputs");
  }

  // 8. normalizeNflKickoffTime convenience wrapper.
  {
    const r = makeReport("normalizeNflKickoffTime row wrapper");
    const ok = normalizeNflKickoffTime({
      gameday: "2025-09-04",
      gametime: "20:20",
    });
    check(r, ok === "2025-09-05T00:20:00.000Z", `ok=${ok}`);
    const missing = normalizeNflKickoffTime({ gameday: "2025-09-04" });
    check(r, missing === undefined, `missing=${missing}`);
    const passthrough = normalizeNflKickoffTime({
      start_time_utc: "2025-09-08T00:20:00Z",
    });
    check(
      r,
      passthrough === "2025-09-08T00:20:00.000Z",
      `passthrough=${passthrough}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — wrapper handles all three input shapes");
    else console.log("[8] FAIL — wrapper");
  }

  // 9. End-to-end: normalizeGameRow → computeSnapshotTime should
  //    not crash for the Week 1 2025 lineup.
  {
    const r = makeReport("normalizeGameRow → computeSnapshotTime end-to-end");
    const sampleRows: Record<string, string>[] = [
      {
        season: "2025",
        week: "1",
        game_type: "REG",
        gameday: "2025-09-04",
        gametime: "20:20",
        home_team: "PHI",
        away_team: "DAL",
      },
      {
        season: "2025",
        week: "1",
        game_type: "REG",
        gameday: "2025-09-07",
        gametime: "13:00",
        home_team: "ATL",
        away_team: "TB",
      },
      {
        season: "2025",
        week: "1",
        game_type: "REG",
        gameday: "2025-09-08",
        gametime: "20:15",
        home_team: "CHI",
        away_team: "MIN",
      },
    ];
    for (const row of sampleRows) {
      const game = normalizeGameRow(row);
      check(r, game !== undefined, `row should normalize: ${JSON.stringify(row)}`);
      check(
        r,
        game?.startTimeUtc !== undefined && isValidIsoDateTime(game.startTimeUtc),
        `startTimeUtc invalid for ${row.away_team}@${row.home_team}: ${game?.startTimeUtc}`,
      );
      // computeSnapshotTime called the same way the historical
      // prop-lines runner does; previously crashed with RangeError.
      let snap = "";
      let threw = false;
      try {
        snap = computeSnapshotTime(game!.startTimeUtc!);
      } catch {
        threw = true;
      }
      check(r, !threw, `computeSnapshotTime threw for ${game?.gameId}`);
      check(
        r,
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(snap),
        `snap should be ISO-UTC no-millis: ${snap}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — end-to-end normalize + snapshot (no RangeError)");
    else console.log("[9] FAIL — end-to-end");
  }

  // 10. No banned hooks in the new module.
  {
    const r = makeReport("no API / fetch / betting hooks in new module");
    const text = readSrc("src/lib/ingestion/nfl-schedule-time.ts");
    for (const re of [
      /the-odds-api/i,
      /odds-api\.com/i,
      /placeBet|placeWager/i,
      /kalshi/i,
      /fetch\(/,
      /https?:\/\/[a-z0-9\-]+\.[a-z]+/i,
      /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|RUSH_TD|REC_TD|PASS_TD/,
    ]) {
      check(r, !re.test(text), `module contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — no API / fetch / betting / touchdown hooks");
    else console.log("[10] FAIL — banned hooks");
  }

  // 11. isValidIsoDateTime accepts both shapes.
  {
    const r = makeReport("isValidIsoDateTime sanity");
    check(r, isValidIsoDateTime("2025-09-05T00:20:00.000Z"), "ms ISO valid");
    check(r, isValidIsoDateTime("2025-09-05T00:20:00Z"), "no-ms ISO valid");
    check(r, !isValidIsoDateTime("20:20"), "bare time invalid");
    check(r, !isValidIsoDateTime("not a date"), "garbage invalid");
    check(r, !isValidIsoDateTime(undefined), "undefined invalid");
    record(r);
    if (r.reasons.length === 0)
      console.log("[11] PASS — isValidIsoDateTime sanity");
    else console.log("[11] FAIL — isValidIsoDateTime");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 11 schedule-time-normalization assertions passed.");
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
