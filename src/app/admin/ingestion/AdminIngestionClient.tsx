"use client";

/**
 * Interactive admin client. Stores the admin token in component
 * state only — never in localStorage, never echoed to the
 * server in URL params. Each action sends the token via the
 * x-admin-ingest-token header.
 */

import { useCallback, useEffect, useState } from "react";

type ActionName =
  | "readiness-check"
  | "run-nflverse-ingestion"
  | "dry-run"
  | "paid-smoke"
  | "odds-week1-subset-paid"
  | "paid-week1"
  | "migrate-odds-to-canonical"
  | "stored-backtest"
  | "grade-week1-stored"
  | "verify-persistence";

interface StatusResponse {
  ok: boolean;
  configuration?: {
    oddsApiKeyConfigured: boolean;
    adminTokenConfigured: boolean;
    allowRealOddsApiCalls: boolean;
  };
  data?: {
    processedNflDataPresent: boolean;
    storedWeek1OddsPresent: boolean;
    storedWeek1OddsLegacyPresent: boolean;
    storedWeek1OddsCanonicalPresent: boolean;
    realWeek1BacktestReady: boolean;
    readinessStatus: string;
    missingFiles: string[];
    nextCommandRequiresPaidApi: boolean;
  };
  state?: {
    lastAction: string | null;
    lastResult: string | null;
    lastTimestamp: string | null;
    lastSummary: string | null;
    smokeSucceededAt: string | null;
    smokeCreditsUsed: number | null;
    week1IngestionSucceededAt: string | null;
    lastPaidSmokeAttemptAt: string | null;
    lastPaidSmokeResult: "success" | "failure" | null;
    lastPaidSmokeCreditsUsed: number | null;
    lastPaidSmokeReason: string | null;
  };
  calibration?: {
    perMarketEstimatedRate?: number;
    perMarketObservedRate?: number | null;
    firstOddsCallActualCost?: number | null;
    creditsUsedActual?: number;
    creditsRemaining?: number | null;
    finishedAt?: string;
  } | null;
  nextRecommendedAction?: string;
  guardrails?: {
    starterMarketsOnly: string[];
  };
  error?: string;
}

interface ActionResponse {
  action: ActionName;
  ok: boolean;
  status: "success" | "failure" | "skipped";
  summary: string;
  detail?: string;
  data?: Record<string, unknown>;
  reason?: string;
  creditsUsed?: number;
  creditsRemaining?: number | null;
}

const PAID_SMOKE_CONFIRM = "RUN PAID SMOKE TEST";
const PAID_WEEK1_SUBSET_CONFIRM = "RUN WEEK 1 SUBSET INGESTION";
const PAID_WEEK1_CONFIRM = "RUN FULL WEEK 1 INGESTION 647 CREDITS";
const FULL_WEEK1_ESTIMATED_CREDITS = 647;
const STANDARD_RUN_CAP = 200;
const FULL_WEEK1_ELEVATED_CAP = 700;

