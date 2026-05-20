// Data layer — games & schedule.
//
// V1: reads from the in-memory mock store in `src/lib/mock-data.ts`.
// FUTURE: swap each function to a Prisma query — see inline `FUTURE`
// comments below.

import { games as mockGames, getGameById as mockGetGameById } from "../mock-data";
import type { Game } from "../types";

export function getGameById(id: string): Game | undefined {
  // FUTURE: prisma.game.findUnique({
  //   where: { id },
  //   include: { homeTeam: true, awayTeam: true },
  // });
  return mockGetGameById(id);
}

export function getCurrentWeekGames(): Game[] {
  // FUTURE: pick the current/next NFL week server-side and query
  // prisma.game.findMany({
  //   where: { season, week },
  //   orderBy: { kickoff: "asc" },
  //   include: { homeTeam: true, awayTeam: true },
  // });
  return mockGames;
}
