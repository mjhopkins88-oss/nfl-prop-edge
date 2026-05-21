import Link from "next/link";
import { loadFixtureBacktestSummary } from "@/lib/backtest/fixture-summary";
import { loadFixtureProxySummary } from "@/lib/backtest/fixture-proxy-summary";
import {
  loadFixtureComparisonSummary,
  loadFixtureRecommendationChanges,
} from "@/lib/backtest/fixture-comparison-summary";
import {
  loadWeek1ParlayPreview,
  loadWeek1Pregame,
  loadWeek1Results,
  loadWeek1V1V2Comparison,
  loadWeek1GameEdgePreview,
} from "@/lib/backtest/week-1-summary";
import {
  loadStoredWeek1MonitorSnapshot,
  type GradedMarketBucket,
  type GradedLineBucket,
  type StoredWeek1MonitorSnapshot,
} from "@/lib/backtest/week-1-monitor-summary";
import { getWeek1StarterTestContext } from "@/lib/app-context";

export const dynamic = "force-dynamic";

export default async function MonitorPage() {
  const stored = await loadStoredWeek1MonitorSnapshot({ season: 2025, week: 1 });
  const fixture = loadFixtureBacktestSummary();
  const proxySummary = loadFixtureProxySummary();
  const compareLatest = loadFixtureComparisonSummary();
  const changes = loadFixtureRecommendationChanges();
  const week1Pregame = loadWeek1Pregame();
  const week1Results = loadWeek1Results();
  const week1Comparison = loadWeek1V1V2Comparison();
  const week1Parlays = loadWeek1ParlayPreview();
  const week1GameEdge = loadWeek1GameEdgePreview();

  // A stored snapshot with READY status + candidates is the
  // primary source. Fixture starter-test outputs (8 evaluated,
  // 2 qualified, fake 100% hit rate) become secondary and get
  // clearly labelled.
  const storedIsPrimary =
    stored !== undefined &&
    stored.realWeek1BacktestReady &&
    stored.candidateCount > 0;

  const readiness = computeReadiness({
    fixture,
    week1Results,
    stored,
    storedIsPrimary,
  });

  const storedWeeks = stored ? [stored] : [];

  return (
    <div className="space-y-8">
      <Hero readiness={readiness} storedIsPrimary={storedIsPrimary} />
      {stored ? <StoredWeek1Panel stored={stored} /> : null}
      {storedWeeks.length > 0 ? (
        <StoredWeeksAggregated storedWeeks={storedWeeks} />
      ) : null}
      {stored?.graded ? (
        <StoredBreakdowns stored={stored} />
      ) : null}
      <OverallHealth
        fixture={fixture}
        week1Results={week1Results}
        storedIsPrimary={storedIsPrimary}
      />
      <WeekByWeekTable
        week1Results={week1Results}
        stored={stored}
        storedIsPrimary={storedIsPrimary}
      />
      <PlayerPropPerformance fixture={fixture} storedIsPrimary={storedIsPrimary} />
      <V1V2Panel
        compareLatest={compareLatest}
        changes={changes}
        week1Comparison={week1Comparison}
        storedIsPrimary={storedIsPrimary}
      />
      <ProxyHealthPanel proxySummary={proxySummary} />
      <GameEdgeMonitor week1GameEdge={week1GameEdge} storedIsPrimary={storedIsPrimary} />
      <ParlayMonitor week1Parlays={week1Parlays} storedIsPrimary={storedIsPrimary} />
      <WarningsPanel />
      <RunHint
        showRunHint={!week1Pregame || !week1Results}
      />
    </div>
  );
}

interface Readiness {
  status: "READY" | "RESEARCH" | "INSUFFICIENT_DATA";
  reason: string;
}

function computeReadiness(args: {
  fixture: ReturnType<typeof loadFixtureBacktestSummary>;
  week1Results: ReturnType<typeof loadWeek1Results>;
  stored: StoredWeek1MonitorSnapshot | undefined;
  storedIsPrimary: boolean;
}): Readiness {
  if (args.storedIsPrimary && args.stored) {
    return {
      status: "RESEARCH",
      reason: `Real stored Week 1 backtest loaded (${args.stored.candidateCount} candidates from ${args.stored.source}). Pregame candidates only — grading is still pending.`,
    };
  }
  if (args.stored && args.stored.status !== "READY") {
    return {
      status: "RESEARCH",
      reason: `Stored Week 1 backtest status: ${args.stored.status} (${args.stored.source}). Fixture starter-test values shown below are fixture-only.`,
    };
  }
  if (!args.fixture && !args.week1Results) {
    return {
      status: "INSUFFICIENT_DATA",
      reason: "No backtest output found yet — run the fixture backtest and the Week 1 starter test.",
    };
  }
  if (!args.week1Results) {
    return {
      status: "RESEARCH",
      reason: "Week 1 starter test not generated yet.",
    };
  }
  if (args.week1Results.qualifiedBets.length === 0) {
    return {
      status: "RESEARCH",
      reason: "No qualified plays in the Week 1 fixture sample.",
    };
  }
  return {
    status: "RESEARCH",
    reason: "Fixture results only — not proof of live edge until a real-data backtest lands.",
  };
}

function Hero({
  readiness,
  storedIsPrimary,
}: {
  readiness: Readiness;
  storedIsPrimary: boolean;
}) {
  const starter = getWeek1StarterTestContext();
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={
            readiness.status === "READY"
              ? "inline-flex items-center gap-2 rounded-full bg-sea-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sea-800 ring-1 ring-sea-200/80"
              : readiness.status === "INSUFFICIENT_DATA"
                ? "inline-flex items-center gap-2 rounded-full bg-cream-200 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-200/80"
                : "inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80"
          }
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {readiness.status.replace(/_/g, " ")}
        </span>
        <span
          className="inline-flex items-center gap-2 rounded-full bg-sea-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sea-800 ring-1 ring-sea-200/80"
          data-testid="monitor-active-test"
        >
          Active test · {starter.label}
        </span>
        {storedIsPrimary ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-sea-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80">
            Real stored Week 1 backtest active
          </span>
        ) : null}
        <span className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
          Leakage guard · pregame outcomes stripped
        </span>
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
        Model Monitor
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-700">
        Aggregated view of fixture backtest health, Week 1 starter
        test output, V1 vs V2 deltas, proxy lift, and Game Edge /
        Parlay coverage. Player Props, Game Edge, and Parlay Builder
        each have their own pages — this monitor only summarises.
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.14em] text-ink-500">
        {readiness.reason}
      </p>
    </section>
  );
}

