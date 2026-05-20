import Link from "next/link";
import { PARLAY_CANDIDATE_FIXTURES } from "@/lib/model/parlay-data";
import {
  buildAllFixtureParlayCandidates,
  correlationTypeClasses,
  formatAmericanOdds,
  formatDecimalOdds,
  formatEv,
  formatProbability,
  parlayTypeLabel,
  recommendationLabel,
  recommendationLabelClasses,
  recommendationTone,
  summarizeParlays,
} from "@/lib/model/parlay-scorecard";
import type {
  ParlayCandidate,
  ParlayRecommendation,
} from "@/lib/model/parlay-types";

type Tab =
  | "all"
  | "qualified"
  | "watch"
  | "pass"
  | "qb-wr"
  | "rb"
  | "weather-under"
  | "high-payout"
  | "low-risk";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "qualified", label: "Qualified" },
  { id: "watch", label: "Correlated Watch" },
  { id: "pass", label: "Pass" },
  { id: "qb-wr", label: "QB/WR stacks" },
  { id: "rb", label: "RB stacks" },
  { id: "weather-under", label: "Weather/Under stacks" },
  { id: "high-payout", label: "High payout" },
  { id: "low-risk", label: "Low risk" },
];

function applyTab(parlays: ParlayCandidate[], tab: Tab): ParlayCandidate[] {
  switch (tab) {
    case "all":
      return parlays;
    case "qualified":
      return parlays.filter((p) => p.qualified);
    case "watch":
      return parlays.filter((p) => p.recommendation === "CORRELATED_WATCH");
    case "pass":
      return parlays.filter(
        (p) => !p.qualified && p.recommendation !== "CORRELATED_WATCH",
      );
    case "qb-wr":
      return parlays.filter(
        (p) =>
          p.parlayType === "QB_RECEIVER_YARDS" ||
          p.parlayType === "QB_COMPLETIONS_RECEIVER_RECEPTIONS" ||
          p.parlayType === "PASS_VOLUME_STACK",
      );
    case "rb":
      return parlays.filter((p) => p.parlayType === "RB_GAME_SCRIPT_STACK");
    case "weather-under":
      return parlays.filter(
        (p) =>
          p.parlayType === "WEATHER_UNDER_STACK" ||
          p.parlayType === "NEGATIVE_PASSING_STACK",
      );
    case "high-payout":
      return parlays.filter((p) => p.payoutMultiplier >= 5);
    case "low-risk":
      return parlays.filter((p) => p.riskScore >= 0.7);
  }
}

export default async function ParlaysPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const tab: Tab = (TABS.find((t) => t.id === params.tab)?.id ?? "all") as Tab;
  const parlays = buildAllFixtureParlayCandidates();
  const filtered = applyTab(parlays, tab);
  const summary = summarizeParlays(parlays);
  const scenarioByLegIds = new Map<string, string>();
  for (const f of PARLAY_CANDIDATE_FIXTURES) {
    scenarioByLegIds.set(f.legIds.join("+"), f.scenarioNote);
  }
  const counts: Record<Tab, number> = {
    all: parlays.length,
    qualified: parlays.filter((p) => p.qualified).length,
    watch: parlays.filter((p) => p.recommendation === "CORRELATED_WATCH").length,
    pass: parlays.filter(
      (p) => !p.qualified && p.recommendation !== "CORRELATED_WATCH",
    ).length,
    "qb-wr": parlays.filter(
      (p) =>
        p.parlayType === "QB_RECEIVER_YARDS" ||
        p.parlayType === "QB_COMPLETIONS_RECEIVER_RECEPTIONS" ||
        p.parlayType === "PASS_VOLUME_STACK",
    ).length,
    rb: parlays.filter((p) => p.parlayType === "RB_GAME_SCRIPT_STACK").length,
    "weather-under": parlays.filter(
      (p) =>
        p.parlayType === "WEATHER_UNDER_STACK" ||
        p.parlayType === "NEGATIVE_PASSING_STACK",
    ).length,
    "high-payout": parlays.filter((p) => p.payoutMultiplier >= 5).length,
    "low-risk": parlays.filter((p) => p.riskScore >= 0.7).length,
  };

  return (
    <div className="space-y-8">
      <Hero summary={summary} />
      <TargetMathPanel summary={summary} />
      <TabBar active={tab} counts={counts} />
      <section className="space-y-4">
        {filtered.length === 0 && (
          <div className="glass-strong rounded-2xl p-8 text-center text-sm text-ink-600">
            No parlays match this filter.
          </div>
        )}
        {filtered.map((p) => (
          <ParlayCard
            key={p.id}
            parlay={p}
            scenarioNote={scenarioByLegIds.get(p.legs.map((l) => l.id).join("+"))}
          />
        ))}
      </section>
      <Footnote />
    </div>
  );
}

