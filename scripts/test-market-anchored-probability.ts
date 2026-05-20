/**
 * test-market-anchored-probability.ts
 *
 * Deterministic assertions for the market-anchored probability layer.
 * No external APIs.
 *
 * Universal invariants asserted in every scenario:
 *   - output never forces a recommendation (no `recommendation` /
 *     `forcedSide` / `direction` field on the output)
 *   - finalModelProbability ∈ [0, 1]
 *   - |cappedFootballAdjustmentPp| ≤ |rawFootballAdjustmentPp| + 1e-9
 *   - disagreementScore = |cappedFootballAdjustmentPp|
 */

import process from "node:process";
import {
  buildMarketAnchoredProbability,
  calculateConfidenceAdjustedEdge,
  calculateDisagreementScore,
  calculateRawFootballAdjustment,
  capFootballAdjustment,
  classifyMarketDisagreement,
  type FootballAdjustmentComponent,
  type MarketAnchoredProbabilityInput,
  type MarketAnchoredProbabilityOutput,
} from "../src/lib/model/market-anchored-probability";
import type { PropType } from "../src/lib/types";

const useColor = process.stdout.isTTY === true;
const C_GREEN = useColor ? "\x1b[32m" : "";
const C_RED = useColor ? "\x1b[31m" : "";
const C_RESET = useColor ? "\x1b[0m" : "";

