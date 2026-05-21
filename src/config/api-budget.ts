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

/**
 * First-version ingestion market list. The Odds-API client knows about
 * the full V1 lower-variance market set, but the first staged ingestion
 * run pulls only volume markets (no yardage) to bound credit spend and
 * sanity-check the pipeline against a smaller surface area. Yardage
 * markets unlock once this version is verified.
 */
export const V1_INGESTION_MARKETS = [
  "player_pass_attempts",
  "player_pass_completions",
  "player_receptions",
  "player_rush_attempts",
] as const;
export type V1IngestionMarket = (typeof V1_INGESTION_MARKETS)[number];

/**
 * Abort threshold for actual-vs-estimated credit overage. If a paid
 * run exceeds the estimate by more than this ratio, the script halts
 * before the next request. 1.10 = 10% slack for rounding / region
 * multipliers without choking on legitimate surprises.
 */
export const CREDIT_OVERAGE_ABORT_RATIO = 1.1;

/**
 * Historical per-market credit cost for player-prop markets
 * (anything keyed `player_*`). The Odds API documents this as the
 * paid-tier rate for historical player prop snapshots. Standard
 * markets (h2h / spreads / totals) cost 1 per (market × region);
 * player props are billed materially higher. The 2026-05 paid
 * smoke confirmed ~40 credits for 4 markets × 1 region, matching
 * 10 credits per (market × region). See ODDS_API_CREDIT_AUDIT.md.
 */
export const HISTORICAL_PLAYER_PROP_CREDITS_PER_MARKET = 10;

/**
 * Hard cap on credits the smallest calibration smoke can spend.
 * The runner refuses any plan or single request whose projected
 * cumulative cost would push past this number. Keeps a wrong
 * estimate from blowing real money.
 */
export const SMOKE_CALIBRATION_MAX_CREDITS = 50;

/**
 * The smallest paid smoke fires one events-list call + one
 * event-odds call, then stops — regardless of how many games
 * are in the snapshot.
 */
export const SMOKE_CALIBRATION_MAX_ODDS_REQUESTS = 1;

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
