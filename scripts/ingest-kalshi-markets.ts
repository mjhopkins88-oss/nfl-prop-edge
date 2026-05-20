/**
 * ingest-kalshi-markets.ts
 *
 * Pull market metadata, current quotes, liquidity, volume, settlement
 * rules, and (optionally) orderbook depth from Kalshi. Saves raw
 * responses to disk and emits normalized CSVs ready for downstream
 * loaders.
 *
 * READ-ONLY. This script imports only GET helpers from
 * `src/lib/ingestion/kalshi.ts`. It never places orders, never reads
 * account balances or positions, and never imports any trading
 * surface — intentionally and audibly.
 *
 * Usage:
 *   # Plan + URLs, no API calls (no key required)
 *   npx tsx scripts/ingest-kalshi-markets.ts --series KXNFLGAME --dry-run
 *
 *   # Live read (requires env vars)
 *   KALSHI_API_KEY=... \
 *   KALSHI_API_SECRET_PATH=./secrets/kalshi.pem \
 *   KALSHI_ENV=demo \
 *     npx tsx scripts/ingest-kalshi-markets.ts \
 *       --series KXNFLGAME --status open --limit 50 --max-pages 4 --orderbook
 *
 * Outputs:
 *   data/raw/kalshi/markets-<snapshotISO>-p<N>.json
 *   data/raw/kalshi/market-<ticker>-<snapshotISO>.json        (--details)
 *   data/raw/kalshi/orderbook-<ticker>-<snapshotISO>.json     (--orderbook)
 *   data/processed/kalshi_markets.csv                         (overwritten)
 *   data/processed/kalshi_orderbook.csv                       (overwritten, --orderbook)
 *
 * Safeguards:
 *   - Hard cap on pages (MAX_PAGES_CAP).
 *   - --dry-run never reads the private key and never makes HTTP calls.
 *   - The API key is never printed; the secret PEM is read once and held
 *     in memory only.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  buildMarketsUrl,
  buildMarketDetailUrl,
  buildOrderbookUrl,
  fetchMarkets,
  fetchMarketDetail,
  fetchOrderbook,
  getKalshiBaseUrl,
  loadPrivateKey,
  normalizeMarket,
  normalizeOrderbook,
  resolveKalshiEnv,
  type FetchContext,
  type KalshiEnv,
  type MarketsListOpts,
  type NormalizedKalshiMarket,
  type NormalizedKalshiOrderbookLevel,
} from "../src/lib/ingestion/kalshi";

const MAX_PAGES_CAP = 20; // hard ceiling regardless of --max-pages flag

// --- CLI --------------------------------------------------------------

interface CliArgs {
  series?: string;
  event?: string;
  status: string;
  limit: number;
  maxPages: number;
  orderbook: boolean;
  details: boolean;
  out: string;
  env: KalshiEnv;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    status: "open",
    limit: 50,
    maxPages: 1,
    orderbook: false,
    details: false,
    out: "data",
    env: resolveKalshiEnv(),
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eatValue = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--series":
        args.series = eatValue();
        break;
      case "--event":
        args.event = eatValue();
        break;
      case "--status":
        args.status = eatValue();
        break;
      case "--limit":
        args.limit = Number(eatValue());
        break;
      case "--max-pages":
        args.maxPages = Number(eatValue());
        break;
      case "--orderbook":
        args.orderbook = true;
        break;
      case "--details":
        args.details = true;
        break;
      case "--out":
        args.out = eatValue();
        break;
      case "--env":
        args.env = resolveKalshiEnv(eatValue());
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  npx tsx scripts/ingest-kalshi-markets.ts [options]

Options:
  --series TICKER    series ticker filter (e.g. KXNFLGAME)
  --event TICKER     event ticker filter (overrides --series)
  --status STATUS    market status filter (default: open)
  --limit N          page size (default: 50)
  --max-pages N      max pages to walk (default: 1, hard cap ${MAX_PAGES_CAP})
  --orderbook        also fetch per-market orderbook + emit CSV
  --details          also fetch per-market detail (richer settlement rules)
  --out DIR          root output dir (default: data)
  --env prod|demo    Kalshi environment (default: demo)
  --dry-run          print URLs only, no API calls / no key required

Env:
  KALSHI_API_KEY           access key id (required for non-dry-run)
  KALSHI_API_SECRET_PATH   path to RSA private-key PEM (required for non-dry-run)
  KALSHI_ENV               prod | demo (default: demo)
  KALSHI_BASE_URL          override the API base URL (optional)
`);
}

// --- utilities --------------------------------------------------------

function log(level: "info" | "warn" | "error", msg: string): void {
  const ts = new Date().toISOString();
  // eslint-disable-next-line no-console
  console[level === "warn" ? "warn" : level === "error" ? "error" : "log"](
    `${ts} ${level.toUpperCase()} ${msg}`,
  );
}

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

function writeJSON(p: string, value: unknown): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
}

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function writeCsv(
  p: string,
  columns: string[],
  rows: Record<string, unknown>[],
): number {
  ensureDir(path.dirname(p));
  const lines: string[] = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsv(row[c])).join(","));
  }
  fs.writeFileSync(p, lines.join("\n") + "\n");
  return rows.length;
}

function safeName(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

// --- column lists -----------------------------------------------------

const MARKET_COLUMNS: (keyof NormalizedKalshiMarket)[] = [
  "ticker",
  "event_ticker",
  "series_ticker",
  "market_type",
  "title",
  "yes_sub_title",
  "no_sub_title",
  "status",
  "open_time",
  "close_time",
  "expiration_time",
  "yes_bid",
  "yes_ask",
  "no_bid",
  "no_ask",
  "last_price",
  "yes_bid_prob",
  "yes_ask_prob",
  "no_bid_prob",
  "no_ask_prob",
  "mid_yes_prob",
  "volume",
  "volume_24h",
  "liquidity",
  "open_interest",
  "settlement_rules",
  "result",
  "snapshot_time",
];

const ORDERBOOK_COLUMNS: (keyof NormalizedKalshiOrderbookLevel)[] = [
  "ticker",
  "snapshot_time",
  "side",
  "level",
  "price_cents",
  "price_prob",
  "quantity",
];

// --- main flow --------------------------------------------------------

async function main(argv: string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    log("error", (err as Error).message);
    printHelp();
    return 2;
  }

  if (args.maxPages > MAX_PAGES_CAP) {
    log(
      "warn",
      `--max-pages=${args.maxPages} clamped to MAX_PAGES_CAP=${MAX_PAGES_CAP}`,
    );
    args.maxPages = MAX_PAGES_CAP;
  }

  const baseUrl = getKalshiBaseUrl(args.env);
  log(
    "info",
    `env=${args.env} base=${baseUrl} series=${args.series ?? "(none)"} event=${args.event ?? "(none)"} status=${args.status} limit=${args.limit} maxPages=${args.maxPages} orderbook=${args.orderbook} details=${args.details} dryRun=${args.dryRun}`,
  );

  if (!args.series && !args.event) {
    log(
      "warn",
      "no --series or --event provided; fetching across all markets (set --max-pages low to avoid surprises)",
    );
  }

  // --- dry-run: print URLs and exit
  if (args.dryRun) {
    let pageUrls = 0;
    for (let p = 0; p < args.maxPages; p++) {
      const opts: MarketsListOpts = {
        series_ticker: args.series,
        event_ticker: args.event,
        status: args.status,
        limit: args.limit,
        cursor: p === 0 ? undefined : `<PAGE_${p}_CURSOR>`,
      };
      const url = buildMarketsUrl(baseUrl, opts);
      log("info", `[dry] markets   page=${p}  url=${url}`);
      pageUrls++;
      if (args.details) {
        log(
          "info",
          `[dry] detail    per-market url example  ${buildMarketDetailUrl(baseUrl, "<TICKER>")}`,
        );
      }
      if (args.orderbook) {
        log(
          "info",
          `[dry] orderbook per-market url example  ${buildOrderbookUrl(baseUrl, "<TICKER>")}`,
        );
      }
    }
    log(
      "info",
      `Dry-run complete. Planned: ${pageUrls} market-list page(s)${args.details ? " + per-market detail" : ""}${args.orderbook ? " + per-market orderbook" : ""}.`,
    );
    return 0;
  }

  // --- live: validate env
  const apiKey = process.env.KALSHI_API_KEY;
  const secretPath = process.env.KALSHI_API_SECRET_PATH;
  if (!apiKey || !secretPath) {
    log(
      "error",
      "KALSHI_API_KEY and KALSHI_API_SECRET_PATH env vars are required for non-dry-run mode. Re-run with --dry-run to see the plan.",
    );
    return 2;
  }

  let privateKey;
  try {
    privateKey = loadPrivateKey(secretPath);
  } catch (err) {
    log("error", (err as Error).message);
    return 1;
  }

  const ctx: FetchContext = { baseUrl, apiKey, privateKey };

  const rawRoot = path.join(args.out, "raw", "kalshi");
  const processedRoot = path.join(args.out, "processed");
  ensureDir(rawRoot);
  ensureDir(processedRoot);

  const snapshotISO = new Date().toISOString();
  const snapshotStamp = safeName(snapshotISO);

  const normalizedMarkets: NormalizedKalshiMarket[] = [];
  const normalizedOrderbook: NormalizedKalshiOrderbookLevel[] = [];
  let cursor: string | undefined = undefined;
  let totalFetched = 0;

  for (let page = 0; page < args.maxPages; page++) {
    log(
      "info",
      `fetching markets page ${page + 1}/${args.maxPages}` +
        (cursor ? ` cursor=${cursor}` : ""),
    );
    const resp = await fetchMarkets(ctx, {
      series_ticker: args.series,
      event_ticker: args.event,
      status: args.status,
      limit: args.limit,
      cursor,
    });
    writeJSON(
      path.join(rawRoot, `markets-${snapshotStamp}-p${page}.json`),
      resp,
    );

    for (const market of resp.markets ?? []) {
      let finalMarket = market;
      if (args.details) {
        try {
          const detail = await fetchMarketDetail(ctx, market.ticker);
          writeJSON(
            path.join(
              rawRoot,
              `market-${safeName(market.ticker)}-${snapshotStamp}.json`,
            ),
            detail,
          );
          finalMarket = detail.market ?? market;
        } catch (err) {
          log(
            "warn",
            `detail fetch failed for ${market.ticker}: ${(err as Error).message}`,
          );
        }
      }
      normalizedMarkets.push(normalizeMarket(finalMarket, snapshotISO));

      if (args.orderbook) {
        try {
          const ob = await fetchOrderbook(ctx, market.ticker);
          writeJSON(
            path.join(
              rawRoot,
              `orderbook-${safeName(market.ticker)}-${snapshotStamp}.json`,
            ),
            ob,
          );
          normalizedOrderbook.push(
            ...normalizeOrderbook(market.ticker, ob.orderbook ?? {}, snapshotISO),
          );
        } catch (err) {
          log(
            "warn",
            `orderbook fetch failed for ${market.ticker}: ${(err as Error).message}`,
          );
        }
      }
      totalFetched++;
    }

    if (!resp.cursor) {
      log("info", `no more pages (received ${resp.markets?.length ?? 0} on last page)`);
      break;
    }
    cursor = resp.cursor;
  }

  const marketsPath = path.join(processedRoot, "kalshi_markets.csv");
  const n = writeCsv(
    marketsPath,
    MARKET_COLUMNS as string[],
    normalizedMarkets as unknown as Record<string, unknown>[],
  );
  log("info", `wrote ${marketsPath} (${n} rows)`);

  if (args.orderbook) {
    const obPath = path.join(processedRoot, "kalshi_orderbook.csv");
    const nb = writeCsv(
      obPath,
      ORDERBOOK_COLUMNS as string[],
      normalizedOrderbook as unknown as Record<string, unknown>[],
    );
    log("info", `wrote ${obPath} (${nb} levels)`);
  }

  log("info", `done. markets fetched: ${totalFetched}`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    log("error", (err as Error).stack ?? String(err));
    process.exit(1);
  },
);
