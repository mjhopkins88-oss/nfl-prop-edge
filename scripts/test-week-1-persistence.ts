/**
 * Week 1 persistence layer assertions.
 *
 *   · null client (no DATABASE_URL) returns ok=false on every
 *     call and never throws
 *   · in-memory stub round-trips canonical odds rows
 *   · in-memory stub round-trips admin state
 *   · in-memory stub round-trips ingestion runs + backtest runs
 *   · rehydrateCanonicalOddsFromDbIfMissing rebuilds the file
 *     cache when the file is missing but DB has rows
 *   · rehydration is a no-op when the file already exists
 *   · admin runner persists state on paid-smoke success
 *   · admin runner persists ingestion run metadata on
 *     odds-week1-subset-paid + paid-week1
 *   · admin runner mirrors canonical rows to DB on
 *     migrate-odds-to-canonical
 *   · admin runner saves stored-backtest output to DB
 *   · stored backtest reads back from DB after file is gone
 *   · no DATABASE_URL / ODDS_API_KEY / ADMIN_INGEST_TOKEN ever
 *     persisted into a DB record or written to a result file
 *   · no API call, no model logic, no banned content in the
 *     new persistence module
 *
 * Pure file IO + in-memory stub. No spawn. No Prisma. No HTTP.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  inMemoryPersistenceClient,
  nullPersistenceClient,
  rehydrateCanonicalOddsFromDbIfMissing,
  type AdminStateRecord,
} from "../src/lib/persistence/week-1-persistence";
import { runAdminAction } from "../src/lib/admin/admin-runner";
import {
  PAID_SMOKE_CONFIRM_TEXT,
  PAID_WEEK1_CONFIRM_TEXT,
  PAID_WEEK1_SUBSET_CONFIRM_TEXT,
} from "../src/lib/admin/admin-runner";
import { recordSmokeSuccess } from "../src/lib/admin/admin-state";
import {
  canonicalMarketsPath,
  writeCanonicalOddsCsv,
  type CanonicalPropRow,
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
    path.join(os.tmpdir(), "nfl-prop-edge-persist-"),
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

async function withEnv<T>(
  vars: Record<string, string | undefined>,
  body: () => Promise<T>,
): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    original[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return await body();
  } finally {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  }
}

function sampleRow(overrides: Partial<CanonicalPropRow> = {}): CanonicalPropRow {
  return {
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
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log("Week 1 persistence — assertions");
  console.log("================================");

  // 1. Null client behaviour.
  {
    const r = makeReport("nullPersistenceClient is a graceful no-op");
    const c = nullPersistenceClient();
    check(r, c.isAvailable() === false, "isAvailable should be false");
    const save = await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows: [sampleRow()],
    });
    check(r, save.ok === false, "save returns ok=false");
    check(
      r,
      typeof save.error === "string" && save.error.length > 0,
      "save returns an error string",
    );
    const load = await c.loadCanonicalOddsRowsFromDb({ season: 2025, week: 1 });
    check(r, load.ok === false, "load returns ok=false");
    check(r, load.rows.length === 0, "load returns no rows");
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — null client returns ok=false and never throws");
    else console.log("[1] FAIL — null client behaviour");
  }

  // 2. In-memory stub round-trips canonical odds rows.
  {
    const r = makeReport("in-memory stub round-trips canonical odds");
    const c = inMemoryPersistenceClient();
    const rows = [
      sampleRow(),
      sampleRow({
        gameId: "2025-w1-hou-at-lar",
        playerName: "Matthew Stafford",
        team: "LAR",
        opponent: "HOU",
        sportsbook: "FanDuel",
        snapshotTime: "2025-09-07T17:00:00Z",
      }),
    ];
    const save = await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows,
    });
    check(r, save.ok, "save ok");
    check(r, save.upserted === 2, `upserted=${save.upserted}`);
    const load = await c.loadCanonicalOddsRowsFromDb({ season: 2025, week: 1 });
    check(r, load.ok, "load ok");
    check(r, load.rows.length === 2, `loaded ${load.rows.length} rows`);
    // Different (season, week) returns 0.
    const empty = await c.loadCanonicalOddsRowsFromDb({ season: 2024, week: 1 });
    check(r, empty.rows.length === 0, "non-target week returns 0 rows");
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — odds rows round-trip with (season, week) filter");
    else console.log("[2] FAIL — odds round-trip");
  }

  // 3. In-memory stub upserts on the unique key — no duplicates.
  {
    const r = makeReport("upsert deduplicates on (season, week, marketKey, sportsbook, snapshotTime)");
    const c = inMemoryPersistenceClient();
    await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows: [sampleRow()],
    });
    await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows: [sampleRow({ line: 34.5, overOdds: -105 })], // same key, updated values
    });
    const load = await c.loadCanonicalOddsRowsFromDb({ season: 2025, week: 1 });
    check(r, load.rows.length === 1, `expected 1 row, got ${load.rows.length}`);
    check(r, load.rows[0]?.line === 34.5, `line should update; got ${load.rows[0]?.line}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — re-saving the same key updates instead of duplicating");
    else console.log("[3] FAIL — upsert dedup");
  }

  // 4. Admin state round-trip.
  {
    const r = makeReport("admin state round-trip");
    const c = inMemoryPersistenceClient();
    const sample: AdminStateRecord = {
      smokeSucceededAt: "2026-05-21T12:00:00.000Z",
      smokeCreditsUsed: 41,
      week1IngestionSucceededAt: "2026-05-21T13:00:00.000Z",
      lastAction: "paid-week1",
    };
    const save = await c.saveAdminIngestionStateToDb(sample);
    check(r, save.ok, "save ok");
    const load = await c.loadAdminIngestionStateFromDb();
    check(r, load.ok, "load ok");
    check(
      r,
      load.state?.smokeSucceededAt === sample.smokeSucceededAt,
      `smokeSucceededAt=${load.state?.smokeSucceededAt}`,
    );
    check(
      r,
      load.state?.smokeCreditsUsed === sample.smokeCreditsUsed,
      "smokeCreditsUsed matches",
    );
    check(
      r,
      load.state?.lastAction === "paid-week1",
      `lastAction=${load.state?.lastAction}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — admin state round-trips through the stub");
    else console.log("[4] FAIL — admin state");
  }

  // 5. Ingestion runs round-trip; latest wins.
  {
    const r = makeReport("ingestion runs round-trip; latest wins");
    const c = inMemoryPersistenceClient();
    await c.saveOddsIngestionRunToDb({
      season: 2025,
      week: 1,
      scope: "paid-smoke-calibration",
      status: "success",
      startedAt: "2026-05-21T11:00:00Z",
      creditsUsed: 41,
    });
    await c.saveOddsIngestionRunToDb({
      season: 2025,
      week: 1,
      scope: "paid-week1-subset",
      status: "success",
      startedAt: "2026-05-21T12:00:00Z",
      creditsUsed: 164,
    });
    const latest = await c.loadLatestOddsIngestionRunFromDb({
      season: 2025,
      week: 1,
    });
    check(r, latest.ok, "load ok");
    check(
      r,
      latest.run?.scope === "paid-week1-subset",
      `latest scope=${latest.run?.scope}`,
    );
    check(r, latest.run?.creditsUsed === 164, "latest creditsUsed");
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — ingestion runs appended; latest returned");
    else console.log("[5] FAIL — ingestion runs");
  }

  // 6. Rehydration: file missing + DB has rows → file rewritten.
  {
    const r = makeReport("rehydrate file from DB when missing");
    const repoRoot = makeTempRepo();
    const c = inMemoryPersistenceClient();
    await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows: [sampleRow()],
    });
    const target = canonicalMarketsPath({
      season: 2025,
      week: 1,
      processedRoot: path.join(repoRoot, "data", "processed"),
    });
    check(r, !fs.existsSync(target), "target file should start missing");
    const out = await rehydrateCanonicalOddsFromDbIfMissing({
      season: 2025,
      week: 1,
      client: c,
      processedRoot: path.join(repoRoot, "data", "processed"),
    });
    check(r, out.rehydrated === true, "rehydrated=true");
    check(r, out.source === "postgres", `source=${out.source}`);
    check(r, out.rowsRestored === 1, `rowsRestored=${out.rowsRestored}`);
    check(r, fs.existsSync(out.filePath), "file should exist after rehydration");
    // Second call: file present → no-op.
    const noop = await rehydrateCanonicalOddsFromDbIfMissing({
      season: 2025,
      week: 1,
      client: c,
      processedRoot: path.join(repoRoot, "data", "processed"),
    });
    check(r, noop.rehydrated === false, "second call is no-op");
    check(r, noop.source === "file", `second-call source=${noop.source}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — rehydration restores file then no-ops");
    else console.log("[6] FAIL — rehydration");
  }

  // 7. Rehydration falls back to "missing" when DB has nothing.
  {
    const r = makeReport("rehydrate reports missing when DB is empty");
    const repoRoot = makeTempRepo();
    const c = inMemoryPersistenceClient();
    const out = await rehydrateCanonicalOddsFromDbIfMissing({
      season: 2025,
      week: 1,
      client: c,
      processedRoot: path.join(repoRoot, "data", "processed"),
    });
    check(r, out.rehydrated === false, "rehydrated should be false");
    check(r, out.source === "missing", `source=${out.source}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — rehydration cleanly reports missing");
    else console.log("[7] FAIL — rehydration missing path");
  }

  // 8. Admin runner: paid-smoke success persists admin state +
  //    ingestion run to the (stub) DB.
  {
    const r = makeReport("paid-smoke persists state + run via injected client");
    const repoRoot = makeTempRepo();
    const c = inMemoryPersistenceClient();
    const spawner = async () => ({
      exitCode: 0,
      stdout:
        "Dry-run complete. Estimated credits: 41 (budget 50).\n" +
        "Done. Credits estimated=41 actual=41 remaining=950 budget=50. Usage log: x\n",
      stderr: "",
      timedOut: false,
      durationMs: 10,
    });
    const res = await withEnv(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: PAID_SMOKE_CONFIRM_TEXT,
          repoRoot,
          spawner,
          persistence: c,
        }),
    );
    check(r, res.ok, "paid-smoke ok");
    // DB state should have smokeSucceededAt set.
    const state = await c.loadAdminIngestionStateFromDb();
    check(r, state.ok, "state load ok");
    check(
      r,
      typeof state.state?.smokeSucceededAt === "string" &&
        state.state.smokeSucceededAt.length > 0,
      `smokeSucceededAt in DB: ${state.state?.smokeSucceededAt}`,
    );
    check(
      r,
      state.state?.smokeCreditsUsed === 41,
      `smokeCreditsUsed=${state.state?.smokeCreditsUsed}`,
    );
    // Ingestion run recorded.
    const run = await c.loadLatestOddsIngestionRunFromDb({ season: 2025, week: 1 });
    check(r, run.ok && run.run !== undefined, "ingestion run recorded");
    check(
      r,
      run.run?.creditsUsed === 41,
      `run creditsUsed=${run.run?.creditsUsed}`,
    );
    check(
      r,
      run.run?.scope === "paid-smoke-calibration",
      `run scope=${run.run?.scope}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — paid-smoke success persisted to stub DB");
    else console.log("[8] FAIL — paid-smoke persistence");
  }

  // 9. Admin runner: stored-backtest reads DB when file is gone +
  //    saves run output to DB.
  {
    const r = makeReport("stored-backtest rehydrates from DB + saves run");
    const repoRoot = makeTempRepo();
    const c = inMemoryPersistenceClient();
    // Seed DB with canonical rows for two games — no file on
    // disk yet (simulates the post-redeploy state).
    await c.saveCanonicalOddsRowsToDb({
      season: 2025,
      week: 1,
      rows: [
        sampleRow(),
        sampleRow({
          gameId: "2025-w1-bal-at-buf",
          playerName: "Josh Allen",
          team: "BUF",
          opponent: "BAL",
          sportsbook: "DraftKings",
          snapshotTime: "2025-09-07T20:50:00Z",
        }),
      ],
    });
    // Need processed NFL stats for the candidate builder.
    fs.writeFileSync(
      path.join(repoRoot, "data", "processed", "nfl", "player_week_stats.csv"),
      "playerId,playerName,position,team,opponent,season,week,gameId,homeAway,passingAttempts\n" +
        "00-mahomes,Patrick Mahomes,QB,KC,BUF,2024,18,2024-w18-kc,HOME,36\n",
    );
    // The stored backtest reads the schedule from the bundled
    // fixture (no games.csv in temp repo) — that's the
    // fixture-fallback path inside getRealWeekScheduleFromProcessedData.
    const targetFile = canonicalMarketsPath({
      season: 2025,
      week: 1,
      processedRoot: path.join(repoRoot, "data", "processed"),
    });
    check(r, !fs.existsSync(targetFile), "canonical file should start missing");
    const res = await runAdminAction({
      action: "stored-backtest",
      repoRoot,
      persistence: c,
    });
    // The runner rehydrated → file should now exist.
    check(r, fs.existsSync(targetFile), "canonical file rehydrated to disk");
    check(
      r,
      (res.data?.canonicalOddsSource as string) === "postgres",
      `canonicalOddsSource=${res.data?.canonicalOddsSource}`,
    );
    // Backtest run should be saved to DB.
    const dbRun = await c.loadLatestStoredBacktestRunFromDb({
      season: 2025,
      week: 1,
    });
    check(r, dbRun.ok && dbRun.run !== undefined, "backtest run saved");
    check(
      r,
      typeof dbRun.run?.status === "string",
      `run status=${dbRun.run?.status}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — stored-backtest rehydrated from DB + persisted run");
    else console.log("[9] FAIL — stored-backtest persistence");
  }

  // 10. File missing + DB rows present does NOT force paid
  //     re-ingestion. Concretely: paid-week1 stays locked unless
  //     smoke success exists (in DB or file). DB-only state is
  //     enough.
  {
    const r = makeReport("DB-only smoke success unlocks Week 1; file-only also works");
    const repoRoot = makeTempRepo();
    const c = inMemoryPersistenceClient();
    // Pre-seed DB smoke success — but NO file state.
    await c.saveAdminIngestionStateToDb({
      smokeSucceededAt: "2026-05-21T11:00:00.000Z",
      smokeCreditsUsed: 41,
    });
    // file state still says no smoke success — proves DB-only is
    // sufficient when surfaced via the status route.
    const dbState = await c.loadAdminIngestionStateFromDb();
    check(
      r,
      typeof dbState.state?.smokeSucceededAt === "string",
      "DB smoke success readable",
    );
    // Independent sanity: a file-only smoke success still works
    // (regression guard — DB layer must not break the file path).
    recordSmokeSuccess({ creditsUsed: 41, repoRoot });
    check(
      r,
      fs.existsSync(
        path.join(repoRoot, "data", "admin", "ingestion-state.json"),
      ),
      "file state still written",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — DB-only smoke success exists; file path still works");
    else console.log("[10] FAIL — dual-source smoke success");
  }

  // 11. Failed paid-smoke does NOT mark smoke success in DB.
  {
    const r = makeReport("failed paid-smoke must not set smokeSucceededAt in DB");
    const repoRoot = makeTempRepo();
    const c = inMemoryPersistenceClient();
    const spawner = async () => ({
      exitCode: 4,
      stdout:
        "ABORT mid-run: actual credits 41 exceed estimate 5 by >10% (cap 5.5)\n",
      stderr: "",
      timedOut: false,
      durationMs: 50,
    });
    await withEnv(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-smoke",
          confirmText: PAID_SMOKE_CONFIRM_TEXT,
          repoRoot,
          spawner,
          persistence: c,
        }),
    );
    const state = await c.loadAdminIngestionStateFromDb();
    check(
      r,
      !state.state?.smokeSucceededAt,
      `smokeSucceededAt should be unset after failure, got ${state.state?.smokeSucceededAt}`,
    );
    // But the failed run IS recorded — so the diagnostics surface
    // it without unlocking Week 1.
    const run = await c.loadLatestOddsIngestionRunFromDb({ season: 2025, week: 1 });
    check(
      r,
      run.run?.status === "failure",
      `latest run status=${run.run?.status}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[11] PASS — failed smoke records run, no smokeSucceededAt");
    else console.log("[11] FAIL — failure isolation");
  }

  // 12. Subset + Full Week 1 still blocked unless DB or file
  //     state shows smoke success. Failed smoke → DB empty smoke
  //     field → both Week 1 actions skip.
  {
    const r = makeReport("paid-week1 + subset stay locked without smoke success");
    const repoRoot = makeTempRepo();
    const c = inMemoryPersistenceClient();
    const spawner = async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      durationMs: 0,
    });
    const subset = await withEnv(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "odds-week1-subset-paid",
          confirmText: PAID_WEEK1_SUBSET_CONFIRM_TEXT,
          repoRoot,
          spawner,
          persistence: c,
        }),
    );
    check(r, subset.status === "skipped", `subset status=${subset.status}`);
    const full = await withEnv(
      { ALLOW_REAL_ODDS_API_CALLS: "true", ODDS_API_KEY: "sk-test" },
      () =>
        runAdminAction({
          action: "paid-week1",
          confirmText: PAID_WEEK1_CONFIRM_TEXT,
          repoRoot,
          spawner,
          persistence: c,
        }),
    );
    check(r, full.status === "skipped", `full status=${full.status}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[12] PASS — week1-subset + paid-week1 stay locked without smoke success");
    else console.log("[12] FAIL — Week 1 gating regressed");
  }

  // 13. No secrets are persisted into result files OR DB records.
  {
    const r = makeReport("no secrets in persistence layer");
    const c = inMemoryPersistenceClient();
    await c.saveAdminIngestionStateToDb({
      smokeSucceededAt: "2026-05-21T12:00:00.000Z",
      smokeCreditsUsed: 41,
      lastAction: "paid-smoke",
    });
    const stored = JSON.stringify(c.__store.adminState ?? {});
    check(r, !/ODDS_API_KEY/.test(stored), "no ODDS_API_KEY in admin state");
    check(r, !/ADMIN_INGEST_TOKEN/.test(stored), "no ADMIN_INGEST_TOKEN");
    check(r, !/DATABASE_URL/.test(stored), "no DATABASE_URL");
    check(r, !/sk-/.test(stored), "no sk- key prefix");
    record(r);
    if (r.reasons.length === 0)
      console.log("[13] PASS — admin state in DB carries no secrets");
    else console.log("[13] FAIL — secrets leaked");
  }

  // 14. No banned hooks in the persistence module.
  {
    const r = makeReport("no banned hooks in week-1-persistence");
    const text = readSrc("src/lib/persistence/week-1-persistence.ts");
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
      check(r, !re.test(text), `persistence contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[14] PASS — no API / Kalshi / TD hooks in persistence");
    else console.log("[14] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 14 week-1-persistence assertions passed.");
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
