/**
 * The Odds API — historical prop ingestion client.
 *
 * Used by `scripts/ingest-historical-prop-lines.ts` to pull one pregame
 * snapshot of player-prop odds for each NFL game. V1 only covers the
 * lower-variance markets enumerated in `SUPPORTED_MARKETS` — no touchdown
 * markets are requested.
 *
 * Auth: pass `apiKey` (from env var `ODDS_API_KEY`) to every fetcher.
 * Nothing in this file reads from process.env directly; callers control
 * key handling. The key is never logged — `maskApiKey` is provided for
 * dry-run URL printing.
 *
 * Pricing (per The Odds API docs, used for the credit estimator):
 *   - Historical events list:           1 credit per snapshot call.
 *   - Historical per-event odds call:   1 credit per (market × region).
 *   - Region budget: V1 uses `us` only.
 *   - Market budget: capped at MAX_MARKETS_PER_REQUEST (7).
 *
 * See: https://the-odds-api.com/liveapi/guides/v4/#historical-data
 */

import type { PropType } from "../types";

// --- constants --------------------------------------------------------

export const ODDS_API_BASE_URL =
  process.env.ODDS_API_BASE_URL ?? "https://api.the-odds-api.com/v4";

export const SPORT_KEY = "americanfootball_nfl";

/** V1 supports only the `us` region. */
export const SUPPORTED_REGION = "us" as const;
export type SupportedRegion = typeof SUPPORTED_REGION;

/** V1 player-prop markets (lower-variance only — no TDs). */
export const SUPPORTED_MARKETS = [
  "player_pass_attempts",
  "player_pass_completions",
  "player_pass_yds",
  "player_receptions",
  "player_reception_yds",
  "player_rush_attempts",
  "player_rush_yds",
] as const;

export type OddsApiMarketKey = (typeof SUPPORTED_MARKETS)[number];

/** Hard cap. Live runner rejects requests asking for more. */
export const MAX_MARKETS_PER_REQUEST = 7;

/** Snapshot-timing knobs. Historical snapshots are taken every 5 minutes. */
export const SNAPSHOT_GRANULARITY_MIN = 5;
export const DEFAULT_HOURS_BEFORE_KICKOFF = 3.5;

/** Per-call credit costs used by the estimator. */
export const CREDITS = {
  EVENTS_LIST_PER_SNAPSHOT: 1,
  EVENT_ODDS_PER_MARKET_PER_REGION: 1,
} as const;

/** Map an Odds API market key to our internal PropType enum value. */
export const ODDS_API_TO_PROP_TYPE: Record<OddsApiMarketKey, PropType> = {
  player_pass_attempts: "PASSING_ATTEMPTS",
  player_pass_completions: "PASSING_COMPLETIONS",
  player_pass_yds: "PASSING_YARDS",
  player_receptions: "RECEPTIONS",
  player_reception_yds: "RECEIVING_YARDS",
  player_rush_attempts: "RUSHING_ATTEMPTS",
  player_rush_yds: "RUSHING_YARDS",
};

/**
 * Abbreviation -> full team name used by The Odds API.
 * The API returns `home_team` / `away_team` as full names; we need this
 * to map game rows (which we store by abbreviation) to the right
 * event in a /events response.
 */
export const NFL_TEAM_NAMES_BY_ABBR: Record<string, string> = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LAC: "Los Angeles Chargers",
  LAR: "Los Angeles Rams",
  LV: "Las Vegas Raiders",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
};

// --- API response types -----------------------------------------------

export interface OddsApiEvent {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
}

export interface OddsApiOutcome {
  /** "Over" | "Under" for player-line markets. */
  name: string;
  /** Player name on player-prop markets. */
  description?: string;
  /** American odds. */
  price: number;
  /** Numeric line (e.g. 274.5). */
  point?: number;
}

export interface OddsApiMarket {
  key: string;
  last_update: string;
  outcomes: OddsApiOutcome[];
}

export interface OddsApiBookmaker {
  key: string;
  title: string;
  last_update: string;
  markets: OddsApiMarket[];
}

