/**
 * test-matchup-intelligence-model.ts
 *
 * Deterministic synthetic tests for the matchup intelligence layer.
 * No external APIs. Pure CPU.
 *
 * Each scenario constructs a `MatchupIntelligenceInput`, runs
 * `buildMatchupAdjustment`, and asserts on:
 *   - projectedMeanMultiplier direction (and bounded magnitude)
 *   - projectedStdDevMultiplier direction
 *   - presence of expected reasons / risks
 *   - per-prop impact labels
 *   - the "matchup cannot force a bet alone" invariant
 */

import process from "node:process";
import { buildMatchupAdjustment } from "../src/lib/model/matchup-intelligence";
import {
  DEFENSIVE_ARCHETYPES,
  PLAYER_ROLE_ARCHETYPES,
  WEATHER_ARCHETYPES,
} from "../src/lib/model/matchup-intelligence-data";
import type {
  DefensiveArchetypeKey,
  ImpactLabel,
  MatchupAdjustmentOutput,
  MatchupIntelligenceInput,
  PlayerRoleArchetypeKey,
  WeatherArchetypeKey,
} from "../src/lib/model/matchup-intelligence-types";
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

interface ScenarioOverrides {
  propType: PropType;
  defensiveArchetype: DefensiveArchetypeKey;
  playerRoleArchetype: PlayerRoleArchetypeKey;
  weatherArchetype?: WeatherArchetypeKey;
  gameScript?: number;
  spreadFavor?: number;
  dataQualityScore?: number;
  roleStabilityScore?: number;
  separatorRating?: number;
  qbPressureSensitivity?: number;
  oLineContinuityRisk?: number;
  qbRushingCannibalization?: number;
}

function makeInput(overrides: ScenarioOverrides): MatchupIntelligenceInput {
  const def = DEFENSIVE_ARCHETYPES[overrides.defensiveArchetype];
  const role = {
    ...PLAYER_ROLE_ARCHETYPES[overrides.playerRoleArchetype],
  };
  if (overrides.separatorRating !== undefined) {
    role.separatorRating = overrides.separatorRating;
  }
  const weather = WEATHER_ARCHETYPES[overrides.weatherArchetype ?? "DOME_NEUTRAL"];
  return {
    propType: overrides.propType,
    playerRole: role,
    defensiveArchetype: overrides.defensiveArchetype,
    defensiveFunnel: { ...def.funnel },
    coverage: { ...def.coverage },
    pressure: {
      ...def.pressure,
      qbPressureSensitivity:
        overrides.qbPressureSensitivity ?? def.pressure.qbPressureSensitivity,
      oLineContinuityRisk:
        overrides.oLineContinuityRisk ?? def.pressure.oLineContinuityRisk,
    },
    runGame: {
      offenseRunTendency: 0.45,
      rushingAttemptStability: 0.7,
      rbCarryShareStability: 0.7,
      defenseLightBoxRate: def.funnel.lightBoxTendency,
      defenseRunSuccessAllowed: 0.5,
      gameScriptRushingSupport: overrides.gameScript !== undefined && overrides.gameScript >= 0 ? 0.65 : 0.45,
      weatherRushingSupport: 0.45,
      qbRushingCannibalization: overrides.qbRushingCannibalization ?? 0.2,
    },
    weather: { ...weather },
    dataQualityScore: overrides.dataQualityScore ?? 0.8,
    roleStabilityScore: overrides.roleStabilityScore ?? 0.8,
    gameScript: overrides.gameScript ?? 0,
    spreadFavor: overrides.spreadFavor ?? 0,
  };
}

function assertNoBetForcing(name: string, out: MatchupAdjustmentOutput): void {
  // Universal invariant: matchup mean multiplier must stay within
  // ±3%, and σ multiplier must be ≥ 1.0. With both bounds, applying
  // matchup σ widening can only make a thin edge worse, never
  // qualifying.
  check(
    `${name} — mean multiplier within ±3%`,
    out.projectedMeanMultiplier >= 0.97 - 1e-9 &&
      out.projectedMeanMultiplier <= 1.03 + 1e-9,
    `mean=${out.projectedMeanMultiplier.toFixed(4)}`,
  );
  check(
    `${name} — σ multiplier ≥ 1.0 (never narrows uncertainty)`,
    out.projectedStdDevMultiplier >= 1 - 1e-9,
    `σ×=${out.projectedStdDevMultiplier.toFixed(4)}`,
  );
}

function hasReason(out: MatchupAdjustmentOutput, fragment: string): boolean {
  const f = fragment.toLowerCase();
  return out.reasons.some((r) => r.toLowerCase().includes(f));
}

