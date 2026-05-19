import type { Metadata } from "next";
import "./globals.css";
import Header from "@/components/Header";

export const metadata: Metadata = {
  title: "NFL Prop Edge",
  description:
    "Player prop opportunity finder for low-variance NFL markets — projections, edges, and line shopping.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased text-ink-900">
        <Header />
        <main className="relative mx-auto w-full max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
          {children}
        </main>
        <footer className="mx-auto w-full max-w-7xl px-4 pb-10 text-center text-xs text-ink-500 sm:px-6 lg:px-8">
          NFL Prop Edge · V1 mock data · For research only. Not investment advice.
        </footer>
      </body>
    </html>
  );
}
