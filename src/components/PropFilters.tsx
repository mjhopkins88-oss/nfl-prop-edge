"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import clsx from "clsx";
import { PROP_TYPES, PROP_TYPE_SHORT } from "@/lib/prop-utils";

const POSITIONS = ["ALL", "QB", "RB", "WR", "TE"] as const;
const RECS = ["ALL", "OVER", "UNDER", "PASS"] as const;
const SORTS = [
  { value: "edge", label: "Top edge" },
  { value: "confidence", label: "Confidence" },
  { value: "player", label: "Player A-Z" },
] as const;

export default function PropFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();

  const current = {
    propType: params.get("propType") ?? "ALL",
    position: params.get("position") ?? "ALL",
    recommendation: params.get("recommendation") ?? "ALL",
    sort: params.get("sort") ?? "edge",
  };

  const updateParam = useCallback(
    (key: string, value: string) => {
      const next = new URLSearchParams(params.toString());
      if (!value || value === "ALL" || (key === "sort" && value === "edge")) {
        next.delete(key);
      } else {
        next.set(key, value);
      }
      const queryString = next.toString();
      const href = queryString ? `/?${queryString}` : "/";
      startTransition(() => {
        router.replace(href, { scroll: false });
      });
    },
    [params, router],
  );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ink-800 bg-ink-900/60 p-3 shadow-card">
      <FilterRow label="Prop type">
        <Chip active={current.propType === "ALL"} onClick={() => updateParam("propType", "ALL")}>
          All
        </Chip>
        {PROP_TYPES.map((pt) => (
          <Chip
            key={pt}
            active={current.propType === pt}
            onClick={() => updateParam("propType", pt)}
          >
            {PROP_TYPE_SHORT[pt]}
          </Chip>
        ))}
      </FilterRow>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
        <FilterRow label="Position">
          {POSITIONS.map((p) => (
            <Chip key={p} active={current.position === p} onClick={() => updateParam("position", p)}>
              {p === "ALL" ? "All" : p}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Side">
          {RECS.map((r) => (
            <Chip
              key={r}
              active={current.recommendation === r}
              onClick={() => updateParam("recommendation", r)}
            >
              {r === "ALL" ? "All" : r}
            </Chip>
          ))}
        </FilterRow>
        <FilterRow label="Sort">
          {SORTS.map((s) => (
            <Chip key={s.value} active={current.sort === s.value} onClick={() => updateParam("sort", s.value)}>
              {s.label}
            </Chip>
          ))}
        </FilterRow>
      </div>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-md border px-2.5 py-1 text-xs font-medium transition",
        active
          ? "border-accent bg-accent/15 text-white"
          : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
