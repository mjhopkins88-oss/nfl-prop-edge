import PropFilters from "@/components/PropFilters";
import PropTable from "@/components/PropTable";
import StatCard from "@/components/StatCard";
import { getProps } from "@/lib/mock-data";
import type { PropMarket, PropType, Position, Recommendation } from "@/lib/types";
import { getPlayerById } from "@/lib/mock-data";

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
    raw.recommendation && RECOMMENDATION_VALUES.has(raw.recommendation as Recommendation)
      ? (raw.recommendation as Recommendation)
      : undefined;
  const sort = raw.sort === "confidence" || raw.sort === "player" ? raw.sort : "edge";
  return { propType, position, recommendation, sort };
}

function applyFilters(
  props: PropMarket[],
  filters: ReturnType<typeof parseFilters>,
): PropMarket[] {
  let result = props;
  if (filters.propType) result = result.filter((p) => p.propType === filters.propType);
  if (filters.position) {
    result = result.filter((p) => {
      const player = getPlayerById(p.playerId);
      return player?.position === filters.position;
    });
  }
  if (filters.recommendation) {
    result = result.filter((p) => p.recommendation === filters.recommendation);
  }
  if (filters.sort === "confidence") {
    result = [...result].sort((a, b) => b.confidence - a.confidence);
  } else if (filters.sort === "player") {
    result = [...result].sort((a, b) => {
      const pa = getPlayerById(a.playerId)?.fullName ?? "";
      const pb = getPlayerById(b.playerId)?.fullName ?? "";
      return pa.localeCompare(pb);
    });
  } else {
    result = [...result].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge));
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
  const all = getProps();
  const filtered = applyFilters(all, filters);

  const playable = all.filter((p) => p.recommendation !== "PASS");
  const positiveEdges = playable.filter((p) => p.edge >= 0.04);
  const avgEdge =
    playable.reduce((acc, p) => acc + Math.abs(p.edge), 0) / Math.max(playable.length, 1);
  const topEdgeProp = [...playable].sort((a, b) => Math.abs(b.edge) - Math.abs(a.edge))[0];
  const topPlayer = topEdgeProp ? getPlayerById(topEdgeProp.playerId) : undefined;

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
          value={`${all.length}`}
          hint={`${playable.length} actionable`}
        />
        <StatCard
          label="Positive edges"
          value={`${positiveEdges.length}`}
          hint=">= +4.0% over market"
          tone="positive"
        />
        <StatCard
          label="Avg model edge"
          value={`${(avgEdge * 100).toFixed(1)}%`}
          hint="across actionable props"
        />
        <StatCard
          label="Top edge"
          value={topEdgeProp ? `${(Math.abs(topEdgeProp.edge) * 100).toFixed(1)}%` : "—"}
          hint={topPlayer?.fullName}
          tone={topEdgeProp && topEdgeProp.edge > 0 ? "positive" : "negative"}
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
        <PropTable props={filtered} />
      </section>
    </div>
  );
}
