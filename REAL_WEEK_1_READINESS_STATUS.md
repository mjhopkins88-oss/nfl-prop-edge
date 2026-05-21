# Real 2025 Week 1 Readiness Status

Snapshot of where the project stands on moving from synthetic
fixture mode to real stored-data mode for the 2025 Week 1 starter
test. No code logic changed by this audit. No paid APIs called.

## TL;DR

`/backtest/week-1` is still in **synthetic fixture mode** because
both real data sources are missing:

| Required input | Path | Present? |
|---|---|---|
| Stored Odds API quotes for Week 1 | `data/processed/odds/2025/week-1-prop-markets.csv` | **No** |
| Stored Odds API quotes (alt layout) | `data/processed/prop_markets.csv` | yes (legacy / wrong week) |
| Processed nflverse player history | `data/processed/nfl/player_week_stats.csv` | **No** |
| Processed nflverse team history | `data/processed/nfl/team_week_stats.csv` | **No** |
| Processed nflverse games | `data/processed/nfl/games.csv` | **No** |
| Processed nflverse rosters | `data/processed/nfl/rosters.csv` | **No** |
| Real Week 1 schedule fixture | `data/fixtures/nfl/2025-week-1-schedule.fixture.json` | yes |
| Raw nflverse drop-zone | `data/raw/nfl/` | empty (`.gitkeep` only) |

`realWeek1BacktestReady` is `false`. `dataMode` reports
`stored / MISSING_STORED_ODDS` when invoked. The runner refuses
synthetic fallback under `--data-mode stored`, exits cleanly,
and writes the missing-data status file the page reads.

## Verified non-issues

- **Schedule validator is in place** — 16 real Week 1 games
  committed in
  `data/fixtures/nfl/2025-week-1-schedule.fixture.json`.
- **Stored-data loaders work** — `processed-nfl-loader.ts`,
  `stored-odds-loader.ts`, `real-week-candidate-builder.ts`
  return `MISSING_*` statuses without throwing.
- **Synthetic fallback is blocked** — stored mode never reads
  `data/fixtures/backtest/week-1/`, even when both real inputs
  are absent. Verified by re-running
  `npx tsx scripts/run-week-1-starter-test.ts --phase pregame --data-mode stored --season 2025 --week 1`
  with empty `data/processed/`.
- **Leakage guard intact** — pregame writer still strips
  outcomes (`week-1-leakage-check.fixture.json` reports
  `leakageDetected: false`).
- **API credit protection intact** — the Odds API client still
  defaults to dry-run; `--execute` plus
  `ALLOW_REAL_ODDS_API_CALLS=true` are both required for any
  paid call. Neither has been set in this audit.
- **Touchdown propTypes still excluded.** Starter-market filter
  rejects `player_pass_yds`, `player_reception_yds`,
  `player_rush_yds`, and never maps any TD market.

## Stored-mode smoke check

```
$ npx tsx scripts/run-week-1-starter-test.ts \
    --phase pregame --data-mode stored --season 2025 --week 1
stored mode: status=MISSING_STORED_ODDS;
wrote week-1-data-mode-status.fixture.json. No synthetic fallback.
  · No usable stored Odds API rows found for 2025 Week 1.
  · Inspected: data/processed/odds/2025/week-1-prop-markets.csv (missing);
              data/processed/prop_markets.csv (present)
  · Next: run the Odds API ingestion in --execute mode
          (requires ALLOW_REAL_ODDS_API_CALLS=true)
          and re-run with --data-mode stored.
```

Expected outcome — no crash, no synthetic data, exit 0.

## What we have not done (and will not do without explicit approval)

- Set `ALLOW_REAL_ODDS_API_CALLS=true`.
- Run any Odds API ingestion with `--execute`.
- Set `ALLOW_NFLVERSE_NETWORK_FETCH=true`.
- Hit any GitHub release URL.
- Connect to Kalshi.
- Place any wager.

## What we need before stored mode can return READY

In order:

1. Get nflverse stat CSVs into the processed directory.
   Two equivalent paths:
   - **Local path** — drop nflverse CSVs into
     `data/raw/nfl/{season}/{schedules,player_stats,team_stats,rosters,snap_counts}.csv`
     and run
     `npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run`
     to normalize them into `data/processed/nfl/*.csv`.
   - **Network path (opt-in, free)** — set
     `ALLOW_NFLVERSE_NETWORK_FETCH=true` and run
     `npx tsx scripts/ingest-nfl-history.ts --source nflverse --no-dry-run`.
2. Run the Odds API ingestion for Week 1. Always smoke first,
   then the actual pull:
   ```
   npx tsx scripts/ingest-historical-prop-lines.ts \
       --season 2025 --scope smoke-test --source mock --dry-run
   # ↓ explicit user approval required ↓
   ALLOW_REAL_ODDS_API_CALLS=true \
       npx tsx scripts/ingest-historical-prop-lines.ts \
       --season 2025 --scope smoke-test --execute
   ALLOW_REAL_ODDS_API_CALLS=true \
       npx tsx scripts/ingest-historical-prop-lines.ts \
       --season 2025 --scope week --week 1 --execute
   ```
3. Re-run stored mode:
   ```
   npx tsx scripts/run-week-1-starter-test.ts \
       --phase full --data-mode stored --season 2025 --week 1
   ```

When step 3 returns `READY`, the page chip flips to
`stored · READY`, the red synthetic banner disappears, and
`realWeek1BacktestReady` becomes `true`.

## Standing rule on this transition

**Do not judge model performance until
`realWeek1BacktestReady === true`.** The current Week 1
synthetic output (KC@BAL + BUF@MIA placeholders) is a
pipeline-mechanics test only. It must not be cited as evidence
of edge.
