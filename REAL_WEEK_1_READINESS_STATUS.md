# Real 2025 Week 1 Readiness Status

Snapshot from the free / dry-run readiness pass. No paid APIs
called. No `--execute`. No env flags flipped. No code logic
changed.

## TL;DR

`/backtest/week-1` is still **synthetic fixture mode**. Both
required real data sources are missing. Stored mode correctly
refuses synthetic fallback.

| Required input | Path | Present? |
|---|---|---|
| Stored Odds API quotes | `data/processed/odds/2025/week-1-prop-markets.csv` | **No** |
| Processed nflverse player history | `data/processed/nfl/player_week_stats.csv` | **No** |
| Real Week 1 schedule fixture | `data/fixtures/nfl/2025-week-1-schedule.fixture.json` | yes |
| Raw nflverse drop-zone | `data/raw/nfl/` | empty (`.gitkeep` only) |

`realWeek1BacktestReady` is `false`. `dataMode` reports
`stored / MISSING_STORED_ODDS`. The runner exits cleanly without
synthesizing fake data.

## Commands run this pass

All ran cleanly without spending credits or hitting any paid
endpoint:

### `npx tsx scripts/check-real-week-1-readiness.ts`

- `status = NOT_READY`
- `realWeek1BacktestReady = false`
- `syntheticFixture = true`
- `missingStoredOdds = true`
- `missingProcessedNfl = true`
- `storedBuilderStatus = MISSING_STORED_ODDS`
- Missing required files:
  `data/processed/odds/2025/week-1-prop-markets.csv`,
  `data/processed/nfl/player_week_stats.csv`
- Next command: `npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run`
- Next requires paid API: **false**

### `npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run`

- `note: no raw season folders found under data/raw/nfl/. Drop nflverse CSVs there (per --help) and re-run.`
- Normalized: 0 games / 0 player-weeks / 0 team-weeks / 0
  rosters / 0 snap rows.
- Written: nothing — every output file skipped with "(no rows)".
- `data/processed/nfl/` still contains only `.gitkeep`. The
  script never crashed.

### `npx tsx scripts/ingest-historical-prop-lines.ts --season 2025 --scope smoke-test --source mock --dry-run`

- `dryRun=true`, `budget=200`, `source=mock`, exit 0.
- ALLOW_REAL_ODDS_API_CALLS was unset.
- Markets the script declares it pulls (from its `--help`):
  `player_pass_attempts`, `player_pass_completions`,
  `player_receptions`, `player_rush_attempts` — exactly the four
  starter markets. No yardage. No touchdown markets.
- Expected output path on a real run:
  `data/processed/odds/2025/week-1-prop-markets.csv`.
- 0 games were loaded from the mock source (the smoke mock
  doesn't pre-seed 2025 W1 games). No paid call was attempted.

### `npx tsx scripts/run-week-1-starter-test.ts --phase pregame --data-mode stored --season 2025 --week 1`

- `status = MISSING_STORED_ODDS`. No synthetic fallback.
- `realWeek1BacktestReady = false`.
- `syntheticFixture = false` in stored mode (this is correct —
  the run is "missing data", not "using synthetic data").
- `data/backtests/2025/week-1-data-mode-status.fixture.json`
  written with the missing-data status + next-step hints.
- No crash. No API call.

### Tests

- `test-real-week-1-readiness.ts` — 8/8 passed
- `test-real-week-1-data-wiring.ts` — 10/10 passed
- `test-week-1-schedule-validation.ts` — 10/10 passed
- `test-week-1-data-integrity.ts` — 8/8 passed
- `tsc --noEmit` — clean
- `npm run lint` — clean
- `npm run build` — 63 static pages, deployment manifest written

## What is still missing

1. `data/processed/nfl/player_week_stats.csv` — produced by
   nflverse ingestion. The local path needs raw CSVs in
   `data/raw/nfl/<season>/`. The network path needs
   `ALLOW_NFLVERSE_NETWORK_FETCH=true` — **not** set.
2. `data/processed/odds/2025/week-1-prop-markets.csv` — produced
   by the paid Odds API ingestion. Requires
   `ALLOW_REAL_ODDS_API_CALLS=true` AND `--execute` — **not**
   set.

## Confirmed by this pass

- **No paid APIs were called.** ALLOW_REAL_ODDS_API_CALLS is
  unset; the Odds API client refuses real calls without both
  the env flag and `--execute`.
- **No nflverse network fetches were made.**
  ALLOW_NFLVERSE_NETWORK_FETCH is unset.
- **No `--execute` was used** anywhere.
- **No Kalshi connection.**
- **No touchdown propTypes were admitted.** The starter-market
  filter rejects yardage markets and never maps any TD market.
- **No automated betting paths exist.** The
  `test-real-week-1-readiness.ts` grep-asserts no `placeBet`,
  `placeWager`, `kalshi.+place`, `fetch(`, or `the-odds-api`
  patterns in the production readiness module.
- **Stored mode does not fall back to synthetic data** — the
  runner exits cleanly with a missing-data status instead.
- **The schedule validator and leakage guard remain active.**
- **Default V1 fixture backtest output is unchanged** (7
  qualified, 85.7% hit, +63.6% ROI, +4.45 units).

## Exact next command

Two options, in priority order. **Both safe — no paid API
involved.**

### Preferred — get nflverse data first

The local path needs raw CSVs from the nflverse releases. Drop
them into `data/raw/nfl/<season>/` and re-run:

```bash
# Where to drop the files (per `--help`):
#   data/raw/nfl/2025/schedules.csv
#   data/raw/nfl/2025/player_stats.csv
#   data/raw/nfl/2024/player_stats.csv   (history baseline)
#   data/raw/nfl/2024/schedules.csv

npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run
```

### Alternative — opt-in to the free nflverse network fetch

Only if you'd rather pull from GitHub directly:

```bash
ALLOW_NFLVERSE_NETWORK_FETCH=true \
  npx tsx scripts/ingest-nfl-history.ts --source nflverse --no-dry-run
```

This is **free**, but does talk to GitHub; it's gated behind
the env flag for CI predictability.

After either of the above produces
`data/processed/nfl/player_week_stats.csv`, re-run the
readiness check. The next-command line will then point at the
paid Odds API step — which still requires your explicit approval
before anything is spent.

## Standing rule

**Do not judge model performance until
`realWeek1BacktestReady === true`.** The current Week 1
fixture-mode output is a pipeline-mechanics test only.
