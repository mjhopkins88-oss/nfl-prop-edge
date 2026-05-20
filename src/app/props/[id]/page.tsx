import Link from "next/link";
import { notFound } from "next/navigation";
import { getProps } from "@/lib/mock-data";
import {
  getOpportunityDetail,
  selectedEdge,
  selectedModelProbability,
  selectedNoVigProbability,
  selectedSideOdds,
} from "@/lib/model/prop-opportunity";
import {
  PROP_TYPE_LABEL,
  PROP_TYPE_UNIT,
  edgeTone,
  formatAmericanOdds,
  formatEdge,
  formatLine,
  formatProjection,
} from "@/lib/prop-utils";
import type { GameLog, PropType } from "@/lib/types";
import TeamBadge from "@/components/TeamBadge";
import EdgeBadge from "@/components/EdgeBadge";
import RecommendationPill from "@/components/RecommendationPill";
import ConfidenceMeter from "@/components/ConfidenceMeter";
import ScorecardDetailPanel from "@/components/ScorecardDetailPanel";
import MatchupIntelligencePanel from "@/components/MatchupIntelligencePanel";
import { ArrowLeftIcon, ClockIcon } from "@/components/icons";

export function generateStaticParams() {
  return getProps().map((p) => ({ id: p.id }));
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
  const detail = getOpportunityDetail(id);
  if (!detail) notFound();

  const { prop, player, team, opponent, game, scorecard } = detail;
  const isHome = game.homeTeamAbbr === player.teamAbbr;
  const opponentAbbr = isHome ? game.awayTeamAbbr : game.homeTeamAbbr;
  const statKey = STAT_KEY[prop.propType];
  const unit = PROP_TYPE_UNIT[prop.propType];
  const kickoffDate = new Date(game.kickoff).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const logValues = detail.recentLogs.map((log) => Number(log[statKey] ?? 0));
  const logAvg =
    logValues.length > 0
      ? logValues.reduce((a, b) => a + b, 0) / logValues.length
      : 0;
  const overCount = logValues.filter((v) => v > prop.line).length;
  const hitRateLastN = logValues.length > 0 ? overCount / logValues.length : 0;
  const maxBar = Math.max(prop.line, ...logValues, 1);

  const projVsLine = prop.projection - prop.line;
  const projVsLinePct = (projVsLine / prop.line) * 100;
  const modelOver = scorecard.modelOverProbability;
  const noVigOver = scorecard.noVigOverProbability;
  const edge = selectedEdge(scorecard);
  const modelSideProb = selectedModelProbability(scorecard);
  const noVigSideProb = selectedNoVigProbability(scorecard);
  const sideOdds = selectedSideOdds(prop, scorecard);

  return (
    <div className="space-y-6">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 transition hover:text-amber-700"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to opportunities
      </Link>

      <section className="glass-strong relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-gradient-to-br from-amber-200/60 via-coral-200/40 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-gradient-to-tr from-sea-200/40 via-sky2-100/40 to-transparent blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-5">
            <TeamBadge abbr={player.teamAbbr} size="lg" />
            <div>
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
                <span>{player.position}</span>
                <span className="text-ink-300">·</span>
                <span>
                  {team.city} {team.name}
                </span>
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink-900">
                {player.fullName}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-700">
                <span className="font-medium text-ink-900">
                  {PROP_TYPE_LABEL[prop.propType]}
                </span>
                <span className="text-ink-300">·</span>
                <span className="tabular font-semibold text-ink-900">
                  {formatLine(prop.line)} {unit}
                </span>
                <span className="text-ink-300">·</span>
                <span className="text-ink-500">{prop.sportsbook}</span>
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-ink-600">
                <span>{isHome ? "vs" : "@"}</span>
                <TeamBadge abbr={opponentAbbr} size="sm" />
                <span>
                  {opponent.city} {opponent.name}
                </span>
                <span className="text-ink-300">·</span>
                <ClockIcon className="h-3 w-3 text-ink-400" />
                <span>
                  Week {game.week} · {kickoffDate}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 sm:flex-row lg:flex-col lg:items-end">
            <RecommendationPill rec={scorecard.recommendation} size="lg" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
                Edge
              </span>
              <EdgeBadge edge={edge} size="lg" showIcon />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
                Confidence
              </span>
              <ConfidenceMeter value={scorecard.confidence} width="wide" />
            </div>
          </div>
        </div>

        <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label="Market line"
            value={`${formatLine(prop.line)} ${unit}`}
          />
          <Metric
            label="Model projection"
            value={`${formatProjection(prop.projection, prop.propType)} ${unit}`}
            sub={`${projVsLine >= 0 ? "+" : ""}${projVsLine.toFixed(1)} vs line · ${projVsLinePct >= 0 ? "+" : ""}${projVsLinePct.toFixed(1)}%`}
            tone={projVsLine >= 0 ? "positive" : "negative"}
          />
          <Metric
            label="Model hit rate (over)"
            value={`${(modelOver * 100).toFixed(1)}%`}
            sub={`No-vig: ${(noVigOver * 100).toFixed(1)}%`}
          />
          <Metric
            label={`${scorecard.selectedSide} side edge`}
            value={formatEdge(edge)}
            sub={`Model ${(modelSideProb * 100).toFixed(1)}% vs market ${(noVigSideProb * 100).toFixed(1)}% @ ${formatAmericanOdds(sideOdds)}`}
            tone={edgeTone(edge)}
          />
        </div>
      </section>

      <ScorecardDetailPanel scorecard={scorecard} />

      {scorecard.matchupComponent && (
        <MatchupIntelligencePanel component={scorecard.matchupComponent} />
      )}

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="glass-strong rounded-2xl p-5 lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
              Recent game log
            </h2>
            <span className="text-xs text-ink-600">
              Last {detail.recentLogs.length} games · Avg{" "}
              <span className="tabular font-semibold text-ink-900">
                {logAvg.toFixed(1)} {unit}
              </span>{" "}
              · Over rate{" "}
              <span className="tabular font-semibold text-ink-900">
                {(hitRateLastN * 100).toFixed(0)}%
              </span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                <tr>
                  <th className="py-2 pr-4 text-left">Week</th>
                  <th className="py-2 pr-4 text-left">Opp</th>
                  <th className="py-2 pr-4 text-right">
                    {PROP_TYPE_LABEL[prop.propType]}
                  </th>
                  <th className="py-2 pr-4 text-right">vs Line</th>
                  <th className="py-2 text-left">Distribution</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200/40">
                {detail.recentLogs.map((log) => {
                  const value = Number(log[statKey] ?? 0);
                  const diff = value - prop.line;
                  return (
                    <tr key={`${log.season}-${log.week}`}>
                      <td className="py-2 pr-4 text-ink-700">W{log.week}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1.5 text-ink-700">
                          <TeamBadge abbr={log.opponentAbbr} size="sm" />
                        </div>
                      </td>
                      <td className="tabular py-2 pr-4 text-right font-semibold text-ink-900">
                        {value} {unit}
                      </td>
                      <td className="tabular py-2 pr-4 text-right">
                        <span
                          className={
                            diff >= 0 ? "text-sea-700" : "text-coral-700"
                          }
                        >
                          {diff >= 0 ? "+" : ""}
                          {diff.toFixed(1)}
                        </span>
                      </td>
                      <td className="py-2">
                        <DistributionBar
                          value={value}
                          line={prop.line}
                          max={maxBar}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="glass-strong rounded-2xl p-5">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
            Projection breakdown
          </h2>
          <div className="space-y-4">
            <ProbBar
              label="Model probability (over)"
              value={modelOver}
              caption={`Over ${formatLine(prop.line)}`}
              accent="positive"
            />
            <ProbBar
              label="No-vig market probability"
              value={noVigOver}
              caption={`Over @ ${formatAmericanOdds(prop.overOdds)}`}
              accent="neutral"
            />
            <div className="rounded-xl bg-white/70 p-3 ring-1 ring-ink-200/50">
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
                Projection range (±1σ)
              </div>
              <div className="tabular mt-1 text-base font-semibold text-ink-900">
                {(prop.projection - prop.projectionStdDev).toFixed(1)} –{" "}
                {(prop.projection + prop.projectionStdDev).toFixed(1)} {unit}
              </div>
              <div className="mt-1 text-[11px] text-ink-500">
                σ = {prop.projectionStdDev.toFixed(1)} {unit}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="glass-strong rounded-2xl p-5 lg:col-span-2">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
            Line shopping
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-500">
                <tr>
                  <th className="py-2 pr-4 text-left">Sportsbook</th>
                  <th className="py-2 pr-4 text-right">Line</th>
                  <th className="py-2 pr-4 text-right">Over</th>
                  <th className="py-2 pr-4 text-right">Under</th>
                  <th className="py-2 text-right">
                    Best for{" "}
                    {scorecard.selectedSide === "UNDER" ? "Under" : "Over"}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-200/40">
                {detail.altLines.map((alt) => {
                  const bestOddsForSide =
                    scorecard.selectedSide === "UNDER"
                      ? alt.underOdds
                      : alt.overOdds;
                  const bestOddsAll = detail.altLines.reduce(
                    (acc, x) =>
                      Math.max(
                        acc,
                        scorecard.selectedSide === "UNDER"
                          ? x.underOdds
                          : x.overOdds,
                      ),
                    -Infinity,
                  );
                  const isBest = bestOddsForSide === bestOddsAll;
                  return (
                    <tr key={alt.sportsbook}>
                      <td className="py-2 pr-4 font-medium text-ink-900">
                        {alt.sportsbook}
                      </td>
                      <td className="tabular py-2 pr-4 text-right text-ink-700">
                        {formatLine(alt.line)}
                      </td>
                      <td className="tabular py-2 pr-4 text-right text-ink-700">
                        {formatAmericanOdds(alt.overOdds)}
                      </td>
                      <td className="tabular py-2 pr-4 text-right text-ink-700">
                        {formatAmericanOdds(alt.underOdds)}
                      </td>
                      <td className="py-2 text-right">
                        {isBest && (
                          <span className="inline-flex items-center rounded-full bg-sea-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sea-700 ring-1 ring-sea-200">
                            Best price
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

        <div className="glass-strong rounded-2xl p-5">
          <h2 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
            Matchup notes
          </h2>
          <ul className="space-y-2 text-sm text-ink-800">
            {detail.matchupNotes.map((note, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
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
      ? "text-sea-700"
      : tone === "negative"
        ? "text-coral-700"
        : "text-ink-500";
  return (
    <div className="rounded-xl bg-white/70 p-3 ring-1 ring-ink-200/50">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
        {label}
      </div>
      <div className="tabular mt-1 text-lg font-semibold text-ink-900">
        {value}
      </div>
      {sub && (
        <div className={`tabular mt-0.5 text-xs ${subClass}`}>{sub}</div>
      )}
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
      ? "bg-gradient-to-r from-sea-400 to-sea-600"
      : "bg-gradient-to-r from-ink-300 to-ink-400";
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs">
        <span className="font-medium text-ink-700">{label}</span>
        <span className="tabular font-semibold text-ink-900">
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink-200/60">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${pct}%` }}
        />
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
    <div className="relative h-2 w-40 overflow-hidden rounded-full bg-ink-200/60">
      <div
        className={`h-full ${cleared ? "bg-sea-500/70" : "bg-coral-500/70"}`}
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-[-2px] h-3 w-px bg-ink-800/70"
        style={{ left: `${linePct}%` }}
        title={`Line: ${line}`}
      />
    </div>
  );
}
