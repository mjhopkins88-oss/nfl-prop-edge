import Link from "next/link";
import { getPropOpportunities } from "@/lib/data/props";
import { getCurrentWeekGames } from "@/lib/data/games";
import { getBacktestSummary } from "@/lib/data/backtest";
import { PROP_TYPE_SHORT, formatEdge } from "@/lib/prop-utils";
import TeamBadge from "./TeamBadge";
import {
  ChartBarIcon,
  ChevronRightIcon,
  ClockIcon,
  SparkleIcon,
  TrendUpIcon,
} from "./icons";

export default function DashboardSidebar() {
  const topEdges = getPropOpportunities({ sort: "edge" })
    .filter((o) => o.recommendation !== "PASS" && o.edge > 0)
    .slice(0, 5);
  const games = getCurrentWeekGames();
  const backtest = getBacktestSummary();
  const positiveSlices = backtest.byMarket
    .filter((m) => m.roiPct > 0)
    .sort((a, b) => b.roiPct - a.roiPct)
    .slice(0, 3);

  return (
    <aside className="space-y-4">
      <Panel
        icon={<SparkleIcon className="h-3.5 w-3.5" />}
        title="Top edges"
        accent="from-amber-200/70"
      >
        <ul className="space-y-2.5">
          {topEdges.map((o) => (
            <li key={o.id}>
              <Link
                href={`/props/${o.id}`}
                className="group flex items-center gap-2.5"
              >
                <TeamBadge abbr={o.player.teamAbbr} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-900 group-hover:text-amber-700">
                    {o.player.fullName}
                  </div>
                  <div className="truncate text-[11px] text-ink-500">
                    {PROP_TYPE_SHORT[o.propType]} · {o.line.toFixed(1)} ·{" "}
                    {o.recommendation}
                  </div>
                </div>
                <span className="tabular shrink-0 text-xs font-semibold text-sea-700">
                  {formatEdge(o.edge)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        icon={<ClockIcon className="h-3.5 w-3.5" />}
        title="This week"
        accent="from-sky2-200/60"
      >
        <ul className="space-y-2 text-sm">
          {games.map((g) => {
            const kickoff = new Date(g.kickoff).toLocaleString("en-US", {
              weekday: "short",
              hour: "numeric",
              minute: "2-digit",
            });
            return (
              <li key={g.id} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-ink-700">
                  <TeamBadge abbr={g.awayTeamAbbr} size="sm" />
                  <span className="text-ink-500">@</span>
                  <TeamBadge abbr={g.homeTeamAbbr} size="sm" />
                </div>
                <span className="text-[11px] text-ink-500">{kickoff}</span>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel
        icon={<ChartBarIcon className="h-3.5 w-3.5" />}
        title="Model performance"
        accent="from-sea-200/70"
        action={
          <Link
            href="/backtest"
            className="inline-flex items-center gap-0.5 text-[11px] font-medium text-sea-700 hover:gap-1.5"
          >
            View backtest <ChevronRightIcon className="h-3 w-3" />
          </Link>
        }
      >
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="ROI" value={`+${backtest.roiPct.toFixed(1)}%`} tone="positive" />
          <Mini label="Plays" value={`${backtest.totalPlays}`} />
          <Mini
            label="Hit rate"
            value={`${((backtest.wins / Math.max(1, backtest.totalPlays)) * 100).toFixed(0)}%`}
          />
        </div>
        <div className="mt-3 space-y-1.5">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
            Best markets
          </div>
          {positiveSlices.map((s) => (
            <div
              key={s.propType}
              className="flex items-center justify-between text-xs"
            >
              <span className="text-ink-700">{PROP_TYPE_SHORT[s.propType]}</span>
              <span className="tabular flex items-center gap-1 text-sea-700">
                <TrendUpIcon className="h-3 w-3" />+{s.roiPct.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </Panel>
    </aside>
  );
}

function Panel({
  icon,
  title,
  accent,
  action,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-4">
      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br ${accent} via-transparent to-transparent blur-2xl`}
      />
      <div className="relative mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-700">
          <span className="text-amber-700">{icon}</span>
          {title}
        </div>
        {action}
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive";
}) {
  const valTone = tone === "positive" ? "text-sea-700" : "text-ink-900";
  return (
    <div className="rounded-lg bg-white/55 px-2 py-1.5 ring-1 ring-ink-200/50">
      <div className="text-[10px] font-medium uppercase tracking-wider text-ink-500">
        {label}
      </div>
      <div className={`tabular mt-0.5 text-sm font-semibold ${valTone}`}>{value}</div>
    </div>
  );
}
