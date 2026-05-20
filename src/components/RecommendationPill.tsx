import clsx from "clsx";
import type { Recommendation } from "@/lib/types";
import { recommendationLabel } from "@/lib/prop-utils";
import { TrendUpIcon, TrendDownIcon, InfoIcon } from "./icons";

export default function RecommendationPill({
  rec,
  size = "md",
}: {
  rec: Recommendation;
  size?: "sm" | "md" | "lg";
}) {
  const styles =
    rec === "OVER"
      ? "bg-gradient-to-br from-sea-500 to-sea-600 text-white shadow-[0_6px_18px_-6px_rgba(13,148,136,0.55)] ring-1 ring-sea-700/40"
      : rec === "UNDER"
        ? "bg-gradient-to-br from-sky2-500 to-sky2-700 text-white shadow-[0_6px_18px_-6px_rgba(37,99,235,0.55)] ring-1 ring-sky2-700/40"
        : "bg-ink-100 text-ink-700 ring-1 ring-ink-300/70 shadow-sm";
  const sizeClass =
    size === "lg"
      ? "px-4 py-2 text-sm gap-2"
      : size === "sm"
        ? "px-2 py-0.5 text-[10px] gap-1"
        : "px-2.5 py-1 text-xs gap-1.5";
  const iconClass =
    size === "lg" ? "h-4 w-4" : size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <span
      className={clsx(
        "inline-flex items-center justify-center rounded-full font-bold uppercase tracking-wider",
        styles,
        sizeClass,
      )}
    >
      {rec === "OVER" && <TrendUpIcon className={iconClass} />}
      {rec === "UNDER" && <TrendDownIcon className={iconClass} />}
      {rec === "PASS" && <InfoIcon className={iconClass} />}
      {recommendationLabel(rec)}
    </span>
  );
}
