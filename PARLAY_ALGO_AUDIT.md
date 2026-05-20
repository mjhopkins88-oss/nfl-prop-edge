# Parlay Algorithm Audit

Snapshot audit of the Experimental Correlated Parlay Model.
Focused on math soundness, correlation discipline, opportunity
coverage, variance handling, and what we'd want to know before
ever pointing it at live data.

The Parlay Builder remains research-only. No bets are placed. No
APIs are called. Player Props and Game Edge recommendations are
unaffected.

## A. Current parlay model summary

**What it does today:**
- Builds 2-leg (optionally 3-leg) parlays from a pool of evaluated
  player prop legs (`PARLAY_LEG_FIXTURES`).
- Computes joint probability as the product of leg model
  probabilities, then applies a capped correlation adjustment.
- Computes raw EV = `correlationAdjustedJointProbability ×
  combinedDecimalOdds − 1`.
- Applies a confidence shrinkage to produce
  `confidenceAdjustedExpectedValue`.
- Disqualifies parlays where any leg fails the standalone gate,
  where same-game receiver overstacking fires, where projected
  hit rate trails required hit rate at the 10% ROI target, or
  where line fragility is too high.
- Ranks surviving candidates by conf-adj EV → joint probability →
  risk score → data quality → payout multiplier.

**What it does NOT do:**
- Place bets. Quote books. Interact with Kalshi.
- Touch Player Prop or Game Edge recommendations.
- Use real / paid API data.
- Admit touchdown propTypes (`V1_PROP_TYPES` guard).

**How it stays separate:**
- Module namespace: `src/lib/model/parlay-*.ts`.
- Route tree: `src/app/parlays/*`.
- Scorecard type: `ParlayScorecard` (distinct from
  `PropDecisionScorecard` and `GameEdgeScorecard`).
- Test runner: `scripts/test-parlay-model.ts`.

**How it avoids automated betting:**
- No client / SDK / wallet integration anywhere in the parlay
  module set.
- Hero banner and footer disclaim "research only, no bets placed."
- Backtest types are reserved-only (`ParlayBacktestResult`); no
  runner exists yet.

## B. Math audit

### Conversions
- `americanToDecimal(+150) = 2.50` ✓
- `americanToDecimal(-120) = 1 + 100/120 = 1.833` ✓
- `impliedProbabilityFromAmerican(-110) = 110/210 = 0.5238` ✓
- `impliedProbabilityFromAmerican(+260) = 100/360 = 0.2778` ✓

### Combined odds
- `combineDecimalOdds([1.909, 1.833]) = 3.499` — product, correct.
- `decimalToAmerican(3.499) = +250` — correct (since ≥ 2,
  positive American = (decimal − 1) × 100).

### Joint probability
- `independentJointProbability` = `∏ modelProbability` for the
  legs. **Correct under independence assumption.**
- `correlationAdjustedJointProbability` =
  `clamp(indep × (1 + capped × shrinkage), 0.001, 0.999)`.
  - `capped` = positive: `score × 0.15`, negative: `score × 0.20`.
  - `shrinkage` = `clamp(confidence / 0.85, 0.3, 1.0)`.
  - Adjustment is **multiplicative on independent joint**. This
    is a simplified copula-substitute. It's monotone and bounded,
    which is good. It assumes correlation effects scale with the
    independent probability, which understates correlation when
    indep is small and overstates when indep is large; flag for
    future refinement when we have historical joint-outcome data.

### EV
- `expectedValue = correlationAdjustedJointProbability × combinedDecimalOdds − 1`
  — standard payout-multiplier form, correct.
- `confidenceAdjustedExpectedValue = EV × Π shrinkages`:
  confidence, data quality, risk, fragility, correlation type,
  overstacking, conflicting script, same-game leg count.
  Multiplicative; can only pull EV toward zero. **Correct
  monotonicity**, but the shrinkage product can drop EV very
  quickly with many small factors (potential over-shrinkage
  risk — flag for tuning once we have backtest data).

