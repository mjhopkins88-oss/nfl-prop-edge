# 2025 Historical Backtest Plan

The first real evaluation of the model. This document is the
single source of truth for what we are testing, what we are
*not* testing, what counts as a pass, and what counts as a
"model is not ready" signal.

## Objective

Prove or disprove that the NFL Prop Edge V1 scorecard (and the
optional v2 pipeline) carries an explainable, repeatable edge
on lower-variance player props during the 2025 NFL regular
season. Use historical data only. Make a clean go / no-go
decision for any further investment before we even discuss live
2026 usage.

## Scope

- **Season:** 2025 NFL regular season only (Weeks 1–18).
- **Replay style:** Week-by-week. For each Week N, the feature
  builder may use 2022–2024 in full plus 2025 Weeks 1…N−1.
  Week N stats themselves are the grading outcome and never
  leak into the projection.
- **Markets — first cut (4 starter markets):**
  - `player_pass_attempts`
  - `player_pass_completions`
  - `player_receptions`
  - `player_rush_attempts`
- **Markets — explicitly deferred** (yardage variance is too
  high for a starter pass):
  - `player_pass_yds`
  - `player_reception_yds`
  - `player_rush_yds`
- **Game Edge** (moneyline / spread / upset) is **not** part of
  this 2025 plan. Game Edge is research-only until it has its
  own historical backtest.
- **Parlay Builder** is evaluated separately and is **not**
  required to pass for the 2025 player-prop test to pass.

## Intentionally excluded

- Live 2026 automation. No live odds polling. No live betting.
- Real-time injury APIs. We use stored `injury_flags.csv` and
  pre-game injury context only.
- Kalshi execution. We do not connect to Kalshi for any market
  in this plan.
- Automated betting / trading anywhere.
- Touchdown props (`anytime_td`, `first_td`, pass / rush /
  rec TD overs). Excluded across the whole repo and dropped at
  ingestion parse time.
- Any new paid API beyond the controlled Odds API historical
  test plan documented in the README's
  "Historical Odds Ingestion Staging Plan" section.

## Data pipeline (stored-data-only at backtest time)

```
nflverse historical stats
    ↓ (scripts/ingest-nfl-history.ts)
data/processed/nfl/*.csv  (no future data — strict-before filter)

historical Odds API prop lines  ← dry-run by default
    ↓ (scripts/ingest-historical-prop-lines.ts)
data/processed/prop_markets.csv  +  prop_quotes.csv

weather snapshots               ← Open-Meteo (free, dry-run by default)
    ↓ (scripts/ingest-weather-history.ts)
data/processed/weather/...

injury_flags.csv                ← committed CSV, no network
    ↓
data/manual/injury_flags.csv

ALL OF THE ABOVE → feature builder → model projections →
scorecard decisions → grading → performance breakdowns
```

The backtest runner reads stored / fixture data only. It does
not call the Odds API or any paid endpoint directly. Ingestion
populates the data layer; the runner consumes it.

## Week 1 starter-test workflow

The fastest way to dry-run the whole 2025 system end-to-end. Uses
the dedicated Week-1 fixture set under
`data/fixtures/backtest/week-1/` so the existing fixture backtest
is unaffected.

### Step 1 — View the pregame board

```bash
npm run dev
# then open http://localhost:3000/backtest/week-1
```

The page renders with the bundled fixtures; the runner step
below populates the richer panels (graded results, V1 vs V2,
parlay + game-edge previews).

### Step 2 — Run the starter simulation

```bash
npx tsx scripts/run-week-1-starter-test.ts
```

Writes:

- `data/backtests/2025/week-1-pregame.fixture.json`
- `data/backtests/2025/week-1-results.fixture.json`
- `data/backtests/2025/week-1-v1-v2-comparison.fixture.json`
- `data/backtests/2025/week-1-parlay-preview.fixture.json`
- `data/backtests/2025/week-1-game-edge-preview.fixture.json`

### Step 3 — Review the Model Monitor

```bash
# Still on `npm run dev`
# Open http://localhost:3000/monitor
```

The monitor reads the files above and shows overall health,
week-by-week performance, prop-type / line / edge / confidence
breakdowns, V1 vs V2 deltas, proxy lift, Game Edge counts, and
parlay portfolio health.

### Step 4 — Only after dry-run + smoke test

Once the dry-run path and the fixture week-1 test look right,
stage real stored Week 1 data:

```bash
# Smoke first (cheap — verify the call plan).
npx tsx scripts/ingest-historical-prop-lines.ts \
    --scope smoke-test --source mock --dry-run

# Then opt in.
ALLOW_REAL_ODDS_API_CALLS=true \
    npx tsx scripts/ingest-historical-prop-lines.ts \
    --scope week --week 1 --execute

# Backtest from stored data once it lands.
npx tsx scripts/run-week-1-starter-test.ts
```

**Do not run a full-season backtest until the smoke test and the
one-week test are validated.** The pre-live rule still applies —
no live 2026 use until a clean explainable edge is demonstrated.

## CLI command reference

### Dry-run before any paid call

```bash
# Print the call plan + credit estimate, write nothing.
npx tsx scripts/ingest-historical-prop-lines.ts \
    --scope smoke-test --source mock --dry-run
```

### Paid smoke test (later — opt-in, gated)

```bash
# Minimal credit footprint. Requires the env-flag opt-in.
ALLOW_REAL_ODDS_API_CALLS=true \
    npx tsx scripts/ingest-historical-prop-lines.ts \
    --scope smoke-test --execute
```

