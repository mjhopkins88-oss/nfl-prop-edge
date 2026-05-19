// Data layer — players, teams, and player history.
//
// V1: reads from the in-memory mock store in `src/lib/mock-data.ts`.
// FUTURE: each function body becomes a Prisma query — see the inline
// `FUTURE` comments below. Callers will not need to change.

import {
  getPlayerById as mockGetPlayerById,
  getRecentLogsFromMock,
  getTeam as mockGetTeam,
  players as mockPlayers,
} from "../mock-data";
import type { GameLog, Player, Team } from "../types";

export function getPlayerById(id: string): Player | undefined {
  // FUTURE: prisma.player.findUnique({
  //   where: { id },
  //   include: { team: true },
  // });
  return mockGetPlayerById(id);
}

export function getAllPlayers(): Player[] {
  // FUTURE: prisma.player.findMany({ orderBy: { fullName: "asc" } });
  return mockPlayers;
}

export function getTeamByAbbr(abbr: string): Team | undefined {
  // FUTURE: prisma.team.findUnique({ where: { abbreviation: abbr } });
  return mockGetTeam(abbr);
}

export function getPlayerRecentLogs(playerId: string, limit = 5): GameLog[] {
  // FUTURE: prisma.gameLog.findMany({
  //   where: { playerId },
  //   orderBy: [{ season: "desc" }, { week: "desc" }],
  //   take: limit,
  // });
  return getRecentLogsFromMock(playerId).slice(0, limit);
}
