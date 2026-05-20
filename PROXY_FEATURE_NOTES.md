# Proxy Football Feature Notes

These notes document the 12 proxy features in
`src/lib/model/proxy-football-features.ts`. Calibration constants and
shared helpers live in `src/lib/model/proxy-football-calibration.ts`.

> **What proxies are.** Educated estimates derived from publicly
> available stat rows: targets, target share, air yards, catch rate,
> snap share, carries, team pass/rush attempts, sacks taken /
> generated, and (when present) EPA-allowed splits.
>
> **What proxies are NOT.** They are not claims of true alignment,
> true coverage shell, true route tree, true pressure rate, or any
> charting / tracking data. Every explanation is prefixed
> `Proxy-based:` precisely so this distinction stays visible.

## General invariants

Every proxy result has the shape:

```ts
{
  value: number;            // 0..1 (clamped)
  confidence: number;       // 0..0.95 (never claims certainty)
  explanation: string;      // ALWAYS starts with "Proxy-based:"
  risk?: string;            // set when confidence is low / fallback / conflict
  tags: string[];           // discrete labels, e.g. SLOT_VOLUME_LIKELY
}
```

There is **no** `recommendation` / `forcedSide` / `direction` field
anywhere in the proxy framework. Proxies cannot, by construction,
force OVER or UNDER recommendations.

## How confidence is calculated

Two-factor model:

1. **Sample-size confidence** (`confidenceFromSampleSize`)
   — weighs games × observations against published minimums:
   `MIN_GAMES_FOR_MEDIUM_CONFIDENCE = 3`,
   `MIN_TARGETS_FOR_MEDIUM_CONFIDENCE = 18`,
   `MIN_DEFENSIVE_PLAYS_FOR_MEDIUM_CONFIDENCE = 150`.
   Below either minimum, sample-size confidence is capped at 0.40.

2. **Signal-agreement confidence** (`confidenceFromSignalAgreement`)
   — multiplies sample-size confidence by how many of the proxy's
   binary "signals" agreed. 0% agreement → 0.40 multiplier; 100% →
   1.00 multiplier.

Final confidence = `sampleConfidence × agreementConfidence`, clamped
to `[0, 0.95]`. Indirect / fallback paths add additional explicit
caps (e.g., the indirect quick-game proxy is capped at confidence
0.55).

## Per-proxy notes

### `slotRoleProxy`

- **Estimates**: probability that a WR is operating in a
  slot-volume / short-area role.
- **Uses**: aDOT, target share, catch rate, snap share.
- **Does not know**: actual alignment, route tree, pre-snap motion,
  coverage faced.
- **Anchors required for "likely" value**: aDOT < 8 *and* target
  share ≥ 12%. Missing either anchor caps value below the
  "likely" band (≤ 0.55).
- **Confidence drops** when sample is thin (< 3 games or < 18
  targets) or when only the aDOT signal fires.
- **Known failure modes**: pre-game offseason / Week 1 evaluation
  (no sample), schemes where a deep-threat WR temporarily runs
  short-area routes due to injury context.

### `deepReceiverProxy`

- **Estimates**: deep-threat role likelihood.
- **Uses**: aDOT, air-yards share, target share.
- **Anchors required**: aDOT ≥ 13 *and* air-yards share ≥ 20%.
- **Known failure modes**: WRs with 2-3 targets at deep aDOT will
  still hit the anchors but should have low confidence due to
  sample size — explicit guard included.

### `possessionReceiverProxy`

- **Estimates**: possession-receiver role (high catch rate,
  mid-range aDOT, meaningful target share).
- **Uses**: aDOT, target share, catch rate, optional weekly
  target-share series.
- **Anchors**: catch rate ≥ 70% *and* target share ≥ 12%.
- **Known failure modes**: target stability factor mitigates but
  doesn't eliminate volatile-route WRs masquerading as possession.

### `rbReceivingRoleProxy`

- **Estimates**: receiving-back usage.
- **Position guard**: returns NOT_APPLICABLE for non-RB.
- **Anchors**: ≥ 2 rec/game *and* ≥ 8% team target share.
- **Known failure modes**: bell-cow backs in pass-funnel games can
  spike for a week — sample-size confidence prevents over-reading.

### `teReceivingRoleProxy`

- **Estimates**: receiving-TE usage.
- **Position guard**: returns NOT_APPLICABLE for non-TE.
- **Anchors**: target share ≥ 12% *or* ≥ 3.5 rec/game.
- **Thin-volume protection**: when targets < 18 the value is
  additionally capped at 0.65 to prevent small-sample false
  positives.

### `targetShareStabilityProxy`

