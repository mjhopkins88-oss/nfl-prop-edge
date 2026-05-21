/**
 * Scorecard rejection diagnostics assertions.
 *
 *   · disqualification breakdown splits "Risk gate" into 8
 *     specific per-bucket categories
 *   · the sum of per-bucket counts equals the riskGate headline
 *   · primary disqualifier text maps to the correct bucket
 *   · buildScorecardAudit reports candidatesMissingHistory,
 *     per-feature completeness, top exact reasons, and sample
 *     picks
 *   · a rookie with 0 history fails on dataQualityGate (not
 *     generic "risk gate")
 *   · a team-switched player whose history exists under the
 *     OLD team gets joined-out and ALSO fails dataQualityGate —
 *     the structural cause of the production "265 risk-gate"
 *     output
 *   · per-bucket featureCompleteness reports min / mean / max /
 *     belowGate for each bucket
 *   · no banned hooks
 *   · no touchdown propTypes / API / Kalshi
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API.
 */

import fs from "node:fs";
import path from "node:path";
import {
  applyScorecardToCandidates,
  buildPlayerHistoryByName,
  historyKey,
} from "../src/lib/backtest/stored-candidate-scorecard";
import {
  buildScorecardAudit,
  gradeStoredWeek1Backtest,
} from "../src/lib/backtest/week-1-grading";
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
    overOdds: -115,
    underOdds: -105,
    sportsbook: "DRAFTKINGS",
    dataMode: "STORED_2025",
    syntheticFixture: false,
    ...over,
  };
}

