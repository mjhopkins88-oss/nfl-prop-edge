# Real 2025 Week 1 Stored Data — Wiring Audit

The `/backtest/week-1` page correctly flags the current state as
`SYNTHETIC_ONLY` and `realWeek1BacktestReady: false`. This audit
documents the exact gap between "synthetic fixture pipeline test"
and a real 2025 Week 1 backtest, and the wiring this commit adds
so that gap is closeable on demand without changing any model
code.

## What exists today

| Layer | What's there |
|---|---|
| Schedule fixture | `data/fixtures/nfl/2025-week-1-schedule.fixture.json` — 16 real Week 1 games (DAL@PHI Thursday, KC@LAC São Paulo, the Sunday windows, BAL@BUF SNF, MIN@CHI MNF). Schedule only — no scores. |
| Schedule validator | `src/lib/backtest/week-1-schedule-validation.ts` — already wired into the runner; flips status between `PASS` / `FAIL` / `SYNTHETIC_ONLY`. |
| nflverse fixture loader | `src/lib/ingestion/nflverse-loader.ts` — loads `data/processed/nfl/*.csv` if present, falls back to `data/fixtures/nfl/*.fixture.json`. Has the temporal `isStrictlyBefore` predicate. |
| Backtest data loader | `src/lib/backtest/data-loader.ts` — `loadBacktestFixtures()` works (fixture mode). `loadProcessedBacktestData()` **throws** with "not wired yet" message. |
| Synthetic Week 1 fixture | `data/fixtures/backtest/week-1/*.fixture.json` — KC@BAL + BUF@MIA placeholders. Not real Week 1. |
| Odds API client | Dry-run by default, gated behind `ALLOW_REAL_ODDS_API_CALLS=true` + `--execute`. Writes to `data/processed/prop_markets.csv` + `data/processed/prop_quotes.csv` when executed. We have never executed it. |
| Processed NFL data | `data/processed/nfl/` — empty (only `.gitkeep`). The nflverse ingestion script is wired and ready to run. |
| Processed Odds data | `data/processed/odds/` — does not exist yet. The existing Odds API ingestor writes to `data/processed/prop_markets.csv` directly. |

## What was missing

1. **No "stored" path through the backtest runner.** Every code
   path through `runWeekSimulation` calls
   `loadBacktestFixtures()`, which always reads the synthetic
   fixture tree. There was no way to ask the runner: "use real
   stored data instead."
2. **`loadProcessedBacktestData()` throws.** The stub never
   evolved past "TODO: wire CSV → Backtest* mappers."
3. **No discriminated "missing-data" signal.** When a caller
   asks for real data and it's not there, the only outcome was
   either crash or silent fallback to synthetic — neither
   acceptable for the real-vs-synthetic distinction we need on
   the page.
4. **No canonical processed-odds path** documented anywhere.
   Odds ingestion writes to `data/processed/prop_markets.csv` +
   `prop_quotes.csv` per-season-flat; the real Week 1 path will
   need per-week files (or a season file with a `week`
   discriminator). This audit pins it at
   `data/processed/odds/{season}/week-{N}-{props,quotes}.csv`.

## What this commit adds

