import {
  buildPropDecisionScorecard,
  type PropDecisionScorecard,
} from "./model-scorecard";
import { getRiskInputsForProp } from "./risk-inputs";
import {
  getGameById,
  getMatchupNotes,
  getPlayerById,
  getPropById,
  getPropDetail,
  getProps,
  getTeam,
} from "../mock-data";
import type {
  Game,
  GameLog,
  LineQuote,
  Player,
  PropMarket,
  Team,
} from "../types";

export interface PropOpportunity {
  prop: PropMarket;
  player: Player;
  team: Team;
  opponent: Team;
  game: Game;
  scorecard: PropDecisionScorecard;
}

export interface PropOpportunityDetail extends PropOpportunity {
  recentLogs: GameLog[];
  altLines: LineQuote[];
  matchupNotes: string[];
}

function scorecardForProp(
  prop: PropMarket,
  playerName: string,
): PropDecisionScorecard {
  const risk = getRiskInputsForProp(prop.id);
  return buildPropDecisionScorecard({
    propId: prop.id,
    playerName,
    propType: prop.propType,
    marketLine: prop.line,
    overOdds: prop.overOdds,
    underOdds: prop.underOdds,
    projectedMean: prop.projection,
    projectedStdDev: prop.projectionStdDev,
    ...risk,
  });
}

function assemble(prop: PropMarket): PropOpportunity | undefined {
  const player = getPlayerById(prop.playerId);
  if (!player) return undefined;
  const team = getTeam(player.teamAbbr);
  if (!team) return undefined;
  const game = getGameById(prop.gameId);
  if (!game) return undefined;
  const opponentAbbr =
    game.homeTeamAbbr === player.teamAbbr
      ? game.awayTeamAbbr
      : game.homeTeamAbbr;
  const opponent = getTeam(opponentAbbr);
  if (!opponent) return undefined;
  return {
    prop,
    player,
    team,
    opponent,
    game,
    scorecard: scorecardForProp(prop, player.fullName),
  };
}

export function getOpportunities(): PropOpportunity[] {
  return getProps()
    .map(assemble)
    .filter((o): o is PropOpportunity => o !== undefined);
}

export function getOpportunityById(id: string): PropOpportunity | undefined {
  const prop = getPropById(id);
  if (!prop) return undefined;
  return assemble(prop);
}

export function getOpportunityDetail(
  id: string,
): PropOpportunityDetail | undefined {
  const detail = getPropDetail(id);
  if (!detail) return undefined;
  const opp = assemble(detail);
  if (!opp) return undefined;
  return {
    ...opp,
    recentLogs: detail.recentLogs,
    altLines: detail.altLines,
    matchupNotes: getMatchupNotes(id),
  };
}

export function selectedEdge(scorecard: PropDecisionScorecard): number {
  return scorecard.selectedSide === "OVER"
    ? scorecard.edgeOver
    : scorecard.edgeUnder;
}

export function selectedModelProbability(
  scorecard: PropDecisionScorecard,
): number {
  return scorecard.selectedSide === "OVER"
    ? scorecard.modelOverProbability
    : scorecard.modelUnderProbability;
}

export function selectedNoVigProbability(
  scorecard: PropDecisionScorecard,
): number {
  return scorecard.selectedSide === "OVER"
    ? scorecard.noVigOverProbability
    : scorecard.noVigUnderProbability;
}

export function selectedSideOdds(
  prop: PropMarket,
  scorecard: PropDecisionScorecard,
): number {
  return scorecard.selectedSide === "OVER" ? prop.overOdds : prop.underOdds;
}

export interface OpportunityValidationIssue {
  id: string | undefined;
  problems: string[];
}

export function validatePropOpportunity(
  opp: PropOpportunity,
): OpportunityValidationIssue | null {
  const problems: string[] = [];
  if (!opp.prop?.propType) problems.push("missing prop type");
  if (typeof opp.prop?.line !== "number") problems.push("missing market line");
  if (typeof opp.prop?.overOdds !== "number") problems.push("missing over odds");
  if (typeof opp.prop?.underOdds !== "number") problems.push("missing under odds");
  if (!opp.scorecard) problems.push("missing scorecard");
  if (opp.scorecard && !opp.scorecard.recommendation)
    problems.push("missing recommendation on scorecard");
  if (opp.scorecard && !opp.scorecard.finalExplanation)
    problems.push("missing final explanation on scorecard");
  if (problems.length === 0) return null;
  return { id: opp.prop?.id, problems };
}

export function warnIfInvalidOpportunities(opps: PropOpportunity[]): void {
  if (process.env.NODE_ENV === "production") return;
  for (const opp of opps) {
    const issue = validatePropOpportunity(opp);
    if (issue) {
      console.warn(
        `[prop-opportunity] prop ${issue.id ?? "(unknown)"} is missing: ${issue.problems.join(", ")}`,
      );
    }
  }
}
