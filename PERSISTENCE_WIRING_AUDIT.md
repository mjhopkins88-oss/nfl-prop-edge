# Persistence Wiring Audit

Why /admin/ingestion was forgetting Week 1 data after a redeploy
even though the persistence layer is wired, and the layered fix
this commit lands.

## Symptom

After a successful sequence on Railway:
- `migrate-odds-to-canonical` (canonical file + 1882 DB rows)
- `stored-backtest` (READY, 290 candidates, DB run saved)

A redeploy returned the admin page to its empty state:
- `STORED WEEK 1 ODDS: no`
- `Stored Week 1 ingestion success: never`
- Next-action recommendation: "Run full paid ingestion"

The data wasn't actually lost — Postgres still had it — but the
page reflected the ephemeral file state and missed the DB rows
entirely.

## Inspections

### Prisma schema (`prisma/schema.prisma:316+`)
- `StoredPropMarket`, `StoredBacktestRun`, `OddsIngestionRun`,
  `AdminIngestionState`, `ApiUsageLog` all defined.
- Unique index on `StoredPropMarket(season, week, marketKey,
  sportsbook, snapshotTime)`.
- Status: **OK**.

### Railway start command (`package.json`, `scripts/run-db-push-if-configured.cjs`)
- `npm start` runs the helper, then `next start`.
- Helper runs `prisma db push --skip-generate
  --accept-data-loss=false` only when `DATABASE_URL` is set.
- Failure logs a warning and lets the app start. Persistence
  falls back to file-only when tables are absent.
- Status: **OK** — but the page didn't surface whether the
  tables actually exist after boot.

### Migration action (`migrate-odds-to-canonical`)
- Calls `persistence.deleteCanonicalOddsRowsForWeek(...)` then
  `persistence.saveCanonicalOddsRowsToDb(...)`.
- Reports `dbDeleted` + `dbUpserted` on the response.
- Status: **WRITES correctly** — but never re-verified the row
  count from DB after save, so a silent half-failure wasn't
  surfaced.

### Stored backtest action (`stored-backtest`)
- Calls `rehydrateCanonicalOddsFromDbIfMissing` (only when file
  is missing) then `buildRealWeek1CandidatesFromStoredData`
  then `persistence.saveStoredBacktestRunToDb`.
- Status: **WRITES correctly** — but the `result.data` didn't
  expose `storedBacktestDbSave` / `storedBacktestSource` for
  the admin UI to surface.

### /admin/ingestion status route
- Reads `buildReadinessReport` for the page's primary status
  booleans (`storedWeek1OddsPresent`,
  `realWeek1BacktestReady`).
- The readiness report **looks only at files on disk**
  (`existsIn(repoRoot, "data/processed/odds/2025/week-1-prop-markets.csv")`).
- The DB row read happens via `persistence.loadCanonicalOddsRowsFromDb`
  but only for the secondary `oddsSource` label
  ("postgres-rehydration-pending"). The page's headline
  "STORED WEEK 1 ODDS: yes/no" is still file-driven.
- Status: **THIS IS THE BUG**. The primary booleans the page
  renders ignore DB rows.

### Stored odds loader (`stored-odds-loader.ts`)
- Reads the canonical file or legacy file. Falls back to
  `MISSING_STORED_ODDS` when both are gone.
- No DB read path — relies on the runner / status pre-rehydration.
- Status: **EXPECTED**. The job of DB-then-file fallback lives
  one layer up.

### Page loaders
- `/backtest/week-1` and `/monitor` use
  `loadStoredWeek1MonitorSnapshot` which **does** prefer DB
  over file. These pages already render correctly post-
  redeploy.
- Status: **OK** — confirmed via test suite.

### Admin runner's `runAdminAction`
- For stored-backtest, calls `rehydrateCanonicalOddsFromDbIfMissing`
  before `buildRealWeek1CandidatesFromStoredData`. File gets
  restored from DB if missing.
- Status: **OK**.

## Root cause

