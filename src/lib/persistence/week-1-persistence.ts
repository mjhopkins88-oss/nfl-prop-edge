/**
 * Persistence layer for paid Week 1 ingestion data.
 *
 * Railway's web-service filesystem is ephemeral — anything
 * written under the working directory at runtime vanishes on
 * the next build or restart. This module mirrors the
 * expensive runtime-generated data into Postgres (via Prisma)
 * so a redeploy doesn't force a paid re-ingestion. See
 * `RUNTIME_DATA_PERSISTENCE_AUDIT.md` for the rationale.
 *
 * Every method returns `{ ok, … }`. Failures are reported but
 * never thrown — the caller falls back to the file cache.
 *
 * No paid API calls. No secrets persisted (no DATABASE_URL,
 * ODDS_API_KEY, ADMIN_INGEST_TOKEN — only the values needed
 * to reconstruct the ingestion result). No model logic.
 */

import type { CanonicalPropRow } from "../ingestion/canonical-odds-writer";

// ---- public types ----------------------------------------------------

export interface PersistenceCallResult {
  ok: boolean;
  error?: string;
  /** Echo of the source ("postgres" / "stub"), so the diag
   *  UI can show where data was loaded from. */
  source?: "postgres" | "stub";
}

export interface OddsRunRecord {
  season: number;
  week?: number | null;
  scope: string;
  status: string;
  startedAt: string;
  finishedAt?: string | null;
  creditsEstimated?: number | null;
  creditsUsed?: number | null;
  creditsRemaining?: number | null;
  marketsRequested?: number | null;
  gamesRequested?: number | null;
  errorMessage?: string | null;
  rawResultJson?: Record<string, unknown> | null;
}

export interface AdminStateRecord {
  smokeSucceededAt?: string | null;
  smokeCreditsUsed?: number | null;
  week1IngestionSucceededAt?: string | null;
  week1SubsetSucceededAt?: string | null;
  week1SubsetCreditsUsed?: number | null;
  lastAction?: string | null;
  lastResultJson?: Record<string, unknown> | null;
  lastTimestamp?: string | null;
  lastSummary?: string | null;
}

export interface StoredBacktestRecord {
  season: number;
  week: number;
  dataMode: string;
  status: string;
  realWeek1BacktestReady: boolean;
  scheduleValidationStatus?: string | null;
  syntheticFixture: boolean;
  candidatesJson?: Record<string, unknown> | null;
  resultsJson?: Record<string, unknown> | null;
  v1v2Json?: Record<string, unknown> | null;
  parlayJson?: Record<string, unknown> | null;
  gameEdgeJson?: Record<string, unknown> | null;
}

export interface PersistenceClient {
  isAvailable(): boolean;

  saveCanonicalOddsRowsToDb(args: {
    season: number;
    week: number;
    rows: CanonicalPropRow[];
  }): Promise<PersistenceCallResult & { upserted?: number }>;

  /** Force-delete every stored odds row for (season, week)
   *  before a fresh migration so stale gameIds / team values
   *  from an earlier (buggy) ingestion cannot survive. */
  deleteCanonicalOddsRowsForWeek(args: {
    season: number;
    week: number;
  }): Promise<PersistenceCallResult & { deleted?: number }>;

  loadCanonicalOddsRowsFromDb(args: {
    season: number;
    week: number;
  }): Promise<PersistenceCallResult & { rows: CanonicalPropRow[] }>;

  saveAdminIngestionStateToDb(
    state: AdminStateRecord,
  ): Promise<PersistenceCallResult>;

  loadAdminIngestionStateFromDb(): Promise<
    PersistenceCallResult & { state?: AdminStateRecord }
  >;

  saveOddsIngestionRunToDb(
    run: OddsRunRecord,
  ): Promise<PersistenceCallResult & { id?: string }>;

  loadLatestOddsIngestionRunFromDb(args: {
    season: number;
    week?: number;
  }): Promise<PersistenceCallResult & { run?: OddsRunRecord }>;

  saveStoredBacktestRunToDb(
    run: StoredBacktestRecord,
  ): Promise<PersistenceCallResult & { id?: string }>;

