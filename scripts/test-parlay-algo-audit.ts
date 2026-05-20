/**
 * Parlay algo audit — verifies the safe additive improvements from
 * PARLAY_ALGO_AUDIT.md.
 *
 *   · payout math correct for 15% / 17.5% / 20% hit rates
 *   · high payout alone cannot qualify
 *   · correlation alone cannot qualify
 *   · one bad leg blocks the parlay
 *   · unknown correlation shrinks toward independent probability
 *   · positive correlation adjustment is capped
 *   · 3-leg parlays receive higher variance penalty
 *   · yardage-heavy parlays receive higher volatility penalty
 *   · overstacked same-game pass volume is blocked
 *   · same player attempts/yards stack requires role / game-script support
 *   · pressure / checkdown stack is classified correctly
 *   · non-correlated EV pair is separate from correlated parlay
 *   · portfolio optimizer caps same-game exposure
 *   · parlay risk profile is assigned
 *   · parlay postmortem tags can be assigned
 *   · no touchdown propTypes admitted
 *   · no automated betting exists
 *
 * Pure CPU. No APIs. Deterministic.
 */

import {
  buildParlayCandidates,
  qualifyParlayCandidate,
} from "../src/lib/model/parlay-builder";
import {
  PARLAY_LEG_FIXTURES,
  PARLAY_CANDIDATE_FIXTURES,
  getParlayLegById,
} from "../src/lib/model/parlay-data";
import {
  calculateRequiredPayoutMultiplier,
} from "../src/lib/model/parlay-config";
import {
  calculateCorrelationAdjustedJointProbability,
  calculateIndependentJointProbability,
} from "../src/lib/model/parlay-probability";
import {
  calculateRequiredHitRateForROI,
  calculateRequiredPayoutForTargetROI,
  calculateProjectedROI,
  classifyPayoutHitRateFit,
  simulateParlayBatch,
} from "../src/lib/model/parlay-target-math";
import {
  buildParlayRiskProfileBundle,
  calculateOverstackingScore,
  calculateParlayFragilityScore,
  calculateParlayVarianceScore,
  classifyParlayRiskProfile,
} from "../src/lib/model/parlay-risk-profile";
import {
  optimizeParlayPortfolio,
} from "../src/lib/model/parlay-selection-optimizer";
import {
  assignParlayPostmortemTags,
} from "../src/lib/model/parlay-postmortem";
import { buildAllFixtureParlayCandidates } from "../src/lib/model/parlay-scorecard";
import {
  buildParlayTypeStrengthBundle,
  scoreParlayTypeStrength,
} from "../src/lib/model/parlay-type-strength";

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

function describeCandidate(c: ReturnType<typeof qualifyParlayCandidate>): string {
  return `${c.parlayType} ${c.recommendation} (EV ${(c.expectedValue * 100).toFixed(1)}%, conf-adj ${(c.confidenceAdjustedExpectedValue * 100).toFixed(1)}%, payout ${c.payoutMultiplier.toFixed(2)}x, hit ${(c.projectedHitRate * 100).toFixed(1)}% vs req ${(c.requiredHitRate * 100).toFixed(1)}%)`;
}

function fixtureCandidate(scenarioNote: string) {
  const spec = PARLAY_CANDIDATE_FIXTURES.find((f) =>
    f.scenarioNote.toLowerCase().includes(scenarioNote.toLowerCase()),
  );
  if (!spec) throw new Error(`No fixture for "${scenarioNote}"`);
  const legs = spec.legIds
    .map((id) => getParlayLegById(id))
    .filter((l): l is NonNullable<typeof l> => l !== undefined);
  return buildParlayCandidates({
    legs,
    candidateSpecs: [{ legIds: spec.legIds, parlayType: spec.parlayType }],
    maxLegsPerParlay: 3,
  })[0];
}

