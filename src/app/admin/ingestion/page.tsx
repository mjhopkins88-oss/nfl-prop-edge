/**
 * Protected admin ingestion page.
 *
 * Server-renders a thin shell that hands off to a client
 * component for the interactive state. The page itself reads NO
 * secrets — the client must present the admin token to the API
 * routes for any data to come back.
 */

import type { Metadata } from "next";
import { AdminIngestionClient } from "./AdminIngestionClient";

export const metadata: Metadata = {
  title: "Admin · Ingestion controls",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function AdminIngestionPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-coral-400">
          Admin · Ingestion controls
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          Protected. Requires an ADMIN_INGEST_TOKEN. Paid Odds
          API actions require ALLOW_REAL_ODDS_API_CALLS=true
          AND an exact confirmation string. Starter markets
          only: player_pass_attempts, player_pass_completions,
          player_receptions, player_rush_attempts. No touchdown
          props. No automated betting. No Kalshi.
        </p>
      </header>
      <AdminIngestionClient />
    </main>
  );
}
