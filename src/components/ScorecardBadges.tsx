import clsx from "clsx";
import type { PropDecisionScorecard } from "@/lib/model/model-scorecard";
import { selectedEdge } from "@/lib/model/prop-opportunity";

type BadgeTone = "positive" | "warning" | "negative";

interface Badge {
  label: string;
  tone: BadgeTone;
}

function collectBadges(scorecard: PropDecisionScorecard): Badge[] {
  const badges: Badge[] = [];
  if (scorecard.qualified) {
    badges.push({ label: "Qualified", tone: "positive" });
  }
  const edge = selectedEdge(scorecard);
  if (edge < scorecard.edgeThreshold) {
    badges.push({ label: "Edge Below Threshold", tone: "warning" });
  }
  if (scorecard.roleStabilityScore < 0.55) {
    badges.push({ label: "Role Risk", tone: "negative" });
  }
  if (scorecard.injuryContextScore < 0.55) {
    badges.push({ label: "Injury Risk", tone: "negative" });
  }
  if (scorecard.weatherEnvironmentScore < 0.5) {
    badges.push({ label: "Weather Risk", tone: "warning" });
  }
  if (scorecard.correlationExposureScore < 0.5) {
    badges.push({ label: "Correlation Risk", tone: "warning" });
  }
  if (scorecard.dataQualityScore < 0.55) {
    badges.push({ label: "Low Data Quality", tone: "negative" });
  }
  return badges;
}

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
        <BadgePill key={b.label} label={b.label} tone={b.tone} size={size} />
      ))}
    </div>
  );
}

function BadgePill({
  label,
  tone,
  size,
}: {
  label: string;
  tone: BadgeTone;
  size: "sm" | "md";
}) {
  const toneClass =
    tone === "positive"
      ? "bg-edge-positive/15 text-edge-positive ring-edge-positive/30"
      : tone === "warning"
        ? "bg-amber-400/15 text-amber-300 ring-amber-400/30"
        : "bg-edge-negative/15 text-edge-negative ring-edge-negative/30";
  const sizeClass =
    size === "md"
      ? "px-2.5 py-1 text-xs"
      : "px-2 py-0.5 text-[11px]";
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-md font-semibold uppercase tracking-wider ring-1",
        toneClass,
        sizeClass,
      )}
    >
      {label}
    </span>
  );
}
