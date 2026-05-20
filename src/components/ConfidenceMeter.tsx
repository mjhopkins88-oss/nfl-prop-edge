import { confidenceLabel } from "@/lib/prop-utils";

export default function ConfidenceMeter({
  value,
  showLabel = true,
  width = "narrow",
}: {
  value: number;
  showLabel?: boolean;
  width?: "narrow" | "wide";
}) {
  const pct = Math.round(value * 100);
  const tier = confidenceLabel(value);
  const gradient =
    tier === "High"
      ? "from-sea-400 to-sea-600"
      : tier === "Medium"
        ? "from-gold-400 to-amber-500"
        : "from-rose-300 to-coral-500";
  const widthClass = width === "wide" ? "w-28" : "w-16";

  return (
    <div className="flex items-center gap-2">
      <div className={`${widthClass} h-1.5 overflow-hidden rounded-full bg-ink-200/60`}>
        <div
          className={`h-full rounded-full bg-gradient-to-r ${gradient}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="tabular text-[11px] font-medium text-ink-600">
          {tier} · {pct}%
        </span>
      )}
    </div>
  );
}