export function AdminIngestionClient() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [statusErr, setStatusErr] = useState<string | null>(null);
  const [paidSmokeConfirm, setPaidSmokeConfirm] = useState("");
  const [paidWeek1SubsetConfirm, setPaidWeek1SubsetConfirm] = useState("");
  const [paidWeek1Confirm, setPaidWeek1Confirm] = useState("");
  const [busy, setBusy] = useState<ActionName | null>(null);
  const [lastResult, setLastResult] = useState<ActionResponse | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!token) {
      setStatus(null);
      setStatusErr("Enter the admin token to load status.");
      return;
    }
    setStatusErr(null);
    try {
      const res = await fetch("/api/admin/ingestion/status", {
        method: "GET",
        headers: { "x-admin-ingest-token": token },
        cache: "no-store",
      });
      const json = (await res.json()) as StatusResponse;
      if (!res.ok || !json.ok) {
        setStatus(null);
        setStatusErr(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setStatus(json);
    } catch (err) {
      setStatus(null);
      setStatusErr((err as Error).message);
    }
  }, [token]);

  useEffect(() => {
    if (token) void refreshStatus();
  }, [token, refreshStatus]);

  const runAction = useCallback(
    async (action: ActionName, confirmText?: string) => {
      if (!token) {
        setStatusErr("Enter the admin token first.");
        return;
      }
      setBusy(action);
      setLastResult(null);
      try {
        const res = await fetch("/api/admin/ingestion/run", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-admin-ingest-token": token,
          },
          body: JSON.stringify({ action, confirmText }),
        });
        const json = (await res.json()) as ActionResponse;
        setLastResult(json);
        await refreshStatus();
      } catch (err) {
        setLastResult({
          action,
          ok: false,
          status: "failure",
          summary: `Network error: ${(err as Error).message}`,
        });
      } finally {
        setBusy(null);
      }
    },
    [token, refreshStatus],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
          Admin token
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Stored in this tab only. Sent as the x-admin-ingest-token
          header. Never persisted, never logged.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ADMIN_INGEST_TOKEN"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600"
          />
          <button
            onClick={() => void refreshStatus()}
            className="rounded bg-zinc-700 px-3 py-2 text-sm text-zinc-100 hover:bg-zinc-600"
          >
            Load status
          </button>
        </div>
        {statusErr ? (
          <p className="mt-2 text-xs text-coral-400">{statusErr}</p>
        ) : null}
      </section>

      {status?.ok ? <StatusPanel status={status} /> : null}

      <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
          Actions
        </h2>
        <div className="mt-3 grid gap-3">
          <ActionRow
            label="1. Check readiness"
            description="Reads files + reports. No network."
            disabled={!token || busy !== null}
            busy={busy === "readiness-check"}
            onRun={() => void runAction("readiness-check")}
          />
          <ActionRow
            label="2. Run free nflverse ingestion"
            description="Downloads public nflverse data and writes processed NFL files. No Odds API call."
            buttonLabel="Run NFL ingestion"
            disabled={!token || busy !== null}
            busy={busy === "run-nflverse-ingestion"}
            onRun={() => void runAction("run-nflverse-ingestion")}
          />
          <ActionRow
            label="3. Run smoke calibration dry-run"
            description="One event-list call + one event odds call estimate. No API call."
            disabled={!token || busy !== null}
            busy={busy === "dry-run"}
            onRun={() => void runAction("dry-run")}
          />
          {status?.state?.lastPaidSmokeResult === "failure" &&
          status.state.lastPaidSmokeCreditsUsed ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              ⚠ Last paid smoke used{" "}
              <span className="font-semibold">
                {status.state.lastPaidSmokeCreditsUsed} credits
              </span>{" "}
              before aborting. The next retry uses calibration mode
              (1 events-list + 1 event-odds call, 50-credit cap).
              {status.state.lastPaidSmokeReason ? (
                <p className="mt-1 text-amber-300/80">
                  {status.state.lastPaidSmokeReason}
                </p>
              ) : null}
            </div>
          ) : null}
          <PaidActionRow
            label="4. Run paid smoke test (calibration)"
            description="1 events + 1 odds call, 50-credit hard cap. Requires ALLOW_REAL_ODDS_API_CALLS=true and confirmation text."
            confirmExpected={PAID_SMOKE_CONFIRM}
            confirmValue={paidSmokeConfirm}
            onConfirmChange={setPaidSmokeConfirm}
            disabled={
              !token ||
              busy !== null ||
              !status?.configuration?.allowRealOddsApiCalls ||
              !status?.configuration?.oddsApiKeyConfigured
            }
            busy={busy === "paid-smoke"}
            onRun={() => void runAction("paid-smoke", paidSmokeConfirm)}
          />
          <PaidActionRow
            label="5. Run paid Week 1 subset ingestion"
            description="Limited subset under 200 credits (≤4 event-odds calls, 175-credit cap). Requires paid smoke success."
            confirmExpected={PAID_WEEK1_SUBSET_CONFIRM}
            confirmValue={paidWeek1SubsetConfirm}
            onConfirmChange={setPaidWeek1SubsetConfirm}
            disabled={
              !token ||
              busy !== null ||
              !status?.configuration?.allowRealOddsApiCalls ||
              !status?.configuration?.oddsApiKeyConfigured ||
              !status?.state?.smokeSucceededAt
            }
            busy={busy === "odds-week1-subset-paid"}
            onRun={() =>
              void runAction(
                "odds-week1-subset-paid",
                paidWeek1SubsetConfirm,
              )
            }
          />
          <PaidActionRow
            label="6. Run paid full Week 1 ingestion"
            description={`Estimated ~${FULL_WEEK1_ESTIMATED_CREDITS} credits. Hard cap raised to ${FULL_WEEK1_ELEVATED_CAP}. Requires exact high-cost confirmation.`}
            confirmExpected={PAID_WEEK1_CONFIRM}
            confirmValue={paidWeek1Confirm}
            onConfirmChange={setPaidWeek1Confirm}
            disabled={
              !token ||
              busy !== null ||
              !status?.configuration?.allowRealOddsApiCalls ||
              !status?.configuration?.oddsApiKeyConfigured ||
              !status?.state?.smokeSucceededAt
            }
            busy={busy === "paid-week1"}
            onRun={() => void runAction("paid-week1", paidWeek1Confirm)}
          />
          {status?.data?.storedWeek1OddsLegacyPresent &&
          !status?.data?.storedWeek1OddsCanonicalPresent ? (
            <div className="rounded border border-amber-700/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              Legacy <code>data/processed/prop_markets.csv</code> is
              present but canonical{" "}
              <code>data/processed/odds/2025/week-1-prop-markets.csv</code>{" "}
              is missing. Stored mode reads the canonical file. Run
              the migration below to copy + enrich (no API call).
            </div>
          ) : null}
          <ActionRow
            label="7. Migrate legacy odds → canonical Week 1 file"
            description="Joins legacy prop_markets.csv + prop_quotes.csv against games.csv + rosters.csv. No API call."
            buttonLabel="Migrate"
            disabled={!token || busy !== null}
            busy={busy === "migrate-odds-to-canonical"}
            onRun={() => void runAction("migrate-odds-to-canonical")}
          />
          <ActionRow
            label="8. Run Week 1 stored backtest"
            description="Pregame snapshot from stored data. No API call."
            disabled={!token || busy !== null}
            busy={busy === "stored-backtest"}
            onRun={() => void runAction("stored-backtest")}
          />
          <ActionRow
            label="9. Grade Week 1 stored backtest"
            description="Grades existing stored pregame candidates using processed nflverse results. No API call."
            buttonLabel="Grade"
            disabled={!token || busy !== null}
            busy={busy === "grade-week1-stored"}
            onRun={() => void runAction("grade-week1-stored")}
          />
          <ActionRow
            label="10. Verify persisted Week 1 data"
            description="Pings Postgres, counts StoredPropMarket / StoredBacktestRun / OddsIngestionRun rows, reports whether canonical file can be rehydrated from DB. No API call."
            buttonLabel="Verify"
            disabled={!token || busy !== null}
            busy={busy === "verify-persistence"}
            onRun={() => void runAction("verify-persistence")}
          />
        </div>
      </section>

      {lastResult ? <ResultPanel result={lastResult} /> : null}
    </div>
  );
}

