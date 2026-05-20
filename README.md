# NFL Prop Edge

A player prop opportunity platform for the NFL. V1 ships with mock data, a clean
sports-analytics dashboard, and a per-prop detail page so you can validate the
UX and modeling story before wiring in real odds and projection feeds.

## What's in V1

- **Lower-variance markets only.** V1 supports passing attempts, passing
  completions, passing yards, receptions, receiving yards, rushing attempts,
  and rushing yards. Touchdown props are intentionally out of scope.
- **Dashboard at `/`.** Summary stats (tracked markets, positive edges, average
  edge, top opportunity) plus a filterable, sortable table of every prop.
  Filters live in the URL so views are shareable.
- **Prop detail page at `/props/[id]`.** Player + matchup header, model
  projection breakdown (mean ± σ, model vs book implied probability), last 5
  game logs with line-relative distribution, line shopping across sportsbooks,
  and matchup notes.
- **Mock data first.** All numbers come from `src/lib/mock-data.ts` so the app
  runs without any external API or database connection. The Prisma schema and
  seed script are ready for when the live data pipeline lands.

## Tech stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS (light glassmorphism analytics UI)
- Prisma ORM with PostgreSQL
- Python 3.11+ for the nflverse ingestion stub
- Deployed on Railway

## Project layout

```
src/
  app/
    layout.tsx              # Global shell + header
    page.tsx                # Dashboard (server, filters in URL)
    props/[id]/page.tsx     # Prop detail page
    backtest/page.tsx       # Backtest performance dashboard
    globals.css             # Tailwind + glass theme tokens
  components/               # PropCard, PropFilters, DashboardSidebar,
                            # StatCard, TeamBadge, EdgeBadge, etc.
  lib/
    data/                   # UI-facing data access layer (props, players,
                            # games, backtest, types). Wraps mock-data
                            # today, future home of Prisma queries.
    ingestion/              # External data clients (typed, dependency-free):
      odds-api.ts           #   The Odds API historical reads
      weather.ts            #   Open-Meteo archive
      kalshi.ts             #   Kalshi market data (read-only)
      injuries.ts           #   Manual injury-flag loader + lookups
    backtest/               # V1 backtest engine:
      feature-builder.ts    #   prior logs + weather + injuries -> features
      projection-engine.ts  #   features -> mean / stddev + reasons / risks
      probability-engine.ts #   normal CDF + edge + qualification
      grading.ts            #   actual stat -> win / loss / push + Brier
      metrics.ts            #   aggregate ROI / hit rate / breakdowns
    mock-data.ts            # All V1 mock data (teams, players, games,
                            # props, logs, injuries, backtest summary)
    prop-utils.ts           # Odds-math + label / format helpers
    prisma.ts               # Singleton Prisma client
    types.ts                # Shared domain types
prisma/
  schema.prisma             # Postgres schema (Team / Player / Game /
                            # PropMarket / PropQuote / Projection /
                            # ModelRun / BacktestResult / PropPrediction
                            # / BetCandidate / GameLog)
  seed.ts                   # Loads mock-data into Postgres
scripts/
  ingest-nfl-history.py     # nflverse ingestion stub (Python, stdlib only)
  ingest-historical-prop-lines.ts
  ingest-weather-history.ts
  ingest-kalshi-markets.ts
  run-backtest-2025.ts
  README.md                 # Detailed pipeline + CSV-to-Prisma mapping notes
data/
  manual/                   # Hand-authored CSVs (stadiums, injury_flags)
  raw/                      # Per-source raw API responses (gitignored)
  processed/                # Normalized CSVs ready for the loader (gitignored)
  backtests/<season>/       # Backtest outputs (gitignored)
```

## Local setup

Prereqs: Node 20+ and (optionally) a local Postgres 14+.

```bash
# 1. Install
npm install

# 2. Environment
cp .env.example .env
# Edit .env: set DATABASE_URL to your local Postgres.
# If you skip this step, the dashboard and prop pages still work because
# V1 reads from mock-data.ts — but `npm run build` will run `prisma generate`
# and expects DATABASE_URL to be set.

# 3. Dev server
npm run dev
# Open http://localhost:3000
```

### Optional: spin up the Prisma schema

You only need this once you start using the database (V1 reads mock data
directly). With a running Postgres and `DATABASE_URL` set:

```bash
npx prisma db push   # apply schema without migrations
npm run db:seed      # load mock data into Postgres
npm run db:studio    # open Prisma Studio at localhost:5555
```

## Available scripts

| Command            | What it does                                                  |
| ------------------ | ------------------------------------------------------------- |
| `npm run dev`      | Next.js dev server with Fast Refresh                          |
| `npm run build`    | `prisma generate` + Next production build                     |
| `npm run start`    | Run the production build                                      |
| `npm run lint`     | Run `next lint`                                               |
| `npm run db:push`  | Sync `schema.prisma` to the database (no migration files)     |
| `npm run db:migrate` | Apply migrations in `prisma/migrations` (used in production) |
| `npm run db:seed`  | Run `prisma/seed.ts` to load mock data                        |
| `npm run db:studio`| Open Prisma Studio                                            |

## Required environment variables

Set only the ones a given script needs. The ingestion library modules never
read `process.env` for credentials directly — callers (the scripts) pass them
in. The Python NFL ingestion uses no keys.

| Variable | Used by | Required when | Default |
| --- | --- | --- | --- |
| `DATABASE_URL` | `npm run build`, `npm run db:seed`, `--persist` on the backtest | always for builds and DB writes | — |
| `ODDS_API_KEY` | `scripts/ingest-historical-prop-lines.ts` | non-dry-run mode | — |
| `ODDS_API_BASE_URL` | The Odds API client | override only | `https://api.the-odds-api.com/v4` |
| `OPEN_METEO_BASE_URL` | Open-Meteo client | override only | `https://archive-api.open-meteo.com/v1/archive` |
| `KALSHI_API_KEY` | `scripts/ingest-kalshi-markets.ts` | non-dry-run mode | — |
| `KALSHI_API_SECRET_PATH` | `scripts/ingest-kalshi-markets.ts` | non-dry-run mode | — |
| `KALSHI_ENV` | Kalshi client | optional | `demo` |
| `KALSHI_BASE_URL` | Kalshi client | override only | env-dependent |

