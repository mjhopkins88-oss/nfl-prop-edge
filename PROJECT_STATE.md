# Project State — NFL Prop Edge

Snapshot as of branch `claude/review-project-state-OF2y7` @ `20f80a5`.

## 1. Current product goal

A player-prop opportunity finder for the NFL. The app:

- Projects player stats with a transparent model.
- Compares the model's no-vig probability to each sportsbook price.
- Surfaces a recommendation (`OVER` / `UNDER` / `PASS`) with a full
  decision scorecard — every prop comes with explicit pass reasons,
  fail reasons, risk-gate scores, and a one-sentence explanation.

V1 ships with mock data so the modeling story and UX can be validated
before any real odds / projection feeds are wired in.

## 2. V1 scope

Lower-variance volume markets only:

- `PASSING_ATTEMPTS`
- `PASSING_COMPLETIONS`
- `PASSING_YARDS`
- `RECEPTIONS`
- `RECEIVING_YARDS`
- `RUSHING_ATTEMPTS`
- `RUSHING_YARDS`

Two pages currently shipping:

- `/` — dashboard. Filterable, sortable list of every opportunity, each
  rendered as a scorecard card.
- `/props/[id]` — full prop detail page with the model decision
  scorecard panel, recent game logs, line shopping, matchup notes.

A third page (`/backtest`) renders a mock backtest summary; the
real backtest runner is wired up but not yet producing output here.

## 3. Explicit exclusions

- **No touchdown props** in V1 (anytime scorer, first TD scorer,
  rush/rec/pass TD overs). The model is not calibrated for low-base-
  rate Bernoulli markets and the ingestion path drops TD columns.
- **No live odds / no paid API calls** from the running app.
- **No Railway dependency** for local algorithm work. Railway deploy
  config (`railway.json`) exists but is unused for day-to-day model
  iteration.
- **No real money interface.** No bet placement, no bankroll
  management, no account system.

## 4. Current architecture

Stack: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind +
Prisma 5 + Postgres. Deploy target: Railway (optional).

```
src/
  app/
    page.tsx                # Dashboard (server component, URL-driven filters)
    props/[id]/page.tsx     # Prop detail page with scorecard panel
    backtest/page.tsx       # Mock backtest summary
    layout.tsx              # Header + footer + theme
    globals.css

  components/
    OpportunityCard.tsx     # Scorecard-driven prop card (dashboard)
    OpportunityList.tsx     # Card list wrapper
    ScorecardBadges.tsx     # Qualified / Edge Below Threshold / Role Risk / etc.
    ScorecardDetailPanel.tsx# Full scorecard section for detail page
    PropCard.tsx            # Legacy feature-framework card (unused by current pages)
    PropFilters.tsx         # Filter chips (writes to URL)
    StatCard.tsx, Header.tsx, TeamBadge.tsx,
    EdgeBadge.tsx, RecommendationPill.tsx, ConfidenceMeter.tsx,
    DashboardSidebar.tsx, icons.tsx

  lib/
    types.ts                # Domain types (Team, Player, Game, PropMarket, PropDetail, …)
    prop-utils.ts           # Label, format, odds-math helpers
    mock-data.ts            # All V1 data: teams, players, games, props, logs, alt lines
    prisma.ts               # Prisma singleton

    model/                  # Two model systems coexist (see §5)
      model-scorecard.ts        # Scorecard engine — drives the UI
      prop-opportunity.ts       # Data accessor: PropOpportunity (prop + scorecard)
      risk-inputs.ts            # Per-prop risk-input mock + defaults
      feature-framework.ts      # Feature-framework engine
      feature-scoring.ts        # Feature gate qualifier
      prop-projection-engine.ts # Projection from raw inputs
      prop-projection-rules.ts  # Per-prop-type projection rules
      synthetic-scenarios.ts    # 23 hand-tuned scenarios for the feature engine
      validation.ts             # Cross-engine sanity checks

    data/                   # Feature-framework data accessors
      props.ts, types.ts, games.ts, players.ts, backtest.ts

    backtest/               # Backtest engine modules
      feature-builder.ts, grading.ts, metrics.ts,
      probability-engine.ts, projection-engine.ts

    ingestion/              # External-API client scaffolds (dry-run by default)
      odds-api.ts           # The Odds API client (paid)
      kalshi.ts             # Kalshi event-contracts client
      weather.ts            # Open-Meteo (free)
      injuries.ts           # Injury report ingestion
      cache.ts, credit-estimator.ts

prisma/
  schema.prisma             # Postgres schema (17 models / 5 enums — see §7)
  seed.ts                   # Loads mock-data into Postgres

scripts/
  test-synthetic-model.ts   # Scorecard runner — 20 scenarios, all green
  run-backtest-2025.ts      # 2025 backtest runner against stored data
  ingest-historical-prop-lines.ts  # Odds API historical (dry-run default)
  ingest-kalshi-markets.ts         # Kalshi (dry-run default)
  ingest-weather-history.ts        # Open-Meteo (dry-run default)
  ingest-injury-flags.ts           # Injury CSV ingest
  ingest-nfl-history.py            # nflverse stats (Python stub)
  requirements.txt, README.md

data/                       # Ingestion output land — empty except manual CSVs
  raw/, processed/, backtests/, cache/, manual/
```

