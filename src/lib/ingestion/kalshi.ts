/**
 * Kalshi — market data ingestion client.
 *
 * READ-ONLY. This module intentionally exposes only GET endpoints
 * (markets list, market detail, orderbook). It does NOT, and must not,
 * expose order placement, portfolio reads, balance reads, position
 * reads, or any other trading or account surface. The Prop Edge
 * platform consumes Kalshi exclusively as a price/liquidity source.
 *
 * If trading endpoints are ever needed, they belong in a different
 * module so this one stays auditable as a pure data-ingestion seam.
 *
 * Auth: Kalshi uses an API key ID plus an RSA private key. Every
 * request is signed as RSA-PSS over `<timestampMs><METHOD><path>`
 * (pathname only, no query string). Signature is base64-encoded and
 * sent in the `KALSHI-ACCESS-SIGNATURE` header along with the access
 * key (`KALSHI-ACCESS-KEY`) and timestamp (`KALSHI-ACCESS-TIMESTAMP`).
 *
 * The private key is loaded from `KALSHI_API_SECRET_PATH` (a PEM file
 * on disk). The key file itself is never logged. The script never
 * passes the key content over a network or stores it elsewhere.
 *
 * Env vars (read by callers, not this module):
 *   KALSHI_API_KEY           Access key id
 *   KALSHI_API_SECRET_PATH   Path to the RSA private key PEM
 *   KALSHI_ENV               "prod" | "demo" (default: demo)
 *   KALSHI_BASE_URL          Optional override for the API base URL
 */

import fs from "node:fs";
import {
  constants as cryptoConstants,
  createPrivateKey,
  createSign,
  type KeyObject,
} from "node:crypto";

// --- environment / base URL -------------------------------------------

export type KalshiEnv = "prod" | "demo";

/**
 * The hosts below have shifted over time. If the upstream URL changes,
 * override with `KALSHI_BASE_URL` rather than editing this constant.
 */
export const KALSHI_BASE_URLS: Record<KalshiEnv, string> = {
  prod: "https://api.elections.kalshi.com/trade-api/v2",
  demo: "https://demo-api.kalshi.co/trade-api/v2",
};

export function resolveKalshiEnv(envArg?: string): KalshiEnv {
  const raw = (envArg ?? process.env.KALSHI_ENV ?? "demo").toLowerCase();
  return raw === "prod" ? "prod" : "demo";
}

export function getKalshiBaseUrl(env?: KalshiEnv): string {
  if (process.env.KALSHI_BASE_URL) return process.env.KALSHI_BASE_URL;
  const e = env ?? resolveKalshiEnv();
  return KALSHI_BASE_URLS[e];
}

// --- API response shapes (loose; many fields optional) ----------------

export interface KalshiMarket {
  ticker: string;
  event_ticker?: string;
  market_type?: string;
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  status?: string;
  open_time?: string;
  close_time?: string;
  expiration_time?: string;

  // Pricing (cents 0-100 on binary markets)
  yes_bid?: number;
  yes_ask?: number;
  no_bid?: number;
  no_ask?: number;
  last_price?: number;
  previous_yes_bid?: number;
  previous_yes_ask?: number;
  previous_price?: number;

  // Liquidity / volume
  volume?: number;
  volume_24h?: number;
  liquidity?: number;
  open_interest?: number;

  // Settlement
  result?: string;
  settlement_value?: number | null;
  rules_primary?: string;
  rules_secondary?: string;

  // Allow forward-compat fields without losing type safety.
  [extra: string]: unknown;
}

export interface KalshiMarketsResponse {
  markets: KalshiMarket[];
  cursor?: string;
}

export interface KalshiMarketDetailResponse {
  market: KalshiMarket;
}

/** Orderbook side levels are [price_cents, quantity] pairs, best first. */
export type OrderbookLevel = [number, number];

export interface KalshiOrderbookResponse {
  orderbook: {
    yes?: OrderbookLevel[];
    no?: OrderbookLevel[];
  };
}

// --- auth: RSA-PSS signing --------------------------------------------

/**
 * Load an RSA private key from a PEM file. Throws cleanly if the file
 * is missing or doesn't parse. Callers should hold the resulting
 * `KeyObject` for the lifetime of their run.
 */
