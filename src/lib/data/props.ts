// Data layer — prop opportunities, detail views, and dashboard summary.
//
// V1: reads from the in-memory mock store in `src/lib/mock-data.ts`.
// FUTURE: swap each function body to Prisma queries — see inline
// `FUTURE` comments. The exposed function signatures are the contract;
// callers in `src/app/**` and `src/components/**` will not need to
// change when the swap happens.

import {
  getGameById as mockGetGameById,
  getPlayerById as mockGetPlayerById,
  getPropDetail as mockGetPropDetail,
  getProps as mockGetProps,
  getTeam as mockGetTeam,
} from "../mock-data";
import type { PropDetail } from "../types";
import type {
  DashboardSummary,
  DashboardTopEdge,
  GetPropOpportunitiesArgs,
  PropOpportunity,
} from "./types";

/**
 * Build a fully joined `PropOpportunity` from a mock prop market.
 * FUTURE: replace with a single Prisma query that includes player,
 * player.team, game, game.homeTeam, and game.awayTeam.
 */
function buildOpportunity(propId: string): PropOpportunity | null {
  const prop = mockGetProps().find((p) => p.id === propId);
  if (!prop) return null;
  const player = mockGetPlayerById(prop.playerId);
  if (!player) return null;
  const team = mockGetTeam(player.teamAbbr);
  if (!team) return null;
  const game = mockGetGameById(prop.gameId);
  if (!game) return null;
  const opponentAbbr =
    game.homeTeamAbbr === player.teamAbbr ? game.awayTeamAbbr : game.homeTeamAbbr;
  const opponent = mockGetTeam(opponentAbbr);
  if (!opponent) return null;
  return {
    id: prop.id,
    propType: prop.propType,
    line: prop.line,
    overOdds: prop.overOdds,
    underOdds: prop.underOdds,
    sportsbook: prop.sportsbook,
    projection: prop.projection,
    projectionStdDev: prop.projectionStdDev,
    modelHitRateOver: prop.modelHitRateOver,
    bookImpliedOver: prop.bookImpliedOver,
    edge: prop.edge,
    confidence: prop.confidence,
    recommendation: prop.recommendation,
    player,
    team,
    opponent,
    game,
    isHome: game.homeTeamAbbr === player.teamAbbr,
  };
}

/**
 * Return prop opportunities, optionally filtered and sorted.
 * The returned rows are already joined with player/team/game data so
 * the table doesn't need to do any further lookups.
 *
 * FUTURE: translate `args.filter` to a Prisma `where` clause and
 * `args.sort` to an `orderBy`, then run a single query like:
 *   prisma.propMarket.findMany({
 *     where, orderBy,
 *     include: {
 *       player: { include: { team: true } },
 *       game: { include: { homeTeam: true, awayTeam: true } },
 *     },
 *   });
 */
export function getPropOpportunities(
  args: GetPropOpportunitiesArgs = {},
): PropOpportunity[] {
  const { filter, sort = "edge" } = args;

  let rows = mockGetProps()
    .map((p) => buildOpportunity(p.id))
    .filter((o): o is PropOpportunity => o !== null);

  if (filter?.propType) rows = rows.filter((r) => r.propType === filter.propType);
  if (filter?.position) rows = rows.filter((r) => r.player.position === filter.position);
  if (filter?.recommendation) {
    rows = rows.filter((r) => r.recommendation === filter.recommendation);
  }

  if (sort === "confidence") {
    rows = [...rows].sort((a, b) => b.confidence - a.confidence);
  } else if (sort === "player") {
    rows = [...rows].sort((a, b) =>
      a.player.fullName.localeCompare(b.player.fullName),
    );
  } else {
    rows = [...rows].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
  }

  return rows;
}

/**
 * Return a fully joined prop detail view (player + matchup + recent
 * logs + alternate lines + matchup notes).
 *
 * FUTURE: replace with a single Prisma query that includes player,
 * player.team, game.homeTeam, game.awayTeam, and the player's recent
 * gameLogs. Alt lines will become a join over a `LineQuote` table; for
 * now they're synthesized in mock-data.
 */
export function getPropDetail(id: string): PropDetail | undefined {
  return mockGetPropDetail(id);
}

/**
 * Return every known prop id. Used by Next's `generateStaticParams`
 * to prerender each detail page at build time.
 *
 * FUTURE: prisma.propMarket.findMany({ select: { id: true } });
 */
export function getAllPropIds(): string[] {
  return mockGetProps().map((p) => p.id);
}

/**
 * Aggregate stats for the dashboard summary cards. Computed across
 * all tracked props — not affected by the user's current filters.
 *
 * FUTURE: derive via Prisma aggregates / SQL — e.g. a single query
 * with COUNT, AVG(ABS(edge)), and a window function (or two queries)
 * to grab the top-edge row.
 */
export function getDashboardSummary(): DashboardSummary {
  const opps = getPropOpportunities();
  const playable = opps.filter((p) => p.recommendation !== "PASS");
  const positiveEdges = playable.filter((p) => p.edge >= 0.04);
  const averageEdge =
    playable.length > 0
      ? playable.reduce((acc, p) => acc + Math.abs(p.edge), 0) / playable.length
      : 0;

  const top = [...playable].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];
  const topEdge: DashboardTopEdge | null = top
    ? {
        value: Math.abs(top.edge),
        playerName: top.player.fullName,
        positive: top.edge > 0,
      }
    : null;

  return {
    trackedMarkets: opps.length,
    actionableMarkets: playable.length,
    positiveEdges: positiveEdges.length,
    averageEdge,
    topEdge,
  };
}
