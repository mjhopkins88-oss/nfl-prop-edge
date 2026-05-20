/**
 * Static fixtures for the Experimental Correlated Parlay Model.
 *
 * Two pieces:
 *   PARLAY_LEG_FIXTURES — a pool of evaluated player-prop legs
 *     (no touchdowns, V1 markets only) with per-leg confidence,
 *     data quality, risk, role / weather / pressure metadata.
 *   PARLAY_CANDIDATE_FIXTURES — 16+ candidate specifications
 *     pointing into the leg pool. Each is annotated with the
 *     scenario it demonstrates so reviewers can map fixture →
 *     recommendation path.
 *
 * No real data, no APIs. The pool is sized just large enough to
 * cover the 18 test scenarios; expand carefully if more cases
 * are added.
 */

import type { PropType } from "../types";
import type {
  ParlayLeg,
  ParlayLegSide,
  ParlayPlayerRole,
  ParlayType,
} from "./parlay-types";
import { impliedProbabilityFromAmerican } from "./parlay-probability";

interface LegFixtureInput {
  id: string;
  playerName: string;
  team: string;
  opponent: string;
  gameId: string;
  propType: PropType;
  side: ParlayLegSide;
  line: number;
  odds: number;
  modelProbability: number;
  confidence: number;
  riskScore: number;
  dataQualityScore: number;
  qualified?: boolean;
  primaryDisqualifier?: string;
  playerRole?: ParlayPlayerRole;
  weatherRiskScore?: number;
  pressureRiskScore?: number;
  projectedTeamPlays?: number;
  projectedPassRate?: number;
  favoritePosture?: "FAVORITE" | "UNDERDOG" | "TOSSUP";
  lineFragilityScore?: number;
  reasons?: string[];
  risks?: string[];
}

function buildLeg(input: LegFixtureInput): ParlayLeg {
  const market = impliedProbabilityFromAmerican(input.odds);
  const noVigOver = market; // legs are pre-noVig'd in fixture form
  const rawEdge = input.modelProbability - noVigOver;
  // Mirror the v2 confidence-adjusted edge formula.
  const confMul = Math.min(1, Math.max(0.3, input.confidence / 0.7));
  const confidenceAdjustedEdge = rawEdge * confMul;
  const qualified =
    input.qualified ??
    (input.confidence >= 0.55 &&
      input.dataQualityScore >= 0.55 &&
      Math.abs(confidenceAdjustedEdge) >= 0.025);
  return {
    id: input.id,
    playerName: input.playerName,
    team: input.team,
    opponent: input.opponent,
    gameId: input.gameId,
    propType: input.propType,
    side: input.side,
    line: input.line,
    odds: input.odds,
    marketProbability: market,
    modelProbability: input.modelProbability,
    rawEdge,
    confidenceAdjustedEdge,
    confidence: input.confidence,
    riskScore: input.riskScore,
    dataQualityScore: input.dataQualityScore,
    recommendation: qualified ? input.side : "PASS",
    qualified,
    primaryDisqualifier: input.primaryDisqualifier,
    playerRole: input.playerRole,
    weatherRiskScore: input.weatherRiskScore,
    pressureRiskScore: input.pressureRiskScore,
    projectedTeamPlays: input.projectedTeamPlays,
    projectedPassRate: input.projectedPassRate,
    favoritePosture: input.favoritePosture,
    lineFragilityScore: input.lineFragilityScore,
    reasons: input.reasons ?? [],
    risks: input.risks ?? [],
  };
}

