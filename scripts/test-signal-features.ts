/**
 * Diagnostic mispricing feature computation — assertions.
 *
 *   · strict-before discipline: rows from the target week or
 *     later seasons must be excluded from every feature.
 *   · roleChangeScore: positive when the last-2 mean exceeds
 *     the prior baseline, negative when it dips, zero when
 *     history is too short to bisect.
 *   · usageMomentumScore: positive slope when the last 3
 *     games show rising usage, negative when falling.
 *   · volatilityScore + bucket: lower CV → "low", higher →
 *     "high", insufficient history → "unknown".
 *   · distributionBiasScore: negative when mean exceeds
 *     median (boom-bust right-skew), positive when the
 *     median is higher.
 *   · scriptSensitivityScore: positive when HOME share
 *     outpaces AWAY, falls back to 0 with the `usedFallback`
 *     flag when one of the splits is empty.
 *   · marketResistanceScore: rises with a tight market (low
 *     overround) and meaningful absolute model edge.
 *   · hasNeutralFallback fires when any input defaulted, and
 *     historyRowsUsed reports the strict-before row count
 *     the features were computed from.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import { computeSignalFeatures } from "../src/lib/backtest/signal-features";
import type { NflPlayerWeekStat } from "../src/lib/ingestion/nflverse-types";

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

function makeRow(over: Partial<NflPlayerWeekStat>): NflPlayerWeekStat {
  return {
    season: 2025,
    week: 1,
    playerId: "00-PLAYER",
    playerName: "Test Player",
    team: "BUF",
    position: "WR",
    opponent: "NYJ",
    gameId: "2025-w1-BUF-NYJ",
    homeAway: "HOME",
    passingAttempts: 0,
    passingCompletions: 0,
    passingYards: 0,
    rushingAttempts: 0,
    rushingYards: 0,
    receptions: 0,
    receivingYards: 0,
    targets: 0,
    snapShare: 0.5,
    targetShare: 0.2,
    carryShare: 0.1,
    ...over,
  };
}

function main(): void {
  console.log("Signal-features computation — assertions");
  console.log("========================================");

  // 1. Strict-before: rows from the target week and later
  //    seasons must NOT influence the features. We use a row
  //    on the target week with absurdly high usage and check
  //    that it doesn't pull the role/momentum scores upward.
  {
    const r = makeReport("strict-before excludes target-week and future rows");
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targetShare: 0.20, receptions: 4 }),
      makeRow({ season: 2025, week: 2, targetShare: 0.22, receptions: 5 }),
      makeRow({ season: 2025, week: 3, targetShare: 0.20, receptions: 3 }),
      makeRow({ season: 2025, week: 4, targetShare: 0.22, receptions: 4 }),
      makeRow({ season: 2025, week: 5, targetShare: 0.21, receptions: 5 }),
      // Target week — must be excluded.
      makeRow({ season: 2025, week: 6, targetShare: 0.95, receptions: 99 }),
      // Future row — must be excluded.
      makeRow({ season: 2026, week: 1, targetShare: 0.95, receptions: 99 }),
    ];
    const f = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 6,
      history,
    });
    check(
      r,
      f.historyRowsUsed === 5,
      `historyRowsUsed=${f.historyRowsUsed}, expected 5 (target+future excluded)`,
    );
    // A 95% target share would push role change to +1 — the
    // exclusion must keep it small (history is stable ~0.21).
    check(
      r,
      Math.abs(f.roleChangeScore) < 0.1,
      `roleChangeScore=${f.roleChangeScore} — strict-before should keep it ~0`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — strict-before discipline");
    else console.log("[1] FAIL — strict-before discipline");
  }

  // 2. roleChangeScore positive when the last 2 weeks spike
  //    above the baseline.
  {
    const r = makeReport("roleChangeScore positive on usage spike");
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targetShare: 0.10 }),
      makeRow({ season: 2025, week: 2, targetShare: 0.10 }),
      makeRow({ season: 2025, week: 3, targetShare: 0.10 }),
      makeRow({ season: 2025, week: 4, targetShare: 0.10 }),
      makeRow({ season: 2025, week: 5, targetShare: 0.30 }),
      makeRow({ season: 2025, week: 6, targetShare: 0.30 }),
    ];
    const f = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 7,
      history,
    });
    // (0.30 - 0.10) / 0.10 = 2.0 — clamped to 1.0
    check(
      r,
      f.roleChangeScore > 0.5,
      `roleChangeScore=${f.roleChangeScore} — expected > 0.5 for usage spike`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — roleChangeScore detects spike");
    else console.log("[2] FAIL — roleChangeScore");
  }

  // 3. usageMomentumScore: positive slope when last-3 climbs.
  {
    const r = makeReport("usageMomentumScore positive on rising slope");
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, targetShare: 0.10 }),
      makeRow({ season: 2025, week: 2, targetShare: 0.15 }),
      makeRow({ season: 2025, week: 3, targetShare: 0.25 }),
    ];
    const f = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 4,
      history,
    });
    check(
      r,
      f.usageMomentumScore > 0,
      `usageMomentumScore=${f.usageMomentumScore} — expected positive`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — usageMomentumScore detects upward slope");
    else console.log("[3] FAIL — usageMomentumScore");
  }

  // 4. volatilityScore bucket: stable production → low,
  //    erratic → high.
  {
    const r = makeReport("volatilityScore bucket low/medium/high");
    // Stable: receptions ≈ 4 every week.
    const stable: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, receptions: 4 }),
      makeRow({ season: 2025, week: 2, receptions: 4 }),
      makeRow({ season: 2025, week: 3, receptions: 4 }),
      makeRow({ season: 2025, week: 4, receptions: 4 }),
    ];
    const f1 = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 5,
      history: stable,
    });
    check(
      r,
      f1.volatilityBucket === "low",
      `stable rec=4: bucket=${f1.volatilityBucket}, expected low`,
    );
    // Boom-bust: 1, 12, 0, 11.
    const erratic: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, receptions: 1 }),
      makeRow({ season: 2025, week: 2, receptions: 12 }),
      makeRow({ season: 2025, week: 3, receptions: 0 }),
      makeRow({ season: 2025, week: 4, receptions: 11 }),
    ];
    const f2 = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 5,
      history: erratic,
    });
    check(
      r,
      f2.volatilityBucket === "high",
      `boom-bust: bucket=${f2.volatilityBucket}, expected high`,
    );
    // Empty history → unknown + neutral fallback.
    const f3 = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 5,
      history: [],
    });
    check(
      r,
      f3.volatilityBucket === "unknown",
      `no history: bucket=${f3.volatilityBucket}, expected unknown`,
    );
    check(
      r,
      f3.hasNeutralFallback === true,
      "no-history feature must set hasNeutralFallback=true",
    );
    check(
      r,
      f3.historyRowsUsed === 0,
      `historyRowsUsed=${f3.historyRowsUsed}, expected 0`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — volatilityScore buckets");
    else console.log("[4] FAIL — volatilityScore");
  }

  // 5. distributionBiasScore negative for boom-bust right-skew.
  {
    const r = makeReport("distributionBiasScore negative on right-skew");
    // mean 6, median 3 → (3-6)/6 = -0.5
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, receptions: 2 }),
      makeRow({ season: 2025, week: 2, receptions: 3 }),
      makeRow({ season: 2025, week: 3, receptions: 3 }),
      makeRow({ season: 2025, week: 4, receptions: 16 }),
    ];
    const f = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 5,
      history,
    });
    check(
      r,
      f.distributionBiasScore < 0,
      `distributionBiasScore=${f.distributionBiasScore}, expected negative (mean > median)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — distributionBiasScore right-skew detection");
    else console.log("[5] FAIL — distributionBiasScore");
  }

  // 6. scriptSensitivityScore positive when HOME share > AWAY,
  //    fallback flag fires when one of the splits is empty.
  {
    const r = makeReport("scriptSensitivityScore home vs away");
    // Receptions stay non-zero so the volatility bucket is
    // populated and doesn't force hasNeutralFallback=true via
    // the "vol.bucket === unknown" branch.
    const history: NflPlayerWeekStat[] = [
      makeRow({
        season: 2025,
        week: 1,
        homeAway: "HOME",
        targetShare: 0.30,
        receptions: 6,
      }),
      makeRow({
        season: 2025,
        week: 2,
        homeAway: "HOME",
        targetShare: 0.30,
        receptions: 6,
      }),
      makeRow({
        season: 2025,
        week: 3,
        homeAway: "AWAY",
        targetShare: 0.10,
        receptions: 2,
      }),
      makeRow({
        season: 2025,
        week: 4,
        homeAway: "AWAY",
        targetShare: 0.10,
        receptions: 2,
      }),
    ];
    const f = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 5,
      history,
    });
    check(
      r,
      f.scriptSensitivityScore > 0,
      `scriptSensitivityScore=${f.scriptSensitivityScore}, expected positive (HOME > AWAY)`,
    );
    check(
      r,
      f.hasNeutralFallback === false,
      `scriptSensitivity with both splits: hasNeutralFallback should be false, got ${f.hasNeutralFallback}`,
    );

    // Only HOME rows → script fallback fires.
    const onlyHome: NflPlayerWeekStat[] = [
      makeRow({
        season: 2025,
        week: 1,
        homeAway: "HOME",
        targetShare: 0.30,
        receptions: 6,
      }),
      makeRow({
        season: 2025,
        week: 2,
        homeAway: "HOME",
        targetShare: 0.30,
        receptions: 6,
      }),
      makeRow({
        season: 2025,
        week: 3,
        homeAway: "HOME",
        targetShare: 0.30,
        receptions: 6,
      }),
      makeRow({
        season: 2025,
        week: 4,
        homeAway: "HOME",
        targetShare: 0.30,
        receptions: 6,
      }),
    ];
    const f2 = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 5,
      history: onlyHome,
    });
    check(
      r,
      f2.scriptSensitivityScore === 0,
      `only-HOME scriptSensitivityScore=${f2.scriptSensitivityScore}, expected 0`,
    );
    check(
      r,
      f2.hasNeutralFallback === true,
      "only-HOME history must set hasNeutralFallback=true",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — scriptSensitivityScore");
    else console.log("[6] FAIL — scriptSensitivityScore");
  }

  // 7. marketResistanceScore: tighter market + larger edge =
  //    higher score. Compare tight vs loose markets at the
  //    same edge.
  {
    const r = makeReport("marketResistanceScore tightness × edge");
    const history: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, receptions: 4 }),
      makeRow({ season: 2025, week: 2, receptions: 4 }),
      makeRow({ season: 2025, week: 3, receptions: 4 }),
    ];
    // Tight market: -110 / -110 → overround ~1.048.
    const tight = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.10,
      currentSeason: 2025,
      currentWeek: 4,
      history,
    });
    // Loose market: -130 / -130 → overround ~1.13.
    const loose = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -130,
      underOdds: -130,
      modelEdge: 0.10,
      currentSeason: 2025,
      currentWeek: 4,
      history,
    });
    check(
      r,
      tight.marketResistanceScore > loose.marketResistanceScore,
      `tight=${tight.marketResistanceScore} should exceed loose=${loose.marketResistanceScore}`,
    );
    check(
      r,
      tight.marketResistanceScore > 0,
      `tight market with edge should produce score > 0, got ${tight.marketResistanceScore}`,
    );
    // Zero-edge produces zero score.
    const noEdge = computeSignalFeatures({
      propType: "RECEPTIONS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0,
      currentSeason: 2025,
      currentWeek: 4,
      history,
    });
    check(
      r,
      noEdge.marketResistanceScore === 0,
      `zero-edge marketResistance=${noEdge.marketResistanceScore}, expected 0`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — marketResistanceScore tightness × edge");
    else console.log("[7] FAIL — marketResistanceScore");
  }

  // 8. RUSHING_ATTEMPTS uses carryShare for usage; PASSING
  //    uses snapShare. We sanity-check both routings.
  {
    const r = makeReport("propType routes share metric");
    // Rising carry share.
    const rushHistory: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, carryShare: 0.20, rushingAttempts: 8 }),
      makeRow({ season: 2025, week: 2, carryShare: 0.30, rushingAttempts: 12 }),
      makeRow({ season: 2025, week: 3, carryShare: 0.40, rushingAttempts: 18 }),
    ];
    const rush = computeSignalFeatures({
      propType: "RUSHING_ATTEMPTS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 4,
      history: rushHistory,
    });
    check(
      r,
      rush.usageMomentumScore > 0,
      `rushing usageMomentumScore=${rush.usageMomentumScore}, expected positive (carryShare rising)`,
    );

    // Rising snap share for passing attempts.
    const passHistory: NflPlayerWeekStat[] = [
      makeRow({ season: 2025, week: 1, snapShare: 0.30, passingAttempts: 20 }),
      makeRow({ season: 2025, week: 2, snapShare: 0.60, passingAttempts: 30 }),
      makeRow({ season: 2025, week: 3, snapShare: 0.90, passingAttempts: 40 }),
    ];
    const pass = computeSignalFeatures({
      propType: "PASSING_ATTEMPTS",
      overOdds: -110,
      underOdds: -110,
      modelEdge: 0.05,
      currentSeason: 2025,
      currentWeek: 4,
      history: passHistory,
    });
    check(
      r,
      pass.usageMomentumScore > 0,
      `passing usageMomentumScore=${pass.usageMomentumScore}, expected positive (snapShare rising)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — propType routes correct share metric");
    else console.log("[8] FAIL — propType routing");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 8 / 8 SCENARIOS PASSED");
    return;
  }
  console.log(`FAIL — ${FAILURES.length} scenario(s) failed:`);
  for (const f of FAILURES) {
    console.log(`  · ${f.scenario}`);
    for (const reason of f.reasons) console.log(`    - ${reason}`);
  }
  process.exitCode = 1;
}

main();
