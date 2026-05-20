/**
 * Single source of truth for the season / week / data-mode that
 * the deployed UI thinks it is in.
 *
 * Why this exists: before this module landed, the Header and the
 * homepage hero each hard-coded "Week 11 · 2025" — which made the
 * whole site look like a Week-11 live-week experience even though
 * the active focus is the Week 1 historical starter test. The
 * Game Edge, Parlay Builder, Backtest, Monitor, and Week 1 pages
 * all already knew what they were showing; only the chrome
 * lagged.
 *
 * Defaults below favour the Week-1 starter test. The Week-11
 * mock dataset is kept reachable behind `getDemoAppContext()` so
 * we can label the legacy homepage as DEMO without deleting it.
 *
 * Pure constants + helpers. No model logic. No state.
 */

export const DEFAULT_SEASON = 2025;
export const DEFAULT_DISPLAY_WEEK = 1;
export const DEMO_WEEK = 11;
export const WEEK_1_STARTER_TEST_ENABLED = true;

export type AppDataMode =
  | "DEMO"
  | "WEEK_1_STARTER_TEST"
  | "BACKTEST"
  | "STORED_REAL_DATA";

export interface AppSeasonWeekContext {
  season: number;
  week: number;
  dataMode: AppDataMode;
  /**
   * Pretty label suitable for the Header chip. Examples:
   *   "Week 1 · 2025"
   *   "Week 1 Starter Test · 2025"
   *   "Demo · Week 11 · 2025"
   */
  label: string;
  /** Short subtitle used in cards / hints. */
  shortLabel: string;
}

/**
 * Default app context — Week 1 2025 starter test.
 * Used by the Header and any neutral surface (Backtest, Monitor,
 * Game Edge, Parlay Builder).
 */
export function getDefaultAppContext(): AppSeasonWeekContext {
  return {
    season: DEFAULT_SEASON,
    week: DEFAULT_DISPLAY_WEEK,
    dataMode: "WEEK_1_STARTER_TEST",
    label: `Week ${DEFAULT_DISPLAY_WEEK} · ${DEFAULT_SEASON}`,
    shortLabel: `W${DEFAULT_DISPLAY_WEEK} · ${DEFAULT_SEASON}`,
  };
}

/**
 * Context used by surfaces that are explicitly running the
 * Week-1 starter test (the Week-1 backtest page).
 */
export function getWeek1StarterTestContext(): AppSeasonWeekContext {
  return {
    season: DEFAULT_SEASON,
    week: 1,
    dataMode: "WEEK_1_STARTER_TEST",
    label: `Week 1 Starter Test · ${DEFAULT_SEASON}`,
    shortLabel: `W1 Starter Test`,
  };
}

/**
 * Context for the legacy Week-11 mock-data dashboard at `/`.
 * Clearly labels itself as DEMO so visitors aren't misled.
 */
export function getDemoAppContext(): AppSeasonWeekContext {
  return {
    season: DEFAULT_SEASON,
    week: DEMO_WEEK,
    dataMode: "DEMO",
    label: `Demo · Week ${DEMO_WEEK} · ${DEFAULT_SEASON}`,
    shortLabel: `Demo · W${DEMO_WEEK}`,
  };
}

/**
 * Compute the Header chip label for a context — used by the
 * Header component so the chrome and the page body never
 * disagree about which week they think they're showing.
 */
export function getWeekLabel(context: AppSeasonWeekContext): string {
  return context.label;
}

export class InvalidAppContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAppContextError";
  }
}

/**
 * Throw on invalid context. Used by the smoke tests + by any
 * future loader that wants to refuse bad inputs cleanly.
 */
export function assertValidSeasonWeekContext(
  context: AppSeasonWeekContext,
): void {
  if (!Number.isInteger(context.season) || context.season < 2020) {
    throw new InvalidAppContextError(
      `season must be an integer ≥ 2020 — got ${context.season}`,
    );
  }
  if (!Number.isInteger(context.week) || context.week < 1 || context.week > 22) {
    throw new InvalidAppContextError(
      `week must be an integer in [1, 22] — got ${context.week}`,
    );
  }
  const validModes: AppDataMode[] = [
    "DEMO",
    "WEEK_1_STARTER_TEST",
    "BACKTEST",
    "STORED_REAL_DATA",
  ];
  if (!validModes.includes(context.dataMode)) {
    throw new InvalidAppContextError(
      `dataMode must be one of ${validModes.join(" | ")} — got ${context.dataMode}`,
    );
  }
  if (!context.label || !context.shortLabel) {
    throw new InvalidAppContextError(
      "label and shortLabel are required",
    );
  }
}
