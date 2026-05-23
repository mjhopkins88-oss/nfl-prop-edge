/**
 * Rookie mispricing analysis — assertions.
 *
 *   · buildRookieMispricingReport produces control + 8 buckets
 *     (4 early × {UNDER, OVER, high-usage, all-rookies},
 *     4 mid × same).
 *   · Each bucket respects its filter: edge ≥ 4%, week ∈ early/mid,
 *     recommendedSide, and (for high-usage) isHighUsageRookie.
 *   · isRookie + isHighUsageRookie flow from the EdgeSliceCandidate.
 *   · The four spec questions are answered:
 *       1. rookieUndersEarlyProfitable
 *       2. rookieOversEarlyUnprofitable
 *       3. draftCapitalMatters (uses snap-share ≥ 0.6 proxy)
 *       4. timingMispricingEvidence
 *   · "promotionCandidate" requires plays ≥ 5, ROI > 0, hit > 55%,
 *     |cal| < control |cal|.
 *   · Formatted output contains "=== ROOKIE MISPRICING ANALYSIS ==="
 *     and surfaces the verbatim "No measurable rookie mispricing
 *     edge in early season" message when no bucket qualifies.
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import {
  buildRookieMispricingReport,
  EARLY_SEASON_WEEKS,
  MID_SEASON_WEEKS,
  HIGH_USAGE_SNAP_SHARE_FLOOR,
} from "../src/lib/backtest/rookie-mispricing-analysis";
import type { EdgeSliceCandidate } from "../src/lib/backtest/edge-slice-diagnostic";

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

function makeCandidate(
  over: Partial<EdgeSliceCandidate> = {},
): EdgeSliceCandidate {
  return {
    week: 1,
    candidateId: "c-0",
    playerName: "Player A",
    propType: "RECEPTIONS",
    edge: 0.05,
    modelProbability: 0.55,
    marketProbability: 0.5,
    confidence: 0.6,
    dataQualityScore: 0.6,
    volatilityScore: 0.5,
    volatilityLevelPresent: true,
    dataQualityScorePresent: true,
    outcome: "WIN",
    profitPerUnit: 0.91,
    productionQualified: false,
    compositeScore: 0.3,
    recommendedSide: "UNDER",
    isRookie: true,
    isHighUsageRookie: false,
    ...over,
  };
}

function main(): void {
  console.log("Rookie mispricing analysis — assertions");
  console.log("========================================");

  // 1. Report shape: control + 8 buckets.
  {
    const r = makeReport("report shape");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 6; i++) {
      cs.push(makeCandidate({ candidateId: `c-${i}` }));
    }
    const out = buildRookieMispricingReport({ candidates: cs });
    check(
      r,
      out.buckets.length === 8,
      `buckets.length=${out.buckets.length}, expected 8`,
    );
    check(
      r,
      out.control.plays === 6,
      `control.plays=${out.control.plays}, expected 6`,
    );
    check(
      r,
      out.draftCapitalProxyApplied === true,
      "draftCapitalProxyApplied should be true (no draft data in ingestion)",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — report shape (control + 8 buckets)");
    else console.log("[1] FAIL — report shape");
  }

  // 2. Time-bucket constants are W1-3 early and W4-8 mid.
  {
    const r = makeReport("time bucket constants");
    check(
      r,
      JSON.stringify(EARLY_SEASON_WEEKS) === JSON.stringify([1, 2, 3]),
      `EARLY_SEASON_WEEKS=${JSON.stringify(EARLY_SEASON_WEEKS)}, expected [1,2,3]`,
    );
    check(
      r,
      JSON.stringify(MID_SEASON_WEEKS) === JSON.stringify([4, 5, 6, 7, 8]),
      `MID_SEASON_WEEKS=${JSON.stringify(MID_SEASON_WEEKS)}, expected [4..8]`,
    );
    check(
      r,
      HIGH_USAGE_SNAP_SHARE_FLOOR === 0.6,
      `HIGH_USAGE_SNAP_SHARE_FLOOR=${HIGH_USAGE_SNAP_SHARE_FLOOR}, expected 0.6`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — time bucket constants");
    else console.log("[2] FAIL — constants");
  }

  // 3. Early UNDERS bucket: only week ≤ 3 + UNDER + rookie +
  //    edge ≥ 4% lands.
  {
    const r = makeReport("All rookies UNDERS EARLY filter");
    const cs: EdgeSliceCandidate[] = [];
    // Match
    cs.push(
      makeCandidate({
        candidateId: "match",
        week: 2,
        recommendedSide: "UNDER",
        edge: 0.05,
      }),
    );
    // Wrong week (mid)
    cs.push(
      makeCandidate({
        candidateId: "wk5",
        week: 5,
        recommendedSide: "UNDER",
        edge: 0.05,
      }),
    );
    // Wrong side (OVER)
    cs.push(
      makeCandidate({
        candidateId: "over",
        week: 2,
        recommendedSide: "OVER",
        edge: 0.05,
      }),
    );
    // Veteran (not a rookie)
    cs.push(
      makeCandidate({
        candidateId: "vet",
        week: 2,
        recommendedSide: "UNDER",
        edge: 0.05,
        isRookie: false,
      }),
    );
    // Below edge floor
    cs.push(
      makeCandidate({
        candidateId: "thin",
        week: 2,
        recommendedSide: "UNDER",
        edge: 0.02,
      }),
    );
    const out = buildRookieMispricingReport({ candidates: cs });
    const allRookiesUndersEarly = out.buckets[2]; // index 2 = bucket 3
    check(
      r,
      allRookiesUndersEarly.name.includes(
        "All rookies · UNDERS · EARLY",
      ),
      `bucket[2].name=${allRookiesUndersEarly.name}`,
    );
    check(
      r,
      allRookiesUndersEarly.plays === 1,
      `bucket[2].plays=${allRookiesUndersEarly.plays}, expected 1`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — UNDERS EARLY filter (all rookies)");
    else console.log("[3] FAIL — UNDERS EARLY filter");
  }

  // 4. High-usage bucket requires isHighUsageRookie=true.
  {
    const r = makeReport("high-usage filter");
    const cs: EdgeSliceCandidate[] = [];
    cs.push(
      makeCandidate({
        candidateId: "high",
        week: 2,
        recommendedSide: "UNDER",
        edge: 0.05,
        isRookie: true,
        isHighUsageRookie: true,
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "all-no-high",
        week: 2,
        recommendedSide: "UNDER",
        edge: 0.05,
        isRookie: true,
        isHighUsageRookie: false,
      }),
    );
    const out = buildRookieMispricingReport({ candidates: cs });
    const hi = out.buckets[0]; // High-usage UNDERS EARLY
    const all = out.buckets[2]; // All rookies UNDERS EARLY
    check(
      r,
      hi.plays === 1,
      `bucket[0].plays=${hi.plays}, expected 1 (only high-usage)`,
    );
    check(
      r,
      all.plays === 2,
      `bucket[2].plays=${all.plays}, expected 2 (both rookies)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — high-usage filter narrower than all-rookies");
    else console.log("[4] FAIL — high-usage filter");
  }

  // 5. MID buckets pick up W4-8.
  {
    const r = makeReport("MID bucket W4-8");
    const cs: EdgeSliceCandidate[] = [];
    cs.push(
      makeCandidate({
        candidateId: "wk4",
        week: 4,
        recommendedSide: "UNDER",
        edge: 0.05,
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "wk2",
        week: 2,
        recommendedSide: "UNDER",
        edge: 0.05,
      }),
    );
    const out = buildRookieMispricingReport({ candidates: cs });
    const allRookiesUndersMid = out.buckets[6];
    check(
      r,
      allRookiesUndersMid.name.includes("All rookies · UNDERS · MID"),
      `bucket[6].name=${allRookiesUndersMid.name}`,
    );
    check(
      r,
      allRookiesUndersMid.plays === 1,
      `MID UNDERS plays=${allRookiesUndersMid.plays}, expected 1 (W4 only)`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — MID bucket W4-8");
    else console.log("[5] FAIL — MID bucket");
  }

  // 6. rookieUndersEarlyProfitable answer when bucket has wins.
  {
    const r = makeReport("rookieUndersEarlyProfitable answer");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 5; i++) {
      cs.push(
        makeCandidate({
          candidateId: `win-${i}`,
          week: 2,
          recommendedSide: "UNDER",
          edge: 0.05,
          outcome: "WIN",
          profitPerUnit: 0.91,
        }),
      );
    }
    const out = buildRookieMispricingReport({ candidates: cs });
    check(
      r,
      out.answers.rookieUndersEarlyProfitable === "yes",
      `answer=${out.answers.rookieUndersEarlyProfitable}, expected yes`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — UNDERS profitable answer reflects bucket ROI");
    else console.log("[6] FAIL — UNDERS profitable answer");
  }

  // 7. "Insufficient data" when too few plays.
  {
    const r = makeReport("insufficient-data answer");
    const cs: EdgeSliceCandidate[] = [];
    // Just 2 plays — below the 3-play floor for "yes/no".
    cs.push(
      makeCandidate({
        candidateId: "p1",
        week: 2,
        recommendedSide: "UNDER",
        edge: 0.05,
      }),
    );
    cs.push(
      makeCandidate({
        candidateId: "p2",
        week: 2,
        recommendedSide: "UNDER",
        edge: 0.05,
      }),
    );
    const out = buildRookieMispricingReport({ candidates: cs });
    check(
      r,
      out.answers.rookieUndersEarlyProfitable === "insufficient-data",
      `answer=${out.answers.rookieUndersEarlyProfitable}, expected insufficient-data`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — insufficient-data when sample too small");
    else console.log("[7] FAIL — insufficient-data threshold");
  }

  // 8. No-edge verdict + verbatim message.
  {
    const r = makeReport("no-edge verdict");
    const cs: EdgeSliceCandidate[] = [];
    for (let i = 0; i < 8; i++) {
      cs.push(
        makeCandidate({
          candidateId: `loss-${i}`,
          week: 2,
          recommendedSide: "UNDER",
          edge: 0.05,
          outcome: "LOSS",
          profitPerUnit: -1,
        }),
      );
    }
    const out = buildRookieMispricingReport({ candidates: cs });
    check(
      r,
      out.answers.promotionCandidate === null,
      "promotionCandidate should be null when nothing qualifies",
    );
    check(
      r,
      out.formatted.includes(
        "No measurable rookie mispricing edge in early season",
      ),
      "formatted must surface the verbatim no-edge message",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — verbatim no-edge message + null promotion");
    else console.log("[8] FAIL — no-edge verdict");
  }

  // 9. Formatted output includes the section header and the
  //    draft-capital-proxy note.
  {
    const r = makeReport("formatted header + proxy note");
    const cs: EdgeSliceCandidate[] = [makeCandidate({ candidateId: "c-0" })];
    const out = buildRookieMispricingReport({ candidates: cs });
    check(
      r,
      out.formatted.includes("=== ROOKIE MISPRICING ANALYSIS ==="),
      "formatted must include section header",
    );
    check(
      r,
      out.formatted.includes("Draft capital not in nflverse"),
      "formatted must call out the draft-capital proxy",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — formatted header + proxy note");
    else console.log("[9] FAIL — formatted header");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("ALL 9 / 9 SCENARIOS PASSED");
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
