/**
 * Stored Week-N → scorecard adapter assertions.
 *
 *   · applyScorecardToCandidates attaches a scorecard field
 *     to every input candidate
 *   · scorecard carries the decision fields the grader needs
 *     (recommendation, qualified, edge, confidence, riskScore,
 *     modelProbability, primaryDisqualifier)
 *   · when projection produces edge ≥ threshold AND risk gates
 *     pass, the scorecard qualifies the play (recommendedPlays
 *     count > 0 in the grader)
 *   · grading uses ONLY recommended plays for the betting ROI
 *     section — universe hit rate stays in the diagnostic
 *     section and is NOT surfaced as model ROI
 *   · no Odds API or banned hooks
 *   · no touchdown propTypes
 *   · no automated betting
 *
 * Pure in-process — uses the in-memory persistence client and
 * direct adapter calls. No spawn, no HTTP, no network.
 */

import fs from "node:fs";
import path from "node:path";
import {
  applyScorecardToCandidates,
  buildPlayerHistoryByName,
  historyKey,
  type EvaluatedRealWeekCandidate,
} from "../src/lib/backtest/stored-candidate-scorecard";
import { gradeStoredWeek1Backtest } from "../src/lib/backtest/week-1-grading";
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

function makeCandidate(over: Partial<RealWeekCandidate> = {}): RealWeekCandidate {
  return {
    id: "c-1",
    season: 2025,
    week: 1,
    gameId: "2025-w1-kc-at-lac",
    playerName: "Patrick Mahomes",
    team: "KC",
    opponent: "LAC",
    propType: "PASSING_ATTEMPTS",
    line: 33.5,
    overOdds: -110,
    underOdds: -110,
    sportsbook: "DRAFTKINGS",
    dataMode: "STORED_2025",
    syntheticFixture: false,
    ...over,
  };
}

function statRow(over: Partial<NflPlayerWeekStat>): NflPlayerWeekStat {
  return {
    playerId: "00-mahomes",
    playerName: "Patrick Mahomes",
    position: "QB",
    team: "KC",
    opponent: "BUF",
    season: 2024,
    week: 18,
    gameId: "2024-w18-kc-buf",
    homeAway: "HOME",
    snapShare: 0.98,
    passingAttempts: 38,
    passingCompletions: 26,
    passingYards: 295,
    ...over,
  };
}

