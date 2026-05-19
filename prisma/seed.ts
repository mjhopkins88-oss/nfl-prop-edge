import { PrismaClient } from "@prisma/client";
import {
  games as mockGames,
  players as mockPlayers,
  propMarkets as mockProps,
  teams as mockTeams,
} from "../src/lib/mock-data";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding teams...");
  const teamMap = new Map<string, string>();
  for (const team of Object.values(mockTeams)) {
    const upserted = await prisma.team.upsert({
      where: { abbreviation: team.abbreviation },
      create: {
        abbreviation: team.abbreviation,
        name: team.name,
        city: team.city,
        conference: team.conference,
        division: team.division,
      },
      update: {
        name: team.name,
        city: team.city,
        conference: team.conference,
        division: team.division,
      },
    });
    teamMap.set(team.abbreviation, upserted.id);
  }

  console.log("Seeding players...");
  const playerMap = new Map<string, string>();
  for (const player of mockPlayers) {
    const teamId = teamMap.get(player.teamAbbr);
    if (!teamId) continue;
    const upserted = await prisma.player.upsert({
      where: { id: player.id },
      create: {
        id: player.id,
        fullName: player.fullName,
        position: player.position,
        jersey: player.jersey,
        teamId,
      },
      update: {
        fullName: player.fullName,
        position: player.position,
        jersey: player.jersey,
        teamId,
      },
    });
    playerMap.set(player.id, upserted.id);
  }

  console.log("Seeding games...");
  const gameMap = new Map<string, string>();
  for (const game of mockGames) {
    const homeId = teamMap.get(game.homeTeamAbbr);
    const awayId = teamMap.get(game.awayTeamAbbr);
    if (!homeId || !awayId) continue;
    const upserted = await prisma.game.upsert({
      where: { id: game.id },
      create: {
        id: game.id,
        season: game.season,
        week: game.week,
        kickoff: new Date(game.kickoff),
        homeTeamId: homeId,
        awayTeamId: awayId,
      },
      update: {
        season: game.season,
        week: game.week,
        kickoff: new Date(game.kickoff),
        homeTeamId: homeId,
        awayTeamId: awayId,
      },
    });
    gameMap.set(game.id, upserted.id);
  }

  console.log("Seeding prop markets...");
  for (const prop of mockProps) {
    const playerId = playerMap.get(prop.playerId);
    const gameId = gameMap.get(prop.gameId);
    if (!playerId || !gameId) continue;
    await prisma.propMarket.upsert({
      where: { id: prop.id },
      create: {
        id: prop.id,
        playerId,
        gameId,
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
      },
      update: {
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
      },
    });
  }

  const counts = {
    teams: await prisma.team.count(),
    players: await prisma.player.count(),
    games: await prisma.game.count(),
    props: await prisma.propMarket.count(),
  };
  console.log("Done.", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
