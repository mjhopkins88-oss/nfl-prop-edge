import clsx from "clsx";
import type { PropDecisionScorecard } from "@/lib/model/model-scorecard";
import {
  selectedEdge,
  selectedModelProbability,
  selectedNoVigProbability,
} from "@/lib/model/prop-opportunity";
import {
  formatAmericanOdds,
  formatEdge,
  PROP_TYPE_UNIT,
} from "@/lib/prop-utils";
import RecommendationPill from "./RecommendationPill";
import ConfidenceMeter from "./ConfidenceMeter";
import ScorecardBadges from "./ScorecardBadges";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const VOLATILITY_LABEL = {
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

const GATE_FOR_KEY = {
  dataQualityScore: 0.55,
  roleStabilityScore: 0.55,
  injuryContextScore: 0.55,
  correlationExposureScore: 0.5,
  weatherEnvironmentScore: 0.5,
  gameScriptScore: 0.45,
  paceScore: 0.45,
  marketContextScore: 0.45,
} as const;

type RiskKey = keyof typeof GATE_FOR_KEY;

const RISK_ROWS: Array<{ key: RiskKey; label: string }> = [
  { key: "roleStabilityScore", label: "Role stability" },
  { key: "injuryContextScore", label: "Injury context" },
  { key: "correlationExposureScore", label: "Correlation exposure" },
  { key: "weatherEnvironmentScore", label: "Weather / environment" },
  { key: "gameScriptScore", label: "Game script" },
  { key: "paceScore", label: "Pace" },
  { key: "marketContextScore", label: "Market context" },
];

export default function ScorecardDetailPanel({
  scorecard,
}: {
  scorecard: PropDecisionScorecard;
}) {
  const edge = selectedEdge(scorecard);
  const modelProb = selectedModelProbability(scorecard);
  const noVigProb = selectedNoVigProbability(scorecard);
  const unit = PROP_TYPE_UNIT[scorecard.propType];

  return (
    <section className="rounded-2xl border border-ink-800 bg-ink-900/60 p-6 shadow-card backdrop-blur">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wider text-ink-400">
            Model Decision Scorecard
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Selected side, edge math, gates, and final explanation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <RecommendationPill rec={scorecard.recommendation} size="lg" />
          <span
            className={clsx(
              "text-[11px] uppercase tracking-wider",
              scorecard.qualified ? "text-edge-positive" : "text-edge-negative",
            )}
          >
            {scorecard.qualified ? "Qualified" : "Not qualified"}
          </span>
        </div>
      </header>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cell label="Selected side" value={scorecard.selectedSide} />
        <Cell
          label="Confidence"
          value={`${(scorecard.confidence * 100).toFixed(0)}%`}
        >
          <div className="mt-1">
            <ConfidenceMeter value={scorecard.confidence} showLabel={false} />
          </div>
        </Cell>
        <Cell
          label="Volatility"
          value={VOLATILITY_LABEL[scorecard.volatilityLevel]}
          sub={`σ ${scorecard.projectedStdDev.toFixed(1)} on μ ${scorecard.projectedMean.toFixed(1)}`}
        />
        <Cell
          label="Composite risk"
          value={scorecard.riskScore.toFixed(2)}
          sub="0 worst · 1 best"
        />
      </div>

      <div className="mt-6">
        <SectionTitle>Probability and edge</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell label="Model OVER" value={pct(scorecard.modelOverProbability)} />
          <Cell label="Model UNDER" value={pct(scorecard.modelUnderProbability)} />
          <Cell
            label="No-vig OVER"
            value={pct(scorecard.noVigOverProbability)}
            sub={`Book ${formatAmericanOdds(scorecard.overOdds)}`}
          />
          <Cell
            label="No-vig UNDER"
            value={pct(scorecard.noVigUnderProbability)}
            sub={`Book ${formatAmericanOdds(scorecard.underOdds)}`}
          />
          <Cell
            label="Edge OVER"
            value={formatEdge(scorecard.edgeOver)}
            tone={
              scorecard.edgeOver >= scorecard.edgeThreshold
                ? "positive"
                : scorecard.edgeOver <= -0.02
                  ? "negative"
                  : "neutral"
            }
          />
          <Cell
            label="Edge UNDER"
            value={formatEdge(scorecard.edgeUnder)}
            tone={
              scorecard.edgeUnder >= scorecard.edgeThreshold
                ? "positive"
                : scorecard.edgeUnder <= -0.02
                  ? "negative"
                  : "neutral"
            }
          />
          <Cell
            label="Selected edge"
            value={formatEdge(edge)}
            sub={`Model ${pct(modelProb)} vs market ${pct(noVigProb)}`}
            tone={edge >= scorecard.edgeThreshold ? "positive" : "negative"}
          />
          <Cell
            label="Edge threshold"
            value={pct(scorecard.edgeThreshold)}
            sub="Required to qualify"
          />
        </div>
      </div>

      <div className="mt-6">
        <SectionTitle>Projection</SectionTitle>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell
            label="Projected mean"
            value={`${scorecard.projectedMean.toFixed(1)} ${unit}`}
          />
          <Cell
            label="Projected σ"
            value={`${scorecard.projectedStdDev.toFixed(1)} ${unit}`}
          />
          <Cell
            label="Market line"
            value={`${scorecard.marketLine.toFixed(1)} ${unit}`}
          />
          <Cell
            label="Mean vs line"
            value={`${scorecard.projectedMean - scorecard.marketLine >= 0 ? "+" : ""}${(scorecard.projectedMean - scorecard.marketLine).toFixed(1)} ${unit}`}
            tone={
              scorecard.projectedMean - scorecard.marketLine >= 0
                ? "positive"
                : "negative"
            }
          />
        </div>
      </div>

      <div className="mt-6">
        <SectionTitle>Risk / feature scores</SectionTitle>
        <div className="grid gap-2">
          <RiskRow
            label="Data quality"
            score={scorecard.dataQualityScore}
            gate={GATE_FOR_KEY.dataQualityScore}
            emphasize
          />
          {RISK_ROWS.map((r) => (
            <RiskRow
              key={r.key}
              label={r.label}
              score={scorecard[r.key]}
              gate={GATE_FOR_KEY[r.key]}
            />
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <ListPanel title="Pass reasons" items={scorecard.passReasons} tone="positive" />
        <ListPanel title="Fail reasons" items={scorecard.failReasons} tone="negative" />
        <ListPanel
          title="Disqualifiers"
          items={scorecard.disqualifiers}
          tone="negative"
          emptyLabel="None — all gates clear."
        />
      </div>

      <div className="mt-6 rounded-lg border border-ink-800 bg-ink-850 p-4">
        <div className="text-[11px] uppercase tracking-wider text-ink-400">
          Final explanation
        </div>
        <p className="mt-1 text-sm leading-relaxed text-white">
          {scorecard.finalExplanation}
        </p>
      </div>

      <div className="mt-4">
        <ScorecardBadges scorecard={scorecard} size="md" />
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-ink-400">
      {children}
    </div>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "neutral" | "negative";
  children?: React.ReactNode;
}) {
  const valueClass =
    tone === "positive"
      ? "text-edge-positive"
      : tone === "negative"
        ? "text-edge-negative"
        : "text-white";
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </div>
      <div className={clsx("tabular mt-1 text-base font-semibold", valueClass)}>
        {value}
      </div>
      {sub && <div className="tabular mt-0.5 text-[11px] text-ink-500">{sub}</div>}
      {children}
    </div>
  );
}

function RiskRow({
  label,
  score,
  gate,
  emphasize,
}: {
  label: string;
  score: number;
  gate: number;
  emphasize?: boolean;
}) {
  const passes = score >= gate;
  const warn = passes && score < 0.65;
  const tone = passes ? (warn ? "warning" : "positive") : "negative";
  const barColor =
    tone === "positive"
      ? "bg-edge-positive"
      : tone === "warning"
        ? "bg-amber-400"
        : "bg-edge-negative";
  const pctWidth = Math.max(0, Math.min(1, score)) * 100;
  const gatePos = Math.max(0, Math.min(1, gate)) * 100;
  return (
    <div
      className={clsx(
        "rounded-lg border bg-ink-850 px-3 py-2",
        emphasize ? "border-ink-700" : "border-ink-800",
      )}
    >
      <div className="flex items-baseline justify-between text-xs">
        <span className={clsx(emphasize ? "text-white" : "text-ink-300")}>
          {label}
        </span>
        <span className="flex items-center gap-2 text-[11px]">
          <span className="tabular text-white">{score.toFixed(2)}</span>
          <span className="text-ink-500">gate {gate.toFixed(2)}</span>
          <span
            className={clsx(
              "rounded px-1.5 py-px text-[10px] font-semibold uppercase",
              tone === "positive" && "bg-edge-positive/15 text-edge-positive",
              tone === "warning" && "bg-amber-400/15 text-amber-300",
              tone === "negative" && "bg-edge-negative/15 text-edge-negative",
            )}
          >
            {tone === "positive" ? "OK" : tone === "warning" ? "WARN" : "FAIL"}
          </span>
        </span>
      </div>
      <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-700">
        <div
          className={clsx("h-full rounded-full", barColor)}
          style={{ width: `${pctWidth}%` }}
        />
        <div
          className="absolute top-[-2px] h-2.5 w-px bg-white/60"
          style={{ left: `${gatePos}%` }}
          title={`Gate at ${gate.toFixed(2)}`}
        />
      </div>
    </div>
  );
}

function ListPanel({
  title,
  items,
  tone,
  emptyLabel,
}: {
  title: string;
  items: string[];
  tone: "positive" | "negative";
  emptyLabel?: string;
}) {
  const bulletColor =
    tone === "positive" ? "bg-edge-positive" : "bg-edge-negative";
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-3">
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-400">
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-ink-500">{emptyLabel ?? "—"}</div>
      ) : (
        <ul className="space-y-1.5 text-xs text-ink-300">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span
                className={clsx(
                  "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                  bulletColor,
                )}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
