/**
 * Offline scorecard-audit reproducer.
 *
 * Builds 5 synthetic stored candidates representing common
 * Week-1 cases, runs them through the adapter, and prints the
 * full scorecard audit + per-candidate disqualifier so we can
 * see whether 0 qualified is data-wiring or true gating.
 *
 * No paid API call. No network. No automated betting.
 */

import {
  applyScorecardToCandidates,
  buildPlayerHistoryByName,
} from "../src/lib/backtest/stored-candidate-scorecard";
import { buildScorecardAudit } from "../src/lib/backtest/week-1-grading";
import type { RealWeekCandidate } from "../src/lib/backtest/real-week-candidate-builder";
import type { NflPlayerWeekStat } from "../src/lib/ingestion/nflverse-types";

function statRow(over: Partial<NflPlayerWeekStat>): NflPlayerWeekStat {
  return {
    playerId: "00-pid",
    playerName: "Player",
    position: "WR",
    team: "BUF",
    opponent: "NYJ",
    season: 2024,
    week: 18,
    gameId: "2024-w18",
    homeAway: "HOME",
    snapShare: 0.85,
    ...over,
  };
}

function makeCandidate(over: Partial<RealWeekCandidate> = {}): RealWeekCandidate {
  return {
    id: "c-0",
    season: 2025,
    week: 1,
    gameId: "2025-w1-buf-nyj",
    playerName: "Player A",
    team: "BUF",
    opponent: "NYJ",
    propType: "RECEPTIONS",
    line: 4.5,
    overOdds: -115,
    underOdds: -105,
    sportsbook: "DRAFTKINGS",
    dataMode: "STORED_2025",
    syntheticFixture: false,
    ...over,
  };
}

interface Scenario {
  label: string;
  candidate: RealWeekCandidate;
  history: NflPlayerWeekStat[];
}

const SCENARIOS: Scenario[] = [
  {
    label: "Veteran WR · strong OVER projection",
    candidate: makeCandidate({
      id: "c-1",
      playerName: "Veteran WR",
      propType: "RECEPTIONS",
      line: 4.5,
    }),
    history: [
      statRow({ playerName: "Veteran WR", season: 2023, week: 14, receptions: 7, snapShare: 0.85 }),
      statRow({ playerName: "Veteran WR", season: 2023, week: 15, receptions: 6, snapShare: 0.86 }),
      statRow({ playerName: "Veteran WR", season: 2023, week: 16, receptions: 8, snapShare: 0.85 }),
      statRow({ playerName: "Veteran WR", season: 2023, week: 17, receptions: 7, snapShare: 0.84 }),
      statRow({ playerName: "Veteran WR", season: 2023, week: 18, receptions: 6, snapShare: 0.85 }),
      statRow({ playerName: "Veteran WR", season: 2024, week: 16, receptions: 7, snapShare: 0.85 }),
      statRow({ playerName: "Veteran WR", season: 2024, week: 17, receptions: 6, snapShare: 0.85 }),
      statRow({ playerName: "Veteran WR", season: 2024, week: 18, receptions: 7, snapShare: 0.86 }),
    ],
  },
  {
    label: "Rookie · zero prior history (likely fail dataQuality)",
    candidate: makeCandidate({
      id: "c-2",
      playerName: "Rookie",
      propType: "RECEPTIONS",
      line: 3.5,
    }),
    history: [],
  },
  {
    label: "Sophomore QB · 2 prior weeks (mid dataQuality)",
    candidate: makeCandidate({
      id: "c-3",
      playerName: "Soph QB",
      propType: "PASSING_ATTEMPTS",
      line: 30.5,
    }),
    history: [
      statRow({ playerName: "Soph QB", season: 2024, week: 17, passingAttempts: 35, snapShare: 0.98 }),
      statRow({ playerName: "Soph QB", season: 2024, week: 18, passingAttempts: 38, snapShare: 0.98 }),
    ],
  },
  {
    label: "RB · low snap share volatility (fails roleStability)",
    candidate: makeCandidate({
      id: "c-4",
      playerName: "Volatile RB",
      propType: "RUSHING_ATTEMPTS",
      line: 10.5,
    }),
    history: [
      statRow({ playerName: "Volatile RB", season: 2024, week: 16, rushingAttempts: 18, snapShare: 0.85 }),
      statRow({ playerName: "Volatile RB", season: 2024, week: 17, rushingAttempts: 4, snapShare: 0.25 }),
      statRow({ playerName: "Volatile RB", season: 2024, week: 18, rushingAttempts: 14, snapShare: 0.7 }),
    ],
  },
  {
    label: "Steady QB · flat projection (likely fails edge)",
    candidate: makeCandidate({
      id: "c-5",
      playerName: "Steady QB",
      propType: "PASSING_COMPLETIONS",
      line: 22.5,
    }),
    history: [
      statRow({ playerName: "Steady QB", season: 2024, week: 14, passingCompletions: 22, snapShare: 0.98 }),
      statRow({ playerName: "Steady QB", season: 2024, week: 15, passingCompletions: 23, snapShare: 0.98 }),
      statRow({ playerName: "Steady QB", season: 2024, week: 16, passingCompletions: 22, snapShare: 0.98 }),
      statRow({ playerName: "Steady QB", season: 2024, week: 17, passingCompletions: 23, snapShare: 0.98 }),
      statRow({ playerName: "Steady QB", season: 2024, week: 18, passingCompletions: 22, snapShare: 0.98 }),
    ],
  },
  {
    // CRITICAL: This scenario reproduces the production failure
    // pattern. A WR who played for "TB" in 2024 but signed with
    // "GB" for 2025. The stored Week-1 candidate carries
    // (playerName, team="GB"). The history rows exist in
    // player_week_stats under team="TB". buildPlayerHistoryByName
    // joins on BOTH playerName AND team, so no rows match → 0
    // history → dataQuality=0.40 → fails dataQuality gate. This
    // is the same as the "rookie" scenario from the engine's
    // perspective, even though the player has rich prior history.
    label: "Team-switched WR · 2024 history exists under OLD team (BUG)",
    candidate: makeCandidate({
      id: "c-6",
      playerName: "Switched WR",
      team: "GB",
      opponent: "DET",
      propType: "RECEPTIONS",
      line: 5.5,
    }),
    history: [
      statRow({ playerName: "Switched WR", team: "TB", season: 2023, week: 14, receptions: 8, snapShare: 0.86 }),
      statRow({ playerName: "Switched WR", team: "TB", season: 2023, week: 15, receptions: 7, snapShare: 0.85 }),
      statRow({ playerName: "Switched WR", team: "TB", season: 2024, week: 16, receptions: 9, snapShare: 0.88 }),
      statRow({ playerName: "Switched WR", team: "TB", season: 2024, week: 17, receptions: 8, snapShare: 0.86 }),
      statRow({ playerName: "Switched WR", team: "TB", season: 2024, week: 18, receptions: 7, snapShare: 0.85 }),
    ],
  },
];

