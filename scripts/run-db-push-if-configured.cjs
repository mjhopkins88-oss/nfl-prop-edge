#!/usr/bin/env node
/**
 * Conditionally run `prisma db push` at container start.
 *
 * Railway boots the web service via `npm start`. When
 * `DATABASE_URL` is set we ensure the schema is current by
 * running `prisma db push --skip-generate --accept-data-loss=false`
 * — additive-only, idempotent, safe to repeat. When the env var
 * is unset (local development) we silently skip so dev doesn't
 * require Postgres.
 *
 * NEVER throws. A push failure logs a warning and lets the app
 * start — the persistence layer's null-client fallback handles
 * missing tables gracefully.
 *
 * No paid API calls. No model logic.
 */

"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

function main() {
  if (!process.env.DATABASE_URL) {
    console.log("[db-push] DATABASE_URL not set — skipping schema sync.");
    return;
  }
  const tsxBin = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    "prisma",
  );
  console.log("[db-push] Syncing Prisma schema to DATABASE_URL ...");
  const res = spawnSync(
    tsxBin,
    ["db", "push", "--skip-generate", "--accept-data-loss=false"],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    },
  );
  if (res.status === 0) {
    console.log("[db-push] Schema sync OK.");
  } else {
    console.warn(
      "[db-push] Schema sync FAILED (status=" +
        res.status +
        "). App will still start; persistence falls back to file-only.",
    );
  }
}

main();
