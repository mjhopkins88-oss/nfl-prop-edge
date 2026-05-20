# Next Steps — NFL Prop Edge

Prioritized punch list. Top 5 development tasks given the current
state described in `PROJECT_STATE.md`. Read `CLAUDE.md` before
starting any of these.

## 1. Reconcile the two model systems

**Why:** Two engines currently live in `src/lib/model/` — the
scorecard engine (drives the UI) and the feature-framework engine
(enriches mock data + powers the placeholder `/backtest` page). They
overlap in scope and risk drifting apart.

**Concretely:**
- Decide whether the feature-framework feeds the scorecard (its
  feature scores become the scorecard's 8 risk inputs) or whether
  one engine is retired.
- Document the decision in `PROJECT_STATE.md` §5.
- If feeding: add a thin adapter in `prop-opportunity.ts` that calls
  the feature engine, maps its outputs into `ScorecardInput`, then
  calls `buildPropDecisionScorecard`. Delete the per-prop risk
  overrides in `risk-inputs.ts` once they're redundant.
- If retiring half: delete the unused half and its scenarios.

**Done when:** A single function answers "is this prop a play?" and
every page / script that asks goes through it.

## 2. Wire `/backtest` to real `BacktestResult` rows

**Why:** The page currently renders a hand-written mock summary. The
backtest runner exists (`scripts/run-backtest-2025.ts`) and the
schema has a `BacktestResult` model. The plumbing in between is
missing.

**Concretely:**
- Have `getBacktestSummary()` in `src/lib/data/backtest.ts` read the
  most recent `BacktestResult` row from Postgres (with a clean
  fallback to the mock when no row exists).
- Add a CLI flag to `run-backtest-2025.ts` to write a labeled run
  (`--label "week-11-prerun"`) and surface that label on the page.
- Add breakdown slices the scorecard cares about: primary
  disqualifier, prop type, qualified vs passed, edge bucket, risk
  gate.

**Done when:** Running the backtest script updates the `/backtest`
page on next request.

## 3. Stand up a one-week historical seed end-to-end

**Why:** Every ingestion scaffold is in place but none has produced
real data. Doing one week proves the full pipeline (Odds API →
Postgres → backtest → page) before scaling.

**Concretely:**
- Pick one historical week (e.g. 2024 Week 10) and document it as the
  target.
- Run `ingest-nfl-history.py` with the nflverse wrappers enabled to
  produce real `processed/*.csv` files. Load into Postgres.
- Run `ingest-historical-prop-lines.ts` for that one week against the
  Odds API **only after explicit user approval** and only with the
  credit estimator showing the budget is OK. Confirm `ApiUsageLog`
  rows land in Postgres.
- Run the backtest. Confirm a `BacktestResult` row exists and the
  page reads it.
- Document the exact commands in `scripts/README.md`.

**Done when:** A new repo clone can reproduce one week of real
backtest output by following the README, with the dry-run guardrails
respected.

## 4. Replace `mock-data.ts` reads in pages with Prisma queries

**Why:** Pages still call `getProps()` / `getOpportunityDetail(id)`
which read from in-memory mock data. Once Step 3 lands, the same
shape can come from Postgres.

**Concretely:**
- Add a Prisma-backed implementation of `getOpportunities` /
  `getOpportunityDetail` next to the current mock versions, gated by
  an env var (`USE_DB=true`).
- Keep the mock path working — it's the local-dev fallback and the
  source of the synthetic test fixtures.
- Update `ScorecardInput` assembly so risk inputs come from the new
  feature pipeline (Step 1) rather than the per-prop override map.

**Done when:** Setting `USE_DB=true` makes the dashboard render from
Postgres with no UI regression.

## 5. Add unit tests for the scorecard engine

**Why:** The scorecard is the decision authority for the UI. Today
its coverage is one end-to-end script (`test-synthetic-model.ts`,
20 scenarios). Smaller, faster tests for individual branches would
catch regressions earlier.

**Concretely:**
- Add a unit test harness (Vitest is the lightest fit with the
  existing TS / Tailwind / Next setup; or stick with bare `tsx` if
  preferred).
- Cover, at minimum:
  - No-vig math at -110/-110, juiced lines, and plus-money sides.
  - Edge threshold boundary (exactly at, just below, just above).
  - Primary-disqualifier ordering when multiple gates fail.
  - Volatility classification at the cutoffs.
  - Confidence calculation across high / medium / low buckets.
  - `getTopReasons` / `getTopRisks` ordering and truncation.
- Wire the tests into the same four-check pre-commit ritual.

**Done when:** A reviewer can change `model-scorecard.ts` and see
unit failures in under 5 seconds, separate from the full scenario
run.