export function loadPrivateKey(secretPath: string): KeyObject {
  if (!fs.existsSync(secretPath)) {
    throw new Error(`Kalshi secret key not found at ${secretPath}`);
  }
  const pem = fs.readFileSync(secretPath, "utf8");
  try {
    return createPrivateKey(pem);
  } catch (err) {
    throw new Error(
      `Failed to parse Kalshi private key at ${secretPath}: ${(err as Error).message}`,
    );
  }
}

export interface SignRequestArgs {
  /**
   * Method to sign. Locked to GET on purpose — this module is
   * read-only and adding POST/DELETE would mean adding a trading
   * surface. Widen this union only as part of a deliberate, reviewed
   * change.
   */
  method: "GET";
  /** Pathname only, no query string. e.g. "/trade-api/v2/markets". */
  path: string;
  timestampMs: number;
  privateKey: KeyObject;
}

/**
 * Sign a Kalshi request. Returns the base64 RSA-PSS / SHA-256 signature
 * (saltLength = digest length, per Kalshi's auth scheme).
 */
export function signKalshiRequest(args: SignRequestArgs): string {
  const message = `${args.timestampMs}${args.method}${args.path}`;
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  signer.end();
  return signer.sign(
    {
      key: args.privateKey,
      padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
      saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
    },
    "base64",
  );
}

