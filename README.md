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
- **Experimental Game Edge at `/game-edge`.** A SEPARATE experimental
  model for game-level moneyline + spread markets. Surfaces upset
  watch / playable ML / spread value / pass labels. Does not affect
  player prop logic. See the "Experimental Game Edge Model" section
  below.
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
| `DATABASE_URL` | `npm run db:seed`, `npm run db:migrate`, `npm run db:push`, `--persist` paths in ingestion scripts | only for DB-backed paths; **NOT** required for `npm run build`, `npm run start`, or the deployed V1 web app (audited — see "Deploying to Railway") | — |
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

## NFL Historical Data via nflverse

The 2025 backtest pulls football stats from
[nflverse-data](https://github.com/nflverse/nflverse-data) — the
free CSV / Parquet releases backing nflfastR / nflreadr. **No API
key required.** No paid endpoint is touched. The ingestion never
admits touchdown columns: they are dropped at parse time.

### What gets ingested

For each season we pull:

- **schedules** — game IDs, kickoff times, home / away, roof,
  surface, stadium, closing spread + total when published.
- **player weekly stats** (QB / RB / WR / TE only) — attempts,
  completions, passing yards, sacks, rushing attempts / yards,
  targets, receptions, receiving yards, receiving air yards,
  snap / target / air-yards / carry shares, RACR, WOPR. Touchdown
  columns dropped.
- **team weekly stats** — total plays, pass / rush attempts,
  pass / rush rate, seconds per play, points for / against.
- **rosters** — player ID ↔ name / team / position / depth-chart
  rank.
- **snap counts** (optional) — offense snap totals + share.
- **play-by-play summary** (optional) — passing / rushing EPA,
  pressure rate, success rate. Scaffolded for later.

The normalized shape is documented in
`src/lib/ingestion/nflverse-types.ts`.

### Where files live

```
data/raw/nfl/{season}/
    schedules.csv
    player_stats.csv
    team_stats.csv        (optional)
    rosters.csv
    snap_counts.csv       (optional)

data/processed/nfl/
    games.csv
    player_week_stats.csv
    team_week_stats.csv
    rosters.csv
    snap_counts.csv       (when present)
    player_ids.csv

data/fixtures/nfl/
    games.fixture.json
    player-week-stats.fixture.json
    team-week-stats.fixture.json
    rosters.fixture.json
```

The fixture set ships with the repo so the test runner +
backtest scaffolding work on a fresh clone with no downloads.

### How to run ingestion

```
# Default — read raw CSVs from data/raw/nfl, print the plan
npx tsx scripts/ingest-nfl-history.ts --season 2025

# Local mode, actually write processed files
npx tsx scripts/ingest-nfl-history.ts --season 2025 \
    --source local --no-dry-run

# Multi-season range
npx tsx scripts/ingest-nfl-history.ts \
    --start-season 2022 --end-season 2025 --source local

# nflverse network mode — opt-in, dry-run prints URLs only.
# Writing requires ALLOW_NFLVERSE_NETWORK_FETCH=true.
npx tsx scripts/ingest-nfl-history.ts --season 2025 \
    --source nflverse --dry-run
```

The same dry-run-default discipline that protects the paid Odds
API client also gates network fetches here, even though nflverse
is free. CI behaves predictably.

### No-future-data leakage

The loader exports a strict-before predicate used by every
feature builder:

```typescript
isStrictlyBefore({ rowSeason, rowWeek, currentSeason, currentWeek })
// true when rowSeason < currentSeason
//        OR (rowSeason === currentSeason AND rowWeek < currentWeek)
```

Backtesting Week 8 of 2025 means features can read **2022–2024
in full** plus **2025 Weeks 1–7**. Week 8 stats themselves are
the outcome being graded — they never feed the pregame
projection. The convenience helpers
`getPlayerHistoryBeforeWeek`, `getTeamHistoryBeforeWeek`, and
`getGameBySeasonWeekTeam` (in
`src/lib/ingestion/nflverse-loader.ts`) enforce this filter
automatically.

### How this feeds the 2025 backtest

The existing fixture backtest runner (`runBacktest` /
`scripts/run-backtest-2025.ts`) continues to consume the
fixture leg + market data it ships with. The nflverse loader is
additive — once `data/processed/nfl/` is populated, the feature
builder can switch its leg-history source from the
fixture-format player-week data to the nflverse CSVs without
changing model logic. Player Prop, Game Edge, and Parlay
recommendations are unaffected by this change.

### What still needs paid data

The Odds API integration (player-prop closing lines, alt lines,
SGP pricing) remains gated behind
`ALLOW_REAL_ODDS_API_CALLS=true` and is unchanged. nflverse
covers the **player + team stat** side only. No automated
betting was added.

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

## Proxy Football Features

The proxy layer sits one rung upstream of the matchup intelligence
framework. Twelve confidence-scored proxies translate available
stat rows into educated classifications (slot vs deep vs possession
WR, receiving RB / TE, pass-funnel / run-funnel / pressure-heavy /
deep-suppressing defenses, quick-game offenses, stable target
shares, stable rush volume).

### What the proxies are — and what they aren't

- **Approximations from available data.** They use targets, target
  share, air yards, catch rate, snap share, carries, team pass/rush
  attempts, sacks taken / generated, and (when present) EPA-allowed
  splits.
- **Not true route / alignment / coverage / pressure data.** Every
  explanation is prefixed `Proxy-based:` precisely so this stays
  visible at every layer.
- **Confidence-scored.** Sample-size and signal-agreement
  multipliers combine to a final `confidence ∈ [0, 0.95]` — the
  framework never claims certainty.
- **Capped.** `value ∈ [0, 1]`. Indirect / fallback paths add
  explicit per-proxy caps (`PASS_FUNNEL_SCRIPT_FALLBACK`,
  `DEEP_SUPPRESSION_FALLBACK`, `QUICK_GAME_INDIRECT`,
  `PRESSURE_ONE_SIDED`).

### Calibration constants

All thresholds, sample-size floors, and league baselines live in
`src/lib/model/proxy-football-calibration.ts`:

```
LEAGUE_AVG_PASS_RATE_FACED       0.59
LEAGUE_AVG_RUSH_RATE_FACED       0.41
LEAGUE_AVG_SACK_RATE             0.065
LOW_ADOT_THRESHOLD               8
DEEP_ADOT_THRESHOLD              13
MEANINGFUL_TARGET_SHARE          0.12
HIGH_TARGET_SHARE                0.22
MEANINGFUL_AIR_YARDS_SHARE       0.20
HIGH_CATCH_RATE                  0.70
LOW_CATCH_RATE                   0.55
MIN_GAMES_FOR_MEDIUM_CONFIDENCE  3
MIN_TARGETS_FOR_MEDIUM_CONFIDENCE 18
MIN_DEFENSIVE_PLAYS_FOR_MEDIUM_CONFIDENCE 150
MIN_WEEKS_FOR_STABILITY          3
PROXY_CONFIDENCE_MAX             0.95
```

Plus helpers: `confidenceFromSampleSize`,
`confidenceFromPlayerVolume`, `confidenceFromDefenseVolume`,
`confidenceFromSignalAgreement`, `capProxyAdjustment`,
`detectConflictingProxySignals`, `buildProxyAccuracyWarning`.

### False-positive protections

The calibrated framework explicitly defends against these common
bad inferences:

- A low-aDOT WR with 4% target share **does not** become a
  `SLOT_VOLUME_LIKELY` tag — multi-signal anchor (low aDOT *and*
  meaningful TS) caps the value below the "likely" band.
- A high-aDOT WR with only 3 targets in 1 game **does not** earn
  `DEEP_THREAT_LIKELY` — sample-size confidence drops below 0.5.
- A defense facing pass-heavy schedules without EPA support
  **does not** earn `PASS_FUNNEL_LIKELY` — the
  `PASS_FUNNEL_SCRIPT_FALLBACK` tag flags the script-driven case
  and confidence is capped at 0.5.
- A 1-game high-sack sample **does not** earn `PRESSURE_RISK_HIGH`
  — sample-size confidence drops below 0.5.
- A stable 2% target share **does not** earn `STABLE_TARGET_SHARE`
  — the meaningfulness multiplier pushes the value below 0.4 and
  the `TINY_SHARE_NOT_MEANINGFUL` tag fires.

### Backtesting decides what stays

The proxies do **not** feed the scorecard's qualification math.
Backtesting will tell us which proxies correlate with WIN
outcomes when they fire with high confidence. Those stay. Ones
that don't earn their keep get recalibrated or removed. The point
is to build a **disciplined library** of educated approximations,
not to add unverified knobs to the recommendation engine.

### Premium data could replace proxies later

Each proxy's input slice (`PlayerProxyInput`, `OffenseProxyInput`,
`DefenseProxyInput`) is the contract. Real route-charting,
participation, alignment, and tracking data would slot in to
those same shapes when (and only when) the team is ready to spend
on premium sources. The model layer wouldn't need to change.

