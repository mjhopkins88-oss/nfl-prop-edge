# Odds API Credit Audit

Crash analysis + corrected pricing model for the paid smoke test
that aborted on the first event-odds call. Written without any
new paid API calls.

## The crash

The paid smoke test reached the first event-odds call for
`2025-w1-dal-at-phi` and aborted with:

```
ABORT mid-run: actual credits 41 exceed estimate 5 by >10% (cap 5.5)
```

Run plan reported up front:
- estimated credits: 71
- new API calls required: 23
- max allowed credits: 200

## What "41 vs 5" actually means

Tracing `scripts/ingest-historical-prop-lines.ts` (the
`checkOverageOrFloor` call sites at lines 1080 + 1142):

| State | Variable | Value at abort |
|---|---|---|
| Cumulative estimate | `creditsUsedEstimated` | **5** |
| Cumulative actual | `creditsUsedActual` | **41** |
| Per-call actual (last header) | `oddsRes.usage.last` | **40** |
| Per-call estimate (this odds call) | `INGESTION_MARKETS.length` | 4 |
| Abort threshold | `5 × CREDIT_OVERAGE_ABORT_RATIO (1.1)` | 5.5 |

So:

- The **41** is the cumulative actual credits used so far in this
  run: 1 for the events-list call + 40 for the first event-odds
  call.
- The **5** is the cumulative estimate at the same point: 1 + 4.
- The check is **cumulative-vs-cumulative**, not cumulative-vs-
  per-call. The code's logic is correct; the abort triggered
  because per-call actual was ~10× per-call estimate, so
  cumulative actual blew past the cumulative cap on the very
  first sample.

## Why the per-call estimate was wrong

The Odds API charges historical event odds at **a per-market per-
region rate that depends on market category**. Standard markets
(h2h / spreads / totals) cost ~1 credit per (market × region).
Player-prop markets (`player_*`) cost meaningfully more —
documented at **10 credits per market per region** under the
current historical-pricing tier.

The smoke pulled 4 player-prop markets in 1 region:
`player_pass_attempts, player_pass_completions, player_receptions,
player_rush_attempts`.

- Estimator assumed: 4 × 1 × 1 = **4** credits per event-odds call.
- The actual bill: 4 × 1 × 10 = **40** credits per event-odds call.

The `EVENT_ODDS_PER_MARKET_PER_REGION` constant in
`src/lib/ingestion/odds-api.ts` was set to 1, and
`CREDITS_PER_EVENT_ODDS_UNIT` in
`src/lib/ingestion/credit-estimator.ts` was the same. Both
under-counted player-prop calls by 10×.

## Run cost projection under the corrected model

Same plan with the corrected pricing (10 credits per player-prop
market × region):

- events-list calls: 14 × 1 = 14 credits
- event-odds calls: 16 × 4 × 10 = 640 credits
- **Total estimate: 654 credits**, far above the 200-credit
  `MAX_ODDS_API_CREDITS_PER_RUN` cap.

The full Week 1 ingestion as planned is **out of budget** under
the corrected model. Either the per-run cap must rise to ~700,
or the run must narrow (fewer markets, fewer events) — and that
decision should wait for a calibration result.

## The corrected credit model

1. **Per-market rate is market-tier-aware.** Anything starting
   with `player_*` uses
   `HISTORICAL_PLAYER_PROP_CREDITS_PER_MARKET = 10`. All other
   markets stay at 1.
2. **Pre-call budget guard.** Before each event-odds call we
   compute the projected cumulative actual and refuse to fire
   if that would push past `--max-credits` (default
   `MAX_ODDS_API_CREDITS_PER_RUN`). Refusal happens **before**
   the request is sent — no surprise spend.
3. **Calibration mode** (`--calibration`): stops after one
   events-list call + one event-odds call, regardless of how
   many games matched. Caps the run at
   `SMOKE_CALIBRATION_MAX_CREDITS = 50`. Persists the observed
   per-market rate to a calibration JSON so subsequent runs can
   re-estimate honestly.
4. **The cumulative overage check stays as-is.** It correctly
   compares cumulative actual to cumulative estimate; the bug
   was upstream in the per-call estimate, not in the
   comparison. The 1.1× slack is fine — and now actually fits
   the corrected model.

## Recommended next smoke

Use the new calibration mode (now the default for the admin
paid-smoke action):

```
--season 2025 --scope smoke-test --calibration --execute
```

Expected cost under the corrected model: **41 credits**
(1 events-list + 4 markets × 10). The 50-credit ceiling refuses
to spawn anything larger. After it lands, inspect the resulting
`data/admin-ingestion/latest-odds-calibration.json` to confirm
the actual per-market rate before unlocking the Week 1 run.

## ApiUsageLog warning

`prisma.apiUsageLog.create` emitted
"The table `public.ApiUsageLog` does not exist in the current
database." in the same run. The script handles the failure
softly — it logs a warning and continues with JSONL-only usage
logging at `data/raw/api-usage/<run-id>.jsonl`. That JSONL file
is the canonical record on Railway today.

The `ApiUsageLog` model lives in `prisma/schema.prisma` (line
316) but the table wasn't created on the Railway database —
typical when `npx prisma migrate deploy` was never run there.
Two ways to silence it:

1. Run `npx prisma migrate deploy` against the Railway
   `DATABASE_URL` to create the table. The model then captures
   every paid call in Postgres in addition to JSONL.
2. Leave it as-is. JSONL is sufficient for V1; the warning is
   already non-fatal.

This audit doesn't force option 1 — option 2 is documented in
the admin docs so the warning isn't mistaken for a real
failure.
