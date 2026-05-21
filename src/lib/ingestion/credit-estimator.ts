/**
 * Credit estimation for paid Odds-API runs.
 *
 * Pricing model (per The Odds API docs):
 *   - /historical/.../events            costs 1 credit per snapshot
 *   - /historical/.../events/{id}/odds  costs 1 credit per (market × region)
 *
 * V1 budget caps (in `src/config/api-budget.ts`):
 *   - regions hard-locked to `us`
 *   - markets capped at 7 (all lower-variance — no TDs)
 *   - per-run ceiling: MAX_ODDS_API_CREDITS_PER_RUN
 *
 * Callers must run `validateCreditBudget` before any HTTP call.
 */

import {
  ALLOWED_ODDS_REGIONS,
  HISTORICAL_PLAYER_PROP_CREDITS_PER_MARKET,
  MAX_MARKETS_PER_REQUEST,
  MAX_ODDS_API_CREDITS_PER_RUN,
  MIN_ODDS_API_CREDITS_REMAINING,
} from "../../config/api-budget";

/** Pricing constants, isolated here so the model is easy to audit. */
export const CREDITS_PER_EVENTS_LIST = 1;
/** Base rate for non-player-prop markets (h2h, spreads, totals). */
export const CREDITS_PER_EVENT_ODDS_UNIT_BASE = 1;
/**
 * Rate for player-prop markets. The Odds API charges player props
 * at a higher historical rate than standard markets. The 2026-05
 * paid smoke confirmed ~10 credits per (player-prop × region).
 */
export const CREDITS_PER_EVENT_ODDS_UNIT_PLAYER =
  HISTORICAL_PLAYER_PROP_CREDITS_PER_MARKET;

/** Return the per-(market × region) credit cost for a single market key. */
export function creditsPerMarketPerRegion(marketKey: string): number {
  if (marketKey.startsWith("player_")) {
    return CREDITS_PER_EVENT_ODDS_UNIT_PLAYER;
  }
  return CREDITS_PER_EVENT_ODDS_UNIT_BASE;
}

// --- single-event cost -----------------------------------------------

export interface HistoricalEventOddsArgs {
  /** Either a count (legacy callers) — assumes the conservative
   *  player-prop rate so estimates never under-count. */
  markets: number | readonly string[];
  regions: number;
}

/**
 * Credits to fetch /events/{id}/odds for one event with `markets` and
 * `regions` selected. When `markets` is an array of market keys, the
 * rate is computed per-market (player_* → 10, others → 1). When
 * `markets` is a number, we conservatively assume the player-prop
 * rate so legacy callers never under-count.
 */
export function estimateHistoricalEventOddsCredits(
  args: HistoricalEventOddsArgs,
): number {
  if (typeof args.markets === "number") {
    return (
      args.markets * args.regions * CREDITS_PER_EVENT_ODDS_UNIT_PLAYER
    );
  }
  let perRegion = 0;
  for (const m of args.markets) perRegion += creditsPerMarketPerRegion(m);
  return perRegion * args.regions;
}

// --- season-wide cost ------------------------------------------------

export interface SeasonBacktestArgs {
  gameCount: number;
  /** Either market keys (preferred, market-aware rate) or a count
   *  (legacy, conservative player-prop rate). */
  markets: number | readonly string[];
  regions: number;
  /**
   * Number of unique /events snapshots needed. Defaults to one per
   * game (worst case); the actual runner groups games sharing a
   * kickoff window so this is usually lower.
   */
  uniqueSnapshots?: number;
}

export interface SeasonCostBreakdown {
  eventsListCredits: number;
  eventOddsCredits: number;
  total: number;
  perEvent: number;
  uniqueSnapshots: number;
}

export function estimateSeasonBacktestCredits(
  args: SeasonBacktestArgs,
): SeasonCostBreakdown {
  const uniqueSnapshots = args.uniqueSnapshots ?? args.gameCount;
  const perEvent = estimateHistoricalEventOddsCredits({
    markets: args.markets,
    regions: args.regions,
  });
  const eventsListCredits = uniqueSnapshots * CREDITS_PER_EVENTS_LIST;
  const eventOddsCredits = args.gameCount * perEvent;
  return {
    eventsListCredits,
    eventOddsCredits,
    perEvent,
    total: eventsListCredits + eventOddsCredits,
    uniqueSnapshots,
  };
}

// --- validation ------------------------------------------------------

export interface BudgetValidationInput {
  markets: number;
  regions: readonly string[];
  estimatedCredits: number;
  /** Optional: current `x-requests-remaining` from the most recent call. */
  creditsRemaining?: number;
}

export interface BudgetValidationResult {
  ok: boolean;
  reasons: string[];
  estimatedCredits: number;
  budgetMax: number;
  minRemainingFloor: number;
}

/**
 * Validate a planned run against the policy in `config/api-budget.ts`.
 *
 * Refuses (ok=false, with reasons) if any of:
 *   - markets > MAX_MARKETS_PER_REQUEST
 *   - any region not in ALLOWED_ODDS_REGIONS
 *   - estimatedCredits > MAX_ODDS_API_CREDITS_PER_RUN
 *   - creditsRemaining (if supplied) - estimatedCredits < MIN_ODDS_API_CREDITS_REMAINING
 */
export function validateCreditBudget(
  input: BudgetValidationInput,
): BudgetValidationResult {
  const reasons: string[] = [];

  if (input.markets > MAX_MARKETS_PER_REQUEST) {
    reasons.push(
      `markets=${input.markets} exceeds MAX_MARKETS_PER_REQUEST=${MAX_MARKETS_PER_REQUEST}`,
    );
  }
  for (const r of input.regions) {
    if (!(ALLOWED_ODDS_REGIONS as readonly string[]).includes(r)) {
      reasons.push(
        `region "${r}" not in ALLOWED_ODDS_REGIONS=${JSON.stringify(ALLOWED_ODDS_REGIONS)}`,
      );
    }
  }
  if (input.estimatedCredits > MAX_ODDS_API_CREDITS_PER_RUN) {
    reasons.push(
      `estimated ${input.estimatedCredits} credits > MAX_ODDS_API_CREDITS_PER_RUN=${MAX_ODDS_API_CREDITS_PER_RUN}`,
    );
  }
  if (
    typeof input.creditsRemaining === "number" &&
    input.creditsRemaining - input.estimatedCredits <
      MIN_ODDS_API_CREDITS_REMAINING
  ) {
    reasons.push(
      `running would drop credits below MIN_ODDS_API_CREDITS_REMAINING=${MIN_ODDS_API_CREDITS_REMAINING} (current=${input.creditsRemaining}, estimate=${input.estimatedCredits})`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    estimatedCredits: input.estimatedCredits,
    budgetMax: MAX_ODDS_API_CREDITS_PER_RUN,
    minRemainingFloor: MIN_ODDS_API_CREDITS_REMAINING,
  };
}
