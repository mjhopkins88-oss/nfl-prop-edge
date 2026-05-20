import Link from "next/link";
import { notFound } from "next/navigation";
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
} from "@/lib/model/parlay-scorecard";
import { calculateTargetBatchMath } from "@/lib/model/parlay-ev";

export function generateStaticParams() {
  return buildAllFixtureParlayCandidates().map((c) => ({ id: c.id }));
}

export default async function ParlayDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const parlay = buildAllFixtureParlayCandidates().find((c) => c.id === id);
  if (!parlay) notFound();
  const sc = parlay.scorecard;
  const batchMath = calculateTargetBatchMath({});

  return (
    <div className="space-y-8">
      <BackLink />
      <HeaderSection parlay={parlay} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Legs">
          <div className="space-y-3">
            {sc.legSummaries.map((leg) => (
              <div
                key={`${leg.playerName}-${leg.propType}-${leg.side}`}
                className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-semibold text-ink-900">
                    {leg.playerName}{" "}
                    <span className="text-ink-600">
                      {leg.propType.replace(/_/g, " ").toLowerCase()} {leg.side}{" "}
                      {leg.line}
                    </span>
                  </div>
                  <div className="text-xs text-ink-600 tabular-nums">
                    {formatAmericanOdds(leg.odds)}
                  </div>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-ink-700">
                  <div>
                    Edge{" "}
                    <span className="tabular-nums">
                      {leg.legEdgePp >= 0 ? "+" : ""}
                      {leg.legEdgePp.toFixed(1)}pp
                    </span>
                  </div>
                  <div>
                    Conf-adj{" "}
                    <span className="tabular-nums">
                      {leg.legConfidenceAdjustedEdgePp >= 0 ? "+" : ""}
                      {leg.legConfidenceAdjustedEdgePp.toFixed(1)}pp
                    </span>
                  </div>
                  <div>
                    Confidence{" "}
                    <span className="tabular-nums">
                      {(leg.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                {leg.primaryDisqualifier && (
                  <div className="mt-1 text-[11px] text-coral-700">
                    ✖ {leg.primaryDisqualifier}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>

        <Card title="Correlation analysis">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ${correlationTypeClasses(sc.correlationType)}`}
            >
              {sc.correlationType} ({sc.correlationScore.toFixed(2)})
            </span>
          </div>
          <p className="mt-3 text-sm text-ink-700">
            {sc.correlationExplanation}
          </p>
          <p className="mt-3 text-[11px] uppercase tracking-[0.12em] text-ink-500">
            Correlation adjustment is capped at +15% / −20% of independent
            joint probability, shrunk by parlay-wide confidence.
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Probability + payout">
          <KV
            label="Independent joint"
            value={formatProbability(sc.independentJointProbability)}
          />
          <KV
            label="Correlation-adjusted joint"
            value={formatProbability(sc.correlationAdjustedJointProbability)}
          />
          <KV
            label="Market joint (no-vig)"
            value={formatProbability(sc.marketJointProbability)}
          />
          <KV
            label="Combined odds (American)"
            value={formatAmericanOdds(sc.combinedOddsAmerican)}
          />
          <KV
            label="Combined odds (decimal)"
            value={formatDecimalOdds(sc.combinedOddsDecimal)}
          />
          <KV
            label="Payout multiplier (incl. stake)"
            value={formatDecimalOdds(sc.payoutMultiplier)}
          />
        </Card>

        <Card title="EV + hit-rate math">
          <KV label="Expected value" value={formatEv(sc.expectedValue)} />
          <KV
            label="Confidence-adjusted EV"
            value={formatEv(sc.confidenceAdjustedExpectedValue)}
            tone={sc.confidenceAdjustedExpectedValue > 0 ? "play" : "warn"}
          />
          <KV
            label="Projected hit rate"
            value={formatProbability(sc.projectedHitRate)}
          />
          <KV
            label="Required hit rate (10% ROI)"
            value={formatProbability(sc.requiredHitRate)}
            tone={
              sc.projectedHitRate >= sc.requiredHitRate ? "play" : "warn"
            }
          />
          <KV
            label="Risk · DQ"
            value={`${sc.riskScore.toFixed(2)} · ${sc.dataQualityScore.toFixed(2)}`}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Reasons">
          <List items={sc.reasons} emptyText="No reasons listed." />
        </Card>
        <Card title="Risks">
          <List
            items={sc.risks}
            emptyText="No risks flagged."
            tone="warn"
          />
          {sc.disqualifiers.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-[0.14em] text-coral-700">
                Disqualifiers
              </div>
              <List items={sc.disqualifiers} emptyText="" tone="bad" />
            </div>
          )}
        </Card>
      </div>

      <Card title="What would change the recommendation">
        <ul className="space-y-1 text-xs text-ink-700">
          {parlay.qualified ? (
            <>
              <li>· Line moves on any leg could compress edge — watch closely.</li>
              <li>
                · A drop in confidence or data quality on any leg would
                shrink the confidence-adjusted EV.
              </li>
              <li>
                · Late game-script news (injury / weather change) flips the
                correlation classification.
              </li>
            </>
          ) : (
            <>
              <li>
                · A payout improvement on either leg lowers the required hit
                rate.
              </li>
              <li>
                · Cleaner data quality and higher leg confidence would lift
                the confidence-adjusted EV.
              </li>
              <li>
                · A clearer correlation signal (positive, well-supported)
                lifts the joint probability cap.
              </li>
            </>
          )}
        </ul>
      </Card>

      <Card title="Target batch math">
        <p className="text-xs text-ink-600">
          For a batch of {""}
          <span className="font-medium text-ink-800">100 parlays</span>{" "}
          targeting 10% ROI:
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KV
            label={`Hit rate ${(batchMath.lowHitRate * 100).toFixed(0)}%`}
            value={`${batchMath.requiredPayoutLow.toFixed(2)}x payout`}
          />
          <KV
            label={`Hit rate ${(
              ((batchMath.lowHitRate + batchMath.highHitRate) / 2) *
              100
            ).toFixed(1)}%`}
            value={`${batchMath.requiredPayoutMidpoint.toFixed(2)}x payout`}
          />
          <KV
            label={`Hit rate ${(batchMath.highHitRate * 100).toFixed(0)}%`}
            value={`${batchMath.requiredPayoutHigh.toFixed(2)}x payout`}
          />
        </div>
      </Card>

      <Card title="Final explanation">
        <p className="text-sm text-ink-800">{sc.finalExplanation}</p>
      </Card>

      <DisclaimerFootnote />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/parlays"
      className="inline-flex items-center gap-2 text-xs font-medium text-ink-600 hover:text-ink-900"
    >
      ← Back to Parlay Builder
    </Link>
  );
}

function HeaderSection({
  parlay,
}: {
  parlay: ReturnType<typeof buildAllFixtureParlayCandidates>[number];
}) {
  return (
    <section>
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Experimental Correlated Parlay Model
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            {parlayTypeLabel(parlay.parlayType)} · {parlay.legCount} legs
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
            {parlay.legs
              .map((l) => `${l.playerName} ${l.side}`)
              .join("  ·  ")}
          </h1>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${recommendationLabelClasses(parlay.recommendation)}`}
        >
          {recommendationLabel(parlay.recommendation)}
        </span>
      </div>
    </section>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        {title}
      </h2>
      <div className="mt-3 space-y-1.5">{children}</div>
    </section>
  );
}

function KV({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "play" | "warn";
}) {
  const valueClass =
    tone === "play"
      ? "text-sea-800"
      : tone === "warn"
        ? "text-coral-700"
        : "text-ink-900";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/40 pb-1.5 last:border-b-0 last:pb-0">
      <div className="text-xs text-ink-600">{label}</div>
      <div className={`text-sm font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

function List({
  items,
  emptyText,
  tone,
}: {
  items: string[];
  emptyText: string;
  tone?: "warn" | "bad";
}) {
  const cls =
    tone === "warn"
      ? "text-amber-800"
      : tone === "bad"
        ? "text-coral-700"
        : "text-ink-700";
  if (items.length === 0) {
    return <div className="text-xs text-ink-400">{emptyText}</div>;
  }
  return (
    <ul className={`space-y-1 text-xs ${cls}`}>
      {items.map((i) => (
        <li key={i}>· {i}</li>
      ))}
    </ul>
  );
}

function DisclaimerFootnote() {
  return (
    <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900">
        Experimental — separate from Player Props and Game Edge
      </div>
      <p className="mt-2 text-xs text-amber-900">
        Parlay recommendations are research only. No bets are placed. Joint
        probability + correlation discipline must be backtested before any
        live use.
      </p>
    </section>
  );
}
