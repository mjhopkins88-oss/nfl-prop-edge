import { getTeamByAbbr } from "@/lib/data/players";

export default function TeamBadge({
  abbr,
  size = "sm",
}: {
  abbr: string;
  size?: "sm" | "md" | "lg";
}) {
  const team = getTeamByAbbr(abbr);
  const bg = team?.primary ?? "#776f68";
  const fg = team?.secondary ?? "#ffffff";

  const sizing =
    size === "lg"
      ? "h-12 w-12 text-base"
      : size === "md"
        ? "h-9 w-9 text-xs"
        : "h-6 w-6 text-[10px]";

  return (
    <div
      className={`flex ${sizing} shrink-0 items-center justify-center rounded-xl font-bold uppercase tracking-tight ring-1 ring-black/5 shadow-sm`}
      style={{
        background: `linear-gradient(135deg, ${bg} 0%, ${shade(bg, -12)} 100%)`,
        color: fg,
      }}
      title={team?.name ?? abbr}
    >
      {abbr}
    </div>
  );
}

function shade(hex: string, percent: number): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const num = parseInt(c, 16);
  const amt = Math.round(2.55 * percent);
  const r = Math.max(0, Math.min(255, (num >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (num & 0xff) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
