import Link from "next/link";
import type { PropOpportunity } from "@/lib/data/types";
import {
  PROP_TYPE_LABEL,
  PROP_TYPE_UNIT,
  formatAmericanOdds,
  formatLine,
  formatProjection,
} from "@/lib/prop-utils";
import { getPropDetail } from "@/lib/data/props";
import TeamBadge from "./TeamBadge";
import EdgeBadge from "./EdgeBadge";
import RecommendationPill from "./RecommendationPill";
import ConfidenceMeter from "./ConfidenceMeter";
import {
  ActivityIcon,
  AlertTriangleIcon,
  ChevronRightIcon,
  ClockIcon,
  ScalesIcon,
  SparkleIcon,
  TargetIcon,
} from "./icons";

export default function PropCard({ opp }: { opp: PropOpportunity }) {
  // Reasons + risks live on the detail view-model. PropCard reads the
  // detail from the same data-layer function the detail page uses,
  // keeping the source of truth single.
  const detail = getPropDetail(opp.id);
  const reasons = (detail?.reasons ?? []).slice(0, 2);
  const risks = (detail?.risks ?? []).slice(0, 1);

  const odds = opp.recommendation === "UNDER" ? opp.underOdds : opp.overOdds;
  const unit = PROP_TYPE_UNIT[opp.propType];
  const projDelta = opp.projection - opp.line;
  const modelPct = opp.modelHitRateOver * 100;
  const bookPct = opp.bookImpliedOver * 100;
  const evPct = detail ? detail.expectedValue * 100 : 0;
  const kickoff = new Date(opp.game.kickoff).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <Link
      href={`/props/${opp.id}`}
      className="group glass relative block overflow-hidden rounded-3xl p-5 transition hover:shadow-glass-lg"
    >
      {/* glow accent in corner */}
      <div className="pointer-events-none absolute -right-12 -top-12 h-36 w-36 rounded-full bg-gradient-to-br from-amber-200/50 via-coral-200/30 to-transparent blur-2xl" />

      {/* header */}
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <TeamBadge abbr={opp.player.teamAbbr} size="md" />
          <div className="min-w-0">
            <div className="text-base font-semibold tracking-tight text-ink-900">
              {opp.player.fullName}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-600">
              <span className="font-medium">{opp.player.position}</span>
              <span className="text-ink-400">·</span>
              <span>{opp.team.name}</span>
              <span className="text-ink-400">·</span>
              <span className="text-ink-500">{opp.isHome ? "vs" : "@"}</span>
              <TeamBadge abbr={opp.opponent.abbreviation} size="sm" />
            </div>
          </div>
        </div>
        <RecommendationPill rec={opp.recommendation} size="md" />
      </div>

      {/* market label */}
      <div className="relative mt-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
        <SparkleIcon className="h-3.5 w-3.5" />
        {PROP_TYPE_LABEL[opp.propType]}
      </div>

      {/* key metrics row */}
      <div className="relative mt-2 grid grid-cols-4 gap-3">
        <Metric
          icon={<ScalesIcon className="h-3 w-3" />}
          label="Line"
          value={
            <>
              {formatLine(opp.line)}
              <span className="ml-0.5 text-[10px] font-normal text-ink-500">{unit}</span>
            </>
          }
        />
        <Metric
          icon={<TargetIcon className="h-3 w-3" />}
          label="Projection"
          value={formatProjection(opp.projection, opp.propType)}
          sub={`${projDelta >= 0 ? "+" : ""}${projDelta.toFixed(1)} vs line`}
          subTone={projDelta >= 0 ? "positive" : "negative"}
        />
        <Metric
          icon={<SparkleIcon className="h-3 w-3" />}
          label="Edge"
          value={`${opp.edge >= 0 ? "+" : ""}${(opp.edge * 100).toFixed(1)}%`}
          sub={`EV ${evPct >= 0 ? "+" : ""}${evPct.toFixed(1)}%`}
          valueTone={opp.edge >= 0 ? "positive" : "negative"}
        />
        <Metric
          icon={<ActivityIcon className="h-3 w-3" />}
          label="Confidence"
          value={`${Math.round(opp.confidence * 100)}%`}
          render={
            <div className="mt-1">
              <ConfidenceMeter value={opp.confidence} showLabel={false} width="narrow" />
            </div>
          }
        />
      </div>

      {/* probability comparison */}
      <div className="relative mt-4 space-y-2">
        <ProbBar
          label="Model probability"
          pct={modelPct}
          tone="positive"
        />
        <ProbBar label="Market implied" pct={bookPct} tone="neutral" />
      </div>

      {/* reasons */}
      {reasons.length > 0 && (
        <div className="relative mt-4">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-sea-700">
            <SparkleIcon className="h-3 w-3" />
            Top reasons
          </div>
          <ul className="space-y-1 text-xs text-ink-700">
            {reasons.map((r, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-sea-500" />
                <span className="leading-snug">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* risks */}
      {risks.length > 0 && (
        <div className="relative mt-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-coral-600">
            <AlertTriangleIcon className="h-3 w-3" />
            Risks
          </div>
          <ul className="space-y-1 text-xs text-ink-700">
            {risks.map((r, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-coral-500" />
                <span className="leading-snug">{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* footer */}
      <div className="relative mt-4 flex items-center justify-between gap-2 border-t border-ink-200/60 pt-3 text-[11px]">
        <div className="flex items-center gap-2 text-ink-600">
          <span className="rounded-md bg-cream-100 px-1.5 py-0.5 font-medium text-ink-700 ring-1 ring-ink-200/60">
            {opp.sportsbook}
          </span>
          <span className="tabular text-ink-700">{formatAmericanOdds(odds)}</span>
          <span className="inline-flex items-center gap-1 text-ink-500">
            <ClockIcon className="h-3 w-3" /> {kickoff}
          </span>
        </div>
        <span className="inline-flex items-center gap-0.5 text-amber-700 transition group-hover:gap-1.5">
          Detail <ChevronRightIcon className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  );
}

function Metric({
  icon,
  label,
  value,
  sub,
  subTone,
  valueTone,
  render,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: string;
  subTone?: "positive" | "negative";
  valueTone?: "positive" | "negative";
  render?: React.ReactNode;
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
    <div className="rounded-xl bg-white/55 px-2.5 py-1.5 ring-1 ring-ink-200/50">
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.1em] text-ink-500">
        <span className="text-ink-400">{icon}</span>
        {label}
      </div>
      <div className={`tabular mt-0.5 text-sm font-semibold ${valClass}`}>{value}</div>
      {sub && <div className={`tabular text-[10px] ${subClass}`}>{sub}</div>}
      {render}
    </div>
  );
}

function ProbBar({
  label,
  pct,
  tone,
}: {
  label: string;
  pct: number;
  tone: "positive" | "neutral";
}) {
  const fill =
    tone === "positive"
      ? "bg-gradient-to-r from-sea-400 via-sea-500 to-sea-600"
      : "bg-gradient-to-r from-ink-300 to-ink-400";
  return (
    <div>
      <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
        <span className="text-ink-500">{label}</span>
        <span className="tabular font-medium text-ink-800">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-ink-200/60">
        <div
          className={`h-full rounded-full ${fill}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}