See `PROXY_FEATURE_NOTES.md` for per-proxy known failure modes,
anchors, and calibration details.

## How We Test Proxy Accuracy

Logical tests prove proxies behave as expected. They don't prove the
proxies are *useful*. That requires three levels of evaluation:

### 1. Logical / unit tests

`scripts/test-proxy-football-features.ts` (59 assertions) and
`scripts/test-proxy-football-calibration.ts` (147 assertions) check
that:

- Each proxy fires on its valid-case profile and stays quiet on its
  false-positive profile.
- Confidence drops with thin samples / fallback data / one-sided
  signals.
- Anchors prevent single-signal hits from claiming "likely" labels.
- Every output is bounded, prefixed `Proxy-based:`, and exposes no
  forcing surface.

### 2. Manual validation against football reality

Spot-check proxy labels for real players the team knows: does a
known slot WR (e.g., a Wes Welker archetype) actually get
`SLOT_VOLUME_LIKELY`? Does a deep specialist register as
`DEEP_THREAT_LIKELY` rather than `POSSESSION_RECEIVER_LIKELY`? Does
a defense facing pass-heavy schedules with positive EPA allowed
flag as a real pass funnel, while one that just leads a lot stays
in `PASS_FUNNEL_SCRIPT_FALLBACK`? This is qualitative — easy to do,
useful as a sanity gate before integration.

### 3. Backtest accuracy validation (this section)

`scripts/test-proxy-validation.ts` runs the fixture backtest, attaches
proxy results to every evaluated prop, and asks: **for plays where
this proxy fired with high value AND high confidence, did ROI
actually improve vs the baseline?**

Outputs land in `data/backtests/2025/`:

- `proxy-performance.fixture.json` — per-proxy summary with value-
  bucket and confidence-bucket slices.
- `proxy-lift.fixture.json` — baseline vs high-value vs
  high-confidence vs both-high ROI, plus a `KEEP` / `RECALIBRATE` /
  `RETIRE` recommendation.
- `proxy-false-positives.fixture.json` — examples where the proxy
  fired strongly but the related bet lost.
- `proxy-false-negatives.fixture.json` — examples where the proxy
  was weak but the bet hit anyway.

The `/backtest` page renders a *Proxy Accuracy* section above the
existing performance cards (best lift, worst lift, false-positive
count, false-negative count, per-proxy lift table, per-proxy
high-confidence performance) whenever those files are present.

### Lift, not vibes

The framework treats each proxy as a **hypothesis**. The data either
supports it or doesn't:

