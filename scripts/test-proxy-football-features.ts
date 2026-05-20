/**
 * test-proxy-football-features.ts
 *
 * Deterministic assertions for the proxy football feature framework.
 * No external APIs. Pure CPU.
 *
 * Each proxy returns {value, confidence, explanation, risk?, tags}.
 * Tests assert:
 *   - value direction (e.g., slot proxy fires for low-aDOT high-TS WR)
 *   - confidence behaves (low for small samples)
 *   - explanation includes the "Proxy-based:" prefix
 *   - risk note set when confidence is low
 *   - proxies expose no "force OVER/UNDER" surface
 */

import process from "node:process";
import {
  buildAllFootballProxies,
  buildDefenseProxies,
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

function explainsAsProxy(r: ProxyResult): boolean {
  return r.explanation.startsWith("Proxy-based:");
}

function valueInRange(r: ProxyResult, lo: number, hi: number): boolean {
  return r.value >= lo && r.value <= hi;
}

function hasNoForcingSurface(r: ProxyResult): boolean {
  // Proxies must NOT expose anything that would force a recommendation
  // — no `recommendation`, no `forcedSide`, etc.
  return !("recommendation" in r) && !("forcedSide" in r);
}

// --- 1. Slot-volume WR proxy ----------------------------------------
section("1. Slot-volume WR proxy fires for low-aDOT, high-target-share WR");
{
  const player: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 38,
    receptions: 29,
    receivingYards: 232,
    airYards: 5 * 38, // aDOT = 5
    teamTargets: 175,
    teamAirYards: 1600,
    snapShare: 0.78,
    carries: 0,
    carryShare: 0,
  };
  const r = calculateSlotRoleProxy(player);
  check("1 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("1 value >= 0.6 (slot signal strong)", r.value >= 0.6, `value=${r.value.toFixed(3)}`);
  check("1 confidence >= 0.5", r.confidence >= 0.5);
  check("1 tag SLOT_VOLUME_LIKELY", r.tags.includes("SLOT_VOLUME_LIKELY"));
  check("1 no forcing surface", hasNoForcingSurface(r));
  check("1 no low-confidence risk note", r.risk === undefined);
}

// --- 2. Deep WR proxy -----------------------------------------------
section("2. Deep WR proxy fires for high-aDOT WR with big air-yards share");
{
  const player: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 28,
    receptions: 14,
    receivingYards: 350,
    airYards: 16 * 28, // aDOT = 16
    teamTargets: 175,
    teamAirYards: 1500,
    snapShare: 0.85,
    carries: 0,
    carryShare: 0,
  };
  const r = calculateDeepReceiverProxy(player);
  check("2 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("2 value >= 0.6 (deep signal strong)", r.value >= 0.6);
  check("2 tag DEEP_THREAT_LIKELY", r.tags.includes("DEEP_THREAT_LIKELY"));
  check("2 confidence >= 0.5", r.confidence >= 0.5);
  check("2 no forcing surface", hasNoForcingSurface(r));
}

// --- 3. Possession WR proxy -----------------------------------------
section("3. Possession WR proxy fires for mid-aDOT, high-TS, high-CR WR");
{
  const player: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 36,
    receptions: 27,
    receivingYards: 304,
    airYards: 10 * 36, // aDOT = 10
    teamTargets: 160,
    teamAirYards: 1600,
    snapShare: 0.9,
    carries: 0,
    carryShare: 0,
  };
  const r = calculatePossessionReceiverProxy(player);
  check("3 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("3 value >= 0.6", r.value >= 0.6);
  check(
    "3 tag POSSESSION_RECEIVER_LIKELY",
    r.tags.includes("POSSESSION_RECEIVER_LIKELY"),
  );
  check("3 no forcing surface", hasNoForcingSurface(r));
}

// --- 4. Receiving RB proxy ------------------------------------------
section("4. Receiving RB proxy fires for RB with 4 rec/game");
{
  const player: PlayerProxyInput = {
    position: "RB",
    games: 5,
    targets: 24,
    receptions: 20,
    receivingYards: 168,
    airYards: 4 * 24, // aDOT = 4
    teamTargets: 175,
    teamAirYards: 1500,
    snapShare: 0.72,
    carries: 70,
    carryShare: 0.55,
  };
  const r = calculateRbReceivingRoleProxy(player);
  check("4 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("4 value >= 0.6", r.value >= 0.6);
  check("4 tag RECEIVING_RB_LIKELY", r.tags.includes("RECEIVING_RB_LIKELY"));
  check("4 no forcing surface", hasNoForcingSurface(r));

  // Position-mismatch check: TE input should return value 0 + risk note.
  const teInput: PlayerProxyInput = { ...player, position: "TE" };
  const rWrong = calculateRbReceivingRoleProxy(teInput);
  check("4 position TE on RB proxy is NOT_APPLICABLE", rWrong.tags.includes("NOT_APPLICABLE"));
  check("4 position TE on RB proxy has risk", rWrong.risk !== undefined);
}

// --- 5. Receiving TE proxy ------------------------------------------
section("5. Receiving TE proxy fires for high-volume receiving TE");
{
  const player: PlayerProxyInput = {
    position: "TE",
    games: 5,
    targets: 32,
    receptions: 24,
    receivingYards: 288,
    airYards: 8 * 32, // aDOT = 8
    teamTargets: 160,
    teamAirYards: 1500,
    snapShare: 0.85,
    carries: 0,
    carryShare: 0,
  };
  const r = calculateTeReceivingRoleProxy(player);
  check("5 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("5 value >= 0.6", r.value >= 0.6);
  check("5 tag RECEIVING_TE_LIKELY", r.tags.includes("RECEIVING_TE_LIKELY"));
}

// --- 6. Pass-funnel defense proxy -----------------------------------
section("6. Pass-funnel defense proxy fires when ≥ 65% pass attempts faced");
{
  const defense: DefenseProxyInput = {
    games: 6,
    passAttemptsFaced: 230,
    rushAttemptsFaced: 120, // ~66% pass
    sacksGenerated: 14,
  };
  const r = calculatePassFunnelProxy(defense);
  check("6 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("6 value >= 0.6", r.value >= 0.6);
  check("6 tag PASS_FUNNEL_LIKELY", r.tags.includes("PASS_FUNNEL_LIKELY"));
  check("6 confidence >= 0.5", r.confidence >= 0.5);
}

// --- 7. Run-funnel defense proxy ------------------------------------
section("7. Run-funnel defense proxy fires when ≥ 50% rush attempts faced");
{
  const defense: DefenseProxyInput = {
    games: 6,
    passAttemptsFaced: 170,
    rushAttemptsFaced: 180, // ~51% rush
    sacksGenerated: 10,
  };
  const r = calculateRunFunnelProxy(defense);
  check("7 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("7 value >= 0.6", r.value >= 0.6);
  check("7 tag RUN_FUNNEL_LIKELY", r.tags.includes("RUN_FUNNEL_LIKELY"));
}

// --- 8. Pressure-risk proxy -----------------------------------------
section("8. Pressure-risk proxy fires when both offense and defense are sack-heavy");
{
  const offense: OffenseProxyInput = {
    games: 5,
    teamPassAttempts: 175,
    teamRushAttempts: 110,
    sacksTaken: 19, // ~10.9%
  };
  const defense: DefenseProxyInput = {
    games: 5,
    passAttemptsFaced: 175,
    rushAttemptsFaced: 130,
    sacksGenerated: 22, // ~12.6%
  };
  const r = calculatePressureRiskProxy(offense, defense);
  check("8 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("8 value >= 0.6", r.value >= 0.6, `value=${r.value.toFixed(3)}`);
  check("8 tag PRESSURE_RISK_HIGH", r.tags.includes("PRESSURE_RISK_HIGH"));
  check("8 confidence >= 0.5", r.confidence >= 0.5);
}

// --- 9. Deep-pass suppression proxy ---------------------------------
section("9. Deep-pass suppression proxy fires when deep completions << league");
{
  const defense: DefenseProxyInput = {
    games: 6,
    passAttemptsFaced: 220,
    rushAttemptsFaced: 140,
    sacksGenerated: 14,
    deepCompletionsAllowed: 6,
    deepCompletionsLeagueExpected: 18,
    epaPerDropbackAllowed: -0.02,
  };
  const r = calculateDeepPassSuppressionProxy(defense);
  check("9 explanation prefixed with Proxy-based", explainsAsProxy(r));
  check("9 value >= 0.6", r.value >= 0.6);
  check(
    "9 tag DEEP_SUPPRESSION_LIKELY",
    r.tags.includes("DEEP_SUPPRESSION_LIKELY"),
  );
}

// --- 10. Low-confidence proxy caps ----------------------------------
section("10. Low-confidence proxy caps + risk notes");
{
  // Player proxies with games=1, targets=3
  const tinyPlayer: PlayerProxyInput = {
    position: "WR",
    games: 1,
    targets: 3,
    receptions: 2,
    receivingYards: 14,
    airYards: 6 * 3,
    teamTargets: 35,
    teamAirYards: 320,
    snapShare: 0.6,
    carries: 0,
    carryShare: 0,
  };
  const slot = calculateSlotRoleProxy(tinyPlayer);
  check(
    "10 tiny-sample slot proxy confidence < 0.4",
    slot.confidence < 0.4,
    `conf=${slot.confidence.toFixed(3)}`,
  );
  check("10 tiny-sample slot proxy has risk note", slot.risk !== undefined);
  const deep = calculateDeepReceiverProxy(tinyPlayer);
  check("10 tiny-sample deep proxy confidence < 0.4", deep.confidence < 0.4);
  check("10 tiny-sample deep proxy has risk note", deep.risk !== undefined);

  // Defense proxies with games=1
  const tinyDef: DefenseProxyInput = {
    games: 1,
    passAttemptsFaced: 30,
    rushAttemptsFaced: 22,
    sacksGenerated: 2,
  };
  const passF = calculatePassFunnelProxy(tinyDef);
  check("10 tiny-sample pass funnel confidence < 0.4", passF.confidence < 0.4);
  check("10 tiny-sample pass funnel has risk note", passF.risk !== undefined);

  // Stability proxies with no per-week data
  const noWeeks: PlayerProxyInput = { ...tinyPlayer, weekTargetShares: [0.15] };
  const stab = calculateTargetShareStabilityProxy(noWeeks);
  check(
    "10 target-share stability with 1 week is unreliable",
    stab.tags.includes("NEEDS_MORE_WEEKS"),
  );
  check("10 target-share stability has risk note", stab.risk !== undefined);
}

// --- 11. Bonus: bundle builders ------------------------------------
section("11. Bundle builders return all six player proxies + three defense + three offense");
{
  const player: PlayerProxyInput = {
    position: "WR",
    games: 5,
    targets: 35,
    receptions: 25,
    receivingYards: 280,
    airYards: 10 * 35,
    teamTargets: 175,
    teamAirYards: 1600,
    snapShare: 0.86,
    carries: 0,
    carryShare: 0,
    weekTargetShares: [0.18, 0.21, 0.19, 0.2, 0.22],
  };
  const offense: OffenseProxyInput = {
    games: 5,
    teamPassAttempts: 175,
    teamRushAttempts: 135,
    sacksTaken: 8,
    weekRushingAttempts: [26, 28, 30, 24, 27],
  };
  const defense: DefenseProxyInput = {
    games: 5,
    passAttemptsFaced: 175,
    rushAttemptsFaced: 130,
    sacksGenerated: 12,
    deepCompletionsAllowed: 14,
    deepCompletionsLeagueExpected: 14,
  };
  const all = buildAllFootballProxies({ player, offense, defense });
  check(
    "11 player proxies include all 6 keys",
    !!all.player.slotRoleProxy &&
      !!all.player.deepReceiverProxy &&
      !!all.player.possessionReceiverProxy &&
      !!all.player.rbReceivingRoleProxy &&
      !!all.player.teReceivingRoleProxy &&
      !!all.player.targetShareStabilityProxy,
  );
  check(
    "11 defense proxies include all 3 keys",
    !!all.defense.passFunnelProxy &&
      !!all.defense.runFunnelProxy &&
      !!all.defense.deepPassSuppressionProxy,
  );
  check(
    "11 offense/defense proxies include all 3 keys",
    !!all.offense.pressureRiskProxy &&
      !!all.offense.quickGameProxy &&
      !!all.offense.rushingVolumeStabilityProxy,
  );
  // Spot-check quick-game proxy: 35 attempts/game and ~4.6% sack rate
  // should fire the quick-game tag.
  check(
    "11 quick-game proxy fires for high-attempt low-sack offense",
    all.offense.quickGameProxy.value >= 0.6,
    `value=${all.offense.quickGameProxy.value.toFixed(3)}`,
  );
  check(
    "11 rushing volume stability fires for low-variance weeks",
    all.offense.rushingVolumeStabilityProxy.value >= 0.7,
  );
  check(
    "11 target-share stability fires for low-variance weeks",
    all.player.targetShareStabilityProxy.value >= 0.7,
  );

  // Position-irrelevant proxies don't fire when position mismatches.
  check(
    "11 RB proxy on a WR returns NOT_APPLICABLE",
    all.player.rbReceivingRoleProxy.tags.includes("NOT_APPLICABLE"),
  );
  check(
    "11 TE proxy on a WR returns NOT_APPLICABLE",
    all.player.teReceivingRoleProxy.tags.includes("NOT_APPLICABLE"),
  );
}

// --- 12. Universal structural invariants ---------------------------
section("12. Universal structural invariants — no forcing surface anywhere");
{
  const proxies: ProxyResult[] = [
    calculateSlotRoleProxy({
      position: "WR",
      games: 4,
      targets: 30,
      receptions: 22,
      receivingYards: 220,
      airYards: 6 * 30,
      teamTargets: 160,
      teamAirYards: 1400,
      snapShare: 0.78,
      carries: 0,
      carryShare: 0,
    }),
    calculateDeepReceiverProxy({
      position: "WR",
      games: 4,
      targets: 22,
      receptions: 11,
      receivingYards: 220,
      airYards: 14 * 22,
      teamTargets: 160,
      teamAirYards: 1400,
      snapShare: 0.8,
      carries: 0,
      carryShare: 0,
    }),
    calculatePassFunnelProxy({
      games: 4,
      passAttemptsFaced: 160,
      rushAttemptsFaced: 70,
      sacksGenerated: 10,
    }),
    calculateRunFunnelProxy({
      games: 4,
      passAttemptsFaced: 100,
      rushAttemptsFaced: 140,
      sacksGenerated: 8,
    }),
    calculateQuickGameProxy({
      games: 4,
      teamPassAttempts: 150,
      teamRushAttempts: 110,
      sacksTaken: 5,
    }),
    calculateRushingVolumeStabilityProxy({
      games: 4,
      teamPassAttempts: 150,
      teamRushAttempts: 110,
      sacksTaken: 5,
      weekRushingAttempts: [27, 28, 29, 26],
    }),
  ];
  check(
    "12 every proxy result has value in [0, 1]",
    proxies.every((p) => valueInRange(p, 0, 1)),
  );
  check(
    "12 every proxy result has confidence in [0, 0.95]",
    proxies.every((p) => p.confidence >= 0 && p.confidence <= 0.95),
  );
  check(
    "12 every proxy explanation is Proxy-based",
    proxies.every(explainsAsProxy),
  );
  check(
    "12 no proxy exposes a recommendation field",
    proxies.every(hasNoForcingSurface),
  );
  // Sanity: building individual buckets keeps the same invariants.
  const dummyPlayer: PlayerProxyInput = {
    position: "WR",
    games: 4,
    targets: 30,
    receptions: 22,
    receivingYards: 220,
    airYards: 6 * 30,
    teamTargets: 160,
    teamAirYards: 1400,
    snapShare: 0.78,
    carries: 0,
    carryShare: 0,
  };
  const dummyDef: DefenseProxyInput = {
    games: 4,
    passAttemptsFaced: 160,
    rushAttemptsFaced: 70,
    sacksGenerated: 10,
  };
  const bundles = [
    ...Object.values(buildPlayerRoleProxies(dummyPlayer)),
    ...Object.values(buildDefenseProxies(dummyDef)),
  ];
  check(
    "12 bundle builders preserve invariants",
    bundles.every(
      (p) => explainsAsProxy(p) && valueInRange(p, 0, 1) && hasNoForcingSurface(p),
    ),
  );
}

// --- summary --------------------------------------------------------
const total = passCount + failures.length;
const color = failures.length === 0 ? C_GREEN : C_RED;
console.log(
  `\n${color}${passCount}/${total} proxy-football-feature assertions passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