export interface OddsApiEventOdds {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

/** All historical endpoints wrap the payload with snapshot metadata. */
export interface OddsApiHistoricalResponse<T> {
  timestamp: string;
  previous_timestamp: string | null;
  next_timestamp: string | null;
  data: T;
}

// --- snapshot timing helpers ------------------------------------------

/** Round a Date down to the nearest 5-minute boundary (UTC). */
export function roundDownTo5Min(d: Date): Date {
  const ms = SNAPSHOT_GRANULARITY_MIN * 60 * 1000;
  return new Date(Math.floor(d.getTime() / ms) * ms);
}

/**
 * Snapshot ~`hoursBeforeKickoff` before kickoff, rounded down to the
 * 5-minute grid. Returns an ISO 8601 UTC string (no millis), the format
 * the historical endpoints accept.
 */
export function computeSnapshotTime(
  kickoffISO: string,
  hoursBeforeKickoff = DEFAULT_HOURS_BEFORE_KICKOFF,
): string {
  const kickoff = new Date(kickoffISO);
  const snapshot = new Date(kickoff.getTime() - hoursBeforeKickoff * 3600 * 1000);
  return roundDownTo5Min(snapshot).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// --- URL builders ------------------------------------------------------

interface EventsUrlArgs {
  apiKey: string;
  snapshotISO: string;
  sport?: string;
}

export function buildEventsUrl({
  apiKey,
  snapshotISO,
  sport = SPORT_KEY,
}: EventsUrlArgs): string {
  const u = new URL(`${ODDS_API_BASE_URL}/historical/sports/${sport}/events`);
  u.searchParams.set("apiKey", apiKey);
  u.searchParams.set("date", snapshotISO);
  return u.toString();
}

interface EventOddsUrlArgs {
  apiKey: string;
  eventId: string;
  snapshotISO: string;
  markets: readonly OddsApiMarketKey[];
  regions?: readonly SupportedRegion[];
  oddsFormat?: "american" | "decimal";
  sport?: string;
}

export function buildEventOddsUrl({
  apiKey,
  eventId,
  snapshotISO,
  markets,
  regions = [SUPPORTED_REGION],
  oddsFormat = "american",
  sport = SPORT_KEY,
}: EventOddsUrlArgs): string {
  if (markets.length > MAX_MARKETS_PER_REQUEST) {
    throw new Error(
      `Refusing to request ${markets.length} markets — cap is ${MAX_MARKETS_PER_REQUEST}.`,
    );
  }
  if (regions.length !== 1 || regions[0] !== SUPPORTED_REGION) {
    throw new Error(`V1 only supports regions=${SUPPORTED_REGION}.`);
  }
  const u = new URL(
    `${ODDS_API_BASE_URL}/historical/sports/${sport}/events/${eventId}/odds`,
  );
  u.searchParams.set("apiKey", apiKey);
  u.searchParams.set("regions", regions.join(","));
  u.searchParams.set("markets", markets.join(","));
  u.searchParams.set("date", snapshotISO);
  u.searchParams.set("oddsFormat", oddsFormat);
  return u.toString();
}

/** Replace the apiKey query param with a placeholder. Use when logging. */
export function maskApiKey(url: string): string {
  return url.replace(/(apiKey=)[^&]+/, "$1***MASKED***");
}

// --- fetchers ----------------------------------------------------------

class OddsApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
    this.name = "OddsApiError";
  }
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new OddsApiError(
      `Odds API ${res.status} ${res.statusText} on ${maskApiKey(url)}`,
      res.status,
      body,
    );
  }
  return (await res.json()) as T;
}

export async function listHistoricalEvents(
  args: EventsUrlArgs,
): Promise<OddsApiHistoricalResponse<OddsApiEvent[]>> {
  const url = buildEventsUrl(args);
  return getJSON<OddsApiHistoricalResponse<OddsApiEvent[]>>(url);
}

export async function getHistoricalEventOdds(
  args: EventOddsUrlArgs,
): Promise<OddsApiHistoricalResponse<OddsApiEventOdds>> {
  const url = buildEventOddsUrl(args);
  return getJSON<OddsApiHistoricalResponse<OddsApiEventOdds>>(url);
}

// --- planner / credit estimator ---------------------------------------

export interface RunPlan {
  uniqueSnapshots: number;
  totalEvents: number;
  marketsPerEvent: number;
  estimatedCredits: number;
}

