/**
 * Mock-prop validation helper.
 *
 * Runs at module-load time (called by `src/lib/mock-data.ts`) to make
 * sure every prop in the mock catalog has the fields the UI and the
 * qualification gate expect. Logs a single warning line per missing
 * field — never throws, so the app still starts.
 */

import type { PropMarket } from "../types";

export interface ValidationIssue {
  propId: string;
  field: string;
  message: string;
}

const REQUIRED_FIELDS: Array<{
  field: keyof PropMarket;
  check: (p: PropMarket) => boolean;
  message: string;
}> = [
  {
    field: "propType",
    check: (p) => typeof p.propType === "string" && p.propType.length > 0,
    message: "propType missing or empty",
  },
  {
    field: "bookImpliedOver",
    check: (p) => typeof p.bookImpliedOver === "number",
    message: "bookImpliedOver (market probability) missing",
  },
  {
    field: "modelHitRateOver",
    check: (p) => typeof p.modelHitRateOver === "number",
    message: "modelHitRateOver (model probability) missing",
  },
  {
    field: "edge",
    check: (p) => typeof p.edge === "number",
    message: "edge missing",
  },
  {
    field: "featureSet",
    check: (p) => p.featureSet != null && typeof p.featureSet === "object",
    message: "featureSet missing",
  },
  {
    field: "reasons",
    check: (p) => Array.isArray(p.reasons),
    message: "reasons missing or not an array",
  },
  {
    field: "risks",
    check: (p) => Array.isArray(p.risks),
    message: "risks missing or not an array",
  },
  {
    field: "recommendation",
    check: (p) =>
      p.recommendation === "OVER" ||
      p.recommendation === "UNDER" ||
      p.recommendation === "PASS",
    message: "recommendation missing or invalid",
  },
];

export function validateProp(prop: PropMarket): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const req of REQUIRED_FIELDS) {
    if (!req.check(prop)) {
      out.push({
        propId: prop.id,
        field: String(req.field),
        message: req.message,
      });
    }
  }
  return out;
}

/**
 * Validate every prop in a list. Logs a single warning per issue.
 * Returns the issues so callers can also surface them (tests, etc.).
 */
export function validateProps(props: PropMarket[]): ValidationIssue[] {
  const all: ValidationIssue[] = [];
  for (const prop of props) {
    const issues = validateProp(prop);
    for (const issue of issues) {
      // eslint-disable-next-line no-console
      console.warn(
        `[validation] prop ${issue.propId}: ${issue.field} — ${issue.message}`,
      );
    }
    all.push(...issues);
  }
  return all;
}
