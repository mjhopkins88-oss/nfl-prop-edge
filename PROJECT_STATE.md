# Project State — NFL Prop Edge

Snapshot as of branch `claude/review-project-state-OF2y7`.

## 1. Current product shape

The app ships with **two independent decision tracks**. They share
the same Next.js shell, header, and theme, but neither feeds into
the other.

### 1.1 Player Props (`/`, `/props/[id]`)

The original lower-variance prop opportunity finder.

- Restricted to the 7 V1 markets only (no touchdown props).
- Decision authority is the **scorecard model**
  (`src/lib/model/model-scorecard.ts`) via
  `src/lib/model/prop-opportunity.ts`. Every prop renders a full
  decision scorecard — pass reasons, fail reasons, risk-gate
  scores, primary disqualifier, one-sentence explanation.
- Backtesting foundation lives under `src/lib/backtest/` and
  `scripts/run-backtest-2025.ts`; reads stored data only.
- See §3 for the full Player Props stack.

### 1.2 Game Edge (`/game-edge`, `/game-edge/[id]`)

Separate experimental model for game-level markets.

- Evaluates **moneyline + spread + upset score** for each game.
- Treats market win probability as the baseline, applies capped
  football-context adjustments around it (no proxy-only runaway).
- **Does not affect player prop logic.** Game Edge has its own
  types, its own scorecard, its own UI surface. Player prop
  recommendations are unchanged whether Game Edge is consumed or
  not.
- **Upset score is descriptive (0–100), not prescriptive.** A
  high upset score never forces a bet. The only way the model
  recommends a play is if the confidence-adjusted edge clears its
  threshold.
- **Moneyline and spread are evaluated independently.** The
  spread path can recommend a play while the moneyline path
  passes (and vice versa); the highest confidence-adjusted edge
  wins between the two.
- See §4 for the full Game Edge stack.

## 2. V1 player prop scope

Lower-variance volume markets only:

- `PASSING_ATTEMPTS`
- `PASSING_COMPLETIONS`
- `PASSING_YARDS`
- `RECEPTIONS`
- `RECEIVING_YARDS`
- `RUSHING_ATTEMPTS`
- `RUSHING_YARDS`

Explicit exclusions:

- **No touchdown props** in V1 (anytime scorer, first TD scorer,
  rush/rec/pass TD overs). The model is not calibrated for low-
  base-rate Bernoulli markets and the ingestion path drops TD
  columns.
- **No live odds / no paid API calls** from the running app.
- **No Railway dependency** for local algorithm work. Railway
  deploy config (`railway.json`) exists but is unused for
  day-to-day model iteration.
- **No real money interface.** No bet placement, no bankroll
  management, no account system, no automated betting.

## 3. Player Props — architecture and status

Stack: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind
+ Prisma 5 + Postgres. Deploy target: Railway (optional).

### 3.1 Routes and components

```
src/
  app/
    page.tsx                # Dashboard (server, URL-driven filters)
    props/[id]/page.tsx     # Prop detail page with scorecard panel
    backtest/page.tsx       # Backtest performance dashboard
    layout.tsx              # Header + footer + theme
    globals.css

  components/
    OpportunityCard.tsx     # Scorecard-driven prop card (dashboard)
    OpportunityList.tsx     # Card list wrapper
    ScorecardBadges.tsx     # Qualified / Edge Below Threshold / etc.
    ScorecardDetailPanel.tsx# Full scorecard section for detail page
    MatchupIntelligencePanel.tsx
    PropCard.tsx, PropFilters.tsx, StatCard.tsx, Header.tsx,
    TeamBadge.tsx, EdgeBadge.tsx, RecommendationPill.tsx,
    ConfidenceMeter.tsx, DashboardSidebar.tsx, icons.tsx
```

### 3.2 Model layers (player prop only)

All under `src/lib/model/`:

- `model-scorecard.ts` — scorecard engine (decision authority).
- `prop-opportunity.ts` — UI data accessor: prop + scorecard.
- `risk-inputs.ts` — per-prop risk-input mock + defaults.
- `feature-framework.ts` + `feature-scoring.ts` — feature gate
  engine that enriches mock data.
- `prop-projection-engine.ts` + `prop-projection-rules.ts` —
  projection pipeline.
- `coaching-transition.ts` (+ types + data) — coaching-uncertainty
  framework (threshold bump + confidence drag).
- `matchup-intelligence.ts` (+ types + data) — capped σ widening
  and reasons/risks; mean multiplier is reported but not applied.
- `proxy-football-features.ts` (+ types + calibration) — 12
  confidence-scored football proxies.
- `market-anchored-probability.ts` — market-baseline +
  confidence-adjusted-edge primitives. Consumed by the Game
  Edge model; provided to the prop scorecard as passthrough
  metadata.
- `synthetic-scenarios.ts` — historical 23-scenario set for the
  feature engine (not exercised by the current synthetic runner).