### Required hit rate / payout
- `requiredHitRate = (1 + targetROI) / payoutMultiplier`.
- `requiredPayoutMultiplier = (1 + targetROI) / expectedHitRate`.
- Numeric verification with `targetROI = 0.10`:
  - 15.0% hit rate → 1.10 / 0.15 = **7.3333** ≈ 7.33x ✓
  - 17.5% hit rate → 1.10 / 0.175 = **6.2857** ≈ 6.29x ✓
  - 20.0% hit rate → 1.10 / 0.20 = **5.5000** = 5.50x ✓

### Flags
1. The `correlationAdjustedJointProbability` is multiplicative on
   independent. A more careful model is a Gaussian copula or a
   joint Bernoulli with a known ρ. The current approach is fine
   for V1 but should be backtested against historical joint
   outcomes once we have data.
2. The shrinkage product for `confidenceAdjustedExpectedValue`
   stacks 7 multiplicative factors. With every factor at 0.85
   the cumulative shrinkage is 0.32. That's aggressive. Re-tune
   from backtest evidence.
3. `decimalToAmerican` returns 0 if `decimal ≤ 1`. Not reachable
   for a real parlay but flag the guard.

**Math verdict: sound, with documented simplifying assumptions.**

## C. Correlation audit

**Handled today:**
- POSITIVE (≥ 0.35), NEGATIVE (≤ -0.35), WEAK (in between),
  CONFLICTING (conflicting script fires), UNKNOWN
  (|score| < 0.05).
- Same-game receiver overstacking (≥ 2 receivers OVER same team
  → `overstackingRisk = true` → disqualifier).
- Conflicting script (same-team QB OVER + RB OVER with
  plays < 64 or pass rate < 0.6 → `conflictingScript = true`).
- Different-game pairs default to WEAK with score 0.
- Confidence shrinkage on the adjustment cap.

**Where the model may overstate correlation:**
1. **Same-team QB + WR yards stack** (+0.55 score → caps to
   +15% lift). Realistic correlation is closer to ρ = 0.3–0.4
   for the alpha receiver. The cap is reasonable in magnitude
   but **books already price same-game parlay legs through their
   own correlated joint pricing** — our model will compete with
   that. Flag for "edge already in price" backtest sanity.
2. **QB completions + WR receptions** (+0.50). High; same
   caveat — books typically correlate this.
3. **Same player rushing attempts + yards** (+0.60). This is
   genuinely high correlation (yards = attempts × ypc, so attempts
   directly drive yards). Cap is correct, but should NEVER be
   stacked together if the book offers an "alt yards at this
   carry count" type product — that's the same idea sold twice.
4. **Cross-team UNDER stack on weather** (+0.30). Reasonable but
   weather signal can be partial — we should weight by the
   minimum weather risk across both legs, not the maximum.
5. **Pressure + checkdown stack** (+0.30). Genuinely real but
   pressure-induced checkdown rate is highly QB-dependent. The
   constant +0.30 score is too uniform.
6. **Pairwise sum** — for 3-leg parlays, we sum pairwise scores
   without normalization. A 3-leg pass stack adds three +0.55
   pairs → score 1.65 → clamped to 1.0. That's overstated
   relative to a "weakest link" model.

**Recommendation:** when building 3-leg parlays, divide pairwise
score by `nC2` (number of pairs) instead of summing raw, OR
apply a per-leg-count penalty. Also flag for backtest: does the
cap+confidence shrinkage produce realistic joint hit rates?

## D. Leg quality audit

**Enforced today (`qualifyParlayCandidate`):**
- `confidence ≥ MIN_LEG_CONFIDENCE` (0.55).
- `dataQualityScore ≥ MIN_LEG_DATA_QUALITY` (0.55).
- `|confidenceAdjustedEdge| ≥ MIN_LEG_CONFIDENCE_ADJUSTED_EDGE`
  (2.5pp).
- Standalone `leg.qualified === true` (or PASS_LEG_NOT_QUALIFIED
  fires).
- Line fragility ≤ `MAX_LEG_LINE_FRAGILITY` (0.85).

