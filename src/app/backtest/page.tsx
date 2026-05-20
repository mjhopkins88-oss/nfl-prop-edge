import StatCard from "@/components/StatCard";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ChartBarIcon,
  ClockIcon,
  SparkleIcon,
  TargetIcon,
  TrendDownIcon,
  TrendUpIcon,
} from "@/components/icons";
import { getBacktestSummary } from "@/lib/data/backtest";
import { loadFixtureBacktestSummary } from "@/lib/backtest/fixture-summary";
import { PROP_TYPE_SHORT } from "@/lib/prop-utils";

export default function BacktestPage() {
  const s = getBacktestSummary();
  const fixture = loadFixtureBacktestSummary();

  const winRate = s.wins / Math.max(1, s.totalPlays);
  const profit = s.unitsReturn - s.unitsStaked;
  const maxMarketAbsRoi = Math.max(...s.byMarket.map((m) => Math.abs(m.roiPct)), 1);
  const maxConfRoi = Math.max(...s.byConfidence.map((c) => Math.abs(c.roiPct)), 1);
  const maxEdgeRoi = Math.max(...s.byEdgeBucket.map((b) => Math.abs(b.roiPct)), 1);

  return (
    <div className="space-y-8">
      {/* HERO */}
      <section>
        <div className="inline-flex items-center gap-2 rounded-full bg-white/65 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-sea-700 ring-1 ring-sea-200/60 backdrop-blur">
          <ChartBarIcon className="h-3 w-3" />
          {s.windowLabel}
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          Backtest{" "}
          <span className="bg-gradient-to-r from-sea-600 via-sky2-500 to-amber-500 bg-clip-text text-transparent">
            performance
          </span>
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-ink-700">
          How the V1 baseline model performed across the lower-variance prop
          slate this season. Sliced by market, confidence tier, and the edge
          our model claimed at recommendation time.
        </p>
      </section>

      {!fixture && (
        <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
          <div className="flex items-start gap-3">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div>
              <div className="text-sm font-medium text-amber-900">
                Live fixture backtest not yet generated.
              </div>
              <div className="mt-0.5 text-xs text-amber-800">
                Run{" "}
                <code className="rounded bg-white/70 px-1.5 py-0.5 font-mono text-[11px]">
                  npx tsx scripts/run-backtest-2025.ts --fixtures
                </code>{" "}
                to populate{" "}
                <code className="font-mono text-[11px]">
                  data/backtests/2025/backtest-summary.fixture.json
                </code>
                . The static performance summary below stays available
                regardless.
              </div>
            </div>
          </div>
        </section>
      )}

      {fixture && (
        <section className="glass-strong rounded-3xl p-6 sm:p-8">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-sea-700">
                Live fixture backtest
              </div>
              <h2 className="mt-1 text-xl font-semibold text-ink-900">
                {fixture.scope.season} · Weeks {fixture.scope.startWeek}–
                {fixture.scope.endWeek}
              </h2>
            </div>
            <div className="text-[11px] text-ink-500">
              {fixture.scope.propTypes.length} prop types · generated{" "}
              {new Date(fixture.generatedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <FixtureMetric label="Evaluated props" value={`${fixture.evaluated}`} />
            <FixtureMetric
              label="Qualified bets"
              value={`${fixture.qualifiedBets}`}
              sub={`${fixture.passes} passes`}
            />
            <FixtureMetric
              label="Hit rate"
              value={`${(fixture.hitRate * 100).toFixed(1)}%`}
              sub={`${fixture.wins}W / ${fixture.losses}L / ${fixture.pushes}P`}
              tone={fixture.hitRate >= 0.55 ? "positive" : "neutral"}
            />
            <FixtureMetric
              label="ROI"
              value={`${fixture.roiPct >= 0 ? "+" : ""}${fixture.roiPct.toFixed(1)}%`}
              sub={`${fixture.profitUnits >= 0 ? "+" : ""}${fixture.profitUnits.toFixed(2)} units`}
              tone={fixture.roiPct >= 0 ? "positive" : "negative"}
            />
            <FixtureMetric
              label="Avg edge"
              value={`${(fixture.averageEdge * 100).toFixed(1)}%`}
            />
            <FixtureMetric
              label="Avg EV / unit"
              value={fixture.averageExpectedValueUnits.toFixed(3)}
            />
            <FixtureMetric
              label="Best prop type"
              value={fixture.bestPropType ?? "—"}
            />
            <FixtureMetric
              label="Most common disq"
              value={fixture.mostCommonDisqualifier ?? "—"}
            />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <FixturePanel title="Performance by prop type">
              <SimpleTable
                rows={fixture.byPropType.map((b) => ({
                  label: b.propType,
                  bets: b.bets,
                  hitRate: b.hitRate,
                  roiPct: b.roiPct,
                }))}
              />
            </FixturePanel>
            <FixturePanel title="Performance by edge bucket">
              <SimpleTable
                rows={fixture.byEdgeBucket.map((b) => ({
                  label: b.label,
                  bets: b.bets,
                  hitRate: b.hitRate,
                  roiPct: b.roiPct,
                }))}
              />
            </FixturePanel>
            <FixturePanel title="Performance by confidence">
              <SimpleTable
                rows={fixture.byConfidence.map((b) => ({
                  label: b.label,
                  bets: b.bets,
                  hitRate: b.hitRate,
                  roiPct: b.roiPct,
                }))}
              />
            </FixturePanel>
            <FixturePanel title="Primary disqualifiers">
              <ul className="space-y-1 text-sm text-ink-700">
                {fixture.byDisqualifier.length === 0 ? (
                  <li className="text-ink-500">No disqualifiers.</li>
                ) : (
                  fixture.byDisqualifier.map((d) => (
                    <li
                      key={d.disqualifier}
                      className="flex items-center justify-between"
                    >
                      <span>{d.disqualifier}</span>
                      <span className="tabular text-ink-900">{d.count}</span>
                    </li>
                  ))
                )}
              </ul>
            </FixturePanel>
            {fixture.byCoachingUncertainty.length > 0 && (
              <FixturePanel title="Performance by coaching uncertainty">
                <SimpleTable
                  rows={fixture.byCoachingUncertainty.map((b) => ({
                    label: b.label,
                    bets: b.bets,
                    hitRate: b.hitRate,
                    roiPct: b.roiPct,
                  }))}
                />
              </FixturePanel>
            )}
            {fixture.byWeatherRisk.length > 0 && (
              <FixturePanel title="Performance by weather risk">
                <SimpleTable
                  rows={fixture.byWeatherRisk.map((b) => ({
                    label: b.label,
                    bets: b.bets,
                    hitRate: b.hitRate,
                    roiPct: b.roiPct,
                  }))}
                />
              </FixturePanel>
            )}
            {fixture.byLineBucket.length > 0 && (
              <FixturePanel title="Performance by line bucket">
                <SimpleTable
                  rows={fixture.byLineBucket.map((b) => ({
                    label: b.bucketLabel,
                    bets: b.bets,
                    hitRate: b.hitRate,
                    roiPct: b.roiPct,
                  }))}
                />
              </FixturePanel>
            )}
            {fixture.byPostmortem.length > 0 && (
              <FixturePanel title="Performance by postmortem tag">
                <SimpleTable
                  rows={fixture.byPostmortem.map((b) => ({
                    label: prettyTag(b.bucketLabel),
                    bets: b.evaluated,
                    hitRate: b.hitRate,
                    roiPct: b.roiPct,
                  }))}
                />
              </FixturePanel>
            )}
            {fixture.byQualifiedVsPassed.length > 0 && (
              <FixturePanel title="Qualified bets vs passed props">
                <SimpleTable
                  rows={fixture.byQualifiedVsPassed.map((b) => ({
                    label: b.bucketLabel,
                    bets: b.evaluated,
                    hitRate: b.hitRate,
                    roiPct: b.roiPct,
                  }))}
                />
              </FixturePanel>
            )}
          </div>

          <div className="mt-6 rounded-2xl bg-white/70 p-4 ring-1 ring-ink-200/40 backdrop-blur">
            <div className="mb-3 flex items-center gap-2">
              <SparkleIcon className="h-4 w-4 text-amber-700" />
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
                Model improvement signals
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <AuditCell label="Best prop type" value={fixture.audit.bestPropType} positive />
              <AuditCell label="Worst prop type" value={fixture.audit.worstPropType} negative />
              <AuditCell label="Best line bucket" value={fixture.audit.bestLineBucket} positive />
              <AuditCell label="Worst line bucket" value={fixture.audit.worstLineBucket} negative />
              <AuditCell
                label="Highest-ROI edge bucket"
                value={fixture.audit.highestRoiEdgeBucket}
                positive
              />
              <AuditCell
                label="Lowest-ROI edge bucket"
                value={fixture.audit.lowestRoiEdgeBucket}
                negative
              />
              <AuditCell
                label="Filter that saved the most losses"
                value={fixture.audit.filterSavedMostLosses && prettyTag(fixture.audit.filterSavedMostLosses)}
                positive
              />
              <AuditCell
                label="Filter that may be too conservative"
                value={fixture.audit.filterTooConservative && prettyTag(fixture.audit.filterTooConservative)}
                negative
              />
              <AuditCell
                label="Best confidence tier"
                value={fixture.audit.bestConfidenceTier}
                positive
              />
              <AuditCell
                label="PASS counterfactual hit rate"
                value={
                  typeof fixture.audit.passCounterfactualHitRate === "number"
                    ? `${(fixture.audit.passCounterfactualHitRate * 100).toFixed(0)}%`
                    : undefined
                }
              />
            </div>
            {fixture.audit.notes.length > 0 && (
              <ul className="mt-4 space-y-1 text-xs text-ink-700">
                {fixture.audit.notes.map((n, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-600" />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* SUMMARY CARDS */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="ROI"
          value={`${s.roiPct >= 0 ? "+" : ""}${s.roiPct.toFixed(1)}%`}
          hint={`${profit >= 0 ? "+" : ""}${profit.toFixed(1)} units`}
          tone={s.roiPct >= 0 ? "positive" : "negative"}
          icon={<SparkleIcon className="h-4 w-4" />}
          accent="amber"
        />
        <StatCard
          label="Hit rate"
          value={`${(winRate * 100).toFixed(1)}%`}
          hint={`${s.wins}-${s.losses}-${s.pushes}`}
          tone={winRate >= 0.5 ? "positive" : "negative"}
          icon={<TargetIcon className="h-4 w-4" />}
          accent="teal"
        />
        <StatCard
          label="Plays graded"
          value={`${s.totalPlays}`}
          hint={`${s.unitsStaked.toFixed(0)} units staked`}
          icon={<ChartBarIcon className="h-4 w-4" />}
          accent="blue"
        />
        <StatCard
          label="Best market"
          value={`+${s.bestMarket.roiPct.toFixed(1)}%`}
          hint={PROP_TYPE_SHORT[s.bestMarket.propType]}
          tone="positive"
          icon={<TrendUpIcon className="h-4 w-4" />}
          accent="coral"
        />
      </section>

      {/* BY MARKET */}
      <section className="glass rounded-2xl p-6">
        <header className="mb-4 flex items-baseline justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
            <ChartBarIcon className="h-3.5 w-3.5" />
            Performance by prop type
          </div>
          <span className="text-xs text-ink-500">{s.byMarket.length} markets</span>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
              <tr>
                <th className="py-2 pr-4 text-left">Market</th>
                <th className="py-2 pr-4 text-right">Plays</th>
                <th className="py-2 pr-4 text-right">Hit rate</th>
                <th className="py-2 pr-4 text-right">Units</th>
                <th className="py-2 pr-4 text-right">ROI</th>
                <th className="py-2 text-left">Visual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200/60">
              {s.byMarket.map((m) => (
                <tr key={m.propType}>
                  <td className="py-2.5 pr-4 font-medium text-ink-900">
                    {PROP_TYPE_SHORT[m.propType]}
                  </td>
                  <td className="tabular py-2.5 pr-4 text-right text-ink-700">
                    {m.plays}
                  </td>
                  <td className="tabular py-2.5 pr-4 text-right text-ink-700">
                    {(m.hitRate * 100).toFixed(1)}%
                  </td>
                  <td
                    className={`tabular py-2.5 pr-4 text-right ${m.roiUnits >= 0 ? "text-sea-700" : "text-coral-600"}`}
                  >
                    {m.roiUnits >= 0 ? "+" : ""}
                    {m.roiUnits.toFixed(1)}
                  </td>
                  <td
                    className={`tabular py-2.5 pr-4 text-right font-medium ${m.roiPct >= 0 ? "text-sea-700" : "text-coral-600"}`}
                  >
                    {m.roiPct >= 0 ? "+" : ""}
                    {m.roiPct.toFixed(1)}%
                  </td>
                  <td className="py-2.5">
                    <SignedBar value={m.roiPct} max={maxMarketAbsRoi} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* BY CONFIDENCE + BY EDGE BUCKET */}
      <section className="grid gap-6 lg:grid-cols-2">
        <BucketCard
          title="By confidence tier"
          icon={<ActivityIcon className="h-3.5 w-3.5" />}
          rows={s.byConfidence.map((c) => ({
            label: c.tier,
            plays: c.plays,
            hitRate: c.hitRate,
            roiPct: c.roiPct,
            roiUnits: c.roiUnits,
            badgeTone: c.tier === "High" ? "positive" : c.tier === "Medium" ? "amber" : "neutral",
          }))}
          maxAbs={maxConfRoi}
        />
        <BucketCard
          title="By model edge bucket"
          icon={<SparkleIcon className="h-3.5 w-3.5" />}
          rows={s.byEdgeBucket.map((b) => ({
            label: b.bucket,
            plays: b.plays,
            hitRate: b.hitRate,
            roiPct: b.roiPct,
            roiUnits: b.roiUnits,
            badgeTone: b.roiPct >= 10 ? "positive" : b.roiPct >= 4 ? "amber" : "neutral",
          }))}
          maxAbs={maxEdgeRoi}
        />
      </section>

      {/* FEATURE-DRIVEN BUCKETS */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
            <ChartBarIcon className="h-3.5 w-3.5" />
            Performance by feature
          </div>
          <span className="text-xs text-ink-500">
            From the V1 feature framework — calibration over real data lands once
            the loader is wired in.
          </span>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <BucketCard
            title="By role stability"
            icon={<ActivityIcon className="h-3.5 w-3.5" />}
            rows={s.byRoleStability.map((b) => ({
              label: b.bucket,
              plays: b.plays,
              hitRate: b.hitRate,
              roiPct: b.roiPct,
              roiUnits: b.roiUnits,
              badgeTone:
                b.bucket.startsWith("High") ? "positive" : b.bucket.startsWith("Low") ? "neutral" : "amber",
            }))}
            maxAbs={Math.max(...s.byRoleStability.map((b) => Math.abs(b.roiPct)), 1)}
          />
          <BucketCard
            title="By game script"
            icon={<SparkleIcon className="h-3.5 w-3.5" />}
            rows={s.byGameScript.map((b) => ({
              label: b.bucket,
              plays: b.plays,
              hitRate: b.hitRate,
              roiPct: b.roiPct,
              roiUnits: b.roiUnits,
              badgeTone: b.bucket.startsWith("Positive") ? "positive" : b.bucket.startsWith("Negative") ? "neutral" : "amber",
            }))}
            maxAbs={Math.max(...s.byGameScript.map((b) => Math.abs(b.roiPct)), 1)}
          />
          <BucketCard
            title="By weather risk"
            icon={<AlertTriangleIcon className="h-3.5 w-3.5" />}
            rows={s.byWeatherRisk.map((b) => ({
              label: b.bucket,
              plays: b.plays,
              hitRate: b.hitRate,
              roiPct: b.roiPct,
              roiUnits: b.roiUnits,
              badgeTone: b.bucket.startsWith("Indoor") ? "positive" : b.bucket.startsWith("Severe") ? "neutral" : "amber",
            }))}
            maxAbs={Math.max(...s.byWeatherRisk.map((b) => Math.abs(b.roiPct)), 1)}
          />
          <BucketCard
            title="By injury uncertainty"
            icon={<AlertTriangleIcon className="h-3.5 w-3.5" />}
            rows={s.byInjuryUncertainty.map((b) => ({
              label: b.bucket,
              plays: b.plays,
              hitRate: b.hitRate,
              roiPct: b.roiPct,
              roiUnits: b.roiUnits,
              badgeTone: b.bucket.startsWith("Low") ? "positive" : b.bucket.startsWith("High") ? "neutral" : "amber",
            }))}
            maxAbs={Math.max(...s.byInjuryUncertainty.map((b) => Math.abs(b.roiPct)), 1)}
          />
          <BucketCard
            title="By data quality"
            icon={<ChartBarIcon className="h-3.5 w-3.5" />}
            rows={s.byDataQuality.map((b) => ({
              label: b.bucket,
              plays: b.plays,
              hitRate: b.hitRate,
              roiPct: b.roiPct,
              roiUnits: b.roiUnits,
              badgeTone: b.bucket.startsWith("High") ? "positive" : b.bucket.startsWith("Low") ? "neutral" : "amber",
            }))}
            maxAbs={Math.max(...s.byDataQuality.map((b) => Math.abs(b.roiPct)), 1)}
          />
        </div>
      </section>

      {/* WORST MARKET — explicit callout */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Callout
          tone="positive"
          icon={<TrendUpIcon className="h-4 w-4" />}
          label="Best performing"
          line={PROP_TYPE_SHORT[s.bestMarket.propType]}
          stat={`+${s.bestMarket.roiPct.toFixed(1)}% ROI`}
          sub={`${s.bestMarket.plays} plays · ${(s.bestMarket.hitRate * 100).toFixed(1)}% hit rate · +${s.bestMarket.roiUnits.toFixed(1)} units`}
        />
        <Callout
          tone="negative"
          icon={<TrendDownIcon className="h-4 w-4" />}
          label="Worst performing"
          line={PROP_TYPE_SHORT[s.worstMarket.propType]}
          stat={`${s.worstMarket.roiPct.toFixed(1)}% ROI`}
          sub={`${s.worstMarket.plays} plays · ${(s.worstMarket.hitRate * 100).toFixed(1)}% hit rate · ${s.worstMarket.roiUnits >= 0 ? "+" : ""}${s.worstMarket.roiUnits.toFixed(1)} units`}
        />
      </section>

      <section className="flex items-center gap-2 text-xs text-ink-500">
        <ClockIcon className="h-3.5 w-3.5" />
        Backtest derived from {s.totalPlays} graded plays across 10 weeks.
        Numbers are V1 mock — wire {`Projection`} + settled results to
        replace.
      </section>
    </div>
  );
}

type BucketRow = {
  label: string;
  plays: number;
  hitRate: number;
  roiPct: number;
  roiUnits: number;
  badgeTone: "positive" | "amber" | "neutral";
};

function BucketCard({
  title,
  icon,
  rows,
  maxAbs,
}: {
  title: string;
  icon: React.ReactNode;
  rows: BucketRow[];
  maxAbs: number;
}) {
  return (
    <div className="glass rounded-2xl p-6">
      <header className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
        <span>{icon}</span>
        {title}
      </header>
      <div className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.label}
            className="rounded-xl bg-white/55 p-3 ring-1 ring-ink-200/50"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={
                    "inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-semibold ring-1 " +
                    (r.badgeTone === "positive"
                      ? "bg-sea-50 text-sea-700 ring-sea-200"
                      : r.badgeTone === "amber"
                        ? "bg-amber-50 text-amber-700 ring-amber-200"
                        : "bg-cream-100 text-ink-700 ring-ink-200")
                  }
                >
                  {r.label}
                </span>
                <span className="text-xs text-ink-500">{r.plays} plays</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="tabular text-ink-600">
                  {(r.hitRate * 100).toFixed(1)}% hit
                </span>
                <span
                  className={`tabular font-semibold ${r.roiPct >= 0 ? "text-sea-700" : "text-coral-600"}`}
                >
                  {r.roiPct >= 0 ? "+" : ""}
                  {r.roiPct.toFixed(1)}% ROI
                </span>
              </div>
            </div>
            <div className="mt-2">
              <SignedBar value={r.roiPct} max={maxAbs} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SignedBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.abs(value / max) * 100);
  const positive = value >= 0;
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-ink-200/40">
      <div className="absolute left-1/2 top-0 h-full w-px bg-ink-300/80" />
      <div
        className={`absolute top-0 h-full ${
          positive
            ? "bg-gradient-to-r from-sea-400 to-sea-600"
            : "bg-gradient-to-l from-coral-300 to-coral-500"
        }`}
        style={{
          left: positive ? "50%" : `${50 - pct / 2}%`,
          width: `${pct / 2}%`,
        }}
      />
    </div>
  );
}

function Callout({
  tone,
  icon,
  label,
  line,
  stat,
  sub,
}: {
  tone: "positive" | "negative";
  icon: React.ReactNode;
  label: string;
  line: string;
  stat: string;
  sub: string;
}) {
  const ring = tone === "positive" ? "ring-sea-300/60" : "ring-coral-300/60";
  const blob =
    tone === "positive"
      ? "from-sea-200/60 via-emerald-100/40"
      : "from-coral-200/60 via-rose-100/40";
  const statClass =
    tone === "positive" ? "text-sea-700" : "text-coral-600";
  return (
    <div
      className={`glass relative overflow-hidden rounded-2xl p-5 ring-1 ${ring}`}
    >
      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${blob} to-transparent blur-2xl`}
      />
      <div className="relative flex items-start gap-3">
        <div
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
            tone === "positive"
              ? "bg-sea-50 text-sea-700 ring-1 ring-sea-200"
              : "bg-rose-50 text-coral-600 ring-1 ring-coral-200"
          }`}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
            {label}
          </div>
          <div className="mt-0.5 flex items-baseline gap-3">
            <span className="text-base font-semibold text-ink-900">{line}</span>
            <span className={`tabular text-lg font-semibold ${statClass}`}>
              {stat}
            </span>
          </div>
          <div className="mt-1 text-xs text-ink-600">{sub}</div>
        </div>
      </div>
    </div>
  );
}

function FixtureMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "neutral" | "negative";
}) {
  const accent =
    tone === "positive"
      ? "text-sea-700"
      : tone === "negative"
        ? "text-coral-600"
        : "text-ink-900";
  return (
    <div className="rounded-2xl bg-white/70 p-4 ring-1 ring-ink-200/40 backdrop-blur">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className={`tabular mt-1 text-xl font-semibold ${accent}`}>
        {value}
      </div>
      {sub && <div className="tabular mt-0.5 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

function FixturePanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-white/65 p-4 ring-1 ring-ink-200/40 backdrop-blur">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {title}
      </div>
      {children}
    </div>
  );
}

function SimpleTable({
  rows,
}: {
  rows: Array<{ label: string; bets: number; hitRate: number; roiPct: number }>;
}) {
  if (rows.length === 0) {
    return <div className="text-sm text-ink-500">No bets in this slice.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] uppercase tracking-[0.12em] text-ink-500">
        <tr>
          <th className="py-1 text-left font-medium">Bucket</th>
          <th className="py-1 text-right font-medium">Bets</th>
          <th className="py-1 text-right font-medium">Hit</th>
          <th className="py-1 text-right font-medium">ROI</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-ink-200/40">
        {rows.map((r) => (
          <tr key={r.label}>
            <td className="py-1 text-ink-900">{r.label}</td>
            <td className="tabular py-1 text-right text-ink-700">{r.bets}</td>
            <td className="tabular py-1 text-right text-ink-700">
              {r.bets > 0 ? `${(r.hitRate * 100).toFixed(0)}%` : "—"}
            </td>
            <td
              className={`tabular py-1 text-right ${
                r.roiPct >= 0 ? "text-sea-700" : "text-coral-600"
              }`}
            >
              {r.bets > 0 ? `${r.roiPct >= 0 ? "+" : ""}${r.roiPct.toFixed(1)}%` : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function prettyTag(tag: string): string {
  return tag
    .toLowerCase()
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

function AuditCell({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: string | undefined;
  positive?: boolean;
  negative?: boolean;
}) {
  const tone = positive
    ? "text-sea-700"
    : negative
      ? "text-coral-700"
      : "text-ink-900";
  return (
    <div className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-ink-200/40">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
        {label}
      </div>
      <div className={`mt-0.5 text-sm font-semibold ${tone}`}>
        {value ?? "—"}
      </div>
    </div>
  );
}