  loadLatestStoredBacktestRunFromDb(args: {
    season: number;
    week: number;
  }): Promise<PersistenceCallResult & { run?: StoredBacktestRecord }>;
}

// ---- "no DB configured" client ---------------------------------------

const NOT_AVAILABLE: PersistenceCallResult = {
  ok: false,
  error: "DATABASE_URL not configured — persistence layer disabled",
};

export function nullPersistenceClient(): PersistenceClient {
  return {
    isAvailable: () => false,
    async saveCanonicalOddsRowsToDb() {
      return { ...NOT_AVAILABLE };
    },
    async deleteCanonicalOddsRowsForWeek() {
      return { ...NOT_AVAILABLE };
    },
    async loadCanonicalOddsRowsFromDb() {
      return { ...NOT_AVAILABLE, rows: [] };
    },
    async saveAdminIngestionStateToDb() {
      return { ...NOT_AVAILABLE };
    },
    async loadAdminIngestionStateFromDb() {
      return { ...NOT_AVAILABLE };
    },
    async saveOddsIngestionRunToDb() {
      return { ...NOT_AVAILABLE };
    },
    async loadLatestOddsIngestionRunFromDb() {
      return { ...NOT_AVAILABLE };
    },
    async saveStoredBacktestRunToDb() {
      return { ...NOT_AVAILABLE };
    },
    async loadLatestStoredBacktestRunFromDb() {
      return { ...NOT_AVAILABLE };
    },
  };
}

// ---- in-memory stub (for tests) --------------------------------------

interface StubStore {
  oddsRows: Map<string, CanonicalPropRow>;
  adminState?: AdminStateRecord;
  oddsRuns: OddsRunRecord[];
  backtestRuns: StoredBacktestRecord[];
}

/**
 * In-process persistence used by the test suite. No Prisma, no
 * network. Behaves like a tiny Postgres replica: upsert dedupes
 * on (season, week, marketKey, sportsbook, snapshotTime),
 * admin state is a singleton, runs are append-only.
 */
export function inMemoryPersistenceClient(): PersistenceClient & {
  __store: StubStore;
} {
  const store: StubStore = {
    oddsRows: new Map(),
    oddsRuns: [],
    backtestRuns: [],
  };
  const ok = (extra: Record<string, unknown> = {}): PersistenceCallResult => ({
    ok: true,
    source: "stub",
    ...extra,
  });
  const keyOf = (r: CanonicalPropRow): string =>
    [r.season, r.week, r.marketKey, r.sportsbook, r.snapshotTime ?? ""].join("|");
  return {
    __store: store,
    isAvailable: () => true,
    async saveCanonicalOddsRowsToDb(args) {
      for (const row of args.rows) store.oddsRows.set(keyOf(row), row);
      return ok({ upserted: args.rows.length }) as PersistenceCallResult & {
        upserted: number;
      };
    },
    async deleteCanonicalOddsRowsForWeek(args) {
      let deleted = 0;
      for (const [key, row] of store.oddsRows) {
        if (row.season === args.season && row.week === args.week) {
          store.oddsRows.delete(key);
          deleted += 1;
        }
      }
      return ok({ deleted }) as PersistenceCallResult & { deleted: number };
    },
    async loadCanonicalOddsRowsFromDb(args) {
      const rows = [...store.oddsRows.values()].filter(
        (r) => r.season === args.season && r.week === args.week,
      );
      return { ...ok(), rows };
    },
    async saveAdminIngestionStateToDb(state) {
      store.adminState = { ...store.adminState, ...state };
      return ok();
    },
    async loadAdminIngestionStateFromDb() {
      return { ...ok(), state: store.adminState };
    },
    async saveOddsIngestionRunToDb(run) {
      store.oddsRuns.push(run);
      return { ...ok(), id: `stub-${store.oddsRuns.length}` };
    },
    async loadLatestOddsIngestionRunFromDb(args) {
      const hits = store.oddsRuns.filter(
        (r) =>
          r.season === args.season &&
          (args.week === undefined || r.week === args.week),
      );
      return { ...ok(), run: hits[hits.length - 1] };
    },
    async saveStoredBacktestRunToDb(run) {
      store.backtestRuns.push(run);
      return { ...ok(), id: `stub-${store.backtestRuns.length}` };
    },
    async loadLatestStoredBacktestRunFromDb(args) {
      const hits = store.backtestRuns.filter(
        (r) => r.season === args.season && r.week === args.week,
      );
      return { ...ok(), run: hits[hits.length - 1] };
    },
  };
}

