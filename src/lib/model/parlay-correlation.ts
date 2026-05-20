/**
 * Correlation classification for parlay candidates.
 *
 * Treats player relationships, prop types, side direction, and
 * game environment as the inputs. Outputs a signed correlationScore
 * (-1..+1), a CorrelationType label, and a human-readable
 * explanation that the scorecard surfaces.
 *
 * Important — no automated betting decisions are produced here.
 * This module just describes the relationship between legs.
 */

import type { PropType } from "../types";
import type {
  ParlayCorrelationResult,
  ParlayLeg,
  ParlayPlayerRole,
} from "./parlay-types";

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function isPassingProp(propType: PropType): boolean {
  return (
    propType === "PASSING_YARDS" ||
    propType === "PASSING_ATTEMPTS" ||
    propType === "PASSING_COMPLETIONS"
  );
}

function isReceivingProp(propType: PropType): boolean {
  return propType === "RECEPTIONS" || propType === "RECEIVING_YARDS";
}

function isRushingProp(propType: PropType): boolean {
  return propType === "RUSHING_ATTEMPTS" || propType === "RUSHING_YARDS";
}

function sameSide(a: ParlayLeg, b: ParlayLeg): boolean {
  return a.side === b.side;
}

function sameTeam(a: ParlayLeg, b: ParlayLeg): boolean {
  return a.team === b.team;
}

function sameGame(legs: ParlayLeg[]): boolean {
  const first = legs[0].gameId;
  return legs.every((l) => l.gameId === first);
}

function sumPlays(legs: ParlayLeg[]): number {
  const values = legs
    .map((l) => l.projectedTeamPlays)
    .filter((v): v is number => typeof v === "number");
  if (values.length === 0) return 60; // neutral default
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Pairwise (or trio) correlation classifier. Honors:
 *   - same / different game
 *   - QB ↔ receiver passing-game correlation
 *   - RB attempts ↔ RB yards same-player correlation
 *   - Game-script conflicts (QB OVER + RB OVER for same team in low-volume game)
 *   - Multi-receiver overstacking (multiple WR OVERs from same team)
 *   - Weather/under stacks (UNDER on QB yards + UNDER on receiver yards in bad weather)
 */
export function calculateLegCorrelation(
  legs: ParlayLeg[],
): ParlayCorrelationResult {
  if (legs.length < 2) {
    return {
      correlationScore: 0,
      correlationType: "UNKNOWN",
      correlationExplanation: "Single-leg parlay — no correlation.",
      overstackingRisk: false,
      conflictingScript: false,
      sameGame: legs.length === 1,
    };
  }
  const sg = sameGame(legs);
  if (!sg) {
    return {
      correlationScore: 0,
      correlationType: "WEAK",
      correlationExplanation:
        "Different games — leg outcomes treated as independent (weak correlation).",
      overstackingRisk: false,
      conflictingScript: false,
      sameGame: false,
    };
  }

  // Pairwise: build up score + reasons across the legs.
  const reasons: string[] = [];
  let score = 0;
  let conflictingScript = false;
  let overstackingRisk = false;

  // Count receiving OVERs from same team for overstacking detection.
  const sameTeamReceivingOversCount = new Map<string, number>();
  for (const leg of legs) {
    if (isReceivingProp(leg.propType) && leg.side === "OVER") {
      sameTeamReceivingOversCount.set(
        leg.team,
        (sameTeamReceivingOversCount.get(leg.team) ?? 0) + 1,
      );
    }
  }
  for (const count of sameTeamReceivingOversCount.values()) {
    if (count >= 2) {
      overstackingRisk = true;
      reasons.push(
        "Multiple WR/TE OVERs from the same team — same-game target overstacking risk",
      );
      score -= 0.35;
    }
  }
  if (sameTeamReceivingOversCount.size >= 1) {
    const total = Array.from(sameTeamReceivingOversCount.values()).reduce(
      (a, b) => a + b,
      0,
    );
    if (total >= 3) {
      score -= 0.15;
      reasons.push(
        "Three or more receiving OVERs across the slate — pass volume must support every target",
      );
    }
  }

  for (let i = 0; i < legs.length - 1; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      const pair = classifyPair(a, b);
      score += pair.delta;
      if (pair.note) reasons.push(pair.note);
      if (pair.conflicting) conflictingScript = true;
    }
  }

  // Game-script conflict: same team, passing OVER + rushing OVER with
  // a low projected play total or projected pass rate.
  for (let i = 0; i < legs.length - 1; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (!sameTeam(a, b)) continue;
      const passOver =
        isPassingProp(a.propType) && a.side === "OVER"
          ? a
          : isPassingProp(b.propType) && b.side === "OVER"
            ? b
            : undefined;
      const rushOver =
        isRushingProp(a.propType) && a.side === "OVER"
          ? a
          : isRushingProp(b.propType) && b.side === "OVER"
            ? b
            : undefined;
      if (passOver && rushOver) {
        const plays = sumPlays(legs);
        const passRate = passOver.projectedPassRate ?? 0.6;
        if (plays < 64 || passRate < 0.6) {
          conflictingScript = true;
          score -= 0.3;
          reasons.push(
            `Passing OVER + rushing OVER for the same team requires high play volume (have ~${plays.toFixed(0)} plays, ${(passRate * 100).toFixed(0)}% pass rate)`,
          );
        }
      }
    }
  }

  // Clamp + label.
  const finalScore = clamp(score, -1, 1);
  const type: ParlayCorrelationResult["correlationType"] =
    finalScore >= 0.35
      ? "POSITIVE"
      : finalScore <= -0.35
        ? "NEGATIVE"
        : conflictingScript
          ? "CONFLICTING"
          : Math.abs(finalScore) < 0.05
            ? "UNKNOWN"
            : "WEAK";

  const explanation =
    reasons.length === 0
      ? "Same-game legs with no clear correlation hook — treated as weak / unknown."
      : reasons.join(" · ");

  return {
    correlationScore: finalScore,
    correlationType: type,
    correlationExplanation: explanation,
    overstackingRisk,
    conflictingScript,
    sameGame: sg,
  };
}