function StatusPanel({ status }: { status: StatusResponse }) {
  const cfg = status.configuration;
  const data = status.data;
  const state = status.state;
  return (
    <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
        Status
      </h2>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
        <StatusItem
          label="ODDS_API_KEY"
          value={Boolean(cfg?.oddsApiKeyConfigured)}
        />
        <StatusItem
          label="ADMIN_INGEST_TOKEN"
          value={Boolean(cfg?.adminTokenConfigured)}
        />
        <StatusItem
          label="ALLOW_REAL_ODDS_API_CALLS"
          value={Boolean(cfg?.allowRealOddsApiCalls)}
        />
        <StatusItem
          label="Processed NFL data"
          value={Boolean(data?.processedNflDataPresent)}
        />
        <StatusItem
          label="Stored Week 1 odds"
          value={Boolean(data?.storedWeek1OddsPresent)}
          hint={
            data?.storedWeek1OddsLegacyPresent
              ? "Legacy prop_markets.csv present"
              : undefined
          }
        />
        <StatusItem
          label="realWeek1BacktestReady"
          value={Boolean(data?.realWeek1BacktestReady)}
        />
      </dl>
      <div className="mt-4 grid gap-1 text-xs text-zinc-400">
        <p>
          <span className="text-zinc-500">Readiness status:</span>{" "}
          <span className="text-zinc-200">{data?.readinessStatus ?? "?"}</span>
        </p>
        <p>
          <span className="text-zinc-500">Smoke success:</span>{" "}
          <span className="text-zinc-200">
            {state?.smokeSucceededAt ?? "never"}
            {state?.smokeCreditsUsed != null
              ? ` (used ${state.smokeCreditsUsed} credits)`
              : ""}
          </span>
        </p>
        <p>
          <span className="text-zinc-500">Week 1 ingestion success:</span>{" "}
          <span className="text-zinc-200">
            {state?.week1IngestionSucceededAt ?? "never"}
          </span>
        </p>
        <p>
          <span className="text-zinc-500">Last action:</span>{" "}
          <span className="text-zinc-200">
            {state?.lastAction ?? "none"}
            {state?.lastResult ? ` — ${state.lastResult}` : ""}
            {state?.lastTimestamp ? ` @ ${state.lastTimestamp}` : ""}
          </span>
        </p>
        {state?.lastSummary ? (
          <p className="text-zinc-300">{state.lastSummary}</p>
        ) : null}
        {status.nextRecommendedAction ? (
          <p className="mt-2 rounded bg-zinc-800 p-2 text-zinc-200">
            <span className="text-zinc-500">Next: </span>
            {status.nextRecommendedAction}
          </p>
        ) : null}
        <p className="mt-2 text-[11px] text-zinc-500">
          Estimated full Week 1 cost:{" "}
          <span className="text-zinc-300">
            {FULL_WEEK1_ESTIMATED_CREDITS} credits
          </span>{" "}
          · current standard cap:{" "}
          <span className="text-zinc-300">{STANDARD_RUN_CAP}</span>{" "}
          · full ingestion requires elevated cap (
          <span className="text-zinc-300">{FULL_WEEK1_ELEVATED_CAP}</span>) and
          exact confirmation.
        </p>
      </div>
    </section>
  );
}

