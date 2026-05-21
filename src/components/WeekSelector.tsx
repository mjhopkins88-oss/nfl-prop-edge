"use client";

/**
 * Week selector — a small client-side dropdown that lets the
 * operator filter the monitor / navigate the backtest detail
 * to a specific stored week (or "All").
 *
 * Two modes:
 *
 *   1. `mode="searchParam"` — updates the current page's URL
 *      with `?week=N` (or removes it for "All"). The host
 *      server component reads `searchParams.week` and renders
 *      accordingly.
 *
 *   2. `mode="route"` — navigates to a different route per
 *      week. The host supplies `routeFor(week)` (e.g.
 *      `(w) => w === 1 ? "/backtest/week-1" : "/backtest/weeks/" + w`).
 *
 * Either way, the component is purely a navigation aid. It
 * does NOT change any data; it does NOT trigger ingestion;
 * it does NOT modify thresholds.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useId } from "react";

export interface WeekSelectorOption {
  week: number;
  graded: boolean;
}

export type WeekSelectorMode = "searchParam" | "route";

interface CommonProps {
  /** Available stored weeks plus an "All" option. */
  options: WeekSelectorOption[];
  /** Current selection — undefined means the "All" option. */
  selectedWeek: number | undefined;
  /** Label rendered next to the dropdown. */
  label?: string;
  /** Hint text shown below the dropdown. */
  hint?: string;
  /** Extra class names applied to the wrapper section. */
  className?: string;
  /** Optional testid for assertions. */
  testid?: string;
}

interface SearchParamProps extends CommonProps {
  mode: "searchParam";
  /** Search-param key. Defaults to "week". */
  searchParamKey?: string;
}

interface RouteProps extends CommonProps {
  mode: "route";
  /** Map a week number to its route. Week === undefined → All. */
  routeFor: (week: number | undefined) => string;
}

type WeekSelectorProps = SearchParamProps | RouteProps;

export function WeekSelector(props: WeekSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const inputId = useId();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>): void {
    const raw = e.target.value;
    const week = raw === "all" ? undefined : Number(raw);
    if (props.mode === "searchParam") {
      const params = new URLSearchParams(searchParams.toString());
      const key = props.searchParamKey ?? "week";
      if (week === undefined) {
        params.delete(key);
      } else {
        params.set(key, String(week));
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    } else {
      router.push(props.routeFor(week));
    }
  }

  const value = props.selectedWeek === undefined ? "all" : String(props.selectedWeek);

  return (
    <section
      className={
        "flex flex-wrap items-baseline gap-3 rounded-2xl bg-white/65 p-3 ring-1 ring-white/40 " +
        (props.className ?? "")
      }
      data-testid={props.testid ?? "week-selector"}
    >
      <label
        htmlFor={inputId}
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-700"
      >
        {props.label ?? "View week"}
      </label>
      <select
        id={inputId}
        value={value}
        onChange={handleChange}
        className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-900 shadow-sm focus:border-sea-500 focus:outline-none focus:ring-2 focus:ring-sea-300"
      >
        <option value="all">All stored weeks · season aggregate</option>
        {props.options.map((o) => (
          <option key={o.week} value={String(o.week)}>
            Week {o.week} {o.graded ? "· graded" : "· pregame only"}
          </option>
        ))}
      </select>
      {props.hint ? (
        <span className="text-[10px] text-ink-500">{props.hint}</span>
      ) : null}
    </section>
  );
}
