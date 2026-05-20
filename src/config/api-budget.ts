/**
 * Central API budget configuration.
 *
 * Every paid-API code path imports from this file. Edit here, audit
 * everywhere — no magic numbers scattered through the ingestion code.
 *
 * V1 covers lower-variance NFL props only (passing attempts / completions
 * / yards, receptions, receiving yards, rushing attempts / yards). Real
 * paid calls are gated behind `ALLOW_REAL_ODDS_API_CALLS` so the codebase
 * can ship without ever hitting a billed endpoint by accident.
 */

/** Hard ceiling on credits any single Odds-API run can spend. */
export const MAX_ODDS_API_CREDITS_PER_RUN = 200;

/**
 * Minimum credits the account must have left after a run completes.
 * Used by post-run checks once the Odds-API response headers
 * (`x-requests-remaining`) are observed.
 */
export const MIN_ODDS_API_CREDITS_REMAINING = 1000;

/** Max number of markets the /events/{id}/odds endpoint can request. */
export const MAX_MARKETS_PER_REQUEST = 7;

/** Region whitelist for paid calls. V1 only trades US books. */
export const ALLOWED_ODDS_REGIONS = ["us"] as const;
export type AllowedOddsRegion = (typeof ALLOWED_ODDS_REGIONS)[number];

/** Pregame snapshot offset (hours before kickoff, rounded to 5-min grid). */
export const DEFAULT_HISTORICAL_SNAPSHOT_HOURS_BEFORE_KICKOFF = 3.5;

/**
 * Master kill-switch for paid Odds-API calls.
 *
 * **MUST** be `true` (set via env var `ALLOW_REAL_ODDS_API_CALLS=true`)
 * before any non-dry script run is allowed. Default is `false` so the
 * codebase can ship to environments where the key exists but the team
 * isn't ready to spend credits.
 */
export const ALLOW_REAL_ODDS_API_CALLS =
  process.env.ALLOW_REAL_ODDS_API_CALLS === "true";

/**
 * Filesystem root for cached raw API responses. Used by
 * `src/lib/ingestion/cache.ts`. Cache files are ignored by git.
 */
export const CACHE_ROOT = "data/cache";