export const PARLAY_LEG_FIXTURES: ParlayLeg[] = [
  // --- Game 1: BUF vs MIA, high-volume shootout, favorable for QB/WR stack.
  buildLeg({
    id: "leg-buf-allen-passyds-over",
    playerName: "Josh Allen",
    team: "BUF",
    opponent: "MIA",
    gameId: "game-buf-mia",
    propType: "PASSING_YARDS",
    side: "OVER",
    line: 268.5,
    odds: -110,
    modelProbability: 0.62,
    confidence: 0.74,
    riskScore: 0.82,
    dataQualityScore: 0.78,
    playerRole: "QB",
    weatherRiskScore: 0.95,
    pressureRiskScore: 0.2,
    projectedTeamPlays: 68,
    projectedPassRate: 0.62,
    favoritePosture: "FAVORITE",
    lineFragilityScore: 0.35,
    reasons: ["Stable team pass rate", "Backed by Allen's recent yardage profile"],
  }),
  buildLeg({
    id: "leg-buf-diggs-recyds-over",
    playerName: "Stefon Diggs",
    team: "BUF",
    opponent: "MIA",
    gameId: "game-buf-mia",
    propType: "RECEIVING_YARDS",
    side: "OVER",
    line: 72.5,
    odds: -110,
    modelProbability: 0.6,
    confidence: 0.7,
    riskScore: 0.78,
    dataQualityScore: 0.75,
    playerRole: "WR_ALPHA",
    weatherRiskScore: 0.95,
    pressureRiskScore: 0.2,
    projectedTeamPlays: 68,
    projectedPassRate: 0.62,
    favoritePosture: "FAVORITE",
    lineFragilityScore: 0.4,
  }),
  buildLeg({
    id: "leg-buf-shakir-recyds-over",
    playerName: "Khalil Shakir",
    team: "BUF",
    opponent: "MIA",
    gameId: "game-buf-mia",
    propType: "RECEIVING_YARDS",
    side: "OVER",
    line: 38.5,
    odds: -115,
    modelProbability: 0.56,
    confidence: 0.62,
    riskScore: 0.7,
    dataQualityScore: 0.65,
    playerRole: "WR_SLOT",
    weatherRiskScore: 0.95,
    pressureRiskScore: 0.2,
    projectedTeamPlays: 68,
    projectedPassRate: 0.62,
    lineFragilityScore: 0.55,
  }),

  // --- Game 2: KC vs DEN, mid-volume, completion-friendly setup.
  buildLeg({
    id: "leg-kc-mahomes-completions-over",
    playerName: "Patrick Mahomes",
    team: "KC",
    opponent: "DEN",
    gameId: "game-kc-den",
    propType: "PASSING_COMPLETIONS",
    side: "OVER",
    line: 22.5,
    odds: -120,
    modelProbability: 0.62,
    confidence: 0.78,
    riskScore: 0.8,
    dataQualityScore: 0.78,
    playerRole: "QB",
    weatherRiskScore: 0.9,
    pressureRiskScore: 0.4,
    projectedTeamPlays: 65,
    projectedPassRate: 0.66,
    favoritePosture: "FAVORITE",
    lineFragilityScore: 0.3,
  }),
  buildLeg({
    id: "leg-kc-rice-receptions-over",
    playerName: "Rashee Rice",
    team: "KC",
    opponent: "DEN",
    gameId: "game-kc-den",
    propType: "RECEPTIONS",
    side: "OVER",
    line: 4.5,
    odds: -130,
    modelProbability: 0.62,
    confidence: 0.74,
    riskScore: 0.78,
    dataQualityScore: 0.74,
    playerRole: "WR_SLOT",
    pressureRiskScore: 0.45,
    projectedTeamPlays: 65,
    projectedPassRate: 0.66,
    lineFragilityScore: 0.35,
  }),
  buildLeg({
    id: "leg-kc-mahomes-attempts-over",
    playerName: "Patrick Mahomes",
    team: "KC",
    opponent: "DEN",
    gameId: "game-kc-den",
    propType: "PASSING_ATTEMPTS",
    side: "OVER",
    line: 33.5,
    odds: -115,
    modelProbability: 0.6,
    confidence: 0.72,
    riskScore: 0.78,
    dataQualityScore: 0.72,
    playerRole: "QB",
    projectedTeamPlays: 65,
    projectedPassRate: 0.66,
    lineFragilityScore: 0.32,
  }),

  // --- Game 3: SF vs NYG, blowout-script RB stack.
  buildLeg({
    id: "leg-sf-mccaffrey-rushatt-over",
    playerName: "Christian McCaffrey",
    team: "SF",
    opponent: "NYG",
    gameId: "game-sf-nyg",
    propType: "RUSHING_ATTEMPTS",
    side: "OVER",
    line: 18.5,
    odds: -125,
    modelProbability: 0.66,
    confidence: 0.8,
    riskScore: 0.82,
    dataQualityScore: 0.8,
    playerRole: "RB_BELLCOW",
    projectedTeamPlays: 64,
    projectedPassRate: 0.5,
    favoritePosture: "FAVORITE",
    lineFragilityScore: 0.3,
  }),
  buildLeg({
    id: "leg-sf-mccaffrey-rushyds-over",
    playerName: "Christian McCaffrey",
    team: "SF",
    opponent: "NYG",
    gameId: "game-sf-nyg",
    propType: "RUSHING_YARDS",
    side: "OVER",
    line: 88.5,
    odds: -110,
    modelProbability: 0.6,
    confidence: 0.74,
    riskScore: 0.8,
    dataQualityScore: 0.78,
    playerRole: "RB_BELLCOW",
    projectedTeamPlays: 64,
    projectedPassRate: 0.5,
    favoritePosture: "FAVORITE",
    lineFragilityScore: 0.4,
  }),

  // --- Game 4: CHI vs DET, RB underdog committee — script conflict expected.
  buildLeg({
    id: "leg-chi-johnson-rushatt-over",
    playerName: "Roschon Johnson",
    team: "CHI",
    opponent: "DET",
    gameId: "game-chi-det",
    propType: "RUSHING_ATTEMPTS",
    side: "OVER",
    line: 11.5,
    odds: -105,
    modelProbability: 0.55,
    confidence: 0.6,
    riskScore: 0.6,
    dataQualityScore: 0.6,
    playerRole: "RB_COMMITTEE",
    projectedTeamPlays: 60,
    projectedPassRate: 0.68,
    favoritePosture: "UNDERDOG",
    lineFragilityScore: 0.55,
  }),
  buildLeg({
    id: "leg-chi-johnson-rushyds-over",
    playerName: "Roschon Johnson",
    team: "CHI",
    opponent: "DET",
    gameId: "game-chi-det",
    propType: "RUSHING_YARDS",
    side: "OVER",
    line: 45.5,
    odds: -110,
    modelProbability: 0.53,
    confidence: 0.58,
    riskScore: 0.6,
    dataQualityScore: 0.58,
    playerRole: "RB_COMMITTEE",
    favoritePosture: "UNDERDOG",
    lineFragilityScore: 0.6,
  }),

  // --- Game 5: NYJ vs NE — bad weather UNDER stack.
  buildLeg({
    id: "leg-nyj-rodgers-passyds-under",
    playerName: "Aaron Rodgers",
    team: "NYJ",
    opponent: "NE",
    gameId: "game-nyj-ne",
    propType: "PASSING_YARDS",
    side: "UNDER",
    line: 242.5,
    odds: -110,
    modelProbability: 0.62,
    confidence: 0.72,
    riskScore: 0.65,
    dataQualityScore: 0.72,
    playerRole: "QB",
    weatherRiskScore: 0.4,
    pressureRiskScore: 0.55,
    projectedTeamPlays: 60,
    projectedPassRate: 0.55,
    lineFragilityScore: 0.45,
  }),
  buildLeg({
    id: "leg-nyj-wilson-recyds-under",
    playerName: "Garrett Wilson",
    team: "NYJ",
    opponent: "NE",
    gameId: "game-nyj-ne",
    propType: "RECEIVING_YARDS",
    side: "UNDER",
    line: 64.5,
    odds: -110,
    modelProbability: 0.6,
    confidence: 0.68,
    riskScore: 0.65,
    dataQualityScore: 0.7,
    playerRole: "WR_ALPHA",
    weatherRiskScore: 0.4,
    pressureRiskScore: 0.55,
    lineFragilityScore: 0.5,
  }),

  // --- Game 5b: NE checkdown / pressure stack candidate
  buildLeg({
    id: "leg-nyj-cook-receptions-over",
    playerName: "Dalvin Cook",
    team: "NYJ",
    opponent: "NE",
    gameId: "game-nyj-ne",
    propType: "RECEPTIONS",
    side: "OVER",
    line: 3.5,
    odds: -125,
    modelProbability: 0.62,
    confidence: 0.66,
    riskScore: 0.62,
    dataQualityScore: 0.66,
    playerRole: "RB_COMMITTEE",
    pressureRiskScore: 0.6,
    lineFragilityScore: 0.45,
  }),

  // --- Game 6: PHI vs WAS — clean QB/WR but receiver carries a low-DQ leg.
  buildLeg({
    id: "leg-phi-hurts-passyds-over",
    playerName: "Jalen Hurts",
    team: "PHI",
    opponent: "WAS",
    gameId: "game-phi-was",
    propType: "PASSING_YARDS",
    side: "OVER",
    line: 226.5,
    odds: -115,
    modelProbability: 0.6,
    confidence: 0.72,
    riskScore: 0.78,
    dataQualityScore: 0.74,
    playerRole: "QB",
    projectedTeamPlays: 62,
    projectedPassRate: 0.58,
    lineFragilityScore: 0.4,
  }),
  buildLeg({
    id: "leg-phi-smith-recyds-over-lowdq",
    playerName: "DeVonta Smith",
    team: "PHI",
    opponent: "WAS",
    gameId: "game-phi-was",
    propType: "RECEIVING_YARDS",
    side: "OVER",
    line: 64.5,
    odds: -110,
    modelProbability: 0.58,
    confidence: 0.6,
    riskScore: 0.6,
    dataQualityScore: 0.42,
    qualified: false,
    primaryDisqualifier: "Data quality 0.42 below 0.55 floor",
    playerRole: "WR_ALPHA",
    lineFragilityScore: 0.45,
  }),

  // --- Game 7: CIN vs BAL — fragile WR yards leg.
  buildLeg({
    id: "leg-cin-chase-recyds-over-fragile",
    playerName: "Ja'Marr Chase",
    team: "CIN",
    opponent: "BAL",
    gameId: "game-cin-bal",
    propType: "RECEIVING_YARDS",
    side: "OVER",
    line: 78.5,
    odds: -110,
    modelProbability: 0.58,
    confidence: 0.7,
    riskScore: 0.78,
    dataQualityScore: 0.72,
    playerRole: "WR_ALPHA",
    lineFragilityScore: 0.88,
  }),
  buildLeg({
    id: "leg-cin-burrow-passyds-over",
    playerName: "Joe Burrow",
    team: "CIN",
    opponent: "BAL",
    gameId: "game-cin-bal",
    propType: "PASSING_YARDS",
    side: "OVER",
    line: 252.5,
    odds: -110,
    modelProbability: 0.61,
    confidence: 0.74,
    riskScore: 0.78,
    dataQualityScore: 0.78,
    playerRole: "QB",
    projectedTeamPlays: 63,
    projectedPassRate: 0.62,
    lineFragilityScore: 0.35,
  }),

  // --- Game 8: SF vs NYG — additional receiver to test overstacking (3 WR OVERs).
  buildLeg({
    id: "leg-sf-aiyuk-recyds-over",
    playerName: "Brandon Aiyuk",
    team: "SF",
    opponent: "NYG",
    gameId: "game-sf-nyg",
    propType: "RECEIVING_YARDS",
    side: "OVER",
    line: 60.5,
    odds: -110,
    modelProbability: 0.58,
    confidence: 0.7,
    riskScore: 0.78,
    dataQualityScore: 0.75,
    playerRole: "WR_ALPHA",
    projectedTeamPlays: 64,
    projectedPassRate: 0.5,
    lineFragilityScore: 0.4,
  }),
  buildLeg({
    id: "leg-sf-kittle-recyds-over",
    playerName: "George Kittle",
    team: "SF",
    opponent: "NYG",
    gameId: "game-sf-nyg",
    propType: "RECEIVING_YARDS",
    side: "OVER",
    line: 48.5,
    odds: -120,
    modelProbability: 0.58,
    confidence: 0.68,
    riskScore: 0.75,
    dataQualityScore: 0.72,
    playerRole: "TE",
    projectedTeamPlays: 64,
    projectedPassRate: 0.5,
    lineFragilityScore: 0.4,
  }),
  buildLeg({
    id: "leg-sf-purdy-passyds-over",
    playerName: "Brock Purdy",
    team: "SF",
    opponent: "NYG",
    gameId: "game-sf-nyg",
    propType: "PASSING_YARDS",
    side: "OVER",
    line: 226.5,
    odds: -110,
    modelProbability: 0.6,
    confidence: 0.7,
    riskScore: 0.78,
    dataQualityScore: 0.75,
    playerRole: "QB",
    projectedTeamPlays: 64,
    projectedPassRate: 0.5,
    lineFragilityScore: 0.35,
  }),

  // --- Game 9: LV vs LAC — different-game pairing source.
  buildLeg({
    id: "leg-lv-meyers-receptions-over",
    playerName: "Jakobi Meyers",
    team: "LV",
    opponent: "LAC",
    gameId: "game-lv-lac",
    propType: "RECEPTIONS",
    side: "OVER",
    line: 4.5,
    odds: -120,
    modelProbability: 0.6,
    confidence: 0.66,
    riskScore: 0.72,
    dataQualityScore: 0.7,
    playerRole: "WR_SLOT",
    lineFragilityScore: 0.4,
  }),

  // --- Long-shot high-payout pairing.
  buildLeg({
    id: "leg-buf-cook-rushyds-over-longshot",
    playerName: "James Cook",
    team: "BUF",
    opponent: "MIA",
    gameId: "game-buf-mia",
    propType: "RUSHING_YARDS",
    side: "OVER",
    line: 88.5,
    odds: 260,
    modelProbability: 0.18,
    confidence: 0.6,
    riskScore: 0.62,
    dataQualityScore: 0.6,
    qualified: false,
    primaryDisqualifier:
      "Model probability 0.18 trails market — long-shot price not justified by projection",
    playerRole: "RB_COMMITTEE",
    favoritePosture: "FAVORITE",
    lineFragilityScore: 0.5,
  }),

  // --- Low-confidence leg for "positive EV but low confidence" case.
  buildLeg({
    id: "leg-cin-higgins-recyds-over-lowconf",
    playerName: "Tee Higgins",
    team: "CIN",
    opponent: "BAL",
    gameId: "game-cin-bal",
    propType: "RECEIVING_YARDS",
    side: "OVER",
    line: 56.5,
    odds: -115,
    modelProbability: 0.62,
    confidence: 0.48,
    riskScore: 0.55,
    dataQualityScore: 0.6,
    qualified: false,
    primaryDisqualifier: "Confidence 0.48 below 0.55 floor",
    playerRole: "WR_ALPHA",
    lineFragilityScore: 0.45,
  }),
];