function main(): void {
  console.log("Scorecard rejection diagnostics — assertions");
  console.log("=============================================");

  // 1. Rookie (0 history) → dataQualityGate failure, not a
  //    generic "risk gate" bucket.
  {
    const r = makeReport("rookie → dataQualityGate failure");
    const candidates = [
      makeCandidate({
        id: "rookie",
        playerName: "Rookie WR",
        propType: "RECEPTIONS",
        line: 3.5,
      }),
    ];
    const playerHistoryByName = new Map(); // 0 history
    const evaluated = applyScorecardToCandidates({
      candidates,
      playerHistoryByName,
    });
    const grade = gradeStoredWeek1Backtest({
      candidates: evaluated,
      season: 2025,
      week: 1,
      playerWeekStats: [],
    });
    const dq = grade.summary.disqualificationBreakdown;
    check(r, dq.dataQualityGate === 1, `dataQualityGate=${dq.dataQualityGate}, expected 1`);
    check(r, dq.roleStabilityGate === 0, `roleStabilityGate=${dq.roleStabilityGate}`);
    check(r, dq.riskGate === 1, `riskGate (sum)=${dq.riskGate}, expected 1`);
    check(r, dq.edgeTooThin === 0, `edgeTooThin=${dq.edgeTooThin}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — rookie fails dataQualityGate, not generic risk gate");
    else console.log("[1] FAIL — dataQualityGate routing");
  }

  // 2. Per-bucket counts sum to the riskGate headline.
  {
    const r = makeReport("per-bucket sum equals riskGate total");
    const candidates: RealWeekCandidate[] = [];
    for (let i = 0; i < 5; i++) {
      candidates.push(
        makeCandidate({
          id: `rookie-${i}`,
          playerName: `Rookie ${i}`,
          propType: "RECEPTIONS",
          line: 3.5,
        }),
      );
    }
    const evaluated = applyScorecardToCandidates({
      candidates,
      playerHistoryByName: new Map(),
    });
    const grade = gradeStoredWeek1Backtest({
      candidates: evaluated,
      season: 2025,
      week: 1,
      playerWeekStats: [],
    });
    const dq = grade.summary.disqualificationBreakdown;
    const sum =
      dq.dataQualityGate! +
      dq.roleStabilityGate! +
      dq.injuryContextGate! +
      dq.correlationExposureGate! +
      dq.weatherEnvironmentGate! +
      dq.gameScriptGate! +
      dq.paceGate! +
      dq.marketContextGate!;
    check(r, sum === dq.riskGate, `bucket sum=${sum}, riskGate=${dq.riskGate}`);
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — per-bucket sum equals riskGate");
    else console.log("[2] FAIL — per-bucket sum");
  }

  // 3. Aggregate scorecard audit reports candidatesMissingHistory
  //    + per-feature completeness + samplePicks.
  {
    const r = makeReport("buildScorecardAudit returns rich diagnostics");
    const candidates = [
      makeCandidate({ id: "c-1", playerName: "Rookie A" }),
      makeCandidate({ id: "c-2", playerName: "Veteran A" }),
    ];
    const history = new Map([
      [
        historyKey("Veteran A", "BUF"),
        [
          statRow({ playerName: "Veteran A", season: 2024, week: 17, receptions: 7 }),
          statRow({ playerName: "Veteran A", season: 2024, week: 18, receptions: 8 }),
        ],
      ],
    ]);
    const evaluated = applyScorecardToCandidates({
      candidates,
      playerHistoryByName: history,
    });
    const audit = buildScorecardAudit({
      candidates: evaluated,
      playerHistoryByName: history,
      samplePicksCount: 5,
    });
    check(r, audit.candidatesScored === 2, `scored=${audit.candidatesScored}`);
    check(r, audit.candidatesWithScorecard === 2, `withScorecard=${audit.candidatesWithScorecard}`);
    check(r, audit.candidatesMissingHistory === 1, `missingHistory=${audit.candidatesMissingHistory}, expected 1 (the rookie)`);
    check(r, audit.featureCompleteness.length === 8, `featureCompleteness count=${audit.featureCompleteness.length}, expected 8`);
    const dqRow = audit.featureCompleteness.find((f) => f.bucket === "dataQuality");
    check(r, dqRow !== undefined, "dataQuality bucket present");
    check(r, dqRow!.gateThreshold === 0.55, `dataQuality gate=${dqRow!.gateThreshold}`);
    check(r, audit.samplePicks.length === 2, `samplePicks=${audit.samplePicks.length}`);
    check(
      r,
      audit.samplePicks[0].primaryDisqualifier !== null ||
        audit.samplePicks[0].qualified === true,
      "samplePicks[0] should have a primary disqualifier or be qualified",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — audit reports missingHistory + completeness + picks");
    else console.log("[3] FAIL — audit fields");
  }

  // 4. PRODUCTION-BUG REPRODUCER: a player whose 5 prior history
  //    rows exist under their OLD team is JOINED OUT by the
  //    current (playerName, team) key. The structural cause of
  //    "265 risk-gate" rejections in production.
  {
    const r = makeReport("team-switched player joined out → dataQualityGate (BUG)");
    const candidate = makeCandidate({
      id: "switched",
      playerName: "Switched WR",
      team: "GB",
      propType: "RECEPTIONS",
      line: 5.5,
    });
    // Player's history exists, but under team="TB" not "GB".
    const allHistory: NflPlayerWeekStat[] = [
      statRow({ playerName: "Switched WR", team: "TB", season: 2024, week: 16, receptions: 9 }),
      statRow({ playerName: "Switched WR", team: "TB", season: 2024, week: 17, receptions: 8 }),
      statRow({ playerName: "Switched WR", team: "TB", season: 2024, week: 18, receptions: 7 }),
      statRow({ playerName: "Switched WR", team: "TB", season: 2024, week: 15, receptions: 8 }),
      statRow({ playerName: "Switched WR", team: "TB", season: 2024, week: 14, receptions: 6 }),
    ];
    const playerHistoryByName = buildPlayerHistoryByName({
      candidates: [candidate],
      season: 2025,
      week: 1,
      playerWeekStats: allHistory,
    });
    // The lookup key (Switched WR::GB) yields ZERO rows because
    // every history row carries team="TB".
    const rows = playerHistoryByName.get(historyKey("Switched WR", "GB"));
    check(
      r,
      !rows || rows.length === 0,
      `STRUCTURAL BUG REPRO — history map should be empty under new team, got ${rows?.length ?? "undefined"} rows`,
    );
    const evaluated = applyScorecardToCandidates({
      candidates: [candidate],
      playerHistoryByName,
    });
    const sc = evaluated[0].scorecard!;
    check(
      r,
      sc.qualified === false,
      "team-switched player should not qualify because join is empty",
    );
    check(
      r,
      (sc.primaryDisqualifier ?? "").toLowerCase().includes("data quality"),
      `primary disqualifier should be data quality (got "${sc.primaryDisqualifier}")`,
    );
    check(
      r,
      sc.dataQualityScore <= 0.4 + 1e-9,
      `dataQualityScore should be ≈0.40 (got ${sc.dataQualityScore})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — team-switched player reproduces production data-quality failure");
    else console.log("[4] FAIL — team-switch repro");
  }

  // 5. Veteran with rich history qualifies (sanity — the
  //    rejection path is not blanket).
  {
    const r = makeReport("veteran with rich history can qualify");
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
    const sc = evaluated[0].scorecard!;
    check(r, sc.qualified === true, `veteran should qualify (got qualified=${sc.qualified}, disq=${sc.primaryDisqualifier})`);
    check(
      r,
      sc.recommendation === "OVER" || sc.recommendation === "UNDER",
      `recommendation should be OVER/UNDER (got ${sc.recommendation})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — veteran with rich history qualifies");
    else console.log("[5] FAIL — veteran qualification");
  }

  // 6. Per-feature completeness reports min / mean / max /
  //    belowGate for each bucket, even when scored=0.
  {
    const r = makeReport("featureCompleteness min/mean/max present");
    const evaluated = applyScorecardToCandidates({
      candidates: [makeCandidate({ id: "c-1" })],
      playerHistoryByName: new Map(),
    });
    const audit = buildScorecardAudit({
      candidates: evaluated,
    });
    for (const f of audit.featureCompleteness) {
      check(
        r,
        typeof f.belowGate === "number" &&
          typeof f.scored === "number" &&
          typeof f.missing === "number",
        `${f.bucket} has numeric counts`,
      );
      check(
        r,
        typeof f.minScore === "number" &&
          typeof f.meanScore === "number" &&
          typeof f.maxScore === "number",
        `${f.bucket} has min/mean/max`,
      );
      check(
        r,
        f.gateThreshold > 0 && f.gateThreshold <= 1,
        `${f.bucket} gate in (0, 1] — got ${f.gateThreshold}`,
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — featureCompleteness min/mean/max present");
    else console.log("[6] FAIL — featureCompleteness fields");
  }

  // 7. Disqualification text routing — each bucket label is
  //    correctly classified.
  {
    const r = makeReport("disqualifier text routes to correct bucket");
    // Verify the grading module's routing helper for known label
    // strings by feeding hand-rolled scorecards via the path
    // grade-time uses.
    interface BucketCheck {
      primary: string;
      expectedBucket: keyof typeof BUCKET_FIELDS;
    }
    const BUCKET_FIELDS = {
      dataQualityGate: 0,
      roleStabilityGate: 0,
      injuryContextGate: 0,
      correlationExposureGate: 0,
      weatherEnvironmentGate: 0,
      gameScriptGate: 0,
      paceGate: 0,
      marketContextGate: 0,
      edgeTooThin: 0,
    } as const;
    const cases: BucketCheck[] = [
      { primary: "Data quality score 0.40 below 0.55 gate", expectedBucket: "dataQualityGate" },
      { primary: "Role stability score 0.40 below 0.55 gate", expectedBucket: "roleStabilityGate" },
      { primary: "Injury context score 0.40 below 0.55 gate", expectedBucket: "injuryContextGate" },
      { primary: "Correlation exposure score 0.40 below 0.50 gate", expectedBucket: "correlationExposureGate" },
      { primary: "Weather / environment score 0.40 below 0.50 gate", expectedBucket: "weatherEnvironmentGate" },
      { primary: "Game script score 0.40 below 0.45 gate", expectedBucket: "gameScriptGate" },
      { primary: "Pace score 0.40 below 0.45 gate", expectedBucket: "paceGate" },
      { primary: "Market context score 0.40 below 0.45 gate", expectedBucket: "marketContextGate" },
      { primary: "Edge of +3.0% on OVER below 5.0% threshold", expectedBucket: "edgeTooThin" },
    ];
    // Build a single candidate per case with a synthetic
    // scorecard so we exercise the bucketing logic.
    const candidates: RealWeekCandidate[] = cases.map((c, i) => ({
      ...makeCandidate({ id: `c-${i}`, playerName: `Player ${i}` }),
      scorecard: {
        recommendation: "PASS" as const,
        selectedSide: "OVER" as const,
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
        dataQualityScore: 0.55,
        roleStabilityScore: 0.55,
        gameScriptScore: 0.6,
        paceScore: 0.6,
        marketContextScore: 0.6,
        weatherEnvironmentScore: 0.85,
        injuryContextScore: 0.85,
        correlationExposureScore: 0.7,
        volatilityLevel: "medium" as const,
        primaryDisqualifier: c.primary,
        disqualifiers: [c.primary],
        passReasons: [],
        failReasons: [c.primary],
        projectedMean: 0,
        projectedStdDev: 0,
      },
    }));
    const grade = gradeStoredWeek1Backtest({
      candidates,
      season: 2025,
      week: 1,
      playerWeekStats: [],
    });
    const dq = grade.summary.disqualificationBreakdown;
    const actual: Record<string, number> = {
      dataQualityGate: dq.dataQualityGate ?? 0,
      roleStabilityGate: dq.roleStabilityGate ?? 0,
      injuryContextGate: dq.injuryContextGate ?? 0,
      correlationExposureGate: dq.correlationExposureGate ?? 0,
      weatherEnvironmentGate: dq.weatherEnvironmentGate ?? 0,
      gameScriptGate: dq.gameScriptGate ?? 0,
      paceGate: dq.paceGate ?? 0,
      marketContextGate: dq.marketContextGate ?? 0,
      edgeTooThin: dq.edgeTooThin,
    };
    for (const key of Object.keys(BUCKET_FIELDS) as Array<keyof typeof BUCKET_FIELDS>) {
      check(r, actual[key] === 1, `${key} should be 1, got ${actual[key]}`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — disqualifier text routes to correct bucket");
    else console.log("[7] FAIL — disq routing");
  }

  // 8. No banned hooks (Odds API, Kalshi, automated betting, TD).
  {
    const r = makeReport("no banned hooks in audit files");
    const files = [
      "src/lib/backtest/stored-candidate-scorecard.ts",
      "src/lib/backtest/week-1-grading.ts",
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
      console.log("[8] PASS — no banned hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 8 scorecard-rejection-diagnostics assertions passed.");
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
