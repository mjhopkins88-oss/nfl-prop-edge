/**
 * Manual injury-flag loader and lookup helpers.
 *
 * V1 reads `data/manual/injury_flags.csv` only — no paid injury feed.
 * The CSV encodes five kinds of adjustment within one row shape:
 *
 *   1. Player questionable / out
 *        status = "out" | "doubtful" | "questionable" | "probable"
 *        injuryImpact = "high" | "medium" | "low"
 *        playerName = the injured player
 *
 *   2. Teammate role boost (beneficiary of someone else's absence)
 *        status = "active"
 *        injuryImpact = "boost"
 *        playerName = the BENEFICIARY (not the injured player)
 *        notes = describe the dependency
 *
 *   3. Offensive line injury (team-level, affects QB + RBs)
 *        position = "OL"
 *        injuryImpact = "ol_depleted"
 *
 *   4. Defensive back injury (team-level, boosts opposing receivers)
 *        position in {"CB", "S", "DB"}
 *        injuryImpact = "db_depleted"
 *
 *   5. Game-level weather / injury uncertainty flag
 *        playerName = "" (or "—")
 *        status = "uncertain"
 *        injuryImpact = "uncertainty"
 *        roleImpact = describe the uncertainty
 *
 * Consumers can query each flag type directly, or call `getPlayerContext`
 * to get all relevant flags for one player in one game.
 */

import fs from "node:fs";

// --- types ------------------------------------------------------------

export type InjuryStatus =
  | "out"
  | "doubtful"
  | "questionable"
  | "probable"
  | "active"
  | "uncertain";

export type InjuryImpact =
  | "high"
  | "medium"
  | "low"
  | "boost"
  | "ol_depleted"
  | "db_depleted"
  | "uncertainty"
  | "none";

const VALID_STATUSES = new Set<InjuryStatus>([
  "out",
  "doubtful",
  "questionable",
  "probable",
  "active",
  "uncertain",
]);

const VALID_IMPACTS = new Set<InjuryImpact>([
  "high",
  "medium",
  "low",
  "boost",
  "ol_depleted",
  "db_depleted",
  "uncertainty",
  "none",
]);

const OL_POSITIONS = new Set(["OL", "LT", "LG", "C", "RG", "RT", "G", "T"]);
const DB_POSITIONS = new Set(["DB", "CB", "S", "FS", "SS", "NCB"]);

export interface InjuryFlag {
  season: number;
  week: number;
  gameId: string;
  team: string; // home/away team abbr; empty string for game-level flags
  playerName: string; // empty/"-"/"—" for game-level flags
  position: string;
  status: InjuryStatus;
  injuryImpact: InjuryImpact;
  roleImpact: string;
  notes: string;
}

/** Per-player rollup of every flag that could move a projection. */
export interface PlayerInjuryContext {
  /** This player's own status flag, if any. */
  selfStatus: InjuryFlag | null;
  /** Teammate-boost flags where THIS player is the beneficiary. */
  teammateBoosts: InjuryFlag[];
  /** OL on this player's own team is depleted (affects QB + RB). */
  olInjuryOnOwnTeam: boolean;
  /** Opposing defensive backs are depleted (boosts WR / TE / pass game). */
  dbInjuryOnOpposingTeam: boolean;
  /** Game-level uncertainty flag set (widen σ in the projection). */
  uncertaintyForGame: boolean;
  /** Raw flags relevant to this player, for transparency in reasons/risks. */
  rawFlags: InjuryFlag[];
}

// --- CSV loader -------------------------------------------------------

