/**
 * Week selector + per-week routing assertions.
 *
 *   · WeekSelector is a client component ("use client") and
 *     exports the `WeekSelector` symbol the pages import.
 *   · It renders an "All" option plus one option per week
 *     supplied via `options`, in the order given.
 *   · It supports two modes: `searchParam` (mutates ?week=)
 *     and `route` (navigates via routeFor).
 *   · The dynamic `/backtest/weeks/[week]/page.tsx` route
 *     exists, redirects week 1 to /backtest/week-1, and shows
 *     the "no stored backtest data" message for absent weeks.
 *   · The /monitor page reads `searchParams.week` and either
 *     shows the season aggregate ("All") or filters to the
 *     selected week's detail.
 *   · No banned hooks (Odds API, Kalshi, automated betting, TD).
 *
 * Pure file IO assertions — no spawn, no HTTP, no DOM, no API.
 */

import fs from "node:fs";
import path from "node:path";

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
function exists(rel: string): boolean {
  return fs.existsSync(path.join(process.cwd(), rel));
}

function main(): void {
  console.log("Week selector + per-week routing — assertions");
  console.log("==============================================");

  // 1. WeekSelector component module exists and is a client
  //    component.
  {
    const r = makeReport("WeekSelector module present + client directive");
    const ok = exists("src/components/WeekSelector.tsx");
    check(r, ok, "src/components/WeekSelector.tsx missing");
    if (ok) {
      const text = readSrc("src/components/WeekSelector.tsx");
      check(
        r,
        /^"use client";/m.test(text),
        "module must start with 'use client'",
      );
      check(
        r,
        /export function WeekSelector\(/m.test(text),
        "must export WeekSelector function",
      );
      check(
        r,
        /export interface WeekSelectorOption/m.test(text),
        "must export WeekSelectorOption type",
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[1] PASS — WeekSelector module + client directive");
    else console.log("[1] FAIL — module presence");
  }

  // 2. WeekSelector supports both modes via discriminated union
  //    and renders "All stored weeks" as the first option.
  {
    const r = makeReport("WeekSelector modes + All option");
    const text = readSrc("src/components/WeekSelector.tsx");
    check(
      r,
      /mode: "searchParam"/m.test(text) && /mode: "route"/m.test(text),
      "must define both 'searchParam' and 'route' modes",
    );
    check(
      r,
      /<option value="all">/m.test(text),
      "must render the 'all' option as the default season view",
    );
    check(
      r,
      /All stored weeks/i.test(text),
      "must label 'all' option as season aggregate",
    );
    check(
      r,
      /routeFor\(week\)/m.test(text),
      "must call routeFor(week) for route-mode navigation",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[2] PASS — modes + All option present");
    else console.log("[2] FAIL — modes");
  }

  // 3. The /backtest/weeks/[week] dynamic route exists, handles
  //    missing data, and redirects week 1.
  {
    const r = makeReport("/backtest/weeks/[week] dynamic route");
    const ok = exists("src/app/backtest/weeks/[week]/page.tsx");
    check(r, ok, "src/app/backtest/weeks/[week]/page.tsx missing");
    if (ok) {
      const text = readSrc("src/app/backtest/weeks/[week]/page.tsx");
      check(
        r,
        /import \{ redirect \} from "next\/navigation"/m.test(text),
        "must import redirect for canonical Week 1 URL",
      );
      check(
        r,
        /if \(week === 1\)/m.test(text) && /redirect\("\/backtest\/week-1"\)/m.test(text),
        "must redirect week 1 to /backtest/week-1",
      );
      check(
        r,
        /No stored backtest data for this week yet/m.test(text),
        "must show 'no stored backtest data' for missing weeks",
      );
      check(
        r,
        /data-testid="backtest-week-not-found"/m.test(text),
        "missing testid for not-found section",
      );
      check(
        r,
        /<WeekSelector/m.test(text),
        "must render the WeekSelector",
      );
    }
    record(r);
    if (r.reasons.length === 0)
      console.log("[3] PASS — dynamic route present + handles missing data");
    else console.log("[3] FAIL — dynamic route");
  }

  // 4. /monitor reads `searchParams.week` and uses the selected
  //    week to filter the view.
  {
    const r = makeReport("/monitor reads searchParams.week + filters view");
    const text = readSrc("src/app/monitor/page.tsx");
    check(
      r,
      /searchParams\?: Promise<\{ week\?: string \}>/m.test(text),
      "must accept searchParams.week in props",
    );
    check(
      r,
      /WeekSelector/m.test(text),
      "must import + render WeekSelector",
    );
    check(
      r,
      /mode="searchParam"/m.test(text),
      "monitor selector must use searchParam mode",
    );
    check(
      r,
      /selectedWeek === undefined/m.test(text),
      "must branch on selectedWeek being undefined ('All')",
    );
    check(
      r,
      /data-testid="monitor-week-not-found"/m.test(text),
      "missing 'no data for this week' testid",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[4] PASS — /monitor filters on searchParams.week");
    else console.log("[4] FAIL — /monitor filtering");
  }

  // 5. /backtest/week-1 uses route-mode selector that points
  //    to /backtest/weeks/N for N>1 and back to /backtest/week-1
  //    for Week 1.
  {
    const r = makeReport("/backtest/week-1 route selector wired");
    const text = readSrc("src/app/backtest/week-1/page.tsx");
    check(r, /<WeekSelector/m.test(text), "must render WeekSelector");
    check(
      r,
      /mode="route"/m.test(text),
      "must use route-mode selector",
    );
    check(
      r,
      /\/backtest\/weeks\/\$\{week\}/.test(text),
      "must navigate to /backtest/weeks/${week} for non-Week-1",
    );
    check(
      r,
      /\/backtest\/week-1/m.test(text),
      "must keep /backtest/week-1 as Week 1 destination",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[5] PASS — /backtest/week-1 wires route-mode selector");
    else console.log("[5] FAIL — week-1 selector");
  }

  // 6. The fallback message "No stored backtest data" is
  //    rendered by BOTH the dynamic route AND the /monitor
  //    page (so an operator selecting an absent week sees a
  //    consistent message).
  {
    const r = makeReport("consistent 'no data for this week' fallback");
    const dyn = readSrc("src/app/backtest/weeks/[week]/page.tsx");
    const mon = readSrc("src/app/monitor/page.tsx");
    check(
      r,
      /No stored backtest data for this week yet/m.test(dyn),
      "dynamic route missing fallback message",
    );
    check(
      r,
      /No stored backtest data for this week yet/m.test(mon),
      "/monitor missing fallback message",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[6] PASS — fallback message consistent across pages");
    else console.log("[6] FAIL — fallback consistency");
  }

  // 7. /monitor still renders the season aggregate sections
  //    (SeasonStoredWeeksTable, SeasonCalibrationAggregate)
  //    when selectedWeek is undefined.
  {
    const r = makeReport("/monitor season aggregate preserved");
    const text = readSrc("src/app/monitor/page.tsx");
    check(
      r,
      /<SeasonStoredWeeksTable/m.test(text),
      "must still render SeasonStoredWeeksTable",
    );
    check(
      r,
      /<SeasonCalibrationAggregate/m.test(text),
      "must still render SeasonCalibrationAggregate",
    );
    check(
      r,
      /<StoredWeek1Panel/m.test(text),
      "must still render StoredWeek1Panel",
    );
    record(r);
    if (r.reasons.length === 0)
      console.log("[7] PASS — season aggregate preserved");
    else console.log("[7] FAIL — aggregate sections");
  }

  // 8. No banned hooks in the selector / route / page files.
  {
    const r = makeReport("no banned hooks");
    const files = [
      "src/components/WeekSelector.tsx",
      "src/app/backtest/weeks/[week]/page.tsx",
      "src/app/backtest/week-1/page.tsx",
      "src/app/monitor/page.tsx",
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
    if (r.reasons.length === 0) console.log("[8] PASS — no banned hooks");
    else console.log("[8] FAIL — banned hooks");
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All 8 week-selector assertions passed.");
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
