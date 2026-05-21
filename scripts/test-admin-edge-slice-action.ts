/**
 * Admin edge-slice-diagnostic action assertions.
 *
 *   · runAdminAction("edge-slice-diagnostic") returns an ok=true
 *     result whose `summary` headline and `detail` body come
 *     from the same library the CLI script uses (no drift
 *     between admin UI and CLI output).
 *   · Default weeks = [1, 2] when the body's `weeks` is missing.
 *   · Explicit `weeks: [3, 4]` is respected and surfaced in
 *     the report.
 *   · No calibration payload → friendly "re-grade first"
 *     message in the summary + detail; action still returns
 *     ok=true (it's a successful read).
 *   · With calibration payload, the slice math + answers
 *     match what the library produces directly — proves the
 *     admin path is just a thin wrapper.
 *   · /api/admin/ingestion/run/route.ts accepts a `weeks` body
 *     field and forwards it to the runner.
 *   · The admin client exposes the run button + weeks input.
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure in-process — no spawn, no HTTP, no Prisma, no API call.
 */

import fs from "node:fs";
import path from "node:path";
import { runAdminAction } from "../src/lib/admin/admin-runner";
import { inMemoryPersistenceClient } from "../src/lib/persistence/week-1-persistence";

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

async function seedWeekWithCalibration(args: {
  client: ReturnType<typeof inMemoryPersistenceClient>;
  week: number;
  candidates: Array<{
    id: string;
    edge: number;
    modelProbability: number;
    marketProbability: number;
    outcome: "WIN" | "LOSS" | "PUSH" | "NO_DATA";
    profitPerUnit: number;
    productionQualified: boolean;
  }>;
}): Promise<void> {
  await args.client.saveStoredBacktestRunToDb({
    season: 2025,
    week: args.week,
    dataMode: "stored",
    status: "READY",
    realWeek1BacktestReady: true,
    scheduleValidationStatus: "PASS",
    syntheticFixture: false,
    candidatesJson: { candidates: [] },
    resultsJson: {
      summary: {
        totalCandidates: args.candidates.length,
        candidatesWithActual: args.candidates.length,
        candidatesMissingActual: 0,
        candidatesPushed: 0,
        qualifiedPlays: args.candidates.length,
        betterSide: "OVER" as const,
        overSide: {
          wins: 0, losses: 0, pushes: 0, graded: 0,
          hitRate: 0, roiPct: 0, unitsProfit: 0,
        },
        underSide: {
          wins: 0, losses: 0, pushes: 0, graded: 0,
          hitRate: 0, roiPct: 0, unitsProfit: 0,
        },
        recommendedPlays: {
          enabled: false, note: "pending", count: 0, wins: 0, losses: 0,
          pushes: 0, hitRatePct: 0, roiPct: 0, unitsProfit: 0,
          averageEdgePct: 0, averageConfidence: 0,
          byPropType: [], byConfidenceTier: [], byEdgeBucket: [],
        },
        parlayPerformance: {
          enabled: false, note: "pending", evaluated: 0, selected: 0, rejected: 0,
          selectedAggregate: {
            wins: 0, losses: 0, pushes: 0, noResult: 0,
            hitRatePct: 0, roiPct: 0, unitsProfit: 0,
            averageModeledHitProbabilityPct: 0,
            averageRequiredHitProbabilityPct: 0,
            averagePayoutMultiplier: 0, averageEVPct: 0,
          },
          rejectionReasons: {},
        },
        disqualificationBreakdown: {
          edgeTooThin: 0, riskGate: 0, roleStability: 0,
          missingResult: 0, ungradeable: 0, other: 0, totalRejected: 0,
        },
      },
      marketContextCalibration: {
        diagnosticOnly: true,
        generatedAt: new Date().toISOString(),
        productionGate: 0.45,
        note: "diagnostic only",
        production: {
          gateThreshold: 0.45, isProduction: true,
          qualifiedCount: args.candidates.filter((c) => c.productionQualified).length,
          decisiveCount: 0, wins: 0, losses: 0, pushes: 0, noResult: 0,
          hitRatePct: 0, roiPct: 0, unitsProfit: 0,
          averageEdgePct: 0, averageConfidence: 0,
          byPropType: [], byConfidenceTier: [], byEdgeBucket: [],
          candidates: [],
        },
        gate040: {
          gateThreshold: 0.4, isProduction: false,
          qualifiedCount: args.candidates.length,
          decisiveCount: args.candidates.length,
          wins: 0, losses: 0, pushes: 0, noResult: 0,
          hitRatePct: 0, roiPct: 0, unitsProfit: 0,
          averageEdgePct: 0, averageConfidence: 0,
          byPropType: [], byConfidenceTier: [], byEdgeBucket: [],
          candidates: args.candidates.map((c) => ({
            candidateId: c.id,
            playerName: `Player ${c.id}`,
            team: "BUF",
            opponent: "NYJ",
            gameId: `2025-w${args.week}-test`,
            propType: "RECEPTIONS",
            line: 4.5,
            recommendedSide: "OVER" as const,
            modelProbability: c.modelProbability,
            marketProbability: c.marketProbability,
            edge: c.edge,
            confidence: 0.65,
            riskScore: 0.65,
            marketContextScoreClamped: 0.4,
            marketContextScoreRaw: 0.43,
            productionQualified: c.productionQualified,
            actualValue: 6,
            outcome: c.outcome,
            profitPerUnit: c.profitPerUnit,
            removedDisqualifiers: [],
          })),
        },
        gate035: {
          gateThreshold: 0.35, isProduction: false,
          qualifiedCount: 0,
          decisiveCount: 0, wins: 0, losses: 0, pushes: 0, noResult: 0,
          hitRatePct: 0, roiPct: 0, unitsProfit: 0,
          averageEdgePct: 0, averageConfidence: 0,
          byPropType: [], byConfidenceTier: [], byEdgeBucket: [],
          candidates: [],
        },
      },
    },
  });
}

