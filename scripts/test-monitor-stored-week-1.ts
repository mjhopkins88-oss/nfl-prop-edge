/**
 * /monitor stored-Week-1 snapshot assertions.
 *
 *   · loadStoredWeek1MonitorSnapshot prefers the Postgres
 *     `StoredBacktestRun` row over the file mirror
 *   · the snapshot exposes the fields the monitor renders:
 *     status, candidateCount, realWeek1BacktestReady,
 *     scheduleValidationStatus, syntheticFixture=false,
 *     storedOddsPresent, processedNflPresent
 *   · returns the file snapshot when DB has nothing
 *   · returns undefined when neither source has data — caller
 *     falls back to fixture starter-test
 *   · 290-candidate stored run does NOT report the fixture
 *     starter-test's 8 evaluated / 2 qualified / 100% hit /
 *     88.9% ROI numbers as primary
 *   · ungraded snapshot reports gradingStatus="ungraded" —
 *     monitor renders ROI/hit rate as pending
 *   · no banned hooks in the new module
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
import { loadStoredWeek1MonitorSnapshot } from "../src/lib/backtest/week-1-monitor-summary";

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

function makeTempCwd(): { restore: () => void; root: string } {
  const original = process.cwd();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nfl-prop-edge-monitor-"));
  fs.mkdirSync(path.join(dir, "data", "backtests", "2025"), {
    recursive: true,
  });
  process.chdir(dir);
  return {
    restore: () => process.chdir(original),
    root: dir,
  };
}

function seedFileSnapshot(
  root: string,
  payload: Record<string, unknown>,
): void {
  fs.writeFileSync(
    path.join(root, "data", "backtests", "2025", "week-1-data-mode-status.fixture.json"),
    JSON.stringify(payload, null, 2),
  );
}

function seedDbRun(
  client: PersistenceClient,
  candidateCount: number,
  status: string,
  ready: boolean,
  schedStatus: string | null,
): Promise<unknown> {
  return client.saveStoredBacktestRunToDb({
    season: 2025,
    week: 1,
    dataMode: "stored",
    status,
    realWeek1BacktestReady: ready,
    scheduleValidationStatus: schedStatus,
    syntheticFixture: false,
    candidatesJson: {
      candidates: Array.from({ length: candidateCount }, (_, i) => ({
        id: `stored-candidate-${i + 1}`,
      })),
    },
  });
}

async function main(): Promise<void> {
  console.log("/monitor stored-Week-1 snapshot — assertions");
  console.log("==============================================");

  // 1. DB wins when both DB + file have rows.
  {
    const r = makeReport("Postgres preferred over file");
    const cwd = makeTempCwd();
    try {
      seedFileSnapshot(cwd.root, {
        generatedAt: "2025-09-04T00:00:00Z",
        season: 2025,
        week: 1,
        dataMode: "stored",
        status: "MISSING_STORED_ODDS",
        candidateCount: 0,
        syntheticFixture: false,
        realWeek1BacktestReady: false,
        missingStoredOdds: true,
        missingProcessedNfl: false,
        scheduleReport: null,
        notes: ["file says stale"],
      });
      const client = inMemoryPersistenceClient();
      await seedDbRun(client, 290, "READY", true, "PASS");
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(r, snap !== undefined, "snapshot should be defined");
      check(r, snap?.source === "postgres", `source=${snap?.source}`);
      check(
        r,
        snap?.candidateCount === 290,
        `candidateCount=${snap?.candidateCount}`,
      );
      check(
        r,
        snap?.realWeek1BacktestReady === true,
        `realReady=${snap?.realWeek1BacktestReady}`,
      );
      check(r, snap?.status === "READY", `status=${snap?.status}`);
      check(
        r,
        snap?.scheduleValidationStatus === "PASS",
        `schedStatus=${snap?.scheduleValidationStatus}`,
      );
      check(r, snap?.syntheticFixture === false, "syntheticFixture must be false");
      check(r, snap?.storedOddsPresent === true, "storedOddsPresent should be true for READY");
      check(
        r,
        snap?.processedNflPresent === true,
        "processedNflPresent should be true for READY",
      );
    } finally {
      cwd.restore();
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — DB-backed 290-candidate run wins over stale file");
    else console.log("[1] FAIL — Postgres preferred");
  }

  // 2. File fallback when DB is empty.
  {
    const r = makeReport("file used when DB has nothing");
    const cwd = makeTempCwd();
    try {
      seedFileSnapshot(cwd.root, {
        generatedAt: "2026-05-21T12:00:00Z",
        season: 2025,
        week: 1,
        dataMode: "stored",
        status: "READY",
        candidateCount: 290,
        syntheticFixture: false,
        realWeek1BacktestReady: true,
        missingStoredOdds: false,
        missingProcessedNfl: false,
        scheduleReport: { status: "PASS" },
        notes: [],
      });
      const client = inMemoryPersistenceClient();
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(r, snap !== undefined, "snapshot should be defined");
      check(r, snap?.source === "file", `source=${snap?.source}`);
      check(
        r,
        snap?.candidateCount === 290,
        `candidateCount=${snap?.candidateCount}`,
      );
      check(
        r,
        snap?.realWeek1BacktestReady === true,
        `realReady=${snap?.realWeek1BacktestReady}`,
      );
      check(r, snap?.syntheticFixture === false, "syntheticFixture must be false");
    } finally {
      cwd.restore();
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — file used when DB empty");
    else console.log("[2] FAIL — file fallback");
  }

  // 3. Both empty → undefined → caller falls back to fixture.
  {
    const r = makeReport("undefined when neither source has data");
    const cwd = makeTempCwd();
    try {
      const client = inMemoryPersistenceClient();
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(r, snap === undefined, `snap should be undefined, got ${JSON.stringify(snap)}`);
    } finally {
      cwd.restore();
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — both empty → undefined");
    else console.log("[3] FAIL — undefined path");
  }

  // 4. Ungraded run reports gradingStatus="ungraded" — monitor
  //    will render ROI/hit rate as pending, NOT the fixture
  //    starter-test's 100% / 88.9%.
  {
    const r = makeReport("ungraded → gradingStatus pending");
    const cwd = makeTempCwd();
    try {
      const client = inMemoryPersistenceClient();
      await seedDbRun(client, 290, "READY", true, "PASS");
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(r, snap?.gradingStatus === "ungraded", `gradingStatus=${snap?.gradingStatus}`);
    } finally {
      cwd.restore();
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — ungraded stored run renders as pending");
    else console.log("[4] FAIL — grading status");
  }

  // 5. MISSING_STORED_ODDS surfaces correctly — storedOdds
  //    Present = false so /monitor can show "stored odds: no".
  {
    const r = makeReport("MISSING_STORED_ODDS surfaces correctly");
    const cwd = makeTempCwd();
    try {
      const client = inMemoryPersistenceClient();
      await seedDbRun(client, 0, "MISSING_STORED_ODDS", false, null);
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(r, snap?.status === "MISSING_STORED_ODDS", `status=${snap?.status}`);
      check(
        r,
        snap?.realWeek1BacktestReady === false,
        `realReady=${snap?.realWeek1BacktestReady}`,
      );
      check(r, snap?.storedOddsPresent === false, "storedOddsPresent must be false");
      check(r, snap?.missingStoredOdds === true, "missingStoredOdds must be true");
      check(r, snap?.candidateCount === 0, `candidateCount=${snap?.candidateCount}`);
    } finally {
      cwd.restore();
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — MISSING_STORED_ODDS surfaces correctly");
    else console.log("[5] FAIL — missing-odds surface");
  }

  // 6. Latest run wins — re-saving updates what the loader
  //    returns. Mirrors a re-migration → new stored run cycle.
  {
    const r = makeReport("latest stored run wins");
    const cwd = makeTempCwd();
    try {
      const client = inMemoryPersistenceClient();
      await seedDbRun(client, 100, "READY", true, "PASS");
      await seedDbRun(client, 290, "READY", true, "PASS");
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      check(
        r,
        snap?.candidateCount === 290,
        `should pick the most recent (290), got ${snap?.candidateCount}`,
      );
    } finally {
      cwd.restore();
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — latest stored run wins");
    else console.log("[6] FAIL — latest-wins");
  }

  // 7. The 290-candidate snapshot does NOT carry the fixture
  //    starter-test's 8/2/100%/88.9% numbers — those live in
  //    a different loader and are surfaced as fixture-only in
  //    the page. We assert the snapshot type doesn't even
  //    expose hitRate / roiPct / wins / losses, so the page
  //    physically cannot render them as stored performance.
  {
    const r = makeReport("snapshot has no fixture hit/ROI fields");
    const cwd = makeTempCwd();
    try {
      const client = inMemoryPersistenceClient();
      await seedDbRun(client, 290, "READY", true, "PASS");
      const snap = await loadStoredWeek1MonitorSnapshot({
        season: 2025,
        week: 1,
        client,
      });
      const obj = snap as unknown as Record<string, unknown>;
      check(r, !("hitRate" in obj), "hitRate must not be on the snapshot");
      check(r, !("roiPct" in obj), "roiPct must not be on the snapshot");
      check(r, !("wins" in obj), "wins must not be on the snapshot");
      check(r, !("losses" in obj), "losses must not be on the snapshot");
      check(r, !("qualifiedBets" in obj), "qualifiedBets must not be on the snapshot");
      check(r, !("evaluatedProps" in obj), "evaluatedProps must not be on the snapshot");
    } finally {
      cwd.restore();
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — stored snapshot omits hit/ROI/wins fields");
    else console.log("[7] FAIL — fixture-field leak");
  }

  // 8. No banned hooks in the new module.
  {
    const r = makeReport("no banned hooks in week-1-monitor-summary");
    const text = readSrc("src/lib/backtest/week-1-monitor-summary.ts");
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
      check(r, !re.test(text), `module contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — no API / betting / TD hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 8 monitor-stored-week-1 assertions passed.");
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
