import Link from "next/link";
import { redirect } from "next/navigation";
import {
  loadAllStoredMonitorSnapshots,
  loadStoredWeek1MonitorSnapshot,
} from "@/lib/backtest/week-1-monitor-summary";
import { WeekSelector } from "@/components/WeekSelector";

export const dynamic = "force-dynamic";

interface WeekPageProps {
  params: Promise<{ week: string }>;
}

function weekRoute(week: number | undefined): string {
  if (week === undefined) return "/backtest";
  if (week === 1) return "/backtest/week-1";
  return `/backtest/weeks/${week}`;
}

export default async function BacktestWeekDetailPage(props: WeekPageProps) {
  const params = await props.params;
  const week = Number(params.week);
  if (!Number.isFinite(week) || week < 1 || week > 22) {
    redirect("/backtest");
  }
  // Week 1 has its own canonical detail page with the rich
  // fixture content. Redirect there so /backtest/weeks/1 doesn't
  // duplicate the Week 1 detail experience.
  if (week === 1) {
    redirect("/backtest/week-1");
  }

  const snapshot = await loadStoredWeek1MonitorSnapshot({
    season: 2025,
    week,
  });
  const allStoredWeeks = await loadAllStoredMonitorSnapshots({ season: 2025 });

  return (
    <div className="space-y-6">
      <section>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-sea-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sea-800 ring-1 ring-sea-200/80">
            Stored backtest · Week {week}
          </span>
          <Link
            href="/backtest/week-1"
            className="text-[11px] text-ink-600 underline"
          >
            Week 1
          </Link>
          <Link href="/monitor" className="text-[11px] text-ink-600 underline">
            Season aggregate (/monitor)
          </Link>
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
          Week {week} stored backtest
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-700">
          Per-week detail view. Each (season, week) StoredBacktestRun
          lives independently in Postgres — opening a different week
          never overwrites Week 1 or any other week.
        </p>
      </section>

      <WeekSelector
        mode="route"
        selectedWeek={week}
        options={allStoredWeeks.map((w) => ({
          week: w.week,
          graded: w.graded !== undefined,
        }))}
        routeFor={weekRoute}
        label="Switch week"
        hint="All routes to /backtest (fixture summary). Each numeric week routes to its detail page."
        testid="backtest-week-selector"
      />

      {snapshot === undefined ? (
        <section
          className="rounded-2xl bg-amber-50/70 p-5 ring-1 ring-amber-200/60 sm:p-6"
          data-testid="backtest-week-not-found"
        >
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-amber-900">
            No data for Week {week}
          </h2>
          <p className="mt-2 text-[11px] text-amber-900">
            No stored backtest data for this week yet. Run the
            stored-data pipeline for this week first
            (see <code>scripts/run-stored-pipeline-weeks-2-6.ts</code>) or
            switch to a week that has been graded.
          </p>
        </section>
      ) : (
        <StoredWeekSummary week={week} snapshot={snapshot} />
      )}
    </div>
  );
}

function StoredWeekSummary({
  week,
  snapshot,
}: {
  week: number;
  snapshot: NonNullable<
    Awaited<ReturnType<typeof loadStoredWeek1MonitorSnapshot>>
  >;
}) {
  const graded = snapshot.graded;
  return (
    <section
      className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6"
      data-testid="backtest-week-summary"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Week {week} summary
        </h2>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Source · {snapshot.source}
        </span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-800 sm:grid-cols-3">
        <Row label="Status" value={snapshot.status} />
        <Row label="Candidates" value={`${snapshot.candidateCount}`} />
        <Row
          label="Schedule validation"
          value={snapshot.scheduleValidationStatus ?? "—"}
        />
        <Row
          label="Stored odds"
          value={snapshot.storedOddsPresent ? "yes" : "no"}
        />
        <Row
          label="Processed NFL"
          value={snapshot.processedNflPresent ? "yes" : "no"}
        />
        <Row
          label="Grading status"
          value={
            snapshot.gradingStatus === "graded"
              ? "graded"
              : snapshot.gradingStatus === "ungraded"
                ? "pregame — not graded"
                : "unavailable"
          }
        />
      </dl>
      {graded ? (
        <>
          <p className="mt-3 text-[11px] text-ink-500">
            Graded at · {graded.gradedAt}
          </p>
          {graded.asOfReport ? (
            <p className="mt-1 text-[11px]">
              <span
                className={
                  graded.asOfReport.ok
                    ? "rounded-full bg-sea-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80"
                    : "rounded-full bg-coral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-coral-900 ring-1 ring-coral-300/80"
                }
              >
                As-of · {graded.asOfReport.ok ? "PASS" : "FAIL"}
              </span>
              <span className="ml-2 text-ink-500">
                {graded.asOfReport.candidatesValid}/
                {graded.asOfReport.candidatesChecked} candidates ·
                snapshot &lt; kickoff &amp; strict-before history
              </span>
            </p>
          ) : null}
          <RecommendedPlaysBlock graded={graded} />
          <UniverseBlock graded={graded} />
          {graded.marketContextCalibration ? (
            <CalibrationBlock
              calibration={graded.marketContextCalibration}
            />
          ) : null}
        </>
      ) : (
        <p className="mt-3 text-[11px] text-amber-800">
          Pregame candidates only — grading has not been run for this
          week. Trigger grading via the admin runner or{" "}
          <code>scripts/run-stored-pipeline-weeks-2-6.ts --weeks {week}</code>.
        </p>
      )}
    </section>
  );
}