## 5. Current model / scorecard status

**Two model systems live in `src/lib/model/` after the recent merge:**

1. **Scorecard engine** (`model-scorecard.ts`) — drives every page in
   the app today.
   - Inputs: market line, odds, projected mean / σ, eight risk scores
     (data quality, role stability, game script, pace, market context,
     weather, injury, correlation).
   - Outputs: model probabilities, no-vig market probabilities, edge
     over/under, selected side, recommendation, qualified flag, gate
     breakdown, pass/fail/disqualifier lists, final one-sentence
     explanation.
   - Helpers: `buildPropDecisionScorecard`, `summarizeScorecardForUI`,
     `getPrimaryDisqualifier`, `getTopReasons`, `getTopRisks`.
   - Edge threshold: `0.04`. Risk gates per dimension are encoded in
     the engine.

2. **Feature-framework engine** (`feature-framework.ts` +
   `feature-scoring.ts` + `prop-projection-engine.ts`) — richer
   feature scoring + projection pipeline; powers `mock-data.ts`'s
   per-prop enrichment and the `/backtest` page summary.
   - Not currently displayed in the dashboard / detail UI.
   - Has its own 23-scenario set in `synthetic-scenarios.ts`.

The scorecard system is the **decision authority for the UI**. The
feature-framework system is reference / backtest infrastructure.
Future work should pick one or define a clean handoff.

## 6. Current synthetic test status

`scripts/test-synthetic-model.ts`:

- 20 hand-tuned scenarios covering every V1 prop type and every gate
  failure mode (clean qualifying OVER/UNDER, edge-below-threshold,
  role / injury / weather / correlation / data-quality / game-script /
  pace / market-context blockers, volatility checks).
- Runs the full scorecard pipeline and asserts on
  `(qualified, recommendation, primaryDisqualifier-substring)`.
- TTY-aware ANSI color output, non-zero exit on any failure.
- **20 / 20 scenarios pass** as of `20f80a5`.

`synthetic-scenarios.ts` carries a separate 23-scenario set for the
feature-framework engine; that one is not exercised by the current
test runner.

## 7. Current schema / data status

Prisma models (`prisma/schema.prisma`):

```
Team, Player, Game, GameLog
PropMarket, PropQuote, Projection
ModelRun, PropPrediction
BetCandidate, BacktestResult
ApiUsageLog
```

Enums: `Position`, `PropType` (7 lower-variance markets, no TDs),
`Recommendation`, `ModelRunType`, `BetResult`.

`prisma/seed.ts` loads mock data plus a sample `ModelRun`,
`PropQuote`, `Projection`, and `BacktestResult` row so the schema is
exercised end-to-end against a real DB.

Mock data layer (`src/lib/mock-data.ts`):

