/**
 * NFL schedule kickoff-time normalization.
 *
 * The nflverse schedules release splits the kickoff into two
 * columns:
 *
 *   gameday  -- YYYY-MM-DD (e.g. "2025-09-04")
 *   gametime -- HH:MM      (e.g. "20:20", US Eastern wall clock)
 *
 * Other parts of the codebase (the Odds API client, the schedule
 * fixture, every renderer) expect a single ISO 8601 UTC string.
 * This module centralizes that combine-and-convert step so the
 * normalizer in `nflverse.ts` does not duplicate the DST math.
 *
 * Rules:
 *   · A pre-existing valid ISO 8601 UTC string passes through
 *     unchanged.
 *   · `gameday + gametime` is interpreted as US/Eastern wall
 *     clock and converted to UTC, honouring US DST (second
 *     Sunday of March through first Sunday of November).
 *   · Missing or malformed input returns a clear status — never
 *     a silently-emitted invalid date.
 *
 * No paid APIs. No model logic. No touchdown handling. Pure
 * date arithmetic.
 */

export interface ParsedKickoffTime {
  status: "VALID" | "MISSING" | "INVALID";
  /** UTC ISO 8601 string (e.g. "2025-09-05T00:20:00.000Z"). */
  isoUtc?: string;
  /** Human-readable hint when status !== "VALID". */
  reason?: string;
  /** Which input branch produced the result, for debugging/tests. */
  source?: "iso-utc" | "iso-local" | "gameday+gametime";
}

const GAMEDAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const GAMETIME_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function isValidIsoDateTime(value: string | undefined): boolean {
  if (!value) return false;
  const d = new Date(value);
  return Number.isFinite(d.getTime());
}

/**
 * Second Sunday of March for the given year (1-indexed day of
 * month). DST in the US starts at 02:00 local on this day.
 */
function secondSundayOfMarch(year: number): number {
  const march1 = new Date(Date.UTC(year, 2, 1));
  const dow = march1.getUTCDay();
  const firstSunday = dow === 0 ? 1 : 1 + (7 - dow);
  return firstSunday + 7;
}

/**
 * First Sunday of November for the given year. DST ends at 02:00
 * local on this day.
 */
function firstSundayOfNovember(year: number): number {
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const dow = nov1.getUTCDay();
  return dow === 0 ? 1 : 1 + (7 - dow);
}

/**
 * Is the wall-clock date in US/Eastern DST? Day-level resolution
 * is fine for NFL games (no kickoff is scheduled at 02:00 local).
 */
export function isUSEasternDST(
  year: number,
  monthOneIndexed: number,
  day: number,
): boolean {
  if (monthOneIndexed < 3 || monthOneIndexed > 11) return false;
  if (monthOneIndexed > 3 && monthOneIndexed < 11) return true;
  if (monthOneIndexed === 3) return day >= secondSundayOfMarch(year);
  return day < firstSundayOfNovember(year);
}

/**
 * UTC offset (in hours) for US/Eastern on the given wall-clock
 * date. EDT = -4, EST = -5. The sign matches `Date.prototype`'s
 * convention — UTC = local - offset.
 */
export function easternOffsetHours(
  year: number,
  monthOneIndexed: number,
  day: number,
): number {
  return isUSEasternDST(year, monthOneIndexed, day) ? -4 : -5;
}

/**
 * Combine a YYYY-MM-DD `gameday` with an HH:MM `gametime`
 * (US/Eastern wall clock) into a UTC ISO 8601 timestamp.
 *
 * Returns `undefined` when either input is missing or malformed.
 * Use `parseNflverseKickoffTime` when you want a structured
 * status instead of a bare undefined.
 */
export function combineEasternToUtcIso(args: {
  gameday: string;
  gametime: string;
}): string | undefined {
  const dateMatch = GAMEDAY_RE.exec(args.gameday);
  const timeMatch = GAMETIME_RE.exec(args.gametime);
  if (!dateMatch || !timeMatch) return undefined;
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]); // 1-indexed
  const day = Number(dateMatch[3]);
  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  const ss = timeMatch[3] !== undefined ? Number(timeMatch[3]) : 0;
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hh > 23 ||
    mm > 59 ||
    ss > 59
  ) {
    return undefined;
  }
  // Build a Date assuming the wall clock were UTC, then subtract
  // the Eastern offset (in hours) to reach the true UTC instant.
  // EDT = -4 → subtract (-4)h = add 4h.  EST = -5 → add 5h.
  const offsetHours = easternOffsetHours(year, month, day);
  const wallAsUtcMs = Date.UTC(year, month - 1, day, hh, mm, ss);
  const trueUtcMs = wallAsUtcMs - offsetHours * 3600 * 1000;
  const d = new Date(trueUtcMs);
  if (!Number.isFinite(d.getTime())) return undefined;
  return d.toISOString();
}

/**
 * Top-level parser. Honours three input shapes:
 *
 *   1. `startTimeUtc` is already a valid ISO 8601 string. Pass
 *      through (status=VALID, source="iso-utc").
 *   2. `gameday` + `gametime` are present and well-formed.
 *      Combine and convert (source="gameday+gametime").
 *   3. None of the above — return MISSING/INVALID with a reason.
 *
 * Never silently emits an invalid date.
 */
export function parseNflverseKickoffTime(args: {
  gameday?: string;
  gametime?: string;
  startTimeUtc?: string;
}): ParsedKickoffTime {
  if (args.startTimeUtc) {
    if (isValidIsoDateTime(args.startTimeUtc)) {
      return {
        status: "VALID",
        isoUtc: new Date(args.startTimeUtc).toISOString(),
        source: "iso-utc",
      };
    }
    // Fall through — a bare HH:MM looks like a "startTimeUtc"
    // shape but won't parse. Try to combine with gameday.
  }
  if (!args.gameday) {
    return {
      status: "MISSING",
      reason: "gameday missing",
    };
  }
  if (!args.gametime) {
    return {
      status: "MISSING",
      reason: "gametime missing (game time TBD?)",
    };
  }
  const iso = combineEasternToUtcIso({
    gameday: args.gameday,
    gametime: args.gametime,
  });
  if (!iso) {
    return {
      status: "INVALID",
      reason: `cannot parse gameday=${args.gameday} gametime=${args.gametime}`,
    };
  }
  return { status: "VALID", isoUtc: iso, source: "gameday+gametime" };
}

/**
 * Convenience used by the schedule normalizer: returns the ISO
 * string when valid, or `undefined` when not — matching the
 * existing `startTimeUtc?: string` field shape.
 */
export function normalizeNflKickoffTime(
  row: Record<string, string | undefined>,
): string | undefined {
  const parsed = parseNflverseKickoffTime({
    gameday: row.gameday,
    gametime: row.gametime,
    startTimeUtc: row.start_time_utc ?? row.start_time,
  });
  return parsed.status === "VALID" ? parsed.isoUtc : undefined;
}