/**
 * Estimate credits for a run.
 *
 * Cost model:
 *   uniqueSnapshots * EVENTS_LIST_PER_SNAPSHOT
 *   + totalEvents * marketsPerEvent * EVENT_ODDS_PER_MARKET_PER_REGION
 *
 * The Odds API charges per (market × region) for historical event odds.
 * Region is fixed at 1 (us) for V1, so the per-event cost == marketsPerEvent.
 */
export function estimateCredits({
  uniqueSnapshots,
  totalEvents,
  marketsPerEvent,
}: {
  uniqueSnapshots: number;
  totalEvents: number;
  marketsPerEvent: number;
}): RunPlan {
  const credits =
    uniqueSnapshots * CREDITS.EVENTS_LIST_PER_SNAPSHOT +
    totalEvents * marketsPerEvent * CREDITS.EVENT_ODDS_PER_MARKET_PER_REGION;
  return {
    uniqueSnapshots,
    totalEvents,
    marketsPerEvent,
    estimatedCredits: credits,
  };
}

// --- normalization helpers --------------------------------------------

export interface NormalizedPropMarket {
  market_key: string;
  game_id: string;
  event_id: string;
  player_name: string;
  prop_type: PropType;
  line: number;
  source: string;
  snapshot_time: string;
}

export interface NormalizedPropQuote {
  market_key: string;
  book_name: string;
  over_price: number;
  under_price: number;
  over_implied_probability: number;
  under_implied_probability: number;
  no_vig_over_probability: number;
  no_vig_under_probability: number;
  quote_time: string;
}

export interface NormalizationResult {
  markets: NormalizedPropMarket[];
  quotes: NormalizedPropQuote[];
}

function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

/** Build a deterministic key for a (player, propType, line) tuple in an event. */
export function buildMarketKey(
  eventId: string,
  playerName: string,
  propType: PropType,
  line: number,
): string {
  const playerSlug = playerName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${eventId}:${playerSlug}:${propType}:${line}`;
}

/**
 * Convert an Odds API per-event response into normalized PropMarket +
 * PropQuote rows. Skips outcomes missing player name, point, or one of
 * the over/under pair.
 */
export function normalizeEventOdds(
  response: OddsApiEventOdds,
  context: { gameId: string; snapshotISO: string; source?: string },
): NormalizationResult {
  const source = context.source ?? "the-odds-api";
  const marketMap = new Map<string, NormalizedPropMarket>();
  const quotes: NormalizedPropQuote[] = [];

  for (const book of response.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      const propType = ODDS_API_TO_PROP_TYPE[market.key as OddsApiMarketKey];
      if (!propType) continue; // skip markets we don't trade

      // Group outcomes by (player, line) → over/under pair.
      const byPlayerLine = new Map<
        string,
        { over?: OddsApiOutcome; under?: OddsApiOutcome }
      >();
      for (const o of market.outcomes) {
        if (!o.description || o.point == null) continue;
        const k = `${o.description}|${o.point}`;
        const cell = byPlayerLine.get(k) ?? {};
        if (o.name.toLowerCase() === "over") cell.over = o;
        else if (o.name.toLowerCase() === "under") cell.under = o;
        byPlayerLine.set(k, cell);
      }

      for (const { over, under } of byPlayerLine.values()) {
        if (!over || !under || over.point == null || under.point == null) continue;
        if (over.point !== under.point) continue; // mismatched lines — skip

        const player = over.description!;
        const line = over.point;
        const key = buildMarketKey(response.id, player, propType, line);

        if (!marketMap.has(key)) {
          marketMap.set(key, {
            market_key: key,
            game_id: context.gameId,
            event_id: response.id,
            player_name: player,
            prop_type: propType,
            line,
            source,
            snapshot_time: context.snapshotISO,
          });
        }

        const overImp = americanToImpliedProb(over.price);
        const underImp = americanToImpliedProb(under.price);
        const sum = overImp + underImp || 1;
        quotes.push({
          market_key: key,
          book_name: book.title,
          over_price: over.price,
          under_price: under.price,
          over_implied_probability: overImp,
          under_implied_probability: underImp,
          no_vig_over_probability: overImp / sum,
          no_vig_under_probability: underImp / sum,
          quote_time: market.last_update,
        });
      }
    }
  }

  return { markets: Array.from(marketMap.values()), quotes };
}