- **Lift ≥ +5pp** (high-both ROI over baseline ROI) and ≥ 3 bets
  on each side → `KEEP`.
- **Lift in (0, +5pp)** or insufficient bet sample → `RECALIBRATE`.
- **Lift ≤ 0** with sufficient sample → `RETIRE`.

If a proxy can't earn its 5pp of lift after enough real data, it
gets recalibrated or removed. The point is to build a **disciplined**
library, not to add unverified knobs.

### Premium data could replace proxies later

Each proxy's input slice is the contract. Real route-charting,
participation, alignment, EPA splits, and tracking data would slot
into the same `PlayerProxyInput` / `OffenseProxyInput` /
`DefenseProxyInput` shapes when the team is ready to spend on
premium sources. The validation framework wouldn't change — only
the inputs would.

## Market-Anchored Probability Layer

Discipline against overconfidence. The framework treats no-vig
market probability as the **baseline** and adds capped football-
context adjustments around it. The output is a "confidence-adjusted
edge" — the disciplined version of the raw model-vs-market
difference.

### Why anchor on the market?

The market has already aggregated sharp opinion, real bankrolls, and
public liquidity. Walking too far from it without strong, agreeing
signals is a classic overconfidence trap. The framework codifies
that discipline in three layers:

1. **Cap by data quality**: if `dataQualityScore < 0.55`, the
   maximum football-side adjustment is **2 percentage points**.
2. **Cap by composite risk**: if `riskScore < 0.55`, the maximum
   adjustment is **3 percentage points**.
3. **Cap by signal agreement + prop type**:
   - Volume props default cap: **8pp**
   - Yardage props default cap: **5pp** (tighter — yardage already
     carries higher base variance)
   - Multiple agreeing independent signals + high confidence
     unlocks up to **10pp** (yardage) or **12pp** (volume)

The lowest applicable cap always wins.

### Confidence-adjusted edge

```
rawEdge = (finalModelProbability − marketProbability) × 100
confidenceAdjustedEdge = rawEdge × confidence-multiplier × risk-multiplier
```

Where:

- `confidence-multiplier = clamp(confidence / 0.7, 0.4, 1.0)`
- `risk-multiplier = clamp(riskScore / 0.7, 0.5, 1.0)`

Result: a 5pp raw edge with high confidence and low risk stays ≈ 5pp.
The same 5pp edge with mediocre confidence and elevated risk shrinks
to ≈ 2–3pp. **The disciplined number is what downstream consumers
should read.**

### Disagreement classification

| Class | Trigger |
|---|---|
| `MARKET_ALIGNED` | `|capped adjustment| < 1pp` |
| `SMALL_EDGE` | `1pp ≤ |capped| < 4pp` |
| `HEALTHY_DISAGREEMENT` | `|capped| ≥ 4pp` AND `confidence ≥ 0.55` |
| `DANGEROUS_DISAGREEMENT` | `|capped| ≥ 4pp` AND `confidence < 0.55` |
| `LIKELY_OVERCONFIDENT` | `|raw adjustment| > 12pp` (pre-cap signal blew past the threshold — even with capping, the underlying mismatch surfaces a warning) |

The `LIKELY_OVERCONFIDENT` class is the key safeguard: the framework
ALWAYS caps the final number, but it also surfaces the warning so
operators can investigate whether the football signals are real or
whether the model is hallucinating an edge that the market didn't
miss.

### Integration

`src/lib/model/market-anchored-probability.ts` is standalone today.
The existing scorecard's recommendation math is **unchanged**. As a
safe touchpoint, `ScorecardInput` accepts an optional
`marketAnchoredProbability` passthrough field that
`buildPropDecisionScorecard()` copies into its output for downstream
display — no decision math reads it.

Future integration would feed the disciplined `confidenceAdjustedEdgePp`
into the scorecard's edge-threshold comparison instead of the raw
edge. That decision is deferred until backtesting confirms the cap
levels are well-calibrated.

### Backtesting determines the cap levels

Like the proxy validation layer, the cap settings here are
hypotheses. Backtesting will eventually tell us whether 2/3/5/8/10/12pp
caps are too tight, too loose, or about right. The intent is to
arrive at cap levels through evidence, not vibes.

## Experimental Game Edge Model

The Game Edge model is a **separate experimental track** for
game-level markets (moneyline + spread). It is not part of the
player prop scorecard and never feeds into player prop
recommendations. Player prop logic is unchanged.

### What it evaluates

For each game it produces:

- per-side moneyline edge and confidence-adjusted edge
- per-side spread cover probability and confidence-adjusted edge
- an upset score (0–100) — descriptive, not prescriptive
- a single recommendation across moneyline vs spread, gated on
  confidence-adjusted edge

Recommendation labels:

- `Strong ML Value` (≥8pp confidence-adjusted ML edge)
- `Playable ML Value` (clears ML threshold but below 8pp)
- `Upset Watch` (high upset score but no price clears threshold)
- `Spread Value` (clears spread threshold)
- `Cover Watch` (positive spread edge below threshold)
- `Pass / No Edge` (no path clears, no upset signal)
- `Pass / Too Much Uncertainty` (data quality or risk too low)

### Why it's separate

Game-level math (full-game win probability, margin-based cover
probability) is fundamentally different from prop-level math (per-
prop volume / yardage projection). Mixing them in one decision path
would obscure both. The Game Edge model:

- lives under `/game-edge` in the UI, labeled "Experimental Game
  Edge Model" and routed independently from the player prop pages
- has its own scorecard type (`GameEdgeScorecard`) and its own
  decision logic (`buildGameEdge` in
  `src/lib/model/game-edge-model.ts`)
- reuses `buildMarketAnchoredProbability` for moneyline cap
  discipline — so it inherits the same anchor + cap behavior as the
  prop model, just applied to full-game win probability

