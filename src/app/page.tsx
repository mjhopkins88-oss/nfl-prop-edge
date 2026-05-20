import Link from "next/link";
import PropFilters from "@/components/PropFilters";
import OpportunityList from "@/components/OpportunityList";
import StatCard from "@/components/StatCard";
import {
  ActivityIcon,
  ChartBarIcon,
  InfoIcon,
  SparkleIcon,
  TargetIcon,
  TrendDownIcon,
  TrendUpIcon,
} from "@/components/icons";
import { getDemoAppContext } from "@/lib/app-context";
import {
  getOpportunities,
  selectedEdge,
  warnIfInvalidOpportunities,
  type PropOpportunity,
} from "@/lib/model/prop-opportunity";
import { getPrimaryDisqualifier } from "@/lib/model/model-scorecard";
import type { PropType, Position, Recommendation } from "@/lib/types";

const PROP_TYPE_VALUES = new Set<PropType>([
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
]);
const POSITION_VALUES = new Set<Position>(["QB", "RB", "WR", "TE"]);
const RECOMMENDATION_VALUES = new Set<Recommendation>(["OVER", "UNDER", "PASS"]);

const VOLUME_PROP_TYPES = new Set<PropType>([
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "RECEPTIONS",
  "RUSHING_ATTEMPTS",
]);
const YARDAGE_PROP_TYPES = new Set<PropType>([
  "PASSING_YARDS",
  "RECEIVING_YARDS",
  "RUSHING_YARDS",
]);

type Search = {
  propType?: string;
  position?: string;
  recommendation?: string;
  sort?: string;
};

function parseFilters(raw: Search) {
  const propType =
    raw.propType && PROP_TYPE_VALUES.has(raw.propType as PropType)
      ? (raw.propType as PropType)
      : undefined;
  const position =
    raw.position && POSITION_VALUES.has(raw.position as Position)
      ? (raw.position as Position)
      : undefined;
  const recommendation =
    raw.recommendation &&
    RECOMMENDATION_VALUES.has(raw.recommendation as Recommendation)
      ? (raw.recommendation as Recommendation)
      : undefined;
  const sort =
    raw.sort === "confidence" || raw.sort === "player" ? raw.sort : "edge";
  return { propType, position, recommendation, sort };
}

