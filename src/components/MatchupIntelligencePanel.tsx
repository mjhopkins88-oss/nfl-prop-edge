import clsx from "clsx";
import type {
  ImpactLabel,
  MatchupScorecardComponent,
} from "@/lib/model/matchup-intelligence-types";
import type { PropType } from "@/lib/types";
import { PROP_TYPE_SHORT } from "@/lib/prop-utils";

const IMPACT_TONE: Record<ImpactLabel, string> = {
  STRONG_POSITIVE: "bg-sea-50 text-sea-800 ring-sea-200",
  POSITIVE: "bg-sea-50/70 text-sea-700 ring-sea-200/60",
  NEUTRAL: "bg-ink-100/70 text-ink-600 ring-ink-200/60",
  UNCERTAIN: "bg-amber-50 text-amber-800 ring-amber-200",
  NEGATIVE: "bg-rose-50/80 text-coral-700 ring-coral-200/70",
  STRONG_NEGATIVE: "bg-rose-50 text-coral-700 ring-coral-200",
};

const PROP_TYPE_ORDER: PropType[] = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
];

export default function MatchupIntelligencePanel({
  component,
}: {
  component: MatchupScorecardComponent;
}) {
  const meanPct = component.projectedMeanMultiplier * 100 - 100;
  const sigmaPct = component.projectedStdDevMultiplier * 100 - 100;
  return (
    <section className="glass-strong rounded-2xl p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-700">
            Football Matchup Intelligence
          </h2>
          <p className="mt-1 text-sm text-ink-700">
            Optional knowledge layer. Mean shift is informational only;
            it never changes the qualification decision.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag>{prettyTag(component.defensiveArchetype)}</Tag>
          <Tag>{prettyTag(component.playerRole)}</Tag>
          <Tag>{prettyTag(component.weatherArchetype)}</Tag>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell
          label="Mean shift (info)"
          value={`${meanPct >= 0 ? "+" : ""}${meanPct.toFixed(1)}%`}
          tone={meanPct > 0 ? "positive" : meanPct < 0 ? "negative" : "neutral"}
          sub="Not applied to qualify math"
        />
        <Cell
          label="σ widening (applied)"
          value={`${sigmaPct >= 0 ? "+" : ""}${sigmaPct.toFixed(0)}%`}
          tone={sigmaPct > 0 ? "warning" : "neutral"}
        />
        <Cell
          label="Confidence Δ"
          value={`${component.confidenceAdjustment >= 0 ? "+" : ""}${(component.confidenceAdjustment * 100).toFixed(0)}pp`}
          tone={component.confidenceAdjustment < 0 ? "warning" : "neutral"}
        />
        <Cell
          label="Tags"
          value={`${component.matchupTags.length}`}
          sub={component.matchupTags.slice(0, 3).join(" · ") || "—"}
        />
      </div>

      <div className="mt-5">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700">
          Per-prop impact map
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {PROP_TYPE_ORDER.map((pt) => (
            <div
              key={pt}
              className={clsx(
                "rounded-xl px-3 py-2 ring-1 backdrop-blur",
                IMPACT_TONE[component.propImpacts[pt]],
              )}
            >
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] opacity-80">
                {PROP_TYPE_SHORT[pt]}
              </div>
              <div className="mt-0.5 text-[11px] font-semibold tracking-[0.04em]">
                {prettyImpact(component.propImpacts[pt])}
              </div>
            </div>
          ))}
        </div>
      </div>

      {(component.reasons.length > 0 || component.risks.length > 0) && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {component.reasons.length > 0 && (
            <ListBlock
              title="Matchup reasons"
              items={component.reasons}
              tone="positive"
            />
          )}
          {component.risks.length > 0 && (
            <ListBlock
              title="Matchup risks"
              items={component.risks}
              tone="negative"
            />
          )}
        </div>
      )}

      <p className="mt-4 text-xs text-ink-600">{component.summary}</p>
    </section>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-cream-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-800 ring-1 ring-amber-200/60">
      {children}
    </span>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "negative" | "warning" | "neutral";
}) {
  const valueClass =
    tone === "positive"
      ? "text-sea-700"
      : tone === "negative"
        ? "text-coral-700"
        : tone === "warning"
          ? "text-amber-700"
          : "text-ink-900";
  return (
    <div className="rounded-xl bg-white/70 p-3 ring-1 ring-ink-200/50">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-500">
        {label}
      </div>
      <div className={`tabular mt-1 text-base font-semibold ${valueClass}`}>
        {value}
      </div>
      {sub && (
        <div className="tabular mt-0.5 text-[11px] text-ink-500">{sub}</div>
      )}
    </div>
  );
}

function ListBlock({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "positive" | "negative";
}) {
  const containerClass =
    tone === "positive"
      ? "bg-sea-50/60 ring-sea-200/60"
      : "bg-amber-50/70 ring-amber-200/60";
  const labelTone = tone === "positive" ? "text-sea-800" : "text-amber-900";
  const bullet = tone === "positive" ? "bg-sea-500" : "bg-coral-500";
  return (
    <div className={clsx("rounded-xl p-3 ring-1 backdrop-blur", containerClass)}>
      <div className={clsx("mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]", labelTone)}>
        {title}
      </div>
      <ul className="space-y-1.5 text-xs text-ink-800">
        {items.map((item, i) => (
          <li key={i} className="flex gap-2">
            <span className={clsx("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", bullet)} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function prettyTag(s: string): string {
  return s
    .toLowerCase()
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function prettyImpact(label: ImpactLabel): string {
  return label.toLowerCase().split("_").join(" ");
}