/**
 * Per-pair classification. Returns a small score delta plus an
 * optional human note.
 */
function classifyPair(
  a: ParlayLeg,
  b: ParlayLeg,
): { delta: number; note?: string; conflicting?: boolean } {
  // Same-player RB attempts + yards.
  if (
    a.playerName === b.playerName &&
    isRushingProp(a.propType) &&
    isRushingProp(b.propType) &&
    sameSide(a, b)
  ) {
    return {
      delta: 0.6,
      note: `Same player rushing attempts + yards (${a.playerName}) — strong direct correlation`,
    };
  }

  // QB + same-team receiver.
  if (sameTeam(a, b)) {
    const qb = isQb(a) ? a : isQb(b) ? b : undefined;
    const receiver =
      isReceivingProp(a.propType) && !isQb(a)
        ? a
        : isReceivingProp(b.propType) && !isQb(b)
          ? b
          : undefined;
    if (qb && receiver && sameSide(qb, receiver)) {
      if (
        qb.propType === "PASSING_YARDS" &&
        receiver.propType === "RECEIVING_YARDS"
      ) {
        return {
          delta: 0.55,
          note: `QB passing yards ${qb.side} + ${receiver.playerName} receiving yards ${receiver.side} — same-team yardage stack`,
        };
      }
      if (
        qb.propType === "PASSING_COMPLETIONS" &&
        receiver.propType === "RECEPTIONS"
      ) {
        return {
          delta: 0.5,
          note: `QB completions ${qb.side} + ${receiver.playerName} receptions ${receiver.side} — completion / target stack`,
        };
      }
      if (
        qb.propType === "PASSING_ATTEMPTS" &&
        receiver.propType === "RECEPTIONS"
      ) {
        return {
          delta: 0.45,
          note: `QB attempts ${qb.side} + ${receiver.playerName} receptions ${receiver.side} — pass-volume stack`,
        };
      }
      if (
        qb.propType === "PASSING_YARDS" &&
        receiver.propType === "RECEPTIONS"
      ) {
        return {
          delta: 0.35,
          note: `QB passing yards ${qb.side} + ${receiver.playerName} receptions ${receiver.side} — quick-game lean`,
        };
      }
      return {
        delta: 0.25,
        note: `${qb.playerName} (QB) + ${receiver.playerName} (receiver) same-team passing stack`,
      };
    }
  }

  // QB / opposing-team receivers: weather UNDER-UNDER on same game.
  if (
    sameGame([a, b]) &&
    !sameTeam(a, b) &&
    isPassingProp(a.propType) &&
    isReceivingProp(b.propType) &&
    a.side === "UNDER" &&
    b.side === "UNDER"
  ) {
    const weather = Math.min(
      a.weatherRiskScore ?? 1,
      b.weatherRiskScore ?? 1,
    );
    if (weather <= 0.55) {
      return {
        delta: 0.3,
        note: "Weather/environment under-stack across opposing passing offenses",
      };
    }
    return {
      delta: 0.05,
      note: "Cross-team UNDER pair — weak environmental correlation",
    };
  }

  // QB passing UNDER + RB receptions OVER (pressure / quick-game).
  if (
    sameTeam(a, b) &&
    isPassingProp(a.propType) &&
    a.side === "UNDER" &&
    b.propType === "RECEPTIONS" &&
    b.side === "OVER"
  ) {
    const pressure = Math.max(
      a.pressureRiskScore ?? 0,
      b.pressureRiskScore ?? 0,
    );
    if (pressure >= 0.5) {
      return {
        delta: 0.3,
        note: `Pressure / quick-game setup — ${b.playerName} checkdown receptions while QB passing UNDER`,
      };
    }
    return {
      delta: -0.1,
      note: `QB passing UNDER + ${b.playerName} receptions OVER without pressure support`,
    };
  }
  if (
    sameTeam(a, b) &&
    isPassingProp(b.propType) &&
    b.side === "UNDER" &&
    a.propType === "RECEPTIONS" &&
    a.side === "OVER"
  ) {
    const pressure = Math.max(
      a.pressureRiskScore ?? 0,
      b.pressureRiskScore ?? 0,
    );
    if (pressure >= 0.5) {
      return {
        delta: 0.3,
        note: `Pressure / quick-game setup — ${a.playerName} checkdown receptions while QB passing UNDER`,
      };
    }
    return {
      delta: -0.1,
      note: `QB passing UNDER + ${a.playerName} receptions OVER without pressure support`,
    };
  }

  // QB passing UNDER + receiver yards UNDER (opposing team negative).
  if (
    sameGame([a, b]) &&
    isPassingProp(a.propType) &&
    a.side === "UNDER" &&
    isReceivingProp(b.propType) &&
    b.side === "UNDER" &&
    sameTeam(a, b)
  ) {
    return {
      delta: 0.45,
      note: `QB passing UNDER + ${b.playerName} receiving UNDER — passing-game fade`,
    };
  }

  // Same-team QB passing OVER + RB rushing OVER — handled by conflicting-script later.
  if (
    sameTeam(a, b) &&
    ((isPassingProp(a.propType) && isRushingProp(b.propType)) ||
      (isPassingProp(b.propType) && isRushingProp(a.propType)))
  ) {
    return { delta: -0.05 };
  }

  return { delta: 0, note: undefined };
}

