/**
 * test-backtest-tracking.ts
 *
 * Deterministic assertions for the enriched per-prop tracking layer:
 * line/edge/confidence buckets, postmortem tags, counterfactuals on
 * PASSes, and the audit-summary inputs the backtest page consumes.
 *
 * No external APIs. No network.
 */

import process from "node:process";
import { loadBacktestFixtures } from "../src/lib/backtest/data-loader";
import {
  runBacktest,
  V1_PROP_TYPES,
} from "../src/lib/backtest/runner";

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

console.log("Running backtest against fixture data...");
const fixtures = loadBacktestFixtures();
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

console.log(
  `\nEvaluated ${results.length} props · ${summary.qualifiedBets} qualified bets · ${summary.passes} passes\n`,
);

// 1. Every evaluated prop has a result or PASS ------------------------
console.log("Result / status coverage:");
check(
  "every evaluated prop has a result field",
  results.every((r) => typeof r.result === "string"),
);
check(
  "every evaluated prop is either bet or PASS",
  results.every(
    (r) =>
      r.result === "PASS" ||
      r.result === "WIN" ||
      r.result === "LOSS" ||
      r.result === "PUSH" ||
      r.result === "NO_RESULT",
  ),
);

const qualifiedBets = results.filter(
  (r) => r.qualified && r.recommendation !== "PASS",
);
check(
  "every qualified bet has WIN / LOSS / PUSH",
  qualifiedBets.every(
    (r) => r.result === "WIN" || r.result === "LOSS" || r.result === "PUSH",
  ),
);
const passes = results.filter((r) => !r.qualified || r.recommendation === "PASS");
check(
  "every non-qualified prop has result=PASS",
  passes.every((r) => r.result === "PASS"),
);

// 2. Selected side / odds tracked -------------------------------------
console.log("\nSelected side / odds:");
check(
  "every evaluated prop records selectedSide",
  results.every((r) => r.selectedSide === "OVER" || r.selectedSide === "UNDER"),
);
check(
  "every evaluated prop records selectedOdds",
  results.every((r) => typeof r.selectedOdds === "number"),
);

// 3. Bucket assignments ----------------------------------------------
console.log("\nBucket assignments:");
check(
  "every prop has a lineBucket label",
  results.every((r) => typeof r.lineBucket === "string" && r.lineBucket.length > 0),
);
check(
  "every prop has an edgeBucket label",
  results.every((r) => typeof r.edgeBucket === "string" && r.edgeBucket.length > 0),
);
check(
  "every prop has a confidenceBucket of High|Medium|Low",
  results.every(
    (r) =>
      r.confidenceBucket === "High" ||
      r.confidenceBucket === "Medium" ||
      r.confidenceBucket === "Low",
  ),
);

// 4. Postmortem tagging ----------------------------------------------
console.log("\nPostmortem tagging:");
const taggedResults = results.filter((r) => r.postmortemTags.length > 0);
check(
  "at least 5 props carry one or more postmortem tags",
  taggedResults.length >= 5,
  `count=${taggedResults.length}`,
);

const losingBets = results.filter((r) => r.result === "LOSS");
check(
  "at least one losing bet has a postmortem tag",
  losingBets.some((r) => r.postmortemTags.length > 0),
  `losingBets=${losingBets.length}`,
);

const passWouldHaveWon = results.filter(
  (r) => r.result === "PASS" && r.counterfactualResult === "WIN",
);
const passWouldHaveLost = results.filter(
  (r) => r.result === "PASS" && r.counterfactualResult === "LOSS",
);
check(
  "at least one PASS would have won (counterfactual WIN)",
  passWouldHaveWon.length >= 1,
  `count=${passWouldHaveWon.length}`,
);
check(
  "at least one PASS would have lost (counterfactual LOSS)",
  passWouldHaveLost.length >= 1,
  `count=${passWouldHaveLost.length}`,
);
check(
  "at least one PASS is tagged FILTER_TOO_CONSERVATIVE",
  results.some((r) =>
    r.postmortemTags.includes("FILTER_TOO_CONSERVATIVE"),
  ),
);
check(
  "at least one PASS is tagged FILTER_CORRECTLY_AVOIDED",
  results.some((r) =>
    r.postmortemTags.includes("FILTER_CORRECTLY_AVOIDED"),
  ),
);

// 5. Performance summaries -------------------------------------------
console.log("\nPerformance summaries:");
check(
  "summary.byPropType has entries",
  summary.byPropType.length >= 1,
);
check(
  "summary.byLineBucket has entries",
  summary.byLineBucket.length >= 1,
);
check(
  "summary.byEdgeBucket has entries",
  summary.byEdgeBucket.length >= 1,
);
check(
  "summary.byConfidence has all 3 tiers",
  summary.byConfidence.length === 3,
);
check(
  "summary.byDisqualifier has entries",
  summary.byDisqualifier.length >= 1,
);
check(
  "summary.byPostmortem has entries",
  summary.byPostmortem.length >= 1,
);
check(
  "summary.byRecommendationSide has OVER and UNDER (or one of them)",
  summary.byRecommendationSide.length >= 1,
);
check(
  "summary.byQualifiedVsPassed has 2 entries",
  summary.byQualifiedVsPassed.length === 2,
);
check(
  "summary.byRoleStability has entries",
  summary.byRoleStability.length >= 1,
);

// Performance breakdown shape ---------------------------------------
const lineBucket = summary.byLineBucket[0];
check(
  "line-bucket breakdown carries averageEdge",
  typeof lineBucket.averageEdge === "number",
);
check(
  "line-bucket breakdown carries averageModelProbability",
  typeof lineBucket.averageModelProbability === "number",
);
check(
  "line-bucket breakdown carries averageMarketProbability",
  typeof lineBucket.averageMarketProbability === "number",
);
check(
  "line-bucket breakdown carries averageProfitLossUnits",
  typeof lineBucket.averageProfitLossUnits === "number",
);

// 6. Audit summary ---------------------------------------------------
console.log("\nAudit summary:");
const a = summary.audit;
check(
  "audit identifies bestPropType",
  a.bestPropType !== undefined,
);
check(
  "audit identifies worstPropType",
  a.worstPropType !== undefined,
);
check(
  "audit identifies bestLineBucket",
  a.bestLineBucket !== undefined,
);
check(
  "audit identifies worstLineBucket",
  a.worstLineBucket !== undefined,
);
check(
  "audit identifies highestRoiEdgeBucket",
  a.highestRoiEdgeBucket !== undefined,
);
check(
  "audit identifies lowestRoiEdgeBucket",
  a.lowestRoiEdgeBucket !== undefined,
);
check(
  "audit reports filterSavedMostLosses",
  a.filterSavedMostLosses === "FILTER_CORRECTLY_AVOIDED",
);
check(
  "audit reports filterTooConservative",
  a.filterTooConservative === "FILTER_TOO_CONSERVATIVE",
);
check(
  "audit has passCounterfactualHitRate in [0, 1]",
  typeof a.passCounterfactualHitRate === "number" &&
    a.passCounterfactualHitRate >= 0 &&
    a.passCounterfactualHitRate <= 1,
);
check(
  "audit notes is a non-empty array",
  Array.isArray(a.notes) && a.notes.length >= 1,
);

// --- summary --------------------------------------------------------
const total = passCount + failures.length;
const color = failures.length === 0 ? C_GREEN : C_RED;
console.log(
  `\n${color}${passCount}/${total} backtest-tracking assertions passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
