export default function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "neutral" | "negative";
}) {
  const accent =
    tone === "positive"
      ? "text-edge-positive"
      : tone === "negative"
        ? "text-edge-negative"
        : "text-white";
  return (
    <div className="rounded-xl border border-ink-800 bg-ink-900/60 p-4 shadow-card">
      <div className="text-[11px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={`tabular mt-1 text-2xl font-semibold ${accent}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-400">{hint}</div>}
    </div>
  );
}