### Market is the baseline

Like the player prop model, the Game Edge model treats market
probability as the baseline. Capped football-context components are
applied around the no-vig market probability — not on top of an
independent point estimate. Same discipline, applied at game level.

### Upset score is descriptive

The upset score (0–100) summarizes how many upset-friendly signals
fire (dog pass-rush advantage, favorite QB instability, weather
compression, dog run-game advantage, favorite coaching uncertainty,
favorite injury risk, dog rest advantage, large spread) and how
many disqualifying signals fire (dog QB instability, dog OL
continuity, dog cannot run, favorite trench dominance, dog cannot
pressure, high total, dog injury risk, low data quality).

A high upset score is a **prompt to look closer**. It does not
force a play. The only way the model recommends a play is if the
confidence-adjusted edge clears its threshold. If the ML is too
expensive (e.g., -650 with only 4pp edge), the model labels it
`Upset Watch` (or `Pass / No Edge`) — never a forced underdog ML.

### Spread and moneyline are independent

Spread cover probability is computed from expected home margin
(log-odds × ~4.5 NFL points per logit) plus an empirical sigma (10
+ adjustments for total / weather / coaching). Cover probability is
a normal-CDF approximation. The spread path can recommend a play
while the moneyline path does not, and vice versa — they are
evaluated as separate candidates and the highest confidence-
adjusted edge wins.

### Recommendation thresholds (initial hypothesis)

| Path                 | Confidence-adjusted edge threshold |
|----------------------|------------------------------------|
| ML favorite          | 3pp                                |
| ML underdog          | 5pp                                |
| ML longshot (<30%)   | 7pp                                |
| Spread (either side) | 4pp (6pp when uncertainty elevated)|
| Upset Watch          | upset score ≥ 55                   |

These thresholds are hypotheses, not certainties. They will be
tuned by backtesting before any live use.

### Key-number awareness

Spreads near key NFL numbers (2.5, 3, 3.5, 6.5, 7, 7.5, 9.5, 10,
10.5, 13.5, 14, 14.5) are flagged with `keyNumberRisk = true`. A
half-point line move at a key number changes cover probability
materially, so any positive cover edge sitting on a key number is
flagged in the risks list.

### Hard PASS gates

- Data quality below 0.45 → `Pass / Too Much Uncertainty`
- Composite risk below 0.45 → `Pass / Too Much Uncertainty`

These mirror the prop scorecard's PASS posture — when the data
isn't good enough, the model doesn't pretend it is.

### Where to find it

- types: `src/lib/model/game-edge-types.ts`
- model: `src/lib/model/game-edge-model.ts`
- display helpers: `src/lib/model/game-edge-scorecard.ts`
- fixture data: `src/lib/model/game-edge-data.ts`
- test runner: `scripts/test-game-edge-model.ts`
- UI: `/game-edge` (list) and `/game-edge/[id]` (detail)

### Status

Experimental. No backtest yet. Fixture-driven. **Do not use for
real bets until the model has been validated against historical
game data** — and even then, this remains a research project, not
investment advice.

## Player Prop Algorithm v2

After auditing the V1 scorecard (see `PLAYER_PROP_ALGO_AUDIT.md`)
we added an opt-in v2 pipeline that closes the gaps the audit
found. **It does not replace the existing scorecard.** The
dashboard still routes through `buildPropDecisionScorecard` while
v2 is being validated against the local backtest. The two paths
run side-by-side; v2 is consumed by the new test runner and by
future backtest analysis.

### Main principle

Market is the baseline. Football intelligence creates capped,
explainable adjustments around the no-vig market probability. The
model is designed to **pass on most props**.

### What's wired in v2

- **Market-anchored probability.** Model probability =
  no-vig market + capped Σ(confidence-weighted signal deltas).
  Per-prop cap (`maxMarketAdjustmentPp` from
  `prop-model-config.ts`) prevents a thin-evidence projection
  from running off into 30pp lifts.
- **Confidence-adjusted edge.** Raw edge alone is not enough.
  Pipeline gates on `confidenceAdjustedEdge = rawEdge × clamp(confidence / 0.7)`
  with a floor of 60% of the prop's base threshold.
- **Risk-adjusted edge.** Further multiplies by data quality,
  role stability, and prop-type volatility to expose
  overconfidence in the trace (the gate uses the conf-adj edge;
  the risk-adj edge is for diagnostics).
- **Role-trend detection.** `role-change-detector.ts` classifies
  the role as `STABLE_ROLE`, `EXPANDING_ROLE`, `DECLINING_ROLE`,
  `VOLATILE_ROLE`, or `UNKNOWN_ROLE`. Tiny but flat usage is
  `UNKNOWN_ROLE`, not "stable". Declining roles disqualify
  receiving + rushing props.
- **Line sensitivity.** `line-sensitivity.ts` computes nearby
  probabilities at line ± 1, plus a key-line risk flag
  (RECEPTIONS 4–7, RUSHING_ATTEMPTS multiples of 2, etc.).
  Yardage props are gated more strictly on fragility.
- **Market disagreement.** `market-disagreement.ts` classifies
  the |model - market| gap and flags
  `LIKELY_MODEL_OVERCONFIDENCE` when the gap is large but
  confidence is low or signal support is proxy-only.
- **Signal deduplication.** `signal-deduplication.ts` groups
  signals by category (`ROLE` / `VOLUME` / `EFFICIENCY` /
  `WEATHER` / `COACHING` / `MATCHUP` / `MARKET` /
  `CORRELATION`) and caps the within-category total at
  1.25 × the dominant signal — so OL injury + opponent pressure
  cannot fire twice at full weight for the same "pressure-sensitive
  QB" idea.
