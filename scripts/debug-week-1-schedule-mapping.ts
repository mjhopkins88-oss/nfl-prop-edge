/**
 * Standalone debug for the Week 1 stored-backtest schedule
 * validation failure. Reads every file the validator consults
 * and prints exactly which canonical odds rows don't line up
 * with the schedule.
 *
 * Writes a non-secret JSON dump to
 * `data/admin-ingestion/latest-schedule-mapping-debug.json`
 * so it can be retrieved from a Railway shell after a redeploy.
 *
 * No paid API. No network. Pure file IO.
 */

import fs from "node:fs";
import path from "node:path";
import { parseCsvRows } from "../src/lib/ingestion/nflverse";
import { getExpectedWeek1Schedule } from "../src/lib/backtest/week-1-schedule-validation";
import {
  normalizeTeamAbbreviation,
  validateCanonicalOddsGameIds,
} from "../src/lib/backtest/week-1-game-id-mapper";

interface CanonicalRow {
  season: number;
  week: number;
  gameId: string;
  team: string;
  opponent: string;
  playerName: string;
  sportsbook: string;
  marketKey: string;
  propType: string;
  line: number;
  snapshotTime: string;
}

function readCanonical(p: string): CanonicalRow[] {
  if (!fs.existsSync(p)) return [];
  const rows = parseCsvRows(fs.readFileSync(p, "utf8"));
  return rows.map((r) => ({
    season: Number(r.season),
    week: Number(r.week),
    gameId: r.gameId ?? "",
    team: r.team ?? "",
    opponent: r.opponent ?? "",
    playerName: r.playerName ?? "",
    sportsbook: r.sportsbook ?? "",
    marketKey: r.marketKey ?? "",
    propType: r.propType ?? "",
    line: Number(r.line),
    snapshotTime: r.snapshotTime ?? "",
  }));
}

interface ProcessedGame {
  gameId: string;
  season: number;
  week: number;
  homeTeam: string;
  awayTeam: string;
}

