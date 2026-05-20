# CLAUDE.md — Project guardrails

Strict rules for any AI assistant or contributor working in this repo.
Read before making changes.

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

4. **Preserve the scorecard-based decision engine.** The UI and any
   "is this prop a play?" logic must route through
   `src/lib/model/model-scorecard.ts` via
   `src/lib/model/prop-opportunity.ts`. Do not introduce a second
   decision path in the pages. Do not bypass the scorecard to render
   a recommendation.

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
  All four must pass. The synthetic runner must report **20/20**.

## When in doubt

Ask. The model and the guardrails matter more than throughput.