| Module | Purpose |
|---|---|
| `src/lib/backtest/processed-nfl-loader.ts` | Thin adapters over `nflverse-loader.ts` (no fixture fallback): `loadProcessedNflGames`, `loadProcessedPlayerWeekStatsStrict`, `loadProcessedTeamWeekStatsStrict`, `loadProcessedRostersStrict`, `getPriorPlayerHistoryForWeek`, `getPriorTeamHistoryForWeek`, `getRealWeekScheduleFromProcessedData` (returns the schedule fixture today, the processed `games.csv` once it exists). Returns empty arrays + a missing-data signal when files are absent. |
| `src/lib/backtest/stored-odds-loader.ts` | Reads canonical stored Odds API output from `data/processed/odds/{season}/week-{N}-{props,quotes}.csv` (and the legacy `data/processed/prop_markets.csv` / `prop_quotes.csv` as a fallback). Filters to the 4 starter markets only, rejects post-kickoff odds, drops touchdown columns, groups by `(gameId, playerId, propType)`, picks the canonical book line. Returns `{ status: "READY" \| "MISSING_STORED_ODDS" \| "MALFORMED_STORED_ODDS", markets, quotes, missingNotes }`. No network calls — never invokes the Odds API client. |
| `src/lib/backtest/real-week-candidate-builder.ts` | Top-level builder. Pipes stored odds through schedule validation, joins to NFL player history via the strict-before filter, and returns either `{ status: "READY", candidates }` or one of the missing-data statuses. Refuses any candidate game that isn't in the real schedule (so KC@BAL, BUF@MIA, etc. cannot smuggle through). |
| Runner: `--data-mode fixture\|stored` | Selects between the existing fixture path and the new stored path. Defaults to `fixture`. Stored mode never falls back to synthetic on missing data — it writes the missing-data status into the locked recommendations so the page can render the "Real Week 1 stored data not loaded yet" hint. |
| Page: stored-mode status | New "Data source mode" panel shows current mode, syntheticFixture flag, realWeek1BacktestReady, plus the missing-data status when stored mode runs without inputs. The synthetic banner still fires when the schedule doesn't pass. |

## How `realWeek1BacktestReady` flips from `false` to `true`

The only path is:

1. `data/processed/nfl/player_week_stats.csv` exists with rows
   for `season < 2025 || (season === 2025 && week < 1)` — the
   prior-season history the model uses to project Week 1.
2. `data/processed/odds/2025/week-1-prop-markets.csv` and
   `…/week-1-prop-quotes.csv` exist with rows in the 4 starter
   markets, keyed to `gameId` values that match the real Week 1
   schedule (`2025-w1-kc-at-lac`, `2025-w1-bal-at-buf`, etc.).
3. The runner is invoked as
   `npx tsx scripts/run-week-1-starter-test.ts --phase full --data-mode stored --season 2025 --week 1`.
4. The candidate builder returns `READY`. The schedule
   validator returns `PASS`. The locked-recommendations file
   carries `realWeek1BacktestReady: true`, `syntheticFixture: false`,
   `dataMode: "STORED_2025"`. The page's red banner disappears
   and the hero reverts to "Week 1 2025 Starter Test".

## Exact command sequence to get to a real Week 1 backtest

(All dry-run / opt-in. No new APIs added. No credits spent
until the user explicitly says `--execute`.)

```bash
# 1. nflverse ingestion (free, no API key).
#    Dry-run prints the plan; --no-dry-run requires
#    ALLOW_NFLVERSE_NETWORK_FETCH=true.
npx tsx scripts/ingest-nfl-history.ts \
    --season 2025 --source nflverse --dry-run

# 2. Odds API dry-run smoke test (free — prints plan + credit
#    estimate, writes nothing).
npx tsx scripts/ingest-historical-prop-lines.ts \
    --scope smoke-test --source mock --dry-run

# 3. Real smoke test (paid, opt-in — minimal credits).
ALLOW_REAL_ODDS_API_CALLS=true \
    npx tsx scripts/ingest-historical-prop-lines.ts \
    --scope smoke-test --execute

# 4. Real Week 1 ingestion (paid, opt-in). This is the step
#    that produces data/processed/odds/2025/week-1-*.csv.
ALLOW_REAL_ODDS_API_CALLS=true \
    npx tsx scripts/ingest-historical-prop-lines.ts \
    --scope week --season 2025 --week 1 --execute

# 5. Real Week 1 backtest from stored data only — no APIs.
npx tsx scripts/run-week-1-starter-test.ts \
    --phase full --data-mode stored \
    --season 2025 --week 1
```

If any input is missing at step 5, the runner does not crash —
it writes the missing-data status into the output files and the
page surfaces the exact "next command" hint.

## Disciplines preserved

- No model logic touched.
- Stored mode is opt-in via `--data-mode stored`; fixture mode
  remains the default and continues to produce the existing
  `SYNTHETIC_ONLY` output.
- Schedule validation, leakage guard, V1 starter market gate,
  and "no touchdown propTypes" gate all sit inside the new
  builder.
- No new API client. The stored-odds loader reads files, never
  the Odds API.
- API credit protection unchanged — paid ingestion is still
  gated behind `ALLOW_REAL_ODDS_API_CALLS=true` AND `--execute`.
