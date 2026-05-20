# CLAUDE.md — Project guardrails

Strict rules for any AI assistant or contributor working in this repo.
Read before making changes.

## Two product sections — keep them separate

The app ships with two independent decision tracks. They must not
share decision logic, UI components, or recommendation paths.

1. **Player Props** — the lower-variance prop scorecard. Lives at
   `/` and `/props/[id]`. Decision authority:
   `src/lib/model/model-scorecard.ts`. V1 markets only (see Rule 1).
2. **Game Edge** — the experimental moneyline / spread / upset
   model. Lives at `/game-edge` and `/game-edge/[id]`. Decision
   authority: `src/lib/model/game-edge-model.ts`.

Cross-contamination is the kind of bug that's expensive to undo.
Do not mix the two.

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

## When in doubt

Ask. The model and the guardrails matter more than throughput.
