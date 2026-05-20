import Link from "next/link";
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
import type {
  GameEdgeOutput,
  GameRecommendationLabel,
} from "@/lib/model/game-edge-types";

interface EvaluatedGame {
  output: GameEdgeOutput;
  scenarioNote: string;
}

function evaluateAll(): EvaluatedGame[] {
  return GAME_EDGE_FIXTURES.map((fixture) => ({
    output: buildGameEdge(fixture),
    scenarioNote: fixture.scenarioNote,
  }));
}

type Tab =
  | "all"
  | "moneyline"
  | "spread"
  | "upset"
  | "pass";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All games" },
  { id: "moneyline", label: "Moneyline value" },
  { id: "spread", label: "Spread value" },
  { id: "upset", label: "Upset watch" },
  { id: "pass", label: "Pass" },
];

function applyTab(games: EvaluatedGame[], tab: Tab): EvaluatedGame[] {
  switch (tab) {
    case "all":
      return games;
    case "moneyline":
      return games.filter(
        (g) =>
          g.output.recommendation === "HOME_MONEYLINE" ||
          g.output.recommendation === "AWAY_MONEYLINE",
      );
    case "spread":
      return games.filter(
        (g) =>
          g.output.recommendation === "HOME_SPREAD" ||
          g.output.recommendation === "AWAY_SPREAD",
      );
    case "upset":
      return games.filter(
        (g) => g.output.recommendationLabel === "Upset Watch",
      );
    case "pass":
      return games.filter((g) => g.output.recommendation === "PASS");
  }
}

export default async function GameEdgePage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const tab: Tab = (TABS.find((t) => t.id === params.tab)?.id ?? "all") as Tab;
  const games = evaluateAll();
  const filtered = applyTab(games, tab);

  const counts = {
    total: games.length,
    moneyline: games.filter(
      (g) =>
        g.output.recommendation === "HOME_MONEYLINE" ||
        g.output.recommendation === "AWAY_MONEYLINE",
    ).length,
    spread: games.filter(
      (g) =>
        g.output.recommendation === "HOME_SPREAD" ||
        g.output.recommendation === "AWAY_SPREAD",
    ).length,
    upsetWatch: games.filter(
      (g) => g.output.recommendationLabel === "Upset Watch",
    ).length,
    pass: games.filter((g) => g.output.recommendation === "PASS").length,
  };

  return (
    <div className="space-y-8">
      <ExperimentalHero counts={counts} />
      <TabBar active={tab} counts={counts} />

      <section className="space-y-4">
        {filtered.length === 0 && (
          <div className="glass-strong rounded-2xl p-8 text-center text-sm text-ink-600">
            No games match this filter.
          </div>
        )}
        {filtered.map((g) => (
          <GameCard key={g.output.gameId} game={g} />
        ))}
      </section>

      <Footnote />
    </div>
  );
}

function ExperimentalHero({
  counts,
}: {
  counts: {
    total: number;
    moneyline: number;
    spread: number;
    upsetWatch: number;
    pass: number;
  };
}) {
  return (
    <section>
      <div className="inline-flex items-center gap-2 rounded-full bg-amber-100/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200/80 backdrop-blur">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Experimental — separate from player prop model
      </div>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">
        Experimental{" "}
        <span className="bg-gradient-to-r from-sea-600 via-sky2-500 to-amber-500 bg-clip-text text-transparent">
          Game Edge Model
        </span>
      </h1>
      <p className="mt-2 max-w-3xl text-sm text-ink-700">
        Game-level evaluation of moneyline and spread markets. Treats market
        win probability as the baseline, applies capped football-context
        adjustments, and reports confidence-adjusted edges plus an upset
        score (descriptive, not prescriptive). Independent of the player
        prop scorecard.
      </p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Games evaluated" value={`${counts.total}`} />
        <Stat label="Moneyline value" value={`${counts.moneyline}`} tone="play" />
        <Stat label="Spread value" value={`${counts.spread}`} tone="play" />
        <Stat label="Upset watch" value={`${counts.upsetWatch}`} tone="watch" />
        <Stat label="Pass" value={`${counts.pass}`} tone="pass" />
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "play" | "watch" | "pass";
}) {
  const ring =
    tone === "play"
      ? "ring-sea-200/70"
      : tone === "watch"
        ? "ring-gold-200/70"
        : tone === "pass"
          ? "ring-ink-200/60"
          : "ring-white/40";
  return (
    <div className={`glass rounded-2xl p-4 ring-1 ${ring}`}>
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink-900">{value}</div>
    </div>
  );
}