export interface ParlayCandidateFixture {
  scenarioNote: string;
  legIds: string[];
  parlayType?: ParlayType;
}

export const PARLAY_CANDIDATE_FIXTURES: ParlayCandidateFixture[] = [
  {
    scenarioNote:
      "QB passing yards OVER + WR receiving yards OVER — clean same-team stack, qualifies",
    legIds: ["leg-buf-allen-passyds-over", "leg-buf-diggs-recyds-over"],
    parlayType: "QB_RECEIVER_YARDS",
  },
  {
    scenarioNote:
      "QB completions OVER + slot WR receptions OVER — quick-game stack, qualifies",
    legIds: [
      "leg-kc-mahomes-completions-over",
      "leg-kc-rice-receptions-over",
    ],
    parlayType: "QB_COMPLETIONS_RECEIVER_RECEPTIONS",
  },
  {
    scenarioNote:
      "QB attempts OVER + slot WR receptions OVER — pass-volume stack",
    legIds: [
      "leg-kc-mahomes-attempts-over",
      "leg-kc-rice-receptions-over",
    ],
    parlayType: "PASS_VOLUME_STACK",
  },
  {
    scenarioNote:
      "RB attempts OVER + RB yards OVER for SF (favorite script) — qualifies",
    legIds: [
      "leg-sf-mccaffrey-rushatt-over",
      "leg-sf-mccaffrey-rushyds-over",
    ],
    parlayType: "RB_GAME_SCRIPT_STACK",
  },
  {
    scenarioNote:
      "RB attempts OVER + RB yards OVER for CHI (underdog committee) — should pass",
    legIds: [
      "leg-chi-johnson-rushatt-over",
      "leg-chi-johnson-rushyds-over",
    ],
    parlayType: "RB_GAME_SCRIPT_STACK",
  },
  {
    scenarioNote:
      "Bad weather: QB passing yards UNDER + WR receiving yards UNDER — qualifies",
    legIds: [
      "leg-nyj-rodgers-passyds-under",
      "leg-nyj-wilson-recyds-under",
    ],
    parlayType: "WEATHER_UNDER_STACK",
  },
  {
    scenarioNote:
      "Pressure setup: QB passing UNDER + RB receptions OVER — correlated watch",
    legIds: [
      "leg-nyj-rodgers-passyds-under",
      "leg-nyj-cook-receptions-over",
    ],
    parlayType: "PRESSURE_QUICK_GAME_STACK",
  },
  {
    scenarioNote:
      "Overstacked pass game: QB OVER + two SF WR/TE OVERs — blocked",
    legIds: [
      "leg-sf-purdy-passyds-over",
      "leg-sf-aiyuk-recyds-over",
      "leg-sf-kittle-recyds-over",
    ],
  },
  {
    scenarioNote:
      "Conflicting script: QB OVER + same-team RB attempts OVER (CHI low volume) — blocked",
    legIds: [
      "leg-buf-allen-passyds-over",
      "leg-chi-johnson-rushatt-over",
    ],
  },
  {
    scenarioNote:
      "One weak (low-DQ) leg blocks the parlay",
    legIds: [
      "leg-phi-hurts-passyds-over",
      "leg-phi-smith-recyds-over-lowdq",
    ],
  },
  {
    scenarioNote:
      "High-payout longshot pairing — low joint probability blocks the parlay",
    legIds: [
      "leg-buf-allen-passyds-over",
      "leg-buf-cook-rushyds-over-longshot",
    ],
  },
  {
    scenarioNote:
      "Positive EV but low-confidence leg blocks the parlay",
    legIds: [
      "leg-cin-burrow-passyds-over",
      "leg-cin-higgins-recyds-over-lowconf",
    ],
  },
  {
    scenarioNote:
      "Unknown correlation pairing (different game) — does not qualify by itself",
    legIds: [
      "leg-kc-mahomes-completions-over",
      "leg-lv-meyers-receptions-over",
    ],
  },
  {
    scenarioNote:
      "Same player RB attempts + yards stack — qualifies with strong role",
    legIds: [
      "leg-sf-mccaffrey-rushatt-over",
      "leg-sf-mccaffrey-rushyds-over",
    ],
    parlayType: "RB_GAME_SCRIPT_STACK",
  },
  {
    scenarioNote:
      "Different-game parlay treated as weak correlation (passes thresholds → CORRELATED_WATCH)",
    legIds: [
      "leg-buf-allen-passyds-over",
      "leg-lv-meyers-receptions-over",
    ],
  },
  {
    scenarioNote:
      "Line fragility on one leg blocks an otherwise thin parlay",
    legIds: [
      "leg-cin-burrow-passyds-over",
      "leg-cin-chase-recyds-over-fragile",
    ],
  },
];

export function getParlayLegById(id: string): ParlayLeg | undefined {
  return PARLAY_LEG_FIXTURES.find((l) => l.id === id);
}
