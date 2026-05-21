import Link from "next/link";
import {
  loadWeek1DataAudit,
  loadWeek1DataModeStatus,
  loadWeek1GameEdgePreview,
  loadWeek1LeakageCheck,
  loadWeek1LockedRecommendations,
  loadWeek1NflDataCoverage,
  loadWeek1OddsCoverage,
  loadWeek1ParlayPreview,
  loadWeek1Pregame,
  loadWeek1Results,
  loadWeek1ScheduleValidation,
  loadWeek1V1V2Comparison,
  type Week1DataModeStatus,
} from "@/lib/backtest/week-1-summary";
import {
  loadStoredWeek1MonitorSnapshot,
  type StoredWeek1MonitorSnapshot,
} from "@/lib/backtest/week-1-monitor-summary";

export const dynamic = "force-dynamic";

export default async function Week1StarterTestPage() {
  const pregame = loadWeek1Pregame();
  const locked = loadWeek1LockedRecommendations();
  const dataAudit = loadWeek1DataAudit();
  const oddsCoverage = loadWeek1OddsCoverage();
  const nflCoverage = loadWeek1NflDataCoverage();
  const leakage = loadWeek1LeakageCheck();
  const scheduleValidation = loadWeek1ScheduleValidation();
  // DB-backed stored Week-1 snapshot wins over the file when
  // available — survives a Railway redeploy.
  const storedSnapshot = await loadStoredWeek1MonitorSnapshot({
    season: 2025,
    week: 1,
  });
  const dataModeStatus = mergeStoredIntoDataModeStatus(
    loadWeek1DataModeStatus(),
    storedSnapshot,
  );
  const results = loadWeek1Results();
  const comparison = loadWeek1V1V2Comparison();
  const parlays = loadWeek1ParlayPreview();
  const gameEdge = loadWeek1GameEdgePreview();
  const hasOutput = Boolean(pregame || results || storedSnapshot);
  // A successful stored run demotes the synthetic-fixture
  // banner — the page primary state is the real backtest.
  const storedReady =
    Boolean(storedSnapshot && storedSnapshot.realWeek1BacktestReady) ||
    Boolean(dataModeStatus && dataModeStatus.realWeek1BacktestReady);

  return (
    <div className="space-y-8">
      {scheduleValidation && scheduleValidation.status !== "PASS" && !storedReady && (
        <SyntheticFixtureBanner validation={scheduleValidation} />
      )}
      <Hero
        scheduleStatus={scheduleValidation?.status}
      />
      {!hasOutput && <RunHint />}
      <PregameInputs />
      {dataModeStatus && <DataSourceModeSection status={dataModeStatus} />}
      {storedSnapshot?.graded ? (
        <StoredGradedSection
          snapshot={storedSnapshot}
          graded={storedSnapshot.graded}
        />
      ) : null}
      {scheduleValidation && (
        <ScheduleValidationSection validation={scheduleValidation} />
      )}
      {(dataAudit || oddsCoverage || nflCoverage || leakage) && (
        <DataIntegritySection
          dataAudit={dataAudit}
          oddsCoverage={oddsCoverage}
          nflCoverage={nflCoverage}
          leakage={leakage}
        />
      )}
      {locked && <LockedSnapshotSection locked={locked} />}
      {pregame && <PregameCandidates pregame={pregame} />}
      {results && (
        <ResultsSection
          results={results}
          syntheticFixture={
            scheduleValidation?.syntheticFixture ?? false
          }
        />
      )}
      {comparison && <V1V2Section comparison={comparison} />}
      {parlays && <ParlaySection parlays={parlays} />}
      {gameEdge && <GameEdgeSection gameEdge={gameEdge} />}
      <Footnote />
    </div>
  );
}

function Hero({
  scheduleStatus,
}: {
  scheduleStatus?: "PASS" | "FAIL" | "SYNTHETIC_ONLY";
}) {
  return (
    <section>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Pregame Simulation
        </span>
        <span className="inline-flex items-center gap-2 rounded-full bg-sea-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-sea-800 ring-1 ring-sea-200/80">
          Fixture / Stored Data
        </span>
        {scheduleStatus && scheduleStatus !== "PASS" && (
          <span
            className="inline-flex items-center gap-2 rounded-full bg-rose-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-coral-700 ring-1 ring-coral-300/60"
            data-testid="hero-synthetic-chip"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-coral-500" />
            Synthetic Fixture ({scheduleStatus.replace("_", " ").toLowerCase()})
          </span>
        )}
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
        {scheduleStatus === "PASS"
          ? "Week 1 2025 Starter Test"
          : "Week 1 2025 Pipeline Test (Synthetic Fixture)"}
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-700">
        Pregame model view using only data available before Week 1.
        No live odds. No paid API calls. No automated betting. The
        runner consumes a dedicated Week-1 fixture set under{" "}
        <code className="rounded bg-white/70 px-1 py-0.5 font-mono text-[10px]">
          data/fixtures/backtest/week-1/
        </code>{" "}
        so the existing fixture backtest is unchanged.
      </p>
    </section>
  );
}

