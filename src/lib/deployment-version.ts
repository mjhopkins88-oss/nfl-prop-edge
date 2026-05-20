/**
 * Lightweight build / deployment metadata for the footer
 * version indicator.
 *
 * Server-side only. Reads commit metadata from environment
 * variables that Railway / Vercel set automatically, falling
 * back gracefully when running locally. Pure synchronous —
 * never touches the network.
 */

import { getDefaultAppContext } from "./app-context";

export interface DeploymentVersion {
  /** Short commit hash (7 chars) or "dev" when unknown. */
  commit: string;
  /** ISO commit timestamp when known. */
  commitTimeIso?: string;
  /** Where the hash came from — useful for the footer tooltip. */
  source:
    | "RAILWAY_GIT_COMMIT_SHA"
    | "GIT_COMMIT_SHA"
    | "NEXT_PUBLIC_GIT_COMMIT_SHA"
    | "FALLBACK_DEV";
  /** Current season / week from the central app context. */
  season: number;
  week: number;
  /** Active data mode advertised by the app context. */
  dataMode: ReturnType<typeof getDefaultAppContext>["dataMode"];
}

const FALLBACK_DEV = "dev";
const SHORT_HASH_LEN = 7;

function shortHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed.slice(0, SHORT_HASH_LEN);
}

/**
 * Resolve the commit hash + source at runtime. The order favours
 * platform-provided env vars so deploys do not need any extra
 * configuration.
 */
export function getDeploymentVersion(): DeploymentVersion {
  const railway = shortHash(process.env.RAILWAY_GIT_COMMIT_SHA);
  const generic = shortHash(process.env.GIT_COMMIT_SHA);
  const nextPublic = shortHash(process.env.NEXT_PUBLIC_GIT_COMMIT_SHA);
  const commitTimeIso =
    process.env.RAILWAY_GIT_COMMIT_TIMESTAMP ||
    process.env.GIT_COMMIT_TIMESTAMP ||
    undefined;
  const context = getDefaultAppContext();
  if (railway) {
    return {
      commit: railway,
      commitTimeIso,
      source: "RAILWAY_GIT_COMMIT_SHA",
      season: context.season,
      week: context.week,
      dataMode: context.dataMode,
    };
  }
  if (generic) {
    return {
      commit: generic,
      commitTimeIso,
      source: "GIT_COMMIT_SHA",
      season: context.season,
      week: context.week,
      dataMode: context.dataMode,
    };
  }
  if (nextPublic) {
    return {
      commit: nextPublic,
      commitTimeIso,
      source: "NEXT_PUBLIC_GIT_COMMIT_SHA",
      season: context.season,
      week: context.week,
      dataMode: context.dataMode,
    };
  }
  return {
    commit: FALLBACK_DEV,
    commitTimeIso,
    source: "FALLBACK_DEV",
    season: context.season,
    week: context.week,
    dataMode: context.dataMode,
  };
}

/** One-liner used by the footer. Example: "build dev · W1 · WEEK_1_STARTER_TEST". */
export function formatDeploymentVersionLine(v: DeploymentVersion): string {
  return `build ${v.commit} · W${v.week} · ${v.dataMode}`;
}
