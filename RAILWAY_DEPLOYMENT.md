# Railway Deployment Notes

Operational reference for deploying NFL Prop Edge to Railway.
Read alongside the "Deploying to Railway" section in the README,
which carries the audit-grade detail on what runs in the build
container.

## Branch that deploys

Railway should track **`main`**. Confirm in Railway under the web
service's **Settings → Source → Branch**. Feature branches like
`claude/review-project-state-OF2y7` do **not** deploy to
production unless PR environments are explicitly enabled in the
project. PRs on their own do not trigger a deploy.

## Required environment variables

The web service itself runs on mock data + fixtures and does NOT
need any env vars to render. The variables below are only needed
when you run the DB-backed paths or the paid ingestion scripts:

| Variable | When required | Default |
|---|---|---|
| `DATABASE_URL` | `npm run db:seed`, `npm run db:migrate`, `npm run db:push`, ingestion `--persist` paths | — |
| `ODDS_API_KEY` | `scripts/ingest-historical-prop-lines.ts` in non-dry-run mode | — |
| `ALLOW_REAL_ODDS_API_CALLS` | Set to `false` (default). Must be `true` AND the script must be invoked with `--execute` for any real Odds API call. | `false` |
| `OPEN_METEO_BASE_URL` | Override only — Open-Meteo is free | `https://archive-api.open-meteo.com/v1/archive` |
| `KALSHI_API_KEY` / `KALSHI_API_SECRET_PATH` / `KALSHI_ENV` | `scripts/ingest-kalshi-markets.ts` in non-dry-run mode | — |
| `ALLOW_NFLVERSE_NETWORK_FETCH` | Set to `true` only when you intentionally want the nflverse ingestion script to hit GitHub. Free, but kept opt-in for CI predictability. | unset / `false` |

**Audited:** `npm run build` and `npm run start` do not require
`DATABASE_URL` or any of the above. Verified with
`env -u DATABASE_URL npm run build`. See the README's
"Postgres connection audit" table for the full check matrix.

## When a deploy doesn't appear after a merge

In order, work through:

1. **Confirm the commit landed on `main`.**
   ```bash
   git fetch origin main
   git log --oneline origin/main -3
   ```
   The commit you expect should be the tip of `origin/main`. If
   it's only on a feature branch, fast-forward main:
   ```bash
   git checkout main && git pull origin main
   git merge --ff-only <feature-branch>
   git push origin main
   ```
2. **Verify Railway's tracked branch.** Settings → Source → Branch
   should read `main` (or whichever branch you intend to deploy).
   If it reads a stale feature branch, switch it to `main` and
   click **Redeploy latest commit**.
3. **Check the deploy log.** Settings → Deployments → most recent
   row. If the build started and failed, the log shows the exact
   step (`npm install`, `npm run build`, etc.). If no row exists
   at all, Railway hasn't received the webhook — the most common
   cause is the GitHub App not being authorized on the repo (or
   the branch setting not matching).
4. **Trigger a manual redeploy.** Railway's UI: **Deployments →
   Redeploy** on the most recent commit. This works regardless of
   webhook state.
5. **Force a trigger commit.** If the webhook is genuinely missed,
   push a small no-op commit to `main` (e.g., a timestamp line in
   this file). Railway will pick it up.

## When PRs don't deploy

PR branches do not deploy to production. Options:

- Merge the PR into `main`. Railway redeploys on the next push to
  `main`.
- Enable **PR environments** in Railway (separate setting) if you
  want each PR to spawn an ephemeral preview. Off by default.

## Build commands (pinned by railway.json)

```json
{
  "build":  { "builder": "NIXPACKS", "buildCommand": "npm install && npm run build" },
  "deploy": { "startCommand": "npm run start", "restartPolicyType": "ON_FAILURE", "restartPolicyMaxRetries": 3 }
}
```

`npm run build` chains `prisma generate && next build`. The
`prisma generate` step reads the schema but does not connect to
any database, so the build does not depend on `DATABASE_URL`.

`npm run start` runs
`node scripts/run-db-push-if-configured.cjs && next start`. The
schema-sync helper only acts when `DATABASE_URL` is set (no-op
otherwise) and uses `prisma db push --skip-generate
--accept-data-loss=false`, which is additive-only and
idempotent — re-running across redeploys is safe. Failures log a
warning and let the app start; the persistence layer falls back
to file-only mode when the tables aren't present.

The project does NOT use Prisma migrations (no `prisma/migrations/`
directory). `db push` is the agreed pattern. To bootstrap a fresh
database, set `DATABASE_URL` in Railway and let `npm start`
handle it on the next deploy — no manual step required.

## Runtime persistence

Railway web-service containers are **ephemeral**. Anything
written under the working directory at runtime is wiped on the
next build/redeploy. The paid Odds API ingestion, the canonical
migration result, the admin smoke-success flag, and the stored
backtest output are all expensive (paid or labour-cost) to
regenerate. Those are mirrored into Postgres by
`src/lib/persistence/week-1-persistence.ts` on every successful
admin action, and `/admin/ingestion` reads the merged DB + file
state at load time so a redeploy doesn't reset the page.

If the canonical odds file is missing on disk but Postgres has
rows for `(2025, 1)`, the `stored-backtest` admin action
rehydrates the file from DB before running. **Do not rerun the
paid Odds API ingestion just because the file disappeared** —
check `/admin/ingestion` first; the "Persistent storage:
Postgres available" indicator + the per-source labels
(`canonical odds source: postgres`, `admin state source:
postgres`) will tell you whether DB rehydration is possible.

See `RUNTIME_DATA_PERSISTENCE_AUDIT.md` for the full classification
of which files are persisted and which are intentionally kept
file-only.

The start command deliberately does NOT run
`prisma migrate deploy` (no migration history). `db push` covers
it; if you ever switch to migrations, replace the helper script
or move the command into `start`.

## Deployment trigger log

Manual deploy triggers — keep this short. Bump the timestamp
when you push a trigger-only commit so future-you can tell
intentional triggers from real changes.

- 2026-05-20 — trigger to verify Railway picks up the Week 1
  starter test + Model Monitor commit (`b19f37b`).