**NOT yet enforced at the leg level:**
- **Injury context score** — only propagates into the leg's own
  qualified flag, which is fine if the upstream model handled it
  but unclear when fixtures bypass that gate.
- **Role stability score** — same issue; ride-along on
  `leg.qualified`.
- **Market disagreement classification** — leg-level disagreement
  is not surfaced to the parlay builder. A leg with
  `LIKELY_MODEL_OVERCONFIDENCE` could still pass.
- **Side mismatch** — the leg type doesn't enforce that
  `modelProbability` actually points toward the chosen side.
  Fixtures rely on the builder to set this honestly.

**Bad-leg sneak risk:** moderate. The confidence + DQ + conf-adj
edge gates are tight enough to block most failures, but a leg
that "looks fine" on paper (high confidence, plausible DQ) but
with a SUSPICIOUS market disagreement could be selected. Flag for
future fix: thread the v2 pipeline's edge-quality + market-
disagreement classifications through to the parlay builder.

## E. Variance audit

**Implicit variance handling:**
- Confidence-adjusted EV shrinks for high-fragility legs.
- Confidence-adjusted EV shrinks for unknown correlation.
- Same-game leg count ≥ 3 trims by 0.85.

**Not handled:**
- **3-leg-vs-2-leg variance** — only the same-game factor fires.
  3 independent legs at 0.6 probability each have a joint
  probability of 0.216, with combined variance contributions
  multiplied. The current shrinkage does not differentiate
  enough.
- **Yardage-heavy parlays** — no explicit penalty when 2+ legs
  are yardage props. Yardage CV is higher than volume CV; this
  should attract a variance multiplier.
- **Deep WR stacks** — currently treated the same as any WR
  yardage stack. Deep receivers have wider game-to-game variance
  even at the same modelProbability.
- **High-payout / low-hit-rate parlays** — covered by the
  required-hit-rate gate, but the long-tail variance is not
  surfaced to the UI.

**Recommendation:** add a `varianceScore` (0..1) and a
`fragilityScore` (0..1) on the parlay output. Use them to slice
the portfolio (next section) and to surface risk profiles on the
UI.

## F. Bet-type opportunity audit

**Currently supported `ParlayType`:**
- `QB_RECEIVER_YARDS`
- `QB_COMPLETIONS_RECEIVER_RECEPTIONS`
- `PASS_VOLUME_STACK`
- `RB_GAME_SCRIPT_STACK`
- `NEGATIVE_PASSING_STACK`
- `WEATHER_UNDER_STACK`
- `PRESSURE_QUICK_GAME_STACK`
- `CUSTOM`

**Missing / underdeveloped opportunity types** (with football
logic, data, and timing notes):

1. **QB attempts OVER + multiple short-area receptions OVER**
   (capped exposure). Targets quick-game scripts where the
   passing volume is real but distributes to slots / RBs. Needs
   route + alignment tags to identify "short-area." V2 once
   route data is wired.
2. **QB completions OVER + RB receptions OVER in pressure
   setups.** Pressure pushes the QB to checkdown to backs. Needs
   pressure proxy + RB target share. V1 (basic) → V2 (refined).
3. **QB passing yards UNDER + RB rushing attempts OVER in
   low-total / favorite setups.** Game-script-driven clock
   control. Needs spread + total + projected pass rate. V2.
4. **RB rushing attempts OVER + opponent QB attempts UNDER.**
   Cross-team game-script. Needs both team totals + projected
   pass rate. V2.
5. **Same-team RB rushing attempts OVER + game total UNDER**
   (proxy, no totals market yet). Needs game total market — flag
   for later.
6. **WR receptions OVER + WR receiving yards UNDER for
   possession-role.** A short-area role catches lots but doesn't
   pile yards. Only if books offer both. Books usually have these
   as negatively-correlated within the same player; this is a
   nuanced bet. V2+.
7. **TE receptions OVER + QB completions OVER vs TE-funnel
   defenses.** Needs opponent TE EPA / TE-target funnel proxy.
   V2.