## Historical ingestion

All ingestion scripts support `--dry-run` to print the planned API calls
without making them. Use it first to estimate work and verify the inputs.

### NFL stats (nflverse)

```bash
python3 scripts/ingest-nfl-history.py --season 2025 --weeks 1-10 --dry-run
python3 scripts/ingest-nfl-history.py --season 2025 --weeks 1-10
```

Pulls schedules, weekly player stats, play-by-play, snap counts, and
roster/player IDs from nflverse-data. No API keys. Writes raw frames to
`data/raw/` and normalized CSVs to `data/processed/`:

- `games.csv` → `Game` model
- `player_week_stats.csv` → `GameLog` model
- `team_week_stats.csv` → planned `TeamGameLog` (not yet in schema)
- `snap_counts.csv` → joined into `GameLog`
- `player_ids.csv` → `Player` model

V1 is a stub — `pull_*` functions return empty iterables and write
schema-only CSVs. Each function carries the exact `nflreadpy` /
`nfl_data_py` call that replaces its body. See `scripts/README.md` for
the full CSV-to-Prisma mapping.

### Player props (The Odds API)

```bash
# preview — no API calls (dry-run is the default)
ODDS_API_KEY=demo npx tsx scripts/ingest-historical-prop-lines.ts \
  --season 2025 --scope smoke-test --source mock

# live (requires BOTH --execute AND the kill-switch env var)
ALLOW_REAL_ODDS_API_CALLS=true \
ODDS_API_KEY=$ODDS_API_KEY \
  npx tsx scripts/ingest-historical-prop-lines.ts \
    --season 2025 --scope smoke-test --execute --budget 200
```

Pulls one pregame snapshot per game, ~3.5h before kickoff (rounded to the
5-minute grid). The first staged version is hard-pinned to **4 markets**
(`player_pass_attempts`, `player_pass_completions`, `player_receptions`,
`player_rush_attempts`) and `regions=us`. Writes raw events + per-event
odds JSON to `data/raw/odds-api/`, runs them through the on-disk cache
under `data/cache/odds-api/`, and emits normalized rows to
`data/processed/prop_markets.csv` + `prop_quotes.csv`. Each call adds a
row to `ApiUsageLog` (Postgres, when `DATABASE_URL` is set) and the
per-run JSONL audit log at `data/raw/api-usage/<runId>.jsonl`. See the
two sections below for the staging plan and the cost-protection rules.

## Historical Odds Ingestion Staging Plan

Pull 2025 historical prop lines from The Odds API in graduated scopes —
prove the pipeline on the cheapest meaningful run first, ratchet up
only after each step validates. Every step is opt-in via `--execute`,
runs against the on-disk cache so reruns cost nothing, and is bounded
by `MAX_ODDS_API_CREDITS_PER_RUN`.

| Stage | Flag | Coverage | Approx credits | Purpose |
| --- | --- | --- | --- | --- |
| 1 | `--scope smoke-test` | Week 1 of season | ≤ 70 | Prove the pipeline end-to-end against one slate. Verify event matching, market normalization, cache writes, ApiUsageLog. |
| 2 | `--scope week --week N` | One specific week | ≤ 70 | Spot-check a different week (e.g. a divisional Sunday) once the smoke test is green. |
| 3 | `--scope four-weeks` | Weeks 1–4 | ~280 (raise `--budget`) | Builds a first multi-week sample for backtest sanity checks. Requires a budget bump above the 200-credit default. |
| 4 | `--scope half-season` | Weeks 1–9 | ~600 (raise `--budget`) | Half-season corpus, big enough to fit projection / risk models. Run only after step 3 has been audited. |
| 5 | `--scope full-season` | Weeks 1–18 | ~1300 (raise `--budget`) | Complete season backtest dataset. Plan + budget approval required before kicking this off. |

Selection flags (use any one; explicit beats `--scope`):

- `--weeks 1-9,12` — comma/range list
- `--week 7` — single week shorthand
- `--start-week 1 --end-week 4` — closed range

Reruns are safe by design — the cache key hashes `(snapshot, eventId,
markets, regions)`, so a second run of the same scope is a no-op for
credits.

## API Cost Protection Rules

Every paid Odds-API path obeys these rules, enforced in
`src/config/api-budget.ts` and `src/lib/ingestion/credit-estimator.ts`:

1. **Default is dry-run.** `scripts/ingest-historical-prop-lines.ts`
   only spends credits when both `--execute` is passed **and** the
   env var `ALLOW_REAL_ODDS_API_CALLS=true` is set. Either alone is
   refused.
2. **Cache first.** Before any HTTP call the script checks
   `data/cache/odds-api/<hash>.json`. Cached responses never re-hit
   the API. Cache is gitignored and reused across runs.
3. **Estimate before spending.** A plan summary prints **before** any
   call: scope, games requested, markets requested, region,
   estimated credits, cached responses found, new API calls required,
   max allowed credits.
4. **Hard per-run ceiling.** The script aborts if estimated credits
   exceed `--budget` (default `MAX_ODDS_API_CREDITS_PER_RUN = 200`).
   Bump the flag explicitly to run larger scopes.
5. **Minimum reserve floor.** The script aborts mid-run if
   `x-requests-remaining` from any response drops below
   `MIN_ODDS_API_CREDITS_REMAINING = 1000`.
6. **Overage circuit-breaker.** If actual credits used exceed the
   estimate by more than `CREDIT_OVERAGE_ABORT_RATIO = 1.10` (10%),
   the script halts before the next request.
7. **Market cap.** The first version requests only the 4 V1 volume
   markets. Yardage markets unlock once this version is verified.
