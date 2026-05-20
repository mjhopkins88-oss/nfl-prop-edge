import type { PropOpportunity } from "@/lib/model/prop-opportunity";
import OpportunityCard from "./OpportunityCard";

export default function OpportunityList({
  opportunities,
}: {
  opportunities: PropOpportunity[];
}) {
  if (opportunities.length === 0) {
    return (
      <div className="glass rounded-2xl p-10 text-center text-sm text-ink-600">
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