function SyntheticFixtureBanner({
  validation,
}: {
  validation: NonNullable<ReturnType<typeof loadWeek1ScheduleValidation>>;
}) {
  return (
    <section
      className="rounded-2xl bg-rose-50/80 p-4 ring-1 ring-coral-300/70 backdrop-blur"
      data-testid="synthetic-fixture-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-coral-700">
            Synthetic Week 1 Fixture — Schedule does not match real 2025 Week 1
          </div>
          <p className="mt-1 max-w-2xl text-xs text-coral-700">
            {validation.invalidCandidateGames} of {validation.candidateGames}{" "}
            candidate {validation.candidateGames === 1 ? "game does" : "games do"}{" "}
            not appear in the real 2025 Week 1 slate
            ({validation.expectedGames} games). These are test fixtures for
            pipeline validation only — they are not real 2025 Week 1 plays.
          </p>
          <p className="mt-1 text-[11px] text-coral-700">
            <strong>realWeek1BacktestReady = false.</strong> Real Week 1 odds
            not loaded yet. Run stored odds ingestion + nflverse processing
            before a real Week 1 simulation.
          </p>
        </div>
        <Link
          href="/diagnostics"
          className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-coral-700 ring-1 ring-coral-300/60 transition hover:bg-rose-100"
        >
          Open diagnostics →
        </Link>
      </div>
    </section>
  );
}

