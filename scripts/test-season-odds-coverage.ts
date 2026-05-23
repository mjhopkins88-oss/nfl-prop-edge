/**
 * Season-odds-coverage helper — assertions.
 *
 *   · buildSeasonOddsCoverage returns one row per requested
 *     week with the storedPropMarketRows count + present flag.
 *   · weeksPresent / weeksMissing partition is correct.
 *   · A week with zero rows is "MISSING".
 *   · When persistence.isAvailable() is false, every week is
 *     marked MISSING and persistenceAvailable=false so callers
 *     know the audit is inconclusive.
 *   · formatSeasonOddsCoverage produces a stable diagnostic
 *     string that mentions the missing weeks.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import {
  buildSeasonOddsCoverage,
  formatSeasonOddsCoverage,
} from "../src/lib/backtest/season-odds-coverage";
import type { PersistenceClient } from "../src/lib/persistence/week-1-persistence";

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

function fakePersistence(args: {
  available: boolean;
  rowsByWeek: Record<number, number>;
}): PersistenceClient {
  return {
    isAvailable: () => args.available,
    countPersistence: async ({ week }: { season: number; week: number }) => ({
      ok: true,
      counts: {
        storedPropMarketRows: args.rowsByWeek[week] ?? 0,
        storedBacktestRuns: 0,
        oddsIngestionRuns: 0,
        adminStateExists: false,
      },
    }),
  } as unknown as PersistenceClient;
}

async function main(): Promise<void> {
  console.log("Season odds coverage — assertions");
  console.log("==================================");

  // 1. Every week has rows → all present, none missing.
  {
    const r = makeReport("all weeks present");
    const client = fakePersistence({
      available: true,
      rowsByWeek: { 1: 250, 2: 240, 3: 230 },
    });
    const out = await buildSeasonOddsCoverage({
      season: 2025,
      weeks: [1, 2, 3],
      persistence: client,
    });
    check(
      r,
      out.weeksPresent.length === 3 && out.weeksMissing.length === 0,
      `present=${JSON.stringify(out.weeksPresent)}, missing=${JSON.stringify(out.weeksMissing)}`,
    );
    check(
      r,
      out.persistenceAvailable === true,
      "persistenceAvailable should be true",
    );
    check(
      r,
      out.perWeek.every((w) => w.present && w.storedPropMarketRows > 0),
      "every perWeek row should be present + nonzero",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — all weeks present");
    else console.log("[1] FAIL — all-weeks-present");
  }

  // 2. Some weeks missing → partition is correct.
  {
    const r = makeReport("mixed presence");
    const client = fakePersistence({
      available: true,
      rowsByWeek: { 1: 250, 3: 100, 5: 200 },
    });
    const out = await buildSeasonOddsCoverage({
      season: 2025,
      weeks: [1, 2, 3, 4, 5],
      persistence: client,
    });
    check(
      r,
      JSON.stringify(out.weeksPresent) === JSON.stringify([1, 3, 5]),
      `present=${JSON.stringify(out.weeksPresent)}, expected [1,3,5]`,
    );
    check(
      r,
      JSON.stringify(out.weeksMissing) === JSON.stringify([2, 4]),
      `missing=${JSON.stringify(out.weeksMissing)}, expected [2,4]`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — partition correct");
    else console.log("[2] FAIL — partition");
  }

  // 3. Persistence unavailable → every week MISSING, audit
  //    flagged inconclusive.
  {
    const r = makeReport("persistence unavailable");
    const client = fakePersistence({
      available: false,
      rowsByWeek: { 1: 250 },
    });
    const out = await buildSeasonOddsCoverage({
      season: 2025,
      weeks: [1, 2, 3],
      persistence: client,
    });
    check(
      r,
      out.persistenceAvailable === false,
      "persistenceAvailable should be false",
    );
    check(
      r,
      out.weeksMissing.length === 3,
      `every week should be MISSING when persistence unavailable; got ${out.weeksMissing.length}`,
    );
    check(
      r,
      out.perWeek.every((w) => w.storedPropMarketRows === 0),
      "rows should default to 0 when persistence unavailable",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — persistence unavailable marks all missing");
    else console.log("[3] FAIL — persistence unavailable");
  }

  // 4. formatSeasonOddsCoverage mentions missing weeks +
  //    surfaces the inconclusive banner when DB is unreachable.
  {
    const r = makeReport("formatted output stable");
    const client = fakePersistence({
      available: true,
      rowsByWeek: { 1: 100 },
    });
    const out = await buildSeasonOddsCoverage({
      season: 2025,
      weeks: [1, 2],
      persistence: client,
    });
    const formatted = formatSeasonOddsCoverage(out);
    check(
      r,
      formatted.includes("MISSING"),
      "formatted should call out MISSING weeks",
    );
    check(
      r,
      formatted.includes("W2"),
      "formatted should reference W2 (missing week)",
    );

    const offline = await buildSeasonOddsCoverage({
      season: 2025,
      weeks: [1, 2],
      persistence: fakePersistence({ available: false, rowsByWeek: {} }),
    });
    const offlineFormatted = formatSeasonOddsCoverage(offline);
    check(
      r,
      offlineFormatted.includes("PERSISTENCE NOT AVAILABLE"),
      "offline format should call out unavailable persistence",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — formatted output stable");
    else console.log("[4] FAIL — formatted output");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 4 / 4 SCENARIOS PASSED");
    return;
  }
  console.log(`FAIL — ${FAILURES.length} scenario(s) failed:`);
  for (const f of FAILURES) {
    console.log(`  · ${f.scenario}`);
    for (const reason of f.reasons) console.log(`    - ${reason}`);
  }
  process.exitCode = 1;
}

void main();