function hasRisk(out: MatchupAdjustmentOutput, fragment: string): boolean {
  const f = fragment.toLowerCase();
  return out.risks.some((r) => r.toLowerCase().includes(f));
}

function hasTag(out: MatchupAdjustmentOutput, tag: string): boolean {
  return out.matchupTags.includes(tag);
}

function impact(
  out: MatchupAdjustmentOutput,
  prop: PropType,
): ImpactLabel {
  return out.propImpacts[prop];
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// --- 1. Slot WR vs zone-heavy underneath -----------------------------
section("1. Slot WR vs zone-heavy underneath boosts receptions");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEPTIONS",
      defensiveArchetype: "ZONE_HEAVY_UNDERNEATH",
      playerRoleArchetype: "SLOT_VOLUME_WR",
    }),
  });
  assertNoBetForcing("1 slot-vs-zone", out);
  check("1 mean > 1.0", out.projectedMeanMultiplier > 1.0);
  check(
    "1 receptions impact is POSITIVE or STRONG_POSITIVE",
    impact(out, "RECEPTIONS") === "POSITIVE" ||
      impact(out, "RECEPTIONS") === "STRONG_POSITIVE",
  );
  check(
    "1 reason mentions slot / zone",
    hasReason(out, "slot") || hasReason(out, "zone"),
  );
}

// --- 2. Deep WR vs two-high downgrades receiving yards ---------------
section("2. Deep WR vs two-high downgrades receiving yards");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEIVING_YARDS",
      defensiveArchetype: "TWO_HIGH_DEEP_SUPPRESSION",
      playerRoleArchetype: "OUTSIDE_DEEP_WR",
    }),
  });
  assertNoBetForcing("2 deep-vs-2high", out);
  check("2 mean < 1.0", out.projectedMeanMultiplier < 1.0);
  check("2 σ > 1.0 (yardage volatility up)", out.projectedStdDevMultiplier > 1.0);
  check(
    "2 receiving yards impact is NEGATIVE or STRONG_NEGATIVE",
    impact(out, "RECEIVING_YARDS") === "NEGATIVE" ||
      impact(out, "RECEIVING_YARDS") === "STRONG_NEGATIVE",
  );
  check(
    "2 risk mentions deep or two-high",
    hasRisk(out, "deep") || hasRisk(out, "two-high"),
  );
}

// --- 3. RB vs light-box run funnel supports rushing yards ------------
section("3. Bell-cow RB vs run-funnel light-box supports rushing yards");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RUSHING_YARDS",
      defensiveArchetype: "RUN_FUNNEL_LIGHT_BOX",
      playerRoleArchetype: "BELL_COW_RB",
      gameScript: 0.2,
      spreadFavor: -3,
    }),
  });
  assertNoBetForcing("3 rb-vs-run-funnel", out);
  check("3 mean > 1.0", out.projectedMeanMultiplier > 1.0);
  check(
    "3 rushing yards impact is STRONG_POSITIVE",
    impact(out, "RUSHING_YARDS") === "STRONG_POSITIVE",
  );
  check(
    "3 reason mentions run funnel or light box",
    hasReason(out, "run") || hasReason(out, "light box"),
  );
}

// --- 4. RB rushing attempts NOT boosted when trailing heavily -------
section("4. RB rushing attempts not boosted if team trailing heavily");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RUSHING_ATTEMPTS",
      defensiveArchetype: "RUN_FUNNEL_LIGHT_BOX",
      playerRoleArchetype: "BELL_COW_RB",
      gameScript: -0.6,
      spreadFavor: 7,
    }),
  });
  assertNoBetForcing("4 rb-trailing", out);
  check(
    "4 mean does NOT receive run-funnel boost (≤ 1.005)",
    out.projectedMeanMultiplier <= 1.005,
    `mean=${out.projectedMeanMultiplier.toFixed(4)}`,
  );
  check(
    "4 risk mentions trailing / script",
    hasRisk(out, "trail") || hasRisk(out, "script"),
  );
}

// --- 5. QB passing yards downgraded vs pressure-with-four ------------
section("5. QB passing yards downgraded vs pressure-with-four defense");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "PASSING_YARDS",
      defensiveArchetype: "PRESSURE_WITH_FOUR",
      playerRoleArchetype: "POCKET_QB",
      qbPressureSensitivity: 0.7,
    }),
  });
  assertNoBetForcing("5 py-vs-pressure", out);
  check("5 mean < 1.0", out.projectedMeanMultiplier < 1.0);
  check(
    "5 passing yards impact is STRONG_NEGATIVE",
    impact(out, "PASSING_YARDS") === "STRONG_NEGATIVE",
  );
  check(
    "5 risk mentions pressure",
    hasRisk(out, "pressure"),
  );
}

