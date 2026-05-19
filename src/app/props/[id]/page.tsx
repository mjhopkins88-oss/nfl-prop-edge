import Link from "next/link";
import { notFound } from "next/navigation";
import { getAllPropIds, getPropDetail } from "@/lib/data/props";
import {
  PROP_TYPE_LABEL,
  PROP_TYPE_UNIT,
  americanOddsToImpliedProb,
  formatAmericanOdds,
  formatLine,
  formatProjection,
} from "@/lib/prop-utils";
import type { GameLog, PropType } from "@/lib/data/types";
import TeamBadge from "@/components/TeamBadge";
import EdgeBadge from "@/components/EdgeBadge";
import RecommendationPill from "@/components/RecommendationPill";
import ConfidenceMeter from "@/components/ConfidenceMeter";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ArrowLeftIcon,
  ChartBarIcon,
  ClockIcon,
  InfoIcon,
  ScalesIcon,
  SparkleIcon,
  TargetIcon,
} from "@/components/icons";

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
        className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 transition hover:text-amber-700"
      >
        <ArrowLeftIcon className="h-3.5 w-3.5" />
        Back to opportunities
      </Link>

      {/* HERO */}
      <section className="glass-strong relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-gradient-to-br from-amber-200/60 via-coral-200/40 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-72 w-72 rounded-full bg-gradient-to-tr from-sea-200/40 via-sky2-100/40 to-transparent blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-5">
            <TeamBadge abbr={detail.player.teamAbbr} size="lg" />
            <div>
              <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
                <SparkleIcon className="h-3 w-3" />
                {PROP_TYPE_LABEL[detail.propType]}
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink-900">
                {detail.player.fullName}
              </h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-ink-700">
                <span>{detail.player.position}</span>
                <span className="text-ink-400">·</span>
                <span>
                  {detail.team.city} {detail.team.name}
                </span>
                <span className="text-ink-400">·</span>
                <span className="text-ink-500">{isHome ? "vs" : "@"}</span>
                <TeamBadge abbr={opponentAbbr} size="sm" />
                <span className="text-ink-700">
                  {detail.opponent.city} {detail.opponent.name}
                </span>
              </div>
              <div className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-ink-500">
                <ClockIcon className="h-3 w-3" />
                Week {detail.game.week} · {kickoffDate}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <RecommendationPill rec={detail.recommendation} size="lg" />
                <EdgeBadge edge={detail.edge} size="lg" showIcon />
                <div className="rounded-xl bg-white/70 px-3 py-1.5 text-[11px] font-medium ring-1 ring-ink-200/60">
                  <span className="uppercase tracking-[0.12em] text-ink-500">
                    Confidence
                  </span>
                  <span className="ml-2 inline-flex items-center">
                    <ConfidenceMeter value={detail.confidence} width="wide" />
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:min-w-[320px]">
            <HeroMetric
              icon={<ScalesIcon className="h-3.5 w-3.5" />}
              label="Market line"
              value={`${formatLine(detail.line)} ${unit}`}
              sub={detail.sportsbook}
            />
            <HeroMetric
              icon={<TargetIcon className="h-3.5 w-3.5" />}
              label="Projection"
              value={`${formatProjection(detail.projection, detail.propType)} ${unit}`}
              sub={`${projVsLine >= 0 ? "+" : ""}${projVsLine.toFixed(1)} (${projVsLinePct >= 0 ? "+" : ""}${projVsLinePct.toFixed(1)}%)`}
              subTone={projVsLine >= 0 ? "positive" : "negative"}
            />
            <HeroMetric
              icon={<SparkleIcon className="h-3.5 w-3.5" />}
              label="Expected value"
              value={`${detail.expectedValue >= 0 ? "+" : ""}${(detail.expectedValue * 100).toFixed(1)}%`}
              sub={`per unit on ${detail.recommendation}`}
              valueTone={detail.expectedValue >= 0 ? "positive" : "negative"}
            />
            <HeroMetric
              icon={<ActivityIcon className="h-3.5 w-3.5" />}
              label="Recommended odds"
              value={formatAmericanOdds(recommendedOdds)}
              sub={`Model ${(recommendedModelProb * 100).toFixed(1)}% vs book ${(recommendedImpliedProb * 100).toFixed(1)}%`}
            />
          </div>
        </div>
      </section>

      {/* COMPARISON CARDS — model vs market */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ProbCard
          label="Model probability"
          subLabel={`Over ${formatLine(detail.line)}`}
          value={modelOver}
          tone="positive"
        />
        <ProbCard
          label="Market implied probability"
          subLabel={`Over @ ${formatAmericanOdds(detail.overOdds)}`}
          value={bookOver}
          tone="neutral"
        />
      </section>

      {/* PROJECTION BREAKDOWN + REASONS + RISKS */}
      <section className="grid gap-6 lg:grid-cols-3">
        <div className="glass rounded-2xl p-5 lg:col-span-1">
          <SectionHeader
            icon={<ChartBarIcon className="h-3.5 w-3.5" />}
            label="Projection breakdown"
          />
          <div className="space-y-3">
            <div className="rounded-xl bg-white/55 p-3 ring-1 ring-ink-200/50">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
                Mean
              </div>
              <div className="tabular mt-1 text-2xl font-semibold text-ink-900">
                {formatProjection(detail.projection, detail.propType)}{" "}
                <span className="text-sm font-normal text-ink-500">{unit}</span>
              </div>
            </div>
            <div className="rounded-xl bg-white/55 p-3 ring-1 ring-ink-200/50">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
                Range (±1σ)
              </div>
              <div className="tabular mt-1 text-base font-medium text-ink-900">
                {(detail.projection - detail.projectionStdDev).toFixed(1)} –{" "}
                {(detail.projection + detail.projectionStdDev).toFixed(1)} {unit}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-500">
                σ = {detail.projectionStdDev.toFixed(1)} {unit}
              </div>
            </div>
            <div className="rounded-xl bg-white/55 p-3 ring-1 ring-ink-200/50">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
                Recommended side
              </div>
              <div className="mt-1 flex items-center gap-2">
                <RecommendationPill rec={detail.recommendation} size="sm" />
                <span className="tabular text-sm text-ink-800">
                  EV {detail.expectedValue >= 0 ? "+" : ""}
                  {(detail.expectedValue * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="glass rounded-2xl p-5 lg:col-span-1">
          <SectionHeader
            icon={<SparkleIcon className="h-3.5 w-3.5" />}
            label="Top reasons"
            accent="sea"
          />
          <ul className="space-y-3 text-sm text-ink-800">
            {detail.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-sea-400 to-sea-600" />
                <span className="leading-snug">{r}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="glass rounded-2xl p-5 lg:col-span-1">
          <SectionHeader
            icon={<AlertTriangleIcon className="h-3.5 w-3.5" />}
            label="Risks"
            accent="coral"
          />
          <ul className="space-y-3 text-sm text-ink-800">
            {detail.risks.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-gradient-to-br from-coral-400 to-coral-600" />
                <span className="leading-snug">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* WHAT WOULD CHANGE THE RECOMMENDATION */}
      <section className="glass rounded-2xl p-5">
        <SectionHeader
          icon={<InfoIcon className="h-3.5 w-3.5" />}
          label="What would change the recommendation"
          accent="amber"
        />
        <div className="grid gap-3 sm:grid-cols-2">
          {detail.whatWouldChangeRec.map((line, i) => (
            <div
              key={i}
              className="flex items-start gap-2 rounded-xl bg-white/55 p-3 ring-1 ring-ink-200/50"
            >
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-100 text-[10px] font-semibold text-amber-700 ring-1 ring-amber-200">
                {i + 1}
              </span>
              <span className="text-sm leading-snug text-ink-800">{line}</span>
            </div>
          ))}
        </div>
      </section>

      {/* RECENT GAME LOGS */}
      <section className="glass rounded-2xl p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <SectionHeader
            icon={<ActivityIcon className="h-3.5 w-3.5" />}
            label="Recent trend"
            inline
          />
          <span className="text-xs text-ink-500">
            Last {detail.recentLogs.length} games · Avg{" "}
            <span className="tabular font-medium text-ink-800">
              {logAvg.toFixed(1)} {unit}
            </span>{" "}
            · Over rate{" "}
            <span className="tabular font-medium text-ink-800">
              {(hitRateLastN * 100).toFixed(0)}%
            </span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
              <tr>
                <th className="py-2 pr-4 text-left">Week</th>
                <th className="py-2 pr-4 text-left">Opp</th>
                <th className="py-2 pr-4 text-right">
                  {PROP_TYPE_LABEL[detail.propType]}
                </th>
                <th className="py-2 pr-4 text-right">vs Line</th>
                <th className="py-2 text-left">Distribution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200/60">
              {detail.recentLogs.map((log) => {
                const value = Number(log[statKey] ?? 0);
                const diff = value - detail.line;
                return (
                  <tr key={`${log.season}-${log.week}`}>
                    <td className="py-2.5 pr-4 text-ink-700">W{log.week}</td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-1.5">
                        <TeamBadge abbr={log.opponentAbbr} size="sm" />
                      </div>
                    </td>
                    <td className="tabular py-2.5 pr-4 text-right text-ink-900">
                      {value} {unit}
                    </td>
                    <td className="tabular py-2.5 pr-4 text-right">
                      <span
                        className={
                          diff >= 0 ? "text-sea-700" : "text-coral-600"
                        }
                      >
                        {diff >= 0 ? "+" : ""}
                        {diff.toFixed(1)}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <DistributionBar
                        value={value}
                        line={detail.line}
                        max={maxBar}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* LINE SHOPPING */}
      <section className="glass rounded-2xl p-5">
        <SectionHeader
          icon={<ScalesIcon className="h-3.5 w-3.5" />}
          label="Line shopping"
        />
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
              <tr>
                <th className="py-2 pr-4 text-left">Sportsbook</th>
                <th className="py-2 pr-4 text-right">Line</th>
                <th className="py-2 pr-4 text-right">Over</th>
                <th className="py-2 pr-4 text-right">Under</th>
                <th className="py-2 text-right">
                  Best for {detail.recommendation === "UNDER" ? "Under" : "Over"}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-200/60">
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
                    <td className="py-2.5 pr-4 font-medium text-ink-900">
                      {alt.sportsbook}
                    </td>
                    <td className="tabular py-2.5 pr-4 text-right text-ink-700">
                      {formatLine(alt.line)}
                    </td>
                    <td className="tabular py-2.5 pr-4 text-right text-ink-700">
                      {formatAmericanOdds(alt.overOdds)}
                    </td>
                    <td className="tabular py-2.5 pr-4 text-right text-ink-700">
                      {formatAmericanOdds(alt.underOdds)}
                    </td>
                    <td className="py-2.5 text-right">
                      {isBest && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-br from-sea-100 to-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-sea-700 ring-1 ring-sea-300/60">
                          <SparkleIcon className="h-3 w-3" />
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
      </section>
    </div>
  );
}

function SectionHeader({
  icon,
  label,
  accent,
  inline,
}: {
  icon: React.ReactNode;
  label: string;
  accent?: "amber" | "sea" | "coral";
  inline?: boolean;
}) {
  const colorClass = accent === "sea"
    ? "text-sea-700"
    : accent === "coral"
      ? "text-coral-600"
      : "text-amber-700";
  return (
    <div
      className={`flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-700 ${inline ? "" : "mb-3"}`}
    >
      <span className={colorClass}>{icon}</span>
      {label}
    </div>
  );
}

function HeroMetric({
  icon,
  label,
  value,
  sub,
  subTone,
  valueTone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  subTone?: "positive" | "negative";
  valueTone?: "positive" | "negative";
}) {
  const subClass =
    subTone === "positive"
      ? "text-sea-700"
      : subTone === "negative"
        ? "text-coral-600"
        : "text-ink-500";
  const valClass =
    valueTone === "positive"
      ? "text-sea-700"
      : valueTone === "negative"
        ? "text-coral-600"
        : "text-ink-900";
  return (
    <div className="rounded-2xl bg-white/65 p-3.5 ring-1 ring-ink-200/60 backdrop-blur">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
        <span className="text-amber-700">{icon}</span>
        {label}
      </div>
      <div className={`tabular mt-1 text-lg font-semibold ${valClass}`}>{value}</div>
      {sub && <div className={`tabular text-[11px] ${subClass}`}>{sub}</div>}
    </div>
  );
}

function ProbCard({
  label,
  subLabel,
  value,
  tone,
}: {
  label: string;
  subLabel: string;
  value: number;
  tone: "positive" | "neutral";
}) {
  const pct = value * 100;
  const fill =
    tone === "positive"
      ? "bg-gradient-to-r from-sea-400 via-sea-500 to-sea-600"
      : "bg-gradient-to-r from-ink-300 via-ink-400 to-ink-500";
  return (
    <div className="glass rounded-2xl p-5">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
            {label}
          </div>
          <div className="mt-0.5 text-xs text-ink-500">{subLabel}</div>
        </div>
        <div className="tabular text-2xl font-semibold text-ink-900">
          {pct.toFixed(1)}%
        </div>
      </div>
      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-ink-200/60">
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
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
        className={`h-full ${
          cleared
            ? "bg-gradient-to-r from-sea-300 to-sea-500"
            : "bg-gradient-to-r from-coral-300 to-coral-500"
        }`}
        style={{ width: `${pct}%` }}
      />
      <div
        className="absolute top-[-2px] h-3 w-px bg-ink-900/70"
        style={{ left: `${linePct}%` }}
        title={`Line: ${line}`}
      />
    </div>
  );
}
