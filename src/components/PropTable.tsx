import Link from "next/link";
import type { PropOpportunity } from "@/lib/data/types";
import {
  PROP_TYPE_SHORT,
  PROP_TYPE_UNIT,
  formatAmericanOdds,
  formatLine,
  formatProjection,
} from "@/lib/prop-utils";
import TeamBadge from "./TeamBadge";
import EdgeBadge from "./EdgeBadge";
import RecommendationPill from "./RecommendationPill";
import ConfidenceMeter from "./ConfidenceMeter";

export default function PropTable({ opportunities }: { opportunities: PropOpportunity[] }) {
  if (opportunities.length === 0) {
    return (
      <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-10 text-center text-sm text-ink-400">
        No props match these filters yet.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-ink-800 bg-ink-900/60 shadow-card">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-ink-850 text-[11px] uppercase tracking-wider text-ink-400">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Player</th>
              <th className="px-4 py-2.5 text-left font-medium">Matchup</th>
              <th className="px-4 py-2.5 text-left font-medium">Market</th>
              <th className="px-4 py-2.5 text-right font-medium">Line</th>
              <th className="px-4 py-2.5 text-right font-medium">Projection</th>
              <th className="px-4 py-2.5 text-right font-medium">Odds</th>
              <th className="px-4 py-2.5 text-right font-medium">Edge</th>
              <th className="px-4 py-2.5 text-left font-medium">Confidence</th>
              <th className="px-4 py-2.5 text-right font-medium">Side</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-800">
            {opportunities.map((opp) => (
              <Row key={opp.id} opp={opp} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ opp }: { opp: PropOpportunity }) {
  const odds = opp.recommendation === "UNDER" ? opp.underOdds : opp.overOdds;
  const unit = PROP_TYPE_UNIT[opp.propType];

  return (
    <tr className="group transition hover:bg-ink-850">
      <td className="px-4 py-3">
        <Link href={`/props/${opp.id}`} className="flex items-center gap-2">
          <TeamBadge abbr={opp.player.teamAbbr} size="sm" />
          <div className="leading-tight">
            <div className="font-medium text-white group-hover:text-accent">
              {opp.player.fullName}
            </div>
            <div className="text-[11px] text-ink-400">
              {opp.player.position} · {opp.team.name}
            </div>
          </div>
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-xs text-ink-300">
          <span className="text-ink-500">{opp.isHome ? "vs" : "@"}</span>
          <TeamBadge abbr={opp.opponent.abbreviation} size="sm" />
        </div>
      </td>
      <td className="px-4 py-3 text-ink-300">{PROP_TYPE_SHORT[opp.propType]}</td>
      <td className="tabular px-4 py-3 text-right text-white">{formatLine(opp.line)}</td>
      <td className="tabular px-4 py-3 text-right">
        <span className="text-white">{formatProjection(opp.projection, opp.propType)}</span>
        <span className="ml-1 text-[11px] text-ink-500">{unit}</span>
      </td>
      <td className="tabular px-4 py-3 text-right text-ink-300">
        <div>{formatAmericanOdds(odds)}</div>
        <div className="text-[10px] text-ink-500">{opp.sportsbook}</div>
      </td>
      <td className="px-4 py-3 text-right">
        <EdgeBadge edge={opp.edge} />
      </td>
      <td className="px-4 py-3">
        <ConfidenceMeter value={opp.confidence} />
      </td>
      <td className="px-4 py-3 text-right">
        <RecommendationPill rec={opp.recommendation} size="sm" />
      </td>
    </tr>
  );
}