function Hero({
  summary,
}: {
  summary: ReturnType<typeof summarizeParlays>;
}) {
  return (
    <section>
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80 backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Experimental — research only, no bets placed
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
        Experimental{" "}
        <span className="bg-gradient-to-r from-sea-600 via-sky2-500 to-amber-500 bg-clip-text text-transparent">
          Correlated Parlay Model
        </span>
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-700">
        Builds 2-leg correlated parlays from V1 player props, scores joint
        probability with capped correlation adjustments, and surfaces only
        parlays where confidence-adjusted EV is positive and projected hit
        rate clears the required-for-10%-ROI threshold. <strong>Parlays
        amplify both edge and risk.</strong> This section does not place
        bets.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Parlays evaluated" value={`${summary.evaluated}`} />
        <Stat
          label="Qualified"
          value={`${summary.qualified}`}
          tone="play"
        />
        <Stat
          label="Correlated watch"
          value={`${summary.correlatedWatch}`}
          tone="watch"
        />
        <Stat
          label="Avg projected hit"
          value={formatProbability(summary.averageProjectedHitRate)}
        />
        <Stat
          label="Avg payout"
          value={formatDecimalOdds(summary.averagePayoutMultiplier)}
        />
        <Stat
          label="Avg conf-adj EV"
          value={formatEv(summary.averageConfidenceAdjustedEv)}
        />
      </div>
    </section>
  );
}

function TargetMathPanel({
  summary,
}: {
  summary: ReturnType<typeof summarizeParlays>;
}) {
  return (
    <section className="glass rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-sea-700">
        Target batch math — 10% ROI
      </div>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Math
          label={`Hit rate ${(summary.targetHitRateLow * 100).toFixed(0)}%`}
          value={`${summary.requiredPayoutAtLow.toFixed(2)}x`}
          sub="required average payout (stake + profit)"
        />
        <Math
          label={`Hit rate ${(
            ((summary.targetHitRateLow + summary.targetHitRateHigh) / 2) *
            100
          ).toFixed(1)}%`}
          value={`${summary.requiredPayoutAtMid.toFixed(2)}x`}
          sub="midpoint of target hit-rate band"
        />
        <Math
          label={`Hit rate ${(summary.targetHitRateHigh * 100).toFixed(0)}%`}
          value={`${summary.requiredPayoutAtHigh.toFixed(2)}x`}
          sub="required average payout (stake + profit)"
        />
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-ink-500">
        These are theoretical — must be validated by backtesting before any
        live use.
      </p>
    </section>
  );
}

