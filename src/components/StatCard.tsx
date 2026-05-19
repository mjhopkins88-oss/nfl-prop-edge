import type { ReactNode } from "react";
import clsx from "clsx";

export default function StatCard({
  label,
  value,
  hint,
  tone,
  icon,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "positive" | "neutral" | "negative";
  icon?: ReactNode;
  accent?: "amber" | "coral" | "teal" | "blue" | "gold";
}) {
  const valueTone =
    tone === "positive"
      ? "text-sea-700"
      : tone === "negative"
        ? "text-coral-600"
        : "text-ink-900";

  const accentRing = {
    amber: "from-amber-200/70 via-amber-50 to-transparent",
    coral: "from-coral-300/60 via-orange-50 to-transparent",
    teal: "from-sea-300/70 via-emerald-50 to-transparent",
    blue: "from-sky2-300/60 via-sky-50 to-transparent",
    gold: "from-gold-300/70 via-amber-50 to-transparent",
  }[accent ?? "amber"];

  return (
    <div className="glass relative overflow-hidden rounded-2xl p-4">
      <div
        className={clsx(
          "pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br blur-2xl opacity-80",
          accentRing,
        )}
      />
      <div className="relative flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-500">
          {label}
        </div>
        {icon && <div className="text-ink-500">{icon}</div>}
      </div>
      <div className={clsx("tabular relative mt-1.5 text-2xl font-semibold tracking-tight", valueTone)}>
        {value}
      </div>
      {hint && (
        <div className="relative mt-1 text-xs text-ink-600">{hint}</div>
      )}
    </div>
  );
}
