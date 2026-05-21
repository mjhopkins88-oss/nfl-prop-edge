# Real 2025 Week 1 Readiness Status

Snapshot after the free nflverse network fetch. No paid APIs
called. No `--execute`. ALLOW_REAL_ODDS_API_CALLS is still unset.
Only `ALLOW_NFLVERSE_NETWORK_FETCH=true` was used for the free
public ingestion.

## TL;DR

Processed nflverse data is now in place. The only remaining gap
is the paid Odds API ingestion. `/backtest/week-1` still runs in
synthetic fixture mode (the stored runner correctly refuses to
fall back when stored odds are missing).

| Required input | Path | Present? |
|---|---|---|
| Stored Odds API quotes | `data/processed/odds/2025/week-1-prop-markets.csv` | **No** (paid) |
| Processed nflverse player history | `data/processed/nfl/player_week_stats.csv` | **yes (12,588 rows)** |
| Processed games | `data/processed/nfl/games.csv` | yes (570 games, 2024-25) |
| Processed rosters | `data/processed/nfl/rosters.csv` | yes (1,967 rows) |
| Real Week 1 schedule fixture | `data/fixtures/nfl/2025-week-1-schedule.fixture.json` | yes |
| Raw nflverse drop-zone | `data/raw/nfl/{2024,2025}/` | populated (CSVs, gitignored) |

`realWeek1BacktestReady` is `false` — but for one reason only:
stored odds are missing. `storedBuilderStatus` reports
`MISSING_STORED_ODDS` (no longer `MISSING_PROCESSED_NFL`). The
runner exits cleanly without synthesizing fake data.

## What changed this pass

### Wired the free nflverse network fetch

`scripts/ingest-nfl-history.ts --source nflverse --no-dry-run`
previously printed "scaffolded but not wired in" and exited
without downloading. It now performs the actual fetch via Node's
global `fetch` against the corrected nflverse-data release URLs,
streams the CSVs into `data/raw/nfl/<season>/`, then falls
through to the existing local-mode normalizer + writer.

URL corrections:

| Asset | Old (404) | New (verified) |
|---|---|---|
| Player weekly stats | `player_stats/player_stats_{season}.csv` | `stats_player/stats_player_week_{season}.csv` |
| Schedules | `schedules/sched_{season}.csv` | `schedules/games.csv` (master, filtered per-season) |
| Rosters | `rosters/roster_{season}.csv` | unchanged |
| Snap counts | `snap_counts/snap_counts_{season}.csv` | unchanged |

The `stats_player` tag is current for 2024+; the older
`player_stats` tag stopped being updated mid-2025. The master
`schedules/games.csv` carries all seasons in one file, so the
fetcher downloads it once and filters per-season at write time.

### Canonicalized gameId convention

The normalizer in `normalizeGameRow` now always emits canonical
kebab-case gameIds (`2025-w1-bal-at-buf`) instead of passing
through nflverse's snake-case (`2025_01_BAL_BUF`). The schedule
fixture and the stored-odds ingestion already use kebab-case;
games.csv now matches, so schedule lookup by gameId works
uniformly whether the schedule comes from the processed file or
the static fixture.

### Network mode kill-switch unchanged

`ALLOW_NFLVERSE_NETWORK_FETCH=true` is still required to flip
network fetch from the default off state. The flag is checked at
CLI parse time; without it, `--source nflverse --no-dry-run`
errors with a clear message. Dry-run still prints the plan
without hitting the network.

## Commands run this pass

### `ALLOW_NFLVERSE_NETWORK_FETCH=true npx tsx scripts/ingest-nfl-history.ts --seasons 2024,2025 --source nflverse --no-dry-run`

- Downloaded 8 files (4 per season × 2 seasons) totaling ~21 MB.
- Normalized: 570 games / 12,588 player-weeks / 0 team-weeks /
  1,967 rosters / 0 snap rows.
  - Team-week stats are not emitted as a nflverse asset — they
    aggregate from play-by-play. Not required for V1 starter
    markets.
  - Snap-count rows didn't normalize (the new snap_counts CSV
    uses different column names than the older normalizer
    expects). Not required for V1.
- Written: `games.csv`, `player_week_stats.csv`, `rosters.csv`,
  `player_ids.csv` in `data/processed/nfl/`.
