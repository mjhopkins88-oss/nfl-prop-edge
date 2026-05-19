import clsx from "clsx";
import { edgeTone, formatEdge } from "@/lib/prop-utils";
import { TrendUpIcon, TrendDownIcon } from "./icons";

export default function EdgeBadge({
  edge,
  size = "md",
  showIcon = false,
}: {
  edge: number;
  size?: "sm" | "md" | "lg";
  showIcon?: boolean;
}) {
  const tone = edgeTone(edge);
  const styles =
    tone === "positive"
      ? "bg-sea-50 text-sea-700 ring-sea-300/60 bg-gradient-to-br from-sea-50 via-emerald-50 to-white"
      : tone === "negative"
        ? "bg-rose-50 text-coral-700 ring-coral-300/60 bg-gradient-to-br from-rose-50 via-orange-50 to-white"
        : "bg-cream-100 text-ink-700 ring-ink-200/70";
  const sizeClass =
    size === "lg"
      ? "px-3 py-1.5 text-base"
      : size === "sm"
        ? "px-1.5 py-0.5 text-[11px]"
        : "px-2 py-0.5 text-xs";
  const iconClass =
    size === "lg" ? "h-4 w-4" : size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  return (
    <span
      className={clsx(
        "tabular inline-flex items-center gap-1 rounded-lg font-semibold ring-1",
        styles,
        sizeClass,
      )}
    >
      {showIcon &&
        (edge >= 0 ? (
          <TrendUpIcon className={iconClass} />
        ) : (
          <TrendDownIcon className={iconClass} />
        ))}
      {formatEdge(edge)}
    </span>
  );
}
