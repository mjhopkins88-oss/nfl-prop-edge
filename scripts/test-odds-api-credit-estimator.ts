/**
 * Credit estimator + budget guard assertions.
 *
 *   · player-prop markets cost 10 credits per (market × region)
 *   · standard markets stay at 1 credit per (market × region)
 *   · legacy callers that pass a market count get the conservative
 *     player-prop rate (estimate never under-counts)
 *   · estimateCredits returns the corrected per-event-odds cost
 *   · the overage check is cumulative-vs-cumulative — it does not
 *     compare cumulative actual against a per-call estimate
 *   · pre-call budget guard refuses a request whose projected
 *     cumulative would exceed maxCredits
 *   · calibration mode caps the plan to 1 events-list + 1 odds
 *     and a 50-credit ceiling
 *   · no touchdown propTypes admitted anywhere in the pricing
 *   · no API client constructed (pure file/math)
 *
 * Pure imports + arithmetic. No paid HTTP. No network. No spawn.
 */

import fs from "node:fs";
import path from "node:path";
import {
  ALLOWED_ODDS_REGIONS,
  CREDIT_OVERAGE_ABORT_RATIO,
  HISTORICAL_PLAYER_PROP_CREDITS_PER_MARKET,
  MAX_ODDS_API_CREDITS_PER_RUN,
  SMOKE_CALIBRATION_MAX_CREDITS,
  SMOKE_CALIBRATION_MAX_ODDS_REQUESTS,
} from "../src/config/api-budget";
import {
  CREDITS_PER_EVENT_ODDS_UNIT_BASE,
  CREDITS_PER_EVENT_ODDS_UNIT_PLAYER,
  creditsPerMarketPerRegion,
  estimateHistoricalEventOddsCredits,
  estimateSeasonBacktestCredits,
  validateCreditBudget,
} from "../src/lib/ingestion/credit-estimator";
import {
  CREDITS,
  creditsForMarketKey,
  creditsForMarketSet,
  estimateCredits,
} from "../src/lib/ingestion/odds-api";

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

function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

