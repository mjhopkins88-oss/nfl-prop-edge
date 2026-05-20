/**
 * test-proxy-football-calibration.ts
 *
 * False-positive resistance and calibration tests for the proxy
 * framework. Every scenario asserts:
 *   - value direction (high for valid case, low for false positive)
 *   - confidence direction (calibrated: low for thin samples, capped
 *     for indirect / fallback data)
 *   - risk presence when appropriate
 *   - explanation starts with "Proxy-based:"
 *   - no recommendation / forcing surface anywhere
 *   - value ∈ [0, 1] and confidence ∈ [0, 0.95]
 *
 * No external APIs. Pure CPU.
 */

import process from "node:process";
import {
  buildPlayerRoleProxies,
  calculateDeepPassSuppressionProxy,
  calculateDeepReceiverProxy,
  calculatePassFunnelProxy,
  calculatePossessionReceiverProxy,
  calculatePressureRiskProxy,
  calculateQuickGameProxy,
  calculateRbReceivingRoleProxy,
  calculateRunFunnelProxy,
  calculateRushingVolumeStabilityProxy,
  calculateSlotRoleProxy,
  calculateTargetShareStabilityProxy,
  calculateTeReceivingRoleProxy,
  type DefenseProxyInput,
  type OffenseProxyInput,
  type PlayerProxyInput,
  type ProxyResult,
} from "../src/lib/model/proxy-football-features";

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

function startsWithProxyBased(r: ProxyResult): boolean {
  return r.explanation.startsWith("Proxy-based:");
}

function isBounded(r: ProxyResult): boolean {
  return (
    r.value >= 0 &&
    r.value <= 1 &&
    r.confidence >= 0 &&
    r.confidence <= 0.95
  );
}

function noForcingSurface(r: ProxyResult): boolean {
  return !("recommendation" in r) && !("forcedSide" in r);
}

function assertInvariants(name: string, r: ProxyResult): void {
  check(`${name}: explanation starts with Proxy-based`, startsWithProxyBased(r));
  check(`${name}: value/confidence bounded`, isBounded(r));
  check(`${name}: no recommendation field`, noForcingSurface(r));
}

// ----- 1. Slot WR: valid vs false positive ---------------------------
section("1. Slot WR — valid strong profile vs false positive (low TS)");
{
  const validSlot: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 38,
    receptions: 28,
    receivingYards: 218,
    airYards: 5 * 38,
    teamTargets: 175,
    teamAirYards: 1600,
    snapShare: 0.78,
    carries: 0,
    carryShare: 0,
  };
  const valid = calculateSlotRoleProxy(validSlot);
  assertInvariants("1-valid slot", valid);
  check("1-valid slot value >= 0.65", valid.value >= 0.65);
  check("1-valid slot confidence >= 0.5", valid.confidence >= 0.5);
  check("1-valid slot tag SLOT_VOLUME_LIKELY", valid.tags.includes("SLOT_VOLUME_LIKELY"));

  // False positive: low aDOT, tiny target share (4%).
  const falsePos: PlayerProxyInput = {
    ...validSlot,
    targets: 7,
    receptions: 5,
    teamTargets: 175, // 4% TS
    airYards: 5 * 7,
  };
  const fp = calculateSlotRoleProxy(falsePos);
  assertInvariants("1-false-positive slot", fp);
  check("1-FP slot value < 0.65 (below 'likely' band)", fp.value < 0.65, `v=${fp.value.toFixed(3)}`);
  check("1-FP slot no SLOT_VOLUME_LIKELY tag", !fp.tags.includes("SLOT_VOLUME_LIKELY"));
  check("1-FP slot has risk note", fp.risk !== undefined);
}

// ----- 2. Deep WR: valid vs false positive ---------------------------
section("2. Deep WR — valid strong profile vs false positive (tiny sample)");
{
  const validDeep: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 30,
    receptions: 14,
    receivingYards: 380,
    airYards: 15 * 30,
    teamTargets: 175,
    teamAirYards: 1500,
    snapShare: 0.85,
    carries: 0,
    carryShare: 0,
  };
  const valid = calculateDeepReceiverProxy(validDeep);
  assertInvariants("2-valid deep", valid);
  check("2-valid deep value >= 0.65", valid.value >= 0.65);
  check("2-valid deep tag DEEP_THREAT_LIKELY", valid.tags.includes("DEEP_THREAT_LIKELY"));
  check("2-valid deep confidence >= 0.5", valid.confidence >= 0.5);

  // False positive: only 3 targets but at deep aDOT.
  const fpInput: PlayerProxyInput = {
    ...validDeep,
    games: 2,
    targets: 3,
    receptions: 1,
    receivingYards: 48,
    airYards: 16 * 3,
    teamTargets: 70,
  };
  const fp = calculateDeepReceiverProxy(fpInput);
  assertInvariants("2-FP deep", fp);
  check("2-FP deep confidence < 0.5", fp.confidence < 0.5, `c=${fp.confidence.toFixed(3)}`);
  check("2-FP deep no DEEP_THREAT_LIKELY tag", !fp.tags.includes("DEEP_THREAT_LIKELY"));
  check("2-FP deep has risk note", fp.risk !== undefined);
}