- **Per-prop config.** `prop-model-config.ts` holds prop-specific
  base thresholds, max market adjustment caps, preferred /
  risky signal categories, sensitivity ratings, and confidence
  / data quality floors. RECEIVING_YARDS gates more strictly
  than RECEPTIONS; PASSING_ATTEMPTS prioritizes VOLUME +
  COACHING signals; RUSHING_ATTEMPTS prioritizes ROLE + VOLUME.
- **Centralized qualification.** `prop-qualification.ts`
  enforces the disqualifier priority chain (market data → raw
  edge → confidence-adjusted edge → data quality → role
  stability → injury → weather → coaching → market
  disagreement → line fragility → correlation → prop-specific).
- **Debug trace.** Every decision produces a
  `PlayerPropDecisionTrace` with input / output summary and
  warnings per step (baseline projection, no-vig baseline,
  signal dedup, market-anchored adjustment, side selection,
  line sensitivity, confidence-adjusted edge, market
  disagreement, qualification). Used by the future trace UI
  and by the test runner's assertions.

### How proxies, matchup, and coaching plug in

- Proxies and matchup intelligence supply `DedupSignal` objects
  with explicit `category`, `deltaPp`, `confidence`, and
  `independent` flags. The pipeline weights them by confidence
  before summing — a 10pp signal at 0.3 confidence contributes
  3pp, not 10pp.
- Coaching uncertainty (0–100 penalty) bumps the edge threshold
  AND drags the raw model probability via a separate
  `coachingDragPp`. The dedup cap prevents the two from
  compounding within the same category.
- Proxy-only or matchup-only signals never carry enough
  confidence to push the model 12pp from market — the
  disagreement classifier flips to `LIKELY_MODEL_OVERCONFIDENCE`
  and the qualification gate hard-PASSes.

### Why v2 is opt-in for now

Backtesting will decide which modules stay, which thresholds
move, and which signals get weakened. The existing scorecard is
unchanged so the dashboard's recommendations are stable while
v2 thresholds are validated. The two paths can be compared
on the same input bundle by calling both `buildPropDecisionScorecard`
and `runPlayerPropPipeline` from the same data.

### Where to find it

- Audit: `PLAYER_PROP_ALGO_AUDIT.md`
- Per-prop config: `src/lib/model/prop-model-config.ts`
- Role trend detector: `src/lib/model/role-change-detector.ts`
- Line sensitivity: `src/lib/model/line-sensitivity.ts`
- Confidence-adjusted edge: `src/lib/model/confidence-adjusted-edge.ts`
- Market disagreement: `src/lib/model/market-disagreement.ts`
- Signal deduplication: `src/lib/model/signal-deduplication.ts`
- Centralized qualification: `src/lib/model/prop-qualification.ts`
- Pipeline orchestrator: `src/lib/model/player-prop-pipeline.ts`
- Test runner (22 scenarios): `scripts/test-player-prop-algo-audit.ts`

## V1 vs V2 Player Prop Backtesting

The Player Prop Algorithm v2 pipeline is opt-in for the backtest
runner. The dashboard still uses V1 (`buildPropDecisionScorecard`)
for its recommendations. The backtest comparison mode lets us
measure V2 head-to-head on the same fixtures before we even
consider changing the default.

### What V1 and V2 mean here

- **V1 (`V1_SCORECARD`)** — the existing scorecard path. Raw edge
  `modelOverProbability - noVigOverProbability` compared to a
  prop-specific threshold, with eight risk-bucket gates and
  matchup σ widening. No confidence-adjusted edge gate, no
  line-sensitivity gate, no market-disagreement classifier.
- **V2 (`V2_PIPELINE`)** — the disciplined pipeline added during
  the algorithm audit:
  - **Market anchoring.** Model probability is the no-vig market
    probability plus a capped, confidence-weighted sum of
    football signals (per-prop cap from
    `prop-model-config.ts`).
  - **Confidence-adjusted edge.** Raw edge × clamp(confidence /
    0.7). The gate uses the conf-adj edge, not the raw edge.
  - **Line sensitivity.** Nearby-line probabilities at ±1; yardage
    props gated more strictly on fragility.
  - **Role-trend detection.** STABLE / EXPANDING / DECLINING /
    VOLATILE / UNKNOWN. Tiny but flat usage = UNKNOWN.
  - **Market-disagreement classification.** Flags
    `LIKELY_MODEL_OVERCONFIDENCE` when |model − market| > 12pp
    and confidence / DQ are below 60%.
  - **Signal deduplication.** Within-category cap so the same
    "pressure-sensitive QB" idea can't fire twice at full weight.

V2 only becomes a candidate default if backtesting shows
improvement on ROI, hit rate, and / or risk-adjusted profit
across the markets we care about.

### How to run the comparison

The runner's `--algorithm-mode` flag picks the path:

```
# default — existing scorecard
npx tsx scripts/run-backtest-2025.ts --fixtures --algorithm-mode v1

# opt-in v2 pipeline
npx tsx scripts/run-backtest-2025.ts --fixtures --algorithm-mode v2

# A/B both algorithms on the same fixtures
npx tsx scripts/run-backtest-2025.ts --fixtures --algorithm-mode compare
```

`compare` mode writes four files to `data/backtests/2025/`:

- `v1-summary.fixture.json` — full V1 summary
- `v2-summary.fixture.json` — full V2 summary
- `v1-v2-comparison.fixture.json` — delta summary
  (evaluated / qualified / hit rate / ROI / profit / per-prop /
  per-line / per-confidence / per-edge / per-disqualifier deltas)
- `recommendation-changes.fixture.json` — per-prop
  classification: `SAME_BET` / `V1_BET_V2_PASS` /
  `V1_PASS_V2_BET` / `OPPOSITE_SIDE` /
  `SAME_PASS_DIFFERENT_REASON` /
  `SAME_RECOMMENDATION_DIFFERENT_CONFIDENCE`, plus the top "new
  V2 disqualifiers" — the gates V2 added that V1 wouldn't have
  fired.

