# NFL Prop Edge — ingestion scripts

Python scripts that prepare historical NFL data for the backtest pipeline
and for seeding the Postgres database.

## What's here

| File | What it does |
| --- | --- |
| `ingest-nfl-history.py` | Pulls `schedules`, `player weekly stats`, `play-by-play`, `snap counts`, and `players/rosters` from nflverse and writes normalized CSVs. V1 is a stub — it writes schema-only CSVs and notes exactly where the `nflreadpy` / `nfl_data_py` calls plug in. No API keys required. |
| `requirements.txt` | Python deps. The scaffold uses stdlib only; the wrappers (`nflreadpy` or `nfl_data_py`) are commented and ready to enable. |

## Usage

The scaffold runs end-to-end today and produces empty schema-only CSVs:

```bash
# stdlib only — no install needed for the stub
python3 scripts/ingest-nfl-history.py --season 2025 --weeks 1-10

# dry-run logs what would be pulled without writing files
python3 scripts/ingest-nfl-history.py --season 2025 --weeks 1-10 --dry-run

# all weeks of a season
python3 scripts/ingest-nfl-history.py --season 2024
```

Outputs land under `data/`:

```
data/
  raw/         # raw frames straight from each source (one file per pull)
  processed/   # normalized CSVs — schema is stable, see below
    games.csv
    player_week_stats.csv
    team_week_stats.csv
    snap_counts.csv
    player_ids.csv
```

The `processed/` shape is the contract with the downstream Prisma
loader. Schema changes here need a paired Prisma migration.

## CSV → Prisma mapping

V1 covers lower-variance markets only. **No touchdown columns** are
ingested — `pass_tds`, `rush_tds`, `rec_tds`, etc. are dropped at
normalization time and never reach Postgres.

Existing Prisma models (see `prisma/schema.prisma`):
`Team`, `Player`, `Game`, `PropMarket`, `PropQuote`, `Projection`,
`ModelRun`, `BacktestResult`, `GameLog`.

### `games.csv` → `Game`

| CSV column | Prisma field on `Game` | Notes |
| --- | --- | --- |
| `game_id` | `id` (string) | Use the nflverse id (e.g. `2025_11_KC_BUF`) as the Prisma primary key — keeps cross-table joins stable. |
| `season` | `season` | int |
| `season_type` | _(new)_ | Add `seasonType: SeasonType` enum (REG, POST) in a follow-up migration if/when post-season props are ingested. Not required for V1. |
| `week` | `week` | int |
| `kickoff_utc` | `kickoff` (DateTime) | ISO-8601 UTC; parse with `new Date(...)`. |
| `home_team` | `homeTeamId` | Resolve to `Team.id` via `Team.abbreviation` upsert. |
| `away_team` | `awayTeamId` | Same. |
| `home_score`, `away_score` | _(new)_ | Add `homeScore` / `awayScore` (Int?) when settling. Out of scope for the initial loader. |
| `stadium`, `roof`, `surface` | _(new)_ | Stadium metadata; optional cols on `Game`. |
| `spread_line`, `total_line` | _(new)_ | Closing market lines; useful priors for the projection model. Add as `closingSpread` / `closingTotal` (Float?). |

### `player_week_stats.csv` → `GameLog`

| CSV column | Prisma field on `GameLog` | Notes |
| --- | --- | --- |
| `player_id` | `playerId` | Match on canonical nflverse `gsis_id`. Resolve via `player_ids.csv` if upstream `Player.id` differs. |
| `season` | `season` | |
| `week` | `week` | |
| `season_type` | _(skip for V1)_ | Filter to REG before insert in V1. |
| `team` | _(skip — already on Player)_ | If a player was traded mid-season, the team field here is the team they played for that week, which can disagree with `Player.team`. Capture later via a separate `RosterWeek` table. |
| `opponent` | `opponentAbbr` | Already a string in the current schema. |
| `position` | _(skip — already on Player)_ | |
| `passing_attempts` | `passingAttempts` | |
| `passing_completions` | `passingCompletions` | |
| `passing_yards` | `passingYards` | |
| `receptions` | `receptions` | |
| `receiving_yards` | `receivingYards` | |
| `targets` | _(new)_ | Add `targets Int @default(0)` on `GameLog` in a follow-up migration. Targets are a key prior for receptions / receiving yards models. |
| `rushing_attempts` | `rushingAttempts` | |
| `rushing_yards` | `rushingYards` | |
| `snaps_offense` | _(new)_ | Add `snapsOffense Int?` on `GameLog` to skip a second join. Cheap to denormalize. |

Loader upsert key: `(playerId, season, week)`.

### `team_week_stats.csv` → _(new model)_ `TeamGameLog`

Not yet in the Prisma schema. Suggested model:

```prisma
model TeamGameLog {
  id                  String   @id @default(cuid())
  teamId              String
  season              Int
  week                Int
  opponentAbbr        String
  playsOffense        Int
  playsDefense        Int
  passAttemptsOff     Int
  passAttemptsDef     Int
  rushAttemptsOff     Int
  rushAttemptsDef     Int
  passingYardsOff     Int
  passingYardsDef     Int
  rushingYardsOff     Int
  rushingYardsDef     Int
  secondsPerPlayOff   Float
  scoreOff            Int
  scoreDef            Int

  team                Team     @relation(fields: [teamId], references: [id])

  @@unique([teamId, season, week])
  @@index([season, week])
}
```

Used by the projection model for matchup adjustments (pass-rate-over-
expectation, opponent yards-per-attempt allowed, pace). Add when wiring
the real loader.

### `snap_counts.csv` → join target for `GameLog`

For V1 the snap fields live on `GameLog` (`snaps_offense` denormalized
from this file). If we later want defense / ST detail we'll promote it
to its own `SnapCount` model. Upstream `pfr_player_id` needs a mapping
through `player_ids.csv` to reach `gsis_id`.

### `player_ids.csv` → `Player`

| CSV column | Prisma field on `Player` | Notes |
| --- | --- | --- |
| `player_id` | `id` | Canonical nflverse `gsis_id`. |
| `full_name` | `fullName` | |
| `first_name`, `last_name` | _(skip — derived)_ | Use only `fullName` in V1. |
| `position` | `position` (enum) | Coerce to `Position` enum; rows outside QB/RB/WR/TE drop on insert. |
| `current_team` | resolves to `teamId` | Via `Team.abbreviation`. |
| `birth_date`, `jersey` | `jersey` only for V1 | Birth date is optional metadata; add `birthDate DateTime?` later if needed. |
| `gsis_id`, `esb_id`, `nflverse_id`, `pfr_id`, `sleeper_id`, `espn_id` | _(new optional cols)_ | Add nullable string columns on `Player` (or a separate `PlayerExternalId` table) when we start joining against PFR / Sleeper / ESPN feeds. Storing them at ingest time is much cheaper than re-resolving later. |

Loader upsert key: `Player.id` (= `player_id`).

## Loader (not built yet)

A separate script — e.g. `scripts/load-csvs.ts` — will read the
`data/processed/` CSVs and upsert via Prisma. It will:

1. Upsert `Team` rows first (from any abbreviation seen in `games.csv`).
2. Upsert `Player` rows from `player_ids.csv`.
3. Upsert `Game` rows from `games.csv`.
4. Upsert `GameLog` rows from `player_week_stats.csv` (joined with
   `snap_counts.csv` for `snaps_offense`).
5. (Future) Upsert `TeamGameLog` rows from `team_week_stats.csv`.

Idempotent on the upsert keys called out above.
