import PropFilters from "@/components/PropFilters";
import OpportunityList from "@/components/OpportunityList";
import StatCard from "@/components/StatCard";
import {
  getOpportunities,
  selectedEdge,
  warnIfInvalidOpportunities,
  type PropOpportunity,
} from "@/lib/model/prop-opportunity";
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
    result = [...result].sort((a, b) => b.scorecard.confidence - a.scorecard.confidence);
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
  const positiveEdges = all.filter(
    (o) => selectedEdge(o.scorecard) >= o.scorecard.edgeThreshold,
  );
  const avgEdge =
    qualified.reduce((acc, o) => acc + Math.abs(selectedEdge(o.scorecard)), 0) /
    Math.max(qualified.length, 1);
  const topOpp = [...qualified].sort(
    (a, b) =>
      Math.abs(selectedEdge(b.scorecard)) - Math.abs(selectedEdge(a.scorecard)),
  )[0];
  const topEdge = topOpp ? selectedEdge(topOpp.scorecard) : 0;

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight text-white">
          Player prop opportunities
        </h1>
        <p className="mt-1 text-sm text-ink-400">
          Lower-variance markets only — passing, receiving, and rushing volume.
          Every prop is scored by the model decision engine: edge, gates, and a
          plain-English explanation.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Tracked markets"
          value={`${all.length}`}
          hint={`${qualified.length} qualified`}
        />
        <StatCard
          label="Positive edges"
          value={`${positiveEdges.length}`}
          hint=">= +4.0% over market"
          tone="positive"
        />
        <StatCard
          label="Avg qualified edge"
          value={`${(avgEdge * 100).toFixed(1)}%`}
          hint={qualified.length > 0 ? "across qualified props" : "no qualified plays"}
        />
        <StatCard
          label="Top edge"
          value={topOpp ? `${(Math.abs(topEdge) * 100).toFixed(1)}%` : "—"}
          hint={topOpp?.player.fullName}
          tone={topOpp && topEdge > 0 ? "positive" : "neutral"}
        />
      </section>

      <PropFilters />

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400">
            Opportunities
          </h2>
          <span className="text-xs text-ink-500">{filtered.length} shown</span>
        </div>
        <OpportunityList opportunities={filtered} />
      </section>
    </div>
  );
}
