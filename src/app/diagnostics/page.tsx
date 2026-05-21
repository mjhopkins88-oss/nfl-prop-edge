import fs from "node:fs";
import path from "node:path";
import { getDefaultAppContext } from "@/lib/app-context";

interface DeploymentManifest {
  generatedAt: string;
  gitCommit?: string;
  gitCommitShort?: string;
  gitBranch?: string;
  gitCommitTimestamp?: string;
  source: "git" | "env" | "unknown";
}

const WEEK_1_OUTPUT_FILES = [
  "week-1-pregame.fixture.json",
  "week-1-locked-pregame-recommendations.fixture.json",
  "week-1-data-audit.fixture.json",
  "week-1-odds-coverage.fixture.json",
  "week-1-nfl-data-coverage.fixture.json",
  "week-1-leakage-check.fixture.json",
  "week-1-results.fixture.json",
  "week-1-v1-v2-comparison.fixture.json",
  "week-1-parlay-preview.fixture.json",
  "week-1-game-edge-preview.fixture.json",
];

function loadManifest(): DeploymentManifest | undefined {
  const p = path.join(process.cwd(), "data", "deployment-manifest.json");
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as DeploymentManifest;
  } catch {
    return undefined;
  }
}

function envFlag(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v !== "";
}

function envSet(name: string): boolean {
  return envFlag(name);
}

export default function DiagnosticsPage() {
  const manifest = loadManifest();
  const context = getDefaultAppContext();

  const commit =
    process.env.NEXT_PUBLIC_DEPLOYMENT_COMMIT ??
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    manifest?.gitCommit;
  const branch =
    process.env.NEXT_PUBLIC_DEPLOYMENT_BRANCH ??
    process.env.RAILWAY_GIT_BRANCH ??
    process.env.GIT_BRANCH ??
    manifest?.gitBranch;
  const buildTimestamp =
    process.env.NEXT_PUBLIC_BUILD_TIMESTAMP ??
    manifest?.generatedAt;

  const week1Files = WEEK_1_OUTPUT_FILES.map((f) => ({
    file: f,
    bundled: fs.existsSync(
      path.join(process.cwd(), "data", "backtests", "2025", f),
    ),
  }));
  const allBundled = week1Files.every((f) => f.bundled);

  return (
    <div className="space-y-6">
      <section>
        <div className="inline-flex items-center gap-2 rounded-full bg-sea-50 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-sea-800 ring-1 ring-sea-200/80">
          Deployment diagnostics · safe to share
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
          Diagnostics
        </h1>
        <p className="mt-2 max-w-3xl text-sm text-ink-700">
          Read-only view of build / config state. No secret values are
          shown — only whether each env var is set. Use this page to
          confirm Railway is serving the latest <code>main</code>.
        </p>
      </section>

      <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Build / commit
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-ink-800 sm:grid-cols-2">
          <Row label="Commit" value={commit ?? "(unknown)"} mono />
          <Row label="Short" value={commit ? commit.slice(0, 7) : "(unknown)"} mono />
          <Row label="Branch" value={branch ?? "(unknown)"} mono />
          <Row
            label="Build timestamp"
            value={buildTimestamp ?? "(unknown)"}
            mono
          />
          <Row
            label="Commit timestamp"
            value={manifest?.gitCommitTimestamp ?? "(unknown)"}
            mono
          />
          <Row
            label="Manifest source"
            value={manifest?.source ?? "(none — no data/deployment-manifest.json)"}
          />
        </dl>
      </section>

      <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          App context defaults
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-ink-800 sm:grid-cols-2">
          <Row label="Season" value={`${context.season}`} mono />
          <Row label="Week" value={`${context.week}`} mono />
          <Row label="Data mode" value={context.dataMode} mono />
          <Row label="Header chip" value={context.label} />
        </dl>
      </section>

      <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
          Env config (presence only — no secret values)
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-xs text-ink-800 sm:grid-cols-2">
          <Row
            label="DATABASE_URL"
            value={envSet("DATABASE_URL") ? "set" : "not set"}
            ok={envSet("DATABASE_URL")}
          />
          <Row
            label="ODDS_API_KEY"
            value={envSet("ODDS_API_KEY") ? "set" : "not set"}
          />
          <Row
            label="WEATHER_API_KEY"
            value={envSet("WEATHER_API_KEY") ? "set" : "not set"}
          />
          <Row
            label="OPENWEATHER_API_KEY"
            value={envSet("OPENWEATHER_API_KEY") ? "set" : "not set"}
          />
          <Row
            label="ALLOW_REAL_ODDS_API_CALLS"
            value={
              process.env.ALLOW_REAL_ODDS_API_CALLS === "true"
                ? "true (BE CAREFUL)"
                : "false"
            }
            ok={process.env.ALLOW_REAL_ODDS_API_CALLS !== "true"}
          />
          <Row
            label="ALLOW_NFLVERSE_NETWORK_FETCH"
            value={
              process.env.ALLOW_NFLVERSE_NETWORK_FETCH === "true"
                ? "true"
                : "false"
            }
          />
        </dl>
      </section>

      <section className="glass-strong rounded-2xl p-5 ring-1 ring-white/40 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-ink-700">
            Week 1 output files (bundled in build)
          </h2>
          <span
            className={
              allBundled
                ? "rounded-full bg-sea-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sea-800 ring-1 ring-sea-200/70"
                : "rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-900 ring-1 ring-amber-200/70"
            }
          >
            {allBundled ? "All present" : "Missing files"}
          </span>
        </div>
        <ul className="mt-3 space-y-1 font-mono text-[11px] text-ink-800">
          {week1Files.map((f) => (
            <li key={f.file} className="flex items-center justify-between gap-3">
              <span className="truncate">{f.file}</span>
              <span
                className={
                  f.bundled
                    ? "text-sea-700"
                    : "text-coral-700"
                }
              >
                {f.bundled ? "✓ found" : "✗ missing"}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-ink-500">
          If any of these are missing the deployed{" "}
          <code className="font-mono text-[10px]">/backtest/week-1</code>{" "}
          page will fall back to its &ldquo;Run the starter test first&rdquo;
          message. Generate them locally with{" "}
          <code className="font-mono text-[10px]">
            npx tsx scripts/run-week-1-starter-test.ts --phase full --fixtures --season 2025 --week 1
          </code>
          .
        </p>
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  ok,
}: {
  label: string;
  value: string;
  mono?: boolean;
  ok?: boolean;
}) {
  const valueClass = mono ? "font-mono text-[11px]" : "";
  const tone =
    ok === undefined
      ? "text-ink-900"
      : ok
        ? "text-sea-700"
        : "text-coral-700";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/40 pb-1.5">
      <dt className="text-ink-600">{label}</dt>
      <dd className={`text-right ${valueClass} ${tone}`}>{value}</dd>
    </div>
  );
}
