/**
 * Routes & navigation smoke test.
 *
 * Asserts the static page files for the player prop dashboard,
 * the backtest page, and the experimental Game Edge section exist,
 * and that the Header component links to each route the user
 * should be able to reach from the chrome.
 *
 * Pure file IO + regex. No bundler, no API calls.
 */

import fs from "node:fs";
import path from "node:path";

interface Failure {
  scenario: string;
  reason: string;
}

const FAILURES: Failure[] = [];
const ROOT = process.cwd();

function check(name: string, predicate: boolean, reason: string): void {
  if (!predicate) FAILURES.push({ scenario: name, reason });
}

function exists(rel: string): boolean {
  return fs.existsSync(path.join(ROOT, rel));
}

function readFile(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function main(): void {
  console.log("Routes & navigation smoke test");
  console.log("==============================");

  // 1. Required page files exist.
  check(
    "page file exists: /",
    exists("src/app/page.tsx"),
    "src/app/page.tsx missing — Player Props dashboard not buildable",
  );
  check(
    "page file exists: /backtest",
    exists("src/app/backtest/page.tsx"),
    "src/app/backtest/page.tsx missing",
  );
  check(
    "page file exists: /game-edge",
    exists("src/app/game-edge/page.tsx"),
    "src/app/game-edge/page.tsx missing — Game Edge section not buildable",
  );
  check(
    "page file exists: /game-edge/[id]",
    exists("src/app/game-edge/[id]/page.tsx"),
    "src/app/game-edge/[id]/page.tsx missing",
  );
  check(
    "page file exists: /props/[id]",
    exists("src/app/props/[id]/page.tsx"),
    "src/app/props/[id]/page.tsx missing",
  );

  // 2. Header includes the routes we expect.
  const headerPath = "src/components/Header.tsx";
  if (!exists(headerPath)) {
    check(`Header.tsx exists`, false, "src/components/Header.tsx missing");
  } else {
    const header = readFile(headerPath);
    check(
      "Header links to /",
      /href:\s*"\/"/.test(header),
      "Header missing href '/' (Player Props link)",
    );
    check(
      "Header links to /backtest",
      /href:\s*"\/backtest"/.test(header),
      "Header missing href '/backtest'",
    );
    check(
      "Header links to /game-edge",
      /href:\s*"\/game-edge"/.test(header),
      "Header missing href '/game-edge' — Game Edge will be hidden from nav",
    );

    // Soft cosmetic: Game Edge label should be visible to humans, not
    // just an experimental marker.
    check(
      'Header advertises "Game Edge" label',
      /label:\s*"Game Edge"/.test(header),
      'Header does not surface the literal label "Game Edge"',
    );
  }

  // 3. Optional Parlay Builder — only fail if the route exists but
  //    the header / homepage forgot to link to it. Absent route is OK.
  const parlayPagePath = "src/app/parlays/page.tsx";
  if (exists(parlayPagePath)) {
    const header = exists(headerPath) ? readFile(headerPath) : "";
    check(
      "Header links to /parlays (since /parlays exists)",
      /href:\s*"\/parlays"/.test(header),
      "Header missing href '/parlays' — Parlay Builder route exists but is unreachable from the nav",
    );
    if (exists("src/app/page.tsx")) {
      const page = readFile("src/app/page.tsx");
      check(
        "Homepage cross-links to /parlays (since /parlays exists)",
        /href=\s*"\/parlays"/.test(page),
        "Homepage does not cross-link to /parlays — section discoverability suffers",
      );
    }
  } else {
    console.log("  · /parlays does not exist — skipping Parlay link check");
  }

  // 4. Homepage should cross-link to /game-edge (so the section is
  //    discoverable even if the header is crowded).
  if (exists("src/app/page.tsx")) {
    const page = readFile("src/app/page.tsx");
    check(
      "Homepage cross-links to /game-edge",
      /href=\s*"\/game-edge"/.test(page),
      "Homepage does not cross-link to /game-edge — section discoverability suffers",
    );
  }

  console.log("");
  if (FAILURES.length === 0) {
    console.log("All route + navigation assertions passed.");
  } else {
    console.log(`${FAILURES.length} assertion(s) failed:`);
    for (const f of FAILURES) {
      console.log(`  · ${f.scenario}: ${f.reason}`);
    }
    process.exit(1);
  }
}

main();
