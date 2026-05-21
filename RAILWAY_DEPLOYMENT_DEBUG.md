# Railway Deployment Debug Log

Working notes for diagnosing why Railway is not auto-deploying
after a `main` push. Read alongside `RAILWAY_DEPLOYMENT.md`.

## Project intent

- **Repo:** `mjhopkins88-oss/nfl-prop-edge`
- **Production branch:** `main`
- **Railway service name:** `nfl-prop-edge` (intended)
- **Expected public URL:** the one assigned by Railway under
  the web service's **Settings → Domains**

## Required environment variables

Only the variables a given run needs. The deployed web app
itself runs on mock data + bundled fixtures and needs none of
these for `npm run start`.

| Variable | When required | Default |
|---|---|---|
| `DATABASE_URL` | Only for `db:seed` / `db:migrate` / `db:push` / `--persist` ingestion paths. **NOT** required to deploy. | — |
| `ODDS_API_KEY` | Non-dry-run Odds API ingestion only | — |
| `WEATHER_API_KEY` | Reserved — not consumed today (Open-Meteo is free + key-less) | — |
| `OPENWEATHER_API_KEY` | Reserved — not consumed today | — |
| `ALLOW_REAL_ODDS_API_CALLS` | Set to `false` (default). Must be `true` AND the script must use `--execute` before any real Odds API call. | `false` |
| `ALLOW_NFLVERSE_NETWORK_FETCH` | Set to `true` only when you intend to hit GitHub for nflverse releases. | unset / `false` |
| `RAILWAY_GIT_COMMIT_SHA` | Set by Railway automatically. Surfaces in the footer + `/diagnostics`. | injected |

`env -u DATABASE_URL npm run build` succeeds — confirmed in the
README's Postgres connection audit table.

## Likely causes when Railway misses a push

1. **GitHub App not authorized on the repo.** Settings → GitHub
   → reinstall / reauthorize. The Railway webhook silently
   stops firing when this happens.
2. **Source branch mismatch.** Settings → Source → Branch must
   read `main`. A stale value (a feature-branch name from a
   prior session) drops every `main` push on the floor.
3. **Auto-deploy disabled.** Settings → Deploy → "Automatic
   Deploys" toggle. Defaults to on; turning it off requires a
   manual redeploy after every push.
4. **Repo disconnected.** Settings → GitHub → Repository. If
   the link reads "no repository connected", reconnect.
5. **Build failed silently.** Settings → Deployments → most
   recent row. If a build started but the deployment never
   marked itself active, the start command probably failed and
   the service kept serving the last good build.
6. **Webhook delivery failures.** GitHub repo → Settings →
   Webhooks → the Railway one — recent deliveries should show
   200s. Any 4xx/5xx means Railway didn't see the push.

## Runbook when Railway doesn't deploy

In order, work through:

1. **Confirm the commit landed on `main`.**
   ```bash
   git fetch origin main
   git log --oneline origin/main -3
   ```
   If the commit isn't there, fast-forward:
   ```bash
   git checkout main && git pull origin main
   git merge --ff-only <feature-branch>
   git push origin main
   ```
2. **Verify Railway's tracked branch.** Settings → Source →
   Branch must say `main`.
3. **Check the GitHub webhook.** Repo Settings → Webhooks →
   look for a Railway one with recent 200 responses.
4. **Trigger a manual redeploy.** Railway → Deployments →
   Redeploy on the most recent commit.
5. **Force-trigger with a no-op commit.** If the webhook is
   genuinely missed, push a small commit to `main` to give
   Railway something new to see.
6. **Open `/diagnostics` on the deployed URL.** The
   diagnostics page shows the commit hash Railway actually
   served. If it doesn't match `origin/main`, the deploy is
   stale.

## Deployment trigger log

Append a row here when you push a trigger-only commit so future
trigger commits stay intentional.

- 2026-05-20 — `b19f37b` "Add Week 1 starter test and model monitor"
  pushed to `main`.
- 2026-05-20 — `6fec0d3` "Trigger Railway deployment for latest main"
  documented + pushed. Added `RAILWAY_DEPLOYMENT.md`.
- 2026-05-21 — **current** trigger checkpoint. Local
  `origin/main` HEAD reads `70a34e6` "Generate Week 1 starter
  test outputs". This commit adds the diagnostics page + build
  manifest + commits the Week 1 starter-test JSON outputs that
  were previously gitignored. Pushing this to `main` should
  generate a fresh Railway deploy. If it does not, see the
  runbook above — start with the GitHub webhook page.

## Why deploys looked empty earlier

Even when Railway *did* deploy, `/backtest/week-1` shipped with
no Week-1 fixture data because `data/backtests/2025/week-1-*.fixture.json`
was matched by the broad `data/backtests/**` rule in
`.gitignore`. The page rendered its "Run the starter test
first" empty state. The fix: an explicit
`!data/backtests/2025/week-1-*.fixture.json` whitelist plus
committing the ten generated files.

## What `/diagnostics` shows

- Commit + short hash + branch + build timestamp (from
  `data/deployment-manifest.json`, written at build time).
- Default app-context season / week / data mode.
- Presence (not value) of `DATABASE_URL`, `ODDS_API_KEY`,
  `WEATHER_API_KEY`, `OPENWEATHER_API_KEY`,
  `ALLOW_REAL_ODDS_API_CALLS`, `ALLOW_NFLVERSE_NETWORK_FETCH`.
- The ten Week 1 fixture-output files with a `found` / `missing`
  indicator each.

No secret values are exposed anywhere on the page.