function StoredWeek1Panel({ stored }: { stored: StoredWeek1MonitorSnapshot }) {
  const readyTone = stored.realWeek1BacktestReady
    ? "text-sea-700"
    : "text-amber-800";
  return (
    <section
      className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6"
      data-testid="monitor-stored-week-1"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Real Week 1 Stored Backtest
        </h2>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Source · {stored.source}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Data mode" value="STORED" />
        <Stat
          label="Real ready"
          value={stored.realWeek1BacktestReady ? "yes" : "no"}
          sub={stored.status}
        />
        <Stat label="Synthetic fixture" value="no" />
        <Stat
          label="Schedule validation"
          value={stored.scheduleValidationStatus ?? "—"}
        />
        <Stat label="Candidates" value={`${stored.candidateCount}`} />
        <Stat label="Stored odds" value={stored.storedOddsPresent ? "yes" : "no"} />
        <Stat label="Processed NFL" value={stored.processedNflPresent ? "yes" : "no"} />
        <Stat
          label="Grading"
          value={
            stored.gradingStatus === "graded"
              ? "graded"
              : stored.gradingStatus === "ungraded"
                ? "pending — pregame only"
                : "unavailable"
          }
        />
      </div>
      {stored.graded ? (
        <>
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
                Candidate Universe Diagnostics
              </h3>
              <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
                Model diagnostic only · not betting performance
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Universe size"
                value={`${stored.graded.universeDiagnostics.totalCandidates}`}
                sub={`${stored.graded.universeDiagnostics.candidatesWithActual} with actual stat`}
              />
              <Stat
                label="OVER directional hit"
                value={`${stored.graded.universeDiagnostics.overSide.hitRatePct.toFixed(1)}%`}
                sub={`${stored.graded.universeDiagnostics.overSide.wins}W · ${stored.graded.universeDiagnostics.overSide.losses}L (diagnostic)`}
              />
              <Stat
                label="UNDER directional hit"
                value={`${stored.graded.universeDiagnostics.underSide.hitRatePct.toFixed(1)}%`}
                sub={`${stored.graded.universeDiagnostics.underSide.wins}W · ${stored.graded.universeDiagnostics.underSide.losses}L (diagnostic)`}
              />
              <Stat
                label="Line-side better-paid"
                value={stored.graded.universeDiagnostics.betterSide}
                sub={
                  stored.graded.universeDiagnostics.candidatesMissingActual > 0
                    ? `${stored.graded.universeDiagnostics.candidatesMissingActual} no-stat`
                    : undefined
                }
              />
            </div>
            <p className="text-[11px] text-ink-500">
              The 290 candidates are the evaluated UNIVERSE, not
              recommended bets. The hit rates above describe what
              the LINES paid blindly; they are NOT the model&rsquo;s
              betting ROI. Use the section below for actual model
              picks.
            </p>
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
                Recommended Plays Performance
              </h3>
              <span
                className={
                  stored.graded.recommendedPlays.enabled
                    ? "rounded-full bg-sea-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80"
                    : "rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-300/80"
                }
              >
                {stored.graded.recommendedPlays.enabled
                  ? "Real betting performance"
                  : "Not yet evaluated"}
              </span>
            </div>
            {stored.graded.recommendedPlays.enabled ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Plays"
                  value={`${stored.graded.recommendedPlays.count}`}
                  sub={`${stored.graded.recommendedPlays.wins}W · ${stored.graded.recommendedPlays.losses}L · ${stored.graded.recommendedPlays.pushes}P`}
                />
                <Stat
                  label="Hit rate"
                  value={`${stored.graded.recommendedPlays.hitRatePct.toFixed(1)}%`}
                />
                <Stat
                  label="ROI"
                  value={`${stored.graded.recommendedPlays.roiPct.toFixed(1)}%`}
                  sub={`${stored.graded.recommendedPlays.unitsProfit.toFixed(2)} units`}
                />
                <Stat
                  label="Avg edge / confidence"
                  value={`${stored.graded.recommendedPlays.averageEdgePct.toFixed(1)}% / ${stored.graded.recommendedPlays.averageConfidence.toFixed(2)}`}
                />
              </div>
            ) : (
              <p className="rounded-lg bg-ink-100/50 p-3 text-[11px] text-ink-700">
                {stored.graded.recommendedPlays.note}
              </p>
            )}
            {stored.graded.recommendedPlays.enabled ? (
              <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <RecommendedBreakdownPanel
                  title="By prop type"
                  rows={stored.graded.recommendedPlays.byPropType}
                />
                <RecommendedBreakdownPanel
                  title="By confidence tier"
                  rows={stored.graded.recommendedPlays.byConfidenceTier}
                />
                <RecommendedBreakdownPanel
                  title="By edge bucket"
                  rows={stored.graded.recommendedPlays.byEdgeBucket}
                />
              </div>
            ) : null}
          </div>

          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
                Parlay Performance
              </h3>
              <span
                className={
                  stored.graded.parlayPerformance.enabled
                    ? "rounded-full bg-sea-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80"
                    : "rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-300/80"
                }
              >
                {stored.graded.parlayPerformance.enabled
                  ? "Real parlay performance"
                  : "Not yet evaluated"}
              </span>
            </div>
            {stored.graded.parlayPerformance.enabled ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat
                  label="Evaluated / Selected / Rejected"
                  value={`${stored.graded.parlayPerformance.evaluated} / ${stored.graded.parlayPerformance.selected} / ${stored.graded.parlayPerformance.rejected}`}
                />
                <Stat
                  label="Selected hit rate"
                  value={`${stored.graded.parlayPerformance.selectedAggregate.hitRatePct.toFixed(1)}%`}
                  sub={`${stored.graded.parlayPerformance.selectedAggregate.wins}W · ${stored.graded.parlayPerformance.selectedAggregate.losses}L · ${stored.graded.parlayPerformance.selectedAggregate.noResult}NR`}
                />
                <Stat
                  label="Selected ROI"
                  value={`${stored.graded.parlayPerformance.selectedAggregate.roiPct.toFixed(1)}%`}
                  sub={`${stored.graded.parlayPerformance.selectedAggregate.unitsProfit.toFixed(2)} units`}
                />
                <Stat
                  label="Avg projected / required hit"
                  value={`${stored.graded.parlayPerformance.selectedAggregate.averageModeledHitProbabilityPct.toFixed(1)}% / ${stored.graded.parlayPerformance.selectedAggregate.averageRequiredHitProbabilityPct.toFixed(1)}%`}
                />
              </div>
            ) : (
              <p className="rounded-lg bg-ink-100/50 p-3 text-[11px] text-ink-700">
                {stored.graded.parlayPerformance.note}
              </p>
            )}
          </div>

          <div className="mt-4 space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
              Disqualification breakdown
            </h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
              <DisqStat
                label="Edge too thin"
                value={stored.graded.disqualificationBreakdown.edgeTooThin}
              />
              <DisqStat
                label="Risk gate (total)"
                value={stored.graded.disqualificationBreakdown.riskGate}
              />
              <DisqStat
                label="Missing result"
                value={stored.graded.disqualificationBreakdown.missingResult}
              />
              <DisqStat
                label="Ungradeable (push)"
                value={stored.graded.disqualificationBreakdown.ungradeable}
              />
              <DisqStat
                label="Other"
                value={stored.graded.disqualificationBreakdown.other}
              />
              <DisqStat
                label="Total rejected"
                value={stored.graded.disqualificationBreakdown.totalRejected}
              />
              <DisqStat
                label="Passed (universe − rejected)"
                value={
                  stored.graded.universeDiagnostics.totalCandidates -
                  stored.graded.disqualificationBreakdown.totalRejected
                }
              />
            </div>
            <p className="text-[10px] text-ink-500">
              Risk gate = sum of the 8 per-bucket gates below.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
              <DisqStat
                label="Data quality"
                value={stored.graded.disqualificationBreakdown.dataQualityGate ?? 0}
              />
              <DisqStat
                label="Role stability"
                value={
                  stored.graded.disqualificationBreakdown.roleStabilityGate ??
                  stored.graded.disqualificationBreakdown.roleStability
                }
              />
              <DisqStat
                label="Injury context"
                value={stored.graded.disqualificationBreakdown.injuryContextGate ?? 0}
              />
              <DisqStat
                label="Correlation exposure"
                value={
                  stored.graded.disqualificationBreakdown
                    .correlationExposureGate ?? 0
                }
              />
              <DisqStat
                label="Weather / env"
                value={
                  stored.graded.disqualificationBreakdown
                    .weatherEnvironmentGate ?? 0
                }
              />
              <DisqStat
                label="Game script"
                value={stored.graded.disqualificationBreakdown.gameScriptGate ?? 0}
              />
              <DisqStat
                label="Pace"
                value={stored.graded.disqualificationBreakdown.paceGate ?? 0}
              />
              <DisqStat
                label="Market context"
                value={stored.graded.disqualificationBreakdown.marketContextGate ?? 0}
              />
            </div>
          </div>

          {stored.graded.scorecardAudit ? (
            <ScorecardAuditMonitor audit={stored.graded.scorecardAudit} />
          ) : null}

          <p className="mt-3 text-[11px] text-ink-500">
            Graded at · {stored.graded.gradedAt}.
          </p>
        </>
      ) : (
        <p className={`mt-3 text-[11px] ${readyTone}`}>
          {stored.realWeek1BacktestReady
            ? "Stored Week 1 pregame candidates loaded. Click \"Grade Week 1 stored backtest\" on /admin/ingestion to compute hit rate / ROI from processed nflverse stats. No API call."
            : `Stored run not ready: ${stored.status}. Run /admin/ingestion → Migrate → Run Week 1 stored backtest.`}
        </p>
      )}
      {stored.generatedAt ? (
        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Generated at · {stored.generatedAt}
        </p>
      ) : null}
    </section>
  );
}