// --- 6. PC less hurt than PY in pressure quick-game setup ------------
section("6. Completions less hurt than yards under heavy pressure");
{
  const pyOut = buildMatchupAdjustment({
    input: makeInput({
      propType: "PASSING_YARDS",
      defensiveArchetype: "PRESSURE_WITH_FOUR",
      playerRoleArchetype: "POCKET_QB",
      qbPressureSensitivity: 0.7,
    }),
  });
  const pcOut = buildMatchupAdjustment({
    input: makeInput({
      propType: "PASSING_COMPLETIONS",
      defensiveArchetype: "PRESSURE_WITH_FOUR",
      playerRoleArchetype: "POCKET_QB",
      qbPressureSensitivity: 0.7,
    }),
  });
  check(
    "6 PY mean drop > PC mean drop",
    1 - pyOut.projectedMeanMultiplier > 1 - pcOut.projectedMeanMultiplier,
    `py mean=${pyOut.projectedMeanMultiplier.toFixed(4)}, pc mean=${pcOut.projectedMeanMultiplier.toFixed(4)}`,
  );
  check(
    "6 PY σ widening > PC σ widening",
    pyOut.projectedStdDevMultiplier >= pcOut.projectedStdDevMultiplier,
  );
}

// --- 7. RB receptions boosted vs blitz-heavy defense -----------------
section("7. RB receptions boosted vs blitz-heavy defense");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEPTIONS",
      defensiveArchetype: "BLITZ_HEAVY",
      playerRoleArchetype: "RECEIVING_RB",
    }),
  });
  assertNoBetForcing("7 rb-rec-vs-blitz", out);
  check("7 mean > 1.0", out.projectedMeanMultiplier > 1.0);
  check(
    "7 receptions impact is POSITIVE or STRONG_POSITIVE",
    impact(out, "RECEPTIONS") === "POSITIVE" ||
      impact(out, "RECEPTIONS") === "STRONG_POSITIVE",
  );
  check(
    "7 reason mentions blitz or checkdown",
    hasReason(out, "blitz") || hasReason(out, "checkdown"),
  );
}

// --- 8. TE receptions boosted vs TE-funnel zone defense --------------
section("8. TE receptions boosted vs pass-funnel zone defense");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEPTIONS",
      defensiveArchetype: "PASS_FUNNEL_ZONE",
      playerRoleArchetype: "RECEIVING_TE",
    }),
  });
  assertNoBetForcing("8 te-vs-funnel", out);
  check("8 mean > 1.0", out.projectedMeanMultiplier > 1.0);
  check(
    "8 receptions impact is POSITIVE or STRONG_POSITIVE",
    impact(out, "RECEPTIONS") === "POSITIVE" ||
      impact(out, "RECEPTIONS") === "STRONG_POSITIVE",
  );
  check(
    "8 tag includes TE_FUNNEL_MATCH or TE_VS_FUNNEL",
    hasTag(out, "TE_FUNNEL_MATCH") || hasTag(out, "TE_VS_FUNNEL"),
  );
}

// --- 9. Outside deep WR vs weak-secondary explosive ------------------
section("9. Outside deep WR vs weak-secondary explosive defense");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEIVING_YARDS",
      defensiveArchetype: "WEAK_SECONDARY_EXPLOSIVE",
      playerRoleArchetype: "OUTSIDE_DEEP_WR",
    }),
  });
  assertNoBetForcing("9 deep-vs-weak", out);
  check("9 mean > 1.0", out.projectedMeanMultiplier > 1.0);
  check(
    "9 receiving yards impact is STRONG_POSITIVE",
    impact(out, "RECEIVING_YARDS") === "STRONG_POSITIVE",
  );
  check("9 reason mentions explosive or secondary", hasReason(out, "explosive") || hasReason(out, "secondary"));
}

// --- 10. Yardage σ penalty > volume σ penalty -----------------------
section("10. Yardage props get larger σ penalty than volume props");
{
  const yardageOut = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEIVING_YARDS",
      defensiveArchetype: "PRESSURE_WITH_FOUR",
      playerRoleArchetype: "OUTSIDE_DEEP_WR",
      qbPressureSensitivity: 0.7,
    }),
  });
  const volumeOut = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEPTIONS",
      defensiveArchetype: "PRESSURE_WITH_FOUR",
      playerRoleArchetype: "OUTSIDE_DEEP_WR",
      qbPressureSensitivity: 0.7,
    }),
  });
  check(
    "10 yardage σ widening ≥ volume σ widening",
    yardageOut.projectedStdDevMultiplier >=
      volumeOut.projectedStdDevMultiplier,
    `yds σ=${yardageOut.projectedStdDevMultiplier.toFixed(3)}, rec σ=${volumeOut.projectedStdDevMultiplier.toFixed(3)}`,
  );
}

