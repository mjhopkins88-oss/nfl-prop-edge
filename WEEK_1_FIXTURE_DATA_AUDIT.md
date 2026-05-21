# Week 1 Fixture Data Audit

The Week 1 starter test page (`/backtest/week-1`) was rendering
two same-game stacks — KC @ BAL and BUF @ MIA — and treating them
as a 2025 Week 1 sample. Neither matchup was a 2025 Week 1 game.
This audit documents the source, the fix, and how the page now
flags synthetic data.

## Source of each incorrect matchup

| Game ID | Where it lives | Real or synthetic? | Allowed to be called "2025 Week 1"? |
|---|---|---|---|
| `fixture-kc-at-bal-w1` | `data/fixtures/backtest/week-1/games.fixture.json` line 2 | **Synthetic placeholder** — hand-written during the Week 1 page build to give the runner something to chew on. | **No.** KC did not play BAL in Week 1 2025 (KC played LAC; BAL played BUF). |
| `fixture-buf-at-mia-w1` | `data/fixtures/backtest/week-1/games.fixture.json` line 12 | **Synthetic placeholder.** | **No.** BUF hosted BAL in Week 1 2025 (Baltimore @ Buffalo, SNF). MIA's Week 1 opponent was IND. |

The two synthetic matchups propagated into every downstream
file:

- `data/fixtures/backtest/week-1/prop-markets.fixture.json` (8
  prop markets all point at one of the two fake gameIds).
- `data/fixtures/backtest/week-1/prop-quotes.fixture.json`
  mirrors them.
- `data/backtests/2025/week-1-pregame.fixture.json` and every
  other generated `week-1-*.fixture.json` carries the
  synthetic teams through to the page.

## Was schedule validation in place?

No. The runner accepted whatever was in
`data/fixtures/backtest/week-1/games.fixture.json` without
cross-checking against an authoritative schedule. The
`week-1-data-audit.fixture.json` recorded what was used but
never asked whether it was *correct*.

## What changed

- **`data/fixtures/nfl/2025-week-1-schedule.fixture.json`**
  (new) — the actual 2025 Week 1 schedule (16 games). Schedule
  only — no scores, no winners, just matchups + kickoff times
  + venues + a `sourceNote` per row.
- **`src/lib/backtest/week-1-schedule-validation.ts`** (new) —
  `getExpectedWeek1Schedule()`,
  `validateWeek1FixtureSchedule()`,
  `validateCandidateGamesAgainstSchedule()`,
  `buildWeek1ScheduleValidationReport()`. Status enum:
  `PASS` / `FAIL` / `SYNTHETIC_ONLY`. Used by the runner +
  the Week 1 page + the test runner.
- **`scripts/run-week-1-starter-test.ts`** — before writing
  locked recommendations, loads the expected schedule, runs
  validation, writes
  `data/backtests/2025/week-1-schedule-validation.fixture.json`,
  and propagates the result into the locked recommendations
  block as `scheduleValidationStatus`, `scheduleSource`,
  `syntheticFixture`, and `realWeek1BacktestReady`.
- **`src/app/backtest/week-1/page.tsx`** — new
  "Schedule Validation" panel reports the status, expected
  game count, candidate game count, invalid games, and the
  "Real Week 1 odds not loaded yet / Real 2025 schedule
  validation required" hint. When validation fails, a banner
  at the top of the page declares the run a
  **Synthetic Week 1 Fixture — Schedule does not match real
  2025 Week 1**.
- **`scripts/test-week-1-schedule-validation.ts`** (new) —
  10 assertions, including: KC vs BAL invalid for 2025 W1,
  BUF vs MIA invalid for 2025 W1, KC @ LAC valid, BAL @ BUF
  valid, schedule fixture carries no scores, no touchdown
  propTypes, no real API calls.
- **`scripts/test-week-1-data-integrity.ts`** — extended with
  a "candidates either pass schedule validation or are
  labeled synthetic" check.

## What this run is, today

A **synthetic-fixture pipeline test.** The runner produces
output the page can render, but the page now states clearly:

> Synthetic Week 1 Fixture — Schedule does not match real
> 2025 Week 1. These are test fixtures for pipeline validation
> only. They are not real 2025 Week 1 plays.

`realWeek1BacktestReady` is **false** in the locked
recommendations.

## What's still needed for a real Week 1 backtest

1. A processed prop-markets file populated from stored
   historical Odds API quotes that point at the real 2025
   Week 1 game IDs (not synthetic ones).
2. Player-week stats keyed to the real Week 1 matchups —
   `data/processed/nfl/player_week_stats.csv` with
   `season=2025, week=1` rows for the players we book.
3. A small change to `data-loader.ts` so the runner reads
   from `data/processed/*` first and falls back to
   `data/fixtures/*` only when processed data is absent. The
   scaffold exists (`loadProcessedBacktestData` throws today);
   wire it once the ingestion pipeline has been exercised.
4. Schedule validation already implemented — once the
   processed candidates point at real Week 1 gameIds, the
   validator will return `PASS` and `realWeek1BacktestReady`
   will flip to `true`.

The discipline is: **fixture data tests pipeline mechanics,
not model performance.** Real Week 1 numbers are off-limits
until #1–#3 above land.
