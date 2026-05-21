/**
 * Team-abbreviation normalization for 2025 Week 1 schedule mapping.
 *
 * Different data sources use different abbreviations for the
 * same NFL franchises. The 2025 Week 1 readiness pipeline pulls
 * from three sources:
 *
 *   · the static schedule fixture
 *     (`data/fixtures/nfl/2025-week-1-schedule.fixture.json`)
 *   · processed nflverse data
 *     (`data/processed/nfl/games.csv`, `rosters.csv`)
 *   · the Odds API ingestion (writes the canonical per-week
 *     odds file via `canonical-odds-writer`)
 *
 * Most teams agree across all three. The known discrepancy in
 * 2025: nflverse uses `LA` for the Los Angeles Rams; the
 * schedule fixture (and the rest of the world) uses `LAR`. The
 * older nflverse convention is the outlier.
 *
 * This module pins a single canonical form per team and applies
 * the alias map wherever team strings cross our boundary.
 *
 * Pure data — no API calls, no network, no model logic. The
 * mapping table is auditable in one place.
 */

import type { ExpectedWeek1Game } from "./week-1-schedule-validation";

/**
 * Source-abbreviation → canonical-abbreviation. Canonical = what
 * the schedule fixture uses. Add aliases here as they surface;
 * the only confirmed mismatch today is LA → LAR.
 */
export const TEAM_ALIASES: Readonly<Record<string, string>> = {
  // LA Rams — nflverse pre-2024 convention.
  LA: "LAR",
  // Defensive aliases — surface elsewhere in the wild even
  // though our current data uses the canonical form.
  JAC: "JAX",
  WSH: "WAS",
  ARZ: "ARI",
};

/**
 * Canonicalize a team abbreviation. Case-insensitive input,
 * uppercase output. Unknown abbreviations pass through (we
 * never invent a new code).
 */
export function normalizeTeamAbbreviation(team: string): string {
  if (!team) return "";
  const up = team.toUpperCase().trim();
  return TEAM_ALIASES[up] ?? up;
}

/**
 * Build a `${away}@${home}` lookup keyed by the normalized team
 * pair, plus an unordered fallback `[a, b].sort().join("+")`
 * for when home/away orientation is unknown.
 */
export function buildWeek1GameLookupByTeams(
  games: readonly ExpectedWeek1Game[],
): Map<string, ExpectedWeek1Game> {
  const out = new Map<string, ExpectedWeek1Game>();
  for (const g of games) {
    const away = normalizeTeamAbbreviation(g.awayTeam);
    const home = normalizeTeamAbbreviation(g.homeTeam);
    out.set(`${away}@${home}`, g);
    // Unordered fallback so callers without a home/away signal
    // can still resolve the game.
    out.set([away, home].sort().join("+"), g);
  }
  return out;
}

/**
 * Given a player's team + opponent (in either orientation),
 * return the matching schedule game — or undefined when no
 * pair in the schedule contains both teams.
 */
export function mapOddsGameToScheduleGame(args: {
  team: string;
  opponent: string;
  schedule: readonly ExpectedWeek1Game[];
}): ExpectedWeek1Game | undefined {
  const t = normalizeTeamAbbreviation(args.team);
  const o = normalizeTeamAbbreviation(args.opponent);
  if (!t || !o) return undefined;
  const lookup = buildWeek1GameLookupByTeams(args.schedule);
  return (
    lookup.get(`${t}@${o}`) ??
    lookup.get(`${o}@${t}`) ??
    lookup.get([t, o].sort().join("+"))
  );
}

export interface CanonicalOddsRowLike {
  season: number;
  week: number;
  gameId: string;
  team: string;
  opponent: string;
}

export interface OddsGameIdValidationReport {
  totalRows: number;
  validRows: number;
  invalidGameIds: string[];
  reasonsByGameId: Record<string, string>;
  rebuildableRows: number;
}

/**
 * Inspect canonical odds rows against the schedule and report
 * which gameIds (if any) won't pass validation. `rebuildableRows`
 * is the count we could fix by re-mapping via team pair.
 */
export function validateCanonicalOddsGameIds(args: {
  rows: readonly CanonicalOddsRowLike[];
  schedule: readonly ExpectedWeek1Game[];
}): OddsGameIdValidationReport {
  const validIds = new Set(args.schedule.map((g) => g.gameId));
  const invalid = new Map<string, string>();
  let valid = 0;
  let rebuildable = 0;
  for (const row of args.rows) {
    if (validIds.has(row.gameId)) {
      valid += 1;
      continue;
    }
    const mapped = mapOddsGameToScheduleGame({
      team: row.team,
      opponent: row.opponent,
      schedule: args.schedule,
    });
    if (mapped) {
      rebuildable += 1;
      invalid.set(
        row.gameId,
        `not in schedule; team-pair (${row.team}@${row.opponent}) maps to ${mapped.gameId}`,
      );
    } else {
      invalid.set(
        row.gameId,
        `not in schedule; team-pair (${row.team}@${row.opponent}) does not match any Week 1 game`,
      );
    }
  }
  return {
    totalRows: args.rows.length,
    validRows: valid,
    invalidGameIds: [...invalid.keys()],
    reasonsByGameId: Object.fromEntries(invalid),
    rebuildableRows: rebuildable,
  };
}