8. **Region cap.** `ALLOWED_ODDS_REGIONS = ["us"]`. No EU or AU pulls.
9. **Header logging.** `x-requests-used`, `x-requests-remaining`, and
   `x-requests-last` from every live response are written to the
   per-run JSONL audit log and (when `DATABASE_URL` is set) to the
   `ApiUsageLog` Postgres table.
10. **Raw before normalization.** Raw responses are saved to
    `data/raw/odds-api/<snapshot>-<eventId>-odds.json` before any
    normalization, so a regenerated CSV never costs new credits.

### Weather (Open-Meteo)

```bash
npx tsx scripts/ingest-weather-history.ts --season 2025 --weeks 11 --source mock --dry-run
npx tsx scripts/ingest-weather-history.ts --season 2025 --weeks 11 --source mock
```

Free, no API keys. Reads stadium coords from
`data/manual/stadiums.csv`, skips dome / closed-roof games up front
(emits an ineligible row to keep joins total), and pulls hourly
temperature, wind, gusts, precipitation, snowfall, and WMO weather code
at the snapshot hour. Writes per-game JSON to `data/raw/weather/` and
normalized rows to `data/processed/weather_snapshots.csv`.

### Manual injury flags

Edit `data/manual/injury_flags.csv` directly. The loader
(`src/lib/ingestion/injuries.ts`) supports five flag kinds in one row
shape; pick the encoding that fits the situation:

| Pattern | How to encode |
| --- | --- |
| Player questionable / out | `status` + `injuryImpact` (high/medium/low) |
| Teammate role boost | `status=active`, `injuryImpact=boost`, `playerName` = beneficiary |
| Offensive-line injury | `position=OL`, `injuryImpact=ol_depleted` |
| Defensive-back injury | `position` in `{CB, S, DB}`, `injuryImpact=db_depleted` |
| Game-level uncertainty | empty `playerName`, `status=uncertain`, `injuryImpact=uncertainty` |

`getPlayerContext({ season, week, gameId, team, opponentTeam, playerName })`
rolls all relevant flags into a single per-player context the projection
engine consumes.

### Kalshi market data

```bash
# preview — no key required
npx tsx scripts/ingest-kalshi-markets.ts --series KXNFLGAME --dry-run

# live (demo env)
KALSHI_API_KEY=... \
KALSHI_API_SECRET_PATH=./secrets/kalshi.pem \
KALSHI_ENV=demo \
  npx tsx scripts/ingest-kalshi-markets.ts \
    --series KXNFLGAME --status open --limit 50 --max-pages 4 --orderbook
```

**Read-only.** Only GET endpoints (markets list, market detail, orderbook)
are exposed. The signing helper's method type is locked to `"GET"` —
widening it to add a trading surface requires a deliberate, reviewed code
change. No order, portfolio, balance, or position endpoints exist in the
client.

## Local Backtest Engine

The backtest engine is a **local, stored-data-only** replay of the 2025
season against the scorecard-based decision model. **It never calls
The Odds API, Kalshi, Open-Meteo, nflverse, or any other external
service.** Ingestion and backtesting are intentionally split: the
ingestion scripts cache raw responses out-of-band (dry-run by default,
under credit guardrails), and the backtest runner only reads from
`data/processed/` or `data/fixtures/`.

```bash
# Run the fixture-driven backtest assertions
npx tsx scripts/test-backtest-fixtures.ts

# Run the backtest with the bundled fixtures (default: 4 V1 volume
# markets, weeks 1-18 of 2025)
npx tsx scripts/run-backtest-2025.ts --fixtures

# Include yardage markets too
npx tsx scripts/run-backtest-2025.ts --fixtures --include-yardage

# Narrow the window
npx tsx scripts/run-backtest-2025.ts --fixtures \
  --start-week 11 --end-week 11
```

Outputs land in `data/backtests/2025/`:

- `backtest-summary.fixture.json` — aggregate metrics + per-bucket
  slices (prop type, primary disqualifier, edge bucket, confidence
  tier, coaching uncertainty, weather risk)
- `backtest-results.fixture.csv` — one row per evaluated prop
  (recommendation, qualified, bet, actual stat, outcome, P/L)
- `backtest-results.fixture.json` — same data with the full scorecard
  attached for downstream tooling

The `/backtest` page automatically picks up the summary JSON if it
exists and renders the new metrics above the existing performance
cards.

### Backtest modules (under `src/lib/backtest/`)

| File | Purpose |
| --- | --- |
| `types.ts` | All backtest types (scope, game, player-week, market, quote, weather, injury, feature row, candidate, graded result, summary, per-bucket slices) |
| `data-loader.ts` | `loadFixture*` + `loadBacktestFixtures` for fixture data; `loadProcessedBacktestData` is scaffolded with TODOs for when the ingestion pipeline has populated `data/processed/` |
| `market-adapter.ts` | American-odds → no-vig math, best-quote selection across books |
| `feature-builder.ts` | Pregame feature row: player role stability + recent/season usage + team volume + game script + weather + injury + coaching transition + correlation exposure + data quality. **Only reads data strictly prior to the test week** — no future-data leakage |
| `projection-adapter.ts` | `BacktestFeatureRow → ScorecardInput`. Reuses the existing model scorecard; no second decision path |
| `grading.ts` | OVER wins if actual > line, UNDER if actual < line, PUSH if equal. PASS rows are evaluated but not bet. American-odds-correct flat staking |
| `metrics.ts` | Hit rate, ROI, average edge, average EV, Brier score, max drawdown, plus 6 bucketed summaries |
| `runner.ts` | `runBacktest()` — week-by-week replay. **Hard guardrail comments at the top: no paid APIs, no future data** |
| `reporting.ts` | Writes summary JSON + per-bet CSV + per-bet JSON |

### From fixtures to real 2025 data

The ingestion pipeline is staged separately (`scripts/ingest-*`):