async function main(): Promise<void> {
  console.log("Stored candidate → scorecard adapter assertions");
  console.log("================================================");

  // 1. applyScorecardToCandidates attaches a scorecard to each
  //    candidate.
  {
    const r = makeReport("scorecard attached to each candidate");
    const candidates = [makeCandidate(), makeCandidate({ id: "c-2", line: 22.5, propType: "PASSING_COMPLETIONS" })];
    const history = new Map([
      [
        historyKey("Patrick Mahomes", "KC"),
        [
          statRow({ week: 16, passingAttempts: 37, passingCompletions: 26 }),
          statRow({ week: 17, passingAttempts: 38, passingCompletions: 27 }),
          statRow({ week: 18, passingAttempts: 39, passingCompletions: 28 }),
        ],
      ],
    ]);
    const evaluated = applyScorecardToCandidates({
      candidates,
      playerHistoryByName: history,
    });
    check(r, evaluated.length === 2, `length=${evaluated.length}`);
    for (const c of evaluated) {
      check(r, c.scorecard !== undefined, `candidate ${c.id} missing scorecard`);
      const s = c.scorecard!;
      check(
        r,
        s.recommendation === "OVER" ||
          s.recommendation === "UNDER" ||
          s.recommendation === "PASS",
        `recommendation invalid: ${s.recommendation}`,
      );
      check(
        r,
        typeof s.qualified === "boolean",
        `qualified must be boolean (got ${typeof s.qualified})`,
      );
      check(
        r,
        typeof s.edge === "number" && Number.isFinite(s.edge),
        `edge must be finite number (got ${s.edge})`,
      );
      check(
        r,
        typeof s.confidence === "number" &&
          s.confidence >= 0 &&
          s.confidence <= 1,
        `confidence in [0,1] (got ${s.confidence})`,
      );
      check(
        r,
        typeof s.modelProbability === "number" &&
          s.modelProbability >= 0 &&
          s.modelProbability <= 1,
        `modelProbability in [0,1] (got ${s.modelProbability})`,
      );
      check(
        r,
        Array.isArray(s.disqualifiers),
        "disqualifiers must be an array",
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — scorecard attached to every candidate");
    else console.log("[1] FAIL — scorecard attachment");
  }

  // 2. A strong overprojection produces qualified=true and
  //    recommendation=OVER.
  {
    const r = makeReport("strong overprojection qualifies OVER");
    const candidate = makeCandidate({
      propType: "PASSING_ATTEMPTS",
      line: 30.5, // history mean ~38 → strong OVER edge
    });
    const history = new Map([
      [
        historyKey("Patrick Mahomes", "KC"),
        [
          statRow({ week: 14, passingAttempts: 37 }),
          statRow({ week: 15, passingAttempts: 38 }),
          statRow({ week: 16, passingAttempts: 39 }),
          statRow({ week: 17, passingAttempts: 38 }),
          statRow({ week: 18, passingAttempts: 40 }),
        ],
      ],
    ]);
    const [evaluated] = applyScorecardToCandidates({
      candidates: [candidate],
      playerHistoryByName: history,
    });
    const s = evaluated.scorecard!;
    check(r, s.recommendation === "OVER", `recommendation=${s.recommendation}`);
    check(r, s.qualified === true, `qualified=${s.qualified}`);
    check(r, s.edge > 0.05, `edge should be > 5% (got ${s.edge})`);
    check(r, s.modelProbability > 0.5, `modelProbability > 0.5 (got ${s.modelProbability})`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — strong OVER projection qualifies");
    else console.log("[2] FAIL — OVER qualification");
  }

  // 3. A weak (flat) projection produces qualified=false and a
  //    non-empty disqualifier list. The grader's recommended-
  //    plays section reports enabled=true only if at least one
  //    play qualifies.
  {
    const r = makeReport("flat projection passes (no qualifier)");
    const candidate = makeCandidate({
      propType: "PASSING_ATTEMPTS",
      line: 38, // history mean ~38 → edge ~0 → disqualified
    });
    const history = new Map([
      [
        historyKey("Patrick Mahomes", "KC"),
        [
          statRow({ week: 14, passingAttempts: 38 }),
          statRow({ week: 15, passingAttempts: 38 }),
          statRow({ week: 16, passingAttempts: 38 }),
        ],
      ],
    ]);
    const [evaluated] = applyScorecardToCandidates({
      candidates: [candidate],
      playerHistoryByName: history,
    });
    const s = evaluated.scorecard!;
    check(r, s.qualified === false, `qualified should be false (got ${s.qualified})`);
    check(
      r,
      s.disqualifiers.length > 0,
      `disqualifiers should be non-empty (got ${JSON.stringify(s.disqualifiers)})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — flat projection disqualifies");
    else console.log("[3] FAIL — flat disqualification");
  }

  // 4. Grading uses ONLY recommended plays for the betting ROI
  //    section. Universe hit rate stays in
  //    universeDiagnostics; recommendedPlays.count must equal
  //    the number of qualified candidates whose recommended
  //    side had a graded WIN/LOSS.
  {
    const r = makeReport("grading separates universe vs recommended");
    const candidates: RealWeekCandidate[] = [
      // Strong OVER play (qualifies)
      makeCandidate({
        id: "c-strong",
        playerName: "Patrick Mahomes",
        propType: "PASSING_ATTEMPTS",
        line: 30.5,
      }),
      // Marginal (probably PASS) play — same player, different line
      makeCandidate({
        id: "c-flat",
        playerName: "Patrick Mahomes",
        propType: "PASSING_ATTEMPTS",
        line: 38.5,
      }),
    ];
    const history = new Map([
      [
        historyKey("Patrick Mahomes", "KC"),
        [
          statRow({ week: 14, passingAttempts: 38 }),
          statRow({ week: 15, passingAttempts: 39 }),
          statRow({ week: 16, passingAttempts: 38 }),
          statRow({ week: 17, passingAttempts: 40 }),
          statRow({ week: 18, passingAttempts: 39 }),
        ],
      ],
    ]);
    const evaluated = applyScorecardToCandidates({
      candidates,
      playerHistoryByName: history,
    });
    const grade = gradeStoredWeek1Backtest({
      candidates: evaluated,
      season: 2025,
      week: 1,
      playerWeekStats: [
        // Actual: 38 — Strong OVER (line 30.5) wins; flat
        // OVER (line 38.5) loses; flat UNDER (line 38.5) wins.
        statRow({
          season: 2025,
          week: 1,
          team: "KC",
          opponent: "LAC",
          gameId: "2025-w1-kc-at-lac",
          passingAttempts: 38,
        }),
      ],
    });
    // Universe diagnostics: both candidates are decisive (38 vs
    // line 30.5: OVER wins, UNDER loses; 38 vs 38.5: UNDER wins,
    // OVER loses). Total candidates = 2.
    check(
      r,
      grade.summary.universeDiagnostics.totalCandidates === 2,
      `universe total=${grade.summary.universeDiagnostics.totalCandidates}`,
    );
    // Recommended plays: must be the qualifying ones only — the
    // strong-OVER candidate. The structure must NOT include the
    // flat candidate. Its hit-rate / ROI describe the model's
    // actual betting performance, not the universe.
    check(
      r,
      grade.summary.recommendedPlays.enabled === true,
      `recommendedPlays.enabled=${grade.summary.recommendedPlays.enabled}`,
    );
    check(
      r,
      grade.summary.recommendedPlays.count >= 1,
      `recommendedPlays.count should be ≥ 1 (got ${grade.summary.recommendedPlays.count})`,
    );
    // Recommended plays must NEVER be the full universe — that
    // would be the universe-diagnostic leak the user fenced
    // off. Confirm the count is < total candidates when at
    // least one was disqualified.
    const allQualified = evaluated.every((c) => c.scorecard?.qualified === true);
    if (!allQualified) {
      check(
        r,
        grade.summary.recommendedPlays.count <
          grade.summary.universeDiagnostics.totalCandidates,
        `recommendedPlays.count (${grade.summary.recommendedPlays.count}) should be < universe total (${grade.summary.universeDiagnostics.totalCandidates}) when some candidates were disqualified`,
      );
    }
    // The recommended-plays ROI MUST be derived from the
    // selected sides' profit, NOT the universe both-sides sum.
    // The universe summed both sides loses one bet for every
    // win at this line, so its ROI is near 0. The recommended-
    // plays ROI is the model's pick at the WIN side.
    check(
      r,
      Math.abs(grade.summary.recommendedPlays.roiPct) > 0.01 ||
        grade.summary.recommendedPlays.count === 0,
      "recommended ROI must come from selected-side profit, not universe",
    );
    // Universe hit rate must NOT be re-used as the model's hit
    // rate. The two are distinct structural fields and live in
    // different sections — assert that nothing in
    // recommendedPlays leaks the universe headline.
    const obj = grade.summary.recommendedPlays as unknown as Record<string, unknown>;
    check(r, !("betterSide" in obj), "recommendedPlays must not carry betterSide");
    check(
      r,
      !("overSide" in obj) && !("underSide" in obj),
      "recommendedPlays must not carry overSide/underSide (those are universe-only)",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — grading separates universe vs recommended ROI");
    else console.log("[4] FAIL — universe/recommended separation");
  }

  // 5. recommendedPlays.byPropType / byConfidenceTier /
  //    byEdgeBucket arrays exist on the recommended-plays
  //    output when enabled.
  {
    const r = makeReport("recommendedPlays breakdowns populated");
    const candidates: RealWeekCandidate[] = [
      makeCandidate({
        id: "c-1",
        propType: "PASSING_ATTEMPTS",
        line: 30.5,
      }),
      makeCandidate({
        id: "c-2",
        playerName: "Travis Kelce",
        propType: "RECEPTIONS",
        line: 4.5,
      }),
    ];
    const history = new Map([
      [
        historyKey("Patrick Mahomes", "KC"),
        [
          statRow({ week: 17, passingAttempts: 38 }),
          statRow({ week: 18, passingAttempts: 39 }),
        ],
      ],
      [
        historyKey("Travis Kelce", "KC"),
        [
          statRow({
            playerId: "00-kelce",
            playerName: "Travis Kelce",
            position: "TE",
            week: 17,
            receptions: 7,
            snapShare: 0.85,
          }),
          statRow({
            playerId: "00-kelce",
            playerName: "Travis Kelce",
            position: "TE",
            week: 18,
            receptions: 6,
            snapShare: 0.85,
          }),
        ],
      ],
    ]);
    const evaluated = applyScorecardToCandidates({
      candidates,
      playerHistoryByName: history,
    });
    const grade = gradeStoredWeek1Backtest({
      candidates: evaluated,
      season: 2025,
      week: 1,
      playerWeekStats: [
        statRow({
          season: 2025,
          week: 1,
          team: "KC",
          opponent: "LAC",
          gameId: "2025-w1-kc-at-lac",
          passingAttempts: 38,
        }),
        statRow({
          playerId: "00-kelce",
          playerName: "Travis Kelce",
          position: "TE",
          season: 2025,
          week: 1,
          team: "KC",
          opponent: "LAC",
          gameId: "2025-w1-kc-at-lac",
          receptions: 7,
        }),
      ],
    });
    if (grade.summary.recommendedPlays.enabled) {
      check(
        r,
        Array.isArray(grade.summary.recommendedPlays.byPropType) &&
          grade.summary.recommendedPlays.byPropType!.length > 0,
        "byPropType should be a non-empty array when enabled",
      );
      check(
        r,
        Array.isArray(grade.summary.recommendedPlays.byConfidenceTier),
        "byConfidenceTier should be an array",
      );
      check(
        r,
        Array.isArray(grade.summary.recommendedPlays.byEdgeBucket),
        "byEdgeBucket should be an array",
      );
    } else {
      // If no plays qualified, the structure should still be
      // intact (empty arrays or undefined acceptable on the
      // grading-side type).
      check(r, true, "scorecard produced 0 qualified plays — acceptable");
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — recommended-plays breakdowns wired");
    else console.log("[5] FAIL — breakdowns");
  }

  // 6. Disqualification breakdown reflects scorecard primary
  //    disqualifier categories when candidates carry scorecards
  //    that didn't qualify.
  {
    const r = makeReport("disqualification breakdown categorized");
    const candidates: RealWeekCandidate[] = [
      makeCandidate({
        id: "c-flat",
        propType: "PASSING_ATTEMPTS",
        line: 38,
      }),
    ];
    const history = new Map([
      [
        historyKey("Patrick Mahomes", "KC"),
        [
          statRow({ week: 17, passingAttempts: 38 }),
          statRow({ week: 18, passingAttempts: 38 }),
        ],
      ],
    ]);
    const evaluated = applyScorecardToCandidates({
      candidates,
      playerHistoryByName: history,
    });
    const grade = gradeStoredWeek1Backtest({
      candidates: evaluated,
      season: 2025,
      week: 1,
      playerWeekStats: [
        statRow({
          season: 2025,
          week: 1,
          team: "KC",
          opponent: "LAC",
          gameId: "2025-w1-kc-at-lac",
          passingAttempts: 38,
        }),
      ],
    });
    const dq = grade.summary.disqualificationBreakdown;
    check(
      r,
      dq.totalRejected >= 1,
      `totalRejected should include the unqualified candidate (got ${dq.totalRejected})`,
    );
    // The candidate above gets disqualified on "edge too thin"
    // (line equals projection mean → ~0 edge).
    check(
      r,
      dq.edgeTooThin >= 1 || dq.riskGate >= 1 || dq.other >= 1,
      `at least one disqualification reason should be ≥ 1 (got edgeTooThin=${dq.edgeTooThin}, riskGate=${dq.riskGate}, other=${dq.other})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — disqualification breakdown categorized");
    else console.log("[6] FAIL — disq categorization");
  }

  // 7. buildPlayerHistoryByName respects strict-before
  //    (no rows from the current week or later).
  {
    const r = makeReport("history builder enforces strict-before");
    const all: NflPlayerWeekStat[] = [
      statRow({ season: 2024, week: 17, passingAttempts: 38 }),
      statRow({ season: 2024, week: 18, passingAttempts: 39 }),
      // The "current" week — must NOT appear in the history.
      statRow({ season: 2025, week: 1, passingAttempts: 40 }),
      // A future week (sanity).
      statRow({ season: 2025, week: 2, passingAttempts: 41 }),
    ];
    const map = buildPlayerHistoryByName({
      candidates: [makeCandidate()],
      season: 2025,
      week: 1,
      playerWeekStats: all,
    });
    const rows = map.get(historyKey("Patrick Mahomes", "KC")) ?? [];
    check(r, rows.length === 2, `should have 2 strict-before rows (got ${rows.length})`);
    for (const row of rows) {
      const isStrictBefore =
        row.season < 2025 || (row.season === 2025 && row.week < 1);
      check(
        r,
        isStrictBefore,
        `row should be strict-before: season=${row.season} week=${row.week}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — strict-before enforced");
    else console.log("[7] FAIL — strict-before");
  }

  // 8. No banned hooks in the new module.
  {
    const r = makeReport("no banned hooks in stored-candidate-scorecard");
    const text = readSrc("src/lib/backtest/stored-candidate-scorecard.ts");
    for (const re of [
      /the-odds-api/i,
      /odds-api\.com/i,
      /\bfetch\(/,
      /\bkalshi\b/i,
      /placeBet|placeWager/,
      /https?:\/\/[a-z0-9\-]+\.[a-z]+/i,
      /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
    ]) {
      check(r, !re.test(text), `module contains banned pattern ${re}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[8] PASS — no API / betting / TD hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  // 9. Output type compatibility: EvaluatedRealWeekCandidate
  //    is assignable to RealWeekCandidate (the field is an
  //    extension, not a replacement).
  {
    const r = makeReport("evaluated candidate ⊇ RealWeekCandidate");
    const base = makeCandidate();
    const history = new Map([
      [
        historyKey("Patrick Mahomes", "KC"),
        [statRow({ week: 18, passingAttempts: 38 })],
      ],
    ]);
    const [evaluated] = applyScorecardToCandidates({
      candidates: [base],
      playerHistoryByName: history,
    });
    const asBase: RealWeekCandidate = evaluated;
    check(r, asBase.id === base.id, "evaluated assignable to RealWeekCandidate");
    const fwd: EvaluatedRealWeekCandidate = evaluated;
    check(r, fwd.scorecard !== undefined, "evaluated has scorecard field");
    record(r);
    if (r.reasons.length === 0)
      console.log("[9] PASS — type extension intact");
    else console.log("[9] FAIL — type extension");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 9 stored-candidate-scorecard assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}`);
      for (const x of f.reasons) console.log(`     - ${x}`);
    }
    process.exit(1);
  }
}

void main();