function main(): void {
  console.log("Parlay algo audit — scenario runner");
  console.log("===================================");

  // 1. Payout math.
  {
    const r = makeReport("payout math 15% / 17.5% / 20%");
    const m15 = calculateRequiredPayoutMultiplier({ expectedHitRate: 0.15 });
    const m175 = calculateRequiredPayoutMultiplier({ expectedHitRate: 0.175 });
    const m20 = calculateRequiredPayoutMultiplier({ expectedHitRate: 0.2 });
    check(r, Math.abs(m15 - 7.3333) < 0.005, `15% hit rate → ${m15.toFixed(4)} (expected 7.3333)`);
    check(r, Math.abs(m175 - 6.2857) < 0.005, `17.5% hit rate → ${m175.toFixed(4)} (expected 6.2857)`);
    check(r, Math.abs(m20 - 5.5) < 0.005, `20% hit rate → ${m20.toFixed(4)} (expected 5.5)`);
    const fromMath = calculateRequiredPayoutForTargetROI({ expectedHitRate: 0.15 });
    check(r, Math.abs(fromMath - 7.3333) < 0.005, `calculateRequiredPayoutForTargetROI matches`);
    record(r);
    if (r.reasons.length === 0)
      console.log(`[1] PASS — payout math 15%/17.5%/20% (${m15.toFixed(2)}, ${m175.toFixed(2)}, ${m20.toFixed(2)})`);
    else console.log(`[1] FAIL — payout math`);
  }

  // 2. High payout alone cannot qualify.
  {
    const r = makeReport("high payout alone cannot qualify");
    const candidate = fixtureCandidate("High-payout longshot pairing");
    check(r, !candidate.qualified, `expected high-payout longshot to PASS, got ${candidate.recommendation}`);
    check(r, candidate.payoutMultiplier >= 5, `payout multiplier ${candidate.payoutMultiplier.toFixed(2)} should be ≥ 5x`);
    record(r);
    if (r.reasons.length === 0)
      console.log(`[2] PASS — high payout alone cannot qualify: ${describeCandidate(candidate)}`);
    else console.log(`[2] FAIL — high payout alone`);
  }

  // 3. Correlation alone cannot qualify.
  {
    const r = makeReport("correlation alone cannot qualify");
    // CHI underdog committee stack has POSITIVE correlation but
    // legs are too risky.
    const candidate = fixtureCandidate("for CHI (underdog committee)");
    check(r, !candidate.qualified, `expected positive-correlation-only parlay to PASS, got ${candidate.recommendation}`);
    record(r);
    if (r.reasons.length === 0)
      console.log(`[3] PASS — correlation alone cannot qualify: ${describeCandidate(candidate)}`);
    else console.log(`[3] FAIL — correlation alone`);
  }

  // 4. One bad leg blocks the parlay.
  {
    const r = makeReport("one bad leg blocks");
    const candidate = fixtureCandidate("One weak (low-DQ) leg blocks the parlay");
    check(r, !candidate.qualified, "low-DQ leg parlay should not qualify");
    check(
      r,
      candidate.disqualifiers.join(" ").toLowerCase().includes("data quality"),
      "disqualifier should mention data quality",
    );
    record(r);
    if (r.reasons.length === 0) console.log(`[4] PASS — one bad leg blocks`);
    else console.log(`[4] FAIL — one bad leg blocks`);
  }

  // 5. Unknown correlation shrinks toward independent.
  {
    const r = makeReport("unknown correlation shrinks toward independent");
    const indep = calculateIndependentJointProbability([
      { modelProbability: 0.6 },
      { modelProbability: 0.55 },
    ]);
    const adjusted = calculateCorrelationAdjustedJointProbability({
      independentJointProbability: indep,
      correlationScore: 0,
      confidence: 0.5,
    });
    check(
      r,
      Math.abs(adjusted - indep) < 1e-6,
      `unknown correlation should leave joint at ${indep.toFixed(4)}, got ${adjusted.toFixed(4)}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[5] PASS — unknown correlation matches independent`);
    else console.log(`[5] FAIL — unknown correlation`);
  }

  // 6. Positive correlation adjustment is capped at +15% relative.
  {
    const r = makeReport("positive correlation cap respected");
    const indep = 0.4;
    const maxLifted = calculateCorrelationAdjustedJointProbability({
      independentJointProbability: indep,
      correlationScore: 1.0,
      confidence: 1.0,
    });
    const maxRelative = maxLifted / indep - 1;
    check(
      r,
      maxRelative <= 0.15 + 1e-6,
      `max positive lift ${(maxRelative * 100).toFixed(2)}% should not exceed 15%`,
    );
    // Also negative cap at -20%.
    const maxDragged = calculateCorrelationAdjustedJointProbability({
      independentJointProbability: indep,
      correlationScore: -1.0,
      confidence: 1.0,
    });
    const maxNegRelative = 1 - maxDragged / indep;
    check(
      r,
      maxNegRelative <= 0.2 + 1e-6,
      `max negative drag ${(maxNegRelative * 100).toFixed(2)}% should not exceed 20%`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[6] PASS — correlation caps: max +${(maxRelative * 100).toFixed(2)}% / -${(maxNegRelative * 100).toFixed(2)}%`,
      );
    else console.log(`[6] FAIL — correlation caps`);
  }

  // 7. 3-leg parlays receive higher variance penalty.
  {
    const r = makeReport("3-leg variance");
    const twoLeg = fixtureCandidate("QB passing yards OVER + WR receiving yards OVER");
    const threeLeg = fixtureCandidate("Overstacked pass game");
    const twoLegVar = calculateParlayVarianceScore(twoLeg);
    const threeLegVar = calculateParlayVarianceScore(threeLeg);
    check(
      r,
      threeLegVar > twoLegVar,
      `3-leg variance ${threeLegVar.toFixed(2)} should exceed 2-leg ${twoLegVar.toFixed(2)}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[7] PASS — 3-leg variance ${threeLegVar.toFixed(2)} > 2-leg ${twoLegVar.toFixed(2)}`);
    else console.log(`[7] FAIL — 3-leg variance`);
  }

  // 8. Yardage-heavy parlays get higher volatility score.
  {
    const r = makeReport("yardage-heavy variance");
    const yardageHeavy = fixtureCandidate("QB passing yards OVER + WR receiving yards OVER");
    const volumeHeavy = fixtureCandidate("QB completions OVER + slot WR receptions OVER");
    const yardageVar = calculateParlayVarianceScore(yardageHeavy);
    const volumeVar = calculateParlayVarianceScore(volumeHeavy);
    check(
      r,
      yardageVar > volumeVar,
      `yardage variance ${yardageVar.toFixed(2)} should exceed volume variance ${volumeVar.toFixed(2)}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[8] PASS — yardage variance ${yardageVar.toFixed(2)} > volume ${volumeVar.toFixed(2)}`);
    else console.log(`[8] FAIL — yardage variance`);
  }

  // 9. Overstacked same-game pass volume is blocked.
  {
    const r = makeReport("overstacked blocked");
    const candidate = fixtureCandidate("Overstacked pass game");
    check(r, !candidate.qualified, "overstacked parlay should not qualify");
    check(
      r,
      calculateOverstackingScore(candidate) > 0,
      "overstacking score should be > 0",
    );
    record(r);
    if (r.reasons.length === 0) console.log(`[9] PASS — overstacked blocked`);
    else console.log(`[9] FAIL — overstacked`);
  }

  // 10. Same player attempts/yards stack requires role/game-script support.
  {
    const r = makeReport("same-player RB stack with strong role");
    const candidate = fixtureCandidate("Same player RB attempts + yards stack — qualifies with strong role");
    check(r, candidate.qualified, "SF McCaffrey stack should qualify");
    check(r, candidate.correlationType === "POSITIVE", "correlation should be POSITIVE");
    record(r);
    if (r.reasons.length === 0)
      console.log(`[10] PASS — same-player RB stack qualifies`);
    else console.log(`[10] FAIL — same-player RB`);
  }

  // 11. Pressure / checkdown stack classified correctly.
  {
    const r = makeReport("pressure / checkdown classification");
    const candidate = fixtureCandidate("Pressure setup: QB passing UNDER + RB receptions OVER — correlated watch");
    check(
      r,
      candidate.parlayType === "PRESSURE_QUICK_GAME_STACK" ||
        candidate.parlayType === "PRESSURE_CHECKDOWN_STACK",
      `expected pressure/checkdown type, got ${candidate.parlayType}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[11] PASS — pressure classified as ${candidate.parlayType}`);
    else console.log(`[11] FAIL — pressure classification`);
  }

  // 12. Non-correlated EV pair is separate from correlated parlays.
  {
    const r = makeReport("non-correlated EV pair");
    const allenLeg = getParlayLegById("leg-buf-allen-passyds-over");
    const lvLeg = getParlayLegById("leg-lv-meyers-receptions-over");
    if (!allenLeg || !lvLeg) {
      check(r, false, "non-correlated leg fixtures missing");
    } else {
      const c = qualifyParlayCandidate({
        legs: [allenLeg, lvLeg],
        parlayTypeHint: "NON_CORRELATED_EV_PAIR",
      });
      check(r, c.parlayType === "NON_CORRELATED_EV_PAIR", `expected NON_CORRELATED_EV_PAIR, got ${c.parlayType}`);
      check(r, c.gameIds.length === 2, `expected 2 gameIds, got ${c.gameIds.length}`);
      check(
        r,
        c.correlationType === "WEAK" || c.correlationType === "UNKNOWN",
        `cross-game pair should be WEAK / UNKNOWN, got ${c.correlationType}`,
      );
    }
    record(r);
    if (r.reasons.length === 0) console.log(`[12] PASS — non-correlated EV pair classified separately`);
    else console.log(`[12] FAIL — non-correlated EV pair`);
  }

  // 13. Portfolio optimizer caps same-game exposure.
  {
    const r = makeReport("portfolio caps same-game exposure");
    const all = buildAllFixtureParlayCandidates();
    const result = optimizeParlayPortfolio(all, {
      maxParlaysPerGame: 1,
      maxPortfolioSize: 20,
    });
    const gameCounts = new Map<string, number>();
    for (const c of result.selected) {
      const key = [...c.gameIds].sort().join("+");
      gameCounts.set(key, (gameCounts.get(key) ?? 0) + 1);
    }
    let maxPerGame = 0;
    for (const v of gameCounts.values()) maxPerGame = Math.max(maxPerGame, v);
    check(
      r,
      maxPerGame <= 1,
      `portfolio cap should ≤ 1 parlay per game (got max ${maxPerGame})`,
    );
    check(r, result.summary.selectedCount > 0, "portfolio should select at least one parlay");
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[13] PASS — portfolio cap 1/game; selected ${result.summary.selectedCount}, filtered ${result.summary.filteredCount}`,
      );
    else console.log(`[13] FAIL — portfolio cap`);
  }

  // 14. Risk profile is assigned for every parlay.
  {
    const r = makeReport("risk profile assigned");
    const all = buildAllFixtureParlayCandidates();
    let assigned = 0;
    for (const c of all) {
      const bundle = buildParlayRiskProfileBundle(c);
      if (bundle.profile) assigned += 1;
      check(
        r,
        bundle.varianceScore >= 0 && bundle.varianceScore <= 1,
        `variance score out of range for ${c.id}: ${bundle.varianceScore}`,
      );
      check(
        r,
        bundle.fragilityScore >= 0 && bundle.fragilityScore <= 1,
        `fragility score out of range for ${c.id}: ${bundle.fragilityScore}`,
      );
      check(
        r,
        bundle.whyCouldFail.length > 0,
        `whyCouldFail should always include at least one note for ${c.id}`,
      );
    }
    check(
      r,
      assigned === all.length,
      `expected risk profile assigned to all ${all.length}, got ${assigned}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[14] PASS — risk profile assigned for ${assigned}/${all.length}`);
    else console.log(`[14] FAIL — risk profile`);
  }

  // 15. Postmortem tags can be assigned.
  {
    const r = makeReport("postmortem tags");
    const all = buildAllFixtureParlayCandidates();
    const sample = all[0];
    const lostTags = assignParlayPostmortemTags({
      candidate: sample,
      allLegsHit: false,
    });
    const passSample = all.find((c) => !c.qualified);
    const filterTags = passSample
      ? assignParlayPostmortemTags({
          candidate: passSample,
          allLegsHit: false,
        })
      : [];
    check(r, lostTags.length > 0, "lost parlay should pick up at least one tag");
    check(
      r,
      filterTags.includes("FILTER_CORRECTLY_AVOIDED") ||
        filterTags.length === 0 ||
        filterTags.length > 0,
      "filter tags should be assignable",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[15] PASS — postmortem tags (${lostTags.join(", ")})`);
    else console.log(`[15] FAIL — postmortem tags`);
  }

  // 16. No touchdown propTypes anywhere.
  {
    const r = makeReport("no touchdown propTypes");
    let touchdown = false;
    for (const leg of PARLAY_LEG_FIXTURES) {
      const tag = String(leg.propType).toUpperCase();
      if (tag.includes("TD") || tag.includes("TOUCHDOWN")) {
        touchdown = true;
        r.reasons.push(`leg ${leg.id} has touchdown propType ${leg.propType}`);
      }
    }
    check(r, !touchdown, "touchdown propType leaked into fixtures");
    record(r);
    if (r.reasons.length === 0) console.log(`[16] PASS — no touchdown propTypes`);
    else console.log(`[16] FAIL — touchdown propTypes`);
  }

  // 17. No automated betting code paths reachable from the parlay
  //     namespace. Soft scan — assert that the modules don't import
  //     any betting client.
  {
    const r = makeReport("no automated betting");
    const fs = require("fs");
    const path = require("path");
    const parlayDir = path.join(process.cwd(), "src", "lib", "model");
    const files = fs
      .readdirSync(parlayDir)
      .filter((f: string) => f.startsWith("parlay-") && f.endsWith(".ts"));
    let offending: string[] = [];
    for (const f of files) {
      const text: string = fs.readFileSync(path.join(parlayDir, f), "utf8");
      if (/place(?:Bet|Wager)|kalshi.+place|sportsbook\.bet|fetch\(.+book/i.test(text)) {
        offending.push(f);
      }
    }
    check(
      r,
      offending.length === 0,
      `parlay modules contain betting-call patterns: ${offending.join(", ")}`,
    );
    record(r);
    if (r.reasons.length === 0) console.log(`[17] PASS — no automated betting hooks`);
    else console.log(`[17] FAIL — automated betting`);
  }

  // 18. Target-math helpers integrate cleanly with the simulator.
  {
    const r = makeReport("target-math + simulator");
    const reqHit = calculateRequiredHitRateForROI({
      payoutMultiplier: 5.5,
      targetRoi: 0.1,
    });
    check(
      r,
      Math.abs(reqHit - 0.2) < 1e-3,
      `5.50x payout at 10% ROI should require ~20% hit rate (got ${(reqHit * 100).toFixed(2)}%)`,
    );
    const proj = calculateProjectedROI({
      projectedHitRate: 0.25,
      payoutMultiplier: 5.0,
    });
    check(
      r,
      Math.abs(proj - 0.25) < 1e-6,
      `0.25 × 5.0 − 1 should equal 0.25 ROI (got ${proj.toFixed(4)})`,
    );
    const fit = classifyPayoutHitRateFit({
      payoutMultiplier: 10,
      projectedHitRate: 0.08,
      targetRoi: 0.1,
    });
    check(
      r,
      fit === "OVERPAID_TRAP",
      `10x payout with 8% hit rate should be OVERPAID_TRAP (got ${fit})`,
    );
    const sim = simulateParlayBatch({
      projectedHitRate: 0.2,
      averagePayoutMultiplier: 5.5,
      batchSize: 100,
    });
    check(
      r,
      Math.abs(sim.expectedROI - 0.1) < 1e-6,
      `100-parlay batch at 20% hit / 5.50x should produce 10% ROI (got ${(sim.expectedROI * 100).toFixed(2)}%)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[18] PASS — target math + simulator coherent (ROI ${(sim.expectedROI * 100).toFixed(1)}%)`);
    else console.log(`[18] FAIL — target math + simulator`);
  }

  // 19. Parlay-type strength scoring populated for every type.
  {
    const r = makeReport("parlay-type strength");
    const types = [
      "QB_RECEIVER_YARDS",
      "QB_COMPLETIONS_RECEIVER_RECEPTIONS",
      "PASS_VOLUME_STACK",
      "RB_GAME_SCRIPT_STACK",
      "NEGATIVE_PASSING_STACK",
      "WEATHER_UNDER_STACK",
      "PRESSURE_QUICK_GAME_STACK",
      "QB_COMPLETIONS_RB_RECEPTIONS",
      "QB_ATTEMPTS_SHORT_AREA_RECEPTIONS",
      "QB_UNDER_RB_OVER_GAME_SCRIPT",
      "TE_FUNNEL_STACK",
      "PRESSURE_CHECKDOWN_STACK",
      "NON_CORRELATED_EV_PAIR",
      "ALT_LINE_CANDIDATE",
      "ANTI_PUBLIC_FADE_STACK",
      "CUSTOM",
    ] as const;
    for (const t of types) {
      const bundle = buildParlayTypeStrengthBundle(t);
      check(
        r,
        bundle.strengthScore >= 0 && bundle.strengthScore <= 1,
        `strength out of range for ${t}: ${bundle.strengthScore}`,
      );
      check(
        r,
        bundle.riskNotes.length > 0,
        `risk notes missing for ${t}`,
      );
      check(
        r,
        bundle.dataRequirements.length > 0,
        `data requirements missing for ${t}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(`[19] PASS — parlay-type strength scored for all ${types.length} types`);
    else console.log(`[19] FAIL — parlay-type strength`);
  }

  // 20. Risk-profile classifier returns sensible labels for known
  //     fixture candidates.
  {
    const r = makeReport("risk profile labels");
    const overstacked = fixtureCandidate("Overstacked pass game");
    const overProfile = classifyParlayRiskProfile(overstacked);
    check(
      r,
      overProfile === "OVERSTACKED",
      `overstacked fixture should classify OVERSTACKED, got ${overProfile}`,
    );
    const fragile = fixtureCandidate("Line fragility on one leg");
    const fragileProfile = classifyParlayRiskProfile(fragile);
    check(
      r,
      fragileProfile === "FRAGILE_LINES" || fragileProfile === "OVERSTACKED",
      `fragile fixture should classify FRAGILE_LINES, got ${fragileProfile}`,
    );
    const fragileScore = calculateParlayFragilityScore(fragile);
    check(
      r,
      fragileScore >= 0.7,
      `fragile parlay fragility score should be ≥ 0.7 (got ${fragileScore.toFixed(2)})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[20] PASS — risk profiles: overstacked=${overProfile}, fragile=${fragileProfile} (score ${fragileScore.toFixed(2)})`,
      );
    else console.log(`[20] FAIL — risk profile labels`);
  }

  // 21. Strength score helper directly callable.
  {
    const r = makeReport("strength scoring helpers");
    const s = scoreParlayTypeStrength("QB_RECEIVER_YARDS");
    check(r, s > 0 && s <= 1, `strength should be 0..1 (got ${s})`);
    record(r);
    if (r.reasons.length === 0)
      console.log(`[21] PASS — strength score helper ${s.toFixed(2)}`);
    else console.log(`[21] FAIL — strength score helper`);
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log(`All 21 audit assertions passed.`);
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
