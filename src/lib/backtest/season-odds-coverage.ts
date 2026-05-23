/**
 * Season-level stored-odds coverage audit.
 *
 * For each week in a requested range, counts the
 * `StoredPropMarket` rows persisted for (season, week) and
 * reports which weeks are completely missing.
 *
 * Pure async function — reads only via the injected
 * persistence client. Used by:
 *   · the `paid-season-full` action's dry-run preview, which
 *     enumerates missing weeks and computes the total credit
 *     estimate BEFORE any paid API call fires.
 *   · the `paid-season-full` action's execute path, which
 *     loops `paid-week-full` only for weeks that have no
 *     stored odds (avoids re-spending on weeks already
 *     covered).
 *   · admin-side coverage diagnostics.
 *
 * No paid API call. No file IO. The persistence client is
 * the single source of truth for "what's in the DB".
 */

import type { PersistenceClient } from "../persistence/week-1-persistence";

export interface SeasonOddsCoveragePerWeek {
  week: number;
  storedPropMarketRows: number;
  /** True when storedPropMarketRows > 0 (i.e. at least one
   *  odds row exists for this week). The minimum-row bar
   *  is intentionally low — operators can layer a stricter
   *  threshold on top if the diagnostic suggests partial
   *  coverage isn't enough. */
  present: boolean;
}

export interface SeasonOddsCoverage {
  season: number;
  weeksRequested: number[];
  perWeek: SeasonOddsCoveragePerWeek[];
  weeksPresent: number[];
  weeksMissing: number[];
  /** True when the persistence layer was unavailable for the
   *  audit (no DATABASE_URL, DB unreachable). Coverage rows
   *  default to `present: false` but the caller should treat
   *  the entire audit as inconclusive rather than triggering
   *  paid ingestion blindly. */
  persistenceAvailable: boolean;
}

export async function buildSeasonOddsCoverage(args: {
  season: number;
  weeks: ReadonlyArray<number>;
  persistence: PersistenceClient;
}): Promise<SeasonOddsCoverage> {
  const perWeek: SeasonOddsCoveragePerWeek[] = [];
  const persistenceAvailable = args.persistence.isAvailable();
  for (const week of args.weeks) {
    if (!persistenceAvailable) {
      perWeek.push({
        week,
        storedPropMarketRows: 0,
        present: false,
      });
      continue;
    }
    const counts = await args.persistence.countPersistence({
      season: args.season,
      week,
    });
    const rows = counts.counts?.storedPropMarketRows ?? 0;
    perWeek.push({
      week,
      storedPropMarketRows: rows,
      present: rows > 0,
    });
  }
  const weeksPresent = perWeek.filter((w) => w.present).map((w) => w.week);
  const weeksMissing = perWeek
    .filter((w) => !w.present)
    .map((w) => w.week);
  return {
    season: args.season,
    weeksRequested: [...args.weeks],
    perWeek,
    weeksPresent,
    weeksMissing,
    persistenceAvailable,
  };
}

export function formatSeasonOddsCoverage(
  coverage: SeasonOddsCoverage,
): string {
  const lines: string[] = [];
  lines.push(
    `Season ${coverage.season} · weeks requested: ${coverage.weeksRequested.map((w) => `W${w}`).join(", ")}`,
  );
  if (!coverage.persistenceAvailable) {
    lines.push(
      "PERSISTENCE NOT AVAILABLE — DATABASE_URL is unset or the DB is unreachable.",
    );
    lines.push(
      "Coverage is unknown; refuse paid ingestion until persistence is reachable.",
    );
    return lines.join("\n");
  }
  lines.push(
    `Coverage: ${coverage.weeksPresent.length}/${coverage.weeksRequested.length} weeks have stored odds.`,
  );
  if (coverage.weeksPresent.length > 0) {
    lines.push(
      `Present:  ${coverage.weeksPresent.map((w) => `W${w}`).join(", ")}`,
    );
  }
  if (coverage.weeksMissing.length > 0) {
    lines.push(
      `Missing:  ${coverage.weeksMissing.map((w) => `W${w}`).join(", ")}`,
    );
  }
  lines.push("");
  lines.push("Per-week row counts:");
  for (const w of coverage.perWeek) {
    lines.push(
      `  W${w.week}: ${w.storedPropMarketRows} rows ${w.present ? "(present)" : "(MISSING)"}`,
    );
  }
  return lines.join("\n");
}