// ----- 3. Possession WR — valid vs false positive (stable tiny share)
section("3. Possession WR — valid vs false positive (stable but tiny target share)");
{
  const valid: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 36,
    receptions: 27,
    receivingYards: 308,
    airYards: 10 * 36,
    teamTargets: 160,
    teamAirYards: 1500,
    snapShare: 0.9,
    carries: 0,
    carryShare: 0,
    weekTargetShares: [0.21, 0.22, 0.2, 0.23, 0.22],
  };
  const r = calculatePossessionReceiverProxy(valid);
  assertInvariants("3-valid possession", r);
  check("3-valid possession value >= 0.65", r.value >= 0.65);
  check("3-valid possession tag", r.tags.includes("POSSESSION_RECEIVER_LIKELY"));

  // False positive: stable 2% share — stable but useless.
  const fpInput: PlayerProxyInput = {
    ...valid,
    targets: 9,
    receptions: 6,
    weekTargetShares: [0.02, 0.02, 0.02, 0.02, 0.02],
  };
  const fp = calculateTargetShareStabilityProxy(fpInput);
  assertInvariants("3-FP stability", fp);
  check("3-FP stability value < 0.4 (stable but meaningless)", fp.value < 0.4, `v=${fp.value.toFixed(3)}`);
  check("3-FP stability flagged TINY_SHARE_NOT_MEANINGFUL", fp.tags.includes("TINY_SHARE_NOT_MEANINGFUL"));
}

// ----- 4. Receiving RB — valid vs false positive (1-game sample) ----
section("4. Receiving RB — valid vs false positive (1-game sample)");
{
  const valid: PlayerProxyInput = {
    position: "RB",
    games: 5,
    targets: 25,
    receptions: 21,
    receivingYards: 168,
    airYards: 4 * 25,
    teamTargets: 175,
    teamAirYards: 1500,
    snapShare: 0.72,
    carries: 75,
    carryShare: 0.55,
  };
  const r = calculateRbReceivingRoleProxy(valid);
  assertInvariants("4-valid receiving RB", r);
  check("4-valid receiving RB value >= 0.65", r.value >= 0.65);
  check("4-valid receiving RB tag", r.tags.includes("RECEIVING_RB_LIKELY"));

  const fp: PlayerProxyInput = {
    ...valid,
    games: 1,
    targets: 8,
    receptions: 7,
  };
  const fpr = calculateRbReceivingRoleProxy(fp);
  assertInvariants("4-FP receiving RB", fpr);
  check("4-FP receiving RB confidence < 0.5", fpr.confidence < 0.5, `c=${fpr.confidence.toFixed(3)}`);
  check("4-FP receiving RB has risk", fpr.risk !== undefined);
}

// ----- 5. Receiving TE — valid + WR on TE proxy returns NOT_APPLICABLE
section("5. Receiving TE — valid strong profile (+ WR on TE proxy = NOT_APPLICABLE)");
{
  const valid: PlayerProxyInput = {
    position: "TE",
    games: 5,
    targets: 32,
    receptions: 24,
    receivingYards: 296,
    airYards: 9 * 32,
    teamTargets: 160,
    teamAirYards: 1500,
    snapShare: 0.86,
    carries: 0,
    carryShare: 0,
  };
  const r = calculateTeReceivingRoleProxy(valid);
  assertInvariants("5-valid TE", r);
  check("5-valid TE value >= 0.65", r.value >= 0.65);
  check("5-valid TE tag", r.tags.includes("RECEIVING_TE_LIKELY"));

  const wrAsTe: PlayerProxyInput = { ...valid, position: "WR" };
  const r2 = calculateTeReceivingRoleProxy(wrAsTe);
  assertInvariants("5-WR-on-TE", r2);
  check("5-WR-on-TE NOT_APPLICABLE tag", r2.tags.includes("NOT_APPLICABLE"));
  check("5-WR-on-TE value=0", r2.value === 0);
}

