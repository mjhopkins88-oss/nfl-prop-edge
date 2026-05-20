import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";
import {
  formatDeploymentVersionLine,
  getDeploymentVersion,
} from "@/lib/deployment-version";

export const metadata: Metadata = {
  title: "NFL Prop Edge",
  description:
    "Player prop opportunity finder for low-variance NFL markets — projections, edges, and line shopping.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const version = getDeploymentVersion();
  const versionLine = formatDeploymentVersionLine(version);
  return (
    <html lang="en">
      <body className="font-sans antialiased text-ink-900">
        <Header />
        <main className="relative mx-auto w-full max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="mx-auto w-full max-w-7xl px-4 pb-10 text-center text-xs text-ink-500 sm:px-6 lg:px-8">
          <div>
            NFL Prop Edge · V1 mock data · For research only. Not investment advice.
          </div>
          <div
            className="mt-1 text-[10px] font-mono uppercase tracking-[0.12em] text-ink-400"
            data-testid="deployment-version"
            title={`source ${version.source}${version.commitTimeIso ? ` · ${version.commitTimeIso}` : ""}`}
          >
            {versionLine}
          </div>
        </footer>
      </body>
    </html>
  );
}