// ---- Prisma adapter --------------------------------------------------

interface PrismaLike {
  storedPropMarket: {
    upsert: (args: {
      where: Record<string, unknown>;
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => Promise<unknown>;
    findMany: (args: {
      where: Record<string, unknown>;
      orderBy?: unknown;
    }) => Promise<Record<string, unknown>[]>;
    deleteMany: (args: {
      where: Record<string, unknown>;
    }) => Promise<{ count: number }>;
  };
  adminIngestionState: {
    upsert: (args: {
      where: { id: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }) => Promise<unknown>;
    findUnique: (args: {
      where: { id: string };
    }) => Promise<Record<string, unknown> | null>;
  };
  oddsIngestionRun: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy?: unknown;
    }) => Promise<Record<string, unknown> | null>;
  };
  storedBacktestRun: {
    create: (args: { data: Record<string, unknown> }) => Promise<{ id: string }>;
    findFirst: (args: {
      where: Record<string, unknown>;
      orderBy?: unknown;
    }) => Promise<Record<string, unknown> | null>;
  };
  $disconnect: () => Promise<void>;
}

const okPg = (extra: Record<string, unknown> = {}): PersistenceCallResult => ({
  ok: true,
  source: "postgres",
  ...extra,
});

function fail(err: unknown): PersistenceCallResult {
  return {
    ok: false,
    source: "postgres",
    error: (err as Error).message ?? String(err),
  };
}

/**
 * Build a persistence client backed by an already-instantiated
 * Prisma client. Splitting client construction out lets the
 * caller share one Prisma instance across requests and lets
 * tests inject any object that satisfies `PrismaLike`.
 */
