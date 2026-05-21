/**
 * Deployment marker — bumped intentionally when verifying that
 * the correct Railway service (the Postgres-backed one at
 * nfl-prop-edge-production-208e.up.railway.app) is receiving
 * GitHub deploys. Surfaced on /diagnostics so the live page can
 * be inspected without needing shell access.
 */
export const DEPLOYMENT_MARKER = "railway-prod-routing-check";