function RecommendedPlaysBlock({
  graded,
}: {
  graded: NonNullable<
    Awaited<ReturnType<typeof loadStoredWeek1MonitorSnapshot>>
  >["graded"];
}) {
  if (!graded) return null;
  const r = graded.recommendedPlays;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
          Recommended Plays Performance
        </h3>
        <span
          className={
            r.enabled
              ? "rounded-full bg-sea-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80"
              : "rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-300/80"
          }
        >
          {r.enabled ? "Real betting performance" : "Not yet evaluated"}
        </span>
      </div>
      {r.enabled ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <SmallCell
            label="Plays"
            value={`${r.count}`}
            sub={`${r.wins}W · ${r.losses}L · ${r.pushes}P`}
          />
          <SmallCell label="Hit rate" value={`${r.hitRatePct.toFixed(1)}%`} />
          <SmallCell
            label="ROI"
            value={`${r.roiPct.toFixed(1)}%`}
            sub={`${r.unitsProfit.toFixed(2)} units`}
          />
          <SmallCell
            label="Avg edge / conf"
            value={`${r.averageEdgePct.toFixed(1)}% / ${r.averageConfidence.toFixed(2)}`}
          />
        </div>
      ) : (
        <p className="mt-2 rounded-lg bg-ink-100/50 p-3 text-[11px] text-ink-700">
          {r.note}
        </p>
      )}
    </div>
  );
}

function UniverseBlock({
  graded,
}: {
  graded: NonNullable<
    Awaited<ReturnType<typeof loadStoredWeek1MonitorSnapshot>>
  >["graded"];
}) {
  if (!graded) return null;
  const u = graded.universeDiagnostics;
  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
          Candidate Universe Diagnostics
        </h3>
        <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
          Model diagnostic only · not betting performance
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <SmallCell label="Total candidates" value={`${u.totalCandidates}`} />
        <SmallCell
          label="OVER · W / L"
          value={`${u.overSide.wins} / ${u.overSide.losses}`}
          sub={`${u.overSide.hitRatePct.toFixed(1)}% hit`}
        />
        <SmallCell
          label="UNDER · W / L"
          value={`${u.underSide.wins} / ${u.underSide.losses}`}
          sub={`${u.underSide.hitRatePct.toFixed(1)}% hit`}
        />
        <SmallCell
          label="Better side"
          value={u.betterSide}
          sub="diagnostic"
        />
      </div>
    </div>
  );
}

function CalibrationBlock({
  calibration,
}: {
  calibration: NonNullable<
    NonNullable<
      Awaited<ReturnType<typeof loadStoredWeek1MonitorSnapshot>>
    >["graded"]
  >["marketContextCalibration"];
}) {
  if (!calibration) return null;
  return (
    <div className="mt-4 rounded-2xl bg-white/65 p-4 ring-1 ring-amber-200/70">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900">
          Market Context Gate Calibration · DIAGNOSTIC ONLY
        </h3>
        <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
          Production gate · {calibration.productionGate.toFixed(2)}
        </span>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full text-[11px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
              <th className="pb-1 pr-2">Gate</th>
              <th className="pb-1 pr-2 text-right">Plays</th>
              <th className="pb-1 pr-2 text-right">W·L·P</th>
              <th className="pb-1 pr-2 text-right">Hit</th>
              <th className="pb-1 pr-2 text-right">ROI</th>
              <th className="pb-1 text-right">Units</th>
            </tr>
          </thead>
          <tbody className="text-ink-800">
            {[
              calibration.production,
              calibration.gate040,
              calibration.gate035,
            ].map((g) => (
              <tr key={g.gateThreshold} className="border-t border-white/40">
                <td className="py-1 pr-2">
                  {g.isProduction ? (
                    <span className="text-sea-700 font-semibold">
                      Production {g.gateThreshold.toFixed(2)}
                    </span>
                  ) : (
                    <span className="text-amber-900">
                      Diagnostic {g.gateThreshold.toFixed(2)}
                    </span>
                  )}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {g.qualifiedCount}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {g.wins}·{g.losses}·{g.pushes}
                </td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {g.hitRatePct.toFixed(1)}%
                </td>
                <td
                  className={
                    "py-1 pr-2 text-right tabular-nums " +
                    (g.roiPct >= 0 ? "text-sea-700" : "text-coral-700")
                  }
                >
                  {g.roiPct.toFixed(1)}%
                </td>
                <td className="py-1 text-right tabular-nums">
                  {g.unitsProfit.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/40 pb-1.5">
      <dt className="text-ink-600">{label}</dt>
      <dd className="text-right font-mono text-[11px] text-ink-900">{value}</dd>
    </div>
  );
}

function SmallCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-white/65 px-3 py-2 ring-1 ring-white/40">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-ink-900">{value}</div>
      {sub ? <div className="text-[10px] text-ink-500">{sub}</div> : null}
    </div>
  );
}
