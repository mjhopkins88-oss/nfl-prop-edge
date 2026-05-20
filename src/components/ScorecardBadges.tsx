import clsx from "clsx";
import type { PropDecisionScorecard } from "@/lib/model/model-scorecard";
import { selectedEdge } from "@/lib/model/prop-opportunity";

type BadgePalette =
  | "teal"
  | "amber"
  | "coral"
  | "blue"
  | "purple"
  | "orange"
  | "neutral";

interface Badge {
  label: string;
  palette: BadgePalette;
}

function collectBadges(scorecard: PropDecisionScorecard): Badge[] {
  const badges: Badge[] = [];
  if (scorecard.qualified) {
    badges.push({ label: "Qualified", palette: "teal" });
  }
  const edge = selectedEdge(scorecard);
  if (edge < scorecard.edgeThreshold) {
    badges.push({ label: "Edge Below Threshold", palette: "amber" });
  }
  if (scorecard.roleStabilityScore < 0.55) {
    badges.push({ label: "Role Risk", palette: "amber" });
  }
  if (scorecard.injuryContextScore < 0.55) {
    badges.push({ label: "Injury Risk", palette: "coral" });
  }
  if (scorecard.weatherEnvironmentScore < 0.5) {
    badges.push({ label: "Weather Risk", palette: "blue" });
  }
  if (scorecard.correlationExposureScore < 0.5) {
    badges.push({ label: "Correlation Risk", palette: "orange" });
  }
  if (scorecard.dataQualityScore < 0.55) {
    badges.push({ label: "Low Data Quality", palette: "coral" });
  }
  const coachingPenalty =
    scorecard.coachingTransition?.scores.coachingUncertaintyPenalty ?? 0;
  if (coachingPenalty >= 40) {
    badges.push({ label: "Coaching Uncertainty", palette: "purple" });
  }
  return badges;
}

const PALETTE: Record<BadgePalette, string> = {
  teal: "bg-sea-50 text-sea-800 ring-sea-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  coral: "bg-rose-50 text-coral-700 ring-coral-200/70",
  blue: "bg-sky-50 text-sky2-700 ring-sky2-200",
  purple: "bg-purple-50 text-purple-700 ring-purple-200",
  orange: "bg-orange-50 text-orange-700 ring-orange-200",
  neutral: "bg-ink-100/80 text-ink-700 ring-ink-200/70",
};

export default function ScorecardBadges({
  scorecard,
  size = "sm",
}: {
  scorecard: PropDecisionScorecard;
  size?: "sm" | "md";
}) {
  const badges = collectBadges(scorecard);
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <BadgePill
          key={b.label}
          label={b.label}
          palette={b.palette}
          size={size}
        />
      ))}
    </div>
  );
}

function BadgePill({
  label,
  palette,
  size,
}: {
  label: string;
  palette: BadgePalette;
  size: "sm" | "md";
}) {
  const sizeClass =
    size === "md"
      ? "px-2.5 py-1 text-xs"
      : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full font-semibold uppercase tracking-[0.08em] ring-1",
        PALETTE[palette],
        sizeClass,
      )}
    >
      {label}
    </span>
  );
}