function applyFilters(
  opps: PropOpportunity[],
  filters: ReturnType<typeof parseFilters>,
): PropOpportunity[] {
  let result = opps;
  if (filters.propType) {
    result = result.filter((o) => o.prop.propType === filters.propType);
  }
  if (filters.position) {
    result = result.filter((o) => o.player.position === filters.position);
  }
  if (filters.recommendation) {
    result = result.filter(
      (o) => o.scorecard.recommendation === filters.recommendation,
    );
  }
  if (filters.sort === "confidence") {
    result = [...result].sort(
      (a, b) => b.scorecard.confidence - a.scorecard.confidence,
    );
  } else if (filters.sort === "player") {
    result = [...result].sort((a, b) =>
      a.player.fullName.localeCompare(b.player.fullName),
    );
  } else {
    result = [...result].sort(
      (a, b) =>
        Math.abs(selectedEdge(b.scorecard)) -
        Math.abs(selectedEdge(a.scorecard)),
    );
  }
  return result;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const raw = await searchParams;
  const filters = parseFilters(raw);
  const all = getOpportunities();
  warnIfInvalidOpportunities(all);
  const filtered = applyFilters(all, filters);

  const qualified = all.filter((o) => o.scorecard.qualified);
  const oversQualified = qualified.filter(
    (o) => o.scorecard.recommendation === "OVER",
  ).length;
  const undersQualified = qualified.filter(
    (o) => o.scorecard.recommendation === "UNDER",
  ).length;
  const passed = all.filter((o) => !o.scorecard.qualified);
  const passedDueToEdge = passed.filter((o) =>
    (getPrimaryDisqualifier(o.scorecard) ?? "")
      .toLowerCase()
      .startsWith("edge of"),
  ).length;
  const passedDueToRisk = passed.length - passedDueToEdge;

  const positiveEdges = all.filter(
    (o) => selectedEdge(o.scorecard) >= o.scorecard.edgeThreshold,
  );
  const avgEdge =
    qualified.reduce((acc, o) => acc + Math.abs(selectedEdge(o.scorecard)), 0) /
    Math.max(qualified.length, 1);
  const topOpp = [...qualified].sort(
    (a, b) =>
      Math.abs(selectedEdge(b.scorecard)) -
      Math.abs(selectedEdge(a.scorecard)),
  )[0];
  const topEdge = topOpp ? selectedEdge(topOpp.scorecard) : 0;

  // Model Quality Snapshot derivation -----------------------------------
  const volumePropsTracked = all.filter((o) =>
    VOLUME_PROP_TYPES.has(o.prop.propType),
  ).length;
  const yardagePropsTracked = all.filter((o) =>
    YARDAGE_PROP_TYPES.has(o.prop.propType),
  ).length;
  const highestConfidence = [...qualified].sort(
    (a, b) => b.scorecard.confidence - a.scorecard.confidence,
  )[0];
  const disqCounts = new Map<string, number>();
  for (const o of passed) {
    const d = getPrimaryDisqualifier(o.scorecard);
    if (!d) continue;
    const key = d.toLowerCase().startsWith("edge of")
      ? "Edge below threshold"
      : d.split(" score")[0];
    disqCounts.set(key, (disqCounts.get(key) ?? 0) + 1);
  }
  const mostCommonDisq = Array.from(disqCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  )[0]?.[0];
  const bestPropTypeByEdge = (() => {
    const byType = new Map<PropType, number[]>();
    for (const o of qualified) {
      const arr = byType.get(o.prop.propType) ?? [];
      arr.push(Math.abs(selectedEdge(o.scorecard)));
      byType.set(o.prop.propType, arr);
    }
    let best: { propType: PropType; avg: number } | undefined;
    for (const [pt, arr] of byType.entries()) {
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      if (!best || avg > best.avg) best = { propType: pt, avg };
    }
    return best;
  })();

  const demoContext = getDemoAppContext();
  return (
    <div className="space-y-8">
      <section
        aria-label="Demo / Week 1 test pointer"
        className="rounded-2xl bg-amber-50/80 p-4 ring-1 ring-amber-200/70 backdrop-blur"
        data-testid="homepage-demo-banner"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900">
              Demo data — Week {demoContext.week} mock slate
            </div>
            <p className="mt-0.5 max-w-2xl text-xs text-amber-900">
              The cards below render from{" "}
              <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[10px]">
                src/lib/mock-data.ts
              </code>{" "}
              — a legacy Week-{demoContext.week} demo set. The 2025 focus is
              the Week 1 historical starter test.
            </p>
          </div>
          <Link
            href="/backtest/week-1"
            className="inline-flex items-center gap-2 rounded-full bg-sea-600 px-3.5 py-1.5 text-xs font-semibold text-cream-50 transition hover:bg-sea-700"
          >
            Open Week 1 Starter Test →
          </Link>
        </div>
      </section>

      <section className="relative overflow-hidden">
        <div
          className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/70 backdrop-blur"
          data-testid="homepage-mode-chip"
        >
          <SparkleIcon className="h-3 w-3" />
          {demoContext.label} · Lower-variance markets
        </div>
        <h1 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
          Find the cleanest edges in the
          <span className="bg-gradient-to-r from-amber-600 via-coral-500 to-rose-500 bg-clip-text text-transparent">
            {" "}
            NFL player prop slate
          </span>
          .
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-ink-700">
          Volume-driven props only — passing, receiving, rushing. Every prop is
          scored by the decision engine with full edge math, risk gates, and a
          plain-English explanation.
        </p>
      </section>

      <section
        aria-label="Other sections"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        <Link
          href="/game-edge"
          className="group glass-strong flex items-start justify-between gap-4 rounded-2xl p-5 ring-1 ring-white/40 transition hover:ring-sea-300/60"
        >
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Beta
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink-900">
              Explore Game Edge
            </h2>
            <p className="mt-1 text-xs text-ink-600">
              Experimental moneyline, spread, and upset model — separate
              from the player prop scorecard.
            </p>
          </div>
          <span
            aria-hidden="true"
            className="self-center text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-700"
          >
            →
          </span>
        </Link>
        <Link
          href="/parlays"
          className="group glass-strong flex items-start justify-between gap-4 rounded-2xl p-5 ring-1 ring-white/40 transition hover:ring-sea-300/60"
        >
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              Beta
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink-900">
              Open Parlay Builder
            </h2>
            <p className="mt-1 text-xs text-ink-600">
              Experimental correlated parlay model — separate from
              player props and game edge.
            </p>
          </div>
          <span
            aria-hidden="true"
            className="self-center text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-700"
          >
            →
          </span>
        </Link>
        <Link
          href="/backtest"
          className="group glass-strong flex items-start justify-between gap-4 rounded-2xl p-5 ring-1 ring-white/40 transition hover:ring-sea-300/60"
        >
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-sea-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sea-800 ring-1 ring-sea-200/80">
              <ChartBarIcon className="h-3 w-3" />
              Backtest
            </div>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-ink-900">
              Open Backtest Performance
            </h2>
            <p className="mt-1 text-xs text-ink-600">
              Fixture-driven historical performance and V1 vs V2
              algorithm comparison.
            </p>
          </div>
          <span
            aria-hidden="true"
            className="self-center text-ink-400 transition group-hover:translate-x-0.5 group-hover:text-ink-700"
          >
            →
          </span>
        </Link>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Tracked markets"
          value={`${all.length}`}
          hint={`${qualified.length} qualified`}
          icon={<ChartBarIcon className="h-4 w-4" />}
          accent="amber"
        />
        <StatCard
          label="Qualified opportunities"
          value={`${qualified.length}`}
          hint=">= +4.0% edge · gates clean"
          tone="positive"
          icon={<TargetIcon className="h-4 w-4" />}
          accent="teal"
        />
        <StatCard
          label="Avg qualified edge"
          value={`${(avgEdge * 100).toFixed(1)}%`}
          hint={
            qualified.length > 0
              ? "across qualified props"
              : "no qualified plays"
          }
          icon={<ActivityIcon className="h-4 w-4" />}
          accent="blue"
        />
        <StatCard
          label="Top edge"
          value={topOpp ? `${(Math.abs(topEdge) * 100).toFixed(1)}%` : "—"}
          hint={topOpp?.player.fullName}
          tone={topOpp && topEdge > 0 ? "positive" : "neutral"}
          icon={<SparkleIcon className="h-4 w-4" />}
          accent="gold"
        />
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Overs qualified"
          value={`${oversQualified}`}
          hint="OVER recommendations"
          icon={<TrendUpIcon className="h-4 w-4" />}
          accent="teal"
        />
        <StatCard
          label="Unders qualified"
          value={`${undersQualified}`}
          hint="UNDER recommendations"
          icon={<TrendDownIcon className="h-4 w-4" />}
          accent="blue"
        />
        <StatCard
          label="Passed — edge too thin"
          value={`${passedDueToEdge}`}
          hint="below edge threshold"
          icon={<InfoIcon className="h-4 w-4" />}
          accent="gold"
        />
        <StatCard
          label="Passed — risk gate"
          value={`${passedDueToRisk}`}
          hint="role / injury / weather / etc."
          icon={<InfoIcon className="h-4 w-4" />}
          accent="coral"
        />
      </section>

      <section className="glass rounded-2xl p-5">
        <div className="mb-3 flex items-center gap-2">
          <SparkleIcon className="h-4 w-4 text-amber-700" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
            Model Quality Snapshot
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-[0.14em] text-ink-500">
            {positiveEdges.length} positive edges tracked
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
          <SnapshotCell
            label="Volume props tracked"
            value={`${volumePropsTracked}`}
            sub="Att / Comp / Rec / Rush att"
          />
          <SnapshotCell
            label="Yardage props tracked"
            value={`${yardagePropsTracked}`}
            sub="Pass / Rec / Rush yards"
          />
          <SnapshotCell
            label="Highest-confidence play"
            value={
              highestConfidence
                ? `${(highestConfidence.scorecard.confidence * 100).toFixed(0)}%`
                : "—"
            }
            sub={
              highestConfidence
                ? `${highestConfidence.player.fullName} · ${highestConfidence.scorecard.recommendation}`
                : undefined
            }
            tone="positive"
          />
          <SnapshotCell
            label="Most common disqualifier"
            value={mostCommonDisq ?? "—"}
            sub={`${passed.length} passed total`}
            tone="warning"
          />
          <SnapshotCell
            label="Best avg edge — prop type"
            value={
              bestPropTypeByEdge
                ? bestPropTypeByEdge.propType.replace(/_/g, " ")
                : "—"
            }
            sub={
              bestPropTypeByEdge
                ? `${(bestPropTypeByEdge.avg * 100).toFixed(1)}% avg`
                : undefined
            }
            tone="positive"
          />
        </div>
      </section>

      <PropFilters />

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
            Opportunities
          </h2>
          <span className="text-xs text-ink-600">{filtered.length} shown</span>
        </div>
        <OpportunityList opportunities={filtered} />
      </section>
    </div>
  );
}

function SnapshotCell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "warning" | "neutral";
}) {
  const valueTone =
    tone === "positive"
      ? "text-sea-700"
      : tone === "warning"
        ? "text-amber-700"
        : "text-ink-900";
  return (
    <div className="rounded-xl bg-white/70 p-3 ring-1 ring-ink-200/50">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
        {label}
      </div>
      <div
        className={`tabular mt-1 truncate text-sm font-semibold ${valueTone}`}
      >
        {value}
      </div>
      {sub && (
        <div className="tabular mt-0.5 truncate text-[11px] text-ink-500">
          {sub}
        </div>
      )}
    </div>
  );
}
