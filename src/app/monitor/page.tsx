import Link from "next/link";
import { loadFixtureBacktestSummary } from "@/lib/backtest/fixture-summary";
import { loadFixtureProxySummary } from "@/lib/backtest/fixture-proxy-summary";
import {
  loadFixtureComparisonSummary,
  loadFixtureRecommendationChanges,
} from "@/lib/backtest/fixture-comparison-summary";
import {
  loadWeek1ParlayPreview,
  loadWeek1Pregame,
  loadWeek1Results,
  loadWeek1V1V2Comparison,
  loadWeek1GameEdgePreview,
} from "@/lib/backtest/week-1-summary";
import {
  loadStoredWeek1MonitorSnapshot,
  type StoredWeek1MonitorSnapshot,
} from "@/lib/backtest/week-1-monitor-summary";
import { getWeek1StarterTestContext } from "@/lib/app-context";

export const dynamic = "force-dynamic";

export default async function MonitorPage() {
  const stored = await loadStoredWeek1MonitorSnapshot({ season: 2025, week: 1 });
  const fixture = loadFixtureBacktestSummary();
  const proxySummary = loadFixtureProxySummary();
  const compareLatest = loadFixtureComparisonSummary();
  const changes = loadFixtureRecommendationChanges();
  const week1Pregame = loadWeek1Pregame();
  const week1Results = loadWeek1Results();
  const week1Comparison = loadWeek1V1V2Comparison();
  const week1Parlays = loadWeek1ParlayPreview();
  const week1GameEdge = loadWeek1GameEdgePreview();

  // A stored snapshot with READY status + candidates is the
  // primary source. Fixture starter-test outputs (8 evaluated,
  // 2 qualified, fake 100% hit rate) become secondary and get
  // clearly labelled.
  const storedIsPrimary =
    stored !== undefined &&
    stored.realWeek1BacktestReady &&
    stored.candidateCount > 0;

  const readiness = computeReadiness({
    fixture,
    week1Results,
    stored,
    storedIsPrimary,
  });

  return (
    <div className="space-y-8">
      <Hero readiness={readiness} storedIsPrimary={storedIsPrimary} />
      {stored ? <StoredWeek1Panel stored={stored} /> : null}
      <OverallHealth
        fixture={fixture}
        week1Results={week1Results}
        storedIsPrimary={storedIsPrimary}
      />
      <WeekByWeekTable
        week1Results={week1Results}
        stored={stored}
        storedIsPrimary={storedIsPrimary}
      />
      <PlayerPropPerformance fixture={fixture} />
      <V1V2Panel
        compareLatest={compareLatest}
        changes={changes}
        week1Comparison={week1Comparison}
      />
      <ProxyHealthPanel proxySummary={proxySummary} />
      <GameEdgeMonitor week1GameEdge={week1GameEdge} />
      <ParlayMonitor week1Parlays={week1Parlays} />
      <WarningsPanel />
      <RunHint
        showRunHint={!week1Pregame || !week1Results}
      />
    </div>
  );
}

interface Readiness {
  status: "READY" | "RESEARCH" | "INSUFFICIENT_DATA";
  reason: string;
}

function computeReadiness(args: {
  fixture: ReturnType<typeof loadFixtureBacktestSummary>;
  week1Results: ReturnType<typeof loadWeek1Results>;
  stored: StoredWeek1MonitorSnapshot | undefined;
  storedIsPrimary: boolean;
}): Readiness {
  if (args.storedIsPrimary && args.stored) {
    return {
      status: "RESEARCH",
      reason: `Real stored Week 1 backtest loaded (${args.stored.candidateCount} candidates from ${args.stored.source}). Pregame candidates only — grading is still pending.`,
    };
  }
  if (args.stored && args.stored.status !== "READY") {
    return {
      status: "RESEARCH",
      reason: `Stored Week 1 backtest status: ${args.stored.status} (${args.stored.source}). Fixture starter-test values shown below are fixture-only.`,
    };
  }
  if (!args.fixture && !args.week1Results) {
    return {
      status: "INSUFFICIENT_DATA",
      reason: "No backtest output found yet — run the fixture backtest and the Week 1 starter test.",
    };
  }
  if (!args.week1Results) {
    return {
      status: "RESEARCH",
      reason: "Week 1 starter test not generated yet.",
    };
  }
  if (args.week1Results.qualifiedBets.length === 0) {
    return {
      status: "RESEARCH",
      reason: "No qualified plays in the Week 1 fixture sample.",
    };
  }
  return {
    status: "RESEARCH",
    reason: "Fixture results only — not proof of live edge until a real-data backtest lands.",
  };
}