8. **RB receptions OVER + QB passing yards UNDER in pressure /
   checkdown scripts.** Same as #2 with the QB on UNDER. Solid
   logic, low book attention. V1 (basic) → V2 (refined).
9. **Deep WR receiving yards UNDER + QB passing yards UNDER +
   wind suppression.** Already supported as WEATHER_UNDER_STACK;
   refinement: tag deep WR explicitly.
10. **Anti-public overs (fade stack).** Identifies popular QB+WR
    OVER pairs where the SGP price is bad. Requires public
    betting % data — not available yet.
11. **Alt-line candidates.** If books offer alt lines, a
    correlated parlay can use a buy-down alt yard line to lock
    in a higher hit probability. Needs alt-line data. Flag
    for later.
12. **Non-correlated EV pair across games.** Two strong V1
    plays from different games as a 2-leg "anti-correlation"
    play to compound edge. Different category from correlated
    parlays — should be surfaced as its own
    `NON_CORRELATED_EV_PAIR` type.
13. **Negative-correlation avoidance warnings.** Flag any
    candidate where two legs are negatively correlated by
    construction (e.g., same-team QB OVER + RB OVER in a low-
    total game) so the user can't accidentally book them.
14. **Hedge / middle opportunities.** Requires either alt-line
    or cross-book data. Later.
15. **Round-robin candidate grouping.** Take 4 candidate legs
    → generate the 6 possible 2-leg combos; track aggregate ROI
    of the basket. Research only. V2.

## G. Data gap audit

To go from "research model" to "informed-by-real-data" we'd want:
- True same-game parlay pricing from a book (so we can compare
  our joint probability to the book's joint price, not the
  product of leg prices).
- Multi-book same-game parlay availability (best-price shopping).
- Alt-line tables (so alt-line parlay candidates exist).
- Closing lines (so we can compute closing line value per leg).
- Player prop line movement (so we know which legs are sharp).
- Game total / spread for game-script-driven parlays.
- Team totals (for clock-control / shootout reads).
- Weather (already present in fixtures).
- Injury / role changes (already present at the leg level).
- Route / alignment data (for short-area / deep stacks).
- True correlation from historical joint outcomes (so we can
  validate the +15% / −20% cap).
- Historical parlay payout data (so we can backtest hit-rate vs
  payout calibration).
- Kalshi contract price / fee / liquidity (only if Kalshi
  integration is approved later — flagged for explicit user
  permission).

All of the above require explicit approval before any paid call.

## H. Backtesting audit

**Today the parlay layer has no backtest runner.** We have:
- `ParlayBacktestResult` type (reserved, unused).
- Fixture-driven candidate generation tested by
  `scripts/test-parlay-model.ts`.

**Cannot currently measure:**
- Parlay hit rate over history.
- Parlay ROI / drawdown over history.
- Required-payout-vs-actual-payout sanity.
- Per-parlay-type performance.
- Per-leg-type performance inside parlays.
- False-positive correlation rate.
- High-payout / low-hit-rate trap occurrence.
- 100-parlay batch ROI simulations.

**Proposed minimum additions** (types only this audit; runner
to follow once we have real or fixture historical leg outcomes):
- `ParlayBatchSimulation` — deterministic simulation of `N`
  parlays at `(hitRate, payoutMultiplier, batchSize)`, returning
  expected and break-even ROI plus a simple drawdown.
- `ParlayPortfolioSummary` — counts, average payout, average
  projected hit rate, average conf-adj EV, distribution of risk
  profiles.
- Fixture output paths reserved: `parlay-results.fixture.json`,
  `parlay-performance-by-type.fixture.json`,
  `parlay-performance-by-risk-profile.fixture.json`,
  `parlay-batch-simulation.fixture.json`.

## I. Risk controls audit