// ----- 6. Pass funnel — EPA-supported vs script-only ----------------
section("6. Pass funnel — EPA-supported valid vs script-only false positive");
{
  const valid: DefenseProxyInput = {
    games: 6,
    passAttemptsFaced: 240,
    rushAttemptsFaced: 120,
    sacksGenerated: 12,
    epaPerDropbackAllowed: 0.09,
  };
  const r = calculatePassFunnelProxy(valid);
  assertInvariants("6-valid pass funnel", r);
  check("6-valid pass funnel value >= 0.65", r.value >= 0.65, `v=${r.value.toFixed(3)}`);
  check("6-valid pass funnel tag", r.tags.includes("PASS_FUNNEL_LIKELY"));

  const scriptOnly: DefenseProxyInput = {
    ...valid,
    epaPerDropbackAllowed: undefined,
  };
  const fp = calculatePassFunnelProxy(scriptOnly);
  assertInvariants("6-FP script-only", fp);
  check("6-FP no PASS_FUNNEL_LIKELY tag", !fp.tags.includes("PASS_FUNNEL_LIKELY"));
  check("6-FP has SCRIPT_FALLBACK tag", fp.tags.includes("PASS_FUNNEL_SCRIPT_FALLBACK"));
  check("6-FP confidence <= 0.5", fp.confidence <= 0.5);
  check("6-FP has risk note", fp.risk !== undefined);
}

// ----- 7. Run funnel — rush-EPA-supported ---------------------------
section("7. Run funnel — rush-EPA-supported valid case");
{
  const valid: DefenseProxyInput = {
    games: 6,
    passAttemptsFaced: 170,
    rushAttemptsFaced: 200,
    sacksGenerated: 9,
    epaPerRushAllowed: 0.08,
  };
  const r = calculateRunFunnelProxy(valid);
  assertInvariants("7-valid run funnel", r);
  check("7-valid run funnel value >= 0.65", r.value >= 0.65, `v=${r.value.toFixed(3)}`);
  check("7-valid run funnel tag", r.tags.includes("RUN_FUNNEL_LIKELY"));
}

// ----- 8. Deep pass suppression — primary vs fallback ----------------
section("8. Deep pass suppression — primary signal vs fallback / tiny sample");
{
  const valid: DefenseProxyInput = {
    games: 6,
    passAttemptsFaced: 220,
    rushAttemptsFaced: 140,
    sacksGenerated: 13,
    deepCompletionsAllowed: 5,
    deepCompletionsLeagueExpected: 18,
    epaPerDropbackAllowed: -0.01,
  };
  const r = calculateDeepPassSuppressionProxy(valid);
  assertInvariants("8-valid deep suppression", r);
  check("8-valid deep suppression value >= 0.65", r.value >= 0.65);
  check("8-valid deep suppression tag", r.tags.includes("DEEP_SUPPRESSION_LIKELY"));

  // Fallback only — EPA-allowed but no deep-completions data.
  const fallback: DefenseProxyInput = {
    games: 6,
    passAttemptsFaced: 200,
    rushAttemptsFaced: 140,
    sacksGenerated: 13,
    epaPerDropbackAllowed: -0.05,
  };
  const fb = calculateDeepPassSuppressionProxy(fallback);
  assertInvariants("8-fallback deep suppression", fb);
  check("8-fallback has FALLBACK tag", fb.tags.includes("DEEP_SUPPRESSION_FALLBACK"));
  check("8-fallback confidence <= 0.55", fb.confidence <= 0.55);

  // Tiny sample.
  const tinyDef: DefenseProxyInput = {
    games: 1,
    passAttemptsFaced: 38,
    rushAttemptsFaced: 22,
    sacksGenerated: 3,
    deepCompletionsAllowed: 1,
    deepCompletionsLeagueExpected: 3,
  };
  const tiny = calculateDeepPassSuppressionProxy(tinyDef);
  assertInvariants("8-tiny deep suppression", tiny);
  check("8-tiny confidence < 0.4", tiny.confidence < 0.4, `c=${tiny.confidence.toFixed(3)}`);
  check("8-tiny has risk note", tiny.risk !== undefined);
}