function Hero({
  readiness,
  storedIsPrimary,
}: {
  readiness: Readiness;
  storedIsPrimary: boolean;
}) {
  const starter = getWeek1StarterTestContext();
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            readiness.status === "READY"
              ? "inline-flex items-center gap-2 rounded-full bg-sea-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sea-800 ring-1 ring-sea-200/80"
              : readiness.status === "INSUFFICIENT_DATA"
                ? "inline-flex items-center gap-2 rounded-full bg-cream-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-200/80"
                : "inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80"
          }
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {readiness.status.replace(/_/g, " ")}
        </span>
        <span
          className="inline-flex items-center gap-2 rounded-full bg-sea-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sea-800 ring-1 ring-sea-200/80"
          data-testid="monitor-active-test"
        >
          Active test · {starter.label}
        </span>
        {storedIsPrimary ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-sea-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80">
            Real stored Week 1 backtest active
          </span>
        ) : null}
        <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
          Leakage guard · pregame outcomes stripped
        </span>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
        Model Monitor
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-700">
        Aggregated view of fixture backtest health, Week 1 starter
        test output, V1 vs V2 deltas, proxy lift, and Game Edge /
        Parlay coverage. Player Props, Game Edge, and Parlay Builder
        each have their own pages — this monitor only summarises.
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-ink-500">
        {readiness.reason}
      </p>
    </section>
  );
}

function StoredWeek1Panel({ stored }: { stored: StoredWeek1MonitorSnapshot }) {
  const readyTone = stored.realWeek1BacktestReady
    ? "text-sea-700"
    : "text-amber-800";
  return (
    <section
      className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6"
      data-testid="monitor-stored-week-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Real Week 1 Stored Backtest
        </h2>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Source · {stored.source}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Data mode" value="STORED" />
        <Stat
          label="Real ready"
          value={stored.realWeek1BacktestReady ? "yes" : "no"}
          sub={stored.status}
        />
        <Stat label="Synthetic fixture" value="no" />
        <Stat
          label="Schedule validation"
          value={stored.scheduleValidationStatus ?? "—"}
        />
        <Stat label="Candidates" value={`${stored.candidateCount}`} />
        <Stat label="Stored odds" value={stored.storedOddsPresent ? "yes" : "no"} />
        <Stat label="Processed NFL" value={stored.processedNflPresent ? "yes" : "no"} />
        <Stat
          label="Grading"
          value={
            stored.gradingStatus === "graded"
              ? "graded"
              : stored.gradingStatus === "ungraded"
                ? "pending — pregame only"
                : "unavailable"
          }
        />
      </div>
      {stored.graded ? (
        <div className="mt-4 space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Graded results · stored Week 1
          </h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Qualified plays"
              value={`${stored.graded.qualifiedPlays}`}
              sub={`${stored.graded.candidatesWithActual} with actual stat`}
            />
            <Stat
              label="OVER hit rate"
              value={`${stored.graded.overSide.hitRatePct.toFixed(1)}%`}
              sub={`${stored.graded.overSide.wins}W · ${stored.graded.overSide.losses}L`}
            />
            <Stat
              label="OVER ROI"
              value={`${stored.graded.overSide.roiPct.toFixed(1)}%`}
              sub={`${stored.graded.overSide.unitsProfit.toFixed(2)} units`}
            />
            <Stat
              label="UNDER hit rate"
              value={`${stored.graded.underSide.hitRatePct.toFixed(1)}%`}
              sub={`${stored.graded.underSide.wins}W · ${stored.graded.underSide.losses}L`}
            />
            <Stat
              label="UNDER ROI"
              value={`${stored.graded.underSide.roiPct.toFixed(1)}%`}
              sub={`${stored.graded.underSide.unitsProfit.toFixed(2)} units`}
            />
            <Stat
              label="Better side"
              value={stored.graded.betterSide}
              sub={
                stored.graded.candidatesMissingActual > 0
                  ? `${stored.graded.candidatesMissingActual} no-stat skipped`
                  : undefined
              }
            />
          </div>
          <p className="text-[11px] text-ink-500">
            Graded at · {stored.graded.gradedAt}. Naive both-side
            grading at the recorded line + book odds. Not the
            scorecard model&rsquo;s pick — see
            /admin/ingestion for the grading action.
          </p>
        </div>
      ) : (
        <p className={`mt-3 text-[11px] ${readyTone}`}>
          {stored.realWeek1BacktestReady
            ? "Stored Week 1 pregame candidates loaded. Click \"Grade Week 1 stored backtest\" on /admin/ingestion to compute hit rate / ROI from processed nflverse stats. No API call."
            : `Stored run not ready: ${stored.status}. Run /admin/ingestion → Migrate → Run Week 1 stored backtest.`}
        </p>
      )}
      {stored.generatedAt ? (
        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Generated at · {stored.generatedAt}
        </p>
      ) : null}
    </section>
  );
}