// --- 11. Dome neutralizes weather ------------------------------------
section("11. Dome game neutralizes weather risk");
{
  const dome = buildMatchupAdjustment({
    input: makeInput({
      propType: "PASSING_YARDS",
      defensiveArchetype: "BALANCED_NEUTRAL",
      playerRoleArchetype: "POCKET_QB",
      weatherArchetype: "DOME_NEUTRAL",
    }),
  });
  assertNoBetForcing("11 dome", dome);
  check("11 tag includes DOME", hasTag(dome, "DOME"));
  check(
    "11 no wind / rain / snow risks",
    !hasRisk(dome, "wind") && !hasRisk(dome, "rain") && !hasRisk(dome, "snow"),
  );
  check("11 σ ≈ 1.0", Math.abs(dome.projectedStdDevMultiplier - 1) < 0.05);
}

// --- 12. Windy outdoor downgrades passing yards / receiving yards ---
section("12. Windy outdoor downgrades passing yards and receiving yards");
{
  const py = buildMatchupAdjustment({
    input: makeInput({
      propType: "PASSING_YARDS",
      defensiveArchetype: "BALANCED_NEUTRAL",
      playerRoleArchetype: "POCKET_QB",
      weatherArchetype: "WINDY_OUTDOOR",
    }),
  });
  check("12 PY mean < 1.0", py.projectedMeanMultiplier < 1.0);
  check("12 PY σ > 1.0", py.projectedStdDevMultiplier > 1.0);
  check("12 PY risk mentions wind", hasRisk(py, "wind"));
  const ry = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEIVING_YARDS",
      defensiveArchetype: "BALANCED_NEUTRAL",
      playerRoleArchetype: "OUTSIDE_DEEP_WR",
      weatherArchetype: "WINDY_OUTDOOR",
    }),
  });
  check("12 RY mean < 1.0", ry.projectedMeanMultiplier < 1.0);
  check("12 RY σ > 1.0", ry.projectedStdDevMultiplier > 1.0);
}

// --- 13. Windy outdoor doesn't kill short-area receptions -----------
section("13. Windy outdoor does NOT kill short-area receptions");
{
  const rec = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEPTIONS",
      defensiveArchetype: "BALANCED_NEUTRAL",
      playerRoleArchetype: "SLOT_VOLUME_WR",
      weatherArchetype: "WINDY_OUTDOOR",
    }),
  });
  check(
    "13 reception mean stays at ≥ 0.99",
    rec.projectedMeanMultiplier >= 0.99,
    `mean=${rec.projectedMeanMultiplier.toFixed(4)}`,
  );
}

// --- 14. Strong run defense downgrades rushing yards -----------------
section("14. Strong run defense downgrades rushing yards");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RUSHING_YARDS",
      defensiveArchetype: "STRONG_RUN_DEFENSE",
      playerRoleArchetype: "BELL_COW_RB",
    }),
  });
  assertNoBetForcing("14 ry-vs-run-def", out);
  check("14 mean < 1.0", out.projectedMeanMultiplier < 1.0);
  check("14 σ > 1.0", out.projectedStdDevMultiplier > 1.0);
  check(
    "14 rushing yards impact STRONG_NEGATIVE",
    impact(out, "RUSHING_YARDS") === "STRONG_NEGATIVE",
  );
}

// --- 15. RB attempts can still hold vs strong run defense as favorite-
section("15. Heavy-favorite RB attempts still hold vs strong run defense");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RUSHING_ATTEMPTS",
      defensiveArchetype: "STRONG_RUN_DEFENSE",
      playerRoleArchetype: "BELL_COW_RB",
      gameScript: 0.4,
      spreadFavor: -7,
    }),
  });
  check(
    "15 reason mentions favorite / can hold",
    hasReason(out, "favorite") || hasReason(out, "can hold") || hasReason(out, "script supports"),
  );
}