### One-week historical pull (later — opt-in, gated)

```bash
ALLOW_REAL_ODDS_API_CALLS=true \
    npx tsx scripts/ingest-historical-prop-lines.ts \
    --scope week --week 1 --execute
```

### Backtest from fixtures (any time, free)

```bash
# Default V1 scorecard mode.
npx tsx scripts/run-backtest-2025.ts --fixtures

# Opt-in V2 pipeline mode.
npx tsx scripts/run-backtest-2025.ts --fixtures \
    --algorithm-mode v2

# A/B comparison — writes v1-summary, v2-summary,
# v1-v2-comparison, and recommendation-changes fixtures.
npx tsx scripts/run-backtest-2025.ts --fixtures \
    --algorithm-mode compare
```

### NFL historical stats ingestion (free, no API key)

```bash
# Print plan only — works in CI.
npx tsx scripts/ingest-nfl-history.ts --season 2025 \
    --source nflverse --dry-run

# Read raw CSVs you've staged under data/raw/nfl/{season}/.
npx tsx scripts/ingest-nfl-history.ts --season 2025 \
    --source local --no-dry-run
```

## API credit protection

- The Odds API client (`src/lib/ingestion/odds-api.ts`) defaults
  to dry-run. Real calls require both
  `ALLOW_REAL_ODDS_API_CALLS=true` AND the runner's `--execute`
  flag.
- Every batch passes through `credit-estimator.ts` before any
  network call. Estimated credit cost is logged.
- `src/config/api-budget.ts` defines monthly call ceilings. The
  runner refuses to start a batch that would breach the budget.
- All paid calls are cached under `data/cache/odds-api/` so the
  same request never bills twice.
- nflverse ingestion is **free** but is also gated behind
  `ALLOW_NFLVERSE_NETWORK_FETCH=true` for CI predictability.
- The backtest runner never calls a paid API directly. If
  ingestion has not run, the runner errors out instead of
  fetching anything.

## Success metrics

Win rate alone is not enough. We measure all of:

### Player prop targets (starter markets)

| Metric | Target |
|---|---|
| Hit rate on qualified bets | 53%–55%+ depending on average odds |
| ROI (units) | Positive over a meaningful sample |
| Sample size | ≥ 60 qualified bets across the four starter markets before any conclusion |
| Brier score | Lower than a market-baseline Brier on the same slate |
| Calibration | High-confidence bucket > medium > low (monotone) |
| Per-prop-type ROI | At least 3 of 4 starter markets non-negative |
| Per-line-bucket ROI | Performance is broadly distributed, not concentrated in one bucket |
| Per-edge-bucket ROI | Bigger model edges produce bigger realised edges (monotone) |
| Disqualifier performance | When the gates fire on a PASS, the counterfactual outcome should be ≥ a baseline of acting on every lean |
| V1 vs V2 | V2 either improves ROI / calibration *or* meaningfully filters weak V1 plays (lower exposure, similar ROI) |
| Max drawdown | Within a tolerance that lets unit staking survive |

### Parlay targets (evaluated separately)

- Hit rate clears break-even at the parlay's payout band
  (`requiredHitRate = (1 + targetROI) / payoutMultiplier`).
- Confidence-adjusted EV > 0 on qualified parlays.
- Portfolio-level exposure caps actually constrain selection.
- **Parlay results are not required for V1 to pass.** They are
  an additional surface; treat the parlay layer as research
  during the 2025 cycle.

## Failure metrics — "model is not ready"

Any of the following blocks live 2026 consideration:

- High-confidence bucket underperforms low-confidence bucket.
- V2 pipeline adds complexity but does not improve ROI *and*
  does not improve calibration *and* does not reduce exposure.
- One prop type drives all the ROI; the other three are
  negative or near-zero.
- Edge only shows up on a sub-50 bet sample size.
- Large model-vs-market disagreements lose more than they win.
- Proxy framework contributes noise rather than lift in the
  validation report.
- Parlay hit rate does not clear required hit rate even before
  shrinkage.
- Any future-data-leakage is detected after the run (any row
  not strict-before its current week).

## Pre-live rule

**No live 2026 use of any model in this repo — Player Props,
Game Edge, or Parlay Builder — until the 2025 historical test
shows a clean, explainable edge across the success metrics
above.** "Clean" means the wins are not concentrated in one
edge case, the disqualifier framework actually saved losses,
calibration is monotone, and the result holds up after
the v1-vs-v2 comparison.

Live 2026 considerations are a separate plan written *after*
the 2025 verdict.

## What we do after the 2025 test

Three branches based on the verdict:

1. **PASS — clean edge.** Write a follow-on plan: live-2026
   gating, ingestion automation, alerting, monitoring,
   stake-sizing discipline. Do not start that work until this
   plan resolves.
2. **MIXED — partial edge.** Tighten what worked, retire what
   didn't, redo the 2025 test with the narrower model. No
   live consideration until the narrower model passes cleanly.
3. **FAIL.** Document the failure modes, write up what we
   learned, and stop. Better to know than to act on a noisy
   read.

## Operating reminders

- Backtest must use stored / committed data only — no paid
  API calls from the runner.
- Run the dry-run smoke test before any paid Odds API pull.
  The estimator's number should be tiny.
- Don't expand market coverage until the four starter markets
  show a clean, explainable result.
- Touchdown props are out of scope for the entire repo, not
  just this plan.
- Player Props, Game Edge, and Parlay Builder stay separate
  decision tracks. Don't cross-contaminate them while chasing
  a win.
