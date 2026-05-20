/**
 * Week-display routing assertions.
 *
 *   · Header source no longer hard-codes "Week 11 · 2025"
 *   · Header uses the centralized app context
 *   · getDefaultAppContext() returns season 2025 week 1 in
 *     WEEK_1_STARTER_TEST mode
 *   · assertValidSeasonWeekContext catches bad inputs
 *   · /backtest/week-1, /monitor, /parlays, /game-edge page
 *     files exist
 *   · /backtest/week-1 page references "Week 1"
 *   · the legacy Week-11 mock data is explicitly labeled DEMO
 *     in the homepage hero
 *   · no touchdown propTypes are referenced in the dashboard
 *     entry points
 *
 * Pure file IO + module import. No network.
 */

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_SEASON,
  DEFAULT_DISPLAY_WEEK,
  DEMO_WEEK,
  WEEK_1_STARTER_TEST_ENABLED,
  assertValidSeasonWeekContext,
  getDefaultAppContext,
  getDemoAppContext,
  getWeek1StarterTestContext,
  getWeekLabel,
  InvalidAppContextError,
} from "../src/lib/app-context";

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

function fileExists(rel: string): boolean {
  return fs.existsSync(path.join(process.cwd(), rel));
}

function main(): void {
  console.log("Week-display routing — assertions");
  console.log("==================================");

  // 1. Header does not hard-code "Week 11 · 2025" anymore.
  {
    const r = makeReport("Header chip is not hard-coded to Week 11 · 2025");
    const text = readSrc("src/components/Header.tsx");
    check(
      r,
      !/Week\s+11\s*·\s*2025/.test(text),
      "Header.tsx still contains literal `Week 11 · 2025`",
    );
    check(
      r,
      /getDefaultAppContext|getWeekLabel/.test(text),
      "Header.tsx should import getDefaultAppContext / getWeekLabel",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[1] PASS — Header chip is context-driven`);
    else console.log(`[1] FAIL — Header hard-code`);
  }

  // 2. App context defaults.
  {
    const r = makeReport("app-context defaults");
    check(r, DEFAULT_SEASON === 2025, `DEFAULT_SEASON=${DEFAULT_SEASON}`);
    check(
      r,
      DEFAULT_DISPLAY_WEEK === 1,
      `DEFAULT_DISPLAY_WEEK=${DEFAULT_DISPLAY_WEEK}`,
    );
    check(r, DEMO_WEEK === 11, `DEMO_WEEK=${DEMO_WEEK}`);
    check(
      r,
      WEEK_1_STARTER_TEST_ENABLED === true,
      "WEEK_1_STARTER_TEST_ENABLED should be true",
    );
    const ctx = getDefaultAppContext();
    check(r, ctx.season === 2025, `default season ${ctx.season}`);
    check(r, ctx.week === 1, `default week ${ctx.week}`);
    check(
      r,
      ctx.dataMode === "WEEK_1_STARTER_TEST",
      `default dataMode ${ctx.dataMode}`,
    );
    check(
      r,
      ctx.label === "Week 1 · 2025",
      `default label "${ctx.label}"`,
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(
        `[2] PASS — context defaults: season=${ctx.season} week=${ctx.week} mode=${ctx.dataMode} label="${ctx.label}"`,
      );
    else console.log("[2] FAIL — context defaults");
  }

  // 3. assertValidSeasonWeekContext catches bad inputs.
  {
    const r = makeReport("assertValidSeasonWeekContext rejects bad inputs");
    try {
      assertValidSeasonWeekContext({
        season: 2025,
        week: 23,
        dataMode: "DEMO",
        label: "x",
        shortLabel: "x",
      });
      check(r, false, "expected rejection on week=23");
    } catch (e) {
      check(
        r,
        e instanceof InvalidAppContextError,
        `expected InvalidAppContextError, got ${(e as Error).name}`,
      );
    }
    try {
      assertValidSeasonWeekContext({
        season: 2025,
        week: 1,
        // @ts-expect-error — runtime validation under test
        dataMode: "WHAT",
        label: "x",
        shortLabel: "x",
      });
      check(r, false, "expected rejection on bad dataMode");
    } catch (e) {
      check(
        r,
        e instanceof InvalidAppContextError,
        `expected InvalidAppContextError on bad dataMode`,
      );
    }
    // Good context — should not throw.
    try {
      assertValidSeasonWeekContext(getDefaultAppContext());
      check(r, true, "default context accepted");
    } catch (e) {
      check(r, false, `default context rejected: ${(e as Error).message}`);
    }
    record(r);
    if (r.reasons.length === 0) console.log(`[3] PASS — context validation`);
    else console.log(`[3] FAIL — context validation`);
  }

  // 4. Demo + Week 1 contexts have distinct labels.
  {
    const r = makeReport("demo vs Week 1 labels");
    const demo = getDemoAppContext();
    const week1 = getWeek1StarterTestContext();
    check(r, demo.week === 11, `demo.week=${demo.week}`);
    check(r, demo.dataMode === "DEMO", `demo.dataMode=${demo.dataMode}`);
    check(r, demo.label.includes("Demo"), `demo.label="${demo.label}"`);
    check(r, week1.week === 1, `week1.week=${week1.week}`);
    check(
      r,
      week1.dataMode === "WEEK_1_STARTER_TEST",
      `week1.dataMode=${week1.dataMode}`,
    );
    check(
      r,
      week1.label.includes("Starter Test"),
      `week1.label="${week1.label}"`,
    );
    const label = getWeekLabel(getDefaultAppContext());
    check(r, label === "Week 1 · 2025", `getWeekLabel default "${label}"`);
    record(r);
    if (r.reasons.length === 0)
      console.log(`[4] PASS — demo + Week 1 labels distinct`);
    else console.log(`[4] FAIL — labels`);
  }

  // 5. Required page files exist.
  {
    const r = makeReport("required page files exist");
    for (const f of [
      "src/app/backtest/week-1/page.tsx",
      "src/app/monitor/page.tsx",
      "src/app/parlays/page.tsx",
      "src/app/game-edge/page.tsx",
      "src/app/page.tsx",
      "src/app/backtest/page.tsx",
    ]) {
      check(r, fileExists(f), `missing ${f}`);
    }
    record(r);
    if (r.reasons.length === 0) console.log(`[5] PASS — all required pages exist`);
    else console.log(`[5] FAIL — pages`);
  }

  // 6. /backtest/week-1 page references Week 1.
  {
    const r = makeReport("/backtest/week-1 mentions Week 1");
    const text = readSrc("src/app/backtest/week-1/page.tsx");
    check(
      r,
      /Week\s+1\s+2025/.test(text) || /Week 1 Starter Test/.test(text),
      "page does not advertise itself as Week 1 anywhere",
    );
    check(
      r,
      !/Week\s+11/.test(text),
      "Week 1 page should not mention Week 11",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[6] PASS — /backtest/week-1 references Week 1`);
    else console.log(`[6] FAIL — /backtest/week-1`);
  }

  // 7. Homepage hero clearly labels demo + offers CTA to Week 1.
  {
    const r = makeReport("homepage labels demo + links to Week 1 test");
    const text = readSrc("src/app/page.tsx");
    check(
      r,
      /Demo\s+data|getDemoAppContext/.test(text),
      "homepage should label its data as demo",
    );
    check(
      r,
      /href=\s*"\/backtest\/week-1"/.test(text),
      "homepage should link to /backtest/week-1",
    );
    check(
      r,
      !/Week\s+11\s*·\s*2025\s*·\s*Lower-variance/.test(text),
      "homepage hero should not reuse the old hard-coded Week 11 chip text",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log(`[7] PASS — homepage demo banner + Week-1 CTA present`);
    else console.log(`[7] FAIL — homepage demo / CTA`);
  }

  // 8. Header nav includes Week 1 Test link.
  {
    const r = makeReport("Header has a Week 1 Test link");
    const text = readSrc("src/components/Header.tsx");
    check(
      r,
      /href:\s*"\/backtest\/week-1"/.test(text),
      "Header missing /backtest/week-1 nav link",
    );
    check(
      r,
      /Week 1 Test/.test(text),
      "Header missing 'Week 1 Test' label",
    );
    record(r);
    if (r.reasons.length === 0) console.log(`[8] PASS — Header has Week 1 Test link`);
    else console.log(`[8] FAIL — Header Week 1 Test link`);
  }

  // 9. No touchdown propTypes referenced in dashboard entry points.
  {
    const r = makeReport("no touchdown propTypes in dashboard sources");
    for (const f of [
      "src/components/Header.tsx",
      "src/app/page.tsx",
      "src/app/backtest/week-1/page.tsx",
      "src/app/monitor/page.tsx",
      "src/lib/app-context.ts",
    ]) {
      const text = readSrc(f);
      const banned = /\bTOUCHDOWN\b|\bANYTIME_TD\b|\bFIRST_TD\b|RUSH_TD|REC_TD|PASS_TD/;
      check(r, !banned.test(text), `${f} mentions a touchdown propType`);
    }
    record(r);
    if (r.reasons.length === 0)
      console.log(`[9] PASS — no touchdown propTypes in entry points`);
    else console.log(`[9] FAIL — touchdown propTypes`);
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log(`All 9 week-display routing assertions passed.`);
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