function TabBar({
  active,
  counts,
}: {
  active: Tab;
  counts: {
    total: number;
    moneyline: number;
    spread: number;
    upsetWatch: number;
    pass: number;
  };
}) {
  const countFor = (id: Tab) => {
    switch (id) {
      case "all":
        return counts.total;
      case "moneyline":
        return counts.moneyline;
      case "spread":
        return counts.spread;
      case "upset":
        return counts.upsetWatch;
      case "pass":
        return counts.pass;
    }
  };
  return (
    <div className="flex flex-wrap gap-2">
      {TABS.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.id === "all" ? "/game-edge" : `/game-edge?tab=${t.id}`}
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
              {countFor(t.id)}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function GameCard({ game }: { game: EvaluatedGame }) {
  const { output, scenarioNote } = game;
  const sc = output.scorecard;
  const label: GameRecommendationLabel = output.recommendationLabel;
  const selectedTeam = sideToTeam(sc, output.selectedSide);
  return (
    <Link
      href={`/game-edge/${output.gameId}`}
      className="glass-strong block rounded-2xl p-5 ring-1 ring-white/40 transition hover:ring-sea-300/60 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
            Week {sc.week} · {sc.season}
          </div>
          <h3 className="mt-0.5 text-xl font-semibold text-ink-900">
            {sc.awayTeam} @ {sc.homeTeam}
          </h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-semibold ring-1 ${recommendationLabelClasses(label)}`}
          >
            {label}
          </span>
          {output.recommendation !== "PASS" && (
            <span className="rounded-full bg-white/70 px-3 py-1 text-[11px] font-medium text-ink-700 ring-1 ring-white/60">
              {selectedMarketLabel(output.recommendation)}
              {selectedTeam ? ` · ${selectedTeam}` : ""}
            </span>
          )}
          <span
            className={`rounded-full px-3 py-1 text-[11px] font-medium ring-1 ${upsetScoreClasses(output.upsetScore)}`}
            title="Upset score is descriptive, not a buy signal"
          >
            Upset {output.upsetScore.toFixed(0)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric
          label="Market (home)"
          value={formatProbability(sc.marketBaseline.homeWinProbability)}
          sub={formatAmericanOdds(sc.marketBaseline.homeMoneylineOdds)}
        />
        <Metric
          label="Model (home)"
          value={formatProbability(sc.modelProbability.home)}
          sub={`Edge ${formatEdgePp(sc.moneyline.homeEdgePp)}`}
        />
        <Metric
          label="Spread"
          value={`${sc.homeTeam} ${formatSpread(sc.marketBaseline.homeSpread)}`}
          sub={`Cover ${formatProbability(sc.spread.homeCoverProbability)}`}
        />
        <Metric
          label="Confidence"
          value={`${(output.confidence * 100).toFixed(0)}%`}
          sub={`Risk ${output.riskScore.toFixed(2)} · DQ ${output.dataQualityScore.toFixed(2)}`}
        />
      </div>

      {output.reasons.length > 0 && (
        <div className="mt-4 space-y-1.5">
          {output.reasons.slice(0, 2).map((r) => (
            <div key={r} className="text-xs text-ink-700">
              · {r}
            </div>
          ))}
        </div>
      )}
      {output.risks.length > 0 && (
        <div className="mt-2 text-xs text-coral-700">
          ⚠︎ {output.risks[0]}
        </div>
      )}
      {output.disqualifiers.length > 0 && (
        <div className="mt-2 text-xs text-coral-700">
          ✖ {output.disqualifiers[0]}
        </div>
      )}
      <div className="mt-3 text-[11px] uppercase tracking-[0.12em] text-ink-400">
        {scenarioNote}
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
          · This is a SEPARATE model from the player prop scorecard. Player
          prop recommendations are unaffected.
        </div>
        <div>
          · Market win probability is the baseline. Football-context
          adjustments are capped, not multiplied freely.
        </div>
        <div>
          · Upset score is descriptive (0–100). A high upset score does NOT
          force a play — only confidence-adjusted edge clearing thresholds
          does.
        </div>
        <div>
          · Spread cover and moneyline value are evaluated independently —
          one can be a play while the other is a pass.
        </div>
        <div>
          · No real money. No automated betting. Backtest needed before any
          live use.
        </div>
      </div>
    </section>
  );
}
