import { getTeam } from "@/lib/mock-data";

export default function TeamBadge({
  abbr,
  size = "sm",
}: {
  abbr: string;
  size?: "sm" | "md" | "lg";
}) {
  const team = getTeam(abbr);
  const bg = team?.primary ?? "#272d3d";
  const fg = team?.secondary ?? "#ffffff";

  const sizing =
    size === "lg"
      ? "h-10 w-10 text-sm"
      : size === "md"
        ? "h-8 w-8 text-xs"
        : "h-6 w-6 text-[10px]";

  return (
    <div
      className={`flex ${sizing} shrink-0 items-center justify-center rounded font-bold uppercase tracking-tight`}
      style={{ backgroundColor: bg, color: fg }}
      title={team?.name ?? abbr}
    >
      {abbr}
    </div>
  );
}