| Control | Enforced? | Where |
|---|---|---|
| Max parlays per game | ✓ | `MAX_PARLAYS_PER_GAME` in builder cap |
| Max exposure per team | ✗ | not enforced beyond receiver overstack |
| Max exposure per correlation story | ✗ | not enforced |
| Max legs | ✓ | `MAX_LEGS_ALLOWED = 3` |
| Max yardage legs | ✗ | not enforced |
| Max low-confidence legs | ✓ | `MIN_LEG_CONFIDENCE` enforced per leg |
| Max proxy-only legs | partial | leg-level confidence floor only |
| No touchdown legs | ✓ | `V1_PROP_TYPES` guard |
| No auto-betting | ✓ | no client / SDK / wallet anywhere |
| Line fragility protection | ✓ | `MAX_LEG_LINE_FRAGILITY = 0.85` |
| Min payout for target hit rate | ✓ | required-hit-rate disqualifier |
| Min confidence-adjusted EV | ✓ | `MIN_CONFIDENCE_ADJUSTED_EV` |

**Recommendation:** add a portfolio-level optimizer that caps
same-game / same-QB / same-correlation-story exposure across
the surviving qualified parlays.

## J. Top 20 optimization recommendations

Ranked by expected impact × difficulty × overfitting risk.

| # | Recommendation | Impact | Difficulty | Overfitting | New data? |
|---|---|---|---|---|---|
| 1 | Portfolio optimizer (cap same-game / same-QB / same-story exposure) | High | Low | Low | No |
| 2 | Risk profile classification on every parlay | High | Low | Low | No |
| 3 | Parlay variance score + fragility score | High | Low | Low | No |
| 4 | Parlay-type strength scoring (book-priced vs novel) | High | Med | Med | No |
| 5 | New ParlayType enum entries (TE funnel, anti-public, non-correlated EV) | Med | Low | Low | No |
| 6 | Per-leg-count variance penalty (3-leg shrinkage) | Med | Low | Low | No |
| 7 | Postmortem tag enum (research only until we have results) | Med | Low | Low | No |
| 8 | ParlayBatchSimulation type + deterministic simulator | Med | Low | Low | No |
| 9 | Thread v2 pipeline edge-quality + market-disagreement into legs | Med | Med | Low | No (fixture) |
| 10 | Tighten same-team WR overstacking from 2 → 1.5 (i.e., still allow 2 receivers but penalize harder) | Med | Low | Low | No |
| 11 | Backtest runner against historical leg outcomes | High | High | Med | Yes (historical) |
| 12 | Same-game parlay pricing comparison (model vs book SGP) | High | High | Med | Yes (book SGP) |
| 13 | Closing line value per leg | Med | Med | Low | Yes (closing) |
| 14 | Alt-line parlay candidates | Med | High | Med | Yes (alt lines) |
| 15 | Cross-game game-script parlays (RB OVER + opponent QB UNDER) | Med | Med | Low | Partial (totals) |
| 16 | TE-funnel parlay type (opponent TE EPA) | Med | Med | Low | Yes (TE EPA) |
| 17 | Anti-public / fade parlays | Low | Med | High | Yes (public %) |
| 18 | Hedge / middle opportunities | Low | High | High | Yes (multi-book) |
| 19 | Kalshi contract price integration | TBD | High | High | Yes (Kalshi — needs explicit approval) |
| 20 | Round-robin grouping research view | Low | Low | Low | No |

The first 10 are safe additive improvements that do not require
real data. Items 11-20 are flagged for after the backtest
foundation exists or after explicit data approvals.

## Implementation plan

Of the top 10 recommendations, implement now:
- Risk profile classification — `parlay-risk-profile.ts`.
- Parlay-type strength — `parlay-type-strength.ts`.
- Variance + fragility + overstacking score helpers.
- Portfolio optimizer — `parlay-selection-optimizer.ts`.
- Target math helper file consolidating
  `calculateRequiredHitRate` /
  `calculateRequiredPayoutForTargetROI` /
  `calculateProjectedROI` / `simulateParlayBatch`.
- Postmortem tag enum (research only).
- New ParlayType enum entries.
- Audit test runner — `scripts/test-parlay-algo-audit.ts`.
- Parlay strategy health panel + "why this could fail" section
  on the UI.
- Backtest type stubs.

Deferred:
- Full backtest runner.
- Anything that requires real data, paid APIs, or Kalshi.
