import clsx from "clsx";
import type { Recommendation } from "@/lib/types";
import { recommendationLabel } from "@/lib/prop-utils";

export default function RecommendationPill({
  rec,
  size = "md",
}: {
  rec: Recommendation;
  size?: "sm" | "md" | "lg";
}) {
  const colorClass =
    rec === "OVER"
      ? "bg-edge-positive text-ink-950"
      : rec === "UNDER"
        ? "bg-edge-negative text-white"
        : "bg-ink-700 text-ink-300";
  const sizeClass =
    size === "lg"
      ? "px-3 py-1.5 text-sm"
      : size === "sm"
        ? "px-1.5 py-0.5 text-[10px]"
        : "px-2 py-0.5 text-xs";
  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-md font-bold uppercase tracking-wide",
        colorClass,
        sizeClass,
      )}
    >
      {recommendationLabel(rec)}
    </span>
  );
}