export function prismaPersistenceClient(prisma: PrismaLike): PersistenceClient {
  return {
    isAvailable: () => true,
    async saveCanonicalOddsRowsToDb(args) {
      let upserted = 0;
      try {
        for (const row of args.rows) {
          await prisma.storedPropMarket.upsert({
            where: {
              season_week_marketKey_sportsbook_snapshotTime: {
                season: row.season,
                week: row.week,
                marketKey: row.marketKey,
                sportsbook: row.sportsbook,
                snapshotTime: row.snapshotTime ?? "",
              },
            },
            create: {
              season: row.season,
              week: row.week,
              gameId: row.gameId,
              marketKey: row.marketKey,
              playerName: row.playerName,
              team: row.team,
              opponent: row.opponent,
              propType: row.propType,
              line: row.line,
              sportsbook: row.sportsbook,
              overOdds: row.overOdds,
              underOdds: row.underOdds,
              snapshotTime: row.snapshotTime ?? "",
              isBeforeKickoff: true,
            },
            update: {
              gameId: row.gameId,
              playerName: row.playerName,
              team: row.team,
              opponent: row.opponent,
              propType: row.propType,
              line: row.line,
              overOdds: row.overOdds,
              underOdds: row.underOdds,
            },
          });
          upserted += 1;
        }
        return okPg({ upserted }) as PersistenceCallResult & {
          upserted: number;
        };
      } catch (err) {
        return { ...fail(err), upserted } as PersistenceCallResult & {
          upserted: number;
        };
      }
    },
    async deleteCanonicalOddsRowsForWeek(args) {
      try {
        const res = await prisma.storedPropMarket.deleteMany({
          where: { season: args.season, week: args.week },
        });
        return { ...okPg(), deleted: res.count } as PersistenceCallResult & {
          deleted: number;
        };
      } catch (err) {
        return { ...fail(err), deleted: 0 } as PersistenceCallResult & {
          deleted: number;
        };
      }
    },
    async loadCanonicalOddsRowsFromDb(args) {
      try {
        const dbRows = await prisma.storedPropMarket.findMany({
          where: { season: args.season, week: args.week },
          orderBy: { createdAt: "asc" },
        });
        const rows: CanonicalPropRow[] = dbRows.map((r) => ({
          season: r.season as number,
          week: r.week as number,
          gameId: String(r.gameId),
          kickoffTime: String(r.snapshotTime ?? ""),
          sportsbook: String(r.sportsbook),
          playerName: String(r.playerName),
          team: String(r.team),
          opponent: String(r.opponent),
          marketKey: String(r.marketKey),
          propType: String(r.propType),
          line: Number(r.line),
          overOdds: Number(r.overOdds),
          underOdds: Number(r.underOdds),
          snapshotTime: String(r.snapshotTime ?? ""),
        }));
        return { ...okPg(), rows };
      } catch (err) {
        return { ...fail(err), rows: [] };
      }
    },
    async saveAdminIngestionStateToDb(state) {
      try {
        await prisma.adminIngestionState.upsert({
          where: { id: "singleton" },
          create: {
            id: "singleton",
            smokeSucceededAt: state.smokeSucceededAt
              ? new Date(state.smokeSucceededAt)
              : null,
            smokeCreditsUsed: state.smokeCreditsUsed ?? null,
            week1IngestionSucceededAt: state.week1IngestionSucceededAt
              ? new Date(state.week1IngestionSucceededAt)
              : null,
            week1SubsetSucceededAt: state.week1SubsetSucceededAt
              ? new Date(state.week1SubsetSucceededAt)
              : null,
            week1SubsetCreditsUsed: state.week1SubsetCreditsUsed ?? null,
            lastAction: state.lastAction ?? null,
            lastResultJson: state.lastResultJson ?? undefined,
            lastTimestamp: state.lastTimestamp
              ? new Date(state.lastTimestamp)
              : null,
            lastSummary: state.lastSummary ?? null,
          },
          update: {
            smokeSucceededAt: state.smokeSucceededAt
              ? new Date(state.smokeSucceededAt)
              : undefined,
            smokeCreditsUsed: state.smokeCreditsUsed ?? undefined,
            week1IngestionSucceededAt: state.week1IngestionSucceededAt
              ? new Date(state.week1IngestionSucceededAt)
              : undefined,
            week1SubsetSucceededAt: state.week1SubsetSucceededAt
              ? new Date(state.week1SubsetSucceededAt)
              : undefined,
            week1SubsetCreditsUsed: state.week1SubsetCreditsUsed ?? undefined,
            lastAction: state.lastAction ?? undefined,
            lastResultJson: state.lastResultJson ?? undefined,
            lastTimestamp: state.lastTimestamp
              ? new Date(state.lastTimestamp)
              : undefined,
            lastSummary: state.lastSummary ?? undefined,
          },
        });
        return okPg();
      } catch (err) {
        return fail(err);
      }
    },
    async loadAdminIngestionStateFromDb() {
      try {
        const row = await prisma.adminIngestionState.findUnique({
          where: { id: "singleton" },
        });
        if (!row) return { ...okPg(), state: undefined };
        const state: AdminStateRecord = {
          smokeSucceededAt: row.smokeSucceededAt
            ? new Date(row.smokeSucceededAt as Date).toISOString()
            : null,
          smokeCreditsUsed: (row.smokeCreditsUsed as number | null) ?? null,
          week1IngestionSucceededAt: row.week1IngestionSucceededAt
            ? new Date(row.week1IngestionSucceededAt as Date).toISOString()
            : null,
          week1SubsetSucceededAt: row.week1SubsetSucceededAt
            ? new Date(row.week1SubsetSucceededAt as Date).toISOString()
            : null,
          week1SubsetCreditsUsed:
            (row.week1SubsetCreditsUsed as number | null) ?? null,
          lastAction: (row.lastAction as string | null) ?? null,
          lastResultJson:
            (row.lastResultJson as Record<string, unknown> | null) ?? null,
          lastTimestamp: row.lastTimestamp
            ? new Date(row.lastTimestamp as Date).toISOString()
            : null,
          lastSummary: (row.lastSummary as string | null) ?? null,
        };
        return { ...okPg(), state };
      } catch (err) {
        return fail(err);
      }
    },
    async saveOddsIngestionRunToDb(run) {
      try {
        const created = await prisma.oddsIngestionRun.create({
          data: {
            season: run.season,
            week: run.week ?? null,
            scope: run.scope,
            status: run.status,
            startedAt: new Date(run.startedAt),
            finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
            creditsEstimated: run.creditsEstimated ?? null,
            creditsUsed: run.creditsUsed ?? null,
            creditsRemaining: run.creditsRemaining ?? null,
            marketsRequested: run.marketsRequested ?? null,
            gamesRequested: run.gamesRequested ?? null,
            errorMessage: run.errorMessage ?? null,
            rawResultJson: run.rawResultJson ?? undefined,
          },
        });
        return { ...okPg(), id: created.id };
      } catch (err) {
        return fail(err);
      }
    },
    async loadLatestOddsIngestionRunFromDb(args) {
      try {
        const row = await prisma.oddsIngestionRun.findFirst({
          where: {
            season: args.season,
            ...(args.week !== undefined ? { week: args.week } : {}),
          },
          orderBy: { createdAt: "desc" },
        });
        if (!row) return { ...okPg() };
        const run: OddsRunRecord = {
          season: row.season as number,
          week: (row.week as number | null) ?? null,
          scope: String(row.scope),
          status: String(row.status),
          startedAt: new Date(row.startedAt as Date).toISOString(),
          finishedAt: row.finishedAt
            ? new Date(row.finishedAt as Date).toISOString()
            : null,
          creditsEstimated: (row.creditsEstimated as number | null) ?? null,
          creditsUsed: (row.creditsUsed as number | null) ?? null,
          creditsRemaining: (row.creditsRemaining as number | null) ?? null,
          marketsRequested: (row.marketsRequested as number | null) ?? null,
          gamesRequested: (row.gamesRequested as number | null) ?? null,
          errorMessage: (row.errorMessage as string | null) ?? null,
          rawResultJson:
            (row.rawResultJson as Record<string, unknown> | null) ?? null,
        };
        return { ...okPg(), run };
      } catch (err) {
        return fail(err);
      }
    },
    async saveStoredBacktestRunToDb(run) {
      try {
        const created = await prisma.storedBacktestRun.create({
          data: {
            season: run.season,
            week: run.week,
            dataMode: run.dataMode,
            status: run.status,
            realWeek1BacktestReady: run.realWeek1BacktestReady,
            scheduleValidationStatus: run.scheduleValidationStatus ?? null,
            syntheticFixture: run.syntheticFixture,
            candidatesJson: run.candidatesJson ?? undefined,
            resultsJson: run.resultsJson ?? undefined,
            v1v2Json: run.v1v2Json ?? undefined,
            parlayJson: run.parlayJson ?? undefined,
            gameEdgeJson: run.gameEdgeJson ?? undefined,
          },
        });
        return { ...okPg(), id: created.id };
      } catch (err) {
        return fail(err);
      }
    },
    async loadLatestStoredBacktestRunFromDb(args) {
      try {
        const row = await prisma.storedBacktestRun.findFirst({
          where: { season: args.season, week: args.week },
          orderBy: { createdAt: "desc" },
        });
        if (!row) return { ...okPg() };
        const run: StoredBacktestRecord = {
          season: row.season as number,
          week: row.week as number,
          dataMode: String(row.dataMode),
          status: String(row.status),
          realWeek1BacktestReady: Boolean(row.realWeek1BacktestReady),
          scheduleValidationStatus:
            (row.scheduleValidationStatus as string | null) ?? null,
          syntheticFixture: Boolean(row.syntheticFixture),
          candidatesJson:
            (row.candidatesJson as Record<string, unknown> | null) ?? null,
          resultsJson: (row.resultsJson as Record<string, unknown> | null) ?? null,
          v1v2Json: (row.v1v2Json as Record<string, unknown> | null) ?? null,
          parlayJson: (row.parlayJson as Record<string, unknown> | null) ?? null,
          gameEdgeJson:
            (row.gameEdgeJson as Record<string, unknown> | null) ?? null,
        };
        return { ...okPg(), run };
      } catch (err) {
        return fail(err);
      }
    },
  };
}

