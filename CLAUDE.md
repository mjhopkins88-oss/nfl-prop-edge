# CLAUDE.md — Project guardrails

Strict rules for any AI assistant or contributor working in this repo.
Read before making changes.

## Current focus — 2025 historical testing only

The single goal right now is the **2025 historical backtest**.
See `2025_BACKTEST_PLAN.md` for scope, success / failure metrics,
CLI commands, and the pre-live rule.

While that test is running:

- Do **not** add live-2026 automation. No live odds polling. No
  live betting. No real-time injury APIs. No Kalshi execution.
- Do **not** add new paid APIs. The only paid integration is the
  controlled Odds API historical pull plan documented in the
  README.
- **Protect Odds API credits.** Every ingestion run defaults to
  dry-run. Real calls require both `ALLOW_REAL_ODDS_API_CALLS=true`
  AND the runner's `--execute` flag. Run a smoke test before any
  larger historical pull.
- The backtest runner **uses stored data only.** It does not
  call any paid API directly.
- **Pre-live rule:** No live 2026 use of Player Props, Game Edge,
  or Parlay Builder until the 2025 historical test produces a
  clean, explainable edge.

## Three product sections — keep them separate

The app ships with three independent decision tracks. They must
not share decision logic, UI components, or recommendation paths.

1. **Player Props** — the lower-variance prop scorecard. Lives at
   `/` and `/props/[id]`. Decision authority:
   `src/lib/model/model-scorecard.ts`. V1 markets only (see Rule 1).
2. **Game Edge** — the experimental moneyline / spread / upset
   model. Lives at `/game-edge` and `/game-edge/[id]`. Decision
   authority: `src/lib/model/game-edge-model.ts`.
3. **Parlay Builder** — the experimental correlated 2-leg parlay
   model. Lives at `/parlays` and `/parlays/[id]`. Decision
   authority: `src/lib/model/parlay-builder.ts`. Parlay success
   is **not** required for the 2025 player-prop test to pass.

Cross-contamination is the kind of bug that's expensive to undo.
Do not mix the three.

## Hard rules

1. **No touchdown props in V1.** Anytime scorer, first TD scorer, pass
   TD / rush TD / rec TD overs are out of scope. Do not add the prop
   types, do not ingest TD columns, do not seed TD rows. V1 is
   restricted to the 7 lower-variance markets only:
   `PASSING_ATTEMPTS`, `PASSING_COMPLETIONS`, `PASSING_YARDS`,
   `RECEPTIONS`, `RECEIVING_YARDS`, `RUSHING_ATTEMPTS`,
   `RUSHING_YARDS`.

2. **No paid API calls without explicit user permission.** The Odds
   API, Kalshi, and any other priced endpoint must not be hit
   automatically. If a task seems to require one, stop and ask.

3. **Paid API scripts default to dry-run.** Every ingestion script
   that can incur cost must default to dry-run mode (preview the
   request, print the credit estimate, write nothing). Real calls are
   opt-in via an explicit flag or env var
   (e.g. `ALLOW_REAL_ODDS_API_CALLS=true`). Do not flip the default.

4. **Preserve the scorecard-based decision engine for player props.**
   The player prop UI and any "is this prop a play?" logic must
   route through `src/lib/model/model-scorecard.ts` via
   `src/lib/model/prop-opportunity.ts`. Do not introduce a second
   decision path in the player prop pages. Do not bypass the
   scorecard to render a recommendation.

5. **Keep V1 focused on the 7 lower-variance markets.** No expanding
   the `PropType` enum, no adding new markets to mock data, no
   surfacing markets that V1 doesn't support — even speculatively.

6. **Backtest runner uses stored data only.** `run-backtest-2025.ts`
   and the `src/lib/backtest/*` modules must read from Postgres /
   committed CSVs. They must not call paid APIs directly. Ingestion
   happens out-of-band, into the DB, behind the dry-run guard.

7. **Keep Railway deployment separate from local algorithm work.**
   Local development must not require Railway, a live Postgres, or
   any external service. The dashboard runs off mock data; the
   synthetic test runs pure CPU. Don't add deploy-only dependencies
   to the algorithm modules.

8. **Game Edge is separate from player props.** The Game Edge model
   lives at `/game-edge`, uses its own types
   (`src/lib/model/game-edge-types.ts`), its own decision logic
   (`src/lib/model/game-edge-model.ts`), and its own display
   helpers (`src/lib/model/game-edge-scorecard.ts`). It must not
   feed into player prop recommendations and player prop logic must
   not flow into it. The Game Edge upset score is **descriptive
   only** — a high upset score does not force a bet. Moneyline and
   spread are evaluated independently inside the Game Edge model:
   one can be a play while the other is a pass.

9. **Parlay Builder is separate from player props and Game Edge.**
   The parlay model lives at `/parlays`, in the
   `src/lib/model/parlay-*.ts` namespace. It consumes evaluated
   player-prop legs but never writes back into player-prop
   recommendations. It never touches Game Edge. High payout alone
   never qualifies a parlay; correlation alone never qualifies a
   parlay; confidence-adjusted EV must be positive AND projected
   hit rate must clear the required hit rate. No bets are placed.

10. **Backtest is 2025-only and stored-data-only.** The first
    historical evaluation runs on the four starter player-prop
    markets only — `PASSING_ATTEMPTS`, `PASSING_COMPLETIONS`,
    `RECEPTIONS`, `RUSHING_ATTEMPTS`. Yardage markets stay deferred.
    Game Edge is out of scope for this backtest. Parlay results
    are evaluated separately and are not required to pass. See
    `2025_BACKTEST_PLAN.md`.

## Soft conventions

- Default to no comments; only justify the non-obvious WHY.
- Prefer editing existing files to adding new ones.
- Don't create planning, status, or summary `.md` files unless asked.
- For UI changes, verify the dashboard renders before claiming done.
- Before committing, run all four checks:
  ```
  npx tsc --noEmit
  npm run lint
  npx tsx scripts/test-synthetic-model.ts
  npm run build
  ```
  All four must pass. The synthetic runner must report **N/N** (every
  scenario passing). New scenarios may be appended; the count today
  is 22.

  When working on the Game Edge model, also run:
  ```
  npx tsx scripts/test-game-edge-model.ts
  ```
  It must report 12 / 12 scenarios passing.

  When working on the Parlay Builder, also run:
  ```
  npx tsx scripts/test-parlay-model.ts
  npx tsx scripts/test-parlay-algo-audit.ts
  ```
  They must report 18 / 18 and 21 / 21 passing respectively.

  When touching ingestion or the backtest data layer, also run:
  ```
  npx tsx scripts/test-nflverse-ingestion.ts
  npx tsx scripts/test-backtest-fixtures.ts
  npx tsx scripts/test-backtest-tracking.ts
  npx tsx scripts/run-backtest-2025.ts --fixtures
  ```
  Default fixture backtest output must remain 7 qualified bets,
  85.7% hit, +63.6% ROI, +4.45 units until a real historical
  run lands.

## When in doubt

Ask. The model and the guardrails matter more than throughput.
