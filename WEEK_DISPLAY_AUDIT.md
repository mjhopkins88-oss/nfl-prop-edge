# Week Display Audit

Snapshot of where the deployed site picks up "Week 11 · 2025"
and the fixes applied to make Week 1 the headline view.

## Where Week 11 came from

Two hard-coded labels + one mock dataset:

| Source | Line | What it shows | Fix |
|---|---|---|---|
| `src/components/Header.tsx` | 54 | `Week 11 · 2025` chip in the top-right | Use centralized app context (`getWeekLabel`). Defaults to **Week 1 · 2025**. |
| `src/app/page.tsx` (hero) | 188 | `Week 11 · 2025 · Lower-variance markets` chip above the headline | Drives off the same context. Renders **Demo Week 11 · 2025** with a clear "Demo data" banner + CTA to `/backtest/week-1` when the home page is in demo mode. |
| `src/lib/mock-data.ts` | 134–185 | 5 mock games all stamped `season: 2025, week: 11` — KC@BUF, SF@SEA, PHI@DAL, CIN@BAL, DET@MIN. Players are real-name placeholders (Mahomes, Allen, Lamb, Hurts, Goff, etc.). | **Kept** — this is the legacy demo dataset. Now explicitly labeled as DEMO via the app context. Not used by `/backtest/week-1`, `/monitor`, `/parlays`, or `/game-edge`. |

The Header hard-code was the single most visible source of the
problem. The homepage hero hard-code compounded it. Together they
made the whole site look like it was running on Week 11 even
though the Week 1 starter-test data was already wired up under
`/backtest/week-1` and `/monitor`.

## Where Week 1 data already lives

| Path | Purpose |
|---|---|
| `data/fixtures/backtest/week-1/*.fixture.json` | Dedicated Week-1 fixture set (2 games — KC@BAL, BUF@MIA — 8 prop markets, prior-season + Week-1 player stats, weather, injuries). |
| `data/backtests/2025/week-1-pregame.fixture.json` | Pregame snapshot — outcomes stripped. Written by `scripts/run-week-1-starter-test.ts`. |
| `data/backtests/2025/week-1-results.fixture.json` | Graded results — outcomes present. |
| `data/backtests/2025/week-1-v1-v2-comparison.fixture.json` | V1 vs V2 comparison. |
| `data/backtests/2025/week-1-parlay-preview.fixture.json` | Parlay candidates for Week 1. |
| `data/backtests/2025/week-1-game-edge-preview.fixture.json` | Game Edge candidates for Week 1. |
| `src/lib/backtest/week-simulation.ts` | Orchestrator — strips outcomes for pregame, grades against actuals only in the simulation path. |
| `src/lib/backtest/week-1-summary.ts` | Server-side loaders for the JSON outputs. |
| `src/app/backtest/week-1/page.tsx` | Week 1 starter test page. |

## What was happening before the fix

- `/` rendered Week 11 mock data with a `Week 11 · 2025` chip.
- The Header showed `Week 11 · 2025` everywhere — including on
  `/backtest/week-1` and `/monitor`. Confusing.
- `/backtest/week-1` and `/monitor` already read Week 1 fixtures
  correctly; their *page bodies* were fine. The Header chip just
  contradicted them.

## What changed

- **`src/lib/app-context.ts`** (new) — single source of truth.
  - `DEFAULT_SEASON = 2025`, `DEFAULT_DISPLAY_WEEK = 1`,
    `DEMO_WEEK = 11`, `WEEK_1_STARTER_TEST_ENABLED = true`.
  - `AppDataMode = "DEMO" | "WEEK_1_STARTER_TEST" | "BACKTEST" | "STORED_REAL_DATA"`.
  - `AppSeasonWeekContext` carries season / week / dataMode /
    label.
  - Helpers: `getDefaultAppContext()`, `getDemoAppContext()`,
    `getWeekLabel(context)`,
    `assertValidSeasonWeekContext(context)`.
- **`src/components/Header.tsx`** — chip text now comes from
  `getDefaultAppContext()` (`Week 1 · 2025`). No more hard-code.
- **`src/app/page.tsx`** — hero chip says `Demo · Week 11 · 2025`
  (since the dashboard reads `mockData` for Week 11); adds a
  prominent banner at the top of the page with a CTA to
  `/backtest/week-1`. Anyone landing on `/` understands they're
  on the demo, and one click takes them to the starter test.
- **`/backtest/week-1`, `/monitor`** — unchanged in their page
  bodies. The Header chip now agrees with what they were already
  saying.

## Issue classification

This was **not** a stale deployment: `origin/main` was at the
latest commit `6fec0d3`. It was **not** a routing problem: the
Week 1 page and the Monitor were already wired to Week 1
fixtures. It was a **hard-coded display label** problem in two
files (`Header.tsx` and `page.tsx`) plus the residual confusion
from the legacy Week-11 mock dataset.

The Week-11 mock data itself is fine to keep as a demo — it just
needs to look like a demo, not the headline state.

## Verification

- New `scripts/test-week-display-routing.ts` asserts the Header
  source does not hard-code "Week 11 · 2025" and that the
  context defaults are correct.
- New `scripts/test-week-1-data-integrity.ts` asserts the Week 1
  pregame snapshot only contains `season === 2025, week === 1`
  candidates, no Week-11 player names, no touchdown propTypes,
  and no actual results in the pregame snapshot.
- All existing tests continue to pass. Default V1 fixture
  backtest is unchanged at 7 qualified / 85.7% / +63.6% ROI.

## Game Edge fixture data

`src/lib/model/game-edge-data.ts` contains entries with
`week: 11`, `week: 12`, etc. These are **intentional** —
Game Edge fixtures cover a mid-season slate as their working
example. The page that displays them (`/game-edge`) labels
each card with its own week, and the Game Edge model is
separate from the player prop dashboard. No change.