- `validation.ts` — cross-engine sanity checks.

### 3.3 v2 algorithm pipeline (opt-in)

After the audit in `PLAYER_PROP_ALGO_AUDIT.md`, an opt-in v2
pipeline was added alongside the scorecard:

- `prop-model-config.ts`, `role-change-detector.ts`,
  `line-sensitivity.ts`, `confidence-adjusted-edge.ts`,
  `market-disagreement.ts`, `signal-deduplication.ts`,
  `prop-qualification.ts`, `player-prop-pipeline.ts`.

The v2 pipeline is consumed by `scripts/test-player-prop-algo-audit.ts`
and is available for future backtest integration. **It does not
replace the scorecard**; the dashboard still routes through
`buildPropDecisionScorecard`. Backtesting will decide which v2
thresholds graduate into the dashboard's decision path.

### 3.4 Backtest engine (player prop only)

Under `src/lib/backtest/`:

- `runner.ts`, `data-loader.ts`, `feature-builder.ts`,
  `grading.ts`, `metrics.ts`, `reporting.ts`,
  `market-adapter.ts`, `projection-adapter.ts`,
  `postmortem.ts`, `line-buckets.ts`, `fixture-summary.ts`,
  `fixture-proxy-summary.ts`, `proxy-validation.ts`, `types.ts`.

`scripts/run-backtest-2025.ts` builds features from stored
historical data, runs the projection engine, grades plays, and
writes summary + per-result outputs. It does **not** call paid
APIs.

### 3.5 Player prop test status

- `scripts/test-synthetic-model.ts` — 22 / 22 scorecard scenarios
  passing.
- `scripts/test-coaching-transition-model.ts` — 68 / 68.
- `scripts/test-matchup-intelligence-model.ts` — 78 / 78.
- `scripts/test-proxy-football-features.ts` — 59 / 59.
- `scripts/test-proxy-football-calibration.ts` — 147 / 147.
- `scripts/test-proxy-validation.ts` — 127 / 127.
- `scripts/test-market-anchored-probability.ts` — 101 / 101.
- `scripts/test-backtest-fixtures.ts` — 22 / 22.
- `scripts/test-backtest-tracking.ts` — 38 / 38.
- `scripts/test-player-prop-algo-audit.ts` — 22 / 22 (v2 pipeline).
- `scripts/run-backtest-2025.ts --fixtures` — produces summary +
  results CSV.

## 4. Game Edge — architecture and status

A separate experimental model. Lives entirely under its own
files; never crosses into player prop logic.

### 4.1 Routes and components

```
src/
  app/
    game-edge/
      page.tsx              # Game Edge dashboard (filter tabs)
      [id]/page.tsx         # Per-game detail page
```

The header (`src/components/Header.tsx`) adds a "Game Edge" nav
item alongside "Opportunities" and "Backtest".

### 4.2 Model layers

All under `src/lib/model/`:

- `game-edge-types.ts` — `GameEdgeInput`, `GameEdgeOutput`,
  `GameEdgeScorecard`, recommendation / market / side enums.
- `game-edge-model.ts` — `buildGameEdge(input)`. Reuses
  `buildMarketAnchoredProbability` for moneyline cap discipline.
  Evaluates moneyline and spread independently, computes upset
  score (0–100, descriptive only), handles key-number spread
  fragility (2.5, 3, 3.5, 6.5, 7, 7.5, 9.5, 10, 10.5, 13.5, 14,
  14.5), and applies hard PASS gates when data quality or
  composite risk drops below 0.45.
- `game-edge-scorecard.ts` — display helpers (label color
  classes, side-to-team, format helpers).
- `game-edge-data.ts` — 12 hand-tuned fixtures, one per
  recommendation path (Strong ML Value / Playable ML Value /
  Upset Watch / Spread Value / Cover Watch / Pass / No Edge /
  Pass / Too Much Uncertainty).

### 4.3 Recommendation labels

- `Strong ML Value` (≥ 8pp confidence-adjusted ML edge)
- `Playable ML Value`
- `Upset Watch` (upset score ≥ 55 but no price clears threshold)
- `Spread Value`
- `Cover Watch` (positive spread edge below threshold)
- `Pass / No Edge`
- `Pass / Too Much Uncertainty` (DQ < 0.45 or risk < 0.45)

### 4.4 Discipline guarantees

- Moneyline and spread are evaluated as independent candidates;
  the highest confidence-adjusted edge wins between them.
- The upset score is descriptive — a high score never forces a
  bet. It can drive an `Upset Watch` label only when no price
  clears the edge gate.
- Edge gates: ML favorite 3pp, ML underdog 5pp, ML longshot
  (<30%) 7pp, spread 4pp (6pp when uncertainty elevated). All
  thresholds are hypotheses to be refined by backtesting.

### 4.5 Test status