interface StoredWeeksRollup {
  weekCount: number;
  weeksGraded: number;
  weeksUngraded: number;
  totalCandidates: number;
  totalCandidatesWithActual: number;
  recommendedPlaysEnabled: boolean;
  recommendedPlays: {
    count: number;
    wins: number;
    losses: number;
    pushes: number;
    hitRatePct: number;
    roiPct: number;
    unitsProfit: number;
  };
  universeOver: {
    wins: number;
    losses: number;
    pushes: number;
    hitRatePct: number;
  };
  universeUnder: {
    wins: number;
    losses: number;
    pushes: number;
    hitRatePct: number;
  };
  parlayEnabled: boolean;
  parlay: {
    evaluated: number;
    selected: number;
    rejected: number;
    selectedWins: number;
    selectedLosses: number;
    selectedHitRatePct: number;
    selectedRoiPct: number;
    selectedUnitsProfit: number;
  };
  byPropType: GradedMarketBucket[];
  byLineBucket: GradedLineBucket[];
  bestPropType: { propType: string; side: "OVER" | "UNDER"; hitRatePct: number } | null;
  worstPropType: { propType: string; side: "OVER" | "UNDER"; hitRatePct: number } | null;
  /** Best/worst prop type from recommended-plays performance.
   *  Populated only when the scorecard pass has produced
   *  qualified plays; falls back to null until then. */
  bestRecommendedPropType: { propType: string; roiPct: number; hitRatePct: number; count: number } | null;
  worstRecommendedPropType: { propType: string; roiPct: number; hitRatePct: number; count: number } | null;
}

function aggregateStoredWeeks(
  storedWeeks: StoredWeek1MonitorSnapshot[],
): StoredWeeksRollup {
  let totalCandidates = 0;
  let totalCandidatesWithActual = 0;
  const recPlays = {
    count: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    unitsProfit: 0,
    weighted: 0,
    sumHit: 0,
    sumRoi: 0,
  };
  const over = { wins: 0, losses: 0, pushes: 0 };
  const under = { wins: 0, losses: 0, pushes: 0 };
  const parlay = {
    evaluated: 0,
    selected: 0,
    rejected: 0,
    selectedWins: 0,
    selectedLosses: 0,
    selectedUnitsProfit: 0,
    weighted: 0,
    sumHit: 0,
    sumRoi: 0,
  };
  let recommendedPlaysEnabled = false;
  let parlayEnabled = false;
  let weeksGraded = 0;
  let weeksUngraded = 0;

  // Roll up byPropType across weeks. Sum OVER/UNDER sides per
  // market. byLineBucket is rolled up the same way.
  const propTypeMap = new Map<string, GradedMarketBucket>();
  const lineBucketMap = new Map<string, GradedLineBucket>();

  for (const w of storedWeeks) {
    totalCandidates += w.candidateCount;
    if (!w.graded) {
      weeksUngraded += 1;
      continue;
    }
    weeksGraded += 1;
    const u = w.graded.universeDiagnostics;
    totalCandidatesWithActual += u.candidatesWithActual;
    over.wins += u.overSide.wins;
    over.losses += u.overSide.losses;
    over.pushes += u.overSide.pushes;
    under.wins += u.underSide.wins;
    under.losses += u.underSide.losses;
    under.pushes += u.underSide.pushes;

    if (w.graded.recommendedPlays.enabled) {
      recommendedPlaysEnabled = true;
      const r = w.graded.recommendedPlays;
      recPlays.count += r.count;
      recPlays.wins += r.wins;
      recPlays.losses += r.losses;
      recPlays.pushes += r.pushes;
      recPlays.unitsProfit += r.unitsProfit;
      recPlays.weighted += r.count;
      recPlays.sumHit += r.hitRatePct * r.count;
      recPlays.sumRoi += r.roiPct * r.count;
    }

    if (w.graded.parlayPerformance.enabled) {
      parlayEnabled = true;
      const p = w.graded.parlayPerformance;
      parlay.evaluated += p.evaluated;
      parlay.selected += p.selected;
      parlay.rejected += p.rejected;
      parlay.selectedWins += p.selectedAggregate.wins;
      parlay.selectedLosses += p.selectedAggregate.losses;
      parlay.selectedUnitsProfit += p.selectedAggregate.unitsProfit;
      parlay.weighted += p.selected;
      parlay.sumHit += p.selectedAggregate.hitRatePct * p.selected;
      parlay.sumRoi += p.selectedAggregate.roiPct * p.selected;
    }

    for (const b of w.graded.universeDiagnostics.byPropType) {
      const prev = propTypeMap.get(b.propType);
      if (!prev) {
        propTypeMap.set(b.propType, {
          propType: b.propType,
          total: b.total,
          decisive: b.decisive,
          overSide: { ...b.overSide },
          underSide: { ...b.underSide },
        });
      } else {
        prev.total += b.total;
        prev.decisive += b.decisive;
        prev.overSide.wins += b.overSide.wins;
        prev.overSide.losses += b.overSide.losses;
        prev.overSide.pushes += b.overSide.pushes;
        prev.overSide.graded += b.overSide.graded;
        prev.overSide.unitsProfit += b.overSide.unitsProfit;
        prev.underSide.wins += b.underSide.wins;
        prev.underSide.losses += b.underSide.losses;
        prev.underSide.pushes += b.underSide.pushes;
        prev.underSide.graded += b.underSide.graded;
        prev.underSide.unitsProfit += b.underSide.unitsProfit;
      }
    }

    for (const b of w.graded.universeDiagnostics.byLineBucket) {
      const prev = lineBucketMap.get(b.label);
      if (!prev) {
        lineBucketMap.set(b.label, {
          label: b.label,
          lineLow: b.lineLow,
          lineHigh: b.lineHigh,
          total: b.total,
          decisive: b.decisive,
          overSide: { ...b.overSide },
          underSide: { ...b.underSide },
        });
      } else {
        prev.total += b.total;
        prev.decisive += b.decisive;
        prev.overSide.wins += b.overSide.wins;
        prev.overSide.losses += b.overSide.losses;
        prev.overSide.pushes += b.overSide.pushes;
        prev.overSide.graded += b.overSide.graded;
        prev.overSide.unitsProfit += b.overSide.unitsProfit;
        prev.underSide.wins += b.underSide.wins;
        prev.underSide.losses += b.underSide.losses;
        prev.underSide.pushes += b.underSide.pushes;
        prev.underSide.graded += b.underSide.graded;
        prev.underSide.unitsProfit += b.underSide.unitsProfit;
      }
    }
  }

  // Recompute hit-rate / ROI for each aggregated bucket from the
  // summed wins/losses so the rollup matches the math users see.
  const byPropType: GradedMarketBucket[] = [];
  for (const b of propTypeMap.values()) {
    const overGraded = b.overSide.wins + b.overSide.losses + b.overSide.pushes;
    const underGraded =
      b.underSide.wins + b.underSide.losses + b.underSide.pushes;
    b.overSide.graded = overGraded;
    b.underSide.graded = underGraded;
    const overDecisive = b.overSide.wins + b.overSide.losses;
    const underDecisive = b.underSide.wins + b.underSide.losses;
    b.overSide.hitRatePct =
      overDecisive > 0 ? (b.overSide.wins / overDecisive) * 100 : 0;
    b.underSide.hitRatePct =
      underDecisive > 0 ? (b.underSide.wins / underDecisive) * 100 : 0;
    b.overSide.roiPct =
      overDecisive > 0 ? (b.overSide.unitsProfit / overDecisive) * 100 : 0;
    b.underSide.roiPct =
      underDecisive > 0 ? (b.underSide.unitsProfit / underDecisive) * 100 : 0;
    byPropType.push(b);
  }
  byPropType.sort((a, b) => b.total - a.total);

  const byLineBucket: GradedLineBucket[] = [];
  for (const b of lineBucketMap.values()) {
    const overGraded = b.overSide.wins + b.overSide.losses + b.overSide.pushes;
    const underGraded =
      b.underSide.wins + b.underSide.losses + b.underSide.pushes;
    b.overSide.graded = overGraded;
    b.underSide.graded = underGraded;
    const overDecisive = b.overSide.wins + b.overSide.losses;
    const underDecisive = b.underSide.wins + b.underSide.losses;
    b.overSide.hitRatePct =
      overDecisive > 0 ? (b.overSide.wins / overDecisive) * 100 : 0;
    b.underSide.hitRatePct =
      underDecisive > 0 ? (b.underSide.wins / underDecisive) * 100 : 0;
    b.overSide.roiPct =
      overDecisive > 0 ? (b.overSide.unitsProfit / overDecisive) * 100 : 0;
    b.underSide.roiPct =
      underDecisive > 0 ? (b.underSide.unitsProfit / underDecisive) * 100 : 0;
    byLineBucket.push(b);
  }
  byLineBucket.sort((a, b) => a.lineLow - b.lineLow);

  // Best / worst prop type by the better-paid side's hit rate.
  // Only consider markets with ≥5 decisive grades on the better
  // side so a one-game outlier doesn't dominate.
  let bestPropType: StoredWeeksRollup["bestPropType"] = null;
  let worstPropType: StoredWeeksRollup["worstPropType"] = null;
  for (const b of byPropType) {
    const overDecisive = b.overSide.wins + b.overSide.losses;
    const underDecisive = b.underSide.wins + b.underSide.losses;
    const overEligible = overDecisive >= 5;
    const underEligible = underDecisive >= 5;
    if (!overEligible && !underEligible) continue;
    const better =
      overEligible && (!underEligible || b.overSide.hitRatePct >= b.underSide.hitRatePct)
        ? { side: "OVER" as const, hitRatePct: b.overSide.hitRatePct }
        : { side: "UNDER" as const, hitRatePct: b.underSide.hitRatePct };
    const cand = { propType: b.propType, ...better };
    if (!bestPropType || cand.hitRatePct > bestPropType.hitRatePct) {
      bestPropType = cand;
    }
    if (!worstPropType || cand.hitRatePct < worstPropType.hitRatePct) {
      worstPropType = cand;
    }
  }

  // Best/worst prop type from recommended-plays performance.
  // Aggregates per-prop-type rows across weeks the same way the
  // diagnostic universe does, then picks the highest/lowest ROI
  // among markets with at least 5 graded plays.
  const recByPropType = new Map<
    string,
    { count: number; wins: number; losses: number; pushes: number; unitsProfit: number }
  >();
  for (const w of storedWeeks) {
    if (!w.graded?.recommendedPlays.enabled) continue;
    for (const row of w.graded.recommendedPlays.byPropType) {
      const prev = recByPropType.get(row.label);
      if (!prev) {
        recByPropType.set(row.label, {
          count: row.count,
          wins: row.wins,
          losses: row.losses,
          pushes: row.pushes,
          unitsProfit: row.unitsProfit,
        });
      } else {
        prev.count += row.count;
        prev.wins += row.wins;
        prev.losses += row.losses;
        prev.pushes += row.pushes;
        prev.unitsProfit += row.unitsProfit;
      }
    }
  }
  let bestRecommendedPropType: StoredWeeksRollup["bestRecommendedPropType"] = null;
  let worstRecommendedPropType: StoredWeeksRollup["worstRecommendedPropType"] = null;
  for (const [propType, agg] of recByPropType.entries()) {
    if (agg.count < 5) continue;
    const decisive = agg.wins + agg.losses;
    const hitRatePct = decisive > 0 ? (agg.wins / decisive) * 100 : 0;
    const roiPct = agg.count > 0 ? (agg.unitsProfit / agg.count) * 100 : 0;
    const cand = { propType, roiPct, hitRatePct, count: agg.count };
    if (!bestRecommendedPropType || cand.roiPct > bestRecommendedPropType.roiPct) {
      bestRecommendedPropType = cand;
    }
    if (!worstRecommendedPropType || cand.roiPct < worstRecommendedPropType.roiPct) {
      worstRecommendedPropType = cand;
    }
  }

  const overDecisive = over.wins + over.losses;
  const underDecisive = under.wins + under.losses;
  return {
    weekCount: storedWeeks.length,
    weeksGraded,
    weeksUngraded,
    totalCandidates,
    totalCandidatesWithActual,
    recommendedPlaysEnabled,
    recommendedPlays: {
      count: recPlays.count,
      wins: recPlays.wins,
      losses: recPlays.losses,
      pushes: recPlays.pushes,
      hitRatePct:
        recPlays.weighted > 0 ? recPlays.sumHit / recPlays.weighted : 0,
      roiPct: recPlays.weighted > 0 ? recPlays.sumRoi / recPlays.weighted : 0,
      unitsProfit: recPlays.unitsProfit,
    },
    universeOver: {
      wins: over.wins,
      losses: over.losses,
      pushes: over.pushes,
      hitRatePct: overDecisive > 0 ? (over.wins / overDecisive) * 100 : 0,
    },
    universeUnder: {
      wins: under.wins,
      losses: under.losses,
      pushes: under.pushes,
      hitRatePct: underDecisive > 0 ? (under.wins / underDecisive) * 100 : 0,
    },
    parlayEnabled,
    parlay: {
      evaluated: parlay.evaluated,
      selected: parlay.selected,
      rejected: parlay.rejected,
      selectedWins: parlay.selectedWins,
      selectedLosses: parlay.selectedLosses,
      selectedHitRatePct:
        parlay.weighted > 0 ? parlay.sumHit / parlay.weighted : 0,
      selectedRoiPct:
        parlay.weighted > 0 ? parlay.sumRoi / parlay.weighted : 0,
      selectedUnitsProfit: parlay.selectedUnitsProfit,
    },
    byPropType,
    byLineBucket,
    bestPropType,
    worstPropType,
    bestRecommendedPropType,
    worstRecommendedPropType,
  };
}

