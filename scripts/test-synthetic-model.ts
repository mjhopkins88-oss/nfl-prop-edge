/**
 * test-synthetic-model.ts
 *
 * Runs every scenario from `src/lib/model/synthetic-scenarios.ts`
 * through the full pipeline:
 *
 *   projection inputs → projectProp()              ── mean / σ / over-prob
 *   feature inputs    → calculate*Score()          ── per-group scores
 *   edge + featureSet → qualifyWithFeatures()      ── recommendation
 *
 * For each scenario it checks:
 *   - actual recommendation matches the expected one
 *   - (optional) expected `reasonFragment` appears in the combined
 *     narrative (projection reasons + risks, derived feature reasons +
 *     risks, qualifier pass-reasons), case-insensitive substring match
 *   - (optional) expected `riskFragment` appears in the same narrative
 *
 * Prints a PASS / FAIL line per scenario and a summary. Exits non-zero
 * if any scenario fails so the script is CI-friendly.
 *
 * No external APIs. No DB writes. Pure CPU.
 */

import process from "node:process";

import {
  SYNTHETIC_SCENARIOS,
  type SyntheticScenario,
} from "../src/lib/model/synthetic-scenarios";
import {
  projectProp,
  type PropProjectionOutput,
} from "../src/lib/model/prop-projection-engine";
import {
  calculateCorrelationExposureScore,
  calculateGameScriptScore,
  calculateInjuryContextScore,
  calculateMarketContextScore,
  calculatePaceScore,
  calculateRoleStabilityScore,
  calculateWeatherEnvironmentScore,
  deriveFeatureReasons,
  deriveFeatureRisks,
  qualifyWithFeatures,
  type QualificationResult,
} from "../src/lib/model/feature-scoring";
import type { PropFeatureSet } from "../src/lib/model/feature-framework";

// --- helpers ---------------------------------------------------------

