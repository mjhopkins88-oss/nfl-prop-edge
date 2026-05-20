import Link from "next/link";
import clsx from "clsx";
import {
  PROP_TYPE_LABEL,
  PROP_TYPE_UNIT,
  edgeTone,
  formatAmericanOdds,
  formatEdge,
  formatLine,
  formatProjection,
} from "@/lib/prop-utils";
import {
  selectedEdge,
  selectedModelProbability,
  selectedNoVigProbability,
  selectedSideOdds,
  type PropOpportunity,
} from "@/lib/model/prop-opportunity";
import {
  getPrimaryDisqualifier,
  getTopReasons,
  getTopRisks,
} from "@/lib/model/model-scorecard";
import TeamBadge from "./TeamBadge";
import RecommendationPill from "./RecommendationPill";
import ConfidenceMeter from "./ConfidenceMeter";
import ScorecardBadges from "./ScorecardBadges";

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function OpportunityCard({
  opportunity,
}: {
  opportunity: PropOpportunity;
}) {
  const { prop, player, team, opponent, game, scorecard } = opportunity;
  const isHome = game.homeTeamAbbr === player.teamAbbr;
  const unit = PROP_TYPE_UNIT[prop.propType];
  const edge = selectedEdge(scorecard);
  const modelProb = selectedModelProbability(scorecard);
  const noVigProb = selectedNoVigProbability(scorecard);
  const sideOdds = selectedSideOdds(prop, scorecard);
  const primaryDisq = getPrimaryDisqualifier(scorecard);
  const topReasons = getTopReasons(scorecard, 2);
  const topRisks = getTopRisks(scorecard, 2);

  return (
    <article className="rounded-2xl border border-ink-800 bg-ink-900/60 p-5 shadow-card backdrop-blur transition hover:border-ink-700">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <Link
          href={`/props/${prop.id}`}
          className="group flex items-start gap-3"
        >
          <TeamBadge abbr={player.teamAbbr} size="md" />
          <div className="leading-tight">
            <div className="text-[11px] uppercase tracking-wider text-ink-400">
              {player.position} · {team.city} {team.name}
              <span className="mx-1.5 text-ink-600">·</span>
              <span>{isHome ? "vs" : "@"}</span>{" "}
              <span className="text-ink-300">{opponent.abbreviation}</span>
              <span className="mx-1.5 text-ink-600">·</span>
              Week {game.week}
            </div>
            <div className="mt-0.5 text-base font-semibold text-white group-hover:text-accent">
              {player.fullName}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-300">
              <span className="text-white">
                {PROP_TYPE_LABEL[prop.propType]}
              </span>
              <span className="text-ink-600">·</span>
              <span className="tabular text-white">
                {formatLine(prop.line)} {unit}
              </span>
              <span className="text-ink-600">·</span>
              <span className="tabular text-ink-400">
                O {formatAmericanOdds(prop.overOdds)} / U{" "}
                {formatAmericanOdds(prop.underOdds)}
              </span>
              <span className="text-ink-600">·</span>
              <span className="text-ink-500">{prop.sportsbook}</span>
            </div>
          </div>
        </Link>

        <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
          <RecommendationPill rec={scorecard.recommendation} size="lg" />
          <span
            className={clsx(
              "text-[11px] uppercase tracking-wider",
              scorecard.qualified ? "text-edge-positive" : "text-ink-500",
            )}
          >
            {scorecard.qualified ? "Qualified" : "Not qualified"}
          </span>
        </div>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Model prob" value={pct(modelProb)} sub={scorecard.selectedSide} />
        <Metric
          label="Market (no-vig)"
          value={pct(noVigProb)}
          sub={`${formatAmericanOdds(sideOdds)}`}
        />
        <Metric
          label="Edge"
          value={formatEdge(edge)}
          tone={edgeTone(edge)}
          sub={`Threshold ${pct(scorecard.edgeThreshold)}`}
        />
        <div className="rounded-lg border border-ink-800 bg-ink-850 p-3">
          <div className="text-[11px] uppercase tracking-wider text-ink-400">
            Confidence
          </div>
          <div className="mt-1.5">
            <ConfidenceMeter value={scorecard.confidence} />
          </div>
          <div className="mt-1 text-[11px] text-ink-500">
            Projection {formatProjection(prop.projection, prop.propType)} ±{" "}
            {prop.projectionStdDev.toFixed(1)} {unit}
          </div>
        </div>
      </div>

      <div className="mt-3">
        {scorecard.qualified ? (
          <div className="flex items-center gap-1.5 text-xs text-edge-positive">
            <Check />
            Edge clears threshold and all risk gates pass.
          </div>
        ) : (
          <div className="flex items-start gap-1.5 text-xs text-edge-negative">
            <Cross />
            <span>
              <span className="font-semibold">PASS — </span>
              {primaryDisq ?? "No qualifying edge."}
            </span>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Panel title={scorecard.qualified ? "Top reasons" : "Top fail reasons"}>
          {topReasons.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-ink-300">
              {topReasons.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span
                    className={clsx(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      scorecard.qualified ? "bg-edge-positive" : "bg-edge-negative",
                    )}
                  />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-ink-500">—</div>
          )}
        </Panel>
        <Panel title="Top risks">
          {topRisks.length > 0 ? (
            <ul className="space-y-1.5 text-xs text-ink-300">
              {topRisks.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-ink-500">
              No risk gates flagged.
            </div>
          )}
        </Panel>
      </div>

      <p className="mt-4 border-t border-ink-800 pt-3 text-xs leading-relaxed text-ink-400">
        <span className="font-semibold text-ink-300">Final explanation: </span>
        {scorecard.finalExplanation}
      </p>

      <div className="mt-3 flex items-center justify-between gap-3">
        <ScorecardBadges scorecard={scorecard} />
        <Link
          href={`/props/${prop.id}`}
          className="shrink-0 text-[11px] uppercase tracking-wider text-accent transition hover:text-white"
        >
          Open scorecard →
        </Link>
      </div>
    </article>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "positive" | "neutral" | "negative";
}) {
  const valueClass =
    tone === "positive"
      ? "text-edge-positive"
      : tone === "negative"
        ? "text-edge-negative"
        : "text-white";
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={clsx("tabular mt-1 text-base font-semibold", valueClass)}>
        {value}
      </div>
      {sub && <div className="tabular mt-0.5 text-[11px] text-ink-500">{sub}</div>}
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 p-3">
      <div className="mb-1.5 text-[11px] uppercase tracking-wider text-ink-400">
        {title}
      </div>
      {children}
    </div>
  );
}

function Check() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="mt-0.5 shrink-0"
      aria-hidden
    >
      <path
        d="M3 8.5L6.5 12L13 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cross() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      className="mt-0.5 shrink-0"
      aria-hidden
    >
      <path
        d="M4 4L12 12M12 4L4 12"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

