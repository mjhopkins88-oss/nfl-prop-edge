import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-accent to-edge-positive text-sm font-bold text-ink-950">
            E
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold text-white">NFL Prop Edge</div>
            <div className="text-[11px] uppercase tracking-wider text-ink-400">
              Low-variance prop scanner
            </div>
          </div>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            href="/"
            className="rounded-md px-3 py-1.5 text-ink-400 transition hover:bg-ink-800 hover:text-white"
          >
            Dashboard
          </Link>
          <span className="rounded-md px-3 py-1.5 text-ink-500">Models</span>
          <span className="rounded-md px-3 py-1.5 text-ink-500">Books</span>
          <span className="ml-2 rounded-md border border-ink-700 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-400">
            Week 11 · 2025
          </span>
        </nav>
      </div>
    </header>
  );
}