function Math({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl bg-white/65 p-3 ring-1 ring-white/40">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className="mt-0.5 text-xl font-semibold text-ink-900">{value}</div>
      <div className="text-[11px] text-ink-600">{sub}</div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "play" | "watch";
}) {
  const ring =
    tone === "play"
      ? "ring-sea-200/70"
      : tone === "watch"
        ? "ring-amber-200/70"
        : "ring-white/40";
  return (
    <div className={`glass rounded-2xl p-4 ring-1 ${ring}`}>
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function TabBar({
  active,
  counts,
}: {
  active: Tab;
  counts: Record<Tab, number>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.id === "all" ? "/parlays" : `/parlays?tab=${t.id}`}
            className={
              isActive
                ? "rounded-full bg-ink-900 px-3.5 py-1.5 text-xs font-medium text-cream-50"
                : "rounded-full bg-white/65 px-3.5 py-1.5 text-xs font-medium text-ink-700 ring-1 ring-white/40 transition hover:bg-white"
            }
          >
            {t.label}
            <span
              className={
                isActive
                  ? "ml-2 rounded-full bg-cream-50/20 px-1.5 py-0.5 text-[10px] text-cream-50"
                  : "ml-2 rounded-full bg-ink-100/70 px-1.5 py-0.5 text-[10px] text-ink-600"
              }
            >
              {counts[t.id]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function ParlayCard({
  parlay,
  scenarioNote,
}: {
  parlay: ParlayCandidate;
  scenarioNote?: string;
}) {
  const rec: ParlayRecommendation = parlay.recommendation;
  const tone = recommendationTone(rec);
  return (
    <Link
      href={`/parlays/${parlay.id}`}
      className="glass-strong block rounded-2xl p-5 ring-1 ring-white/40 transition hover:ring-sea-300/60 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            {parlayTypeLabel(parlay.parlayType)} · {parlay.legCount} legs ·{" "}
            {parlay.gameIds.length} game
            {parlay.gameIds.length > 1 ? "s" : ""}
          </div>
          <h3 className="mt-0.5 text-lg font-semibold text-ink-900">
            {parlay.legs
              .map(
                (l) =>
                  `${l.playerName} ${l.propType.replace(/_/g, " ").toLowerCase()} ${l.side}`,
              )
              .join("  ·  ")}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ${recommendationLabelClasses(rec)}`}
          >
            {recommendationLabel(rec)}
          </span>
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 ${correlationTypeClasses(parlay.correlationType)}`}
            title={parlay.correlationExplanation}
          >
            Corr {parlay.correlationType.toLowerCase()}{" "}
            ({parlay.correlationScore.toFixed(2)})
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric
          label="Combined odds"
          value={formatAmericanOdds(parlay.combinedOddsAmerican)}
          sub={`${formatDecimalOdds(parlay.combinedOddsDecimal)} payout`}
        />
        <Metric
          label="Projected hit"
          value={formatProbability(parlay.projectedHitRate)}
          sub={`Required ${formatProbability(parlay.requiredHitRate)} for 10% ROI`}
        />
        <Metric
          label="EV"
          value={formatEv(parlay.expectedValue)}
          sub={`Conf-adj ${formatEv(parlay.confidenceAdjustedExpectedValue)}`}
        />
        <Metric
          label="Risk · DQ"
          value={`${parlay.riskScore.toFixed(2)} · ${parlay.dataQualityScore.toFixed(2)}`}
          sub={`Joint ${formatProbability(parlay.independentJointProbability)} → ${formatProbability(parlay.correlationAdjustedJointProbability)}`}
        />
      </div>

      {parlay.reasons.length > 0 && (
        <div className="mt-4 text-xs text-ink-700">
          · {parlay.reasons[0]}
        </div>
      )}
      {parlay.risks.length > 0 && (
        <div className="mt-1 text-xs text-amber-800">
          ⚠︎ {parlay.risks[0]}
        </div>
      )}
      {parlay.disqualifiers.length > 0 && (
        <div className="mt-1 text-xs text-coral-700">
          ✖ {parlay.disqualifiers[0]}
        </div>
      )}
      {scenarioNote && (
        <div className="mt-3 text-[11px] uppercase tracking-[0.12em] text-ink-400">
          {scenarioNote}
        </div>
      )}
      <div className="mt-2 text-[10px] text-ink-400">
        tone: {tone} · payout {formatDecimalOdds(parlay.payoutMultiplier)}
      </div>
    </Link>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl bg-white/55 p-3 ring-1 ring-white/40">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-ink-900">{value}</div>
      {sub && <div className="text-[11px] text-ink-600">{sub}</div>}
    </div>
  );
}

function Footnote() {
  return (
    <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900">
        Experimental model — read before acting
      </div>
      <div className="mt-2 space-y-1.5 text-xs text-amber-900">
        <div>
          · This is a SEPARATE section from Player Props and Game Edge.
          Their recommendations are unaffected.
        </div>
        <div>
          · Joint probability is the product of leg probabilities, adjusted
          by a capped correlation factor. Correlation cannot push joint
          probability up by more than 15% relative or pull it down by more
          than 20% relative.
        </div>
        <div>
          · High payout alone never qualifies a parlay. Correlation alone
          never qualifies a parlay. Confidence-adjusted EV must be
          positive AND projected hit rate must exceed the required hit
          rate for 10% ROI.
        </div>
        <div>
          · No real money. No automated betting. Backtest required before
          live use.
        </div>
      </div>
    </section>
  );
}
