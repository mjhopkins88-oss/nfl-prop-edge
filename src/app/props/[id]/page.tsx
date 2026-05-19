import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllPropIds, getPropDetail } from "@/lib/data/props";
import {
  PROP_TYPE_LABEL,
  PROP_TYPE_UNIT,
  americanOddsToImpliedProb,
  edgeTone,
  formatAmericanOdds,
  formatEdge,
  formatLine,
  formatProjection,
} from "@/lib/prop-utils";
import type { GameLog, PropType } from "@/lib/data/types";
import TeamBadge from "@/components/TeamBadge";
import EdgeBadge from "@/components/EdgeBadge";
import RecommendationPill from "@/components/RecommendationPill";
import ConfidenceMeter from "@/components/ConfidenceMeter";

export function generateStaticParams() {
  return getAllPropIds().map((id) => ({ id }));
}

const STAT_KEY: Record<PropType, keyof GameLog> = {
  PASSING_ATTEMPTS: "passingAttempts",
  PASSING_COMPLETIONS: "passingCompletions",
  PASSING_YARDS: "passingYards",
  RECEPTIONS: "receptions",
  RECEIVING_YARDS: "receivingYards",
  RUSHING_ATTEMPTS: "rushingAttempts",
  RUSHING_YARDS: "rushingYards",
};