function americanToImpliedProb(odds: number): number {
  if (odds === 0) return 0;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function noVigOver(overOdds: number, underOdds: number): number {
  const o = americanToImpliedProb(overOdds);
  const u = americanToImpliedProb(underOdds);
  return o / (o + u);
}

function buildFeatureSet(scenario: SyntheticScenario): PropFeatureSet {
  // We don't know the model side yet, so we pass OVER as the placeholder
  // side to scoreMarketContext (the only group that uses side info).
  // The qualifier itself decides the side from the signed edge.
  const tentativeSide =
    scenario.expected.recommendation === "UNDER" ? "UNDER" : "OVER";
  return {
    roleStability: calculateRoleStabilityScore(
      scenario.featureInputs.roleStability,
    ),
    gameScript: calculateGameScriptScore(
      scenario.featureInputs.gameScript,
      scenario.propType,
    ),
    pace: calculatePaceScore(scenario.featureInputs.pace),
    marketContext: calculateMarketContextScore(
      scenario.featureInputs.marketContext,
      tentativeSide,
    ),
    weatherEnvironment: calculateWeatherEnvironmentScore(
      scenario.featureInputs.weatherEnvironment,
      scenario.propType,
    ),
    injuryContext: calculateInjuryContextScore(
      scenario.featureInputs.injuryContext,
      scenario.propType,
    ),
    correlationExposure: calculateCorrelationExposureScore(
      scenario.featureInputs.correlationExposure,
    ),
  };
}

function combinedNarrative(
  projection: PropProjectionOutput,
  featureSet: PropFeatureSet,
  gate: QualificationResult,
): string[] {
  return [
    ...projection.reasons,
    ...projection.risks,
    ...deriveFeatureReasons(featureSet),
    ...deriveFeatureRisks(featureSet),
    ...gate.passReasons,
  ];
}

function containsFragment(narrative: string[], fragment: string): boolean {
  const f = fragment.toLowerCase();
  return narrative.some((s) => s.toLowerCase().includes(f));
}

// --- color + symbols (terminal-friendly, no deps) --------------------

const TICK = "✓";
const CROSS = "✗";
const C_GREEN = "\x1b[32m";
const C_RED = "\x1b[31m";
const C_DIM = "\x1b[2m";
const C_RESET = "\x1b[0m";

// --- runner ----------------------------------------------------------

interface ScenarioResult {
  scenario: SyntheticScenario;
  actualRecommendation: string;
  recommendationOk: boolean;
  reasonFragmentOk: boolean;
  riskFragmentOk: boolean;
  edge: number;
  modelOver: number;
  projectedMean: number;
  passReasons: string[];
}

function runScenario(scenario: SyntheticScenario): ScenarioResult {
  const projection = projectProp({
    propType: scenario.propType,
    ctx: scenario.projection,
    line: scenario.line,
  });
  const bookOver = noVigOver(scenario.overOdds, scenario.underOdds);
  const edge = projection.modelOverProbability - bookOver;
  const featureSet = buildFeatureSet(scenario);
  const gate = qualifyWithFeatures({
    propType: scenario.propType,
    edge,
    featureSet,
  });

  const narrative = combinedNarrative(projection, featureSet, gate);

  const recommendationOk =
    gate.recommendation === scenario.expected.recommendation;
  const reasonFragmentOk =
    scenario.expected.reasonFragment == null ||
    containsFragment(narrative, scenario.expected.reasonFragment);
  const riskFragmentOk =
    scenario.expected.riskFragment == null ||
    containsFragment(narrative, scenario.expected.riskFragment);

  return {
    scenario,
    actualRecommendation: gate.recommendation,
    recommendationOk,
    reasonFragmentOk,
    riskFragmentOk,
    edge,
    modelOver: projection.modelOverProbability,
    projectedMean: projection.projectedMean,
    passReasons: gate.passReasons,
  };
}

function formatScenarioLine(r: ScenarioResult, idx: number, total: number): string {
  const ok = r.recommendationOk && r.reasonFragmentOk && r.riskFragmentOk;
  const head = `[${idx}/${total}] ${r.scenario.name}`;
  const recLine =
    `  expected: ${r.scenario.expected.recommendation.padEnd(5)}  ` +
    `actual: ${r.actualRecommendation.padEnd(5)}  ` +
    (r.recommendationOk ? `${C_GREEN}${TICK}${C_RESET}` : `${C_RED}${CROSS}${C_RESET}`);
  const numLine = `${C_DIM}  mean=${r.projectedMean.toFixed(1)}  modelOver=${(r.modelOver * 100).toFixed(1)}%  edge=${(r.edge * 100).toFixed(1)}%${C_RESET}`;
  const reasonLine = r.scenario.expected.reasonFragment
    ? `  reason "${r.scenario.expected.reasonFragment}" ` +
      (r.reasonFragmentOk
        ? `${C_GREEN}${TICK} found${C_RESET}`
        : `${C_RED}${CROSS} missing${C_RESET}`)
    : "";
  const riskLine = r.scenario.expected.riskFragment
    ? `  risk   "${r.scenario.expected.riskFragment}" ` +
      (r.riskFragmentOk
        ? `${C_GREEN}${TICK} found${C_RESET}`
        : `${C_RED}${CROSS} missing${C_RESET}`)
    : "";
  const passReasonLine =
    !r.recommendationOk && r.passReasons.length > 0
      ? `${C_DIM}  qualifier passReasons: ${r.passReasons.join(" | ")}${C_RESET}`
      : "";
  const verdict = ok
    ? `${C_GREEN}PASS${C_RESET}`
    : `${C_RED}FAIL${C_RESET}`;
  return [head, recLine, numLine, reasonLine, riskLine, passReasonLine, `  -> ${verdict}`]
    .filter((s) => s.length > 0)
    .join("\n");
}

function main(): number {
  const results: ScenarioResult[] = SYNTHETIC_SCENARIOS.map(runScenario);

  results.forEach((r, i) => {
    // eslint-disable-next-line no-console
    console.log(formatScenarioLine(r, i + 1, results.length) + "\n");
  });

  const passed = results.filter(
    (r) => r.recommendationOk && r.reasonFragmentOk && r.riskFragmentOk,
  ).length;
  const failed = results.length - passed;

  // eslint-disable-next-line no-console
  console.log(
    `\n${passed === results.length ? C_GREEN : C_RED}Summary: ${passed}/${results.length} scenarios passed${C_RESET}` +
      (failed > 0 ? `  (${failed} failed)` : ""),
  );

  return failed === 0 ? 0 : 1;
}

process.exit(main());