### What the dashboard shows

When `data/backtests/2025/v1-v2-comparison.fixture.json` exists,
the `/backtest` page renders an **"Algorithm comparison (V1 vs
V2)"** panel above the proxy accuracy section: V1 / V2 tiles
for qualified bets, hit rate, ROI, profit, plus the
recommendation-change ledger and top new V2 disqualifiers. The
panel is hidden when no comparison file is present, so this is
purely additive — the existing dashboard stays unchanged.

### What stays untouched

- The dashboard's player prop recommendations still flow through
  V1 (`buildPropDecisionScorecard`). No V2 logic touches `/` or
  `/props/[id]`.
- The Game Edge model is fully separate; this comparison only
  applies to player props.
- No paid APIs, no live refresh, no touchdown markets, no
  automated betting were introduced.

### Test runner

`scripts/test-v1-v2-backtest-comparison.ts` runs the fixture
backtest in all three modes and asserts:

- V1 mode echoes `V1_SCORECARD` and attaches no v2 metadata
- V2 mode echoes `V2_PIPELINE` and exposes
  `confidenceAdjustedEdge`, `riskAdjustedEdge`,
  `lineSensitivityLabel`, `marketDisagreementClassification`,
  `roleTrendClassification`, and a `debugTrace` with ≥ 10 steps
- Compare mode produces v1Summary, v2Summary, deltaSummary, and
  a recommendation-change ledger whose counts sum to the total
  evaluated
- Every evaluated propType is a V1 market (no touchdown
  contamination)

## Experimental Correlated Parlay Model

A third decision track for the app, **completely separate** from
Player Props and Game Edge. Lives at `/parlays`. Builds 2-leg
correlated parlays from V1 player prop legs, scores joint
probability with capped correlation adjustments, and surfaces
only parlays where confidence-adjusted EV is positive and projected
hit rate clears the required-for-10%-ROI threshold.

### Separation from existing sections

- **Does not affect** the player prop dashboard (`/`, `/props/[id]`)
  or the player prop scorecard (`buildPropDecisionScorecard`).
- **Does not affect** the Game Edge dashboard (`/game-edge`,
  `/game-edge/[id]`) or the Game Edge model (`buildGameEdge`).
- Lives in its own module namespace (`src/lib/model/parlay-*.ts`),
  its own route tree (`src/app/parlays/`), its own scorecard type
  (`ParlayScorecard`), and its own test runner
  (`scripts/test-parlay-model.ts`).

### Joint probability

Per-parlay joint probability is built in two steps:

1. **Independent joint probability** = product of per-leg model
   probabilities.
2. **Correlation-adjusted joint probability** applies a capped
   relative lift / drag based on the per-parlay `correlationScore`
   (signed −1..+1):
   - max upward lift: 15% relative
   - max downward drag: 20% relative
   - low confidence shrinks the adjustment toward independent
   - UNKNOWN correlation produces near-zero adjustment

### Correlation adjustment

Correlation is detected from player relationships, prop types,
side direction, and game environment:

- **Positive**: QB + same-team receiver yards/receptions same
  side, same-player RB attempts + yards, weather UNDER stacks.
- **Negative / conflicting**: same-team QB OVER + RB attempts
  OVER in low-volume games, multiple WR OVERs from the same team
  (overstacking).
- **Weak / unknown**: different-game pairings, sparse signal.

The cap discipline matches the player prop v2 pipeline's
market-anchored philosophy: correlation can help, but it can also
be overestimated, so it is never allowed to inflate joint
probability without bound.

### Expected value

```
EV = correlationAdjustedJointProbability × combinedDecimalOdds − 1
```

Confidence-adjusted EV multiplies EV by shrinkage factors for low
leg confidence, low data quality, high risk, unknown correlation,
overstacking, line fragility, and same-game exposure. Shrinkage
can only ever pull EV closer to zero — it never inflates.

A parlay only qualifies when **both** raw EV and
confidence-adjusted EV are positive.

### Hit-rate target math

The dashboard surfaces the average payout multiplier required to
hit a target ROI across a batch of parlays. The math:

```
requiredPayoutMultiplier = (1 + targetRoi) / expectedHitRate
```

`payoutMultiplier` is total payout (stake + profit). For
`targetRoi = 0.10`:

| Hit rate | Required average payout |
|---------:|------------------------:|
| 15.0%    | 7.33x                   |
| 17.5%    | 6.29x                   |
| 20.0%    | 5.50x                   |

These are theoretical. They must be validated by backtesting
before any live use.

### Qualification gates

A parlay qualifies only if **all** of the following hold:

- every leg is a V1 player prop (no touchdown props admitted)
- every leg has acceptable confidence, data quality, and
  confidence-adjusted edge on its own
- combined raw EV > 0 and confidence-adjusted EV > 0
- projected hit rate ≥ required-for-10%-ROI hit rate
- correlation type is not CONFLICTING
- no leg fragility / data-quality / role-stability hard fail
- no same-team receiver overstacking

**High payout alone never qualifies a parlay.** Correlation alone
never qualifies a parlay. The EV gate and the hit-rate gate are
both required.

### UI

- `/parlays` — Experimental Correlated Parlay Model dashboard.
  Hero with summary tiles, target-batch math panel (15% / midpoint /
  20% target rates), filter tabs (all / qualified / correlated
  watch / pass / QB-WR / RB / weather-under / high-payout / low-risk),
  one card per parlay candidate with combined odds, payout multiplier,
  projected vs required hit rate, EV + conf-adj EV, correlation
  badge, recommendation, top reason, top risk.