// ----- 9. Pressure risk — both sides vs one-side-only ---------------
section("9. Pressure risk — both-sides valid vs one-side-only false positive");
{
  const offense: OffenseProxyInput = {
    games: 5,
    teamPassAttempts: 175,
    teamRushAttempts: 110,
    sacksTaken: 18,
  };
  const defense: DefenseProxyInput = {
    games: 5,
    passAttemptsFaced: 180,
    rushAttemptsFaced: 130,
    sacksGenerated: 22,
  };
  const r = calculatePressureRiskProxy(offense, defense);
  assertInvariants("9-valid pressure", r);
  check("9-valid pressure value >= 0.6", r.value >= 0.6);
  check("9-valid pressure tag", r.tags.includes("PRESSURE_RISK_HIGH"));
  check("9-valid pressure risk includes sack caveat", (r.risk ?? "").toLowerCase().includes("sack"));

  // 1-game pressure sample — should be low confidence.
  const tinyDef: DefenseProxyInput = {
    games: 1,
    passAttemptsFaced: 32,
    rushAttemptsFaced: 22,
    sacksGenerated: 6,
  };
  const tinyOff: OffenseProxyInput = {
    games: 1,
    teamPassAttempts: 32,
    teamRushAttempts: 22,
    sacksTaken: 5,
  };
  const tinyR = calculatePressureRiskProxy(tinyOff, tinyDef);
  assertInvariants("9-tiny pressure", tinyR);
  check("9-tiny pressure confidence < 0.5", tinyR.confidence < 0.5);

  // One-sided: offense data only.
  const oneSidedDef: DefenseProxyInput = {
    games: 0,
    passAttemptsFaced: 0,
    rushAttemptsFaced: 0,
    sacksGenerated: 0,
  };
  const oneSided = calculatePressureRiskProxy(offense, oneSidedDef);
  assertInvariants("9-one-sided pressure", oneSided);
  check("9-one-sided tag PRESSURE_ONE_SIDED", oneSided.tags.includes("PRESSURE_ONE_SIDED"));
  check("9-one-sided value <= 0.55", oneSided.value <= 0.55);
  check("9-one-sided confidence <= 0.45", oneSided.confidence <= 0.45);
}

// ----- 10. Pressure with blitz support -----------------------------
section("10. Pressure risk with blitz support tags blitz_pressure_proxy");
{
  const offense: OffenseProxyInput = {
    games: 5,
    teamPassAttempts: 175,
    teamRushAttempts: 110,
    sacksTaken: 18,
  };
  const defense: DefenseProxyInput = {
    games: 5,
    passAttemptsFaced: 180,
    rushAttemptsFaced: 130,
    sacksGenerated: 22,
    blitzPctEstimate: 0.4,
  };
  const r = calculatePressureRiskProxy(offense, defense);
  assertInvariants("10-blitz pressure", r);
  check("10 blitz tag present", r.tags.includes("blitz_pressure_proxy"));
}

// ----- 11. Quick game — explicit vs indirect ------------------------
section("11. Quick game — explicit estimate vs indirect inference");
{
  const explicit: OffenseProxyInput = {
    games: 5,
    teamPassAttempts: 180,
    teamRushAttempts: 110,
    sacksTaken: 6,
    quickGamePctEstimate: 0.75,
  };
  const r = calculateQuickGameProxy(explicit);
  assertInvariants("11-explicit", r);
  check("11-explicit value >= 0.65", r.value >= 0.65);
  check("11-explicit tag QUICK_GAME_OFFENSE", r.tags.includes("QUICK_GAME_OFFENSE"));
  check("11-explicit no INDIRECT tag", !r.tags.includes("QUICK_GAME_INDIRECT"));

  const indirect: OffenseProxyInput = {
    games: 5,
    teamPassAttempts: 180,
    teamRushAttempts: 110,
    sacksTaken: 7,
  };
  const indirectR = calculateQuickGameProxy(indirect);
  assertInvariants("11-indirect", indirectR);
  check("11-indirect tag QUICK_GAME_INDIRECT", indirectR.tags.includes("QUICK_GAME_INDIRECT"));
  check("11-indirect confidence <= 0.55", indirectR.confidence <= 0.55);
  check("11-indirect has risk note", indirectR.risk !== undefined);
}

