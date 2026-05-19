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
- Tailwind CSS (dark sports-analytics theme)
- Prisma ORM with PostgreSQL
- Deployed on Railway

## Project layout

```
src/
  app/
    layout.tsx           # Global shell + header
    page.tsx             # Dashboard (server component, filters in URL)
    props/[id]/page.tsx  # Prop detail page
    globals.css          # Tailwind + theme tokens
  components/
    Header.tsx
    PropFilters.tsx      # Client component, writes filters to URL
    PropTable.tsx
    StatCard.tsx
    TeamBadge.tsx
    EdgeBadge.tsx
    RecommendationPill.tsx
    ConfidenceMeter.tsx
  lib/
    mock-data.ts         # Teams, players, games, props, game logs, alt lines
    prop-utils.ts        # Label/format/odds-math helpers
    prisma.ts            # Singleton Prisma client (for future real-data work)
    types.ts             # Shared domain types
prisma/
  schema.prisma          # Postgres schema (Team / Player / Game / PropMarket / GameLog)
  seed.ts                # Loads mock-data into Postgres
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

- Replace `src/lib/mock-data.ts` with Prisma queries against `PropMarket`.
- Integrate an odds feed (e.g. The Odds API, BettingPros, or a sportsbook
  scraper) and persist quotes per book.
- Build a projection pipeline (workload + matchup-adjusted means) writing to
  `Projection` rows tied to each `PropMarket`.
- Add user accounts, watchlists, and notifications when a tracked prop
  crosses an edge threshold.
- Expand to additional markets (TDs, anytime scorer, longest reception, etc.)
  once the low-variance core is calibrated.
