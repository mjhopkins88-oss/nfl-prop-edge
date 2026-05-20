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

## 2025 backtest

```bash
# default: mock source — synthesizes per-week props from existing logs
npx tsx scripts/run-backtest-2025.ts --season 2025 --weeks 7-10

# also persist to Postgres
DATABASE_URL="$DB_URL" npx tsx scripts/run-backtest-2025.ts \
  --season 2025 --weeks 7-10 --persist

# preview without running the engine
npx tsx scripts/run-backtest-2025.ts --season 2025 --weeks 7-10 --dry-run
```

Backtest pipeline modules (under `src/lib/backtest/`):

- **feature-builder.ts** — turns the prop market + STRICTLY prior weekly
  logs + weather + injuries into typed `PropFeatures`. The orchestrator
  pre-slices logs so the engine can't see future data.
- **projection-engine.ts** — blends recent (60%) + season (40%) mean and
  stddev, applies weather (wind/precip on passing & receiving; rushing
  volume bump in bad weather), injury adjustments (self status, teammate
  boosts, own-OL / opposing-DB depletion, uncertainty widens σ), σ floors,
  and small-sample widening. Returns `{ mean, stddev, reasons, risks,
  roleUncertainty, injuryUncertainty }`.
- **probability-engine.ts** — normal CDF for model over prob, de-juices
  posted American odds to no-vig book prob, signed edge, per-prop-type
  thresholds, pass triggers (role / injury / malformed market), EV on the
  recommended side, and a 0..1 confidence from edge-over-threshold and
  inverse coefficient of variation.
- **grading.ts** — `(rec, line, actual)` → win/loss/push + units staked
  and returned + a Brier component (whether or not we bet).
- **metrics.ts** — aggregates a `GradedPrediction[]` into headline
  ROI / hit-rate / units + `byPropType`, `byConfidence`,
  `byEdgeBucket`, `byWeek` slices + Brier across graded predictions.

Per-prop-type edge thresholds (defined in `probability-engine.ts`):

| Market | Threshold |
| --- | --- |
| `PASSING_ATTEMPTS` | 4% |
| `PASSING_COMPLETIONS` | 4% |
| `RECEPTIONS` | 5% |
| `RUSHING_ATTEMPTS` | 5% |
| `PASSING_YARDS` | 6% |
| `RUSHING_YARDS` | 6% |
| `RECEIVING_YARDS` | 7% |

Outputs always go to `data/backtests/<season>/`:

- `predictions.csv` — every prediction the engine made
- `bets.csv` — qualified bets only (the actionable subset)
- `summary_by_market.csv`, `summary_by_confidence.csv`,
  `summary_by_edge_bucket.csv`, `summary_by_week.csv`

`--persist` additionally upserts `ModelRun`, per-prop `PropPrediction`,
per-qualified `BetCandidate`, and per-`(propType, week)` `BacktestResult`
rows to Postgres.

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

Railway provisions Postgres and runs the Next.js app side-by-side. The flow is:

### 1. Create the project

1. Push this repo to GitHub.
2. In Railway, **New Project → Deploy from GitHub repo** and pick this repo.
3. Railway detects Next.js via the Nixpacks builder. `railway.json` in the root
   already pins the build and start commands.

### 2. Add a Postgres plugin

1. In the same Railway project: **+ New → Database → PostgreSQL**.
2. Railway will inject a `DATABASE_URL` env var into the service. If it doesn't
   wire it up automatically, copy the URL from the Postgres plugin's
   **Connect** tab and add `DATABASE_URL` to the web service's variables.

### 3. Confirm the build + start commands

`railway.json` declares them, but for reference the service should run:

- **Build:** `npm install && npm run build`
- **Start:** `npx prisma migrate deploy && npm run start`

`prisma migrate deploy` runs every deploy so any committed migrations apply
automatically. If you only used `prisma db push` locally, generate a baseline
migration before the first Railway deploy:

```bash
npx prisma migrate dev --name init
git add prisma/migrations && git commit -m "init prisma migrations"
```

### 4. (Optional) Seed mock data on Railway

After the first deploy, run the seed once from your local machine using the
Railway connection string:

```bash
DATABASE_URL="<railway postgres url>" npm run db:seed
```

Or shell into the Railway service and run `npm run db:seed` there.

### 5. Open the deployed app

Railway will assign a public URL — share it from the service's **Settings →
Domains** panel. The dashboard at `/` should render immediately because V1
reads mock data; Postgres becomes meaningful once you start writing real
projection/odds data into `PropMarket`.

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