function ScheduleValidationSection({
  validation,
}: {
  validation: NonNullable<ReturnType<typeof loadWeek1ScheduleValidation>>;
}) {
  const statusClass =
    validation.status === "PASS"
      ? "bg-sea-50 text-sea-800 ring-sea-200/70"
      : validation.status === "FAIL"
        ? "bg-rose-50 text-coral-700 ring-coral-300/60"
        : "bg-amber-50 text-amber-900 ring-amber-200/70";
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Schedule validation
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ring-1 ${statusClass}`}
        >
          Status · {validation.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Schedule source"
          value="Static NFL schedule fixture"
          sub={validation.scheduleSource}
        />
        <Stat
          label="Expected games"
          value={`${validation.expectedGames}`}
          sub="2025 NFL Week 1 slate"
        />
        <Stat
          label="Candidate games"
          value={`${validation.candidateGames}`}
          sub="loaded by the runner"
        />
        <Stat
          label="Valid · invalid"
          value={`${validation.validCandidateGames} · ${validation.invalidCandidateGames}`}
          sub={validation.realWeek1BacktestReady ? "Real-week ready" : "Not real-week ready"}
        />
      </div>
      {validation.candidates.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
                <th className="pb-2 pr-3">Candidate</th>
                <th className="pb-2 pr-3">Result</th>
                <th className="pb-2">Reason / match</th>
              </tr>
            </thead>
            <tbody className="text-ink-800">
              {validation.candidates.map((c) => (
                <tr key={c.gameId} className="border-t border-white/40">
                  <td className="py-2 pr-3 font-medium">
                    {c.awayTeam} @ {c.homeTeam}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        c.valid
                          ? "rounded-full bg-sea-50 px-2 py-0.5 text-[10px] font-semibold text-sea-800 ring-1 ring-sea-200/60"
                          : "rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-coral-700 ring-1 ring-coral-300/60"
                      }
                    >
                      {c.valid ? "valid" : "invalid"}
                    </span>
                  </td>
                  <td className="py-2 text-[11px] text-ink-600">
                    {c.valid
                      ? `matches ${c.matchedRealGameId}`
                      : c.reason ?? "(no reason)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {validation.notes.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[11px] text-ink-600">
          {validation.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RunHint() {
  return (
    <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
      <div className="text-sm font-semibold text-amber-900">
        Run the starter test first
      </div>
      <p className="mt-1 text-xs text-amber-900">
        Generate this page&rsquo;s data by running:
      </p>
      <pre className="mt-2 overflow-x-auto rounded-lg bg-white/70 p-3 font-mono text-[11px] text-ink-800">
        {`npx tsx scripts/run-week-1-starter-test.ts`}
      </pre>
    </section>
  );
}

function PregameInputs() {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Pregame inputs
      </h2>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Season / Week
          </div>
          <div className="mt-1 text-sm text-ink-900">2025 · Week 1</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Markets included
          </div>
          <div className="mt-1 text-xs text-ink-700">
            PASSING_ATTEMPTS · PASSING_COMPLETIONS · RECEPTIONS ·
            RUSHING_ATTEMPTS
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Markets excluded
          </div>
          <div className="mt-1 text-xs text-ink-700">
            PASSING_YARDS · RECEIVING_YARDS · RUSHING_YARDS ·{" "}
            <strong>no touchdown props</strong>
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Data sources
          </div>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-ink-700">
            <li>Stored nflverse-style historical stats</li>
            <li>Stored historical Odds API quotes (mock data today)</li>
            <li>Stored weather / stadium snapshots</li>
            <li>Static coaching / proxy / matchup data</li>
          </ul>
        </div>
      </div>
    </section>
  );
}

function PregameCandidates({
  pregame,
}: {
  pregame: NonNullable<ReturnType<typeof loadWeek1Pregame>>;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Pregame candidates ({pregame.candidates.length})
        </h2>
        <span className="text-[11px] text-ink-500">
          Generated {new Date(pregame.generatedAt).toLocaleString("en-US")} ·{" "}
          algorithm mode <code className="font-mono">{pregame.algorithmMode}</code>
        </span>
      </div>
      <p className="mt-1 text-[11px] text-ink-500">
        Outcomes intentionally stripped — this view shows only what the
        model could see before kickoff.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
              <th className="pb-2 pr-3">Player</th>
              <th className="pb-2 pr-3">Matchup</th>
              <th className="pb-2 pr-3">Prop</th>
              <th className="pb-2 pr-3">Line</th>
              <th className="pb-2 pr-3">Side</th>
              <th className="pb-2 pr-3 text-right">Market</th>
              <th className="pb-2 pr-3 text-right">Model</th>
              <th className="pb-2 pr-3 text-right">Edge</th>
              <th className="pb-2 pr-3">Status</th>
              <th className="pb-2">Top reason / risk</th>
            </tr>
          </thead>
          <tbody className="text-ink-800">
            {pregame.candidates.map((c) => (
              <tr key={c.id} className="border-t border-white/40">
                <td className="py-2 pr-3 font-medium">{c.playerName}</td>
                <td className="py-2 pr-3">
                  {c.team} vs {c.opponent}
                </td>
                <td className="py-2 pr-3">{c.propType}</td>
                <td className="py-2 pr-3 tabular-nums">{c.line}</td>
                <td className="py-2 pr-3">{c.selectedSide}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {(c.marketOverProbability * 100).toFixed(0)}%
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {(c.modelOverProbability * 100).toFixed(0)}%
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {(c.edge * 100).toFixed(1)}pp
                </td>
                <td className="py-2 pr-3">
                  <span
                    className={
                      c.qualified
                        ? "rounded-full bg-sea-50 px-2 py-0.5 text-[10px] font-semibold text-sea-800 ring-1 ring-sea-200/60"
                        : "rounded-full bg-cream-200 px-2 py-0.5 text-[10px] font-semibold text-ink-700 ring-1 ring-ink-200/60"
                    }
                  >
                    {c.qualified ? c.recommendation : "PASS"}
                  </span>
                </td>
                <td className="py-2 text-[11px] text-ink-600">
                  {c.primaryDisqualifier
                    ? `Disq: ${c.primaryDisqualifier}`
                    : c.scorecardSnapshot?.reasons?.[0] ??
                      "(no reasons surfaced)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ResultsSection({
  results,
  syntheticFixture,
}: {
  results: NonNullable<ReturnType<typeof loadWeek1Results>>;
  syntheticFixture: boolean;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          {syntheticFixture
            ? "Pipeline output (synthetic fixture)"
            : "Graded Week 1 results"}
        </h2>
        {syntheticFixture && (
          <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-coral-700 ring-1 ring-coral-300/60">
            Not real 2025 Week 1
          </span>
        )}
      </div>
      {syntheticFixture && (
        <p className="mt-2 text-[11px] text-coral-700">
          These numbers come from synthetic fixture games that do not appear
          in the real 2025 Week 1 slate. Treat as pipeline-mechanics output
          only — do not interpret as model performance.
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Wins · Losses · Pushes"
          value={`${results.wins} · ${results.losses} · ${results.pushes}`}
        />
        <Stat label="Hit rate" value={`${(results.hitRate * 100).toFixed(1)}%`} />
        <Stat label="ROI" value={`${results.roiPct.toFixed(1)}%`} />
        <Stat
          label="Avg edge"
          value={`${(results.averageEdge * 100).toFixed(1)}pp`}
        />
      </div>
      {results.commonDisqualifiers.length > 0 && (
        <div className="mt-4 text-[11px] text-ink-600">
          Top disqualifiers:{" "}
          {results.commonDisqualifiers
            .slice(0, 4)
            .map((d) => `${d.disqualifier} (×${d.count})`)
            .join("; ")}
        </div>
      )}
    </section>
  );
}

function V1V2Section({
  comparison,
}: {
  comparison: NonNullable<ReturnType<typeof loadWeek1V1V2Comparison>>;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        V1 vs V2 comparison
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="V1 qualified"
          value={`${comparison.v1.qualifiedBets}`}
          sub={`Hit ${(comparison.v1.hitRate * 100).toFixed(1)}% · ROI ${comparison.v1.roiPct.toFixed(1)}%`}
        />
        <Stat
          label="V2 qualified"
          value={`${comparison.v2.qualifiedBets}`}
          sub={`Hit ${(comparison.v2.hitRate * 100).toFixed(1)}% · ROI ${comparison.v2.roiPct.toFixed(1)}%`}
        />
        <Stat
          label="V2 filtered V1 plays"
          value={`${comparison.recommendationChangeSummary.v1OnlyBets}`}
        />
        <Stat
          label="V2 new plays"
          value={`${comparison.recommendationChangeSummary.v2OnlyBets}`}
        />
      </div>
      {comparison.recommendationChangeSummary.topNewV2Disqualifiers.length >
        0 && (
        <div className="mt-3 text-[11px] text-ink-600">
          Top new V2 disqualifiers:{" "}
          {comparison.recommendationChangeSummary.topNewV2Disqualifiers
            .slice(0, 3)
            .map((d) => `${d.disqualifier} (×${d.count})`)
            .join("; ")}
        </div>
      )}
    </section>
  );
}

function ParlaySection({
  parlays,
}: {
  parlays: NonNullable<ReturnType<typeof loadWeek1ParlayPreview>>;
}) {
  const qualified = parlays.candidates.filter((p) => p.qualified);
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Parlay candidates ({parlays.candidates.length}) — preview only
      </h2>
      <p className="mt-1 text-[11px] text-ink-500">
        Drawn from the Experimental Correlated Parlay Model. No bets
        are placed.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={`${parlays.candidates.length}`} />
        <Stat label="Qualified" value={`${qualified.length}`} />
        <Stat
          label="Avg payout"
          value={`${parlays.portfolioSummary.averagePayoutMultiplier.toFixed(2)}x`}
        />
        <Stat
          label="100-parlay batch ROI"
          value={`${(parlays.batchSimulation.expectedROI * 100).toFixed(1)}%`}
        />
      </div>
      {qualified.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Legs</th>
                <th className="pb-2 pr-3 text-right">Combined</th>
                <th className="pb-2 pr-3 text-right">Projected hit</th>
                <th className="pb-2 pr-3 text-right">Required hit</th>
                <th className="pb-2 pr-3 text-right">EV</th>
                <th className="pb-2">Reason</th>
              </tr>
            </thead>
            <tbody className="text-ink-800">
              {qualified.slice(0, 6).map((p) => (
                <tr key={p.id} className="border-t border-white/40">
                  <td className="py-2 pr-3">
                    {p.parlayType.replace(/_/g, " ").toLowerCase()}
                  </td>
                  <td className="py-2 pr-3 text-[11px]">
                    {p.legs
                      .map((l) => `${l.playerName} ${l.side}`)
                      .join(" · ")}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {p.combinedOddsAmerican > 0 ? "+" : ""}
                    {p.combinedOddsAmerican}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {(p.projectedHitRate * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {(p.requiredHitRate * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {(p.confidenceAdjustedExpectedValue * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 text-[11px] text-ink-600">
                    {p.reasons[0] ?? "(no reasons)"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 text-[11px] text-amber-800">
        ⚠︎ Parlays amplify both edge and risk. See{" "}
        <Link href="/parlays" className="underline">
          /parlays
        </Link>{" "}
        for the full builder.
      </div>
    </section>
  );
}

function GameEdgeSection({
  gameEdge,
}: {
  gameEdge: NonNullable<ReturnType<typeof loadWeek1GameEdgePreview>>;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Game Edge candidates — preview only
      </h2>
      <p className="mt-1 text-[11px] text-ink-500">
        Drawn from the Experimental Game Edge Model. Moneyline /
        spread / upset paths evaluated independently.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Games" value={`${gameEdge.games.length}`} />
        <Stat label="Qualified" value={`${gameEdge.qualifiedCount}`} />
        <Stat label="Upset watch" value={`${gameEdge.upsetWatchCount}`} />
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
              <th className="pb-2 pr-3">Matchup</th>
              <th className="pb-2 pr-3">Label</th>
              <th className="pb-2 pr-3 text-right">Model home win</th>
              <th className="pb-2 pr-3 text-right">Market</th>
              <th className="pb-2 pr-3 text-right">Upset</th>
              <th className="pb-2">Reason</th>
            </tr>
          </thead>
          <tbody className="text-ink-800">
            {gameEdge.games.slice(0, 6).map((g) => (
              <tr key={g.gameId} className="border-t border-white/40">
                <td className="py-2 pr-3 font-medium">
                  {g.awayTeam} @ {g.homeTeam}
                </td>
                <td className="py-2 pr-3 text-[11px]">
                  {g.recommendationLabel}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {(g.modelHomeWinProbability * 100).toFixed(0)}%
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {(g.marketHomeWinProbability * 100).toFixed(0)}%
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {g.upsetScore.toFixed(0)}
                </td>
                <td className="py-2 text-[11px] text-ink-600">
                  {g.reasons[0] ?? "(no reasons)"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function DataIntegritySection({
  dataAudit,
  oddsCoverage,
  nflCoverage,
  leakage,
}: {
  dataAudit: ReturnType<typeof loadWeek1DataAudit>;
  oddsCoverage: ReturnType<typeof loadWeek1OddsCoverage>;
  nflCoverage: ReturnType<typeof loadWeek1NflDataCoverage>;
  leakage: ReturnType<typeof loadWeek1LeakageCheck>;
}) {
  const leakageClean =
    leakage && !leakage.leakageDetected ? "Clean" : leakage ? "Detected" : "Unknown";
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Data integrity
      </h2>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Actual results visible to model"
          value={
            dataAudit
              ? dataAudit.actualResultsVisibleToModel
                ? "Yes"
                : "No"
              : "—"
          }
          sub="Pregame stripping enforced"
        />
        <Stat
          label="Leakage status"
          value={leakageClean}
          sub={
            leakage
              ? leakage.violations.length === 0
                ? "0 violations"
                : `${leakage.violations.length} flagged`
              : undefined
          }
        />
        <Stat
          label="Odds coverage"
          value={oddsCoverage ? `${oddsCoverage.totalProps} props` : "—"}
          sub={oddsCoverage ? oddsCoverage.note : undefined}
        />
        <Stat
          label="NFL stats coverage"
          value={
            nflCoverage ? `${nflCoverage.uniquePlayerProps} player-props` : "—"
          }
          sub={nflCoverage ? nflCoverage.historyWindow : undefined}
        />
      </div>
      {dataAudit && (
        <div className="mt-4 text-[11px] text-ink-600">
          Included markets:{" "}
          <span className="text-ink-800">
            {dataAudit.includedPropTypes.join(" · ")}
          </span>
          <br />
          Excluded markets:{" "}
          <span className="text-ink-700">
            {dataAudit.excludedPropTypes.join(" · ")} ·{" "}
            <strong>no touchdown props</strong>
          </span>
        </div>
      )}
      {dataAudit && dataAudit.notes.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-[11px] text-ink-600">
          {dataAudit.notes.map((n) => (
            <li key={n}>· {n}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LockedSnapshotSection({
  locked,
}: {
  locked: NonNullable<ReturnType<typeof loadWeek1LockedRecommendations>>;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Locked pregame recommendations
        </h2>
        <span className="text-[11px] text-ink-500">
          Locked at {new Date(locked.lockedAt).toLocaleString("en-US")}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Total candidates"
          value={`${locked.totalCandidates}`}
        />
        <Stat
          label="Locked qualified"
          value={`${locked.lockedQualifiedCount}`}
        />
        <Stat label="Locked passes" value={`${locked.lockedPasses}`} />
        <Stat label="Algorithm" value={locked.algorithmMode} />
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-500">
        Locked snapshot is the source of truth for grading — Week 1 actuals
        cannot retroactively change these picks.
      </p>
    </section>
  );
}

function DataSourceModeSection({
  status,
}: {
  status: NonNullable<ReturnType<typeof loadWeek1DataModeStatus>>;
}) {
  const isReady = status.realWeek1BacktestReady;
  const modeChip =
    status.dataMode === "stored"
      ? isReady
        ? "bg-sea-50 text-sea-800 ring-sea-200/70"
        : "bg-amber-50 text-amber-900 ring-amber-200/70"
      : "bg-amber-50 text-amber-900 ring-amber-200/70";
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Data source mode
        </h2>
        <span
          className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ring-1 ${modeChip}`}
          data-testid="data-mode-chip"
        >
          {status.dataMode} · {status.status}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Synthetic fixture"
          value={status.syntheticFixture ? "Yes" : "No"}
          sub={status.syntheticFixture ? "Pipeline test only" : "Real candidates"}
        />
        <Stat
          label="Real Week 1 ready"
          value={status.realWeek1BacktestReady ? "Yes" : "No"}
          sub={
            status.realWeek1BacktestReady
              ? "Schedule passes + data loaded"
              : "Switch to stored mode after ingestion"
          }
        />
        <Stat
          label="Missing stored odds"
          value={status.missingStoredOdds ? "Yes" : "No"}
        />
        <Stat
          label="Missing processed NFL"
          value={status.missingProcessedNfl ? "Yes" : "No"}
        />
      </div>
      {!isReady && (
        <div className="mt-4 rounded-xl bg-amber-50/80 p-3 ring-1 ring-amber-200/60">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-900">
            Real Week 1 stored data not loaded yet
          </div>
          {status.notes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-[11px] text-amber-900">
              {status.notes.slice(0, 4).map((n) => (
                <li key={n}>· {n}</li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-900">
              Transition checklist (in order)
            </div>
            <ol className="mt-1 list-inside list-decimal space-y-1 font-mono text-[10px] text-amber-900">
              <li>
                <span className="font-semibold not-italic">Process NFL data (free, no API key).</span>{" "}
                <code className="rounded bg-white/70 px-1 py-0.5">npx tsx scripts/ingest-nfl-history.ts --source local --no-dry-run</code>
              </li>
              <li>
                <span className="font-semibold not-italic">Smoke test Odds API plan (dry-run, no credits).</span>{" "}
                <code className="rounded bg-white/70 px-1 py-0.5">npx tsx scripts/ingest-historical-prop-lines.ts --season 2025 --scope smoke-test --source mock --dry-run</code>
              </li>
              <li>
                <span className="font-semibold not-italic">After explicit approval only — paid smoke test:</span>{" "}
                <code className="rounded bg-white/70 px-1 py-0.5">ALLOW_REAL_ODDS_API_CALLS=true npx tsx scripts/ingest-historical-prop-lines.ts --season 2025 --scope smoke-test --execute</code>
              </li>
              <li>
                <span className="font-semibold not-italic">After paid smoke test succeeds — paid Week 1 ingestion:</span>{" "}
                <code className="rounded bg-white/70 px-1 py-0.5">ALLOW_REAL_ODDS_API_CALLS=true npx tsx scripts/ingest-historical-prop-lines.ts --season 2025 --scope week --week 1 --execute</code>
              </li>
              <li>
                <span className="font-semibold not-italic">Run stored-mode Week 1 test:</span>{" "}
                <code className="rounded bg-white/70 px-1 py-0.5">npx tsx scripts/run-week-1-starter-test.ts --phase full --data-mode stored --season 2025 --week 1</code>
              </li>
            </ol>
          </div>
          <div
            className="mt-3 rounded-lg bg-rose-50/70 p-2 ring-1 ring-coral-300/60"
            data-testid="do-not-judge-warning"
          >
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-coral-700">
              Do not judge model performance until realWeek1BacktestReady=true.
            </div>
            <p className="mt-1 text-[10px] text-coral-700">
              Fixture mode validates pipeline mechanics only. Any
              numbers it produces are not evidence of edge.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

function StoredGradedSection({
  snapshot,
  graded,
}: {
  snapshot: StoredWeek1MonitorSnapshot;
  graded: NonNullable<StoredWeek1MonitorSnapshot["graded"]>;
}) {
  const u = graded.universeDiagnostics;
  const sample = graded.gradedSample.slice(0, 30);
  return (
    <section className="rounded-2xl bg-white/70 p-5 ring-1 ring-white/40 backdrop-blur">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Real Stored Week 1 — Graded Results
        </h2>
        <span className="text-[10px] uppercase tracking-[0.14em] text-ink-500">
          Source · {snapshot.source} · graded {graded.gradedAt}
        </span>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Candidate Universe Diagnostics
          </h3>
          <span className="rounded-full bg-amber-100/80 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
            Model diagnostic only · not betting performance
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Cell label="Total candidates" value={`${u.totalCandidates}`} />
          <Cell label="With actual stat" value={`${u.candidatesWithActual}`} />
          <Cell label="Missing actual" value={`${u.candidatesMissingActual}`} />
          <Cell label="Pushed (line == actual)" value={`${u.candidatesPushed}`} />
          <Cell
            label="OVER directional"
            value={`${u.overSide.hitRatePct.toFixed(1)}%`}
            sub={`${u.overSide.wins}W · ${u.overSide.losses}L · ${u.overSide.unitsProfit.toFixed(2)} units`}
          />
          <Cell
            label="UNDER directional"
            value={`${u.underSide.hitRatePct.toFixed(1)}%`}
            sub={`${u.underSide.wins}W · ${u.underSide.losses}L · ${u.underSide.unitsProfit.toFixed(2)} units`}
          />
          <Cell label="Line-side better-paid" value={u.betterSide} />
          <Cell
            label="Passed / rejected"
            value={`${u.totalCandidates - graded.disqualificationBreakdown.totalRejected} / ${graded.disqualificationBreakdown.totalRejected}`}
          />
        </div>
      </div>

      {u.byPropType.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Per prop type (universe)
          </h3>
          <table className="mt-2 min-w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
                <th className="pb-1 pr-2">Prop type</th>
                <th className="pb-1 pr-2 text-right">Total</th>
                <th className="pb-1 pr-2 text-right">Decisive</th>
                <th className="pb-1 pr-2 text-right">OVER hit</th>
                <th className="pb-1 pr-2 text-right">UNDER hit</th>
                <th className="pb-1 pr-2 text-right">OVER ROI</th>
                <th className="pb-1 text-right">UNDER ROI</th>
              </tr>
            </thead>
            <tbody className="text-ink-800">
              {u.byPropType.map((b) => (
                <tr key={b.propType} className="border-t border-white/40">
                  <td className="py-1 pr-2">{b.propType}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{b.total}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{b.decisive}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {b.overSide.hitRatePct.toFixed(1)}%
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {b.underSide.hitRatePct.toFixed(1)}%
                  </td>
                  <td
                    className={
                      "py-1 pr-2 text-right tabular-nums " +
                      (b.overSide.roiPct >= 0 ? "text-sea-700" : "text-coral-700")
                    }
                  >
                    {b.overSide.roiPct.toFixed(1)}%
                  </td>
                  <td
                    className={
                      "py-1 text-right tabular-nums " +
                      (b.underSide.roiPct >= 0 ? "text-sea-700" : "text-coral-700")
                    }
                  >
                    {b.underSide.roiPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {u.byLineBucket.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Per line bucket (universe)
          </h3>
          <table className="mt-2 min-w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
                <th className="pb-1 pr-2">Bucket</th>
                <th className="pb-1 pr-2 text-right">Total</th>
                <th className="pb-1 pr-2 text-right">OVER hit</th>
                <th className="pb-1 pr-2 text-right">UNDER hit</th>
                <th className="pb-1 pr-2 text-right">OVER ROI</th>
                <th className="pb-1 text-right">UNDER ROI</th>
              </tr>
            </thead>
            <tbody className="text-ink-800">
              {u.byLineBucket.map((b) => (
                <tr key={b.label} className="border-t border-white/40">
                  <td className="py-1 pr-2">{b.label}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{b.total}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {b.overSide.hitRatePct.toFixed(1)}%
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">
                    {b.underSide.hitRatePct.toFixed(1)}%
                  </td>
                  <td
                    className={
                      "py-1 pr-2 text-right tabular-nums " +
                      (b.overSide.roiPct >= 0 ? "text-sea-700" : "text-coral-700")
                    }
                  >
                    {b.overSide.roiPct.toFixed(1)}%
                  </td>
                  <td
                    className={
                      "py-1 text-right tabular-nums " +
                      (b.underSide.roiPct >= 0 ? "text-sea-700" : "text-coral-700")
                    }
                  >
                    {b.underSide.roiPct.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Recommended Plays Performance
          </h3>
          <span
            className={
              graded.recommendedPlays.enabled
                ? "rounded-full bg-sea-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80"
                : "rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-300/80"
            }
          >
            {graded.recommendedPlays.enabled
              ? "Real betting performance"
              : "Not yet evaluated"}
          </span>
        </div>
        {graded.recommendedPlays.enabled ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Cell
              label="Plays"
              value={`${graded.recommendedPlays.count}`}
              sub={`${graded.recommendedPlays.wins}W · ${graded.recommendedPlays.losses}L · ${graded.recommendedPlays.pushes}P`}
            />
            <Cell
              label="Hit rate"
              value={`${graded.recommendedPlays.hitRatePct.toFixed(1)}%`}
            />
            <Cell
              label="ROI"
              value={`${graded.recommendedPlays.roiPct.toFixed(1)}%`}
              sub={`${graded.recommendedPlays.unitsProfit.toFixed(2)} units`}
            />
            <Cell
              label="Avg edge / confidence"
              value={`${graded.recommendedPlays.averageEdgePct.toFixed(1)}% / ${graded.recommendedPlays.averageConfidence.toFixed(2)}`}
            />
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-ink-100/50 p-3 text-[11px] text-ink-700">
            {graded.recommendedPlays.note}
          </p>
        )}
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Parlay Performance
          </h3>
          <span
            className={
              graded.parlayPerformance.enabled
                ? "rounded-full bg-sea-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-sea-900 ring-1 ring-sea-300/80"
                : "rounded-full bg-ink-200 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ink-700 ring-1 ring-ink-300/80"
            }
          >
            {graded.parlayPerformance.enabled
              ? "Real parlay performance"
              : "Not yet evaluated"}
          </span>
        </div>
        {graded.parlayPerformance.enabled ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <Cell
              label="Evaluated / Selected / Rejected"
              value={`${graded.parlayPerformance.evaluated} / ${graded.parlayPerformance.selected} / ${graded.parlayPerformance.rejected}`}
            />
            <Cell
              label="Selected hit rate"
              value={`${graded.parlayPerformance.selectedAggregate.hitRatePct.toFixed(1)}%`}
            />
            <Cell
              label="Selected ROI"
              value={`${graded.parlayPerformance.selectedAggregate.roiPct.toFixed(1)}%`}
              sub={`${graded.parlayPerformance.selectedAggregate.unitsProfit.toFixed(2)} units`}
            />
            <Cell
              label="Avg modeled / required"
              value={`${graded.parlayPerformance.selectedAggregate.averageModeledHitProbabilityPct.toFixed(1)}% / ${graded.parlayPerformance.selectedAggregate.averageRequiredHitProbabilityPct.toFixed(1)}%`}
            />
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-ink-100/50 p-3 text-[11px] text-ink-700">
            {graded.parlayPerformance.note}
          </p>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
          Disqualification breakdown
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
          {(
            [
              ["Edge too thin", graded.disqualificationBreakdown.edgeTooThin],
              ["Risk gate", graded.disqualificationBreakdown.riskGate],
              ["Role stability", graded.disqualificationBreakdown.roleStability],
              ["Missing result", graded.disqualificationBreakdown.missingResult],
              ["Ungradeable (push)", graded.disqualificationBreakdown.ungradeable],
              ["Other", graded.disqualificationBreakdown.other],
              ["Total rejected", graded.disqualificationBreakdown.totalRejected],
              [
                "Passed (universe − rejected)",
                u.totalCandidates - graded.disqualificationBreakdown.totalRejected,
              ],
            ] as const
          ).map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between rounded-lg bg-white/65 px-3 py-2 ring-1 ring-white/40"
            >
              <span className="text-ink-600">{label}</span>
              <span className="font-semibold tabular-nums text-ink-900">
                {value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {sample.length > 0 && (
        <div className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700">
            Individual graded candidates ({sample.length} of {graded.gradedSample.length})
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table className="min-w-full text-[11px]">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-ink-500">
                  <th className="pb-1 pr-2">Game</th>
                  <th className="pb-1 pr-2">Player · prop</th>
                  <th className="pb-1 pr-2 text-right">Line</th>
                  <th className="pb-1 pr-2 text-right">Actual</th>
                  <th className="pb-1 pr-2">OVER</th>
                  <th className="pb-1">UNDER</th>
                </tr>
              </thead>
              <tbody className="text-ink-800">
                {sample.map((row) => (
                  <tr key={row.candidateId} className="border-t border-white/40">
                    <td className="py-1 pr-2 text-[10px] tabular-nums">{row.gameId}</td>
                    <td className="py-1 pr-2">
                      {row.playerName} · {row.propType}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{row.line}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {row.actualValue ?? "—"}
                    </td>
                    <td
                      className={
                        "py-1 pr-2 " +
                        (row.overOutcome === "WIN"
                          ? "text-sea-700"
                          : row.overOutcome === "LOSS"
                            ? "text-coral-700"
                            : "text-ink-500")
                      }
                    >
                      {row.overOutcome}
                    </td>
                    <td
                      className={
                        "py-1 " +
                        (row.underOutcome === "WIN"
                          ? "text-sea-700"
                          : row.underOutcome === "LOSS"
                            ? "text-coral-700"
                            : "text-ink-500")
                      }
                    >
                      {row.underOutcome}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

function Cell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg bg-white/65 px-3 py-2 ring-1 ring-white/40">
      <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-ink-900">{value}</div>
      {sub ? <div className="text-[10px] text-ink-500">{sub}</div> : null}
    </div>
  );
}

function Footnote() {
  return (
    <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60 backdrop-blur">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900">
        Discipline reminders
      </div>
      <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-amber-900">
        <li>Fixture results are not proof of live edge.</li>
        <li>The backtest runner uses stored data only.</li>
        <li>No live betting automation is enabled anywhere.</li>
        <li>Touchdown props are out of scope for V1.</li>
      </ul>
    </section>
  );
}

/**
 * Merge a DB-backed stored snapshot into the file-shaped
 * `Week1DataModeStatus`. The DB row is authoritative when
 * available — it survives Railway redeploys that wipe the file
 * mirror. Returns whichever shape the existing DataSourceMode
 * panel already expects, so the page render is unchanged
 * downstream.
 */
function mergeStoredIntoDataModeStatus(
  fileStatus: Week1DataModeStatus | undefined,
  stored: StoredWeek1MonitorSnapshot | undefined,
): Week1DataModeStatus | undefined {
  if (!stored) return fileStatus;
  // DB wins. Reconstruct the file shape from the snapshot.
  const scheduleReport = stored.scheduleValidationStatus
    ? ({
        status: stored.scheduleValidationStatus,
        realWeek1BacktestReady: stored.realWeek1BacktestReady,
        syntheticFixture: stored.syntheticFixture,
      } as unknown as Week1DataModeStatus["scheduleReport"])
    : (fileStatus?.scheduleReport ?? null);
  return {
    generatedAt: stored.generatedAt ?? fileStatus?.generatedAt ?? new Date().toISOString(),
    season: 2025,
    week: 1,
    dataMode: "stored",
    status: stored.status,
    candidateCount: stored.candidateCount,
    syntheticFixture: stored.syntheticFixture,
    realWeek1BacktestReady: stored.realWeek1BacktestReady,
    missingStoredOdds: stored.missingStoredOdds,
    missingProcessedNfl: stored.missingProcessedNfl,
    scheduleReport,
    notes: stored.notes,
    nextSteps: fileStatus?.nextSteps ?? [],
  };
}