function OverallHealth({
  fixture,
  week1Results,
  storedIsPrimary,
}: {
  fixture: ReturnType<typeof loadFixtureBacktestSummary>;
  week1Results: ReturnType<typeof loadWeek1Results>;
  storedIsPrimary: boolean;
}) {
  // When the real stored Week-1 run is the primary source, the
  // fixture starter-test's 8/2/100%/88.9% numbers MUST NOT be
  // displayed as the latest hit rate / ROI — that would
  // misrepresent fixture-synthetic data as real performance.
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        {storedIsPrimary
          ? "Fixture starter-test (synthetic) — overall health"
          : "Overall model health"}
      </h2>
      {storedIsPrimary ? (
        <p className="mt-1 text-[11px] text-amber-800">
          Fixture preview — not stored Week 1 performance. Use the
          stored panel above for real candidates.
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Evaluated props"
          value={`${(fixture?.evaluated ?? 0) + (week1Results?.evaluatedProps.length ?? 0)}`}
          sub={`${fixture?.evaluated ?? 0} fixture + ${week1Results?.evaluatedProps.length ?? 0} Week 1 fixture`}
        />
        <Stat
          label="Qualified bets"
          value={`${(fixture?.qualifiedBets ?? 0) + (week1Results?.qualifiedBets.length ?? 0)}`}
        />
        <Stat
          label={storedIsPrimary ? "Fixture hit rate" : "Latest hit rate"}
          value={
            storedIsPrimary
              ? fixture
                ? `${(fixture.hitRate * 100).toFixed(1)}%`
                : "—"
              : week1Results
                ? `${(week1Results.hitRate * 100).toFixed(1)}%`
                : fixture
                  ? `${(fixture.hitRate * 100).toFixed(1)}%`
                  : "—"
          }
          sub={storedIsPrimary ? "fixture-only" : undefined}
        />
        <Stat
          label={storedIsPrimary ? "Fixture ROI" : "Latest ROI"}
          value={
            storedIsPrimary
              ? fixture
                ? `${fixture.roiPct.toFixed(1)}%`
                : "—"
              : week1Results
                ? `${week1Results.roiPct.toFixed(1)}%`
                : fixture
                  ? `${fixture.roiPct.toFixed(1)}%`
                  : "—"
          }
          sub={storedIsPrimary ? "fixture-only" : undefined}
        />
        <Stat
          label="Avg edge"
          value={
            fixture
              ? `${(fixture.averageEdge * 100).toFixed(1)}%`
              : "—"
          }
        />
        <Stat
          label="Avg conf-adj edge"
          value={
            week1Results
              ? `${(week1Results.averageConfidenceAdjustedEdge * 100).toFixed(1)}%`
              : "—"
          }
          sub="Week 1 fixture only"
        />
        <Stat
          label="Brier score"
          value={fixture ? fixture.brierScore.toFixed(3) : "—"}
        />
        <Stat
          label="Max drawdown (units)"
          value={fixture ? fixture.maxDrawdownUnits.toFixed(2) : "—"}
        />
      </div>
    </section>
  );
}

function WeekByWeekTable({
  week1Results,
  stored,
  storedIsPrimary,
}: {
  week1Results: ReturnType<typeof loadWeek1Results>;
  stored: StoredWeek1MonitorSnapshot | undefined;
  storedIsPrimary: boolean;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Week-by-week performance
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
              <th className="pb-2 pr-3">Week</th>
              <th className="pb-2 pr-3 text-right">Evaluated</th>
              <th className="pb-2 pr-3 text-right">Qualified</th>
              <th className="pb-2 pr-3 text-right">W · L · P</th>
              <th className="pb-2 pr-3 text-right">Hit rate</th>
              <th className="pb-2 pr-3 text-right">ROI</th>
              <th className="pb-2 pr-3">Best · Worst</th>
              <th className="pb-2">Notes</th>
            </tr>
          </thead>
          <tbody className="text-ink-800">
            {storedIsPrimary && stored ? (
              stored.graded ? (
                <tr className="border-t border-white/40">
                  <td className="py-2 pr-3">Week 1 (stored, real)</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.candidateCount}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.graded.qualifiedPlays}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.graded.overSide.wins}/{stored.graded.underSide.wins} ·{" "}
                    {stored.graded.overSide.losses}/{stored.graded.underSide.losses}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.graded.overSide.hitRatePct.toFixed(1)}% /{" "}
                    {stored.graded.underSide.hitRatePct.toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.graded.overSide.roiPct.toFixed(1)}% /{" "}
                    {stored.graded.underSide.roiPct.toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3 text-[11px]">
                    Better · {stored.graded.betterSide}
                  </td>
                  <td className="py-2 text-[11px] text-sea-700">
                    OVER / UNDER, naive both-side grading
                  </td>
                </tr>
              ) : (
                <tr className="border-t border-white/40">
                  <td className="py-2 pr-3">Week 1 (stored, real)</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.candidateCount}
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    pending
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    pending
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    pending
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    pending
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-ink-500">—</td>
                  <td className="py-2 text-[11px] text-sea-700">
                    Pregame candidates only — not graded yet
                  </td>
                </tr>
              )
            ) : null}
            {week1Results ? (
              <tr className="border-t border-white/40">
                <td className="py-2 pr-3">
                  Week 1 (fixture starter test)
                  {storedIsPrimary ? (
                    <div className="text-[10px] text-amber-800">
                      synthetic
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {week1Results.evaluatedProps.length}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {week1Results.qualifiedBets.length}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {week1Results.wins} · {week1Results.losses} ·{" "}
                  {week1Results.pushes}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {(week1Results.hitRate * 100).toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {week1Results.roiPct.toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-[11px]">
                  {week1Results.bestPropType ?? "—"} ·{" "}
                  {week1Results.worstPropType ?? "—"}
                </td>
                <td className="py-2 text-[11px] text-amber-800">
                  Fixture data — not proof of live edge
                </td>
              </tr>
            ) : !stored ? (
              <tr className="border-t border-white/40">
                <td className="py-2 pr-3" colSpan={8}>
                  <span className="text-ink-500">
                    Week 1 starter test not generated yet — run{" "}
                    <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
                      npx tsx scripts/run-week-1-starter-test.ts
                    </code>
                    .
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlayerPropPerformance({
  fixture,
}: {
  fixture: ReturnType<typeof loadFixtureBacktestSummary>;
}) {
  if (!fixture) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          Player prop performance breakdown unavailable
        </div>
        <p className="mt-1 text-xs text-amber-900">
          Run{" "}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
            npx tsx scripts/run-backtest-2025.ts --fixtures
          </code>{" "}
          to populate the fixture summary.
        </p>
      </section>
    );
  }
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Player prop performance
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownPanel
          title="By prop type"
          rows={fixture.byPropType.map((p) => ({
            label: p.propType,
            bets: p.bets,
            hitRate: p.hitRate,
            roiPct: p.roiPct,
          }))}
        />
        <BreakdownPanel
          title="By edge bucket"
          rows={fixture.byEdgeBucket.map((b) => ({
            label: b.label,
            bets: b.bets,
            hitRate: b.hitRate,
            roiPct: b.roiPct,
          }))}
        />
        <BreakdownPanel
          title="By confidence"
          rows={fixture.byConfidence.map((b) => ({
            label: b.label,
            bets: b.bets,
            hitRate: b.hitRate,
            roiPct: b.roiPct,
          }))}
        />
        <BreakdownPanel
          title="By line bucket"
          rows={fixture.byLineBucket.slice(0, 6).map((b) => ({
            label: b.bucketLabel,
            bets: b.bets,
            hitRate: b.hitRate,
            roiPct: b.roiPct,
          }))}
        />
      </div>
      {fixture.byDisqualifier.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Primary disqualifiers
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-700">
            {fixture.byDisqualifier.slice(0, 5).map((d) => (
              <li
                key={d.disqualifier}
                className="flex items-center justify-between gap-3"
              >
                <span>{d.disqualifier}</span>
                <span className="tabular-nums text-ink-900">{d.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BreakdownPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; bets: number; hitRate: number; roiPct: number }>;
}) {
  return (
    <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {title}
      </div>
      <table className="mt-2 min-w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
            <th className="pb-1 pr-2">Label</th>
            <th className="pb-1 pr-2 text-right">Bets</th>
            <th className="pb-1 pr-2 text-right">Hit</th>
            <th className="pb-1 text-right">ROI</th>
          </tr>
        </thead>
        <tbody className="text-ink-800">
          {rows.length === 0 ? (
            <tr className="border-t border-white/40">
              <td className="py-1" colSpan={4}>
                <span className="text-ink-500">No data.</span>
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.label} className="border-t border-white/40">
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.bets}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {(r.hitRate * 100).toFixed(1)}%
                </td>
                <td
                  className={
                    "py-1 text-right tabular-nums " +
                    (r.roiPct >= 0 ? "text-sea-700" : "text-coral-700")
                  }
                >
                  {r.roiPct.toFixed(1)}%
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function V1V2Panel({
  compareLatest,
  changes,
  week1Comparison,
}: {
  compareLatest: ReturnType<typeof loadFixtureComparisonSummary>;
  changes: ReturnType<typeof loadFixtureRecommendationChanges>;
  week1Comparison: ReturnType<typeof loadWeek1V1V2Comparison>;
}) {
  const cmp = week1Comparison ?? compareLatest;
  if (!cmp) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          V1 vs V2 comparison not generated
        </div>
        <p className="mt-1 text-xs text-amber-900">
          Run{" "}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
            npx tsx scripts/run-week-1-starter-test.ts
          </code>{" "}
          or{" "}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
            npx tsx scripts/run-backtest-2025.ts --fixtures --algorithm-mode compare
          </code>
          .
        </p>
      </section>
    );
  }
  const topDisq =
    week1Comparison?.recommendationChangeSummary.topNewV2Disqualifiers ??
    changes?.topNewV2Disqualifiers ??
    [];
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        V1 vs V2
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="V1 qualified"
          value={`${cmp.v1.qualifiedBets}`}
          sub={`Hit ${(cmp.v1.hitRate * 100).toFixed(1)}% · ROI ${cmp.v1.roiPct.toFixed(1)}%`}
        />
        <Stat
          label="V2 qualified"
          value={`${cmp.v2.qualifiedBets}`}
          sub={`Hit ${(cmp.v2.hitRate * 100).toFixed(1)}% · ROI ${cmp.v2.roiPct.toFixed(1)}%`}
        />
        <Stat
          label="V2 filtered V1 plays"
          value={`${
            week1Comparison?.recommendationChangeSummary.v1OnlyBets ??
            changes?.v1OnlyBets ??
            0
          }`}
        />
        <Stat
          label="V2 new plays"
          value={`${
            week1Comparison?.recommendationChangeSummary.v2OnlyBets ??
            changes?.v2OnlyBets ??
            0
          }`}
        />
      </div>
      {topDisq.length > 0 && (
        <div className="mt-3 text-[11px] text-ink-600">
          Most common V2 disqualifier: {topDisq[0].disqualifier} (×
          {topDisq[0].count})
        </div>
      )}
    </section>
  );
}

function ProxyHealthPanel({
  proxySummary,
}: {
  proxySummary: ReturnType<typeof loadFixtureProxySummary>;
}) {
  if (!proxySummary) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          Proxy validation report not generated
        </div>
      </section>
    );
  }
  const perfEntries = Object.entries(proxySummary.performance);
  perfEntries.sort(
    (a, b) =>
      (b[1] as { liftPp?: number }).liftPp! -
      (a[1] as { liftPp?: number }).liftPp!,
  );
  const best = perfEntries[0];
  const worst = perfEntries[perfEntries.length - 1];
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Proxy / module health
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Proxies tracked" value={`${perfEntries.length}`} />
        <Stat
          label="False positives flagged"
          value={`${proxySummary.falsePositives.length}`}
        />
        <Stat
          label="Best proxy"
          value={best ? best[0] : "—"}
          sub={
            best
              ? `lift ${((best[1] as { liftPp?: number }).liftPp ?? 0).toFixed(1)}pp`
              : undefined
          }
        />
        <Stat
          label="Worst proxy"
          value={worst ? worst[0] : "—"}
          sub={
            worst
              ? `lift ${((worst[1] as { liftPp?: number }).liftPp ?? 0).toFixed(1)}pp`
              : undefined
          }
        />
      </div>
    </section>
  );
}

function GameEdgeMonitor({
  week1GameEdge,
}: {
  week1GameEdge: ReturnType<typeof loadWeek1GameEdgePreview>;
}) {
  if (!week1GameEdge) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          Game Edge preview not generated yet.
        </div>
      </section>
    );
  }
  const moneyline = week1GameEdge.games.filter(
    (g) =>
      g.recommendation === "HOME_MONEYLINE" ||
      g.recommendation === "AWAY_MONEYLINE",
  ).length;
  const spread = week1GameEdge.games.filter(
    (g) =>
      g.recommendation === "HOME_SPREAD" || g.recommendation === "AWAY_SPREAD",
  ).length;
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Game Edge monitor
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Games evaluated" value={`${week1GameEdge.games.length}`} />
        <Stat label="ML candidates" value={`${moneyline}`} />
        <Stat label="Spread candidates" value={`${spread}`} />
        <Stat label="Upset watch" value={`${week1GameEdge.upsetWatchCount}`} />
      </div>
      <div className="mt-3 text-[11px] text-ink-500">
        ROI placeholder — Game Edge has no historical backtest yet. See{" "}
        <Link href="/game-edge" className="underline">
          /game-edge
        </Link>{" "}
        for the per-game view.
      </div>
    </section>
  );
}