- `scripts/test-game-edge-model.ts` — 12 / 12 scenarios. Asserts
  universal invariants: no forced recommendations, ML / spread
  evaluated independently, confidence-adjusted edge gates plays,
  PASS labels on high uncertainty, upset score is descriptive.

### 4.6 No backtest yet

The Game Edge model has no historical backtest. **Do not use for
real bets until the model is validated against historical game
data** — and even then, this remains a research project, not
investment advice.

## 5. Current schema / data status

Prisma models (`prisma/schema.prisma`) still live under the
Player Props track:

```
Team, Player, Game, GameLog
PropMarket, PropQuote, Projection
ModelRun, PropPrediction
BetCandidate, BacktestResult
ApiUsageLog
```

Enums: `Position`, `PropType` (7 lower-variance markets, no TDs),
`Recommendation`, `ModelRunType`, `BetResult`.

The Game Edge model is fixture-only today — no schema, no
ingestion. When/if it graduates to live data, it will live in its
own schema namespace.

Mock data layer (`src/lib/mock-data.ts`):

- 25 props across 5 games (Week 11 / 2025).
- Player prop scorecard is the single source of truth for the
  player prop UI.

Manual data files (committed):

- `data/manual/injury_flags.csv`
- `data/manual/stadiums.csv`
- Backtest fixtures under `data/fixtures/backtest/`.

## 6. Current UI status

### 6.1 Player Props

- `/` — dashboard. Hero stats, filter chips, one
  `OpportunityCard` per prop with recommendation, scorecard
  badges, probability + edge readouts, top reasons / risks,
  final explanation.
- `/props/[id]` — prop detail. Hero header, 4-metric strip, full
  `ScorecardDetailPanel`, matchup intelligence panel, recent
  game logs, line shopping.
- `/backtest` — backtest performance dashboard. Tile metrics,
  per-market and per-confidence breakdowns, proxy accuracy panel
  when the fixture summary is generated.

### 6.2 Game Edge

- `/game-edge` — Experimental Game Edge dashboard. Hero card
  marked "Experimental — separate from player prop model", five
  summary tiles (games evaluated / moneyline value / spread
  value / upset watch / pass), filter tabs (all / moneyline /
  spread / upset watch / pass), per-game cards with
  recommendation label, selected market, upset score badge, and
  matchup metrics.
- `/game-edge/[id]` — per-game detail. Market baseline / model
  probability / moneyline path / spread path / upset analysis /
  reasons + risks + disqualifiers / what would change the
  recommendation / final explanation.

Visual style: light glassmorphism, `ink` palette + `amber` /
`coral` / `sea` accent tones. Game Edge surfaces use the same
theme but are clearly labeled "Experimental" so the user can
tell at a glance they're not on the player prop dashboard.

## 7. Current backtest / API status

**Player prop backtest runner** (`scripts/run-backtest-2025.ts`):

- Builds features from stored historical data, runs the
  projection engine, grades plays, writes summary + result CSV.
- Designed to read from Postgres or committed CSV fixtures only
  — it does not call paid APIs directly. Ingestion happens
  out-of-band into the DB.

**Game Edge backtest**: not yet built. Fixture-driven only.

**Ingestion scaffolds** (`src/lib/ingestion/` + `scripts/ingest-*`):

- `odds-api.ts` — paid. Real calls are gated by
  `ALLOW_REAL_ODDS_API_CALLS=true` and a credit estimator. Default
  mode is dry-run.
- `kalshi.ts` — `KALSHI_API_KEY` + environment selector; demo env
  by default.
- `weather.ts` — free (Open-Meteo); still dry-run by default.
- `injuries.ts` — reads `data/manual/injury_flags.csv`; no
  external call.
- `ingest-nfl-history.py` — nflverse scaffold; writes empty
  schema-only CSVs unless the `nflreadpy` / `nfl_data_py`
  wrappers are uncommented. No API key required.

`src/config/api-budget.ts` defines monthly call ceilings; the
credit estimator inspects each batch before any network call.
The running app does **not** make any external calls.

## 8. Next recommended steps

See `NEXT_STEPS.md` for the prioritized punch list.

In broad strokes:

1. Wire the v2 player prop pipeline into the backtest runner so
   we can compare its qualification decisions against the
   existing scorecard on real historical data, then graduate the
   thresholds that prove out.
2. Build a Game Edge backtest — historical game-level data,
   per-recommendation P/L tracking, key-number sensitivity
   analysis. The Game Edge model is fixture-only until this lands.
3. Stand up a one-week historical seed (Odds API + nflverse)
   end-to-end with the dry-run / credit-budget guardrails
   actually exercised.
4. Replace `mock-data.ts` reads in the pages with Prisma queries
   once the DB has real data.
5. Keep enforcing the two-section separation: no Game Edge logic
   in player prop components, no player prop logic in Game Edge
   components.
