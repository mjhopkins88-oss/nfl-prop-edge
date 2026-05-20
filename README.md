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
# preview — no API calls, key only used for plan printing
ODDS_API_KEY=demo npx tsx scripts/ingest-historical-prop-lines.ts \
  --season 2025 --weeks 1-10 --source mock --dry-run

# live
ODDS_API_KEY=$ODDS_API_KEY npx tsx scripts/ingest-historical-prop-lines.ts \
  --season 2025 --weeks 1-10 --budget 200
```

Pulls one pregame snapshot per game, ~3.5h before kickoff (rounded to the
5-minute grid). Hard-capped at 7 markets (all lower-variance, no TDs) and
`regions=us`. Writes raw events + per-event-odds JSON to
`data/raw/odds-api/` and normalized rows to
`data/processed/prop_markets.csv` + `prop_quotes.csv`. The script aborts
**before any HTTP call** if the estimate exceeds `--budget` (default 200).

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
