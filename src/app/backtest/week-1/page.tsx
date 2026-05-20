import Link from "next/link";
import {
  loadWeek1GameEdgePreview,
  loadWeek1ParlayPreview,
  loadWeek1Pregame,
  loadWeek1Results,
  loadWeek1V1V2Comparison,
} from "@/lib/backtest/week-1-summary";

export default function Week1StarterTestPage() {
  const pregame = loadWeek1Pregame();
  const results = loadWeek1Results();
  const comparison = loadWeek1V1V2Comparison();
  const parlays = loadWeek1ParlayPreview();
  const gameEdge = loadWeek1GameEdgePreview();
  const hasOutput = Boolean(pregame || results);

  return (
    <div className="space-y-8">
      <Hero />
      {!hasOutput && <RunHint />}
      <PregameInputs />
      {pregame && <PregameCandidates pregame={pregame} />}
      {results && <ResultsSection results={results} />}
      {comparison && <V1V2Section comparison={comparison} />}
      {parlays && <ParlaySection parlays={parlays} />}
      {gameEdge && <GameEdgeSection gameEdge={gameEdge} />}
      <Footnote />
    </div>
  );
}

function Hero() {
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
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
        Week 1 2025 Starter Test
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
}: {
  results: NonNullable<ReturnType<typeof loadWeek1Results>>;
}) {
  return (
    <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
        Graded Week 1 results
      </h2>
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
