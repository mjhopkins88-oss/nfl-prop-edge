import type { PropOpportunity } from "@/lib/model/prop-opportunity";
import OpportunityCard from "./OpportunityCard";

export default function OpportunityList({
  opportunities,
}: {
  opportunities: PropOpportunity[];
}) {
  if (opportunities.length === 0) {
    return (
      <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-10 text-center text-sm text-ink-400">
        No props match these filters yet.
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {opportunities.map((opp) => (
        <OpportunityCard key={opp.prop.id} opportunity={opp} />
      ))}
    </div>
  );
}
