/**
 * Week 1 data integrity assertions.
 *
 *   · pregame candidates all have week === 1 and season === 2025
 *   · no Week-11 candidates appear in the Week 1 starter test
 *   · no Week-11 demo player names (Jared Goff, Patrick Mahomes
 *     when paired with the Week-11 BUF matchup) appear in the
 *     Week 1 fixture unless explicitly in the Week 1 fixture set
 *   · Week 1 fixture games + markets + player-stats all stamped
 *     season 2025 week 1 (or strict-before week 1 for history)
 *   · header / context says Week 1 for Week 1 routes
 *   · pregame snapshot strips actuals — no Week-1 stats leak
 *     into the pregame view
 *   · no touchdown propTypes anywhere
 *
 * Pure file IO + module import. No network.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildWeekPregameSnapshot,
  runWeekSimulation,
} from "../src/lib/backtest/week-simulation";
import {
  getDefaultAppContext,
  getWeek1StarterTestContext,
} from "../src/lib/app-context";

const WEEK_1_FIXTURE_ROOT = path.join(
  process.cwd(),
  "data",
  "fixtures",
  "backtest",
  "week-1",
);

interface Failure {
  scenario: string;
  reasons: string[];
}

const FAILURES: Failure[] = [];

function check(report: Failure, predicate: boolean, reason: string): void {
  if (!predicate) report.reasons.push(reason);
}

function record(report: Failure): void {
  if (report.reasons.length > 0) FAILURES.push(report);
}

function makeReport(scenario: string): Failure {
  return { scenario, reasons: [] };
}

function readJson<T>(rel: string): T {
  return JSON.parse(
    fs.readFileSync(path.join(process.cwd(), rel), "utf8"),
  ) as T;
}

interface Week1Game {
  id: string;
  season: number;
  week: number;
  homeTeamAbbr: string;
  awayTeamAbbr: string;
}

interface Week1PropMarket {
  id: string;
  gameId: string;
  playerId: string;
  propType: string;
  line: number;
  overOdds: number;
  underOdds: number;
}

interface Week1PlayerWeekStat {
  playerId: string;
  playerName: string;
  position: string;
  season: number;
  week: number;
}

function main(): void {
  console.log("Week 1 data integrity — assertions");
  console.log("===================================");

  // 1. Week 1 game fixtures all stamped season 2025 week 1.
  {
    const r = makeReport("Week 1 game fixtures");
    const games = readJson<Week1Game[]>(
      "data/fixtures/backtest/week-1/games.fixture.json",
    );
    check(r, games.length > 0, `no fixture games found`);
    for (const g of games) {
      check(
        r,
        g.season === 2025,
        `game ${g.id} season ${g.season} not 2025`,
      );
      check(
        r,
        g.week === 1,
        `game ${g.id} week ${g.week} not 1`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(`[1] PASS — ${games.length} Week 1 games stamped 2025/W1`);
    else console.log(`[1] FAIL — Week 1 game fixtures`);
  }

  // 2. Prop-market fixtures point at Week 1 games and use only the
  //    four starter markets.
  {
    const r = makeReport("Week 1 prop-market fixtures");
    const STARTER = new Set([
      "PASSING_ATTEMPTS",
      "PASSING_COMPLETIONS",
      "RECEPTIONS",
      "RUSHING_ATTEMPTS",
    ]);
    const markets = readJson<Week1PropMarket[]>(
      "data/fixtures/backtest/week-1/prop-markets.fixture.json",
    );
    const games = readJson<Week1Game[]>(
      "data/fixtures/backtest/week-1/games.fixture.json",
    );
    const gameIds = new Set(games.map((g) => g.id));
    check(r, markets.length > 0, "no prop markets in fixture");
    for (const m of markets) {
      check(
        r,
        gameIds.has(m.gameId),
        `market ${m.id} references unknown game ${m.gameId}`,
      );
      check(
        r,
        STARTER.has(m.propType),
        `market ${m.id} propType ${m.propType} is not a starter market`,
      );
      const tag = m.propType.toUpperCase();
      check(
        r,
        !tag.includes("TD") && !tag.includes("TOUCHDOWN"),
        `market ${m.id} carries a touchdown propType`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(`[2] PASS — ${markets.length} starter-market entries`);
    else console.log(`[2] FAIL — prop-market fixtures`);
  }

  // 3. Week 1 player-stat rows are stamped Week 1 or strict-before
  //    (i.e., 2024 baseline rows are OK).
  {
    const r = makeReport("Week 1 player-stats are Week 1 or strict-before");
    const rows = readJson<Week1PlayerWeekStat[]>(
      "data/fixtures/backtest/week-1/player-week-stats.fixture.json",
    );
    for (const row of rows) {
      const strictBefore =
        row.season < 2025 || (row.season === 2025 && row.week < 1);
      const sameSlot = row.season === 2025 && row.week === 1;
      check(
        r,
        strictBefore || sameSlot,
        `row for ${row.playerName} at ${row.season}/W${row.week} is neither Week 1 nor strict-before`,
      );
    }
    const week1Outcomes = rows.filter(
      (r0) => r0.season === 2025 && r0.week === 1,
    );
    check(
      r,
      week1Outcomes.length > 0,
      "no Week 1 actual stats present for grading",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[3] PASS — ${rows.length} player-stat rows respect the boundary`);
    else console.log(`[3] FAIL — player-stat rows`);
  }

  // 4. Pregame snapshot only contains Week-1 candidates and
  //    explicitly strips outcomes.
  {
    const r = makeReport("pregame snapshot is Week-1-only with outcomes stripped");
    const snapshot = buildWeekPregameSnapshot({
      season: 2025,
      week: 1,
      fixtureRoot: WEEK_1_FIXTURE_ROOT,
    });
    check(
      r,
      snapshot.candidates.length > 0,
      "pregame snapshot has zero candidates",
    );
    check(
      r,
      snapshot.pregameOnly === true,
      "pregameOnly flag should be true",
    );
    check(
      r,
      snapshot.season === 2025 && snapshot.week === 1,
      `snapshot season/week ${snapshot.season}/${snapshot.week}`,
    );
    for (const c of snapshot.candidates) {
      check(
        r,
        c.season === 2025,
        `candidate ${c.id} season ${c.season} not 2025`,
      );
      check(
        r,
        c.week === 1,
        `candidate ${c.id} week ${c.week} not 1`,
      );
      check(
        r,
        c.actualStat === null,
        `candidate ${c.id} has actualStat=${c.actualStat} in pregame snapshot`,
      );
      check(
        r,
        c.result === "PASS",
        `candidate ${c.id} has graded result ${c.result} in pregame snapshot`,
      );
      check(
        r,
        c.profitLossUnits === 0,
        `candidate ${c.id} has non-zero profitLossUnits ${c.profitLossUnits} in pregame snapshot`,
      );
      const tag = String(c.propType).toUpperCase();
      check(
        r,
        !tag.includes("TD") && !tag.includes("TOUCHDOWN"),
        `candidate ${c.id} carries a touchdown propType`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[4] PASS — ${snapshot.candidates.length} pregame candidates, all 2025/W1 with outcomes stripped`,
      );
    else console.log(`[4] FAIL — pregame snapshot`);
  }

  // 5. No Week-11 demo names leak into the Week 1 starter test.
  //    "Demo names" = the Week-11 mock-data players that aren't in
  //    the Week 1 fixture set. The Week 1 fixture re-uses Mahomes,
  //    Allen, Kelce, etc. — they're fine. But Goff, Lamb, Hurts,
  //    Purdy, CMC, Jefferson, Russell Jones, etc. should not
  //    appear in the Week 1 pregame.
  {
    const r = makeReport("no off-fixture demo names in Week 1 pregame");
    const DEMO_ONLY_NAMES = [
      "Jared Goff",
      "CeeDee Lamb",
      "Jalen Hurts",
      "Brock Purdy",
      "Christian McCaffrey",
      "Justin Jefferson",
      "Russell Jones",
      "Tua Tagovailoa",
      "A.J. Brown",
      "Saquon Barkley",
      "Tyreek Hill",
      "Khalil Shakir",
    ];
    const snapshot = buildWeekPregameSnapshot({
      season: 2025,
      week: 1,
      fixtureRoot: WEEK_1_FIXTURE_ROOT,
    });
    for (const c of snapshot.candidates) {
      for (const name of DEMO_ONLY_NAMES) {
        if (c.playerName === name) {
          check(
            r,
            false,
            `Week 1 candidate ${c.id} carries off-fixture name ${name}`,
          );
        }
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(`[5] PASS — no off-fixture demo names in Week 1 pregame`);
    else console.log(`[5] FAIL — demo name leak`);
  }

  // 6. App context says Week 1 for default + starter-test surfaces.
  {
    const r = makeReport("app context labels Week 1 for Week 1 surfaces");
    const def = getDefaultAppContext();
    check(r, def.week === 1, `getDefaultAppContext().week = ${def.week}`);
    check(
      r,
      def.dataMode === "WEEK_1_STARTER_TEST",
      `default dataMode = ${def.dataMode}`,
    );
    const starter = getWeek1StarterTestContext();
    check(r, starter.week === 1, `starter context week = ${starter.week}`);
    check(
      r,
      starter.dataMode === "WEEK_1_STARTER_TEST",
      `starter context dataMode = ${starter.dataMode}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[6] PASS — context advertises Week 1`);
    else console.log(`[6] FAIL — context`);
  }

  // 7. Graded simulation still respects boundaries (full run path
  //    sanity).
  {
    const r = makeReport("simulation does not blur Week 1 with another week");
    const simulation = runWeekSimulation({
      season: 2025,
      week: 1,
      fixtureRoot: WEEK_1_FIXTURE_ROOT,
    });
    for (const c of simulation.evaluatedProps) {
      check(
        r,
        c.season === 2025 && c.week === 1,
        `simulation row ${c.id} at ${c.season}/W${c.week} not 2025/W1`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[7] PASS — ${simulation.evaluatedProps.length} graded rows all 2025/W1`,
      );
    else console.log(`[7] FAIL — simulation week boundary`);
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 7 Week 1 data-integrity assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const r of f.reasons) console.log(`     - ${r}`);
    }
    process.exit(1);
  }
}

main();