export function loadInjuryFlags(csvPath: string): InjuryFlag[] {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`injury_flags CSV not found at ${csvPath}`);
  }
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  const out: InjuryFlag[] = [];
  for (const row of rows) {
    const status = (row.status || "").trim() as InjuryStatus;
    const impact = (row.injuryImpact || "").trim() as InjuryImpact;
    if (!VALID_STATUSES.has(status)) {
      // Skip with a warning instead of throwing — manual data is brittle.
      // eslint-disable-next-line no-console
      console.warn(
        `[injuries] skipping row with unknown status="${row.status}" (gameId=${row.gameId}, player=${row.playerName})`,
      );
      continue;
    }
    if (!VALID_IMPACTS.has(impact)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[injuries] skipping row with unknown injuryImpact="${row.injuryImpact}" (gameId=${row.gameId}, player=${row.playerName})`,
      );
      continue;
    }
    out.push({
      season: Number(row.season),
      week: Number(row.week),
      gameId: row.gameId,
      team: row.team || "",
      playerName: row.playerName || "",
      position: row.position || "",
      status,
      injuryImpact: impact,
      roleImpact: row.roleImpact || "",
      notes: row.notes || "",
    });
  }
  return out;
}

// --- classification predicates ----------------------------------------

export function isGameLevelFlag(f: InjuryFlag): boolean {
  const name = f.playerName.trim();
  return name === "" || name === "-" || name === "—";
}

export function isOlFlag(f: InjuryFlag): boolean {
  return f.injuryImpact === "ol_depleted" || OL_POSITIONS.has(f.position);
}

export function isDbFlag(f: InjuryFlag): boolean {
  return f.injuryImpact === "db_depleted" || DB_POSITIONS.has(f.position);
}

export function isBoostFlag(f: InjuryFlag): boolean {
  return f.injuryImpact === "boost";
}

export function isUncertaintyFlag(f: InjuryFlag): boolean {
  return f.injuryImpact === "uncertainty" || f.status === "uncertain";
}

// --- lookup helpers ---------------------------------------------------

export function getFlagsForGame(flags: InjuryFlag[], gameId: string): InjuryFlag[] {
  return flags.filter((f) => f.gameId === gameId);
}

export function getFlagsForTeam(
  flags: InjuryFlag[],
  season: number,
  week: number,
  team: string,
): InjuryFlag[] {
  return flags.filter(
    (f) => f.season === season && f.week === week && f.team === team,
  );
}

export function getFlagsForPlayer(
  flags: InjuryFlag[],
  season: number,
  week: number,
  team: string,
  playerName: string,
): InjuryFlag[] {
  return flags.filter(
    (f) =>
      f.season === season &&
      f.week === week &&
      f.team === team &&
      f.playerName === playerName,
  );
}

export function getPlayerStatus(
  flags: InjuryFlag[],
  season: number,
  week: number,
  team: string,
  playerName: string,
): InjuryFlag | null {
  return (
    flags.find(
      (f) =>
        f.season === season &&
        f.week === week &&
        f.team === team &&
        f.playerName === playerName &&
        ["out", "doubtful", "questionable", "probable"].includes(f.status),
    ) ?? null
  );
}

export function getTeammateBoostsForPlayer(
  flags: InjuryFlag[],
  season: number,
  week: number,
  team: string,
  playerName: string,
): InjuryFlag[] {
  return flags.filter(
    (f) =>
      f.season === season &&
      f.week === week &&
      f.team === team &&
      f.playerName === playerName &&
      isBoostFlag(f),
  );
}

export function hasOlInjuryForTeam(
  flags: InjuryFlag[],
  season: number,
  week: number,
  team: string,
): boolean {
  return flags.some(
    (f) =>
      f.season === season &&
      f.week === week &&
      f.team === team &&
      isOlFlag(f) &&
      ["out", "doubtful", "questionable"].includes(f.status),
  );
}

export function hasDbInjuryForTeam(
  flags: InjuryFlag[],
  season: number,
  week: number,
  team: string,
): boolean {
  return flags.some(
    (f) =>
      f.season === season &&
      f.week === week &&
      f.team === team &&
      isDbFlag(f) &&
      ["out", "doubtful", "questionable"].includes(f.status),
  );
}

export function hasUncertaintyForGame(flags: InjuryFlag[], gameId: string): boolean {
  return flags.some((f) => f.gameId === gameId && isUncertaintyFlag(f));
}

// --- one-shot per-player aggregator -----------------------------------

/**
 * Roll up every flag that could move a single player's projection in a
 * given game. The projection engine should call this once per prop and
 * use the result to widen σ, shift the mean, and surface reasons/risks.
 */
export function getPlayerContext(
  flags: InjuryFlag[],
  args: {
    season: number;
    week: number;
    gameId: string;
    team: string;
    opponentTeam: string;
    playerName: string;
  },
): PlayerInjuryContext {
  const { season, week, gameId, team, opponentTeam, playerName } = args;

  const selfStatus = getPlayerStatus(flags, season, week, team, playerName);
  const teammateBoosts = getTeammateBoostsForPlayer(
    flags,
    season,
    week,
    team,
    playerName,
  );
  const olInjuryOnOwnTeam = hasOlInjuryForTeam(flags, season, week, team);
  const dbInjuryOnOpposingTeam = hasDbInjuryForTeam(
    flags,
    season,
    week,
    opponentTeam,
  );
  const uncertaintyForGame = hasUncertaintyForGame(flags, gameId);

  const rawFlags: InjuryFlag[] = [];
  if (selfStatus) rawFlags.push(selfStatus);
  rawFlags.push(...teammateBoosts);
  if (olInjuryOnOwnTeam) {
    rawFlags.push(
      ...flags.filter(
        (f) =>
          f.season === season &&
          f.week === week &&
          f.team === team &&
          isOlFlag(f),
      ),
    );
  }
  if (dbInjuryOnOpposingTeam) {
    rawFlags.push(
      ...flags.filter(
        (f) =>
          f.season === season &&
          f.week === week &&
          f.team === opponentTeam &&
          isDbFlag(f),
      ),
    );
  }
  if (uncertaintyForGame) {
    rawFlags.push(
      ...flags.filter((f) => f.gameId === gameId && isUncertaintyFlag(f)),
    );
  }

  return {
    selfStatus,
    teammateBoosts,
    olInjuryOnOwnTeam,
    dbInjuryOnOpposingTeam,
    uncertaintyForGame,
    rawFlags,
  };
}

// --- tiny CSV parser (kept in-file so this lib has zero deps) ---------

function parseCsv(content: string): Record<string, string>[] {
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur);
        cur = "";
      } else if (ch === '"' && cur === "") {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}