function isQb(leg: ParlayLeg): boolean {
  if (leg.playerRole === "QB") return true;
  return isPassingProp(leg.propType);
}

/**
 * Classify a raw correlation score into the public enum. Lets the
 * builder avoid duplicating the boundaries.
 */
export function classifyCorrelationType(
  correlationScore: number,
  conflictingScript: boolean,
): ParlayCorrelationResult["correlationType"] {
  if (correlationScore >= 0.35) return "POSITIVE";
  if (correlationScore <= -0.35) return "NEGATIVE";
  if (conflictingScript) return "CONFLICTING";
  if (Math.abs(correlationScore) < 0.05) return "UNKNOWN";
  return "WEAK";
}

/** Convenience: pure score (no labels), for ranking. */
export function calculateCorrelationScore(legs: ParlayLeg[]): number {
  return calculateLegCorrelation(legs).correlationScore;
}

export function buildCorrelationExplanation(legs: ParlayLeg[]): string {
  return calculateLegCorrelation(legs).correlationExplanation;
}

export function detectCorrelationConflict(legs: ParlayLeg[]): boolean {
  return calculateLegCorrelation(legs).conflictingScript;
}

export function detectOverstackingRisk(legs: ParlayLeg[]): boolean {
  return calculateLegCorrelation(legs).overstackingRisk;
}

/** Roles helper for fixtures + future projection paths. */
export const PARLAY_PLAYER_ROLES: ParlayPlayerRole[] = [
  "QB",
  "RB_BELLCOW",
  "RB_COMMITTEE",
  "WR_ALPHA",
  "WR_SECONDARY",
  "WR_SLOT",
  "WR_DEEP",
  "TE",
];