- **Estimates**: how stable a player's target share has been over
  the observed weeks.
- **Uses**: per-week target-share series.
- **Required sample**: ≥ 3 weeks for any meaningful estimate.
- **Meaningfulness multiplier**: a stable 2% share is technically
  stable but **not valuable** — we multiply the stability score
  by `mean(share) / MEANINGFUL_TARGET_SHARE` so tiny-share
  stability lands in low-value territory and gets the
  `TINY_SHARE_NOT_MEANINGFUL` tag.

### `passFunnelProxy`

- **Estimates**: whether a defense is a real pass funnel.
- **Uses**: pass rate faced; EPA per dropback allowed (when
  available).
- **Critical false-positive guard**: a defense facing pass-heavy
  schedules *because it's leading* will have high pass rate
  faced but the EPA-allowed support won't fire. Without EPA
  support, value is capped at 0.58 and the `PASS_FUNNEL_SCRIPT_FALLBACK`
  tag flags the issue. Confidence is also capped at 0.5.
- **Known failure modes**: when only pass rate is observable,
  the result is intentionally a "moderate" signal, not a "likely"
  one.

### `runFunnelProxy`

- **Estimates**: whether a defense is a real run funnel.
- **Uses**: rush rate faced; EPA per rush allowed (when available).
- Same false-positive guard as `passFunnelProxy`.

### `deepPassSuppressionProxy`

- **Estimates**: ability to suppress deep completions.
- **Tier 1 (preferred)**: deep completions allowed vs league
  expected.
- **Tier 2 (fallback)**: EPA per dropback allowed.
- **Tier 3 (weak fallback)**: receiving yards allowed to WR per
  game.
- **Fallback tagging**: `DEEP_SUPPRESSION_FALLBACK` is set
  whenever Tier 2 or 3 was used; confidence is capped at 0.55
  in those cases.

### `pressureRiskProxy`

- **Estimates**: combined offense × defense pressure environment.
- **Uses**: offense sacks taken per dropback, defense sacks
  generated per dropback; optional `blitzPctEstimate`.
- **Always sets the caveat** `Sack rate is an imperfect proxy
  for true pressure rate` in the risk note — sacks lag pressure.
- **One-sided guard**: when only offense OR defense data is
  available, value is capped at 0.55, confidence at 0.45, and
  the `PRESSURE_ONE_SIDED` tag is set.
- **Blitz tag**: `blitz_pressure_proxy` is added only when an
  explicit `blitzPctEstimate ≥ 0.35` is provided.

### `quickGameProxy`

- **Estimates**: whether an offense relies on quick-game / short-
  passing tendencies.
- **Path A (preferred)**: explicit `quickGamePctEstimate`.
- **Path B (indirect)**: high attempts/game + low sack rate.
  Always tagged `QUICK_GAME_INDIRECT`, value capped at 0.75,
  confidence capped at 0.55.

### `rushingVolumeStabilityProxy`

- **Estimates**: stability of weekly rushing attempts.
- **Required sample**: ≥ 3 weeks for any meaningful estimate.
- **Known failure modes**: a backfield committee with stable
  total attempts can still be unstable per-player — this proxy
  is team-level only.

## How backtesting will decide whether each proxy is useful

The proxies do **not** currently feed the scorecard's
qualification math. The decision authority is the existing
scorecard model + the matchup intelligence layer (which is
itself non-forcing). Future integration paths will:

1. Populate `MatchupIntelligenceInput` archetypes from proxy
   tags rather than from manual classification.
2. Score the backtest's `BacktestEvaluatedProp` by proxy
   confidence and per-proxy tag (e.g., separate ROI for plays
   where `SLOT_VOLUME_LIKELY` fired vs didn't).
3. Use the `byPostmortem` breakdown in the existing backtest
   summary to identify whether `FILTER_CORRECTLY_AVOIDED` or
   `FILTER_TOO_CONSERVATIVE` correlates with specific proxy
   tags.

If a proxy correlates well with WIN outcomes on plays where it
fired with high confidence, it stays. If not — even after
multiple weeks of real data — the proxy is removed or its
threshold is recalibrated.

## Reminder

Proxies **support** the scorecard's reasoning and the matchup
intelligence layer's explanation surface. They **do not** force
recommendations. The qualification path is, as always:

1. Scorecard's edge math (no-vig market probability vs model
   probability vs threshold)
2. Scorecard's risk gates
3. Coaching transition threshold bump (if any)
4. Matchup intelligence σ widening (if any) — never narrows

The proxy framework is one rung further upstream — it tells the
matchup intelligence layer which archetypes to use. It is the
right place to encode football knowledge, but it is the **wrong**
place to hide a bet trigger.