// --- 16. Man-heavy: elite separator vs weak separator ---------------
section("16. Man-heavy supports elite separator, downgrades weak");
{
  const elite = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEIVING_YARDS",
      defensiveArchetype: "MAN_HEAVY",
      playerRoleArchetype: "OUTSIDE_DEEP_WR",
      separatorRating: 0.85,
    }),
  });
  const weak = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEIVING_YARDS",
      defensiveArchetype: "MAN_HEAVY",
      playerRoleArchetype: "POSSESSION_WR",
      separatorRating: 0.25,
    }),
  });
  check(
    "16 elite mean > weak mean",
    elite.projectedMeanMultiplier > weak.projectedMeanMultiplier,
    `elite=${elite.projectedMeanMultiplier.toFixed(4)}, weak=${weak.projectedMeanMultiplier.toFixed(4)}`,
  );
  check(
    "16 elite reason mentions separator",
    hasReason(elite, "separator"),
  );
  check(
    "16 weak risk mentions separator or matchup",
    hasRisk(weak, "separator"),
  );
}

// --- 17. OL injury risk downgrades deep passing ---------------------
section("17. OL injury risk downgrades passing yards");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "PASSING_YARDS",
      defensiveArchetype: "BALANCED_NEUTRAL",
      playerRoleArchetype: "POCKET_QB",
      oLineContinuityRisk: 0.7,
    }),
  });
  assertNoBetForcing("17 ol-injury", out);
  check("17 mean < 1.0", out.projectedMeanMultiplier < 1.0);
  check("17 σ > 1.0", out.projectedStdDevMultiplier > 1.0);
  check(
    "17 risk mentions offensive line",
    hasRisk(out, "offensive line") || hasRisk(out, "ol"),
  );
}

// --- 18. Mobile QB cannibalization downgrades RB rushing ------------
section("18. Mobile QB cannibalization downgrades RB rushing confidence");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "RUSHING_YARDS",
      defensiveArchetype: "BALANCED_NEUTRAL",
      playerRoleArchetype: "BELL_COW_RB",
      qbRushingCannibalization: 0.7,
    }),
  });
  assertNoBetForcing("18 qb-canniba", out);
  check("18 mean < 1.0", out.projectedMeanMultiplier < 1.0);
  check(
    "18 confidence adjustment < 0",
    out.confidenceAdjustment < 0,
  );
  check(
    "18 risk mentions cannibalization or mobile",
    hasRisk(out, "cannibalize") ||
      hasRisk(out, "mobile") ||
      hasRisk(out, "qb"),
  );
}

// --- 19. Low data quality caps matchup adjustment -------------------
section("19. Low data quality caps matchup adjustment");
{
  const high = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEIVING_YARDS",
      defensiveArchetype: "WEAK_SECONDARY_EXPLOSIVE",
      playerRoleArchetype: "OUTSIDE_DEEP_WR",
      dataQualityScore: 0.85,
    }),
  });
  const low = buildMatchupAdjustment({
    input: makeInput({
      propType: "RECEIVING_YARDS",
      defensiveArchetype: "WEAK_SECONDARY_EXPLOSIVE",
      playerRoleArchetype: "OUTSIDE_DEEP_WR",
      dataQualityScore: 0.35,
    }),
  });
  check(
    "19 low-DQ mean adjustment magnitude < high-DQ",
    Math.abs(low.projectedMeanMultiplier - 1) <
      Math.abs(high.projectedMeanMultiplier - 1),
    `low=${low.projectedMeanMultiplier.toFixed(4)}, high=${high.projectedMeanMultiplier.toFixed(4)}`,
  );
  check(
    "19 low-DQ σ widening ≤ high-DQ σ widening",
    low.projectedStdDevMultiplier <= high.projectedStdDevMultiplier + 1e-9,
  );
}

// --- 20. Balanced neutral returns no meaningful adjustment ----------
section("20. Balanced neutral matchup returns near-neutral adjustment");
{
  const out = buildMatchupAdjustment({
    input: makeInput({
      propType: "PASSING_YARDS",
      defensiveArchetype: "BALANCED_NEUTRAL",
      playerRoleArchetype: "POCKET_QB",
      weatherArchetype: "DOME_NEUTRAL",
    }),
  });
  check(
    "20 mean within ±1%",
    Math.abs(out.projectedMeanMultiplier - 1) <= 0.01,
    `mean=${out.projectedMeanMultiplier.toFixed(4)}`,
  );
  check(
    "20 σ within +5%",
    out.projectedStdDevMultiplier <= 1.05,
  );
  check(
    "20 propImpacts mostly NEUTRAL",
    Object.values(out.propImpacts).filter((v) => v === "NEUTRAL").length >= 6,
  );
}

// --- summary --------------------------------------------------------
const total = passCount + failures.length;
const color = failures.length === 0 ? C_GREEN : C_RED;
console.log(
  `\n${color}${passCount}/${total} matchup-intelligence assertions passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