function main(): void {
  console.log("Stored scorecard adapter — offline audit");
  console.log("==========================================");

  const candidates = SCENARIOS.map((s) => s.candidate);
  const allHistory = SCENARIOS.flatMap((s) => s.history);
  const playerHistoryByName = buildPlayerHistoryByName({
    candidates,
    season: 2025,
    week: 1,
    playerWeekStats: allHistory,
  });
  const evaluated = applyScorecardToCandidates({
    candidates,
    playerHistoryByName,
  });

  console.log("\nPer-candidate scorecard decisions:");
  console.log("-----------------------------------");
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i];
    const ev = evaluated[i];
    const sc = ev.scorecard!;
    console.log(`\n[${i + 1}] ${s.label}`);
    console.log(`    ${ev.playerName} ${ev.propType} ${ev.line}`);
    console.log(`    history rows: ${s.history.length}`);
    console.log(`    rec=${sc.recommendation}  qualified=${sc.qualified}  edge=${(sc.edge * 100).toFixed(1)}%  conf=${sc.confidence.toFixed(2)}  risk=${sc.riskScore.toFixed(2)}`);
    console.log(`    modelP(O)=${(sc.modelOverProbability * 100).toFixed(1)}%  mktP(O)=${(sc.marketOverProbability * 100).toFixed(1)}%`);
    console.log(`    projected mean=${sc.projectedMean.toFixed(2)}  σ=${sc.projectedStdDev.toFixed(2)}`);
    console.log(`    buckets: dq=${sc.dataQualityScore.toFixed(2)} role=${sc.roleStabilityScore.toFixed(2)} inj=${sc.injuryContextScore.toFixed(2)} corr=${sc.correlationExposureScore.toFixed(2)}`);
    console.log(`             wx=${sc.weatherEnvironmentScore.toFixed(2)} gs=${sc.gameScriptScore.toFixed(2)} pace=${sc.paceScore.toFixed(2)} mkt=${sc.marketContextScore.toFixed(2)}`);
    if (sc.disqualifiers.length > 0) {
      console.log(`    disqualifiers:`);
      for (const d of sc.disqualifiers) console.log(`      · ${d}`);
    }
  }

  console.log("\n\nAggregate audit:");
  console.log("-----------------");
  const audit = buildScorecardAudit({
    candidates: evaluated,
    playerHistoryByName,
    samplePicksCount: 5,
  });
  console.log(`scored=${audit.candidatesScored} withScorecard=${audit.candidatesWithScorecard} missingHistory=${audit.candidatesMissingHistory}`);
  console.log(`qualified=${audit.qualifiedCount} disqualified=${audit.disqualifiedCount}`);
  console.log(`byRec: OVER=${audit.byRecommendation.OVER} UNDER=${audit.byRecommendation.UNDER} PASS=${audit.byRecommendation.PASS} unknown=${audit.byRecommendation.unknown}`);
  console.log("\nTop disqualifiers:");
  for (const d of audit.topDisqualifiers) {
    console.log(`  ×${d.count}  ${d.reason}`);
  }
  console.log("\nPer-feature gate health:");
  console.log(
    `  bucket               gate  belowGate  missing  min   mean  max`,
  );
  for (const f of audit.featureCompleteness) {
    const min = f.scored > 0 ? f.minScore.toFixed(2) : "—   ";
    const mean = f.scored > 0 ? f.meanScore.toFixed(2) : "—   ";
    const max = f.scored > 0 ? f.maxScore.toFixed(2) : "—   ";
    console.log(
      `  ${f.bucket.padEnd(20)} ${f.gateThreshold.toFixed(2)}  ${String(f.belowGate).padStart(9)}  ${String(f.missing).padStart(7)}  ${min}  ${mean}  ${max}`,
    );
  }
}

main();
