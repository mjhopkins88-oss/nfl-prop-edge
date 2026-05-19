import { ModelRunType, PrismaClient } from "@prisma/client";
import {
  backtestMockSummary,
  games as mockGames,
  players as mockPlayers,
  propMarkets as mockProps,
  teams as mockTeams,
} from "../src/lib/mock-data";
import { americanOddsToImpliedProb } from "../src/lib/prop-utils";

const prisma = new PrismaClient();

function decimalPayout(americanOdds: number): number {
  return americanOdds > 0 ? americanOdds / 100 : 100 / -americanOdds;
}

function expectedValue(modelProb: number, americanOdds: number): number {
  return modelProb * decimalPayout(americanOdds) - (1 - modelProb);
}

async function main() {
  const snapshotTime = new Date();

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

  console.log("Seeding model runs...");
  const liveRun = await prisma.modelRun.upsert({
    where: { id: "baseline-v1-live" },
    create: {
      id: "baseline-v1-live",
      name: "Baseline V1 (live)",
      version: "1.0.0",
      runType: ModelRunType.MANUAL,
      notes: "Hand-authored projections for the V1 mock slate.",
    },
    update: {
      name: "Baseline V1 (live)",
      version: "1.0.0",
      runType: ModelRunType.MANUAL,
    },
  });
  const backtestRun = await prisma.modelRun.upsert({
    where: { id: "baseline-v1-backtest" },
    create: {
      id: "baseline-v1-backtest",
      name: "Baseline V1 (backtest)",
      version: "1.0.0",
      runType: ModelRunType.BACKTEST,
      notes: "Backtest aggregates for the V1 model through Week 10, 2025.",
    },
    update: {
      name: "Baseline V1 (backtest)",
      version: "1.0.0",
      runType: ModelRunType.BACKTEST,
    },
  });

  console.log("Seeding prop markets, quotes, and projections...");
  for (const prop of mockProps) {
    const playerId = playerMap.get(prop.playerId);
    const gameId = gameMap.get(prop.gameId);
    if (!playerId || !gameId) continue;

    const marketKey = `${prop.playerId}:${prop.gameId}:${prop.propType}:${prop.line}`;

    const market = await prisma.propMarket.upsert({
      where: { id: prop.id },
      create: {
        id: prop.id,
        playerId,
        gameId,
        propType: prop.propType,
        line: prop.line,
        marketKey,
        source: "mock",
        snapshotTime,
      },
      update: {
        playerId,
        gameId,
        propType: prop.propType,
        line: prop.line,
        marketKey,
        source: "mock",
        snapshotTime,
      },
    });

    const overImplied = americanOddsToImpliedProb(prop.overOdds);
    const underImplied = americanOddsToImpliedProb(prop.underOdds);
    const impliedSum = overImplied + underImplied || 1;
    const quoteId = `${prop.id}-quote-${prop.sportsbook.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

    await prisma.propQuote.upsert({
      where: { id: quoteId },
      create: {
        id: quoteId,
        propMarketId: market.id,
        bookName: prop.sportsbook,
        overPrice: prop.overOdds,
        underPrice: prop.underOdds,
        overImpliedProbability: overImplied,
        underImpliedProbability: underImplied,
        noVigOverProbability: overImplied / impliedSum,
        noVigUnderProbability: underImplied / impliedSum,
        quoteTime: snapshotTime,
      },
      update: {
        bookName: prop.sportsbook,
        overPrice: prop.overOdds,
        underPrice: prop.underOdds,
        overImpliedProbability: overImplied,
        underImpliedProbability: underImplied,
        noVigOverProbability: overImplied / impliedSum,
        noVigUnderProbability: underImplied / impliedSum,
        quoteTime: snapshotTime,
      },
    });

    const modelOver = prop.modelHitRateOver;
    const modelUnder = 1 - modelOver;
    const recommendedPrice =
      prop.recommendation === "UNDER" ? prop.underOdds : prop.overOdds;
    const recommendedProb =
      prop.recommendation === "UNDER" ? modelUnder : modelOver;
    const ev = expectedValue(recommendedProb, recommendedPrice);
    const qualified = prop.recommendation !== "PASS" && prop.edge >= 0.04;

    const reasons: string[] = [
      `Projection ${prop.projection.toFixed(1)} vs line ${prop.line.toFixed(1)} (${
        prop.projection >= prop.line ? "over" : "under"
      } by ${Math.abs(prop.projection - prop.line).toFixed(1)})`,
      `Model side: ${prop.recommendation}`,
      `Edge ${(prop.edge * 100).toFixed(1)}% vs book implied ${(prop.bookImpliedOver * 100).toFixed(1)}%`,
    ];
    const risks: string[] =
      prop.confidence < 0.65
        ? ["Volatile usage profile", "Game script uncertainty"]
        : prop.confidence < 0.75
          ? ["Some opponent-adjusted noise"]
          : [];

    const projectionId = `${prop.id}-proj-${liveRun.id}`;
    await prisma.projection.upsert({
      where: { id: projectionId },
      create: {
        id: projectionId,
        propMarketId: market.id,
        modelRunId: liveRun.id,
        projectedMean: prop.projection,
        projectedStdDev: prop.projectionStdDev,
        modelOverProbability: modelOver,
        modelUnderProbability: modelUnder,
        edge: prop.edge,
        expectedValue: ev,
        recommendation: prop.recommendation,
        confidence: prop.confidence,
        qualified,
        reasons,
        risks,
      },
      update: {
        projectedMean: prop.projection,
        projectedStdDev: prop.projectionStdDev,
        modelOverProbability: modelOver,
        modelUnderProbability: modelUnder,
        edge: prop.edge,
        expectedValue: ev,
        recommendation: prop.recommendation,
        confidence: prop.confidence,
        qualified,
        reasons,
        risks,
      },
    });
  }

  console.log("Seeding backtest results...");
  // Split each market's season totals across weeks 1-10. Per-week splits
  // are approximate — the schema supports finer granularity once real
  // graded props start flowing in.
  const totalWeeks = 10;
  const season = 2025;
  for (const slice of backtestMockSummary.byMarket) {
    const playsPerWeek = Math.max(1, Math.round(slice.plays / totalWeeks));
    const winsPerWeek = Math.round(slice.hitRate * playsPerWeek);
    const lossesPerWeek = Math.max(0, playsPerWeek - winsPerWeek);
    const stakedPerWeek = playsPerWeek;
    const returnPerWeek = stakedPerWeek * (1 + slice.roiPct / 100);

    for (let week = 1; week <= totalWeeks; week++) {
      await prisma.backtestResult.upsert({
        where: {
          modelRunId_propType_season_week: {
            modelRunId: backtestRun.id,
            propType: slice.propType,
            season,
            week,
          },
        },
        create: {
          modelRunId: backtestRun.id,
          propType: slice.propType,
          season,
          week,
          plays: playsPerWeek,
          wins: winsPerWeek,
          losses: lossesPerWeek,
          pushes: 0,
          unitsStaked: stakedPerWeek,
          unitsReturn: returnPerWeek,
          roiPct: slice.roiPct,
          hitRate: slice.hitRate,
        },
        update: {
          plays: playsPerWeek,
          wins: winsPerWeek,
          losses: lossesPerWeek,
          pushes: 0,
          unitsStaked: stakedPerWeek,
          unitsReturn: returnPerWeek,
          roiPct: slice.roiPct,
          hitRate: slice.hitRate,
        },
      });
    }
  }

  const counts = {
    teams: await prisma.team.count(),
    players: await prisma.player.count(),
    games: await prisma.game.count(),
    modelRuns: await prisma.modelRun.count(),
    propMarkets: await prisma.propMarket.count(),
    propQuotes: await prisma.propQuote.count(),
    projections: await prisma.projection.count(),
    backtestResults: await prisma.backtestResult.count(),
  };
  console.log("Seed complete.", counts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
