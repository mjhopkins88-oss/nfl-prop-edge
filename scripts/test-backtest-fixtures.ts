/**
 * test-backtest-fixtures.ts
 *
 * Deterministic fixture-driven backtest smoke test. No external APIs.
 * Loads the fixture bundle, runs the backtest with all 7 V1 prop types,
 * asserts the expected scenarios are present, prints PASS/FAIL.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { loadBacktestFixtures } from "../src/lib/backtest/data-loader";
import {
  runBacktest,
  V1_PROP_TYPES,
} from "../src/lib/backtest/runner";
import {
  writeResultsCsv,
  writeResultsJson,
  writeSummaryJson,
} from "../src/lib/backtest/reporting";
import type { PropType } from "../src/lib/types";

const useColor = process.stdout.isTTY === true;
const C_GREEN = useColor ? "\x1b[32m" : "";
const C_RED = useColor ? "\x1b[31m" : "";
const C_RESET = useColor ? "\x1b[0m" : "";

let passCount = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ${C_GREEN}[PASS]${C_RESET} ${name}`);
    passCount++;
  } else {
    console.log(
      `  ${C_RED}[FAIL]${C_RESET} ${name}${detail ? ` — ${detail}` : ""}`,
    );
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const fixtures = loadBacktestFixtures();
console.log("Loaded backtest fixtures:");
console.log(`  games:           ${fixtures.games.length}`);
console.log(`  player-weeks:    ${fixtures.playerWeekStats.length}`);
console.log(`  prop markets:    ${fixtures.propMarkets.length}`);
console.log(`  prop quotes:     ${fixtures.propQuotes.length}`);
console.log(`  weather:         ${fixtures.weather.length}`);
console.log(`  injury flags:    ${fixtures.injuryFlags.length}`);

const { summary, results } = runBacktest({
  scope: {
    season: 2025,
    startWeek: 1,
    endWeek: 18,
    propTypes: [...V1_PROP_TYPES],
    includeYardage: true,
    useFixtures: true,
  },
  fixtures,
});

console.log("\nBacktest output summary:");
console.log(
  `  evaluated=${summary.evaluated} qualifiedBets=${summary.qualifiedBets} ` +
    `wins=${summary.wins} losses=${summary.losses} pushes=${summary.pushes} ` +
    `hitRate=${(summary.hitRate * 100).toFixed(1)}% roi=${summary.roiPct.toFixed(1)}%`,
);

// --- assertions -------------------------------------------------------
console.log("\nAssertions:");

check(
  "at least 20 props evaluated",
  summary.evaluated >= 20,
  `evaluated=${summary.evaluated}`,
);

const propTypesPresent = new Set<PropType>(
  fixtures.propMarkets.map((m) => m.propType),
);
for (const pt of V1_PROP_TYPES) {
  check(
    `fixture markets include ${pt}`,
    propTypesPresent.has(pt),
  );
}

check(
  "at least one bet qualifies",
  summary.qualifiedBets >= 1,
  `qualifiedBets=${summary.qualifiedBets}`,
);

const edgePassResults = results.filter(
  (r) => r.primaryDisqualifier?.toLowerCase().startsWith("edge of"),
);
check(
  "at least one prop PASSes due to edge below threshold",
  edgePassResults.length >= 1,
  `count=${edgePassResults.length}`,
);

const gatePassResults = results.filter(
  (r) =>
    r.primaryDisqualifier !== undefined &&
    !r.primaryDisqualifier.toLowerCase().startsWith("edge of"),
);
check(
  "at least one prop PASSes due to a risk gate",
  gatePassResults.length >= 1,
  `count=${gatePassResults.length}`,
);

const coachingContextResults = results.filter(
  (r) => r.candidate.scorecard.coachingTransition !== undefined,
);
check(
  "at least one prop carries coaching transition context",
  coachingContextResults.length >= 1,
  `count=${coachingContextResults.length}`,
);

check(
  "byPropType slice contains at least one entry",
  summary.byPropType.length >= 1,
);
check(
  "byEdgeBucket slice contains at least one entry",
  summary.byEdgeBucket.length >= 1,
);
check(
  "byConfidence slice contains all 3 tiers",
  summary.byConfidence.length === 3,
);
check(
  "hitRate is a number",
  Number.isFinite(summary.hitRate),
);
check(
  "roi is a number",
  Number.isFinite(summary.roiPct),
);
check(
  "averageEdge is a number",
  Number.isFinite(summary.averageEdge),
);
check(
  "brierScore is a number",
  Number.isFinite(summary.brierScore),
);

// IO test
const outDir = "data/backtests/2025";
const summaryPath = path.join(outDir, "backtest-summary.fixture.json");
const resultsCsvPath = path.join(outDir, "backtest-results.fixture.csv");
const resultsJsonPath = path.join(outDir, "backtest-results.fixture.json");
writeSummaryJson(summaryPath, summary);
writeResultsCsv(resultsCsvPath, results);
writeResultsJson(resultsJsonPath, results);
check(
  "summary JSON written",
  fs.existsSync(summaryPath),
  summaryPath,
);
check(
  "results CSV written",
  fs.existsSync(resultsCsvPath),
  resultsCsvPath,
);
check(
  "results JSON written",
  fs.existsSync(resultsJsonPath),
  resultsJsonPath,
);

// --- summary ---------------------------------------------------------
const total = passCount + failures.length;
const color = failures.length === 0 ? C_GREEN : C_RED;
console.log(
  `\n${color}${passCount}/${total} backtest-fixture assertions passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