- 25 props across 5 games (Week 11 / 2025).
- 24 players with 5-game logs.
- Every prop is enriched at module-load time with feature-framework
  outputs (reasons, risks, featureSet, dataQualityScore, riskScore).
- The dashboard then re-derives its decision through the scorecard
  engine — the scorecard is the single source of truth for the UI.

Manual data files (committed):

- `data/manual/injury_flags.csv`
- `data/manual/stadiums.csv`

All `data/raw|processed|backtests|cache/` directories exist but are
empty pending real ingestion runs.

## 8. Current UI status

Dashboard (`/`):

- Hero stats: tracked markets, positive edges, avg qualified edge,
  top edge.
- Filter chips: prop type, position, side, sort (edge / confidence /
  player).
- One `OpportunityCard` per prop showing recommendation, qualified /
  not-qualified status, model probability, no-vig market probability,
  edge vs threshold, confidence meter, top 2 reasons, top 2 risks,
  final explanation, and badge strip (Qualified / Edge Below
  Threshold / Role Risk / Injury Risk / Weather Risk / Correlation
  Risk / Low Data Quality).
- Today: 19 qualified plays + 6 PASS demos (2 thin-edge, 4 gate-
  blocked — one for each of injury, correlation, weather, market
  context).

Prop detail (`/props/[id]`):

- Hero header with team / matchup / line / recommendation pill / edge
  badge / confidence meter.
- 4-metric strip (market line, projection, model hit rate, selected
  side edge).
- Full `ScorecardDetailPanel`: probability + edge grid (model O/U,
  no-vig O/U, edge O/U, selected edge, threshold), projection grid,
  8 risk-score rows with gate markers and OK / WARN / FAIL pills,
  pass / fail / disqualifier lists, final explanation card, badge
  strip.
- Recent game log table with distribution bars.
- Line shopping table.
- Matchup notes.

Backtest (`/backtest`):

- Renders a mock summary from `getBacktestSummary()` (currently
  static). Not yet wired to real backtest output.

Visual style: light glassmorphism, dark `ink` palette + `amber` /
`coral` / `sea` accent tones; design tokens defined in
`tailwind.config.ts` and used across components.

## 9. Current backtest / API status

**Backtest runner** (`scripts/run-backtest-2025.ts`):

- Builds features from stored historical data, runs the projection
  engine, grades plays, writes a `BacktestResult` row.
- Designed to read from Postgres only — it does not call paid APIs
  directly. Ingestion happens out-of-band into the DB.
- Not yet executed against a real seeded historical dataset.

**Ingestion scaffolds** (`src/lib/ingestion/` + `scripts/ingest-*`):

- `odds-api.ts` — paid. Real calls are gated by
  `ALLOW_REAL_ODDS_API_CALLS=true` and a credit estimator. Default
  mode is dry-run.
- `kalshi.ts` — `KALSHI_API_KEY` + environment selector; demo env by
  default.
- `weather.ts` — free (Open-Meteo); still dry-run by default.
- `injuries.ts` — reads `data/manual/injury_flags.csv`; no external
  call.
- `ingest-nfl-history.py` — nflverse scaffold; writes empty schema-
  only CSVs unless the `nflreadpy` / `nfl_data_py` wrappers are
  uncommented. No API key required.

`src/config/api-budget.ts` defines monthly call ceilings; the credit
estimator inspects each batch before any network call. The running
app does **not** make any external calls.

## 10. Next recommended steps

See `NEXT_STEPS.md` for the prioritized punch list (top 5).

In broad strokes:

1. Reconcile the two model systems so the scorecard is the only
   decision authority and the feature-framework feeds it (or remove
   the unused half).
2. Wire `/backtest` to consume real `BacktestResult` rows produced by
   the backtest runner against seeded historical data.
3. Stand up a one-week historical seed (Odds API + nflverse) end-to-
   end with the dry-run / credit-budget guardrails actually
   exercised.
4. Replace `mock-data.ts` reads in the pages with Prisma queries once
   the DB has real data.
5. Add unit tests for the scorecard engine's branch coverage (gate
   selection, primary-disqualifier ordering, no-vig math).