function ParlayMonitor({
  week1Parlays,
}: {
  week1Parlays: ReturnType<typeof loadWeek1ParlayPreview>;
}) {
  if (!week1Parlays) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          Parlay preview not generated yet.
        </div>
      </section>
    );
  }
  const counts = new Map<string, number>();
  for (const c of week1Parlays.candidates) {
    counts.set(c.parlayType, (counts.get(c.parlayType) ?? 0) + 1);
  }
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Parlay monitor
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Evaluated" value={`${week1Parlays.candidates.length}`} />
        <Stat
          label="Qualified"
          value={`${week1Parlays.candidates.filter((c) => c.qualified).length}`}
        />
        <Stat
          label="Avg projected hit"
          value={`${(week1Parlays.portfolioSummary.averageProjectedHitRate * 100).toFixed(1)}%`}
        />
        <Stat
          label="Avg required hit"
          value={`${(week1Parlays.portfolioSummary.averageRequiredHitRate * 100).toFixed(1)}%`}
        />
        <Stat
          label="Avg payout"
          value={`${week1Parlays.portfolioSummary.averagePayoutMultiplier.toFixed(2)}x`}
        />
        <Stat
          label="Avg conf-adj EV"
          value={`${(week1Parlays.portfolioSummary.averageConfidenceAdjustedEV * 100).toFixed(1)}%`}
        />
        <Stat
          label="High-risk filtered"
          value={`${week1Parlays.portfolioSummary.highRiskFilteredOut}`}
        />
        <Stat
          label="100-parlay batch ROI"
          value={`${(week1Parlays.batchSimulation.expectedROI * 100).toFixed(1)}%`}
        />
      </div>
      {counts.size > 0 && (
        <div className="mt-3 text-[11px] text-ink-600">
          Parlay type breakdown:{" "}
          {Array.from(counts.entries())
            .map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} (${v})`)
            .join("; ")}
        </div>
      )}
    </section>
  );
}

function WarningsPanel() {
  return (
    <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900">
        Discipline reminders
      </div>
      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-900">
        <li>Fixture results are not proof of live edge.</li>
        <li>The backtest runner uses stored data only.</li>
        <li>No live betting automation is enabled.</li>
        <li>No touchdown props in V1.</li>
      </ul>
    </section>
  );
}

function RunHint({ showRunHint }: { showRunHint: boolean }) {
  if (!showRunHint) return null;
  return (
    <section className="rounded-2xl bg-white/65 p-4 ring-1 ring-white/40">
      <div className="text-sm font-semibold text-ink-900">
        Generate this dashboard&rsquo;s data
      </div>
      <p className="mt-1 text-xs text-ink-700">
        The monitor renders cleanly even without inputs — but the
        full panels light up once you run:
      </p>
      <ul className="mt-2 space-y-1 text-[11px] text-ink-700">
        <li>
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono">
            npx tsx scripts/run-week-1-starter-test.ts
          </code>{" "}
          — Week 1 starter test
        </li>
        <li>
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono">
            npx tsx scripts/run-backtest-2025.ts --fixtures --algorithm-mode compare
          </code>{" "}
          — V1 vs V2 comparison
        </li>
      </ul>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/65 p-3 ring-1 ring-white/40">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-ink-900">{value}</div>
      {sub && <div className="text-[11px] text-ink-600">{sub}</div>}
    </div>
  );
}
