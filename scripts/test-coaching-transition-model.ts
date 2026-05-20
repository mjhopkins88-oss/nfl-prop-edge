/**
 * test-coaching-transition-model.ts
 *
 * Deterministic synthetic tests for the 2026 coaching transition
 * framework. No external APIs, no network, no DB. Pure CPU.
 */

import process from "node:process";

import {
  TEAM_COACHING_TRANSITIONS,
  UNCHANGED_STAFF_DEFAULT,
  COACH_TENDENCY_PROFILES,
  BLEND_PROFILES,
  getTeamCoachingTransition,
} from "../src/lib/model/coaching-transition-data";
import {
  buildCoachingTransitionScorecard,
  edgeThresholdBumpFromPenalty,
  getBlendWeights,
  getSeasonPhase,
  shouldPassDueToCoachingUncertainty,
} from "../src/lib/model/coaching-transition";

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
    const tail = detail ? ` — ${detail}` : "";
    console.log(`  ${C_RED}[FAIL]${C_RESET} ${name}${tail}`);
    failures.push(`${name}${tail}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// --- 1. Season phase boundaries --------------------------------------
section("Season phase boundaries");
check("week 1 → WEEKS_1_4", getSeasonPhase(1) === "WEEKS_1_4");
check("week 4 → WEEKS_1_4", getSeasonPhase(4) === "WEEKS_1_4");
check("week 5 → WEEKS_5_8", getSeasonPhase(5) === "WEEKS_5_8");
check("week 8 → WEEKS_5_8", getSeasonPhase(8) === "WEEKS_5_8");
check("week 9 → WEEKS_9_PLUS", getSeasonPhase(9) === "WEEKS_9_PLUS");
check("week 18 → WEEKS_9_PLUS", getSeasonPhase(18) === "WEEKS_9_PLUS");

// --- 2. Edge threshold bump table ------------------------------------
section("edgeThresholdBumpFromPenalty");
check("penalty 0  → 0 pp", edgeThresholdBumpFromPenalty(0) === 0);
check("penalty 15 → 0 pp", edgeThresholdBumpFromPenalty(15) === 0);
check("penalty 20 → 0.5 pp", edgeThresholdBumpFromPenalty(20) === 0.5);
check("penalty 39 → 0.5 pp", edgeThresholdBumpFromPenalty(39) === 0.5);
check("penalty 40 → 1.0 pp", edgeThresholdBumpFromPenalty(40) === 1.0);
check("penalty 59 → 1.0 pp", edgeThresholdBumpFromPenalty(59) === 1.0);
check("penalty 60 → 1.5 pp", edgeThresholdBumpFromPenalty(60) === 1.5);
check("penalty 74 → 1.5 pp", edgeThresholdBumpFromPenalty(74) === 1.5);
check("penalty 75 → 2.0 pp", edgeThresholdBumpFromPenalty(75) === 2.0);
check("penalty 99 → 2.0 pp", edgeThresholdBumpFromPenalty(99) === 2.0);
check(
  "bump is monotonic non-decreasing",
  [0, 19, 25, 50, 65, 80].every((p, i, arr) => {
    if (i === 0) return true;
    return edgeThresholdBumpFromPenalty(p) >=
      edgeThresholdBumpFromPenalty(arr[i - 1]);
  }),
);

// --- 3. Same staff / high continuity (BUF) ---------------------------
section("Same staff / high continuity (BUF)");
{
  const buf = TEAM_COACHING_TRANSITIONS.BUF;
  const w = getBlendWeights(buf, 3);
  check("BUF Weeks 1-4 priorTeam ≥ 60", w.priorTeam >= 60);
  check("BUF Weeks 1-4 observed = 0", w.currentSeasonObserved === 0);
  check("BUF Weeks 1-4 blend sums to 100", sum(w) === 100);
}

// --- 4. New OC but same HC (BAL) -------------------------------------
section("New OC but same HC (BAL)");
{
  const bal = TEAM_COACHING_TRANSITIONS.BAL;
  const w = getBlendWeights(bal, 2);
  check("BAL Weeks 1-4 priorTeam ≤ 45", w.priorTeam <= 45);
  check("BAL Weeks 1-4 coachProfile ≥ 30", w.coachProfile >= 30);
  check(
    "BAL blendProfile = new_oc_same_hc",
    bal.blendProfile === "new_oc_same_hc",
  );
}

// --- 5. New HC who calls offense / full reset (NYG) ------------------
section("New HC + new OC + new QB env (NYG)");
{
  const nyg = TEAM_COACHING_TRANSITIONS.NYG;
  const w = getBlendWeights(nyg, 1);
  check(
    "NYG blendProfile = new_hc_new_oc_unstable_qb",
    nyg.blendProfile === "new_hc_new_oc_unstable_qb",
  );
  check("NYG Weeks 1-4 priorTeam ≤ 20", w.priorTeam <= 20);
  check("NYG Weeks 1-4 leagueAverage ≥ 40", w.leagueAverage >= 40);
  check("NYG penalty ≥ 60", nyg.scores.coachingUncertaintyPenalty >= 60);
}

// --- 6. TEN high early uncertainty -----------------------------------
section("TEN high early uncertainty");
{
  const ten = TEAM_COACHING_TRANSITIONS.TEN;
  const sc = buildCoachingTransitionScorecard(ten, 2);
  check("TEN penalty ≥ 60", ten.scores.coachingUncertaintyPenalty >= 60);
  check(
    "TEN warning mentions uncertainty",
    sc.warnings.some((w) => w.toLowerCase().includes("uncertainty")),
  );
  check(
    "TEN summary mentions Weeks 1-4",
    sc.summary.includes("Weeks 1-4"),
  );
}

// --- 7. New DC with major identity shift (GB, opponent-prop focus) ---
section("New DC identity shift — GB own-offense neutral");
{
  const gb = TEAM_COACHING_TRANSITIONS.GB;
  const sc = buildCoachingTransitionScorecard(gb, 3);
  check(
    "GB own-offense impacts neutral",
    Object.values(sc.propImpacts).every((v) => v === "neutral"),
  );
  check(
    "GB defensiveIdentityShiftScore ≥ 50",
    gb.scores.defensiveIdentityShiftScore >= 50,
  );
  check(
    "GB has defense deltas",
    sc.defensiveNotes.length > 0,
  );
}

// --- 8. New OL / run-game coordinator boosts rushing confidence (ATL) -
section("Run-game structure changes (ATL, BAL)");
{
  const atl = TEAM_COACHING_TRANSITIONS.ATL;
  check(
    "ATL offense deltas include run structure",
    atl.offenseDeltas.some((d) => d.includes("RUN_STRUCTURE")),
  );
  check(
    "ATL rushing prop impacts = up",
    atl.propImpacts.RUSHING_ATTEMPTS === "up" &&
      atl.propImpacts.RUSHING_YARDS === "up",
  );
  const bal = TEAM_COACHING_TRANSITIONS.BAL;
  check(
    "BAL offense deltas include RUN_STRUCTURE_UP",
    bal.offenseDeltas.includes("RUN_STRUCTURE_UP"),
  );
}

// --- 9. New OC bumps RB targets (LAC) --------------------------------
section("New OC increases RB targets (LAC)");
{
  const lac = TEAM_COACHING_TRANSITIONS.LAC;
  check(
    "LAC offense deltas include RB_RECEIVING_UP or QUICK_GAME_UP",
    lac.offenseDeltas.some(
      (d) => d.includes("RB_RECEIVING") || d.includes("QUICK_GAME"),
    ),
  );
  check(
    "LAC receptions impact upward",
    lac.propImpacts.RECEPTIONS.toLowerCase().includes("up"),
  );
}

// --- 10. New OC bumps TE usage (NYG) ---------------------------------
section("New OC increases TE usage (NYG)");
{
  const nyg = TEAM_COACHING_TRANSITIONS.NYG;
  check(
    "NYG offense deltas include TE/twelve personnel",
    nyg.offenseDeltas.some(
      (d) => d.includes("TWELVE_PERSONNEL") || d.includes("TE_USAGE"),
    ),
  );
  check(
    "NYG receptions impact mentions TE",
    nyg.propImpacts.RECEPTIONS.toLowerCase().includes("te"),
  );
}

// --- 11. Play-caller uncertainty triggers PASS despite edge ----------
section("Play-caller uncertainty + thin edge → PASS");
{
  const ten = TEAM_COACHING_TRANSITIONS.TEN;
  const should = shouldPassDueToCoachingUncertainty({
    rawEdgePct: 4.5,
    baseThresholdPct: 4.0,
    coachingUncertaintyPenalty: ten.scores.coachingUncertaintyPenalty,
  });
  check("TEN 4.5% edge fails 4 + 1.5 = 5.5% bumped threshold", should);

  const cleanEdge = shouldPassDueToCoachingUncertainty({
    rawEdgePct: 8.0,
    baseThresholdPct: 4.0,
    coachingUncertaintyPenalty: ten.scores.coachingUncertaintyPenalty,
  });
  check(
    "TEN 8.0% edge survives 5.5% bumped threshold",
    cleanEdge === false,
  );

  const ari = TEAM_COACHING_TRANSITIONS.ARI;
  const ariPass = shouldPassDueToCoachingUncertainty({
    rawEdgePct: 4.5,
    baseThresholdPct: 4.0,
    coachingUncertaintyPenalty: ari.scores.coachingUncertaintyPenalty,
  });
  check("ARI 4.5% edge fails 4 + 1.0 = 5.0% bumped threshold", ariPass);
}

// --- 12. Weeks 5-8 ramps up observed share ---------------------------
section("Weeks 5-8 ramps up observed share (CLE)");
{
  const cle = TEAM_COACHING_TRANSITIONS.CLE;
  const w2 = getBlendWeights(cle, 2);
  const w6 = getBlendWeights(cle, 6);
  check(
    "CLE Week 6 observed > Week 2 observed",
    w6.currentSeasonObserved > w2.currentSeasonObserved,
  );
  check(
    "CLE Week 2 observed = 0",
    w2.currentSeasonObserved === 0,
  );
  check(
    "CLE Week 6 observed ≥ 30",
    w6.currentSeasonObserved >= 30,
  );
}

// --- 13. Week 9+ observed dominates ----------------------------------
section("Week 9+ observed dominates (MIA, CLE)");
{
  const mia = TEAM_COACHING_TRANSITIONS.MIA;
  const sc = buildCoachingTransitionScorecard(mia, 10);
  check(
    "MIA Week 10 observed ≥ 50",
    sc.blendWeights.currentSeasonObserved >= 50,
  );
  check(
    "MIA Week 10 priorTeam ≤ 15",
    sc.blendWeights.priorTeam <= 15,
  );
  const cle = TEAM_COACHING_TRANSITIONS.CLE;
  const w10 = getBlendWeights(cle, 10);
  const w6 = getBlendWeights(cle, 6);
  check(
    "CLE Week 10 observed ≥ 60",
    w10.currentSeasonObserved >= 60,
  );
  check(
    "CLE Week 10 observed > Week 6 observed",
    w10.currentSeasonObserved > w6.currentSeasonObserved,
  );
}

// --- 14. UNCHANGED_STAFF_DEFAULT -------------------------------------
section("UNCHANGED_STAFF_DEFAULT");
check(
  "default continuity ≥ 80",
  UNCHANGED_STAFF_DEFAULT.scores.coachingContinuityScore >= 80,
);
check(
  "default penalty < 20",
  UNCHANGED_STAFF_DEFAULT.scores.coachingUncertaintyPenalty < 20,
);
check(
  "default high_continuity blend profile",
  UNCHANGED_STAFF_DEFAULT.blendProfile === "high_continuity",
);
check(
  "default uses high_continuity weights",
  JSON.stringify(getBlendWeights(UNCHANGED_STAFF_DEFAULT, 1)) ===
    JSON.stringify(BLEND_PROFILES.high_continuity.WEEKS_1_4),
);
check(
  "default sourceConfidence MEDIUM",
  UNCHANGED_STAFF_DEFAULT.sourceConfidence === "MEDIUM",
);

// --- 15. getTeamCoachingTransition fallback --------------------------
section("getTeamCoachingTransition unknown team falls back to default");
{
  const unknown = getTeamCoachingTransition("XYZ");
  check("unknown team falls back to default scores", unknown.scores.coachingContinuityScore === 88);
  check("unknown team retains its abbreviation", unknown.team === "XYZ");
}

// --- 16. Source-confidence / assumption-notes / lastVerified ---------
section("Every team record carries source confidence + assumption notes");
{
  const teamKeys = Object.keys(TEAM_COACHING_TRANSITIONS);
  check(
    "every team has sourceConfidence",
    teamKeys.every(
      (k) => !!TEAM_COACHING_TRANSITIONS[k].sourceConfidence,
    ),
  );
  check(
    "every team has at least one assumption note",
    teamKeys.every(
      (k) => TEAM_COACHING_TRANSITIONS[k].assumptionNotes.length >= 1,
    ),
  );
  check(
    "every team has lastVerified",
    teamKeys.every((k) => !!TEAM_COACHING_TRANSITIONS[k].lastVerified),
  );
  check(
    "every team has appliesToWeeks",
    teamKeys.every((k) => !!TEAM_COACHING_TRANSITIONS[k].appliesToWeeks),
  );
}

// --- 17. Blend weights always sum to 100 -----------------------------
section("Blend weights are normalized");
{
  let allSum100 = true;
  for (const key of Object.keys(TEAM_COACHING_TRANSITIONS)) {
    for (const week of [1, 6, 12]) {
      if (sum(getBlendWeights(TEAM_COACHING_TRANSITIONS[key], week)) !== 100) {
        allSum100 = false;
        break;
      }
    }
  }
  check("all team blend weights sum to 100", allSum100);
}

// --- 18. COACH_TENDENCY_PROFILES has at least one archetype ----------
section("COACH_TENDENCY_PROFILES exposes archetypes");
check(
  "league average profile exists",
  !!COACH_TENDENCY_PROFILES.LEAGUE_AVERAGE_2025,
);
check(
  "at least 3 archetypes exposed",
  Object.keys(COACH_TENDENCY_PROFILES).length >= 3,
);

// --- 19. Scorecard summary text --------------------------------------
section("Scorecard summary text");
{
  const buf = buildCoachingTransitionScorecard(TEAM_COACHING_TRANSITIONS.BUF, 1);
  const ten = buildCoachingTransitionScorecard(TEAM_COACHING_TRANSITIONS.TEN, 1);
  check("BUF summary mentions BUF", buf.summary.includes("BUF"));
  check("BUF summary mentions continuity", buf.summary.toLowerCase().includes("continuity"));
  check("TEN summary mentions TEN", ten.summary.includes("TEN"));
  check(
    "TEN summary mentions penalty",
    ten.summary.toLowerCase().includes("penalty"),
  );
}

function sum(w: { priorTeam: number; coachProfile: number; leagueAverage: number; currentSeasonObserved: number }): number {
  return w.priorTeam + w.coachProfile + w.leagueAverage + w.currentSeasonObserved;
}

// --- Summary --------------------------------------------------------
const total = passCount + failures.length;
const color = failures.length === 0 ? C_GREEN : C_RED;
console.log(
  `\n${color}${passCount}/${total} coaching-transition assertions passed.${C_RESET}`,
);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