let passCount = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ${C_GREEN}[PASS]${C_RESET} ${name}`);
    passCount++;
  } else {
    console.log(
      `  ${C_RED}[FAIL]${C_RESET} ${name}${detail ? ` — ${detail}` : ""}`,
    );
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

function assertUniversalInvariants(
  name: string,
  out: MarketAnchoredProbabilityOutput,
): void {
  check(
    `${name}: finalModelProbability ∈ [0, 1]`,
    out.finalModelProbability >= 0 && out.finalModelProbability <= 1,
  );
  check(
    `${name}: |capped| ≤ |raw|`,
    Math.abs(out.cappedFootballAdjustmentPp) <=
      Math.abs(out.rawFootballAdjustmentPp) + 1e-9,
  );
  check(
    `${name}: disagreementScore = |capped|`,
    Math.abs(out.disagreementScore - Math.abs(out.cappedFootballAdjustmentPp)) <
      1e-9,
  );
  check(
    `${name}: no recommendation / forcedSide / direction field`,
    !("recommendation" in out) &&
      !("forcedSide" in out) &&
      !("direction" in out),
  );
  check(
    `${name}: classification is a known label`,
    [
      "MARKET_ALIGNED",
      "SMALL_EDGE",
      "HEALTHY_DISAGREEMENT",
      "DANGEROUS_DISAGREEMENT",
      "LIKELY_OVERCONFIDENT",
    ].includes(out.disagreementClassification),
  );
}

function input(args: {
  propType?: PropType;
  market?: number;
  confidence?: number;
  riskScore?: number;
  dataQualityScore?: number;
  components: FootballAdjustmentComponent[];
}): MarketAnchoredProbabilityInput {
  return {
    propType: args.propType ?? "RECEPTIONS",
    marketProbability: args.market ?? 0.5,
    confidence: args.confidence ?? 0.7,
    riskScore: args.riskScore ?? 0.75,
    dataQualityScore: args.dataQualityScore ?? 0.8,
    components: args.components,
  };
}

// --- 1. Market aligned: no meaningful edge --------------------------
section("1. Market aligned — no meaningful adjustment");
{
  const out = buildMarketAnchoredProbability(
    input({
      components: [
        { name: "role", deltaPp: 0.2, confidence: 0.6, independent: true },
        { name: "weather", deltaPp: -0.1, confidence: 0.5, independent: true },
      ],
    }),
  );
  assertUniversalInvariants("1", out);
  check("1 classification MARKET_ALIGNED", out.disagreementClassification === "MARKET_ALIGNED");
  check("1 |capped| < 1pp", Math.abs(out.cappedFootballAdjustmentPp) < 1);
}

// --- 2. Strong role + game-script create modest adjustment ----------
section("2. Strong role + game-script support: modest positive adjustment");
{
  const out = buildMarketAnchoredProbability(
    input({
      propType: "RECEPTIONS",
      market: 0.5,
      confidence: 0.7,
      components: [
        {
          name: "role_stability",
          deltaPp: 3,
          confidence: 0.8,
          independent: true,
        },
        {
          name: "game_script",
          deltaPp: 2.5,
          confidence: 0.7,
          independent: true,
        },
      ],
    }),
  );
  assertUniversalInvariants("2", out);
  check("2 finalModelProbability > market", out.finalModelProbability > 0.5);
  check(
    "2 |capped| within volume default 8pp",
    Math.abs(out.cappedFootballAdjustmentPp) <= 8,
  );
  check(
    "2 classification SMALL_EDGE or HEALTHY",
    out.disagreementClassification === "SMALL_EDGE" ||
      out.disagreementClassification === "HEALTHY_DISAGREEMENT",
  );
}

// --- 3. Low data quality caps adjustment to 2pp ---------------------
section("3. Low data quality (0.40) caps adjustment to 2pp");
{
  const out = buildMarketAnchoredProbability(
    input({
      dataQualityScore: 0.4,
      components: [
        { name: "role", deltaPp: 5, confidence: 0.85, independent: true },
        { name: "matchup", deltaPp: 4, confidence: 0.8, independent: true },
      ],
    }),
  );
  assertUniversalInvariants("3", out);
  check(
    "3 |capped| ≤ 2pp",
    Math.abs(out.cappedFootballAdjustmentPp) <= 2 + 1e-9,
  );
  check("3 cap reason mentions data quality", (out.capAppliedReason ?? "").toLowerCase().includes("data quality"));
  check("3 risk note records the cap", out.risks.some((r) => r.toLowerCase().includes("data quality")));
}

// --- 4. High risk caps adjustment to 3pp ---------------------------
section("4. Low riskScore (0.40) caps adjustment to 3pp");
{
  const out = buildMarketAnchoredProbability(
    input({
      riskScore: 0.4,
      components: [
        { name: "role", deltaPp: 6, confidence: 0.85, independent: true },
        { name: "matchup", deltaPp: 4, confidence: 0.8, independent: true },
      ],
    }),
  );
  assertUniversalInvariants("4", out);
  check(
    "4 |capped| ≤ 3pp",
    Math.abs(out.cappedFootballAdjustmentPp) <= 3 + 1e-9,
  );
  check(
    "4 cap reason mentions risk",
    (out.capAppliedReason ?? "").toLowerCase().includes("risk"),
  );
}

// --- 5. Yardage cap tighter than volume cap -------------------------
section("5. Yardage prop capped tighter than volume prop (same inputs)");
{
  const components: FootballAdjustmentComponent[] = [
    { name: "role", deltaPp: 6, confidence: 0.8, independent: true },
    { name: "matchup", deltaPp: 5, confidence: 0.75, independent: true },
    { name: "game_script", deltaPp: 4, confidence: 0.7, independent: true },
  ];
  const volume = buildMarketAnchoredProbability(
    input({ propType: "RECEPTIONS", confidence: 0.7, components }),
  );
  const yardage = buildMarketAnchoredProbability(
    input({ propType: "RECEIVING_YARDS", confidence: 0.7, components }),
  );
  assertUniversalInvariants("5-volume", volume);
  assertUniversalInvariants("5-yardage", yardage);
  check(
    "5 yardage capped ≤ volume capped",
    Math.abs(yardage.cappedFootballAdjustmentPp) <=
      Math.abs(volume.cappedFootballAdjustmentPp) + 1e-9,
    `vol=${volume.cappedFootballAdjustmentPp.toFixed(2)} yds=${yardage.cappedFootballAdjustmentPp.toFixed(2)}`,
  );
}

// --- 6. Multiple strong independent signals → larger cap ------------
section("6. Multiple strong independent agreeing signals allow up to 10-12pp");
{
  const out = buildMarketAnchoredProbability(
    input({
      propType: "RECEPTIONS",
      market: 0.5,
      confidence: 0.85,
      riskScore: 0.85,
      dataQualityScore: 0.85,
      components: [
        { name: "role", deltaPp: 4, confidence: 0.85, independent: true },
        { name: "matchup", deltaPp: 3.5, confidence: 0.8, independent: true },
        { name: "game_script", deltaPp: 3, confidence: 0.75, independent: true },
        { name: "pace", deltaPp: 3, confidence: 0.7, independent: true },
      ],
    }),
  );
  assertUniversalInvariants("6", out);
  check(
    "6 capped between 8 and 12pp (uses max cap, not default)",
    out.cappedFootballAdjustmentPp >= 8 &&
      out.cappedFootballAdjustmentPp <= 12 + 1e-9,
    `capped=${out.cappedFootballAdjustmentPp.toFixed(2)}`,
  );
}

// --- 7. Huge disagreement → overconfidence warning ------------------
section("7. Raw football adjustment > 12pp triggers overconfidence warning");
{
  const out = buildMarketAnchoredProbability(
    input({
      market: 0.45,
      confidence: 0.9,
      components: [
        { name: "role", deltaPp: 10, confidence: 0.9, independent: true },
        { name: "matchup", deltaPp: 8, confidence: 0.85, independent: true },
      ],
    }),
  );
  assertUniversalInvariants("7", out);
  check(
    "7 classification LIKELY_OVERCONFIDENT",
    out.disagreementClassification === "LIKELY_OVERCONFIDENT",
  );
  check(
    "7 risks include overconfidence warning",
    out.risks.some((r) => r.toLowerCase().includes("overconfidence")),
  );
  check(
    "7 capped to ≤ 12pp even though raw > 12pp",
    Math.abs(out.cappedFootballAdjustmentPp) <= 12 + 1e-9,
  );
}

// --- 8. Coaching uncertainty reduces confidence-adjusted edge ------
section("8. High risk (coaching uncertainty) reduces confidence-adjusted edge");
{
  const components: FootballAdjustmentComponent[] = [
    { name: "matchup", deltaPp: 4, confidence: 0.7, independent: true },
    { name: "role", deltaPp: 3, confidence: 0.7, independent: true },
  ];
  const clean = buildMarketAnchoredProbability(
    input({
      confidence: 0.8,
      riskScore: 0.85,
      components,
    }),
  );
  const coachingRisky = buildMarketAnchoredProbability(
    input({
      confidence: 0.55,
      riskScore: 0.55,
      components,
    }),
  );
  assertUniversalInvariants("8-clean", clean);
  assertUniversalInvariants("8-coaching-risk", coachingRisky);
  check(
    "8 risky confidence-adjusted edge < clean confidence-adjusted edge",
    Math.abs(coachingRisky.confidenceAdjustedEdgePp) <
      Math.abs(clean.confidenceAdjustedEdgePp),
    `clean=${clean.confidenceAdjustedEdgePp.toFixed(2)} risky=${coachingRisky.confidenceAdjustedEdgePp.toFixed(2)}`,
  );
  check(
    "8 risky |confidence-adj| < |raw edge|",
    Math.abs(coachingRisky.confidenceAdjustedEdgePp) <
      Math.abs(coachingRisky.rawEdgePp) + 1e-9,
  );
}

// --- 9. Single proxy alone cannot create big adjustment -------------
section("9. Single proxy signal alone cannot push above default volume cap");
{
  const out = buildMarketAnchoredProbability(
    input({
      propType: "RECEPTIONS",
      confidence: 0.6,
      components: [
        {
          // Aggressive proxy: large delta and high per-component
          // confidence, but only ONE signal — cap should still hold
          // at the volume default since multiple-agreeing-signal
          // bonus requires 2+ independent components.
          name: "proxy_slot",
          deltaPp: 18,
          confidence: 0.85,
          independent: true,
        },
      ],
    }),
  );
  assertUniversalInvariants("9", out);
  check(
    "9 |capped| ≤ default volume cap 8pp",
    Math.abs(out.cappedFootballAdjustmentPp) <= 8 + 1e-9,
    `capped=${out.cappedFootballAdjustmentPp.toFixed(2)}`,
  );
  check(
    "9 cap reason recorded (single signal got capped)",
    out.capAppliedReason !== undefined,
  );
}

// --- 10. Matchup + role stability can support adjustment ------------
section("10. Matchup + role stability together support a meaningful adjustment");
{
  const out = buildMarketAnchoredProbability(
    input({
      propType: "RECEPTIONS",
      market: 0.5,
      confidence: 0.75,
      components: [
        { name: "matchup_intel", deltaPp: 3.5, confidence: 0.75, independent: true, explanation: "Slot vs zone-heavy" },
        { name: "role_stability", deltaPp: 3, confidence: 0.85, independent: true, explanation: "Snap share trending up" },
      ],
    }),
  );
  assertUniversalInvariants("10", out);
  check("10 finalModelProbability > market", out.finalModelProbability > 0.5);
  check(
    "10 classification is SMALL_EDGE or HEALTHY_DISAGREEMENT",
    out.disagreementClassification === "SMALL_EDGE" ||
      out.disagreementClassification === "HEALTHY_DISAGREEMENT",
  );
  check(
    "10 reasons include matchup explanation",
    out.reasons.some((r) => r.toLowerCase().includes("slot")),
  );
}

// --- 11. Negative weather/injury lowers final probability -----------
section("11. Negative weather + injury lower final probability below market");
{
  const out = buildMarketAnchoredProbability(
    input({
      propType: "PASSING_YARDS",
      market: 0.55,
      confidence: 0.75,
      components: [
        { name: "weather", deltaPp: -4, confidence: 0.8, independent: true, explanation: "20 mph wind outdoors" },
        { name: "injury", deltaPp: -2.5, confidence: 0.7, independent: true, explanation: "WR1 questionable" },
      ],
    }),
  );
  assertUniversalInvariants("11", out);
  check("11 finalModelProbability < market", out.finalModelProbability < 0.55);
  check(
    "11 capped is negative",
    out.cappedFootballAdjustmentPp < 0,
  );
  check(
    "11 reasons include weather explanation",
    out.reasons.some((r) => r.toLowerCase().includes("wind")),
  );
}

// --- 12. Confidence-adjusted edge < raw edge when risk elevated -----
section("12. Confidence-adjusted edge shrinks vs raw when risk is elevated");
{
  const components: FootballAdjustmentComponent[] = [
    { name: "role", deltaPp: 5, confidence: 0.8, independent: true },
    { name: "matchup", deltaPp: 3, confidence: 0.7, independent: true },
  ];
  const elevated = buildMarketAnchoredProbability(
    input({
      confidence: 0.6,
      riskScore: 0.55,
      components,
    }),
  );
  assertUniversalInvariants("12", elevated);
  check(
    "12 |confidence-adjusted edge| < |raw edge|",
    Math.abs(elevated.confidenceAdjustedEdgePp) <
      Math.abs(elevated.rawEdgePp) + 1e-9,
    `raw=${elevated.rawEdgePp.toFixed(2)} ca=${elevated.confidenceAdjustedEdgePp.toFixed(2)}`,
  );
}

// --- 13. Bonus: per-function exports work ---------------------------
section("13. Standalone helper functions are individually invokable");
{
  const components: FootballAdjustmentComponent[] = [
    { name: "role", deltaPp: 4, confidence: 0.7, independent: true },
    { name: "weather", deltaPp: -2, confidence: 0.6, independent: true },
  ];
  const raw = calculateRawFootballAdjustment(components);
  check(
    "13 raw = sum(deltaPp × confidence)",
    Math.abs(raw - (4 * 0.7 + -2 * 0.6)) < 1e-9,
  );
  const cap = capFootballAdjustment(raw, {
    propType: "RECEPTIONS",
    confidence: 0.7,
    riskScore: 0.8,
    dataQualityScore: 0.8,
    components,
  });
  check("13 capFootballAdjustment returns numeric appliedCapPp", typeof cap.appliedCapPp === "number");
  const cae = calculateConfidenceAdjustedEdge(5, { confidence: 0.5, riskScore: 0.6 });
  check("13 calculateConfidenceAdjustedEdge < raw for low confidence", cae < 5);
  check(
    "13 calculateDisagreementScore is absolute",
    calculateDisagreementScore(-3.5) === 3.5,
  );
  check(
    "13 classifyMarketDisagreement handles known cases",
    classifyMarketDisagreement({
      rawAdjustmentPp: 0.3,
      cappedAdjustmentPp: 0.3,
      confidence: 0.7,
    }) === "MARKET_ALIGNED" &&
      classifyMarketDisagreement({
        rawAdjustmentPp: 20,
        cappedAdjustmentPp: 8,
        confidence: 0.7,
      }) === "LIKELY_OVERCONFIDENT",
  );
}

// --- summary --------------------------------------------------------
const total = passCount + failures.length;
const color = failures.length === 0 ? C_GREEN : C_RED;
console.log(
  `\n${color}${passCount}/${total} market-anchored-probability assertions passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
