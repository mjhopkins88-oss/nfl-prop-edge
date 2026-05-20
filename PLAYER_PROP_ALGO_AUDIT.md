# Player Prop Algorithm Audit — V1

Snapshot of the current player-prop decision path, where it is
disciplined, and where it is exposed to overconfidence or
double-counting. This audit is the basis for the v2 algorithm
improvements that sit alongside (not in place of) the existing
scorecard.

## Where the algorithm is sound

- **Eight risk gates are enforced.** `buildPropDecisionScorecard`
  in `src/lib/model/model-scorecard.ts` evaluates eight risk
  buckets (data quality, role stability, injury context,
  correlation exposure, weather/environment, game script, pace,
  market context) against fixed gate thresholds. Any single bucket
  below its gate disqualifies the play. This is good PASS
  discipline.
- **Coaching uncertainty bumps the edge threshold.** Penalty
  20/40/55/65/75 → edge bump 0.5pp/1pp/1.5pp/2pp/2pp via
  `edgeThresholdBumpFromPenalty`. Coaching can never *qualify* a
  bet — only raise the bar.
- **Matchup intelligence can only widen σ.** Mean multiplier is
  *reported but not applied* to qualification math. σ multiplier is
  clamped ≥ 1.0 so matchup can only make a thin edge thinner — it
  cannot turn a non-qualifying prop into a qualifier.
- **Prop-specific edge thresholds exist.** Yardage markets
  (PASSING_YARDS, RECEIVING_YARDS, RUSHING_YARDS) carry stricter
  thresholds than volume markets, reflecting their higher variance.
- **Backtest feature-builder enforces temporal boundaries.**
  `src/lib/backtest/feature-builder.ts` filters game logs to
  `season < args.season || (season === args.season && week < args.week)`
  before computing rolling features — no in-week leakage in the
  backtest path.

## Where the algorithm is overconfident

- **Market-anchored probability is not consumed.** The module
  `src/lib/model/market-anchored-probability.ts` exists, is
  well-designed (cap discipline, confidence-adjusted edge, market
  disagreement classification), and is used by the Game Edge
  model — but the *player prop scorecard does not invoke it*. Edge
  is computed as a raw `modelOverProbability - noVigOverProbability`,
  uncapped. A projection of 65% OVER on a 50% no-vig line books a
  raw 15pp edge regardless of data quality or confidence.
- **No confidence-adjusted edge gate.** Confidence is calculated
  but is only used to populate a display field. It does NOT scale
  the edge that gets compared to threshold. A 10pp raw edge clears
  a 4pp threshold even if confidence is 0.30.
- **No market-disagreement check.** Large model–market disagreement
  (>10pp) goes unflagged. A proxy-only signal can push model
  probability arbitrarily far from market without triggering an
  overconfidence warning.
- **No line sensitivity / edge fragility check.** A receptions edge
  at line 4.5 might evaporate at line 5.5; the scorecard never
  asks "does this edge survive a 1-line move?"
- **Role stability is checked but not the trend.** The scorecard
  reads a `roleStabilityScore` but does not detect whether the role
  is *expanding* or *declining* — both can look "stable" by a flat
  weekly score.

## Which inputs are actually consumed

| Input | Affects edge math? | Affects gate? | Display only? |
|-------|-------------------|---------------|---------------|
| projectedMean / projectedStdDev | Yes (normal CDF) | — | — |
| noVigOverProbability | Yes (edge baseline) | — | — |
| 8 risk-bucket scores | — | Yes (hard PASS gates) | — |
| edgeThreshold | Yes (qualification) | — | — |
| coachingTransition.penalty | — | Yes (threshold bump) | — |
| matchupAdjustment.σ multiplier | Yes (widens σ, lowers edge) | — | — |
| matchupAdjustment.mean multiplier | **No** | — | Yes (informational) |
| matchupAdjustment.reasons/risks | — | — | Yes |
| proxyResults | **No (indirect via matchup)** | — | Yes |
| marketAnchoredProbability | **No** | — | Yes (passthrough only) |

## Where signals may double-count

- **OL injury appears in two places.** `feature-scoring.ts` injury
  context drops passing mean by 0.97 when offensive line injury ≥
  0.5; `matchup-intelligence.ts` separately reduces passing yardage
  mean by 0.985 when OL continuity risk ≥ 0.5. Both can fire
  together with no deduplication.
- **Pressure can stack with QB injury.** Pressure adjustment in
  matchup intelligence and QB injury context in injury risk are
  independent inputs and can both penalize the same passing yards
  projection.
- **Weather + deep-pass suppression can both penalize yardage.**
  Wind weather (precipitation/wind) widens σ; matchup deep-pass
  suppression also widens σ for receiving/passing yards — same
  underlying "weather kills the deep ball" idea expressed twice.
- **Coaching uncertainty appears as both threshold bump and
  confidence drag.** Threshold bump raises the bar; confidence drag
  separately lowers confidence. Same input, two penalty surfaces.

## Prop-specificity gaps

- **Edge thresholds vary by prop, but most adjustments are
  generic.** Weather, injury, game-script, and coaching adjustments
  apply the same multipliers across prop types. The only
  prop-aware branch in the projection engine is "low total favors
  rushing, hurts passing" — there is no per-prop-type weather
  model, no per-prop role-stability requirement, no per-prop
  market-disagreement tolerance.
- **No prop-type-specific signal weighting.** Receptions and
  passing yards both consume the same input bundle and the same
  threshold-bump logic. Receptions should weight role stability
  heavier; passing yards should weight efficiency heavier; the
  current model does neither.

## Future data-leakage risk

- **`prop-projection-engine.ts` trusts the caller to pre-filter
  game logs.** No explicit guard against this-week-in-this-week
  inputs. Mock data is hand-tuned so the risk is not active today,
  but the moment a live data path is wired up this becomes a real
  exposure.
- **Mock data hardcodes pre-computed probabilities.** No
  season/week stamp validation in the data layer; reasonable for a
  fixture but a footgun for any "promote to live" pathway.

## What the v2 layer adds

The v2 pipeline (additive, opt-in — does **not** replace the
scorecard) closes the gaps above:

- Market is the baseline (market-anchored probability gating)
- Confidence-adjusted edge gate (raw edge alone cannot qualify)
- Market disagreement classification (with overconfidence warning)
- Per-prop-type configuration (thresholds, weights, sensitivities)
- Role-trend detection (expanding / declining / volatile / stable
  / unknown)
- Line sensitivity / edge fragility
- Signal deduplication (category-level cap so the same idea cannot
  fire twice at full weight)
- Centralized qualification with explicit disqualifier priority
- Debug trace per decision

The existing scorecard remains the dashboard's recommendation
source until backtesting validates the v2 thresholds.