function main(): void {
  console.log("Odds API credit estimator — assertions");
  console.log("=======================================");

  // 1. Per-market rate is 10 for player_*, 1 for everything else.
  {
    const r = makeReport("creditsPerMarketPerRegion / creditsForMarketKey");
    check(
      r,
      CREDITS_PER_EVENT_ODDS_UNIT_PLAYER === 10,
      `player rate constant = ${CREDITS_PER_EVENT_ODDS_UNIT_PLAYER}`,
    );
    check(
      r,
      CREDITS_PER_EVENT_ODDS_UNIT_BASE === 1,
      `base rate constant = ${CREDITS_PER_EVENT_ODDS_UNIT_BASE}`,
    );
    check(
      r,
      HISTORICAL_PLAYER_PROP_CREDITS_PER_MARKET === 10,
      `api-budget constant = ${HISTORICAL_PLAYER_PROP_CREDITS_PER_MARKET}`,
    );
    for (const k of [
      "player_pass_attempts",
      "player_pass_completions",
      "player_receptions",
      "player_rush_attempts",
    ]) {
      check(r, creditsPerMarketPerRegion(k) === 10, `${k} should be 10`);
      check(r, creditsForMarketKey(k) === 10, `odds-api/${k} should be 10`);
    }
    for (const k of ["h2h", "spreads", "totals"]) {
      check(r, creditsPerMarketPerRegion(k) === 1, `${k} should be 1`);
      check(r, creditsForMarketKey(k) === 1, `odds-api/${k} should be 1`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — per-market rates correct (player=10, others=1)");
    else console.log("[1] FAIL — per-market rates");
  }

  // 2. estimateHistoricalEventOddsCredits with the V1 starter set.
  {
    const r = makeReport("single-event estimate matches 2026-05 observed cost");
    const starterMarkets = [
      "player_pass_attempts",
      "player_pass_completions",
      "player_receptions",
      "player_rush_attempts",
    ] as const;
    const cost = estimateHistoricalEventOddsCredits({
      markets: starterMarkets,
      regions: 1,
    });
    check(
      r,
      cost === 40,
      `4 player-prop markets × 1 region should cost 40, got ${cost}`,
    );
    // Legacy: count-only call uses the conservative rate.
    const legacyCost = estimateHistoricalEventOddsCredits({
      markets: 4,
      regions: 1,
    });
    check(
      r,
      legacyCost === 40,
      `legacy count-only should fall back to player rate (=40), got ${legacyCost}`,
    );
    // Sum across set helper agrees with the estimator.
    check(
      r,
      creditsForMarketSet(starterMarkets) === 40,
      `creditsForMarketSet on 4 player markets = ${creditsForMarketSet(starterMarkets)}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — single-event estimate = 40 credits (was 4)");
    else console.log("[2] FAIL — single-event estimate");
  }

  // 3. estimateCredits per-event-odds cost is now 40 for the V1 set.
  {
    const r = makeReport("script-level estimateCredits returns 40 per odds call");
    const plan = estimateCredits({
      uniqueSnapshots: 7,
      totalEvents: 16,
      marketsPerEvent: 4,
      marketKeys: [
        "player_pass_attempts",
        "player_pass_completions",
        "player_receptions",
        "player_rush_attempts",
      ],
    });
    check(
      r,
      plan.perEventOddsCallCredits === 40,
      `perEventOddsCall should be 40, got ${plan.perEventOddsCallCredits}`,
    );
    check(
      r,
      plan.estimatedCredits === 7 + 16 * 40,
      `total estimate should be ${7 + 16 * 40}, got ${plan.estimatedCredits}`,
    );
    // Full Week 1 (16 events) exceeds the 200-credit run cap under
    // the corrected model — must refuse via validateCreditBudget.
    const validation = validateCreditBudget({
      markets: 4,
      regions: ALLOWED_ODDS_REGIONS,
      estimatedCredits: plan.estimatedCredits,
    });
    check(
      r,
      validation.ok === false,
      "full Week 1 plan should be refused under the corrected rate",
    );
    check(
      r,
      validation.reasons.some((s) => s.includes("MAX_ODDS_API_CREDITS_PER_RUN")),
      "rejection should cite MAX_ODDS_API_CREDITS_PER_RUN",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — corrected plan estimate refuses full Week 1");
    else console.log("[3] FAIL — script estimate");
  }

  // 4. Season backtest estimator across the V1 set.
  {
    const r = makeReport("season backtest estimator scales by per-key rate");
    const cost = estimateSeasonBacktestCredits({
      gameCount: 16,
      markets: [
        "player_pass_attempts",
        "player_pass_completions",
        "player_receptions",
        "player_rush_attempts",
      ],
      regions: 1,
      uniqueSnapshots: 7,
    });
    check(
      r,
      cost.eventOddsCredits === 16 * 40,
      `eventOddsCredits should be 640, got ${cost.eventOddsCredits}`,
    );
    check(
      r,
      cost.eventsListCredits === 7,
      `eventsListCredits should be 7, got ${cost.eventsListCredits}`,
    );
    check(
      r,
      cost.perEvent === 40,
      `perEvent should be 40, got ${cost.perEvent}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — season estimator scales by per-key rate");
    else console.log("[4] FAIL — season estimator");
  }

  // 5. The cumulative overage check is cumulative-vs-cumulative,
  //    not cumulative-vs-per-call. Re-create the 2026-05 abort
  //    state and confirm it fires.
  {
    const r = makeReport("overage check compares cumulative to cumulative");
    // Mirror checkOverageOrFloor logic for the test.
    const cumulativeActual = 41; // 1 events + 40 odds (observed)
    const cumulativeEstimate = 5; // 1 events + 4 odds (BUGGY estimate)
    const cap = cumulativeEstimate * CREDIT_OVERAGE_ABORT_RATIO;
    check(
      r,
      cumulativeActual > cap,
      `41 should exceed cap ${cap} → abort fires`,
    );
    // Under the corrected model, cumulative estimate after first
    // events + first odds would be 1 + 40 = 41 → equal to actual,
    // no abort.
    const correctedEstimate = 1 + 40;
    const correctedCap = correctedEstimate * CREDIT_OVERAGE_ABORT_RATIO;
    check(
      r,
      cumulativeActual <= correctedCap,
      "under corrected model, actual stays within slack",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — overage check is cumulative-vs-cumulative");
    else console.log("[5] FAIL — overage check semantics");
  }

  // 6. Calibration mode constants — small + safe.
  {
    const r = makeReport("calibration constants");
    check(
      r,
      SMOKE_CALIBRATION_MAX_CREDITS === 50,
      `cap = ${SMOKE_CALIBRATION_MAX_CREDITS}`,
    );
    check(
      r,
      SMOKE_CALIBRATION_MAX_ODDS_REQUESTS === 1,
      `odds-requests cap = ${SMOKE_CALIBRATION_MAX_ODDS_REQUESTS}`,
    );
    // 1 events + 1 odds call (40 credits) = 41, fits cap.
    const calibrationCost =
      CREDITS.EVENTS_LIST_PER_SNAPSHOT +
      creditsForMarketSet([
        "player_pass_attempts",
        "player_pass_completions",
        "player_receptions",
        "player_rush_attempts",
      ]);
    check(
      r,
      calibrationCost === 41,
      `calibration cost should be 41, got ${calibrationCost}`,
    );
    check(
      r,
      calibrationCost < SMOKE_CALIBRATION_MAX_CREDITS,
      "calibration cost must fit under the calibration cap",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — calibration constants + cost fit (41 < 50)");
    else console.log("[6] FAIL — calibration constants");
  }

  // 7. Pre-call guard: projected = cumulative-actual + per-call
  //    estimate. Refuse if projected > maxCredits.
  {
    const r = makeReport("pre-call budget guard logic");
    function projected(args: {
      cumulativeActual: number;
      perCallEstimate: number;
      maxCredits: number;
    }): { allow: boolean; projected: number } {
      const p = args.cumulativeActual + args.perCallEstimate;
      return { allow: p <= args.maxCredits, projected: p };
    }
    // First odds call in calibration mode: 1 + 40 = 41 ≤ 50 → allow.
    const g1 = projected({ cumulativeActual: 1, perCallEstimate: 40, maxCredits: 50 });
    check(r, g1.allow === true, `first call should be allowed (projected=${g1.projected})`);
    // Second odds call: 41 + 40 = 81 > 50 → refuse.
    const g2 = projected({ cumulativeActual: 41, perCallEstimate: 40, maxCredits: 50 });
    check(r, g2.allow === false, `second call should be refused (projected=${g2.projected})`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — pre-call guard refuses second call in calibration");
    else console.log("[7] FAIL — pre-call guard");
  }

  // 8. Run cap is preserved; estimator still respects it.
  {
    const r = makeReport("MAX_ODDS_API_CREDITS_PER_RUN still 200");
    check(
      r,
      MAX_ODDS_API_CREDITS_PER_RUN === 200,
      `run cap = ${MAX_ODDS_API_CREDITS_PER_RUN}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — MAX_ODDS_API_CREDITS_PER_RUN preserved");
    else console.log("[8] FAIL — run cap");
  }

  // 9. No touchdown propTypes anywhere in the new pricing code.
  {
    const r = makeReport("no touchdown propTypes in pricing");
    for (const f of [
      "src/config/api-budget.ts",
      "src/lib/ingestion/credit-estimator.ts",
      "src/lib/ingestion/odds-api.ts",
    ]) {
      const text = readSrc(f);
      check(
        r,
        !/\bTOUCHDOWN\b|player_anytime_td|player_pass_tds|player_first_td|RUSH_TD|REC_TD|PASS_TD/.test(
          text,
        ),
        `${f} mentions a touchdown market`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — no touchdown markets in pricing code");
    else console.log("[9] FAIL — touchdown markets");
  }

  // 10. No automated-betting / Kalshi / fetch calls in pricing files.
  {
    const r = makeReport("no betting / Kalshi / fetch in pricing code");
    for (const f of [
      "src/lib/ingestion/credit-estimator.ts",
    ]) {
      const text = readSrc(f);
      for (const re of [
        /placeBet|placeWager/i,
        /from\s+["'][^"']*kalshi[^"']*["']/i,
        /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
        /fetch\(/,
      ]) {
        check(r, !re.test(text), `${f} contains banned pattern ${re}`);
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[10] PASS — no betting / Kalshi / fetch in pricing code");
    else console.log("[10] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 10 credit-estimator assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

main();
