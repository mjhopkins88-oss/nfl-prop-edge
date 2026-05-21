/**
 * Build-time deployment manifest writer.
 *
 * Captures the git commit / branch / timestamp into
 * `data/deployment-manifest.json` so the runtime
 * `/diagnostics` page can show what shipped without exposing
 * any secrets. Safe to run repeatedly. No network calls.
 *
 * Hooked into `npm run build` via the package.json `build`
 * script — failures are non-fatal so deploys never fail just
 * because git metadata is unavailable.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT_PATH = path.join(
  process.cwd(),
  "data",
  "deployment-manifest.json",
);

function tryGit(args: string[]): string | undefined {
  try {
    return execSync(`git ${args.join(" ")}`, {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

interface DeploymentManifest {
  generatedAt: string;
  gitCommit?: string;
  gitCommitShort?: string;
  gitBranch?: string;
  gitCommitTimestamp?: string;
  source: "git" | "env" | "unknown";
}

function main(): void {
  const fromEnv = {
    commit:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GIT_COMMIT_SHA ||
      process.env.NEXT_PUBLIC_DEPLOYMENT_COMMIT,
    branch:
      process.env.RAILWAY_GIT_BRANCH ||
      process.env.GIT_BRANCH ||
      process.env.NEXT_PUBLIC_DEPLOYMENT_BRANCH,
    timestamp:
      process.env.RAILWAY_GIT_COMMIT_TIMESTAMP ||
      process.env.GIT_COMMIT_TIMESTAMP,
  };

  const commit = fromEnv.commit ?? tryGit(["rev-parse", "HEAD"]);
  const branch =
    fromEnv.branch ?? tryGit(["rev-parse", "--abbrev-ref", "HEAD"]);
  const timestamp =
    fromEnv.timestamp ?? tryGit(["log", "-1", "--format=%cI"]);

  const source: DeploymentManifest["source"] = fromEnv.commit
    ? "env"
    : commit
      ? "git"
      : "unknown";

  const manifest: DeploymentManifest = {
    generatedAt: new Date().toISOString(),
    gitCommit: commit,
    gitCommitShort: commit ? commit.slice(0, 7) : undefined,
    gitBranch: branch,
    gitCommitTimestamp: timestamp,
    source,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2) + "\n");
  // eslint-disable-next-line no-console
  console.log(
    `deployment manifest: ${OUT_PATH} (commit ${manifest.gitCommitShort ?? "unknown"}, branch ${manifest.gitBranch ?? "unknown"}, source ${manifest.source})`,
  );
}

try {
  main();
} catch (err) {
  // Non-fatal — we never want this script to block a deploy.
  // eslint-disable-next-line no-console
  console.warn(
    `[write-deployment-manifest] non-fatal: ${(err as Error).message}`,
  );
}
