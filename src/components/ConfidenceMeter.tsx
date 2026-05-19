import { confidenceLabel } from "@/lib/prop-utils";

export default function ConfidenceMeter({
  value,
  showLabel = true,
}: {
  value: number;
  showLabel?: boolean;
}) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-ink-700">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-edge-positive"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="tabular text-[11px] text-ink-400">{confidenceLabel(value)}</span>
      )}
    </div>
  );
}