function StoredWeeksAggregated({
  storedWeeks,
}: {
  storedWeeks: StoredWeek1MonitorSnapshot[];
}) {
  const rollup = aggregateStoredWeeks(storedWeeks);
  return (
    <section
      className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6"
      data-testid="monitor-stored-aggregated"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Stored Weeks · Aggregated
        </h2>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Real data · Postgres-backed · no fixture mix
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink-600">
        Rollup across {rollup.weekCount} stored week
        {rollup.weekCount === 1 ? "" : "s"} ({rollup.weeksGraded} graded ·{" "}
        {rollup.weeksUngraded} pregame-only). Fixture starter-test numbers
        are NOT included in this section.
      </p>

      <div className="mt-3 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Recommended Plays Performance
          </h3>
          <span
            className={
              rollup.recommendedPlaysEnabled
                ? "rounded-full bg-sea-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80"
                : "rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-300/80"
            }
          >
            {rollup.recommendedPlaysEnabled
              ? "Real betting performance"
              : "Not yet evaluated"}
          </span>
        </div>
        {rollup.recommendedPlaysEnabled ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Recommended plays"
                value={`${rollup.recommendedPlays.count}`}
                sub={`${rollup.recommendedPlays.wins}W · ${rollup.recommendedPlays.losses}L · ${rollup.recommendedPlays.pushes}P`}
              />
              <Stat
                label="Hit rate"
                value={`${rollup.recommendedPlays.hitRatePct.toFixed(1)}%`}
              />
              <Stat
                label="ROI"
                value={`${rollup.recommendedPlays.roiPct.toFixed(1)}%`}
              />
              <Stat
                label="Units profit"
                value={`${rollup.recommendedPlays.unitsProfit.toFixed(2)}`}
              />
              <Stat
                label="Best prop · recommended"
                value={
                  rollup.bestRecommendedPropType
                    ? rollup.bestRecommendedPropType.propType.replace(/_/g, " ")
                    : "—"
                }
                sub={
                  rollup.bestRecommendedPropType
                    ? `${rollup.bestRecommendedPropType.roiPct.toFixed(1)}% ROI · ${rollup.bestRecommendedPropType.count} plays`
                    : "needs ≥5 plays"
                }
              />
              <Stat
                label="Worst prop · recommended"
                value={
                  rollup.worstRecommendedPropType
                    ? rollup.worstRecommendedPropType.propType.replace(/_/g, " ")
                    : "—"
                }
                sub={
                  rollup.worstRecommendedPropType
                    ? `${rollup.worstRecommendedPropType.roiPct.toFixed(1)}% ROI · ${rollup.worstRecommendedPropType.count} plays`
                    : "needs ≥5 plays"
                }
              />
            </div>
          </>
        ) : (
          <p className="rounded-lg bg-ink-100/50 p-3 text-[11px] text-ink-700">
            Model has not yet emitted recommended plays for the stored
            universe ({rollup.totalCandidates} candidates ·{" "}
            {rollup.totalCandidatesWithActual} with actual stat). The
            grader is wired and waiting; today every candidate stays in
            the diagnostic universe.
          </p>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Universe Diagnostics (all stored candidates)
          </h3>
          <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
            Model diagnostic only · not betting performance
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Total candidates"
            value={`${rollup.totalCandidates}`}
            sub={`${rollup.totalCandidatesWithActual} with actual stat`}
          />
          <Stat
            label="OVER · W / L / P"
            value={`${rollup.universeOver.wins} / ${rollup.universeOver.losses} / ${rollup.universeOver.pushes}`}
            sub={`${rollup.universeOver.hitRatePct.toFixed(1)}% hit (diagnostic)`}
          />
          <Stat
            label="UNDER · W / L / P"
            value={`${rollup.universeUnder.wins} / ${rollup.universeUnder.losses} / ${rollup.universeUnder.pushes}`}
            sub={`${rollup.universeUnder.hitRatePct.toFixed(1)}% hit (diagnostic)`}
          />
          <Stat
            label="Best prop · diagnostic"
            value={
              rollup.bestPropType
                ? `${rollup.bestPropType.propType.replace(/_/g, " ")} (${rollup.bestPropType.side})`
                : "—"
            }
            sub={
              rollup.bestPropType
                ? `${rollup.bestPropType.hitRatePct.toFixed(1)}% better-side`
                : "needs ≥5 decisive"
            }
          />
          <Stat
            label="Worst prop · diagnostic"
            value={
              rollup.worstPropType
                ? `${rollup.worstPropType.propType.replace(/_/g, " ")} (${rollup.worstPropType.side})`
                : "—"
            }
            sub={
              rollup.worstPropType
                ? `${rollup.worstPropType.hitRatePct.toFixed(1)}% better-side`
                : "needs ≥5 decisive"
            }
          />
          <Stat
            label="Edge buckets · stored"
            value="—"
            sub="needs model recommendation pass"
          />
          <Stat
            label="Confidence buckets · stored"
            value="—"
            sub="needs model recommendation pass"
          />
          <Stat
            label="V1 vs V2 · stored"
            value="—"
            sub="needs comparison run"
          />
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Parlay Performance (stored weeks)
          </h3>
          <span
            className={
              rollup.parlayEnabled
                ? "rounded-full bg-sea-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80"
                : "rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-300/80"
            }
          >
            {rollup.parlayEnabled
              ? "Real parlay performance"
              : "Not yet evaluated"}
          </span>
        </div>
        {rollup.parlayEnabled ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Evaluated / Selected / Rejected"
              value={`${rollup.parlay.evaluated} / ${rollup.parlay.selected} / ${rollup.parlay.rejected}`}
            />
            <Stat
              label="Selected hit rate"
              value={`${rollup.parlay.selectedHitRatePct.toFixed(1)}%`}
              sub={`${rollup.parlay.selectedWins}W · ${rollup.parlay.selectedLosses}L`}
            />
            <Stat
              label="Selected ROI"
              value={`${rollup.parlay.selectedRoiPct.toFixed(1)}%`}
            />
            <Stat
              label="Selected units"
              value={`${rollup.parlay.selectedUnitsProfit.toFixed(2)}`}
            />
          </div>
        ) : (
          <p className="rounded-lg bg-ink-100/50 p-3 text-[11px] text-ink-700">
            Parlay rebuild over the stored universe has not been run.
            Counts and ROI stay blank until per-leg model edges land.
          </p>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
          Game Edge (stored weeks)
        </h3>
        <p className="rounded-lg bg-ink-100/50 p-3 text-[11px] text-ink-700">
          Game Edge model has no stored backtest yet (out of scope for the
          current player-prop test). Live preview lives at{" "}
          <Link href="/game-edge" className="underline">
            /game-edge
          </Link>
          .
        </p>
      </div>
    </section>
  );
}

function StoredBreakdowns({ stored }: { stored: StoredWeek1MonitorSnapshot }) {
  if (!stored.graded) return null;
  const byPropType = stored.graded.universeDiagnostics.byPropType;
  const byLineBucket = stored.graded.universeDiagnostics.byLineBucket;
  if (byPropType.length === 0 && byLineBucket.length === 0) return null;
  return (
    <section
      className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6"
      data-testid="monitor-stored-breakdowns"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Stored Weeks · Breakdowns
        </h2>
        <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
          Diagnostic only · per-side hit rates describe the lines, not bets
        </span>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {byPropType.length > 0 ? (
          <DiagnosticBucketPanel
            title="By prop type (stored)"
            rows={byPropType.map((b) => ({
              label: b.propType.replace(/_/g, " "),
              total: b.total,
              overHitPct: b.overSide.hitRatePct,
              underHitPct: b.underSide.hitRatePct,
            }))}
          />
        ) : null}
        {byLineBucket.length > 0 ? (
          <DiagnosticBucketPanel
            title="By line bucket (stored)"
            rows={byLineBucket.map((b) => ({
              label: b.label,
              total: b.total,
              overHitPct: b.overSide.hitRatePct,
              underHitPct: b.underSide.hitRatePct,
            }))}
          />
        ) : null}
      </div>
    </section>
  );
}

function RecommendedBreakdownPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    count: number;
    wins: number;
    losses: number;
    pushes: number;
    hitRatePct: number;
    roiPct: number;
    unitsProfit: number;
  }>;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {title}
      </div>
      <table className="mt-2 min-w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
            <th className="pb-1 pr-2">Label</th>
            <th className="pb-1 pr-2 text-right">Plays</th>
            <th className="pb-1 pr-2 text-right">Hit</th>
            <th className="pb-1 text-right">ROI</th>
          </tr>
        </thead>
        <tbody className="text-ink-800">
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-white/40">
              <td className="py-1 pr-2">{r.label.replace(/_/g, " ")}</td>
              <td className="py-1 pr-2 text-right tabular-nums">{r.count}</td>
              <td className="py-1 pr-2 text-right tabular-nums">
                {r.hitRatePct.toFixed(1)}%
              </td>
              <td
                className={
                  "py-1 text-right tabular-nums " +
                  (r.roiPct >= 0 ? "text-sea-700" : "text-coral-700")
                }
              >
                {r.roiPct.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DiagnosticBucketPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    label: string;
    total: number;
    overHitPct: number;
    underHitPct: number;
  }>;
}) {
  return (
    <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {title}
      </div>
      <table className="mt-2 min-w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
            <th className="pb-1 pr-2">Bucket</th>
            <th className="pb-1 pr-2 text-right">Candidates</th>
            <th className="pb-1 pr-2 text-right">OVER hit</th>
            <th className="pb-1 text-right">UNDER hit</th>
          </tr>
        </thead>
        <tbody className="text-ink-800">
          {rows.length === 0 ? (
            <tr className="border-t border-white/40">
              <td className="py-1" colSpan={4}>
                <span className="text-ink-500">No data.</span>
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.label} className="border-t border-white/40">
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.total}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {r.overHitPct.toFixed(1)}%
                </td>
                <td className="py-1 text-right tabular-nums">
                  {r.underHitPct.toFixed(1)}%
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function OverallHealth({
  fixture,
  week1Results,
  storedIsPrimary,
}: {
  fixture: ReturnType<typeof loadFixtureBacktestSummary>;
  week1Results: ReturnType<typeof loadWeek1Results>;
  storedIsPrimary: boolean;
}) {
  // When the real stored Week-1 run is the primary source, the
  // fixture starter-test's 8/2/100%/88.9% numbers MUST NOT be
  // displayed as the latest hit rate / ROI — that would
  // misrepresent fixture-synthetic data as real performance.
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        {storedIsPrimary
          ? "Fixture starter-test (synthetic) — overall health"
          : "Overall model health"}
      </h2>
      {storedIsPrimary ? (
        <p className="mt-1 text-[11px] text-amber-800">
          Fixture preview — not stored Week 1 performance. Use the
          stored panel above for real candidates.
        </p>
      ) : null}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Evaluated props"
          value={`${(fixture?.evaluated ?? 0) + (week1Results?.evaluatedProps.length ?? 0)}`}
          sub={`${fixture?.evaluated ?? 0} fixture + ${week1Results?.evaluatedProps.length ?? 0} Week 1 fixture`}
        />
        <Stat
          label="Qualified bets"
          value={`${(fixture?.qualifiedBets ?? 0) + (week1Results?.qualifiedBets.length ?? 0)}`}
        />
        <Stat
          label={storedIsPrimary ? "Fixture hit rate" : "Latest hit rate"}
          value={
            storedIsPrimary
              ? fixture
                ? `${(fixture.hitRate * 100).toFixed(1)}%`
                : "—"
              : week1Results
                ? `${(week1Results.hitRate * 100).toFixed(1)}%`
                : fixture
                  ? `${(fixture.hitRate * 100).toFixed(1)}%`
                  : "—"
          }
          sub={storedIsPrimary ? "fixture-only" : undefined}
        />
        <Stat
          label={storedIsPrimary ? "Fixture ROI" : "Latest ROI"}
          value={
            storedIsPrimary
              ? fixture
                ? `${fixture.roiPct.toFixed(1)}%`
                : "—"
              : week1Results
                ? `${week1Results.roiPct.toFixed(1)}%`
                : fixture
                  ? `${fixture.roiPct.toFixed(1)}%`
                  : "—"
          }
          sub={storedIsPrimary ? "fixture-only" : undefined}
        />
        <Stat
          label="Avg edge"
          value={
            fixture
              ? `${(fixture.averageEdge * 100).toFixed(1)}%`
              : "—"
          }
        />
        <Stat
          label="Avg conf-adj edge"
          value={
            week1Results
              ? `${(week1Results.averageConfidenceAdjustedEdge * 100).toFixed(1)}%`
              : "—"
          }
          sub="Week 1 fixture only"
        />
        <Stat
          label="Brier score"
          value={fixture ? fixture.brierScore.toFixed(3) : "—"}
        />
        <Stat
          label="Max drawdown (units)"
          value={fixture ? fixture.maxDrawdownUnits.toFixed(2) : "—"}
        />
      </div>
    </section>
  );
}

function WeekByWeekTable({
  week1Results,
  stored,
  storedIsPrimary,
}: {
  week1Results: ReturnType<typeof loadWeek1Results>;
  stored: StoredWeek1MonitorSnapshot | undefined;
  storedIsPrimary: boolean;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Week-by-week performance
      </h2>
      <div className="mt-3 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
              <th className="pb-2 pr-3">Week</th>
              <th className="pb-2 pr-3 text-right">Evaluated</th>
              <th className="pb-2 pr-3 text-right">Qualified</th>
              <th className="pb-2 pr-3 text-right">W · L · P</th>
              <th className="pb-2 pr-3 text-right">Hit rate</th>
              <th className="pb-2 pr-3 text-right">ROI</th>
              <th className="pb-2 pr-3">Best · Worst</th>
              <th className="pb-2">Notes</th>
            </tr>
          </thead>
          <tbody className="text-ink-800">
            {storedIsPrimary && stored ? (
              stored.graded ? (
                <tr className="border-t border-white/40">
                  <td className="py-2 pr-3">Week 1 (stored, universe)</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.candidateCount}
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    {stored.graded.recommendedPlays.enabled
                      ? `${stored.graded.recommendedPlays.count}`
                      : "pending"}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.graded.universeDiagnostics.overSide.wins}/
                    {stored.graded.universeDiagnostics.underSide.wins} ·{" "}
                    {stored.graded.universeDiagnostics.overSide.losses}/
                    {stored.graded.universeDiagnostics.underSide.losses}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.graded.universeDiagnostics.overSide.hitRatePct.toFixed(1)}%
                    {" / "}
                    {stored.graded.universeDiagnostics.underSide.hitRatePct.toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    {stored.graded.recommendedPlays.enabled
                      ? `${stored.graded.recommendedPlays.roiPct.toFixed(1)}%`
                      : "pending"}
                  </td>
                  <td className="py-2 pr-3 text-[11px]">
                    Better · {stored.graded.universeDiagnostics.betterSide}
                  </td>
                  <td className="py-2 text-[11px] text-amber-800">
                    Universe diagnostic — not betting ROI
                  </td>
                </tr>
              ) : (
                <tr className="border-t border-white/40">
                  <td className="py-2 pr-3">Week 1 (stored, real)</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {stored.candidateCount}
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    pending
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    pending
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    pending
                  </td>
                  <td className="py-2 pr-3 text-right text-[11px] text-ink-500">
                    pending
                  </td>
                  <td className="py-2 pr-3 text-[11px] text-ink-500">—</td>
                  <td className="py-2 text-[11px] text-sea-700">
                    Pregame candidates only — not graded yet
                  </td>
                </tr>
              )
            ) : null}
            {week1Results ? (
              <tr className="border-t border-white/40">
                <td className="py-2 pr-3">
                  Week 1 (fixture starter test)
                  {storedIsPrimary ? (
                    <div className="text-[10px] text-amber-800">
                      synthetic
                    </div>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {week1Results.evaluatedProps.length}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {week1Results.qualifiedBets.length}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {week1Results.wins} · {week1Results.losses} ·{" "}
                  {week1Results.pushes}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {(week1Results.hitRate * 100).toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {week1Results.roiPct.toFixed(1)}%
                </td>
                <td className="py-2 pr-3 text-[11px]">
                  {week1Results.bestPropType ?? "—"} ·{" "}
                  {week1Results.worstPropType ?? "—"}
                </td>
                <td className="py-2 text-[11px] text-amber-800">
                  Fixture data — not proof of live edge
                </td>
              </tr>
            ) : !stored ? (
              <tr className="border-t border-white/40">
                <td className="py-2 pr-3" colSpan={8}>
                  <span className="text-ink-500">
                    Week 1 starter test not generated yet — run{" "}
                    <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
                      npx tsx scripts/run-week-1-starter-test.ts
                    </code>
                    .
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlayerPropPerformance({
  fixture,
  storedIsPrimary,
}: {
  fixture: ReturnType<typeof loadFixtureBacktestSummary>;
  storedIsPrimary: boolean;
}) {
  if (!fixture) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          Player prop performance breakdown unavailable
        </div>
        <p className="mt-1 text-xs text-amber-900">
          Run{" "}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
            npx tsx scripts/run-backtest-2025.ts --fixtures
          </code>{" "}
          to populate the fixture summary.
        </p>
      </section>
    );
  }
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          {storedIsPrimary
            ? "Player prop performance (fixture starter-test only)"
            : "Player prop performance"}
        </h2>
        {storedIsPrimary ? (
          <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
            Fixture only · not stored real-data performance
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BreakdownPanel
          title="By prop type"
          rows={fixture.byPropType.map((p) => ({
            label: p.propType,
            bets: p.bets,
            hitRate: p.hitRate,
            roiPct: p.roiPct,
          }))}
        />
        <BreakdownPanel
          title="By edge bucket"
          rows={fixture.byEdgeBucket.map((b) => ({
            label: b.label,
            bets: b.bets,
            hitRate: b.hitRate,
            roiPct: b.roiPct,
          }))}
        />
        <BreakdownPanel
          title="By confidence"
          rows={fixture.byConfidence.map((b) => ({
            label: b.label,
            bets: b.bets,
            hitRate: b.hitRate,
            roiPct: b.roiPct,
          }))}
        />
        <BreakdownPanel
          title="By line bucket"
          rows={fixture.byLineBucket.slice(0, 6).map((b) => ({
            label: b.bucketLabel,
            bets: b.bets,
            hitRate: b.hitRate,
            roiPct: b.roiPct,
          }))}
        />
      </div>
      {fixture.byDisqualifier.length > 0 && (
        <div className="mt-4">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Primary disqualifiers
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-700">
            {fixture.byDisqualifier.slice(0, 5).map((d) => (
              <li
                key={d.disqualifier}
                className="flex items-center justify-between gap-3"
              >
                <span>{d.disqualifier}</span>
                <span className="tabular-nums text-ink-900">{d.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function BreakdownPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; bets: number; hitRate: number; roiPct: number }>;
}) {
  return (
    <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {title}
      </div>
      <table className="mt-2 min-w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
            <th className="pb-1 pr-2">Label</th>
            <th className="pb-1 pr-2 text-right">Bets</th>
            <th className="pb-1 pr-2 text-right">Hit</th>
            <th className="pb-1 text-right">ROI</th>
          </tr>
        </thead>
        <tbody className="text-ink-800">
          {rows.length === 0 ? (
            <tr className="border-t border-white/40">
              <td className="py-1" colSpan={4}>
                <span className="text-ink-500">No data.</span>
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.label} className="border-t border-white/40">
                <td className="py-1 pr-2">{r.label}</td>
                <td className="py-1 pr-2 text-right tabular-nums">{r.bets}</td>
                <td className="py-1 pr-2 text-right tabular-nums">
                  {(r.hitRate * 100).toFixed(1)}%
                </td>
                <td
                  className={
                    "py-1 text-right tabular-nums " +
                    (r.roiPct >= 0 ? "text-sea-700" : "text-coral-700")
                  }
                >
                  {r.roiPct.toFixed(1)}%
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function V1V2Panel({
  compareLatest,
  changes,
  week1Comparison,
  storedIsPrimary,
}: {
  compareLatest: ReturnType<typeof loadFixtureComparisonSummary>;
  changes: ReturnType<typeof loadFixtureRecommendationChanges>;
  week1Comparison: ReturnType<typeof loadWeek1V1V2Comparison>;
  storedIsPrimary: boolean;
}) {
  const cmp = week1Comparison ?? compareLatest;
  if (!cmp) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          V1 vs V2 comparison not generated
        </div>
        <p className="mt-1 text-xs text-amber-900">
          Run{" "}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
            npx tsx scripts/run-week-1-starter-test.ts
          </code>{" "}
          or{" "}
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[11px]">
            npx tsx scripts/run-backtest-2025.ts --fixtures --algorithm-mode compare
          </code>
          .
        </p>
      </section>
    );
  }
  const topDisq =
    week1Comparison?.recommendationChangeSummary.topNewV2Disqualifiers ??
    changes?.topNewV2Disqualifiers ??
    [];
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          {storedIsPrimary ? "V1 vs V2 (fixture only)" : "V1 vs V2"}
        </h2>
        {storedIsPrimary ? (
          <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
            Fixture only · stored V1/V2 comparison pending
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="V1 qualified"
          value={`${cmp.v1.qualifiedBets}`}
          sub={`Hit ${(cmp.v1.hitRate * 100).toFixed(1)}% · ROI ${cmp.v1.roiPct.toFixed(1)}%`}
        />
        <Stat
          label="V2 qualified"
          value={`${cmp.v2.qualifiedBets}`}
          sub={`Hit ${(cmp.v2.hitRate * 100).toFixed(1)}% · ROI ${cmp.v2.roiPct.toFixed(1)}%`}
        />
        <Stat
          label="V2 filtered V1 plays"
          value={`${
            week1Comparison?.recommendationChangeSummary.v1OnlyBets ??
            changes?.v1OnlyBets ??
            0
          }`}
        />
        <Stat
          label="V2 new plays"
          value={`${
            week1Comparison?.recommendationChangeSummary.v2OnlyBets ??
            changes?.v2OnlyBets ??
            0
          }`}
        />
      </div>
      {topDisq.length > 0 && (
        <div className="mt-3 text-[11px] text-ink-600">
          Most common V2 disqualifier: {topDisq[0].disqualifier} (×
          {topDisq[0].count})
        </div>
      )}
    </section>
  );
}

function ProxyHealthPanel({
  proxySummary,
}: {
  proxySummary: ReturnType<typeof loadFixtureProxySummary>;
}) {
  if (!proxySummary) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          Proxy validation report not generated
        </div>
      </section>
    );
  }
  const perfEntries = Object.entries(proxySummary.performance);
  perfEntries.sort(
    (a, b) =>
      (b[1] as { liftPp?: number }).liftPp! -
      (a[1] as { liftPp?: number }).liftPp!,
  );
  const best = perfEntries[0];
  const worst = perfEntries[perfEntries.length - 1];
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Proxy / module health
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Proxies tracked" value={`${perfEntries.length}`} />
        <Stat
          label="False positives flagged"
          value={`${proxySummary.falsePositives.length}`}
        />
        <Stat
          label="Best proxy"
          value={best ? best[0] : "—"}
          sub={
            best
              ? `lift ${((best[1] as { liftPp?: number }).liftPp ?? 0).toFixed(1)}pp`
              : undefined
          }
        />
        <Stat
          label="Worst proxy"
          value={worst ? worst[0] : "—"}
          sub={
            worst
              ? `lift ${((worst[1] as { liftPp?: number }).liftPp ?? 0).toFixed(1)}pp`
              : undefined
          }
        />
      </div>
    </section>
  );
}

function GameEdgeMonitor({
  week1GameEdge,
  storedIsPrimary,
}: {
  week1GameEdge: ReturnType<typeof loadWeek1GameEdgePreview>;
  storedIsPrimary: boolean;
}) {
  if (!week1GameEdge) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          Game Edge preview not generated yet.
        </div>
      </section>
    );
  }
  const moneyline = week1GameEdge.games.filter(
    (g) =>
      g.recommendation === "HOME_MONEYLINE" ||
      g.recommendation === "AWAY_MONEYLINE",
  ).length;
  const spread = week1GameEdge.games.filter(
    (g) =>
      g.recommendation === "HOME_SPREAD" || g.recommendation === "AWAY_SPREAD",
  ).length;
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          {storedIsPrimary ? "Game Edge monitor (fixture only)" : "Game Edge monitor"}
        </h2>
        {storedIsPrimary ? (
          <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
            Fixture only · stored Game Edge backtest pending
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Games evaluated" value={`${week1GameEdge.games.length}`} />
        <Stat label="ML candidates" value={`${moneyline}`} />
        <Stat label="Spread candidates" value={`${spread}`} />
        <Stat label="Upset watch" value={`${week1GameEdge.upsetWatchCount}`} />
      </div>
      <div className="mt-3 text-[11px] text-ink-500">
        ROI placeholder — Game Edge has no historical backtest yet. See{" "}
        <Link href="/game-edge" className="underline">
          /game-edge
        </Link>{" "}
        for the per-game view.
      </div>
    </section>
  );
}

function ParlayMonitor({
  week1Parlays,
  storedIsPrimary,
}: {
  week1Parlays: ReturnType<typeof loadWeek1ParlayPreview>;
  storedIsPrimary: boolean;
}) {
  if (!week1Parlays) {
    return (
      <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
        <div className="text-sm font-semibold text-amber-900">
          Parlay preview not generated yet.
        </div>
      </section>
    );
  }
  const counts = new Map<string, number>();
  for (const c of week1Parlays.candidates) {
    counts.set(c.parlayType, (counts.get(c.parlayType) ?? 0) + 1);
  }
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          {storedIsPrimary ? "Parlay monitor (fixture only)" : "Parlay monitor"}
        </h2>
        {storedIsPrimary ? (
          <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
            Fixture only · stored parlay rebuild pending
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Evaluated" value={`${week1Parlays.candidates.length}`} />
        <Stat
          label="Qualified"
          value={`${week1Parlays.candidates.filter((c) => c.qualified).length}`}
        />
        <Stat
          label="Avg projected hit"
          value={`${(week1Parlays.portfolioSummary.averageProjectedHitRate * 100).toFixed(1)}%`}
        />
        <Stat
          label="Avg required hit"
          value={`${(week1Parlays.portfolioSummary.averageRequiredHitRate * 100).toFixed(1)}%`}
        />
        <Stat
          label="Avg payout"
          value={`${week1Parlays.portfolioSummary.averagePayoutMultiplier.toFixed(2)}x`}
        />
        <Stat
          label="Avg conf-adj EV"
          value={`${(week1Parlays.portfolioSummary.averageConfidenceAdjustedEV * 100).toFixed(1)}%`}
        />
        <Stat
          label="High-risk filtered"
          value={`${week1Parlays.portfolioSummary.highRiskFilteredOut}`}
        />
        <Stat
          label="100-parlay batch ROI"
          value={`${(week1Parlays.batchSimulation.expectedROI * 100).toFixed(1)}%`}
        />
      </div>
      {counts.size > 0 && (
        <div className="mt-3 text-[11px] text-ink-600">
          Parlay type breakdown:{" "}
          {Array.from(counts.entries())
            .map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")} (${v})`)
            .join("; ")}
        </div>
      )}
    </section>
  );
}

function WarningsPanel() {
  return (
    <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900">
        Discipline reminders
      </div>
      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-900">
        <li>Fixture results are not proof of live edge.</li>
        <li>The backtest runner uses stored data only.</li>
        <li>No live betting automation is enabled.</li>
        <li>No touchdown props in V1.</li>
      </ul>
    </section>
  );
}

function RunHint({ showRunHint }: { showRunHint: boolean }) {
  if (!showRunHint) return null;
  return (
    <section className="rounded-2xl bg-white/65 p-4 ring-1 ring-white/40">
      <div className="text-sm font-semibold text-ink-900">
        Generate this dashboard&rsquo;s data
      </div>
      <p className="mt-1 text-xs text-ink-700">
        The monitor renders cleanly even without inputs — but the
        full panels light up once you run:
      </p>
      <ul className="mt-2 space-y-1 text-[11px] text-ink-700">
        <li>
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono">
            npx tsx scripts/run-week-1-starter-test.ts
          </code>{" "}
          — Week 1 starter test
        </li>
        <li>
          <code className="rounded bg-white/70 px-1 py-0.5 font-mono">
            npx tsx scripts/run-backtest-2025.ts --fixtures --algorithm-mode compare
          </code>{" "}
          — V1 vs V2 comparison
        </li>
      </ul>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/65 p-3 ring-1 ring-white/40">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className="mt-0.5 text-base font-semibold text-ink-900">{value}</div>
      {sub && <div className="text-[11px] text-ink-600">{sub}</div>}
    </div>
  );
}

function ScorecardAuditMonitor({
  audit,
}: {
  audit: NonNullable<StoredWeek1MonitorSnapshot["graded"]>["scorecardAudit"];
}) {
  if (!audit) return null;
  return (
    <div
      className="mt-4 space-y-2"
      data-testid="monitor-scorecard-audit"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
          Scorecard audit · why is recommendedPlays empty?
        </h3>
        <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
          Diagnostic only
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
        <DisqStat
          label="Candidates scored"
          value={audit.candidatesScored}
        />
        <DisqStat
          label="With scorecard"
          value={audit.candidatesWithScorecard}
        />
        <DisqStat label="Qualified" value={audit.qualifiedCount} />
        <DisqStat label="Disqualified" value={audit.disqualifiedCount} />
        <DisqStat
          label="Missing prior history"
          value={audit.candidatesMissingHistory}
        />
        <DisqStat label="Rec · OVER" value={audit.byRecommendation.OVER} />
        <DisqStat label="Rec · UNDER" value={audit.byRecommendation.UNDER} />
        <DisqStat label="Rec · PASS" value={audit.byRecommendation.PASS} />
      </div>
      {audit.topDisqualifiers.length > 0 ? (
        <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Top exact disqualifier reasons
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-ink-800">
            {audit.topDisqualifiers.map((d) => (
              <li
                key={d.reason}
                className="flex items-center justify-between gap-3 border-b border-white/40 pb-1"
              >
                <span className="truncate">{d.reason}</span>
                <span className="font-semibold tabular-nums text-ink-900">
                  ×{d.count}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {audit.featureCompleteness.length > 0 ? (
        <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Per-feature gate health
          </div>
          <table className="mt-1 min-w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
                <th className="pb-1 pr-2">Bucket</th>
                <th className="pb-1 pr-2 text-right">Gate</th>
                <th className="pb-1 pr-2 text-right">Below gate</th>
                <th className="pb-1 pr-2 text-right">Missing</th>
                <th className="pb-1 pr-2 text-right">Mean</th>
                <th className="pb-1 text-right">Min · Max</th>
              </tr>
            </thead>
            <tbody className="text-ink-800">
              {audit.featureCompleteness.map((r) => (
                <tr key={r.bucket} className="border-t border-white/40">
                  <td className="py-1 pr-2">{r.bucket}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.gateThreshold.toFixed(2)}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.belowGate}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.missing}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {r.scored > 0 ? r.meanScore.toFixed(2) : "—"}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {r.scored > 0
                      ? `${r.minScore.toFixed(2)} · ${r.maxScore.toFixed(2)}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[10px] text-ink-500">
            Bucket with belowGate ≈ scored AND a low mean is the
            most likely structural reason for 0 qualified plays.
          </p>
        </div>
      ) : null}
      {audit.marketContext ? (
        <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Market-context simulation · diagnostic only · no threshold changes
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <DisqStat
              label="At current gate 0.45"
              value={audit.marketContext.simulation.qualifyingAtGate045}
            />
            <DisqStat
              label="If gate were 0.40"
              value={audit.marketContext.simulation.qualifyingAtGate040}
            />
            <DisqStat
              label="If gate were 0.35"
              value={audit.marketContext.simulation.qualifyingAtGate035}
            />
            <DisqStat
              label="Raw < 0 (extreme juice)"
              value={audit.marketContext.rawDistribution.lt000}
            />
          </div>
          <p className="mt-2 text-[10px] text-ink-500">
            Raw min/mean/max:{" "}
            {audit.marketContext.rawMin.toFixed(2)} ·{" "}
            {audit.marketContext.rawMean.toFixed(2)} ·{" "}
            {audit.marketContext.rawMax.toFixed(2)}. A 0.40
            clamped score means the raw score was ≤ 0.40 before
            clamping; lowering the GATE to 0.40 lets candidates
            whose raw score is ≥ 0.40 qualify (those with raw
            &lt; 0.40 stay disqualified).
          </p>
        </div>
      ) : null}
      {audit.missingHistory && audit.missingHistory.totalMissing > 0 ? (
        <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Missing-history split ({audit.missingHistory.totalMissing} candidates)
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
            <DisqStat
              label="Team-switched"
              value={audit.missingHistory.teamSwitched}
            />
            <DisqStat
              label="Rookie / unknown"
              value={audit.missingHistory.rookieOrUnknown}
            />
            <DisqStat
              label="Name mismatch"
              value={audit.missingHistory.possibleNameMismatch}
            />
          </div>
        </div>
      ) : null}
      {audit.closestToQualifying && audit.closestToQualifying.length > 0 ? (
        <div className="rounded-xl bg-white/60 p-3 ring-1 ring-white/40">
          <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Closest to qualifying (top 5 · diagnostic)
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-ink-800">
            {audit.closestToQualifying.slice(0, 5).map((row) => (
              <li
                key={row.candidateId}
                className="flex items-center justify-between gap-3 border-b border-white/40 pb-1"
              >
                <span className="truncate">
                  {row.playerName} · {row.propType.replace(/_/g, " ")} · {row.line} ·{" "}
                  {row.side}
                </span>
                <span className="font-semibold tabular-nums text-ink-900">
                  gap {row.qualificationGap.toFixed(2)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DisqStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-white/65 px-3 py-2 ring-1 ring-white/40">
      <span className="text-ink-600">{label}</span>
      <span className="font-semibold tabular-nums text-ink-900">{value}</span>
    </div>
  );
}
