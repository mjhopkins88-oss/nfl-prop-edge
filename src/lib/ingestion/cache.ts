/**
 * On-disk request cache for ingestion scripts.
 *
 * Each entry lives under `data/cache/<source>/<hash>.json` and stores
 * the raw response plus metadata (URL with apiKey masked, saved-at
 * timestamp). Callers build a deterministic key with `buildCacheKey`,
 * check `hasCachedResponse`, read with `getCachedResponse`, and write
 * with `saveCachedResponse`.
 *
 * Keys hash the **(source, endpoint, params)** tuple — never the
 * apiKey, so cache entries are portable between dev / CI / users.
 * The persisted URL has its apiKey replaced with `***MASKED***` so
 * accidentally committing a cache file never leaks a key (the cache
 * directory is gitignored anyway).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CACHE_ROOT } from "../../config/api-budget";

export interface CacheEntry<T> {
  key: string;
  url: string | null;
  savedAt: string;
  response: T;
}

export interface BuildCacheKeyArgs {
  source: string;
  endpoint: string;
  params?: Record<string, unknown>;
}

/**
 * Build a deterministic cache key for (source, endpoint, params).
 * Returns a path-friendly string like `odds-api/4a8c…json`.
 */
export function buildCacheKey(args: BuildCacheKeyArgs): string {
  const normalized = JSON.stringify({
    source: args.source,
    endpoint: args.endpoint,
    params: sortParams(args.params ?? {}),
  });
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `${sanitize(args.source)}/${hash}.json`;
}

export function hasCachedResponse(key: string): boolean {
  return fs.existsSync(path.join(CACHE_ROOT, key));
}

export interface GetCachedResponseOpts {
  /** Reject entries older than this many milliseconds. */
  maxAgeMs?: number;
}

export function getCachedResponse<T>(
  key: string,
  opts: GetCachedResponseOpts = {},
): T | null {
  const p = path.join(CACHE_ROOT, key);
  if (!fs.existsSync(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as CacheEntry<T>;
    if (opts.maxAgeMs != null) {
      const age = Date.now() - new Date(raw.savedAt).getTime();
      if (age > opts.maxAgeMs) return null;
    }
    return raw.response;
  } catch {
    return null; // corrupt cache file — treat as miss
  }
}

export interface SaveCachedResponseOpts {
  /** Source URL to record alongside the response. apiKey will be masked. */
  url?: string;
}

export function saveCachedResponse<T>(
  key: string,
  response: T,
  opts: SaveCachedResponseOpts = {},
): void {
  const p = path.join(CACHE_ROOT, key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const entry: CacheEntry<T> = {
    key,
    url: opts.url ? maskApiKeyInUrl(opts.url) : null,
    savedAt: new Date().toISOString(),
    response,
  };
  fs.writeFileSync(p, JSON.stringify(entry, null, 2));
}

// --- helpers ---------------------------------------------------------

function sortParams(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(p).sort()) out[k] = p[k];
  return out;
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function maskApiKeyInUrl(url: string): string {
  return url.replace(/(apiKey=)[^&]+/i, "$1***MASKED***");
}
