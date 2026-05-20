import Link from "next/link";
import { LogoMark } from "./icons";

interface NavItem {
  href: string;
  label: string;
  experimental?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Player Props" },
  { href: "/game-edge", label: "Game Edge", experimental: true },
  { href: "/parlays", label: "Parlay Builder", experimental: true },
  { href: "/backtest", label: "Backtest" },
];

export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/40 bg-white/55 backdrop-blur-lg supports-[backdrop-filter]:bg-white/45">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <LogoMark className="h-9 w-9 drop-shadow-sm" />
          <div className="leading-tight">
            <div className="text-base font-semibold tracking-tight text-ink-900">
              NFL Prop Edge
            </div>
            <div className="text-[11px] uppercase tracking-[0.14em] text-ink-500">
              Props · Game Edge · Parlays · Backtest
            </div>
          </div>
        </Link>

        <nav
          aria-label="Primary"
          className="flex flex-wrap items-center justify-end gap-1 text-sm"
        >
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-ink-700 transition hover:bg-white/70 hover:text-ink-900"
            >
              {item.label}
              {item.experimental && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-amber-900 ring-1 ring-amber-200/80">
                  Beta
                </span>
              )}
            </Link>
          ))}
          <span className="ml-2 hidden items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-100 via-orange-100 to-rose-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-amber-900 ring-1 ring-amber-200 sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            Week 11 · 2025
          </span>
        </nav>
      </div>
    </header>
  );
}