Two failure modes compound:

1. **The admin status route's headline booleans were file-only.**
   `readiness.missingStoredOdds`, `readiness.realWeek1BacktestReady`,
   `nextCommandRequiresPaidApi` all come from `buildReadinessReport`,
   which inspects file existence. Even after the DB write
   succeeded, the page rendered "STORED WEEK 1 ODDS: no" because
   the file mirror was wiped by the redeploy.

2. **No row-count or table-ready diagnostic surfaced.** The user
   couldn't tell whether the DB write actually landed, whether
   the tables existed, or whether rehydration was possible.
   The admin status returned secondary labels like
   `oddsSource: "postgres-rehydration-pending"` but never the
   counts that would prove the data was safe.

The next-action recommendation followed the same pattern:
"Paid odds data missing" when the file was gone, regardless of
whether Postgres still had the 1882 rows.

## Fix

### Persistence client
- `countCanonicalOddsRows({season, week})` → `number`.
- `countStoredBacktestRuns({season, week})` → `number`.
- `countOddsIngestionRuns({season, week})` → `number`.
- `pingPersistenceClient()` → table-readiness check (lightweight
  query against `AdminIngestionState`). Result: `{ tablesReady,
  error? }`.

### Status route
- New `persistence.counts` block:
  - `storedPropMarketRows`, `storedBacktestRuns`,
    `oddsIngestionRuns`, `adminStateExists`.
- New `persistence.prismaTablesReady` boolean.
- **Auto-rehydrate** the canonical odds file from DB BEFORE
  computing readiness, so the page's primary booleans
  immediately reflect the DB state. Source becomes
  `"postgres-rehydrated"` when the file was just written.
- Override `storedWeek1OddsPresent` + `realWeek1BacktestReady`
  in the response when DB has the data (file rehydration is
  best-effort; the boolean reflects DB truth either way).

### Migration action
- Re-count `StoredPropMarket` rows after upsert and surface
  as `dbRowCountAfter` in the result.
- When `dbAvailable=false` or `dbError` set, prepend a warning
  to `summary`:
  "Data is only in ephemeral file cache and will be lost on redeploy."

### Stored backtest action
- Add `storedBacktestDbSave` (`"ok"` | `"fail"`) and
  `storedBacktestSource` (`"postgres"` | `"file"` |
  `"postgres-rehydrated"`) to `result.data`.
- Same redeploy warning when DB save fails.

### Verify-persistence admin action
- New action: `verify-persistence`.
- Checks DB connectivity, table existence, row counts, whether
  canonical file can be rehydrated from DB, whether stored
  backtest can be loaded from DB.
- Pure read — no external API, no `--execute`.

### Next-action recommendation
- DB rows ≥ 1 → "Run stored backtest" (or "Grade Week 1" if
  already done). File rehydration is automatic.
- File present + DB rows = 0 → "Run Migrate to persist to
  Postgres."
- Neither → "Paid odds data missing — restore backup or rerun
  paid ingestion."

## What survives a redeploy now

| Data | Before fix | After fix |
|---|---|---|
| Canonical odds | DB had rows but the page reported "missing" | Status reads DB count first; rehydration writes the file back automatically. |
| Stored backtest run | DB row survived, /monitor + /backtest/week-1 used it | Admin page now also reflects it (`storedBacktestSource: postgres`). |
| Admin smoke-success | DB had it but status route ranked file first | Loader already prefers DB (commit `f01d4f6`); confirmed. |
| Disqualification breakdown | File-only | DB row count surfaces with the verify action; legacy file still readable. |

## Standing rules (unchanged)

- No paid API call from the verify action or any persistence
  read path.
- DB writes never store `ODDS_API_KEY`, `ADMIN_INGEST_TOKEN`,
  `DATABASE_URL`, or any raw HTTP body.
- Persistence layer's null client (`DATABASE_URL` unset) still
  works — every read returns `{ ok: false }` and the page
  falls back to file. Local dev unchanged.
- No model logic touched.