1. `scripts/ingest-historical-prop-lines.ts` (Odds API) — `--scope`
   gated, `--execute` + `ALLOW_REAL_ODDS_API_CALLS=true` required.
   Writes `data/processed/prop_markets.csv` + `prop_quotes.csv`.
2. `scripts/ingest-nfl-history.py` (nflverse) — writes
   `data/processed/player_week_stats.csv` and friends.
3. `scripts/ingest-weather-history.ts` (Open-Meteo, free) — writes
   stadium weather snapshots.
4. `scripts/ingest-injury-flags.ts` — manual injury report ingestion.

Once those run, `loadProcessedBacktestData()` will map the CSV rows
into the same `Backtest*` types the fixture loader produces. The
runner doesn't change.

This split is the API credit protection contract: the runner never
spends credits, ingestion runs are explicit and credit-bounded, and
cached responses make reruns free.

## How We Track What Works and What Fails

The backtest doesn't just record wins and losses on bets. Every
evaluated prop — including the ones the model passed on — carries a
full per-prop record so we can iterate on the parts of the model that
are actually moving the needle.

### What each evaluated prop stores

`BacktestEvaluatedProp` (defined in `src/lib/backtest/types.ts`)
records:

- Identity: id, season, week, gameId, playerId, playerName, team,
  opponent, propType
- Market: line, lineBucket, overOdds, underOdds, selectedSide,
  selectedOdds, market over/under probability
- Model: modelOverProbability, modelUnderProbability, edge,
  edgeBucket, recommendation, qualified, confidence, confidenceBucket,
  riskScore + the eight risk-score components (data quality, role,
  weather, injury, coaching uncertainty, correlation, …)
- Disqualifiers: primaryDisqualifier + full disqualifiers array
- Outcome: actualStat, result (WIN / LOSS / PUSH / PASS / NO_RESULT),
  profitLossUnits
- **Counterfactual**: counterfactualResult and
  counterfactualProfitLossUnits — what would have happened if we had
  acted on the model's lean for a passed prop
- Postmortem tags (multi-label, see below)
- A full scorecard snapshot

### Postmortem tagging (`src/lib/backtest/postmortem.ts`)

Each evaluated prop gets one or more tags assigned by deterministic
rules. Tags include:

| Tag | When it fires |
| --- | --- |
| `GOOD_READ_BAD_VARIANCE` | qualified bet lost by a small margin relative to the line |
| `PROJECTION_TOO_AGGRESSIVE` | OVER lost with actual far below projection |
| `PROJECTION_TOO_CONSERVATIVE` | UNDER lost with actual far above projection |
| `ROLE_ASSUMPTION_FAILED` | snap / target / carry share collapsed |
| `GAME_SCRIPT_FAILED` | projection direction right but absolute miss |
| `WEATHER_UNDERESTIMATED` | wind/precipitation outpaced our score |
| `INJURY_USAGE_SURPRISE` | injury context score was generous |
| `MARKET_WAS_RIGHT` | clean qualifying bet that simply lost |
| `BAD_LINE_PRICE` | high overround + projection-on-line miss |
| `COACHING_UNCERTAINTY_UNDERESTIMATED` | high penalty but bet anyway |
| `CORRELATION_RISK` | stacked exposure on a losing parlay leg |
| `EDGE_TOO_THIN` | thin edge that lost |
| `FILTER_CORRECTLY_AVOIDED` | PASS would have lost as a counterfactual |
| `FILTER_TOO_CONSERVATIVE` | PASS would have won as a counterfactual |

### Performance breakdowns

`BacktestSummary` carries per-bucket performance for all of:

- prop type · line bucket · recommendation side · edge bucket ·
  confidence bucket · primary disqualifier · postmortem tag ·
  coaching uncertainty bucket · weather risk bucket · role stability
  bucket · qualified vs passed

Each `BacktestPerformanceBreakdown` includes evaluated count, bets,
wins, losses, pushes, passes, hit rate, ROI, average edge, average
EV, average profit/loss, average model probability, and average no-
vig market probability.

### Output files

`scripts/run-backtest-2025.ts --fixtures` writes to
`data/backtests/2025/`:

- `backtest-summary.fixture.json` — full summary + audit insights
- `backtest-results.fixture.json` — every evaluated prop with the
  scorecard snapshot, counterfactual, and tags
- `backtest-results.fixture.csv` — flat one-row-per-prop view
- `performance-by-prop-type.fixture.json`
- `performance-by-line-bucket.fixture.json`
- `performance-by-edge-bucket.fixture.json`
- `performance-by-confidence.fixture.json`
- `performance-by-disqualifier.fixture.json`
- `performance-by-postmortem.fixture.json`

The `/backtest` page picks these up automatically.

### Model improvement signals

The summary's `audit` block surfaces:

- best / worst prop type by ROI
- best / worst line bucket by ROI
- highest / lowest ROI edge bucket
- best confidence tier
- the filter that saved the most losses (most prevalent
  `FILTER_CORRECTLY_AVOIDED` tag bucket)
- the filter that may be too conservative (most prevalent
  `FILTER_TOO_CONSERVATIVE` tag bucket)
- PASS counterfactual hit rate — the fraction of passed props the
  model would have hit if we'd bet the lean

The `/backtest` page renders these as a *Model Improvement Signals*
card so it's immediately obvious which markets / buckets / filters
are worth tightening, loosening, or removing.

### Why we track passes too

Filters are only valuable if they reject more losers than winners.
Counterfactual outcomes on PASSes let us:

1. Measure whether a given gate (role / injury / weather / coaching /
   correlation / edge) is pulling its weight.
2. Spot filters that are saving us from real bad bets (good) versus
   filters that are coincidentally avoiding plays the model actually
   liked correctly (bad — too conservative).
3. Decide which markets to expand, tighten, or remove without
   waiting for live betting evidence.

## Football Matchup Intelligence Layer

A static, code-first football-knowledge layer that translates matchup
concepts into prop-specific projection adjustments and scorecard
explanations.

