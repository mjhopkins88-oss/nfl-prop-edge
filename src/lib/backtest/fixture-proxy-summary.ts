/**
 * Page-side loader for the four proxy validation fixture files. Reads
 * what's on disk under `data/backtests/2025/`; returns `undefined`
 * for any missing file so the UI can gracefully degrade.
 */

import fs from "node:fs";
import path from "node:path";
import type {
  ProxyFalseNegative,
  ProxyFalsePositive,
  ProxyLiftEntry,
  ProxyName,
  ProxyPerformanceSummary,
} from "./proxy-validation";

const BASE = path.join(process.cwd(), "data", "backtests", "2025");

function safeReadJson<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export interface FixtureProxySummary {
  generatedAt: string;
  performance: Record<ProxyName, ProxyPerformanceSummary>;
  lift: ProxyLiftEntry[];
  falsePositives: ProxyFalsePositive[];
  falseNegatives: ProxyFalseNegative[];
}

export function loadFixtureProxySummary(): FixtureProxySummary | undefined {
  const performance = safeReadJson<{
    generatedAt: string;
    performance: Record<ProxyName, ProxyPerformanceSummary>;
  }>(path.join(BASE, "proxy-performance.fixture.json"));
  const lift = safeReadJson<{
    generatedAt: string;
    lift: ProxyLiftEntry[];
  }>(path.join(BASE, "proxy-lift.fixture.json"));
  const fps = safeReadJson<{
    generatedAt: string;
    falsePositives: ProxyFalsePositive[];
  }>(path.join(BASE, "proxy-false-positives.fixture.json"));
  const fns = safeReadJson<{
    generatedAt: string;
    falseNegatives: ProxyFalseNegative[];
  }>(path.join(BASE, "proxy-false-negatives.fixture.json"));
  if (!performance || !lift || !fps || !fns) return undefined;
  return {
    generatedAt: performance.generatedAt,
    performance: performance.performance,
    lift: lift.lift,
    falsePositives: fps.falsePositives,
    falseNegatives: fns.falseNegatives,
  };
}