// ----- 12. Rushing volume stability with vs without weekly data ----
section("12. Rushing volume stability — enough weeks vs missing data");
{
  const valid: OffenseProxyInput = {
    games: 5,
    teamPassAttempts: 165,
    teamRushAttempts: 145,
    sacksTaken: 7,
    weekRushingAttempts: [27, 28, 29, 30, 26],
  };
  const r = calculateRushingVolumeStabilityProxy(valid);
  assertInvariants("12-valid stability", r);
  check("12-valid stability value >= 0.7", r.value >= 0.7);
  check("12-valid stability tag", r.tags.includes("STABLE_RUSH_VOLUME"));

  const missing: OffenseProxyInput = {
    games: 2,
    teamPassAttempts: 70,
    teamRushAttempts: 56,
    sacksTaken: 4,
    weekRushingAttempts: [28, 28],
  };
  const m = calculateRushingVolumeStabilityProxy(missing);
  assertInvariants("12-missing stability", m);
  check("12-missing tag NEEDS_MORE_WEEKS", m.tags.includes("NEEDS_MORE_WEEKS"));
  check("12-missing confidence <= 0.3", m.confidence <= 0.3);
  check("12-missing has risk note", m.risk !== undefined);
}

// ----- 13. Target share stability — meaningful vs stable-but-tiny --
section("13. Target share stability — meaningful stable vs stable-but-tiny");
{
  const meaningful: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 38,
    receptions: 26,
    receivingYards: 312,
    airYards: 9 * 38,
    teamTargets: 175,
    teamAirYards: 1500,
    snapShare: 0.86,
    carries: 0,
    carryShare: 0,
    weekTargetShares: [0.22, 0.21, 0.23, 0.22, 0.2],
  };
  const r = calculateTargetShareStabilityProxy(meaningful);
  assertInvariants("13-meaningful stability", r);
  check("13-meaningful value >= 0.65", r.value >= 0.65);
  check("13-meaningful tag", r.tags.includes("STABLE_TARGET_SHARE"));

  const tiny: PlayerProxyInput = {
    ...meaningful,
    targets: 8,
    receptions: 5,
    weekTargetShares: [0.02, 0.02, 0.02, 0.02, 0.02],
  };
  const tinyR = calculateTargetShareStabilityProxy(tiny);
  assertInvariants("13-tiny stability", tinyR);
  check("13-tiny value < 0.4", tinyR.value < 0.4);
  check("13-tiny tag TINY_SHARE_NOT_MEANINGFUL", tinyR.tags.includes("TINY_SHARE_NOT_MEANINGFUL"));
  check("13-tiny no STABLE_TARGET_SHARE tag", !tinyR.tags.includes("STABLE_TARGET_SHARE"));
}

// ----- 14. Universal structural invariants across bundles -----------
section("14. Universal structural invariants");
{
  const player: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 30,
    receptions: 22,
    receivingYards: 240,
    airYards: 9 * 30,
    teamTargets: 165,
    teamAirYards: 1500,
    snapShare: 0.82,
    carries: 0,
    carryShare: 0,
  };
  const bundle = buildPlayerRoleProxies(player);
  const proxies = Object.values(bundle);
  check(
    "14 all player proxies start with Proxy-based:",
    proxies.every(startsWithProxyBased),
  );
  check(
    "14 all player proxies bounded",
    proxies.every(isBounded),
  );
  check(
    "14 no player proxy exposes recommendation",
    proxies.every(noForcingSurface),
  );
}

// ----- 15. Position-irrelevant proxies do not fire ------------------
section("15. Position-irrelevant proxies return NOT_APPLICABLE");
{
  const wr: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 30,
    receptions: 22,
    receivingYards: 240,
    airYards: 9 * 30,
    teamTargets: 165,
    teamAirYards: 1500,
    snapShare: 0.82,
    carries: 0,
    carryShare: 0,
  };
  const rbOnWr = calculateRbReceivingRoleProxy(wr);
  const teOnWr = calculateTeReceivingRoleProxy(wr);
  check("15 RB proxy on WR NOT_APPLICABLE", rbOnWr.tags.includes("NOT_APPLICABLE"));
  check("15 RB proxy on WR value = 0", rbOnWr.value === 0);
  check("15 TE proxy on WR NOT_APPLICABLE", teOnWr.tags.includes("NOT_APPLICABLE"));
  check("15 TE proxy on WR value = 0", teOnWr.value === 0);
}

// ----- summary -----------------------------------------------------
const total = passCount + failures.length;
const color = failures.length === 0 ? C_GREEN : C_RED;
console.log(
  `\n${color}${passCount}/${total} proxy-football-calibration assertions passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