function readProcessedGames(p: string): ProcessedGame[] {
  if (!fs.existsSync(p)) return [];
  const rows = parseCsvRows(fs.readFileSync(p, "utf8"));
  return rows
    .map((r) => ({
      gameId: r.gameId ?? "",
      season: Number(r.season),
      week: Number(r.week),
      homeTeam: r.homeTeam ?? "",
      awayTeam: r.awayTeam ?? "",
    }))
    .filter((g) => g.season === 2025 && g.week === 1);
}

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function main(): void {
  const root = process.cwd();
  const canonicalPath = path.join(
    root,
    "data",
    "processed",
    "odds",
    "2025",
    "week-1-prop-markets.csv",
  );
  const fixturePath = path.join(
    root,
    "data",
    "fixtures",
    "nfl",
    "2025-week-1-schedule.fixture.json",
  );
  const processedGamesPath = path.join(
    root,
    "data",
    "processed",
    "nfl",
    "games.csv",
  );

  console.log("=== Week 1 schedule-mapping debug ===");
  console.log(`canonical path:        ${canonicalPath}`);
  console.log(`fixture path:          ${fixturePath}`);
  console.log(`processed games path:  ${processedGamesPath}`);
  console.log("");

  const canonical = readCanonical(canonicalPath);
  const fixture = getExpectedWeek1Schedule();
  const processed = readProcessedGames(processedGamesPath);
  const fixtureIds = new Set(fixture.games.map((g) => g.gameId));
  const processedIds = new Set(processed.map((g) => g.gameId));

  console.log(`canonical rows:              ${canonical.length}`);
  const canonGameIds = uniq(canonical.map((r) => r.gameId)).sort();
  console.log(`distinct canonical gameIds:  ${canonGameIds.length}`);
  for (const g of canonGameIds) {
    const inFix = fixtureIds.has(g);
    const inProc = processedIds.has(g);
    console.log(
      `  · ${g}    fixture=${inFix ? "✓" : "✗"}  processed=${inProc ? "✓" : "✗"}`,
    );
  }
  console.log("");
  console.log("fixture gameIds (expected):");
  for (const g of fixture.games) {
    console.log(`  · ${g.gameId}    ${g.awayTeam}@${g.homeTeam}`);
  }
  console.log("");
  console.log("processed games.csv gameIds (Week 1):");
  for (const g of processed) {
    console.log(
      `  · ${g.gameId}    ${g.awayTeam}@${g.homeTeam}    (normalized: ${normalizeTeamAbbreviation(g.awayTeam)}@${normalizeTeamAbbreviation(g.homeTeam)})`,
    );
  }
  console.log("");

  const inOddsNotFixture = canonGameIds.filter((g) => !fixtureIds.has(g));
  const inFixtureNotOdds = [...fixtureIds].filter(
    (g) => !canonGameIds.includes(g),
  );
  console.log(`gameIds in odds but NOT in fixture: ${inOddsNotFixture.length}`);
  for (const g of inOddsNotFixture) console.log(`  · ${g}`);
  console.log(`gameIds in fixture but NOT in odds: ${inFixtureNotOdds.length}`);
  for (const g of inFixtureNotOdds) console.log(`  · ${g}`);
  console.log("");

  // Use the validator to surface every problematic row.
  const validation = validateCanonicalOddsGameIds({
    rows: canonical,
    schedule: fixture.games,
  });
  console.log(`validateCanonicalOddsGameIds report:`);
  console.log(`  totalRows:        ${validation.totalRows}`);
  console.log(`  validRows:        ${validation.validRows}`);
  console.log(`  invalidGameIds:   ${validation.invalidGameIds.length}`);
  console.log(`  rebuildableRows:  ${validation.rebuildableRows}`);
  for (const [id, reason] of Object.entries(validation.reasonsByGameId)) {
    console.log(`    · ${id}: ${reason}`);
  }
  console.log("");

  // Team-pair audit. For each (gameId), verify team + opponent
  // are the two teams in the fixture's row for that gameId.
  const fixtureByGameId = new Map(
    fixture.games.map((g) => [g.gameId, g] as const),
  );
  interface PairIssue {
    gameId: string;
    expectedTeams: string[];
    rowTeams: { team: string; opponent: string; count: number }[];
  }
  const teamPairIssues: PairIssue[] = [];
  for (const gameId of canonGameIds) {
    const fx = fixtureByGameId.get(gameId);
    if (!fx) continue; // already counted as invalid above
    const expected = [
      normalizeTeamAbbreviation(fx.awayTeam),
      normalizeTeamAbbreviation(fx.homeTeam),
    ];
    const rowsForGame = canonical.filter((r) => r.gameId === gameId);
    const distinctPairs = new Map<string, number>();
    for (const r of rowsForGame) {
      const key = `${r.team}/${r.opponent}`;
      distinctPairs.set(key, (distinctPairs.get(key) ?? 0) + 1);
    }
    const issues: { team: string; opponent: string; count: number }[] = [];
    for (const [key, count] of distinctPairs) {
      const [team, opponent] = key.split("/");
      const teamN = normalizeTeamAbbreviation(team);
      const oppN = normalizeTeamAbbreviation(opponent);
      const teamOk = teamN === expected[0] || teamN === expected[1];
      const oppOk = oppN === expected[0] || oppN === expected[1];
      if (!teamOk || !oppOk || teamN === oppN) {
        issues.push({ team, opponent, count });
      }
    }
    if (issues.length > 0) {
      teamPairIssues.push({
        gameId,
        expectedTeams: expected,
        rowTeams: issues,
      });
    }
  }
  console.log(`team-pair issues (within a known fixture game): ${teamPairIssues.length}`);
  for (const issue of teamPairIssues) {
    console.log(
      `  · ${issue.gameId} expects ${issue.expectedTeams.join("/")}; bad rows:`,
    );
    for (const r of issue.rowTeams)
      console.log(`      ${r.team}/${r.opponent} × ${r.count}`);
  }
  console.log("");

  // First 50 problematic rows (either gameId not in fixture OR
  // team pair doesn't match).
  const invalidIdsSet = new Set(validation.invalidGameIds);
  const teamPairBadIds = new Set(teamPairIssues.map((i) => i.gameId));
  const problematic = canonical
    .filter(
      (r) => invalidIdsSet.has(r.gameId) || teamPairBadIds.has(r.gameId),
    )
    .slice(0, 50);
  console.log(`first ${problematic.length} problematic rows:`);
  for (const r of problematic) {
    console.log(
      `  · gameId=${r.gameId} team=${r.team} opp=${r.opponent} player=${r.playerName} market=${r.marketKey} book=${r.sportsbook}`,
    );
  }
  console.log("");

  const debugFile = path.join(
    root,
    "data",
    "admin-ingestion",
    "latest-schedule-mapping-debug.json",
  );
  fs.mkdirSync(path.dirname(debugFile), { recursive: true });
  const payload = {
    ranAt: new Date().toISOString(),
    sources: {
      canonical: canonicalPath,
      fixture: fixturePath,
      processedGames: processedGamesPath,
    },
    counts: {
      canonicalRows: canonical.length,
      distinctCanonicalGameIds: canonGameIds.length,
      fixtureGameIds: fixture.games.length,
      processedGames: processed.length,
      invalidGameIds: validation.invalidGameIds.length,
      teamPairIssues: teamPairIssues.length,
    },
    distinctCanonicalGameIds: canonGameIds.map((g) => ({
      gameId: g,
      inFixture: fixtureIds.has(g),
      inProcessed: processedIds.has(g),
    })),
    inOddsNotFixture,
    inFixtureNotOdds,
    invalidGameIds: validation.invalidGameIds,
    reasonsByGameId: validation.reasonsByGameId,
    teamPairIssues,
    problematicRows: problematic,
    paidApiCallAttempted: false,
    guardrails: {
      noOddsApiCall: true,
      noTouchdownProps: true,
      noAutomatedBetting: true,
      noKalshiIntegration: true,
    },
  };
  fs.writeFileSync(debugFile, JSON.stringify(payload, null, 2) + "\n");
  console.log(`wrote debug payload: ${debugFile}`);

  const ok = validation.invalidGameIds.length === 0 && teamPairIssues.length === 0;
  console.log("");
  console.log(`overall: ${ok ? "PASS" : "FAIL"}`);
  if (!ok) {
    console.log("");
    console.log("Recommended next steps:");
    if (validation.invalidGameIds.length > 0) {
      console.log(
        "  · stale gameIds in canonical file — run migrate-odds-to-canonical again so the writer rewrites them through normalizeTeamAbbreviation",
      );
    }
    if (teamPairIssues.length > 0) {
      console.log(
        "  · team/opponent mismatch within a known game — rosters lookup is returning a non-canonical abbreviation; clear stale DB rows for (season=2025, week=1) and remigrate",
      );
    }
  }
  process.exit(ok ? 0 : 1);
}

main();
