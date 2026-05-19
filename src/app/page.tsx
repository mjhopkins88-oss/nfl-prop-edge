import PropFilters from "@/components/PropFilters";
import PropTable from "@/components/PropTable";
import StatCard from "@/components/StatCard";
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
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Player prop opportunities
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Lower-variance markets only — passing, receiving, and rushing volume.
          Edges compare our projection to current book pricing across major sportsbooks.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Tracked markets"
          value={`${summary.trackedMarkets}`}
          hint={`${summary.actionableMarkets} actionable`}
        />
        <StatCard
          label="Positive edges"
          value={`${summary.positiveEdges}`}
          hint=">= +4.0% over market"
          tone="positive"
        />
        <StatCard
          label="Avg model edge"
          value={`${(summary.averageEdge * 100).toFixed(1)}%`}
          hint="across actionable props"
        />
        <StatCard
          label="Top edge"
          value={summary.topEdge ? `${(summary.topEdge.value * 100).toFixed(1)}%` : "—"}
          hint={summary.topEdge?.playerName}
          tone={summary.topEdge?.positive ? "positive" : "negative"}
        />
      </section>

      <PropFilters />

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400">
            Opportunities
          </h2>
          <span className="text-xs text-ink-500">{opportunities.length} shown</span>
        </div>
        <PropTable opportunities={opportunities} />
      </section>
    </div>
  );
}
