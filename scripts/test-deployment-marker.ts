/**
 * Diagnostics deployment-marker assertions.
 *
 *   · DEPLOYMENT_MARKER constant exists in src/lib/deployment-marker.ts
 *   · the diagnostics page imports it from that module
 *   · the diagnostics page renders the marker chip with the
 *     data-testid the verifier looks for
 *   · the diagnostics page surfaces ADMIN_INGEST_TOKEN presence
 *   · the diagnostics page surfaces Postgres persistence (the
 *     section the verifier uses to confirm Railway routing)
 *   · no banned hooks (Odds API, Kalshi, automated betting, TD)
 *   · the value is the string the prompt asked for so the
 *     correct Railway service can be identified by its public URL
 *
 * Pure file IO — no spawn, no Prisma, no HTTP.
 */

import fs from "node:fs";
import path from "node:path";
import { DEPLOYMENT_MARKER } from "../src/lib/deployment-marker";

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
  console.log("Diagnostics deployment-marker — assertions");
  console.log("==========================================");

  // 1. Marker exists and matches the value the prompt asked for.
  {
    const r = makeReport("marker constant present and correct");
    check(
      r,
      typeof DEPLOYMENT_MARKER === "string" && DEPLOYMENT_MARKER.length > 0,
      "DEPLOYMENT_MARKER must be a non-empty string",
    );
    check(
      r,
      DEPLOYMENT_MARKER === "railway-prod-routing-check",
      `DEPLOYMENT_MARKER=${DEPLOYMENT_MARKER}, expected railway-prod-routing-check`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — marker constant present");
    else console.log("[1] FAIL — marker constant");
  }

  // 2. Diagnostics page imports the marker from the shared
  //    module (not redeclares it — Next page files cannot export
  //    arbitrary symbols).
  {
    const r = makeReport("diagnostics page imports marker module");
    const text = readSrc("src/app/diagnostics/page.tsx");
    check(
      r,
      /from "@\/lib\/deployment-marker"/.test(text),
      "page must import from @/lib/deployment-marker",
    );
    check(
      r,
      !/^export\s+const\s+DEPLOYMENT_MARKER/m.test(text),
      "page must NOT re-export DEPLOYMENT_MARKER (Next.js forbids non-page exports)",
    );
    check(
      r,
      /DEPLOYMENT_MARKER/.test(text),
      "page must reference DEPLOYMENT_MARKER somewhere",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — page imports marker, no re-export");
    else console.log("[2] FAIL — page marker import");
  }

  // 3. Marker chip rendered with the data-testid the verifier
  //    uses to find it (and the marker string appears in the
  //    page source).
  {
    const r = makeReport("marker chip rendered with testid");
    const text = readSrc("src/app/diagnostics/page.tsx");
    check(
      r,
      /data-testid="diagnostics-deployment-marker"/.test(text),
      "missing diagnostics-deployment-marker testid",
    );
    check(
      r,
      /Marker · \{DEPLOYMENT_MARKER\}/.test(text),
      "missing 'Marker · {DEPLOYMENT_MARKER}' chip render",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — marker chip + testid present");
    else console.log("[3] FAIL — marker chip");
  }

  // 4. Diagnostics page surfaces ADMIN_INGEST_TOKEN presence and
  //    the Postgres persistence section the verifier checks.
  {
    const r = makeReport("ADMIN_INGEST_TOKEN + Postgres section");
    const text = readSrc("src/app/diagnostics/page.tsx");
    check(
      r,
      /ADMIN_INGEST_TOKEN/.test(text),
      "missing ADMIN_INGEST_TOKEN row",
    );
    check(
      r,
      /data-testid="diagnostics-postgres-persistence"/.test(text),
      "missing Postgres persistence section testid",
    );
    check(
      r,
      /StoredPropMarket rows/.test(text),
      "missing StoredPropMarket rows row",
    );
    check(
      r,
      /StoredBacktestRun rows/.test(text),
      "missing StoredBacktestRun rows row",
    );
    check(
      r,
      /Recommended-plays performance/.test(text),
      "missing recommended-plays performance row",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — ADMIN_INGEST_TOKEN + Postgres rows present");
    else console.log("[4] FAIL — env / persistence rows");
  }

  // 5. No banned hooks in the marker module or the diagnostics
  //    page (the marker change must not smuggle in Odds API,
  //    automated betting, or TD prop references).
  {
    const r = makeReport("no banned hooks in marker / diagnostics");
    const sources = [
      readSrc("src/lib/deployment-marker.ts"),
      readSrc("src/app/diagnostics/page.tsx"),
    ];
    for (const text of sources) {
      for (const re of [
        /the-odds-api/i,
        /odds-api\.com/i,
        /placeBet|placeWager/,
        /\bkalshi\.\s*(place|connect|api|client|fetch|sign)/i,
        /https?:\/\/[a-z0-9\-]+\.[a-z]+/i,
        /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|PASS_TD|RUSH_TD|REC_TD/,
      ]) {
        check(r, !re.test(text), `banned pattern ${re}`);
      }
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — no API / Kalshi / TD hooks");
    else console.log("[5] FAIL — banned hooks");
  }

  // 6. Marker module is plain TS — no React, no Next, no env
  //    reads — so it can be safely imported by tests and scripts.
  {
    const r = makeReport("marker module is plain TS");
    const text = readSrc("src/lib/deployment-marker.ts");
    check(r, !/from "react"/.test(text), "marker should not import React");
    check(
      r,
      !/from "next/.test(text),
      "marker should not import next/*",
    );
    check(
      r,
      !/process\.env/.test(text),
      "marker should not read process.env (deterministic at build time)",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — marker module is plain TS");
    else console.log("[6] FAIL — marker dependencies");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 6 deployment-marker assertions passed.");
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