### What it does

- Encodes 10 defensive archetypes (pass-funnel zone, two-high deep
  suppression, pressure-with-four, blitz-heavy, man-heavy, strong run
  defense, weak secondary explosive, …), 10 player-role archetypes
  (slot volume WR, outside deep WR, possession WR, receiving TE,
  receiving RB, bell-cow RB, mobile QB, pocket QB, …), and 6 weather
  archetypes (dome neutral, windy outdoor, cold windy, rainy, extreme
  weather, warm fast track).
- Computes per-dimension adjustments for **defensive funnel**,
  **coverage style**, **pass-rush / OL interaction**, **receiver
  role**, **run game**, and **weather**.
- Returns a `MatchupAdjustmentOutput` with:
  - `projectedMeanMultiplier` (reported but informational — see below)
  - `projectedStdDevMultiplier` (applied — widens uncertainty, ≥ 1.0)
  - `confidenceAdjustment` / `dataQualityAdjustment` / `riskAdjustment`
  - `reasons[]`, `risks[]`, `matchupTags[]`
  - `propImpacts` — labels (`STRONG_POSITIVE` / `POSITIVE` / `NEUTRAL`
    / `UNCERTAIN` / `NEGATIVE` / `STRONG_NEGATIVE`) for **every** V1
    prop type so the UI can show a holistic matchup snapshot.

### What it does NOT do

- **Never forces an OVER or UNDER recommendation by itself.**
  - The `projectedMeanMultiplier` is reported on the scorecard
    component but is **not applied** to qualification math. A strong
    positive matchup can support an already-qualifying bet but cannot
    push a thin edge over the threshold.
  - The `projectedStdDevMultiplier` is clamped to ≥ 1.0, so applying
    it can only widen uncertainty (push a thin edge below threshold),
    never narrow it (push a thin edge above threshold).
- Does not change the model scorecard's decision authority. The
  scorecard still owns recommendation/qualified/edge math.
- Does not call any APIs. Static archetypes only.

### Why it doesn't force bets

The point of matchup intelligence is to **enrich reasoning and
calibrate uncertainty**, not replace the edge / risk-gate decision
engine. Football matchups are noisy and qualitative; treating them as
direct projection inputs would let small archetype mismatches qualify
bets that the rigorous edge model wouldn't have. The framework
instead:

1. Lists matchup reasons next to the scorecard's edge math when a bet
   qualifies (positive support).
2. Lists matchup risks in the scorecard's risk list when conditions
   are unfavorable (downside surfacing).
3. Widens σ when matchup volatility is high so a marginal edge shrinks
   and may fall under threshold (downgrade only).