// ---- factory ---------------------------------------------------------

let cachedClient: PersistenceClient | null = null;
let cachedPrisma: PrismaLike | null = null;

/**
 * Return the singleton persistence client. Uses Prisma when
 * `DATABASE_URL` is set AND the client imports successfully;
 * otherwise the null client (file-only mode). Memoized.
 *
 * Tests should NOT call this — they use
 * `inMemoryPersistenceClient()` directly.
 */
export async function getPersistenceClient(): Promise<PersistenceClient> {
  if (cachedClient) return cachedClient;
  if (!process.env.DATABASE_URL) {
    cachedClient = nullPersistenceClient();
    return cachedClient;
  }
  try {
    const mod = (await import("@prisma/client")) as { PrismaClient: new () => unknown };
    cachedPrisma = new mod.PrismaClient() as unknown as PrismaLike;
    cachedClient = prismaPersistenceClient(cachedPrisma);
    return cachedClient;
  } catch {
    cachedClient = nullPersistenceClient();
    return cachedClient;
  }
}

/** Allow tests + admin diagnostics to override the singleton. */
export function setPersistenceClientForTests(c: PersistenceClient | null): void {
  cachedClient = c;
}

// ---- file-cache rehydration -----------------------------------------

/**
 * If the canonical Week-N odds file is missing on disk but the
 * DB has rows for it, write the file back from the DB. Idempotent
 * — returns `{ rehydrated: false }` when the file is already
 * present or when no DB rows are available.
 *
 * Pure file IO + a single DB read. No paid API.
 */