export function buildAuthHeaders(args: {
  apiKey: string;
  timestampMs: number;
  signature: string;
}): Record<string, string> {
  return {
    "KALSHI-ACCESS-KEY": args.apiKey,
    "KALSHI-ACCESS-SIGNATURE": args.signature,
    "KALSHI-ACCESS-TIMESTAMP": String(args.timestampMs),
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

// --- URL builders -----------------------------------------------------

export interface MarketsListOpts {
  series_ticker?: string;
  event_ticker?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

export function buildMarketsUrl(
  baseUrl: string,
  opts: MarketsListOpts = {},
): string {
  const u = new URL(`${baseUrl}/markets`);
  if (opts.series_ticker) u.searchParams.set("series_ticker", opts.series_ticker);
  if (opts.event_ticker) u.searchParams.set("event_ticker", opts.event_ticker);
  if (opts.status) u.searchParams.set("status", opts.status);
  if (opts.limit) u.searchParams.set("limit", String(opts.limit));
  if (opts.cursor) u.searchParams.set("cursor", opts.cursor);
  return u.toString();
}

export function buildMarketDetailUrl(baseUrl: string, ticker: string): string {
  return `${baseUrl}/markets/${encodeURIComponent(ticker)}`;
}

export function buildOrderbookUrl(
  baseUrl: string,
  ticker: string,
  depth?: number,
): string {
  const u = new URL(`${baseUrl}/markets/${encodeURIComponent(ticker)}/orderbook`);
  if (depth) u.searchParams.set("depth", String(depth));
  return u.toString();
}

// --- fetcher (READ-ONLY) ----------------------------------------------

export interface FetchContext {
  baseUrl: string;
  apiKey: string;
  privateKey: KeyObject;
}

export class KalshiError extends Error {
  constructor(message: string, public status: number, public body: string) {
    super(message);
    this.name = "KalshiError";
  }
}

async function signedGet<T>(ctx: FetchContext, url: string): Promise<T> {
  const pathname = new URL(url).pathname;
  const timestampMs = Date.now();
  const signature = signKalshiRequest({
    method: "GET",
    path: pathname,
    timestampMs,
    privateKey: ctx.privateKey,
  });
  const headers = buildAuthHeaders({
    apiKey: ctx.apiKey,
    timestampMs,
    signature,
  });
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new KalshiError(
      `Kalshi ${res.status} ${res.statusText} on ${url}`,
      res.status,
      body,
    );
  }
  return (await res.json()) as T;
}

export async function fetchMarkets(
  ctx: FetchContext,
  opts: MarketsListOpts = {},
): Promise<KalshiMarketsResponse> {
  return signedGet<KalshiMarketsResponse>(ctx, buildMarketsUrl(ctx.baseUrl, opts));
}

export async function fetchMarketDetail(
  ctx: FetchContext,
  ticker: string,
): Promise<KalshiMarketDetailResponse> {
  return signedGet<KalshiMarketDetailResponse>(
    ctx,
    buildMarketDetailUrl(ctx.baseUrl, ticker),
  );
}

export async function fetchOrderbook(
  ctx: FetchContext,
  ticker: string,
  depth?: number,
): Promise<KalshiOrderbookResponse> {
  return signedGet<KalshiOrderbookResponse>(
    ctx,
    buildOrderbookUrl(ctx.baseUrl, ticker, depth),
  );
}

// --- normalization ----------------------------------------------------

export interface NormalizedKalshiMarket {
  ticker: string;
  event_ticker: string;
  series_ticker: string;
  market_type: string;
  title: string;
  yes_sub_title: string;
  no_sub_title: string;
  status: string;
  open_time: string;
  close_time: string;
  expiration_time: string;

  // Raw cent prices (0-100)
  yes_bid: number | null;
  yes_ask: number | null;
  no_bid: number | null;
  no_ask: number | null;
  last_price: number | null;

  // Probability form (0-1)
  yes_bid_prob: number | null;
  yes_ask_prob: number | null;
  no_bid_prob: number | null;
  no_ask_prob: number | null;
  mid_yes_prob: number | null;

  // Liquidity / volume (always emitted; default 0)
  volume: number;
  volume_24h: number;
  liquidity: number;
  open_interest: number;

  // Settlement rules concatenated for convenience.
  settlement_rules: string;
  result: string;

  snapshot_time: string;
}

export function normalizeMarket(
  market: KalshiMarket,
  snapshotISO: string,
): NormalizedKalshiMarket {
  const cents = (v: unknown): number | null =>
    typeof v === "number" ? v : null;
  const prob = (v: number | null): number | null => (v == null ? null : v / 100);

  const yesBid = cents(market.yes_bid);
  const yesAsk = cents(market.yes_ask);
  const noBid = cents(market.no_bid);
  const noAsk = cents(market.no_ask);
  const last = cents(market.last_price);

  const midYesProb =
    yesBid != null && yesAsk != null ? (yesBid + yesAsk) / 200 : null;

  const rules = [market.rules_primary, market.rules_secondary]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join("\n\n");

  // Kalshi tickers look like "<SERIES>-<EVENT>-<MARKET>". The series
  // is the prefix before the first hyphen of `event_ticker`. Best
  // effort — falls back to the part before the first hyphen of the
  // market ticker if event_ticker is absent.
  const seriesFromEvent =
    (market.event_ticker ?? "").split("-")[0] ?? "";
  const seriesFromMarket = (market.ticker ?? "").split("-")[0] ?? "";
  const series = seriesFromEvent || seriesFromMarket;

  return {
    ticker: market.ticker,
    event_ticker: market.event_ticker ?? "",
    series_ticker: series,
    market_type: market.market_type ?? "binary",
    title: market.title ?? "",
    yes_sub_title: market.yes_sub_title ?? "",
    no_sub_title: market.no_sub_title ?? "",
    status: market.status ?? "",
    open_time: market.open_time ?? "",
    close_time: market.close_time ?? "",
    expiration_time: market.expiration_time ?? "",
    yes_bid: yesBid,
    yes_ask: yesAsk,
    no_bid: noBid,
    no_ask: noAsk,
    last_price: last,
    yes_bid_prob: prob(yesBid),
    yes_ask_prob: prob(yesAsk),
    no_bid_prob: prob(noBid),
    no_ask_prob: prob(noAsk),
    mid_yes_prob: midYesProb,
    volume: typeof market.volume === "number" ? market.volume : 0,
    volume_24h: typeof market.volume_24h === "number" ? market.volume_24h : 0,
    liquidity: typeof market.liquidity === "number" ? market.liquidity : 0,
    open_interest:
      typeof market.open_interest === "number" ? market.open_interest : 0,
    settlement_rules: rules,
    result: market.result ?? "",
    snapshot_time: snapshotISO,
  };
}

export interface NormalizedKalshiOrderbookLevel {
  ticker: string;
  snapshot_time: string;
  side: "yes" | "no";
  level: number; // 0 == best (top of book)
  price_cents: number;
  price_prob: number;
  quantity: number;
}

export function normalizeOrderbook(
  ticker: string,
  orderbook: KalshiOrderbookResponse["orderbook"],
  snapshotISO: string,
): NormalizedKalshiOrderbookLevel[] {
  const out: NormalizedKalshiOrderbookLevel[] = [];
  for (const side of ["yes", "no"] as const) {
    const levels = orderbook[side] ?? [];
    levels.forEach((entry, i) => {
      if (!Array.isArray(entry) || entry.length < 2) return;
      const [price, quantity] = entry;
      out.push({
        ticker,
        snapshot_time: snapshotISO,
        side,
        level: i,
        price_cents: price,
        price_prob: price / 100,
        quantity,
      });
    });
  }
  return out;
}