4. Drags confidence lightly when the matchup is hostile (display only,
   doesn't unqualify a bet on its own).

### How it supports prop-specific reasoning

Per-dimension rules (excerpt — full list in
`src/lib/model/matchup-intelligence.ts`):

- **Pass funnel** supports `PASSING_ATTEMPTS` / `PASSING_COMPLETIONS`
  **only if game script supports passing** (team not heavily trailing).
- **Run funnel** supports `RUSHING_ATTEMPTS` / `RUSHING_YARDS` **only
  if team is not likely to trail heavily**.
- **Two-high / deep suppression** downgrades `PASSING_YARDS` /
  `RECEIVING_YARDS`; supports short-area `RECEPTIONS`; mildly
  supports rushing efficiency (light boxes).
- **Pressure × pressure-sensitive QB**: passing yards and receiving
  yards downgraded more than passing completions.
- **Blitz + short-area role (slot / TE / RB)**: small `RECEPTIONS`
  boost (checkdown environment).
- **OL injury risk**: deep passing and rushing efficiency downgraded
  with confidence drag.
- **Mobile-QB cannibalization**: RB rushing attempts / yards
  downgraded with confidence drag.
- **Yardage props** receive a larger σ widening cap (up to +30%);
  **volume props** are capped tighter (+15%) since they're already
  more sensitive to role / pace / script in the upstream scorecard.
- **Low data quality** caps the entire matchup adjustment toward
  neutral.
- **Low role stability** dampens role-dependent matchup signals.
- **Dome status trumps** any weather signal — forces neutral.

### How it integrates with the existing scorecard

`ScorecardInput` accepts an optional `matchupAdjustment` field. When
provided, `buildPropDecisionScorecard()`:

1. Multiplies `projectedStdDev` by `projectedStdDevMultiplier` before
   running the normal-CDF math.
2. Appends matchup reasons to `passReasons` (when the bet qualifies).
3. Appends matchup risks to the scorecard's `risks` list.
4. Adds the matchup `confidenceAdjustment` to the final confidence
   (clamped within the existing bounds).
5. Attaches the optional `matchupComponent` to the output for UI
   display.

The `/props/[id]` page renders a **Football Matchup Intelligence**
section automatically when `scorecard.matchupComponent` is present —
showing defensive archetype, player role, weather archetype, mean
shift (informational), σ widening (applied), confidence Δ, per-prop
impact map, reasons, risks, and matchup tags.

### How it will later be fed by real data

Today the archetypes are hand-tuned static profiles meant to be
referenced as defaults; the scoring functions read from explicit
`MatchupIntelligenceInput` fields rather than the archetype constants
directly. When real ingestion is wired up (nflverse splits, sharp
coverage reports, weather), the upstream feature pipeline will
populate `DefensiveFunnelProfile` / `CoverageProfile` /
`PressureProfile` / etc. from actual data and pass the resulting
`MatchupAdjustmentOutput` into the scorecard. The framework's
architecture doesn't change — only the data source.

## V1 Qualification Logic

The dashboard's `OVER` / `UNDER` / `PASS` recommendation is **not** a
simple edge threshold check. The feature framework
(`src/lib/model/feature-framework.ts` +
`src/lib/model/feature-scoring.ts`) feeds a multi-gate qualification
function that can refuse a positive-edge prop when the underlying
context is too risky.

### Edge thresholds by prop type

| Market | Threshold |
| --- | --- |
| `PASSING_ATTEMPTS` | 4% |
| `PASSING_COMPLETIONS` | 4% |
| `RECEPTIONS` | 5% |
| `RUSHING_ATTEMPTS` | 5% |
| `PASSING_YARDS` | 6% |
| `RUSHING_YARDS` | 6% |
| `RECEIVING_YARDS` | 7% |

`|edge|` must clear the prop type's threshold before a prop can become a
qualified bet. Below threshold ⇒ `PASS` with reason `"Edge X% is below
Y% threshold"`. (The same `EDGE_THRESHOLDS` constant lives in both
`probability-engine.ts` for the backtest and `feature-scoring.ts` for
the live dashboard — keep them aligned.)

### Why a prop can be `PASS` even with positive edge

`qualifyWithFeatures(...)` enforces five additional gates on top of the
edge check. Any one of them failing forces `PASS`:

| Gate | Floor | What it catches |
| --- | --- | --- |
| **Role stability score** | ≥ 40 | Player's snap / route / target / carry share is collapsing or volatile, so recent-mean projections are misleading. |
| **Injury context score** | ≥ 30 | Player listed Q/D/Out, or game-level uncertainty flag is set. |
| **Weather risk score** | ≥ 30 | Outdoor stadium with high wind, heavy precip, or a high-uncertainty forecast (only blocks for passing / receiving markets). |
| **Correlation exposure score** | ≥ 30 | Same-game exposure cap reached, or correlated same-team pass-volume bets already pending. |
| **Data quality score** | ≥ 20 | Too few feature inputs populated for any score to be trustworthy. (V1 floor is intentionally low — sparse signals are the norm today; target lifts as ingestion comes online.) |

The `PropCard` on the dashboard and the **"Why this did or did not
qualify"** section on the prop detail page render the checklist
directly from these gates, so you can see exactly which check failed
for any `PASS`.

### How each risk feature affects the gate

| Risk | Where you see it |
| --- | --- |
| **Role instability** | `Role Stable` badge missing on the card; **Role Stability** card on detail page in the "negative" tone; in the PASS reasons. |
| **Injury uncertainty** | `Injury Risk` badge on the card; **Injury Context** card on detail page. |
| **Weather risk** | `Weather Risk` badge; **Weather / Environment** card; only fires for outdoor stadiums where the prop type is sensitive. |
| **Correlation risk** | `Correlation Risk` badge; **Correlation Exposure** card. |
| **Line movement** | `Line Moved` badge (V1 placeholder — single-snapshot ingestion today, so `lineMovement` is usually 0). |
| **Game script tailwinds** | `Script Boost` badge — positive signal, not a risk. |

Example: a `RECEPTIONS` prop with `+8%` edge (well over the 5%
threshold) will still `PASS` if the player's target share has dropped
3 weeks running, or if they're tagged questionable in
`data/manual/injury_flags.csv`. The bet is only as good as the role
behind it.

### Why lower-variance props first

V1 trades only the seven listed markets — all volume / yardage stats
driven primarily by usage and game script. We deliberately exclude
touchdown markets (and the longshot moneyline modeling that comes
with them) because:

- **Distributional shape.** Volume markets are well-approximated by
  the normal CDF over a player's recent + season blend. TD scoring is
  Poisson-shaped with a fat tail — the same projection engine would
  systematically under-price the over.
- **Sample efficiency.** A WR's receptions are a usage signal we can
  estimate from snap and route data every week. TD output is a noisy
  proxy for red-zone usage *and* opponent script *and* QB choice —
  triple the variance for the same data.
- **Calibration first, expand second.** Lower-variance markets give
  the backtest the tightest feedback loop. We want Brier scores +
  bucketed ROI to converge here before we expose harder markets.

The Prisma enum, the Odds API client's `SUPPORTED_MARKETS`, the
ingestion CSVs, the projection engine, and the qualification gate are
all hard-coded to the same seven keys. Adding a new market is a
single coordinated change touching each of those layers — easy to do
once, easy to audit later.

## Algorithm Holes and Future Feature Improvements

V1's projection engine works — it blends recent vs season means, applies
a few weather and injury adjustments inline, and ships. But it leaves
real signal on the table. We catalogued the holes and the data sources
that close them in `src/lib/model/feature-framework.ts`.

The framework defines **seven feature groups**. Each group has:

- a typed `*Inputs` interface listing the raw signals it needs;
- a `NEUTRAL_*_INPUTS` constant for the "no data" baseline;
- a `score*(inputs, propType) → FeatureScore` placeholder that returns
  neutral today, with the intended scoring logic and the data source
  written into the docstring as `TODO:`s;

plus a common `FeatureScore` output (`meanMultiplier`,
`sigmaMultiplier`, `edgeAdjustment`, `exposurePenalty`,
`qualificationBlock`, `notes`) and an `aggregateFeatureScores(...)`
combinator so the projection / probability / bet-sizing layers consume
a single rolled-up score.

### What's missing in V1

| Group | V1 today | What we're leaving on the table |
| --- | --- | --- |
| **Role stability** | recent-vs-season blend only | Snap / route / target / carry-share trends; teammate-absence boosts and teammate-return penalties from a snap feed (not just CSV flags). |
| **Game script** | nothing | Spread, total, projected pass/rush rate, blowout risk, trailing-pass volume boost. A WR on a 14-pt favorite vs. on a 14-pt dog should not project the same. |
| **Pace** | hardcoded 64 plays/game | Offense seconds-per-play, neutral pace, opponent plays-allowed. Volume markets shift ±15% in either direction. |
| **Market context** | snapshot line treated as truth | Opening line, current line, line movement, multi-book outlier detection, Kalshi liquidity / spread penalty. Today a stale outlier book and a 6-cent move are invisible. |
| **Weather / environment** | basic wind / precip thresholds inline | Forecast uncertainty (widens σ), per-game retractable-roof state, temperature-driven yards-per-attempt. |
| **Injury / role context** | manual CSV flags only | Paid injury feed with practice-participation %, snap projections, real-time inactives. Today the CSV is the single source of truth. |
| **Correlation / exposure** | nothing | Same-game exposure cap, same-team pass-volume cap (correlated bets compound), max-bets-per-game flag. Backtest grades each prop independently; live play would silently concentrate. |

### How each hole gets closed

| Group | Data source | Status |
| --- | --- | --- |
| Role stability | `data/processed/snap_counts.csv`, planned `team_week_stats.csv`, `data/manual/injury_flags.csv` | Snap-counts + injuries scaffolded; team-week stats are planned (PBP aggregator stub in `ingest-nfl-history.py`). |
| Game script | `data/processed/games.csv` (`spread_line`, `total_line`), `team_week_stats.csv` | Games CSV column exists; team-week aggregation planned. |
| Pace | `team_week_stats.csv` (`seconds_per_play_off`, `plays_offense`, `plays_defense`) | Planned model — column names pinned in the Python stub. |
| Market context | `prop_quotes.csv` with multiple snapshots per market, `kalshi_orderbook.csv` | Single-snapshot pulls scaffolded; closing-line pull + depth-aware liquidity scoring are TODO. |
| Weather | `weather_snapshots.csv` | Shipped — the V1 inline logic is the de-facto placeholder; `scoreWeather()` will be the drop-in replacement. |
| Injury | `injury_flags.csv` + future paid feed | Manual flags shipped; paid feed is TBD. |
| Correlation | `BetCandidate` rows in Postgres | Schema exists; the "what bets are already on this game" aggregator is TODO. |

### Adopting the framework

Every group's scorer returns `NEUTRAL_FEATURE_SCORE` today, so adopting
the framework is reversible and incremental:

1. Build each group's `score*` function against its planned data source.
2. Have `projection-engine.ts` call `scoreAll(inputs, propType)` and
   apply the aggregate's `meanMultiplier` and `sigmaMultiplier` instead
   of the current inline weather / injury blocks.
3. The probability engine adds `aggregate.edgeAdjustment` before its
   threshold check and honors `aggregate.qualificationBlock`.
4. A new bet-sizing layer reads `aggregate.exposurePenalty` to size or
   skip the wager.
5. Per-group scores stay accessible via `groups` so the UI can show
   **which** feature moved the projection, not just the final number.

Each step is a self-contained commit that doesn't change behaviour for
groups that still return neutral.

## API Cost Protection Rules

V1 codifies the credit-spend policy in **`src/config/api-budget.ts`** so
nothing scattered across the ingestion scripts can quietly burn through
a budget. Every paid-API code path imports from that file.

### The constants (edit here, audit everywhere)

| Constant | Default | What it does |
| --- | --- | --- |
| `MAX_ODDS_API_CREDITS_PER_RUN` | `200` | Hard ceiling on any single Odds-API run. Estimated cost above this aborts before any HTTP call. |
| `MIN_ODDS_API_CREDITS_REMAINING` | `1000` | Account-credit floor. Once we observe `x-requests-remaining` from a response, a run that would drop the account below this is refused. |
| `MAX_MARKETS_PER_REQUEST` | `7` | Cap on markets per `/events/{id}/odds` call. The URL builder also throws when exceeded. |
| `ALLOWED_ODDS_REGIONS` | `["us"]` | Region whitelist. V1 only trades US books. The URL builder throws on anything else. |
| `DEFAULT_HISTORICAL_SNAPSHOT_HOURS_BEFORE_KICKOFF` | `3.5` | Snapshot offset (rounded to the 5-minute grid). |
| `ALLOW_REAL_ODDS_API_CALLS` | `false` (set via env `ALLOW_REAL_ODDS_API_CALLS=true`) | Master kill-switch. Must be `true` before any non-dry script run is allowed. |
| `CACHE_ROOT` | `data/cache` | Where raw responses are cached. Gitignored. |

### The dry-run-first policy

`scripts/ingest-historical-prop-lines.ts` **defaults to dry-run**. To
actually spend credits, both must be true:

1. The script must be invoked with `--execute`.
2. The env var `ALLOW_REAL_ODDS_API_CALLS` must be `"true"`.

Missing either ⇒ clean exit with the gate that failed:

```bash
# default — prints the plan, no API calls, no key needed
npx tsx scripts/ingest-historical-prop-lines.ts --season 2025 --weeks 1-10 --source mock
# 2026-05-20T... INFO Dry-run complete. Estimated credits: 38 (budget 200).

# --execute without the env switch
ODDS_API_KEY=… npx tsx scripts/ingest-historical-prop-lines.ts --execute
# ABORT: --execute was passed but ALLOW_REAL_ODDS_API_CALLS env var is not 'true'.

# --execute with the switch but the estimate blows the budget
ALLOW_REAL_ODDS_API_CALLS=true ODDS_API_KEY=… \
  npx tsx scripts/ingest-historical-prop-lines.ts --execute --budget 5
# ABORT: estimated 38 credits exceeds --budget 5.
```

Every live run prints, **before** the first HTTP call:

- planned request count (events-list + per-event odds);
- estimated credits with per-region / per-market breakdown;
- the budget cap it's checked against.

### Credit estimator + budget validation

`src/lib/ingestion/credit-estimator.ts`:

- `estimateHistoricalEventOddsCredits({ markets, regions })` — cost of
  one `/events/{id}/odds` call.
- `estimateSeasonBacktestCredits({ gameCount, markets, regions, uniqueSnapshots? })`
  — cost of a full backtest run, broken into events-list and per-event
  odds.
- `validateCreditBudget({ markets, regions, estimatedCredits, creditsRemaining? })`
  — refuses (with explicit reasons) if any of: markets cap exceeded,
  region not whitelisted, estimate over `MAX_ODDS_API_CREDITS_PER_RUN`,
  or running would drop the account below
  `MIN_ODDS_API_CREDITS_REMAINING`.

### Request caching

`src/lib/ingestion/cache.ts` is a stdlib-only file cache for raw API
responses:

- `buildCacheKey({ source, endpoint, params })` — deterministic
  `<source>/<sha256>.json` key. Never includes `apiKey`, so cache entries
  are portable between dev / CI / users.
- `hasCachedResponse(key)`, `getCachedResponse(key, { maxAgeMs })`,
  `saveCachedResponse(key, response, { url })` — read / write / TTL.
- Persisted URLs are stored with the apiKey replaced by `***MASKED***`.

Cache root: `data/cache/` (gitignored).

### Usage logging

The Prisma schema includes an **`ApiUsageLog`** model:

| Field | Purpose |
| --- | --- |
| `source`, `endpoint`, `requestUrlHash` | what was called |
| `estimatedCredits`, `actualCredits` | budget reconciliation |
| `creditsRemaining`, `creditsUsed`, `creditsLast` | mirror Odds-API response headers (`x-requests-remaining`, `-used`, `-last`) |
| `status`, `message` | HTTP status + error / OK |
| `createdAt` | indexed |

Live wiring (one `prisma.apiUsageLog.create({...})` per successful or
failed call) lands when the first real Odds-API run is approved.

## Staying under API credit limits

| Source | Pricing | Mitigation |
| --- | --- | --- |
| **The Odds API** | 1 credit per `/events` snapshot, 1 credit per `(market × region)` per `/events/{id}/odds` call | `--dry-run` prints the URL plan + credit estimate. `--budget N` aborts **before any HTTP call** if estimate exceeds N. Snapshots are grouped so games sharing a kickoff window pay one events-list call between them. Regions hard-capped to `us` and markets hard-capped to 7. |
| **Open-Meteo** | Free, no auth | Dome / closed-roof games skip the API call entirely (decided up-front from `stadiums.csv`). |
| **Kalshi** | No public per-request charge but it's a regulated exchange — keep traffic low | `--max-pages` clamped to `MAX_PAGES_CAP=20` regardless of CLI input. `--dry-run` never reads the private key and never makes HTTP calls. |
| **nflverse** | Free — static GitHub releases | No mitigation needed. |

Operational guidance:

- **Always `--dry-run` first** when iterating on filter args.
- **Use `--source mock`** on any TypeScript script during development —
  pulls from `src/lib/mock-data.ts` so the orchestrator runs end-to-end
  without burning credits.
- `--max-pages 1` is the default for paginated calls; bump deliberately.
- For The Odds API, narrow `--weeks` to one week at a time when first
  wiring up. A full regular-season run is roughly 50 unique snapshot
  windows × 7 markets ≈ 1900 credits.
- The `data/raw/**`, `data/processed/**`, and `data/backtests/**` trees
  are gitignored — re-running ingestion or backtests will not pollute
  the repo.

## Deploying to Railway

The V1 site renders entirely from mock data + bundled fixtures, so it
deploys to Railway **without a database**. Postgres is only needed
once you start running the ingestion scripts or the DB-backed backtest
runner.

### 1. Create the project

1. Push this repo to GitHub.
2. In Railway, **New Project → Deploy from GitHub repo** and pick this repo.
3. Railway detects Next.js via the Nixpacks builder. `railway.json` pins
   the build and start commands:
   - **Build:** `npm install && npm run build`
   - **Start:** `npm run start`

   `npm run build` runs `prisma generate && next build` — the Prisma
   client generates from `schema.prisma` without needing a live DB
   connection.

### 2. (Optional) Attach Postgres later

Only do this if you intend to run the DB-backed paths (seed, migrate,
backtest persistence, ingestion ApiUsageLog rows). The web app does
NOT need it.

1. **+ New → Database → PostgreSQL**.
2. Railway injects `DATABASE_URL` into the service.
3. Run migrations manually the first time:
   ```bash
   # locally, against the Railway connection string
   npx prisma migrate dev --name init
   git add prisma/migrations && git commit -m "init prisma migrations"
   git push
   # then on Railway (one-shot job or shell-in)
   npx prisma migrate deploy
   npm run db:seed
   ```

We deliberately do NOT run `prisma migrate deploy` inside the start
command — that would make every container restart depend on a healthy
DB connection, which is fragile and unnecessary for V1.

### 3. Open the deployed app

Railway will assign a public URL — share it from the service's
**Settings → Domains** panel. The dashboard at `/` should render
immediately because V1 reads mock data. The `/backtest` page renders
the static performance summary plus a small "fixture not generated"
hint card; commit a run of `npx tsx scripts/run-backtest-2025.ts
--fixtures` (or wire it into a release step) to populate the live
fixture summary section.

## What's next (post-V1)

- **Wire the ingestion scripts to real sources.** All five scripts run
  end-to-end today but in stub or `--source mock` mode. The nflverse
  Python stub needs its `pull_*` bodies uncommented; the TypeScript
  ingestors all have `--source csv|db` paths ready to consume the
  populated CSVs.
- **CSV → Prisma loader.** A separate script that walks
  `data/processed/*.csv`, resolves player names through `player_ids.csv`,
  and upserts `Team` / `Player` / `Game` / `GameLog` / `PropMarket` /
  `PropQuote` rows. Mapping notes in `scripts/README.md`.
- **Closing-line CLV.** Add a second odds-pull near kickoff so the
  backtest's `clvCents` column can be populated.
- **Per-game retractable-roof state** so `weatherImpactEligible` reflects
  whether the roof was actually open during the game (currently defaults
  to true for retractables).
- **Swap the data layer to Prisma.** `src/lib/data/*` functions today
  read from `mock-data.ts`; each carries a `FUTURE:` comment with the
  Prisma query that will replace it. The UI / pages will not change.
- **Expand to additional markets** (TDs, anytime scorer, longest
  reception, etc.) only once the low-variance core is calibrated.