- `/parlays/[id]` — Per-parlay detail with leg breakdown,
  correlation analysis, probability + payout math, EV + hit-rate
  math, reasons / risks / disqualifiers, what would change the
  recommendation, target batch math, and final explanation.

### No live wagering

The app does not place bets and does not connect to any
sportsbook or trading interface. The Parlay Builder is research
only.

### Where to find it

- Types: `src/lib/model/parlay-types.ts`
- Config: `src/lib/model/parlay-config.ts`
- Probability + odds math: `src/lib/model/parlay-probability.ts`
- Correlation: `src/lib/model/parlay-correlation.ts`
- EV: `src/lib/model/parlay-ev.ts`
- Builder + qualification: `src/lib/model/parlay-builder.ts`
- Fixtures (23 legs, 16 candidates): `src/lib/model/parlay-data.ts`
- Display helpers: `src/lib/model/parlay-scorecard.ts`
- Test runner (18 scenarios + invariants):
  `scripts/test-parlay-model.ts`
- UI: `/parlays` and `/parlays/[id]`

## Parlay Algorithm Audit and Optimization

After shipping the Correlated Parlay Model we audited the
algorithm and added safe, additive improvements. The audit is in
`PARLAY_ALGO_AUDIT.md`. Player Prop and Game Edge recommendations
are unchanged.

### What the audit confirmed

- Math is sound. Conversions verified
  (`americanToDecimal(+150) = 2.50`, `-120 = 1.833`).
  Required-payout math at 10% ROI: 15% → 7.33x, 17.5% → 6.29x,
  20% → 5.50x.
- The correlation adjustment is a multiplicative simplifier
  on independent joint probability — bounded, monotone, and
  easy to backtest, but it understates correlation at small
  joint probabilities and overstates at large. Worth replacing
  with a proper joint Bernoulli / Gaussian copula once we have
  historical joint outcomes.
- The confidence-adjusted-EV shrinkage product stacks seven
  multiplicative factors. Aggressive on paper — re-tune once
  the backtest runner exists.
- Same-team WR/TE overstacking, conflicting game scripts,
  fragile yardage lines, and standalone-unqualified legs are
  all hard disqualifiers.
- No touchdown propTypes, no automated betting, no APIs at any
  point in the parlay namespace.

### What the audit added (safe, additive)

- **Risk profile classification** (`parlay-risk-profile.ts`).
  Every parlay gets one of `LOW_VARIANCE_CORRELATED`,
  `MEDIUM_VARIANCE_CORRELATED`, `HIGH_VARIANCE_YARDAGE`,
  `HIGH_PAYOUT_LONGSHOT`, `UNKNOWN_CORRELATION`, `OVERSTACKED`,
  or `FRAGILE_LINES`. Variance / fragility / overstacking
  scores are read-only and surfaced on the UI.
- **Parlay-type strength** (`parlay-type-strength.ts`). Each
  parlay type carries a strength score, a band
  (STRONG / MODERATE / EXPLORATORY / RESEARCH_ONLY), risk
  notes, and the data we still need to validate it. Useful
  for explaining to a human why some structures are likely
  already book-priced vs. genuinely novel.
- **Target-batch math + simulator** (`parlay-target-math.ts`).
  `calculateRequiredHitRateForROI`,
  `calculateRequiredPayoutForTargetROI`,
  `calculateProjectedROI`, `classifyPayoutHitRateFit`,
  `simulateParlayBatch`, `simulateParlayCandidateBatch`.
  Deterministic. Used by the strategy-health panel and the
  audit tests.
- **Portfolio optimizer** (`parlay-selection-optimizer.ts`).
  Caps same-game / same-QB / same-correlation-story exposure
  across the surviving qualified parlays. Removes duplicate-
  leg exposure. Surfaces a `ParlayPortfolioSummary` with
  strongest / weakest parlay type and the most common pass
  reason.
- **Postmortem tags** (`parlay-postmortem.ts`). Defines the
  vocabulary (`GOOD_READ_BAD_VARIANCE`,
  `CORRELATION_OVERESTIMATED`, `ONE_LEG_ANCHOR_FAILED`,
  `GAME_SCRIPT_FAILED`, `WEATHER_READ_FAILED`,
  `ROLE_ASSUMPTION_FAILED`, `LINE_TOO_FRAGILE`,
  `PAYOUT_TOO_LOW`, `HIGH_PAYOUT_TRAP`, `OVERSTACKED_FAILURE`,
  `FILTER_CORRECTLY_AVOIDED`, `FILTER_TOO_CONSERVATIVE`) +
  a deterministic tagger that fires from a tag-input shape.
  No caller yet; ready for the future backtest runner.
- **New ParlayType enum entries** —
  `QB_COMPLETIONS_RB_RECEPTIONS`,
  `QB_ATTEMPTS_SHORT_AREA_RECEPTIONS`,
  `QB_UNDER_RB_OVER_GAME_SCRIPT`,
  `TE_FUNNEL_STACK`,
  `PRESSURE_CHECKDOWN_STACK`,
  `NON_CORRELATED_EV_PAIR`,
  `ALT_LINE_CANDIDATE`,
  `ANTI_PUBLIC_FADE_STACK`.
  Types are surfaced through `parlayTypeLabel` and the
  parlay-type strength bundle; logic-side classifier still
  falls back to `CUSTOM` until the candidate is tagged
  explicitly (or the data fixtures supply role / route /
  pressure tags).
- **Reserved backtest types** — `ParlayBatchSimulation`,
  `ParlayPortfolioSummary`. `ParlayBacktestResult` extended
  with optional `riskProfile` + `postmortemTags`.
- **Strategy Health panel + "Why this could fail"** on the
  `/parlays` dashboard. Per-card variance / fragility /
  payout-fit / projected-ROI / type-strength chips. No
  changes to Player Props or Game Edge UI.

### Operating principles

- Parlays are higher variance than straight props. Treat them
  as a separate budget.