- All raw and processed paths are gitignored except the directory
  itself + `.gitkeep`. The processed CSVs themselves are not
  committed.

### `npx tsx scripts/check-real-week-1-readiness.ts`

- `status = NOT_READY` (only the paid Odds API gap remains)
- `realWeek1BacktestReady = false`
- `missingStoredOdds = true`
- `missingProcessedNfl = false`
- `storedBuilderStatus = MISSING_STORED_ODDS`
- Next command: the paid Odds API ingestion (requires
  `ALLOW_REAL_ODDS_API_CALLS=true` AND `--execute`).
- `nextCommandRequiresPaidApi = true`.

### `npx tsx scripts/run-week-1-starter-test.ts --phase pregame --data-mode stored --season 2025 --week 1`

- `status = MISSING_STORED_ODDS`. No synthetic fallback.
- `realWeek1BacktestReady = false`.
- `syntheticFixture = false` in stored mode.
- Status file written:
  `data/backtests/2025/week-1-data-mode-status.fixture.json`.
- No crash. No API call.

### Tests

- `test-real-week-1-readiness.ts` — 8/8 passed
- `test-real-week-1-data-wiring.ts` — 10/10 passed
- `test-week-1-schedule-validation.ts` — 10/10 passed
- `test-week-1-data-integrity.ts` — 8/8 passed
- `test-nflverse-ingestion.ts` — 11/11 passed
- `test-backtest-fixtures.ts` — 22/22 passed
- `test-backtest-tracking.ts` — 38/38 passed
- `test-synthetic-model.ts` — 22/22 passed
- `run-backtest-2025.ts --fixtures` — 7 qualified, 85.7% hit,
  +63.6% ROI, +4.45 units (unchanged)
- `tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — 63 static pages, deployment manifest written

## What is still missing

1. `data/processed/odds/2025/week-1-prop-markets.csv` — produced
   by the paid Odds API ingestion. Requires
   `ALLOW_REAL_ODDS_API_CALLS=true` AND `--execute` — **not**
   set. Not run this pass.

That's the only gap.

## Confirmed by this pass

- **No paid APIs were called.** ALLOW_REAL_ODDS_API_CALLS is
  unset; the Odds API client refuses real calls without both
  the env flag and `--execute`.
- **No `--execute` was used** anywhere.
- **No Kalshi connection.**
- **No touchdown propTypes were admitted.** The CSV parser
  strips TD columns at parse time; the normalizer's output
  writer doesn't include any TD-bearing column.
- **No automated betting paths exist.** The
  `test-real-week-1-readiness.ts` grep-asserts no `placeBet`,
  `placeWager`, `kalshi.+place`, `fetch(`, or `the-odds-api`
  patterns in the production readiness module.
- **Stored mode does not fall back to synthetic data** — the
  runner exits cleanly with a missing-data status instead.
- **The schedule validator and leakage guard remain active.**
- **Model logic untouched.** The change is purely in the
  ingestion layer (URLs + actual network fetch + gameId
  canonicalization).
- **Default V1 fixture backtest output is unchanged** (7
  qualified, 85.7% hit, +63.6% ROI, +4.45 units).

## Exact next command

The remaining gap is the paid Odds API ingestion. It is
**still gated** behind explicit user permission:

```bash
# 1. Verify credit cost first (paid, minimal).
ALLOW_REAL_ODDS_API_CALLS=true \
  npx tsx scripts/ingest-historical-prop-lines.ts \
  --scope smoke-test --execute

# 2. Actual Week 1 pull (paid).
ALLOW_REAL_ODDS_API_CALLS=true \
  npx tsx scripts/ingest-historical-prop-lines.ts \
  --season 2025 --scope week --week 1 --execute

# 3. Re-run the readiness check + stored-mode pregame.
npx tsx scripts/check-real-week-1-readiness.ts
npx tsx scripts/run-week-1-starter-test.ts \
  --phase full --data-mode stored --season 2025 --week 1
```

After step 2 produces
`data/processed/odds/2025/week-1-prop-markets.csv`, the
readiness check will flip to `READY` and the page's red
synthetic-fixture banner will disappear.

## Standing rule

**Do not judge model performance until
`realWeek1BacktestReady === true`.** The current Week 1
fixture-mode output is a pipeline-mechanics test only.
