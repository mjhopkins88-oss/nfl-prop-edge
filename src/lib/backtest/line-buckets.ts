/**
 * Bucketing helpers for backtest performance breakdowns.
 *
 * Each bucketer returns a stable human-readable label. The runner
 * tags every evaluated prop with these labels so downstream metrics
 * can slice cleanly.
 */

import type { PropType } from "../types";

type Bucket = { label: string; lo: number; hi: number };

const LINE_BUCKETS_BY_PROP_TYPE: Record<PropType, Bucket[]> = {
  PASSING_ATTEMPTS: [
    { label: "≤ 28.5", lo: -Infinity, hi: 29 },
    { label: "29.5 – 32.5", lo: 29, hi: 33 },
    { label: "33.5 – 36.5", lo: 33, hi: 37 },
    { label: "37.5+", lo: 37, hi: Infinity },
  ],
  PASSING_COMPLETIONS: [
    { label: "≤ 18.5", lo: -Infinity, hi: 19 },
    { label: "19.5 – 22.5", lo: 19, hi: 23 },
    { label: "23.5 – 26.5", lo: 23, hi: 27 },
    { label: "27.5+", lo: 27, hi: Infinity },
  ],
  PASSING_YARDS: [
    { label: "≤ 199.5", lo: -Infinity, hi: 200 },
    { label: "200.5 – 249.5", lo: 200, hi: 250 },
    { label: "250.5 – 279.5", lo: 250, hi: 280 },
    { label: "280.5+", lo: 280, hi: Infinity },
  ],
  RECEPTIONS: [
    { label: "≤ 2.5", lo: -Infinity, hi: 3 },
    { label: "3.5", lo: 3, hi: 4 },
    { label: "4.5", lo: 4, hi: 5 },
    { label: "5.5", lo: 5, hi: 6 },
    { label: "6.5+", lo: 6, hi: Infinity },
  ],
  RECEIVING_YARDS: [
    { label: "≤ 39.5", lo: -Infinity, hi: 40 },
    { label: "40.5 – 69.5", lo: 40, hi: 70 },
    { label: "70.5 – 99.5", lo: 70, hi: 100 },
    { label: "100.5+", lo: 100, hi: Infinity },
  ],
  RUSHING_ATTEMPTS: [
    { label: "≤ 9.5", lo: -Infinity, hi: 10 },
    { label: "10.5 – 14.5", lo: 10, hi: 15 },
    { label: "15.5 – 19.5", lo: 15, hi: 20 },
    { label: "20.5+", lo: 20, hi: Infinity },
  ],
  RUSHING_YARDS: [
    { label: "≤ 39.5", lo: -Infinity, hi: 40 },
    { label: "40.5 – 69.5", lo: 40, hi: 70 },
    { label: "70.5 – 99.5", lo: 70, hi: 100 },
    { label: "100.5+", lo: 100, hi: Infinity },
  ],
};

export function getLineBucket(propType: PropType, line: number): string {
  const buckets = LINE_BUCKETS_BY_PROP_TYPE[propType];
  for (const b of buckets) {
    if (line >= b.lo && line < b.hi) return b.label;
  }
  return "unbucketed";
}

export function getEdgeBucket(edge: number): string {
  if (edge < 0) return "< 0%";
  if (edge < 0.02) return "0–2%";
  if (edge < 0.04) return "2–4%";
  if (edge < 0.06) return "4–6%";
  if (edge < 0.1) return "6–10%";
  return "≥ 10%";
}

export function getConfidenceBucket(
  confidence: number,
): "High" | "Medium" | "Low" {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.6) return "Medium";
  return "Low";
}

/** Bucket for a generic 0..1 risk score (data quality, role, etc.). */
export function getRiskBucket(score: number): string {
  if (score < 0.45) return "Critical (< 0.45)";
  if (score < 0.55) return "Fail (0.45–0.55)";
  if (score < 0.65) return "Warn (0.55–0.65)";
  if (score < 0.8) return "Clean (0.65–0.80)";
  return "Strong (≥ 0.80)";
}

/** Coaching uncertainty penalty is 0..100. */
export function getCoachingUncertaintyBucket(penalty: number): string {
  if (penalty < 20) return "None / low (< 20)";
  if (penalty < 40) return "Mild (20–39)";
  if (penalty < 60) return "Moderate (40–59)";
  if (penalty < 75) return "High (60–74)";
  return "Severe (75+)";
}

/** Weather score is 0..1 (1 = dome / clean). */
export function getWeatherRiskBucket(score: number): string {
  if (score < 0.5) return "Risk (< 0.50)";
  if (score < 0.75) return "Borderline (0.50–0.74)";
  return "Clean (≥ 0.75)";
}
