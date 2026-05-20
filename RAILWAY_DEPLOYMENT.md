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

The start command deliberately does NOT run
`prisma migrate deploy`. See the README's
"Why no `prisma migrate deploy` in the start command" note.

## Deployment trigger log

Manual deploy triggers — keep this short. Bump the timestamp
when you push a trigger-only commit so future-you can tell
intentional triggers from real changes.

- 2026-05-20 — trigger to verify Railway picks up the Week 1
  starter test + Model Monitor commit (`b19f37b`).