function StatusItem({
  label,
  value,
  hint,
}: {
  label: string;
  value: boolean;
  hint?: string;
}) {
  return (
    <div className="flex flex-col rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <span className="text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span
        className={`text-sm font-semibold ${
          value ? "text-emerald-300" : "text-coral-400"
        }`}
      >
        {value ? "yes" : "no"}
      </span>
      {hint ? <span className="mt-0.5 text-[10px] text-zinc-500">{hint}</span> : null}
    </div>
  );
}

function ActionRow({
  label,
  description,
  disabled,
  busy,
  onRun,
  buttonLabel = "Run",
}: {
  label: string;
  description: string;
  disabled: boolean;
  busy: boolean;
  onRun: () => void;
  buttonLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950 px-3 py-2 md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm text-zinc-200">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <button
        onClick={onRun}
        disabled={disabled}
        className="rounded bg-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:bg-zinc-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Running…" : buttonLabel}
      </button>
    </div>
  );
}

function PaidActionRow({
  label,
  description,
  confirmExpected,
  confirmValue,
  onConfirmChange,
  disabled,
  busy,
  onRun,
}: {
  label: string;
  description: string;
  confirmExpected: string;
  confirmValue: string;
  onConfirmChange: (v: string) => void;
  disabled: boolean;
  busy: boolean;
  onRun: () => void;
}) {
  const matches = confirmValue === confirmExpected;
  return (
    <div className="rounded border border-coral-700/40 bg-zinc-950 px-3 py-3">
      <p className="text-sm text-coral-400">{label}</p>
      <p className="text-xs text-zinc-500">{description}</p>
      <p className="mt-2 text-xs text-zinc-400">
        Type exactly:{" "}
        <code className="rounded bg-zinc-900 px-1 text-coral-400">
          {confirmExpected}
        </code>
      </p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          value={confirmValue}
          onChange={(e) => onConfirmChange(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100"
        />
        <button
          onClick={onRun}
          disabled={disabled || !matches}
          className="rounded bg-coral-600 px-3 py-1.5 text-sm font-semibold text-zinc-50 hover:bg-coral-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Running…" : "Run paid"}
        </button>
      </div>
    </div>
  );
}

function ResultPanel({ result }: { result: ActionResponse }) {
  return (
    <section className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-300">
        Latest action result
      </h2>
      <p
        className={`mt-2 text-sm ${
          result.status === "success"
            ? "text-emerald-300"
            : result.status === "skipped"
              ? "text-amber-300"
              : "text-coral-400"
        }`}
      >
        {result.action} — {result.status}
      </p>
      <p className="mt-1 text-sm text-zinc-200">{result.summary}</p>
      {result.reason ? (
        <p className="mt-1 text-xs text-zinc-400">{result.reason}</p>
      ) : null}
      {result.creditsUsed != null ? (
        <p className="mt-1 text-xs text-zinc-500">
          Credits used: {result.creditsUsed}
          {result.creditsRemaining != null
            ? ` · remaining: ${result.creditsRemaining}`
            : ""}
        </p>
      ) : null}
      {result.detail ? (
        <pre className="mt-3 max-h-72 overflow-auto rounded bg-zinc-950 p-3 text-[11px] leading-snug text-zinc-300">
          {result.detail}
        </pre>
      ) : null}
    </section>
  );
}