export async function rehydrateCanonicalOddsFromDbIfMissing(args: {
  season: number;
  week: number;
  /** Override for tests. */
  client?: PersistenceClient;
  /** Override for tests. */
  processedRoot?: string;
}): Promise<{
  rehydrated: boolean;
  source: "file" | "postgres" | "missing";
  rowsRestored?: number;
  filePath: string;
  error?: string;
}> {
  // Lazy-load so this module stays Node-only safe at import.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { canonicalMarketsPath, writeCanonicalOddsCsv } = await import(
    "../ingestion/canonical-odds-writer"
  );
  const root =
    args.processedRoot ?? path.join(process.cwd(), "data", "processed");
  const filePath = canonicalMarketsPath({
    season: args.season,
    week: args.week,
    processedRoot: root,
  });
  if (fs.existsSync(filePath)) {
    return { rehydrated: false, source: "file", filePath };
  }
  const client = args.client ?? (await getPersistenceClient());
  if (!client.isAvailable()) {
    return { rehydrated: false, source: "missing", filePath };
  }
  const loaded = await client.loadCanonicalOddsRowsFromDb({
    season: args.season,
    week: args.week,
  });
  if (!loaded.ok) {
    return {
      rehydrated: false,
      source: "missing",
      filePath,
      error: loaded.error,
    };
  }
  if (loaded.rows.length === 0) {
    return { rehydrated: false, source: "missing", filePath };
  }
  const wrote = writeCanonicalOddsCsv({
    rows: loaded.rows,
    season: args.season,
    week: args.week,
    processedRoot: root,
  });
  return {
    rehydrated: true,
    source: "postgres",
    rowsRestored: wrote.rowsWritten,
    filePath: wrote.target,
  };
}

/** Clear the singleton + disconnect Prisma. Used by long-lived
 *  processes that want to recycle the connection. */
export async function disposePersistenceClient(): Promise<void> {
  if (cachedPrisma) {
    try {
      await cachedPrisma.$disconnect();
    } catch {
      // ignore
    }
  }
  cachedClient = null;
  cachedPrisma = null;
}
