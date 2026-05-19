import type { PropType, Recommendation } from "./types";

export const PROP_TYPE_LABEL: Record<PropType, string> = {
  PASSING_ATTEMPTS: "Pass Attempts",
  PASSING_COMPLETIONS: "Pass Completions",
  PASSING_YARDS: "Passing Yards",
  RECEPTIONS: "Receptions",
  RECEIVING_YARDS: "Receiving Yards",
  RUSHING_ATTEMPTS: "Rush Attempts",
  RUSHING_YARDS: "Rushing Yards",
};

export const PROP_TYPE_SHORT: Record<PropType, string> = {
  PASSING_ATTEMPTS: "Pass Att",
  PASSING_COMPLETIONS: "Pass Comp",
  PASSING_YARDS: "Pass Yds",
  RECEPTIONS: "Rec",
  RECEIVING_YARDS: "Rec Yds",
  RUSHING_ATTEMPTS: "Rush Att",
  RUSHING_YARDS: "Rush Yds",
};

export const PROP_TYPE_UNIT: Record<PropType, string> = {
  PASSING_ATTEMPTS: "att",
  PASSING_COMPLETIONS: "comp",
  PASSING_YARDS: "yds",
  RECEPTIONS: "rec",
  RECEIVING_YARDS: "yds",
  RUSHING_ATTEMPTS: "att",
  RUSHING_YARDS: "yds",
};

export const PROP_TYPES: PropType[] = [
  "PASSING_ATTEMPTS",
  "PASSING_COMPLETIONS",
  "PASSING_YARDS",
  "RECEPTIONS",
  "RECEIVING_YARDS",
  "RUSHING_ATTEMPTS",
  "RUSHING_YARDS",
];

export function americanOddsToImpliedProb(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function formatAmericanOdds(odds: number): string {
  if (odds > 0) return `+${odds}`;
  return `${odds}`;
}

export function formatEdge(edge: number): string {
  const pct = edge * 100;
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function edgeTone(edge: number): "positive" | "neutral" | "negative" {
  if (edge >= 0.04) return "positive";
  if (edge <= -0.02) return "negative";
  return "neutral";
}

export function formatProjection(value: number, propType: PropType): string {
  if (
    propType === "PASSING_YARDS" ||
    propType === "RECEIVING_YARDS" ||
    propType === "RUSHING_YARDS"
  ) {
    return value.toFixed(1);
  }
  return value.toFixed(1);
}

export function formatLine(value: number): string {
  if (Number.isInteger(value)) return `${value}.0`;
  return value.toFixed(1);
}

export function recommendationLabel(rec: Recommendation): string {
  switch (rec) {
    case "OVER":
      return "OVER";
    case "UNDER":
      return "UNDER";
    case "PASS":
      return "NO PLAY";
  }
}

export function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.6) return "Medium";
  return "Low";
}