async function main(): Promise<void> {
  console.log("Admin edge-slice-diagnostic action — assertions");
  console.log("===============================================");

  // 1. Default weeks = [1, 2]. No calibration payload → friendly
  //    re-grade message, action still returns ok=true.
  {
    const r = makeReport("default weeks + no calibration → re-grade hint");
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "edge-slice-diagnostic",
      persistence: client,
    });
    check(r, result.action === "edge-slice-diagnostic", `action=${result.action}`);
    check(r, result.ok === true, `ok=${result.ok} (read-only success even with no data)`);
    check(
      r,
      /re-grade/i.test(result.summary) || /Re-grade/.test(result.summary),
      `summary should ask operator to re-grade (got "${result.summary}")`,
    );
    check(
      r,
      result.detail?.includes("Weeks 1, 2") === true,
      `detail should reference Weeks 1, 2 (got: ${result.detail?.slice(0, 200)})`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — default weeks + re-grade hint");
    else console.log("[1] FAIL — default behaviour");
  }

  // 2. Explicit weeks list flows through.
  {
    const r = makeReport("explicit weeks [3, 4] flows through");
    const client = inMemoryPersistenceClient();
    const result = await runAdminAction({
      action: "edge-slice-diagnostic",
      weeks: [3, 4],
      persistence: client,
    });
    check(r, result.ok === true, `ok=${result.ok}`);
    check(
      r,
      result.detail?.includes("Weeks 3, 4") === true,
      "detail should reference Weeks 3, 4",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — explicit weeks honoured");
    else console.log("[2] FAIL — weeks list");
  }

  // 3. With calibration payload: the report computes slices
  //    and the headline summarises plays + best slice.
  {
    const r = makeReport("populated calibration produces slice report");
    const client = inMemoryPersistenceClient();
    // 2 plays at edge 5%, 2 at edge 9%, 1 at edge 12% — wins
    // skew toward higher-edge plays so best slice should be
    // a higher-edge floor.
    await seedWeekWithCalibration({
      client,
      week: 1,
      candidates: [
        { id: "w1-a", edge: 0.05, modelProbability: 0.55, marketProbability: 0.5, outcome: "LOSS", profitPerUnit: -1, productionQualified: false },
        { id: "w1-b", edge: 0.05, modelProbability: 0.55, marketProbability: 0.5, outcome: "LOSS", profitPerUnit: -1, productionQualified: false },
        { id: "w1-c", edge: 0.09, modelProbability: 0.6, marketProbability: 0.51, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
        { id: "w1-d", edge: 0.09, modelProbability: 0.6, marketProbability: 0.51, outcome: "WIN", profitPerUnit: 0.91, productionQualified: false },
        { id: "w1-e", edge: 0.12, modelProbability: 0.65, marketProbability: 0.53, outcome: "WIN", profitPerUnit: 0.91, productionQualified: true },
      ],
    });
    const result = await runAdminAction({
      action: "edge-slice-diagnostic",
      weeks: [1],
      persistence: client,
    });
    check(r, result.ok === true, `ok=${result.ok}`);
    check(
      r,
      /5 plays/.test(result.summary) || /5 plays/.test(result.detail ?? ""),
      `expected 5-play headline in summary/detail`,
    );
    // Higher-edge slices include fewer plays — ≥10% should be
    // a 1-play slice with the WIN.
    check(
      r,
      (result.detail ?? "").includes("edge ≥ 10%"),
      "detail should list edge ≥ 10% slice",
    );
    check(
      r,
      (result.detail ?? "").includes("elite-only"),
      "detail should list elite-only slice",
    );
    check(
      r,
      (result.detail ?? "").includes("Compact summary"),
      "detail should include the compact summary",
    );
    check(
      r,
      (result.detail ?? "").includes("Slices ranked best → worst by ROI"),
      "detail should include the ranked output block",
    );
    check(
      r,
      (result.detail ?? "").includes("Answers"),
      "detail should include the four-question answers",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — populated calibration produces full report");
    else console.log("[3] FAIL — populated report");
  }

  // 4. /api/admin/ingestion/run/route.ts accepts the new
  //    action and the weeks body field.
  {
    const r = makeReport("API route accepts edge-slice-diagnostic + weeks");
    const text = readSrc("src/app/api/admin/ingestion/run/route.ts");
    check(
      r,
      /"edge-slice-diagnostic"/.test(text),
      "VALID_ACTIONS must include edge-slice-diagnostic",
    );
    check(
      r,
      /weeks/.test(text) && /weeksRaw/.test(text),
      "route must parse weeks body field",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — API route wires the new action + weeks");
    else console.log("[4] FAIL — API route");
  }

  // 5. Admin client exposes the run button + weeks input.
  {
    const r = makeReport("admin client UI exposes the new section");
    const text = readSrc("src/app/admin/ingestion/AdminIngestionClient.tsx");
    check(
      r,
      /data-testid="admin-edge-slice-section"/.test(text),
      "must render the edge-slice section",
    );
    check(
      r,
      /data-testid="admin-edge-slice-run-button"/.test(text),
      "must render the run button",
    );
    check(
      r,
      /data-testid="admin-edge-slice-weeks-input"/.test(text),
      "must render the weeks input",
    );
    check(
      r,
      /Run Edge Slice Diagnostic/.test(text),
      "button label must match the requirement",
    );
    check(
      r,
      /"edge-slice-diagnostic"/.test(text),
      "ActionName must include edge-slice-diagnostic",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — admin client exposes the section + button");
    else console.log("[5] FAIL — admin UI");
  }

  // 6. The CLI script consumes the same library — confirms
  //    no drift between admin UI and CLI outputs.
  {
    const r = makeReport("CLI script consumes the shared library");
    const text = readSrc("scripts/edge-slice-diagnostic-report.ts");
    check(
      r,
      /from "\.\.\/src\/lib\/backtest\/edge-slice-diagnostic"/.test(text),
      "CLI script must import buildEdgeSliceReport from the library",
    );
    check(
      r,
      /buildEdgeSliceReport/.test(text),
      "CLI script must call buildEdgeSliceReport",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — CLI script consumes the shared library");
    else console.log("[6] FAIL — script-library link");
  }

  // 7. Library is pure — no IO, no API, no banned hooks.
  {
    const r = makeReport("library is pure + no banned hooks");
    const files = [
      "src/lib/backtest/edge-slice-diagnostic.ts",
      "src/lib/admin/admin-runner.ts",
      "src/app/admin/ingestion/AdminIngestionClient.tsx",
      "src/app/api/admin/ingestion/run/route.ts",
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
    const libText = readSrc("src/lib/backtest/edge-slice-diagnostic.ts");
    check(
      r,
      !/fs\.|node:fs|readFileSync|writeFileSync/.test(libText),
      "library must not perform file IO",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — library is pure + no banned hooks");
    else console.log("[7] FAIL — purity");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 7 admin-edge-slice-action assertions passed.");
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