- Judge parlays by joint probability, confidence-adjusted EV,
  hit-rate vs payout, and drawdown — not by gross payout.
- Obvious correlations may already be in the book's SGP price.
  The strongest edges may come from less obvious correlation
  stories where the book is still treating the legs as
  independent.
- Parlay selection should be portfolio-based, not "bet every
  qualified parlay." The portfolio optimizer enforces this.
- Everything here is experimental. Backtest it before any
  live use. The app does not place bets automatically and
  never will without explicit user permission.

### Where to find it

- Audit document: `PARLAY_ALGO_AUDIT.md`
- Risk profile: `src/lib/model/parlay-risk-profile.ts`
- Type strength: `src/lib/model/parlay-type-strength.ts`
- Target math + simulator: `src/lib/model/parlay-target-math.ts`
- Portfolio optimizer:
  `src/lib/model/parlay-selection-optimizer.ts`
- Postmortem tags: `src/lib/model/parlay-postmortem.ts`
- Audit test runner: `scripts/test-parlay-algo-audit.ts`
- UI: `/parlays` (Strategy Health + Why-could-fail panels).

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

### Postgres connection audit (current state)

| Check | Status |
|---|---|
| `DATABASE_URL` required to deploy? | **No.** `npm run build` runs `prisma generate && next build`; `prisma generate` reads `env("DATABASE_URL")` from the schema but does not connect, so the env var can be unset. `npm run start` (`next start`) does not connect either — no page imports `@prisma/client`. Verified with `env -u DATABASE_URL npm run build`. |
| `DATABASE_URL` documented? | **Yes.** `.env.example` marks it OPTIONAL with the exact list of scripts that need it. The required-env-vars table above echoes that. |
| Prisma migrations committed? | **No** — `prisma/migrations/` does not exist. Only `schema.prisma` and `seed.ts` are committed. `prisma migrate deploy` would be a no-op until you've run `prisma migrate dev --name init` locally and committed the migration files. |
| `package.json` scripts run `prisma generate` correctly? | **Yes.** `postinstall` and `build` both invoke it. `prisma generate` is the only Prisma step in the deploy path and works without `DATABASE_URL`. |
| Pre-deploy `prisma migrate deploy` required on Railway? | **No** for V1. There are no migrations to apply, and the web app does not need any tables. Adding it later is optional and explicit (see step 2.3 below). |
| Web app runs without database tables? | **Yes.** The dashboard (`/`), prop detail pages (`/props/[id]`), `/backtest`, `/game-edge`, `/game-edge/[id]`, `/parlays`, `/parlays/[id]` all render off `mock-data.ts` and committed fixture JSON. `src/lib/prisma.ts` is unused by the web bundle today. |

### 1. Create the web service

1. Push this repo to GitHub.
2. In Railway, **New Project → Deploy from GitHub repo** and pick this repo.
3. Railway detects Next.js via the Nixpacks builder. `railway.json` pins
   the build and start commands:
   - **Build:** `npm install && npm run build`
   - **Start:** `npm run start`

   `npm run build` runs `prisma generate && next build`. The Prisma
   client generates from `schema.prisma` without needing a live DB
   connection.
4. Open the deployed URL from **Settings → Domains**. The dashboard
   at `/` should render immediately because V1 reads mock data.
   `/backtest` renders the static summary plus the fixture summary if
   `data/backtests/2025/backtest-summary.fixture.json` is committed.

That's it for the V1 deploy. No Postgres needed.

### 2. (Optional) Attach Postgres

Only do this if you intend to run the DB-backed paths:
- `npm run db:seed`
- `npm run db:migrate`
- `--persist` flags on ingestion scripts
- Future DB-backed backtest runner

#### 2.1 Add the Postgres service

In your Railway project: **+ New → Database → PostgreSQL**. Wait for
the service to become healthy.

#### 2.2 Reference `DATABASE_URL` from the app service

In your **web service → Variables**, add a *reference variable*:

- **Name:** `DATABASE_URL`
- **Value:** click the variable-picker, select your Postgres service's
  `DATABASE_URL` (Railway exposes this automatically).

Reference variables are preferred over copying the connection string —
they stay in sync if Railway rotates the URL. The web service redeploys
automatically when the variable changes.

#### 2.3 Bootstrap the schema (one-time)

Migrations are **not committed** to the repo yet, so neither
`npx prisma migrate deploy` nor a Railway pre-deploy hook will do
anything useful out of the box. Choose one path:

**Path A — develop migrations locally (recommended).**

```bash
# locally, with DATABASE_URL pointing at the Railway DB
npx prisma migrate dev --name init
git add prisma/migrations && git commit -m "init prisma migrations"
git push origin main

# then once on Railway (one-shot job or shell into the service)
npm run db:migrate    # = prisma migrate deploy
npm run db:seed       # optional sample-data seed
```

After this you can opt in to running `npm run db:migrate` as a Railway
**pre-deploy command** (Settings → Deploy → "Pre-Deploy Command") if
you want migrations applied on every release. Until you do, releases
will not touch the DB.

**Path B — `prisma db push` (no migration history).**

```bash
npm run db:push       # = prisma db push
```

Faster but skips the migration history. Fine for spike work; commit
real migrations before relying on the schema in production.

#### 2.4 Re-deploy

Pushing to `main` (or clicking **Redeploy** in Railway) picks up any
new variables and config. The build step still does not require
`DATABASE_URL` — it just becomes available at runtime when scripts run.

### Why no `prisma migrate deploy` in the start command

The start command does not run `prisma migrate deploy` deliberately.
That would make every container restart depend on a healthy DB
connection, which is fragile for a V1 deploy that doesn't need the
database at all. Make migrations an explicit one-shot step (or a
pre-deploy command once migrations exist).

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