export default async function PropDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = getPropDetail(id);
  if (!detail) notFound();

  const isHome = detail.game.homeTeamAbbr === detail.player.teamAbbr;
  const opponentAbbr = isHome ? detail.game.awayTeamAbbr : detail.game.homeTeamAbbr;
  const statKey = STAT_KEY[detail.propType];
  const unit = PROP_TYPE_UNIT[detail.propType];
  const kickoffDate = new Date(detail.game.kickoff).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const logValues = detail.recentLogs.map((log) => Number(log[statKey] ?? 0));
  const logAvg =
    logValues.length > 0 ? logValues.reduce((a, b) => a + b, 0) / logValues.length : 0;
  const overCount = logValues.filter((v) => v > detail.line).length;
  const hitRateLastN = logValues.length > 0 ? overCount / logValues.length : 0;
  const maxBar = Math.max(detail.line, ...logValues, 1);

  const projVsLine = detail.projection - detail.line;
  const projVsLinePct = (projVsLine / detail.line) * 100;
  const modelOver = detail.modelHitRateOver;
  const bookOver = detail.bookImpliedOver;
  const recommendedOdds =
    detail.recommendation === "UNDER" ? detail.underOdds : detail.overOdds;
  const recommendedImpliedProb = americanOddsToImpliedProb(recommendedOdds);
  const recommendedModelProb =
    detail.recommendation === "UNDER" ? 1 - modelOver : modelOver;

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-xs text-ink-400 transition hover:text-white"
      >
        <span aria-hidden>&larr;</span> Back to dashboard
      </Link>

      <section className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6 shadow-card">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <TeamBadge abbr={detail.player.teamAbbr} size="lg" />
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-ink-400">
                <span>{detail.player.position}</span>
                <span>·</span>
                <span>{detail.team.city} {detail.team.name}</span>
              </div>
              <h1 className="mt-0.5 text-2xl font-semibold text-white">
                {detail.player.fullName}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-300">
                <span>{PROP_TYPE_LABEL[detail.propType]}</span>
                <span className="text-ink-600">·</span>
                <span className="tabular text-white">
                  {formatLine(detail.line)} {unit}
                </span>
                <span className="text-ink-600">·</span>
                <span className="text-ink-400">{detail.sportsbook}</span>
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-ink-400">
                <span>{isHome ? "vs" : "@"}</span>
                <TeamBadge abbr={opponentAbbr} size="sm" />
                <span>{detail.opponent.city} {detail.opponent.name}</span>
                <span className="text-ink-600">·</span>
                <span>Week {detail.game.week} · {kickoffDate}</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 sm:flex-row lg:flex-col lg:items-end">
            <RecommendationPill rec={detail.recommendation} size="lg" />
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-ink-400">Edge</span>
              <EdgeBadge edge={detail.edge} size="lg" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-wider text-ink-400">Confidence</span>
              <ConfidenceMeter value={detail.confidence} />
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label="Market line"
            value={`${formatLine(detail.line)} ${unit}`}
          />
          <Metric
            label="Model projection"
            value={`${formatProjection(detail.projection, detail.propType)} ${unit}`}
            sub={`${projVsLine >= 0 ? "+" : ""}${projVsLine.toFixed(1)} vs line · ${projVsLinePct >= 0 ? "+" : ""}${projVsLinePct.toFixed(1)}%`}
            tone={projVsLine >= 0 ? "positive" : "negative"}
          />
          <Metric
            label="Model hit rate (over)"
            value={`${(modelOver * 100).toFixed(1)}%`}
            sub={`Book implied: ${(bookOver * 100).toFixed(1)}%`}
          />
          <Metric
            label="Recommended side edge"
            value={formatEdge(Math.max(recommendedModelProb - recommendedImpliedProb, 0))}
            sub={`Model ${(recommendedModelProb * 100).toFixed(1)}% vs book ${(recommendedImpliedProb * 100).toFixed(1)}%`}
            tone={edgeTone(recommendedModelProb - recommendedImpliedProb)}
          />
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-5 shadow-card lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400">
              Recent game log
            </h2>
            <span className="text-xs text-ink-500">
              Last {detail.recentLogs.length} games · Avg{" "}
              <span className="tabular text-white">{logAvg.toFixed(1)} {unit}</span>{" "}
              · Over rate{" "}
              <span className="tabular text-white">{(hitRateLastN * 100).toFixed(0)}%</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-ink-400">
                <tr>
                  <th className="py-2 pr-4 text-left font-medium">Week</th>
                  <th className="py-2 pr-4 text-left font-medium">Opp</th>
                  <th className="py-2 pr-4 text-right font-medium">{PROP_TYPE_LABEL[detail.propType]}</th>
                  <th className="py-2 pr-4 text-right font-medium">vs Line</th>
                  <th className="py-2 text-left font-medium">Distribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {detail.recentLogs.map((log) => {
                  const value = Number(log[statKey] ?? 0);
                  const diff = value - detail.line;
                  return (
                    <tr key={`${log.season}-${log.week}`}>
                      <td className="py-2 pr-4 text-ink-300">W{log.week}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1.5 text-ink-300">
                          <TeamBadge abbr={log.opponentAbbr} size="sm" />
                        </div>
                      </td>
                      <td className="tabular py-2 pr-4 text-right text-white">
                        {value} {unit}
                      </td>
                      <td className="tabular py-2 pr-4 text-right">
                        <span
                          className={
                            diff >= 0
                              ? "text-edge-positive"
                              : "text-edge-negative"
                          }
                        >
                          {diff >= 0 ? "+" : ""}
                          {diff.toFixed(1)}
                        </span>
                      </td>
                      <td className="py-2">
                        <DistributionBar value={value} line={detail.line} max={maxBar} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-5 shadow-card">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-ink-400">
            Projection breakdown
          </h2>
          <div className="space-y-4">
            <ProbBar
              label="Model probability"
              value={modelOver}
              caption={`Over ${formatLine(detail.line)}`}
              accent="positive"
            />
            <ProbBar
              label="Book implied probability"
              value={bookOver}
              caption={`Over @ ${formatAmericanOdds(detail.overOdds)}`}
              accent="neutral"
            />
            <div className="rounded-lg border border-ink-800 bg-ink-850 p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-400">
                Projection range (±1σ)
              </div>
              <div className="tabular mt-1 text-base text-white">
                {(detail.projection - detail.projectionStdDev).toFixed(1)} –{" "}
                {(detail.projection + detail.projectionStdDev).toFixed(1)} {unit}
              </div>
              <div className="mt-1 text-[11px] text-ink-400">
                σ = {detail.projectionStdDev.toFixed(1)} {unit}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-5 shadow-card lg:col-span-2">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-ink-400">
            Line shopping
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-[11px] uppercase tracking-wider text-ink-400">
                <tr>
                  <th className="py-2 pr-4 text-left font-medium">Sportsbook</th>
                  <th className="py-2 pr-4 text-right font-medium">Line</th>
                  <th className="py-2 pr-4 text-right font-medium">Over</th>
                  <th className="py-2 pr-4 text-right font-medium">Under</th>
                  <th className="py-2 text-right font-medium">Best for {detail.recommendation === "UNDER" ? "Under" : "Over"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800">
                {detail.altLines.map((alt) => {
                  const bestOddsForSide =
                    detail.recommendation === "UNDER" ? alt.underOdds : alt.overOdds;
                  const bestOddsAll = detail.altLines.reduce(
                    (acc, x) =>
                      Math.max(
                        acc,
                        detail.recommendation === "UNDER" ? x.underOdds : x.overOdds,
                      ),
                    -Infinity,
                  );
                  const isBest = bestOddsForSide === bestOddsAll;
                  return (
                    <tr key={alt.sportsbook}>
                      <td className="py-2 pr-4 text-white">{alt.sportsbook}</td>
                      <td className="tabular py-2 pr-4 text-right text-ink-300">
                        {formatLine(alt.line)}
                      </td>
                      <td className="tabular py-2 pr-4 text-right text-ink-300">
                        {formatAmericanOdds(alt.overOdds)}
                      </td>
                      <td className="tabular py-2 pr-4 text-right text-ink-300">
                        {formatAmericanOdds(alt.underOdds)}
                      </td>
                      <td className="py-2 text-right">
                        {isBest && (
                          <span className="rounded-md bg-edge-positive/15 px-2 py-0.5 text-[11px] font-semibold text-edge-positive ring-1 ring-edge-positive/30">
                            BEST PRICE
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-5 shadow-card">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-ink-400">
            Matchup notes
          </h2>
          <ul className="space-y-2 text-sm text-ink-300">
            {detail.matchupNotes.map((note, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}

function Metric({
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
  const subClass =
    tone === "positive"
      ? "text-edge-positive"
      : tone === "negative"
        ? "text-edge-negative"
        : "text-ink-400";
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className="tabular mt-1 text-lg font-semibold text-white">{value}</div>
      {sub && <div className={`tabular mt-0.5 text-xs ${subClass}`}>{sub}</div>}
    </div>
  );
}

function ProbBar({
  label,
  value,
  caption,
  accent,
}: {
  label: string;
  value: number;
  caption: string;
  accent: "positive" | "neutral";
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const barColor =
    accent === "positive"
      ? "bg-gradient-to-r from-accent to-edge-positive"
      : "bg-ink-500";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="text-ink-400">{label}</span>
        <span className="tabular text-white">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-700">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-ink-500">{caption}</div>
    </div>
  );
}

function DistributionBar({
  value,
  line,
  max,
}: {
  value: number;
  line: number;
  max: number;
}) {
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  const linePct = Math.max(0, Math.min(1, line / max)) * 100;
  const cleared = value >= line;
  return (
    <div className="relative h-2 w-40 overflow-hidden rounded-full bg-ink-700">
      <div
        className={`h-full ${cleared ? "bg-edge-positive/70" : "bg-edge-negative/70"}`}
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-[-2px] h-3 w-px bg-white/70"
        style={{ left: `${linePct}%` }}
        title={`Line: ${line}`}
      />
    </div>
  );
}
