/**
 * Week 1 scorecard rejection audit assertions.
 *
 *   · closestToQualifying returns rejected candidates sorted by
 *     qualificationGap (smallest = closest)
 *   · gateGaps parse "<Bucket> score X.XX below Y.YY gate"
 *     strings correctly
 *   · edgeGap parses "Edge of +X% on SIDE below Y% threshold"
 *   · marketContext simulation counts how many candidates would
 *     qualify if ONLY the marketContext gate were lowered to
 *     0.40 / 0.35 — and DOES NOT mutate the live model
 *   · marketContext rawDistribution buckets candidates by the
 *     un-clamped score; clampedDistribution buckets by the
 *     clamped value the scorecard actually saw
 *   · missingHistory split correctly categorizes
 *     teamSwitched / rookieOrUnknown / possibleNameMismatch
 *   · running the audit twice produces the same answer (no
 *     hidden mutation of inputs / candidates / thresholds)
 *   · no banned hooks (Odds API, Kalshi, automated betting, TD)
 *
 * Pure in-process. No spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  applyScorecardToCandidates,
  buildPlayerHistoryByName,
  historyKey,
  rawMarketContextScore,
} from "../src/lib/backtest/stored-candidate-scorecard";
import { buildScorecardAudit } from "../src/lib/backtest/week-1-grading";
import type { RealWeekCandidate } from "../src/lib/backtest/real-week-candidate-builder";
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
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

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
    gameId: "2025-w1",
    playerName: "Player A",
    team: "BUF",
    opponent: "NYJ",
    propType: "RECEPTIONS",
    line: 4.5,
    overOdds: -110,
    underOdds: -110,
    sportsbook: "DRAFTKINGS",
    dataMode: "STORED_2025",
    syntheticFixture: false,
    ...over,
  };
}

function main(): void {
  console.log("Week 1 scorecard rejection audit — assertions");
  console.log("==============================================");

  // 1. closestToQualifying returns rows sorted by gap ascending.
  {
    const r = makeReport("closestToQualifying sorted by gap ascending");
    // Build a mix where each candidate has a clearly different
    // gap. We hand-roll the scorecard so we know the gap math.
    const candidates: RealWeekCandidate[] = [
      makeCandidate({ id: "narrow-miss", playerName: "Narrow Miss" }),
      makeCandidate({ id: "wide-miss", playerName: "Wide Miss" }),
      makeCandidate({ id: "moderate-miss", playerName: "Moderate Miss" }),
    ];
    // Stub scorecards: same prop, varying single-bucket failure.
    candidates[0].scorecard = {
      ...makeStubScorecard(),
      qualified: false,
      disqualifiers: ["Data quality score 0.53 below 0.55 gate"],
      primaryDisqualifier: "Data quality score 0.53 below 0.55 gate",
      dataQualityScore: 0.53,
    };
    candidates[1].scorecard = {
      ...makeStubScorecard(),
      qualified: false,
      disqualifiers: ["Data quality score 0.30 below 0.55 gate"],
      primaryDisqualifier: "Data quality score 0.30 below 0.55 gate",
      dataQualityScore: 0.3,
    };
    candidates[2].scorecard = {
      ...makeStubScorecard(),
      qualified: false,
      disqualifiers: ["Data quality score 0.45 below 0.55 gate"],
      primaryDisqualifier: "Data quality score 0.45 below 0.55 gate",
      dataQualityScore: 0.45,
    };
    const audit = buildScorecardAudit({ candidates });
    const closest = audit.closestToQualifying ?? [];
    check(r, closest.length === 3, `closest.length=${closest.length}`);
    check(
      r,
      closest[0].candidateId === "narrow-miss",
      `first should be narrow-miss, got ${closest[0].candidateId}`,
    );
    check(
      r,
      closest[1].candidateId === "moderate-miss",
      `second should be moderate-miss, got ${closest[1].candidateId}`,
    );
    check(
      r,
      closest[2].candidateId === "wide-miss",
      `third should be wide-miss, got ${closest[2].candidateId}`,
    );
    // Gap values: 0.02, 0.10, 0.25.
    check(
      r,
      Math.abs(closest[0].qualificationGap - 0.02) < 1e-9,
      `narrow gap=${closest[0].qualificationGap}, expected 0.02`,
    );
    check(
      r,
      Math.abs(closest[2].qualificationGap - 0.25) < 1e-9,
      `wide gap=${closest[2].qualificationGap}, expected 0.25`,
    );
    // Each row carries the disqualifier list + bucket gap.
    check(
      r,
      closest[0].gateGaps.length === 1,
      `gateGaps=${closest[0].gateGaps.length}`,
    );
    check(
      r,
      closest[0].gateGaps[0].bucket === "dataQuality",
      `bucket=${closest[0].gateGaps[0].bucket}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — closestToQualifying sorts ascending by gap");
    else console.log("[1] FAIL — closest sort");
  }

  // 2. edgeGap parses "Edge of +X% on SIDE below Y% threshold".
  {
    const r = makeReport("edgeGap parses correctly");
    const candidate = makeCandidate({ id: "edge-miss" });
    candidate.scorecard = {
      ...makeStubScorecard(),
      qualified: false,
      disqualifiers: ["Edge of +3.0% on OVER below 5.0% threshold"],
      primaryDisqualifier: "Edge of +3.0% on OVER below 5.0% threshold",
      edge: 0.03,
      edgeThreshold: 0.05,
    };
    const audit = buildScorecardAudit({ candidates: [candidate] });
    const closest = audit.closestToQualifying ?? [];
    check(r, closest.length === 1, `length=${closest.length}`);
    check(
      r,
      closest[0].edgeGap !== null && Math.abs(closest[0].edgeGap - 0.02) < 1e-9,
      `edgeGap=${closest[0].edgeGap}, expected 0.02`,
    );
    check(
      r,
      closest[0].gateGaps.length === 0,
      `no gateGaps for edge-only failure (got ${closest[0].gateGaps.length})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — edgeGap parsed from threshold string");
    else console.log("[2] FAIL — edge parsing");
  }

  // 3. marketContext simulation: candidates that fail ONLY on
  //    marketContext should be counted as qualifying at the
  //    lowered gate when raw score meets it.
  {
    const r = makeReport("marketContext simulation counts correctly");
    const candidates: RealWeekCandidate[] = [
      // Candidate 1: fails only on marketContext, raw score
      // ~0.43 at -112/-112 (passes gate 0.40 but not 0.45).
      (() => {
        const c = makeCandidate({
          id: "mc-only-042",
          playerName: "MC Only 042",
          overOdds: -112,
          underOdds: -112,
        });
        c.scorecard = {
          ...makeStubScorecard(),
          qualified: false,
          disqualifiers: ["Market context score 0.43 below 0.45 gate"],
          primaryDisqualifier: "Market context score 0.43 below 0.45 gate",
          marketContextScore: 0.43,
        };
        return c;
      })(),
      // Candidate 2: fails on marketContext AND another gate.
      (() => {
        const c = makeCandidate({
          id: "mc-and-other",
          playerName: "MC+Other",
          overOdds: -120,
          underOdds: -120,
        });
        c.scorecard = {
          ...makeStubScorecard(),
          qualified: false,
          disqualifiers: [
            "Market context score 0.40 below 0.45 gate",
            "Data quality score 0.40 below 0.55 gate",
          ],
          primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
          marketContextScore: 0.4,
          dataQualityScore: 0.4,
        };
        return c;
      })(),
      // Candidate 3: already qualified — should count at every
      // simulated gate.
      (() => {
        const c = makeCandidate({ id: "qualified-1" });
        c.scorecard = {
          ...makeStubScorecard(),
          qualified: true,
          disqualifiers: [],
          primaryDisqualifier: undefined,
        };
        return c;
      })(),
    ];
    const audit = buildScorecardAudit({ candidates });
    const mc = audit.marketContext;
    check(r, mc !== undefined, "marketContext audit must be present");
    if (mc) {
      // Already-qualified candidate is in every count.
      check(
        r,
        mc.simulation.qualifyingAtGate045 === 1,
        `qualifyingAtGate045=${mc.simulation.qualifyingAtGate045}, expected 1 (already-qualified only)`,
      );
      // At gate 0.40: Candidate 1 qualifies (only-marketContext
      // failure, raw score for -114/-114 is ≈0.42 ≥ 0.40).
      // Candidate 2 still fails on dataQuality. Candidate 3
      // already qualified.
      check(
        r,
        mc.simulation.qualifyingAtGate040 === 2,
        `qualifyingAtGate040=${mc.simulation.qualifyingAtGate040}, expected 2 (mc-only-042 + already-qualified)`,
      );
      check(
        r,
        mc.simulation.qualifyingAtGate035 === 2,
        `qualifyingAtGate035=${mc.simulation.qualifyingAtGate035}, expected 2`,
      );
      check(
        r,
        mc.gateThreshold === 0.45,
        `gateThreshold=${mc.gateThreshold}, expected 0.45 (unchanged)`,
      );
      check(
        r,
        mc.clampFloor === 0.4,
        `clampFloor=${mc.clampFloor}, expected 0.40`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — marketContext simulation counts gate-lowering effects");
    else console.log("[3] FAIL — marketContext simulation");
  }

  // 4. marketContext simulation does NOT mutate the live model:
  //    the candidates' scorecards must be byte-identical after
  //    the audit runs.
  {
    const r = makeReport("marketContext simulation does not mutate inputs");
    const c = makeCandidate({ id: "stable" });
    c.scorecard = {
      ...makeStubScorecard(),
      qualified: false,
      disqualifiers: ["Market context score 0.40 below 0.45 gate"],
      primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
      marketContextScore: 0.4,
    };
    const before = JSON.stringify(c.scorecard);
    buildScorecardAudit({ candidates: [c] });
    const after = JSON.stringify(c.scorecard);
    check(r, before === after, "scorecard mutated by audit");
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — audit does not mutate candidate scorecards");
    else console.log("[4] FAIL — input mutation");
  }

  // 5. marketContext rawDistribution buckets the raw score
  //    correctly across canonical odds pairs.
  {
    const r = makeReport("rawDistribution buckets canonical odds");
    const candidates: RealWeekCandidate[] = [
      // -110/-110 → overround 1.048 → raw 0.524 → ≥0.45 bucket
      makeCandidate({ id: "tight", overOdds: -110, underOdds: -110 }),
      // -115/-115 → overround 1.070 → raw 0.302 → 0.20–0.35
      makeCandidate({ id: "med1", overOdds: -115, underOdds: -115 }),
      // -120/-120 → overround 1.0909 → raw 0.091 → 0.00–0.20
      makeCandidate({ id: "wide1", overOdds: -120, underOdds: -120 }),
      // -150/-150 → overround 1.20 → raw -1 → lt000
      makeCandidate({ id: "vwide", overOdds: -150, underOdds: -150 }),
    ];
    for (const c of candidates) {
      c.scorecard = {
        ...makeStubScorecard(),
        qualified: false,
        disqualifiers: ["Market context score 0.40 below 0.45 gate"],
        primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
        marketContextScore: Math.max(rawMarketContextScore(c), 0.4),
      };
    }
    const audit = buildScorecardAudit({ candidates });
    const dist = audit.marketContext?.rawDistribution;
    check(r, dist !== undefined, "rawDistribution must be present");
    if (dist) {
      check(r, dist.gte045 === 1, `gte045=${dist.gte045}, expected 1`);
      check(
        r,
        dist.band020To035 === 1,
        `band020To035=${dist.band020To035}, expected 1`,
      );
      check(
        r,
        dist.band000To020 === 1,
        `band000To020=${dist.band000To020}, expected 1`,
      );
      check(r, dist.lt000 === 1, `lt000=${dist.lt000}, expected 1`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — rawDistribution buckets canonical odds");
    else console.log("[5] FAIL — raw bucketing");
  }

  // 6. missingHistory split correctly categorizes the three
  //    causes given the full player_week_stats reference.
  {
    const r = makeReport("missingHistory categorizes three causes");
    const candidates: RealWeekCandidate[] = [
      // Team-switched: name appears in stats under TB, candidate
      // is at GB.
      makeCandidate({
        id: "switched",
        playerName: "Switched WR",
        team: "GB",
      }),
      // Rookie: name does not appear anywhere.
      makeCandidate({
        id: "rookie",
        playerName: "Rookie WR",
        team: "BUF",
      }),
      // Name mismatch: suffix-only difference (II vs no suffix).
      makeCandidate({
        id: "mismatch",
        playerName: "Patrick Mahomes II",
        team: "KC",
      }),
    ];
    // Apply stub scorecards so the audit treats them as
    // rejected candidates (the join itself drives history).
    for (const c of candidates) {
      c.scorecard = {
        ...makeStubScorecard(),
        qualified: false,
        disqualifiers: ["Data quality score 0.40 below 0.55 gate"],
        primaryDisqualifier: "Data quality score 0.40 below 0.55 gate",
      };
    }
    const playerWeekStats: NflPlayerWeekStat[] = [
      statRow({ playerName: "Switched WR", team: "TB" }),
      statRow({ playerName: "Patrick Mahomes", team: "KC" }),
    ];
    // playerHistoryByName: build with the (playerName, team)
    // key — none of these candidates will hit because each
    // either has no row, or the row is under the wrong team.
    const playerHistoryByName = buildPlayerHistoryByName({
      candidates,
      season: 2025,
      week: 1,
      playerWeekStats,
    });
    const audit = buildScorecardAudit({
      candidates,
      playerHistoryByName,
      playerWeekStats,
    });
    const mh = audit.missingHistory;
    check(r, mh !== undefined, "missingHistory must be present when stats supplied");
    if (mh) {
      check(r, mh.teamSwitched === 1, `teamSwitched=${mh.teamSwitched}, expected 1`);
      check(
        r,
        mh.rookieOrUnknown === 1,
        `rookieOrUnknown=${mh.rookieOrUnknown}, expected 1`,
      );
      check(
        r,
        mh.possibleNameMismatch === 1,
        `possibleNameMismatch=${mh.possibleNameMismatch}, expected 1`,
      );
      check(
        r,
        mh.totalMissing === 3,
        `totalMissing=${mh.totalMissing}, expected 3`,
      );
      // Example rows surface the matched team/name for fixable
      // cases.
      const switchedEx = mh.examples.find((e) => e.candidateId === "switched");
      check(
        r,
        switchedEx !== undefined && switchedEx.cause === "teamSwitched",
        `switched cause=${switchedEx?.cause}`,
      );
      const mismatchEx = mh.examples.find((e) => e.candidateId === "mismatch");
      check(
        r,
        mismatchEx !== undefined && mismatchEx.cause === "possibleNameMismatch",
        `mismatch cause=${mismatchEx?.cause}`,
      );
      check(
        r,
        mismatchEx?.matchedName === "Patrick Mahomes",
        `mismatch matchedName=${mismatchEx?.matchedName}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — missingHistory split categorizes three causes");
    else console.log("[6] FAIL — missingHistory categorization");
  }

  // 7. Running the audit twice produces the same answer (no
  //    hidden state, no threshold changes between calls).
  {
    const r = makeReport("audit is deterministic across calls");
    const candidate = makeCandidate({ id: "stable" });
    candidate.scorecard = {
      ...makeStubScorecard(),
      qualified: false,
      disqualifiers: ["Market context score 0.40 below 0.45 gate"],
      primaryDisqualifier: "Market context score 0.40 below 0.45 gate",
    };
    const a1 = buildScorecardAudit({ candidates: [candidate] });
    const a2 = buildScorecardAudit({ candidates: [candidate] });
    check(
      r,
      JSON.stringify(a1) === JSON.stringify(a2),
      "audit output diverges between runs",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — audit is deterministic");
    else console.log("[7] FAIL — non-determinism");
  }

  // 8. Sanity: the model's qualification path is unchanged.
  //    Run the SAME veteran candidate from the existing
  //    diagnostics test through the adapter — they should still
  //    qualify with the current thresholds.
  {
    const r = makeReport("threshold unchanged — veteran still qualifies");
    const candidate = makeCandidate({
      id: "vet",
      playerName: "Veteran WR",
      propType: "RECEPTIONS",
      line: 4.5,
    });
    const history = new Map([
      [
        historyKey("Veteran WR", "BUF"),
        [
          statRow({ playerName: "Veteran WR", team: "BUF", season: 2024, week: 14, receptions: 7 }),
          statRow({ playerName: "Veteran WR", team: "BUF", season: 2024, week: 15, receptions: 8 }),
          statRow({ playerName: "Veteran WR", team: "BUF", season: 2024, week: 16, receptions: 7 }),
          statRow({ playerName: "Veteran WR", team: "BUF", season: 2024, week: 17, receptions: 6 }),
          statRow({ playerName: "Veteran WR", team: "BUF", season: 2024, week: 18, receptions: 8 }),
        ],
      ],
    ]);
    const evaluated = applyScorecardToCandidates({
      candidates: [candidate],
      playerHistoryByName: history,
    });
    check(
      r,
      evaluated[0].scorecard?.qualified === true,
      `veteran no longer qualifies — threshold change leaked? qualified=${evaluated[0].scorecard?.qualified}`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — veteran still qualifies, no threshold drift");
    else console.log("[8] FAIL — threshold drift");
  }

  // 9. No banned hooks in the audit module or the admin runner
  //    surface code touched by this commit.
  {
    const r = makeReport("no banned hooks in audit surface");
    const files = [
      "src/lib/backtest/week-1-grading.ts",
      "src/lib/backtest/stored-candidate-scorecard.ts",
      "src/lib/admin/admin-runner.ts",
    ];
    for (const f of files) {
      const text = readSrc(f);
      for (const re of [
        /the-odds-api/i,
        /odds-api\.com/i,
        /placeBet|placeWager/,
        /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
        /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
      ]) {
        check(r, !re.test(text), `${f} contains banned pattern ${re}`);
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — no banned hooks");
    else console.log("[9] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 9 week-1-scorecard-rejection-audit assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

function makeStubScorecard(): NonNullable<RealWeekCandidate["scorecard"]> {
  return {
    recommendation: "PASS",
    selectedSide: "OVER",
    qualified: false,
    modelOverProbability: 0.5,
    modelUnderProbability: 0.5,
    modelProbability: 0.5,
    marketOverProbability: 0.5,
    marketUnderProbability: 0.5,
    noVigOverProbability: 0.5,
    noVigUnderProbability: 0.5,
    edgeOver: 0,
    edgeUnder: 0,
    edge: 0,
    edgeThreshold: 0.04,
    confidence: 0.4,
    riskScore: 0.5,
    dataQualityScore: 0.6,
    roleStabilityScore: 0.6,
    gameScriptScore: 0.6,
    paceScore: 0.6,
    marketContextScore: 0.6,
    weatherEnvironmentScore: 0.85,
    injuryContextScore: 0.85,
    correlationExposureScore: 0.8,
    volatilityLevel: "medium",
    primaryDisqualifier: undefined,
    disqualifiers: [],
    passReasons: [],
    failReasons: [],
    projectedMean: 0,
    projectedStdDev: 0,
  };
}

main();
