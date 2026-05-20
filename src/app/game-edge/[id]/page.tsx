import Link from "next/link";
import { notFound } from "next/navigation";
import { GAME_EDGE_FIXTURES } from "@/lib/model/game-edge-data";
import { buildGameEdge } from "@/lib/model/game-edge-model";
import {
  formatAmericanOdds,
  formatEdgePp,
  formatProbability,
  formatSpread,
  recommendationLabelClasses,
  selectedMarketLabel,
  sideToTeam,
  upsetScoreClasses,
} from "@/lib/model/game-edge-scorecard";

export function generateStaticParams() {
  return GAME_EDGE_FIXTURES.map((f) => ({ id: f.gameId }));
}

export default async function GameEdgeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const fixture = GAME_EDGE_FIXTURES.find((f) => f.gameId === id);
  if (!fixture) notFound();
  const output = buildGameEdge(fixture);
  const sc = output.scorecard;
  const selectedTeam = sideToTeam(sc, output.selectedSide);

  return (
    <div className="space-y-8">
      <BackLink />
      <Header sc={sc} output={output} selectedTeam={selectedTeam} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Market baseline">
          <KV
            label="Home win probability (market)"
            value={formatProbability(sc.marketBaseline.homeWinProbability)}
          />
          <KV
            label="Away win probability (market)"
            value={formatProbability(sc.marketBaseline.awayWinProbability)}
          />
          <KV
            label="Home ML"
            value={formatAmericanOdds(sc.marketBaseline.homeMoneylineOdds)}
          />
          <KV
            label="Away ML"
            value={formatAmericanOdds(sc.marketBaseline.awayMoneylineOdds)}
          />
          <KV
            label={`${sc.homeTeam} spread`}
            value={formatSpread(sc.marketBaseline.homeSpread)}
          />
          <KV
            label={`${sc.awayTeam} spread`}
            value={formatSpread(sc.marketBaseline.awaySpread)}
          />
        </Card>

        <Card title="Model probability">
          <KV
            label={`${sc.homeTeam} win probability (model)`}
            value={formatProbability(sc.modelProbability.home)}
            tone={sc.modelProbability.home > sc.marketBaseline.homeWinProbability ? "play" : undefined}
          />
          <KV
            label={`${sc.awayTeam} win probability (model)`}
            value={formatProbability(sc.modelProbability.away)}
            tone={sc.modelProbability.away > sc.marketBaseline.awayWinProbability ? "play" : undefined}
          />
          <div className="my-3 border-t border-ink-100" />
          <KV label="Confidence" value={`${(output.confidence * 100).toFixed(0)}%`} />
          <KV label="Risk score" value={output.riskScore.toFixed(2)} />
          <KV
            label="Data quality"
            value={output.dataQualityScore.toFixed(2)}
            tone={output.dataQualityScore < 0.55 ? "warn" : undefined}
          />
        </Card>

        <Card title="Moneyline path">
          <KV
            label="Home edge"
            value={formatEdgePp(sc.moneyline.homeEdgePp)}
            sub={`Conf-adj ${formatEdgePp(sc.moneyline.confidenceAdjustedHomeEdgePp)}`}
            tone={sc.moneyline.homeEdgePp > 0 ? "play" : undefined}
          />
          <KV
            label="Away edge"
            value={formatEdgePp(sc.moneyline.awayEdgePp)}
            sub={`Conf-adj ${formatEdgePp(sc.moneyline.confidenceAdjustedAwayEdgePp)}`}
            tone={sc.moneyline.awayEdgePp > 0 ? "play" : undefined}
          />
        </Card>

        <Card title="Spread path">
          <KV
            label="Home cover probability"
            value={formatProbability(sc.spread.homeCoverProbability)}
            sub={`Edge ${formatEdgePp(sc.spread.homeEdgePp)} · conf-adj ${formatEdgePp(sc.spread.confidenceAdjustedHomeEdgePp)}`}
          />
          <KV
            label="Away cover probability"
            value={formatProbability(sc.spread.awayCoverProbability)}
            sub={`Edge ${formatEdgePp(sc.spread.awayEdgePp)} · conf-adj ${formatEdgePp(sc.spread.confidenceAdjustedAwayEdgePp)}`}
          />
          {sc.spread.keyNumberRisk && (
            <div className="mt-2 rounded-lg bg-amber-50/80 p-2 text-xs text-amber-900 ring-1 ring-amber-200/60">
              ⚠︎ Key-number risk near {sc.spread.keyNumber}. Half-point line
              moves change cover probability materially.
            </div>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Upset analysis">
          <div className="mb-3 flex items-center justify-between">
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ${upsetScoreClasses(sc.upset.score)}`}
            >
              Upset score {sc.upset.score.toFixed(0)} / 100
            </span>
            {sc.upset.underdogSide && (
              <span className="text-xs text-ink-600">
                Underdog: {sideToTeam(sc, sc.upset.underdogSide)}
              </span>
            )}
          </div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink-500">
            Factors
          </div>
          <ul className="mt-1 space-y-1 text-xs text-ink-700">
            {sc.upset.factors.length === 0 ? (
              <li className="text-ink-400">No notable upset factors.</li>
            ) : (
              sc.upset.factors.map((f) => <li key={f}>· {f}</li>)
            )}
          </ul>
          {sc.upset.risks.length > 0 && (
            <>
              <div className="mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-500">
                Penalties / risks
              </div>
              <ul className="mt-1 space-y-1 text-xs text-coral-700">
                {sc.upset.risks.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-3 text-[10px] uppercase tracking-[0.12em] text-ink-400">
            Descriptive — high score is not a buy signal
          </div>
        </Card>

        <Card title="Reasons & risks">
          <div className="text-[11px] uppercase tracking-[0.14em] text-ink-500">
            Reasons
          </div>
          <ul className="mt-1 space-y-1 text-xs text-ink-700">
            {sc.reasons.length === 0 ? (
              <li className="text-ink-400">No reasons surfaced.</li>
            ) : (
              sc.reasons.map((r) => <li key={r}>· {r}</li>)
            )}
          </ul>
          {sc.risks.length > 0 && (
            <>
              <div className="mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-500">
                Risks
              </div>
              <ul className="mt-1 space-y-1 text-xs text-coral-700">
                {sc.risks.map((r) => (
                  <li key={r}>· {r}</li>
                ))}
              </ul>
            </>
          )}
          {sc.disqualifiers.length > 0 && (
            <>
              <div className="mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-500">
                Disqualifiers
              </div>
              <ul className="mt-1 space-y-1 text-xs text-coral-700">
                {sc.disqualifiers.map((d) => (
                  <li key={d}>✖ {d}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card title="What would change the recommendation">
        <ul className="space-y-1 text-xs text-ink-700">
          {sc.whatWouldChange.length === 0 ? (
            <li className="text-ink-400">
              Current recommendation is stable for now.
            </li>
          ) : (
            sc.whatWouldChange.map((w) => <li key={w}>· {w}</li>)
          )}
        </ul>
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
      href="/game-edge"
      className="inline-flex items-center gap-2 text-xs font-medium text-ink-600 hover:text-ink-900"
    >
      ← Back to Game Edge
    </Link>
  );
}

function Header({
  sc,
  output,
  selectedTeam,
}: {
  sc: ReturnType<typeof buildGameEdge>["scorecard"];
  output: ReturnType<typeof buildGameEdge>;
  selectedTeam?: string;
}) {
  return (
    <section>
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Experimental Game Edge Model
      </div>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Week {sc.week} · {sc.season}
          </div>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
            {sc.awayTeam} @ {sc.homeTeam}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${recommendationLabelClasses(sc.recommendationLabel)}`}
          >
            {sc.recommendationLabel}
          </span>
          {output.recommendation !== "PASS" && (
            <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-medium text-ink-700 ring-1 ring-white/60">
              {selectedMarketLabel(output.recommendation)}
              {selectedTeam ? ` · ${selectedTeam}` : ""}
            </span>
          )}
        </div>
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
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
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
      <div className="text-right">
        <div className={`text-sm font-semibold ${valueClass}`}>{value}</div>
        {sub && <div className="text-[11px] text-ink-500">{sub}</div>}
      </div>
    </div>
  );
}

function DisclaimerFootnote() {
  return (
    <section className="rounded-2xl bg-amber-50/70 p-4 ring-1 ring-amber-200/60">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900">
        Experimental — separate from player prop model
      </div>
      <p className="mt-2 text-xs text-amber-900">
        This game-level model is an addition to the player prop scorecard,
        not a replacement. Backtest results are not yet available. Use for
        research only.
      </p>
    </section>
  );
}
