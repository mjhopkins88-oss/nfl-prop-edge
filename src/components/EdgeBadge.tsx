import clsx from "clsx";
import { edgeTone, formatEdge } from "@/lib/prop-utils";

export default function EdgeBadge({
  edge,
  size = "md",
}: {
  edge: number;
  size?: "sm" | "md" | "lg";
}) {
  const tone = edgeTone(edge);
  const colorClass =
    tone === "positive"
      ? "bg-edge-positive/15 text-edge-positive ring-edge-positive/30"
      : tone === "negative"
        ? "bg-edge-negative/15 text-edge-negative ring-edge-negative/30"
        : "bg-ink-700 text-ink-400 ring-ink-600";
  const sizeClass =
    size === "lg"
      ? "px-3 py-1.5 text-base"
      : size === "sm"
        ? "px-1.5 py-0.5 text-[11px]"
        : "px-2 py-0.5 text-xs";
  return (
    <span
      className={clsx(
        "tabular inline-flex items-center justify-center rounded-md font-semibold ring-1",
        colorClass,
        sizeClass,
      )}
    >
      {formatEdge(edge)}
    </span>
  );
}
