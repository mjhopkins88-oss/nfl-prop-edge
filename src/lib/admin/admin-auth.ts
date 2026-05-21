/**
 * Shared bearer-token check for the admin ingestion routes.
 *
 * The token lives in `ADMIN_INGEST_TOKEN`. It is never sent back
 * to the client — only `isAdminTokenConfigured()` (a boolean) is
 * surfaced. The compare is constant-time to avoid timing oracles.
 *
 * No paid APIs. No model logic. No automated betting.
 */

import { timingSafeEqual } from "node:crypto";

export const ADMIN_TOKEN_HEADER = "x-admin-ingest-token";
export const ADMIN_INGEST_TOKEN_ENV = "ADMIN_INGEST_TOKEN";

export function isAdminTokenConfigured(): boolean {
  const v = process.env[ADMIN_INGEST_TOKEN_ENV];
  return typeof v === "string" && v.length > 0;
}

/**
 * Constant-time compare of a presented token against
 * `ADMIN_INGEST_TOKEN`. Returns false when the env var is unset,
 * the presented value is missing/empty, or the lengths differ
 * (we still run a dummy compare so the timing profile is
 * uniform).
 */
export function verifyAdminToken(provided: string | null | undefined): boolean {
  const expected = process.env[ADMIN_INGEST_TOKEN_ENV];
  // Always perform one timingSafeEqual call so callers see a
  // uniform compute path. The actual decision is driven by the
  // structured checks below.
  const dummy = Buffer.alloc(32);
  timingSafeEqual(dummy, dummy);
  if (!expected || typeof expected !== "string") return false;
  if (!provided || typeof provided !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Extract the admin token from a Headers-like object.
 * Accepts both the canonical lowercase header and a few
 * common casings — fetch normalizes headers but we don't want
 * to be fragile in tests.
 */
export function readAdminTokenFromHeaders(
  headers: { get(name: string): string | null } | Headers,
): string | null {
  const direct = headers.get(ADMIN_TOKEN_HEADER);
  if (direct) return direct;
  const alt = headers.get(ADMIN_TOKEN_HEADER.toUpperCase());
  return alt ?? null;
}
