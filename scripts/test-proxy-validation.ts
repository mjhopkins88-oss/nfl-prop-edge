/**
 * test-proxy-validation.ts
 *
 * 1. Run fixture backtest (no APIs).
 * 2. Synthesize proxy football features from fixture stats and attach
 *    them to each `BacktestEvaluatedProp` (demo synthesis — see
 *    `synthesizeProxiesForProp` below; real data would replace this
 *    via a future ingestion pipeline).
 * 3. Run the proxy accuracy validation framework.
 * 4. Write the four required output files.
 * 5. Assert framework invariants.
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
  buildProxyAccuracyReport,
  bucketProxyConfidence,
  bucketProxyValue,
  calculateProxyLift,
  compareModelWithAndWithoutProxies,
  findProxyFalseNegatives,
  findProxyFalsePositives,
  PROXY_NAMES,
  RELEVANT_PROP_TYPES_BY_PROXY,
  readProxyResult,
  summarizeProxyPerformance,
} from "../src/lib/backtest/proxy-validation";
import type { BacktestEvaluatedProp } from "../src/lib/backtest/types";
import {
  buildAllFootballProxies,
} from "../src/lib/model/proxy-football-features";
import type {
  AllFootballProxies,
  DefenseProxyInput,
  OffenseProxyInput,
  PlayerProxyInput,
} from "../src/lib/model/proxy-football-features";
import type { LoadedBacktestFixtures } from "../src/lib/backtest/data-loader";
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

function section(title: string): void {
  console.log(`\n${title}`);
}

// --- demo proxy synthesis -------------------------------------------
//
// Maps fixture stats (snapShare / targetShare / receptions / etc.) into
// the proxy input shapes. These are demo assumptions documented here so
// the validation framework can be exercised end-to-end against fixture
// data. Production inputs would come from a real ingestion pipeline.

const TEAM_DEFENSE_DEMO: Record<string, Partial<DefenseProxyInput>> = {
  BUF: {
    epaPerDropbackAllowed: 0.02,
    epaPerRushAllowed: -0.04,
    deepCompletionsAllowed: 9,
    deepCompletionsLeagueExpected: 14,
    blitzPctEstimate: 0.25,
  },
  KC: {
    epaPerDropbackAllowed: 0.06,
    epaPerRushAllowed: 0.05,
    deepCompletionsAllowed: 14,
    deepCompletionsLeagueExpected: 14,
    blitzPctEstimate: 0.2,
  },
  SF: {
    epaPerDropbackAllowed: -0.04,
    epaPerRushAllowed: -0.06,
    deepCompletionsAllowed: 7,
    deepCompletionsLeagueExpected: 14,
    blitzPctEstimate: 0.3,
  },
  MIA: {
    epaPerDropbackAllowed: 0.0,
    epaPerRushAllowed: -0.05,
    deepCompletionsAllowed: 8,
    deepCompletionsLeagueExpected: 14,
    blitzPctEstimate: 0.22,
  },
  PHI: {
    epaPerDropbackAllowed: 0.0,
    epaPerRushAllowed: -0.03,
    deepCompletionsAllowed: 12,
    deepCompletionsLeagueExpected: 14,
    blitzPctEstimate: 0.42,
  },
  DAL: {
    epaPerDropbackAllowed: 0.08,
    epaPerRushAllowed: 0.0,
    deepCompletionsAllowed: 18,
    deepCompletionsLeagueExpected: 14,
    blitzPctEstimate: 0.25,
  },
  NYG: {
    epaPerDropbackAllowed: 0.05,
    epaPerRushAllowed: 0.02,
    deepCompletionsAllowed: 16,
    deepCompletionsLeagueExpected: 14,
    blitzPctEstimate: 0.27,
  },
  MIN: {
    epaPerDropbackAllowed: -0.02,
    epaPerRushAllowed: -0.02,
    deepCompletionsAllowed: 13,
    deepCompletionsLeagueExpected: 14,
    blitzPctEstimate: 0.28,
  },
};

interface SynthesizedAggregates {
  player: PlayerProxyInput;
  offense: OffenseProxyInput;
  defense: DefenseProxyInput;
}

function synthesizeAggregatesForProp(
  prop: BacktestEvaluatedProp,
  fixtures: LoadedBacktestFixtures,
): SynthesizedAggregates {
  const playerRows = fixtures.playerWeekStats.filter(
    (r) =>
      r.playerId === prop.playerId &&
      r.season === prop.season &&
      r.week < prop.week,
  );
  const teamRows = fixtures.playerWeekStats.filter(
    (r) =>
      r.teamAbbr === prop.team &&
      r.season === prop.season &&
      r.week < prop.week,
  );
  const games = new Set(playerRows.map((r) => r.week)).size;
  const teamGames = new Set(teamRows.map((r) => r.week)).size;

  // Synthesize targets ≈ receptions / 0.68 (league-average catch rate).
  const receptions = playerRows.reduce((acc, r) => acc + r.receptions, 0);
  const targets = Math.round(receptions / 0.68);
  const receivingYards = playerRows.reduce((acc, r) => acc + r.receivingYards, 0);
  // airYards ≈ receivingYards × 1.5 — receiving yards reflect post-catch + air,
  // air yards are the throw distance regardless of catch.
  const airYards = Math.round(receivingYards * 1.5);
  const snapShare =
    playerRows.length > 0
      ? playerRows.reduce((acc, r) => acc + r.snapShare, 0) / playerRows.length
      : 0;
  const carries = playerRows.reduce((acc, r) => acc + r.rushingAttempts, 0);
  const carryShare =
    playerRows.length > 0
      ? playerRows.reduce((acc, r) => acc + r.carryShare, 0) / playerRows.length
      : 0;
  const weekTargetShares = playerRows.map((r) => r.targetShare);

  // Team-level totals.
  const teamPassAttempts = teamRows.reduce(
    (acc, r) => acc + r.passingAttempts,
    0,
  );
  const teamRushAttempts = teamRows.reduce(
    (acc, r) => acc + r.rushingAttempts,
    0,
  );
  // teamTargets ≈ team pass attempts (each attempt produces a target).
  const teamTargets = teamPassAttempts;
  const teamAirYards = Math.round(teamPassAttempts * 7.8); // league avg aDOT ≈ 7.8
  // Sacks taken: synthetic at ~5% of attempts.
  const sacksTaken = Math.round(teamPassAttempts * 0.05);
  // Per-week team rushing attempts.
  const weekRushingAttempts: number[] = [];
  const seenWeeks = new Set<number>();
  for (const r of teamRows) {
    if (!seenWeeks.has(r.week)) {
      seenWeeks.add(r.week);
      const totalForWeek = teamRows
        .filter((x) => x.week === r.week)
        .reduce((acc, x) => acc + x.rushingAttempts, 0);
      weekRushingAttempts.push(totalForWeek);
    }
  }

  const player: PlayerProxyInput = {
    position: (playerRows[0]?.position ?? "WR") as PlayerProxyInput["position"],
    games,
    targets,
    receptions,
    receivingYards,
    airYards,
    teamTargets,
    teamAirYards,
    snapShare,
    carries,
    carryShare,
    weekTargetShares,
  };
  const offense: OffenseProxyInput = {
    games: teamGames,
    teamPassAttempts,
    teamRushAttempts,
    sacksTaken,
    weekRushingAttempts,
  };

  // Defense: aggregate by opponent across weeks. Since the fixture
  // doesn't carry per-game pass/rush totals at the opponent level, we
  // synthesize from baseline league rates × games + team overrides.
  const defOverrides = TEAM_DEFENSE_DEMO[prop.opponent] ?? {};
  const defGames = 4;
  const passFaced = Math.round(defGames * 32 + (prop.opponent === "DAL" ? 8 : 0));
  const rushFaced = Math.round(defGames * 24);
  const sacksGenerated = Math.round(passFaced * 0.06);
  const defense: DefenseProxyInput = {
    games: defGames,
    passAttemptsFaced: passFaced,
    rushAttemptsFaced: rushFaced,
    sacksGenerated,
    ...defOverrides,
  };
  return { player, offense, defense };
}

function attachProxies(
  props: BacktestEvaluatedProp[],
  fixtures: LoadedBacktestFixtures,
): BacktestEvaluatedProp[] {
  return props.map((p) => {
    const { player, offense, defense } = synthesizeAggregatesForProp(
      p,
      fixtures,
    );
    const proxies: AllFootballProxies = buildAllFootballProxies({
      player,
      offense,
      defense,
    });
    return { ...p, proxies };
  });
}

// --- run the backtest -----------------------------------------------

console.log("Running fixture backtest...");
const fixtures = loadBacktestFixtures();
const { results: rawResults } = runBacktest({
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
const results = attachProxies(rawResults, fixtures);
console.log(
  `Attached proxies to ${results.length} evaluated props (` +
    `${results.filter((r) => r.proxies !== undefined).length} have proxy data).`,
);

// --- write the four output files ------------------------------------

const outDir = path.join("data", "backtests", "2025");
fs.mkdirSync(outDir, { recursive: true });

const report = buildProxyAccuracyReport(results);
const performance = summarizeProxyPerformance(results);
const lift = calculateProxyLift(results);
const falsePositives = findProxyFalsePositives(results);
const falseNegatives = findProxyFalseNegatives(results);

fs.writeFileSync(
  path.join(outDir, "proxy-performance.fixture.json"),
  JSON.stringify({ generatedAt: report.generatedAt, performance }, null, 2),
);
fs.writeFileSync(
  path.join(outDir, "proxy-lift.fixture.json"),
  JSON.stringify({ generatedAt: report.generatedAt, lift }, null, 2),
);
fs.writeFileSync(
  path.join(outDir, "proxy-false-positives.fixture.json"),
  JSON.stringify(
    { generatedAt: report.generatedAt, falsePositives },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(outDir, "proxy-false-negatives.fixture.json"),
  JSON.stringify(
    { generatedAt: report.generatedAt, falseNegatives },
    null,
    2,
  ),
);

console.log(
  `\nWrote: proxy-performance.fixture.json, proxy-lift.fixture.json, proxy-false-positives.fixture.json, proxy-false-negatives.fixture.json`,
);

// --- assertions -----------------------------------------------------

section("1. Performance summary covers every proxy");
for (const name of PROXY_NAMES) {
  check(`1 performance summary present for ${name}`, !!performance[name]);
  check(
    `1 ${name} has relevant prop types`,
    performance[name].relevantPropTypes.length >= 1,
  );
}

section("2. Proxy buckets are assigned per evaluated prop");
{
  const allBucketLabels = new Set<string>();
  for (const r of results) {
    if (!r.proxies) continue;
    for (const name of PROXY_NAMES) {
      const pr = readProxyResult(r.proxies, name);
      if (!pr) continue;
      allBucketLabels.add(bucketProxyValue(pr.value));
      allBucketLabels.add(bucketProxyConfidence(pr.confidence));
    }
  }
  check(
    "2 every assigned bucket is LOW / MEDIUM / HIGH",
    Array.from(allBucketLabels).every(
      (l) => l === "LOW" || l === "MEDIUM" || l === "HIGH",
    ),
  );
  check("2 at least one HIGH-value bucket observed", allBucketLabels.has("HIGH"));
  check("2 at least one LOW-value bucket observed", allBucketLabels.has("LOW"));
}

section("3. Lift calculation present for every proxy");
{
  for (const entry of lift) {
    check(
      `3 ${entry.proxyName} has lift entry with numeric fields`,
      typeof entry.liftVsBaselinePp === "number" &&
        Number.isFinite(entry.liftVsBaselinePp) &&
        typeof entry.baselineRoiPct === "number" &&
        typeof entry.highBothRoiPct === "number",
    );
    check(
      `3 ${entry.proxyName} recommendation is KEEP / RECALIBRATE / RETIRE`,
      entry.recommendation === "KEEP" ||
        entry.recommendation === "RECALIBRATE" ||
        entry.recommendation === "RETIRE",
    );
  }
}

section("4. False-positive / false-negative arrays exist");
check("4 falsePositives is an array", Array.isArray(falsePositives));
check("4 falseNegatives is an array", Array.isArray(falseNegatives));
for (const ex of [...falsePositives, ...falseNegatives]) {
  check(
    `4 example for ${ex.proxyName} has structural fields`,
    typeof ex.player === "string" &&
      typeof ex.team === "string" &&
      typeof ex.opponent === "string" &&
      typeof ex.line === "number" &&
      typeof ex.proxyValue === "number" &&
      typeof ex.proxyConfidence === "number" &&
      typeof ex.explanation === "string",
  );
}

section("5. Output files exist on disk");
for (const f of [
  "proxy-performance.fixture.json",
  "proxy-lift.fixture.json",
  "proxy-false-positives.fixture.json",
  "proxy-false-negatives.fixture.json",
]) {
  const p = path.join(outDir, f);
  check(`5 ${f} written`, fs.existsSync(p));
}

section("6. Comparison report exists with bounded deltas");
const comparison = compareModelWithAndWithoutProxies(results);
check(
  "6 proxySupported.evaluated >= 0",
  comparison.proxySupported.evaluated >= 0,
);
check(
  "6 proxyUnsupported.evaluated >= 0",
  comparison.proxyUnsupported.evaluated >= 0,
);
check(
  "6 hitRateDeltaPp is a number",
  typeof comparison.hitRateDeltaPp === "number" &&
    Number.isFinite(comparison.hitRateDeltaPp),
);
check(
  "6 roiDeltaPp is a number",
  typeof comparison.roiDeltaPp === "number" &&
    Number.isFinite(comparison.roiDeltaPp),
);

section("7. No proxy carries a forcing surface");
{
  let badFields = 0;
  for (const r of results) {
    if (!r.proxies) continue;
    for (const name of PROXY_NAMES) {
      const pr = readProxyResult(r.proxies, name);
      if (!pr) continue;
      if ("recommendation" in pr || "forcedSide" in pr || "direction" in pr) {
        badFields++;
      }
    }
  }
  check("7 no proxy exposes a recommendation/forced-side/direction field", badFields === 0);
}

section("8. Best / worst proxy identification");
check(
  "8 report identifies bestProxy",
  report.bestProxy !== undefined,
);
check(
  "8 report identifies worstProxy",
  report.worstProxy !== undefined,
);

section("9. Relevant prop type mapping is non-empty and uses V1 props only");
{
  const v1 = new Set<PropType>(V1_PROP_TYPES);
  let allValid = true;
  for (const name of PROXY_NAMES) {
    const propTypes = RELEVANT_PROP_TYPES_BY_PROXY[name];
    if (propTypes.length === 0) allValid = false;
    for (const pt of propTypes) {
      if (!v1.has(pt)) allValid = false;
    }
  }
  check("9 every proxy has at least one V1 relevant prop type", allValid);
}

section("10. Per-proxy bucket aggregates have consistent counts");
{
  let consistent = true;
  for (const name of PROXY_NAMES) {
    const s = performance[name];
    const valueSum =
      s.byValueBucket.LOW.evaluated +
      s.byValueBucket.MEDIUM.evaluated +
      s.byValueBucket.HIGH.evaluated;
    const confSum =
      s.byConfidenceBucket.LOW.evaluated +
      s.byConfidenceBucket.MEDIUM.evaluated +
      s.byConfidenceBucket.HIGH.evaluated;
    if (valueSum !== s.evaluated || confSum !== s.evaluated) {
      consistent = false;
    }
  }
  check("10 LOW + MEDIUM + HIGH counts add up to evaluated", consistent);
}

// --- summary --------------------------------------------------------
const total = passCount + failures.length;
const color = failures.length === 0 ? C_GREEN : C_RED;
console.log(
  `\n${color}${passCount}/${total} proxy-validation assertions passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
