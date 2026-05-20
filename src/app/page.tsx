import PropFilters from "@/components/PropFilters";
import PropCard from "@/components/PropCard";
import StatCard from "@/components/StatCard";
import DashboardSidebar from "@/components/DashboardSidebar";
import {
  ActivityIcon,
  ChartBarIcon,
  SparkleIcon,
  TargetIcon,
} from "@/components/icons";
import {
  getDashboardSummary,
  getPropOpportunities,
} from "@/lib/data/props";
import type {
  Position,
  PropOpportunitySort,
  PropType,
  Recommendation,
} from "@/lib/data/types";

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
const SORT_VALUES = new Set<PropOpportunitySort>(["edge", "confidence", "player"]);

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
    raw.recommendation && RECOMMENDATION_VALUES.has(raw.recommendation as Recommendation)
      ? (raw.recommendation as Recommendation)
      : undefined;
  const sort: PropOpportunitySort =
    raw.sort && SORT_VALUES.has(raw.sort as PropOpportunitySort)
      ? (raw.sort as PropOpportunitySort)
      : "edge";
  return { propType, position, recommendation, sort };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const raw = await searchParams;
  const { propType, position, recommendation, sort } = parseFilters(raw);

  const summary = getDashboardSummary();
  const opportunities = getPropOpportunities({
    filter: { propType, position, recommendation },
    sort,
  });

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl">
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/65 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700 ring-1 ring-amber-200/60 backdrop-blur">
            <SparkleIcon className="h-3 w-3" />
            Week 11 · 2025 · Lower-variance markets
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
            Volume-driven props only — passing, receiving, rushing. Our model
            projections, every book&apos;s pricing, and a transparent edge score
            so you can sort by what actually matters.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Tracked markets"
          value={`${summary.trackedMarkets}`}
          hint={`${summary.actionableMarkets} actionable`}
          icon={<ChartBarIcon className="h-4 w-4" />}
          accent="amber"
        />
        <StatCard
          label="Positive edges"
          value={`${summary.positiveEdges}`}
          hint=">= +4.0% vs market"
          tone="positive"
          icon={<SparkleIcon className="h-4 w-4" />}
          accent="teal"
        />
        <StatCard
          label="Avg model edge"
          value={`${(summary.averageEdge * 100).toFixed(1)}%`}
          hint="across actionable props"
          icon={<ActivityIcon className="h-4 w-4" />}
          accent="blue"
        />
        <StatCard
          label="Top edge"
          value={summary.topEdge ? `${(summary.topEdge.value * 100).toFixed(1)}%` : "—"}
          hint={summary.topEdge?.playerName}
          tone={summary.topEdge?.positive ? "positive" : "negative"}
          icon={<TargetIcon className="h-4 w-4" />}
          accent="coral"
        />
      </section>

      <PropFilters />

      <section className="grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-ink-600">
              Opportunities
            </h2>
            <span className="text-xs text-ink-500">
              {opportunities.length} shown · sorted by{" "}
              <span className="text-ink-700">
                {sort === "edge" ? "top edge" : sort === "confidence" ? "confidence" : "player A-Z"}
              </span>
            </span>
          </div>
          {opportunities.length === 0 ? (
            <div className="glass rounded-2xl p-10 text-center text-sm text-ink-500">
              No props match these filters yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              {opportunities.map((opp) => (
                <PropCard key={opp.id} opp={opp} />
              ))}
            </div>
          )}
        </div>
        <DashboardSidebar />
      </section>
    </div>
  );
}
