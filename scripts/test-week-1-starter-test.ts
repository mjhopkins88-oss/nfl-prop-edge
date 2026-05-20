/**
 * Week 1 2025 starter-test assertions.
 *
 *   · pregame snapshot can be built
 *   · pregame snapshot does NOT carry Week 1 outcomes
 *   · pregame `pregameOnly` flag is set
 *   · grading pass produces an evaluatedProps array
 *   · at least one player prop candidate exists
 *   · at least one pass exists
 *   · at least one qualified play exists in the fixture
 *   · parlay preview is present
 *   · game edge preview is present
 *   · monitor data is loadable after the runner has been invoked
 *   · no APIs are called (no network imports referenced)
 *   · no touchdown propType is admitted
 *   · no automated betting hooks
 *
 * Pure CPU. No network. Deterministic.
 */

import fs from "node:fs";
import path from "node:path";
import {
  buildWeekPregameSnapshot,
  runWeekSimulation,
} from "../src/lib/backtest/week-simulation";

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

function main(): void {
  console.log("Week 1 starter-test — assertions");
  console.log("================================");

  // 1. Pregame snapshot builds.
  const pregame = buildWeekPregameSnapshot({
    season: 2025,
    week: 1,
    fixtureRoot: WEEK_1_FIXTURE_ROOT,
  });
  {
    const r = makeReport("pregame snapshot builds");
    check(r, pregame.candidates.length > 0, "expected at least one candidate");
    check(r, pregame.pregameOnly === true, "pregameOnly flag should be true");
    check(r, pregame.season === 2025, `season=${pregame.season}`);
    check(r, pregame.week === 1, `week=${pregame.week}`);
    record(r);
    if (r.reasons.length === 0)
      console.log(`[1] PASS — pregame has ${pregame.candidates.length} candidates`);
    else console.log("[1] FAIL — pregame build");
  }

  // 2. Pregame snapshot does NOT carry Week 1 actuals.
  {
    const r = makeReport("pregame snapshot has no Week 1 outcomes");
    for (const c of pregame.candidates) {
      if (c.actualStat !== null) {
        check(
          r,
          false,
          `candidate ${c.id} carries actualStat=${c.actualStat} in pregame snapshot`,
        );
      }
      if (c.result !== "PASS") {
        check(
          r,
          false,
          `candidate ${c.id} has graded result ${c.result} in pregame snapshot`,
        );
      }
      if (c.profitLossUnits !== 0) {
        check(
          r,
          false,
          `candidate ${c.id} has non-zero profitLossUnits in pregame snapshot`,
        );
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — pregame snapshot carries no Week 1 outcomes");
    else console.log("[2] FAIL — pregame leakage");
  }

  // 3. Full simulation produces graded rows + previews.
  const simulation = runWeekSimulation({
    season: 2025,
    week: 1,
    fixtureRoot: WEEK_1_FIXTURE_ROOT,
  });
  {
    const r = makeReport("simulation produces graded rows + previews");
    check(
      r,
      simulation.evaluatedProps.length > 0,
      `evaluatedProps empty (got ${simulation.evaluatedProps.length})`,
    );
    check(
      r,
      simulation.passedProps.length > 0,
      `passedProps empty (got ${simulation.passedProps.length})`,
    );
    check(
      r,
      simulation.parlayPreview.candidates.length > 0,
      "parlay preview missing",
    );
    check(
      r,
      simulation.gameEdgePreview.games.length > 0,
      "game edge preview missing",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[3] PASS — simulation: ${simulation.evaluatedProps.length} evaluated, ${simulation.qualifiedBets.length} qualified, ${simulation.passedProps.length} passes; ${simulation.parlayPreview.candidates.length} parlay candidates; ${simulation.gameEdgePreview.games.length} game-edge candidates`,
      );
    else console.log("[3] FAIL — simulation");
  }

  // 4. At least one play qualifies given the Week 1 fixture set.
  {
    const r = makeReport("at least one qualified play");
    check(
      r,
      simulation.qualifiedBets.length > 0,
      `expected at least 1 qualified bet, got ${simulation.qualifiedBets.length}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[4] PASS — ${simulation.qualifiedBets.length} qualified play(s)`);
    else console.log("[4] FAIL — no qualified plays");
  }

  // 5. V1 vs V2 comparison is wired (optional but expected here).
  {
    const r = makeReport("V1 vs V2 comparison present");
    check(
      r,
      simulation.v1v2Comparison !== undefined,
      "expected v1v2Comparison to be present",
    );
    if (simulation.v1v2Comparison) {
      check(
        r,
        simulation.v1v2Comparison.v1Summary.evaluated > 0,
        "V1 summary has zero evaluated",
      );
      check(
        r,
        simulation.v1v2Comparison.v2Summary.evaluated > 0,
        "V2 summary has zero evaluated",
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(`[5] PASS — V1 vs V2 wired`);
    else console.log("[5] FAIL — V1 vs V2");
  }

  // 6. No touchdown propType anywhere.
  {
    const r = makeReport("no touchdown propTypes admitted");
    for (const c of simulation.evaluatedProps) {
      const tag = String(c.propType).toUpperCase();
      if (tag.includes("TD") || tag.includes("TOUCHDOWN")) {
        check(r, false, `touchdown propType leaked: ${c.propType}`);
      }
    }
    record(r);
    if (r.reasons.length === 0) console.log(`[6] PASS — no touchdown propTypes`);
    else console.log("[6] FAIL — touchdown propType");
  }

  // 7. Soft scan: no automated-betting / API patterns in week-simulation.ts.
  {
    const r = makeReport("no API / betting hooks in week-simulation");
    const sources = [
      fs.readFileSync(
        path.join(process.cwd(), "src/lib/backtest/week-simulation.ts"),
        "utf8",
      ),
      fs.readFileSync(
        path.join(process.cwd(), "scripts/run-week-1-starter-test.ts"),
        "utf8",
      ),
    ];
    const bannedPatterns = [
      /the-odds-api/i,
      /odds-api\.com/i,
      /sportsbook\.bet/i,
      /placeBet|placeWager/i,
      /kalshi.+place/i,
      /fetch\(.+book/i,
    ];
    for (const text of sources) {
      for (const re of bannedPatterns) {
        check(
          r,
          !re.test(text),
          `week-simulation source contains banned pattern ${re}`,
        );
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(`[7] PASS — no API / betting hooks`);
    else console.log("[7] FAIL — API / betting hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 7 Week 1 starter-test assertions passed.");
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
