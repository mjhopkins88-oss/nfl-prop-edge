/**
 * Market disagreement classification + overconfidence guard for V1
 * player props.
 *
 * Existing `market-anchored-probability.ts` exposes a similar
 * classification for the *probability adjustment magnitude*. This
 * module wraps that idea in a prop-level perspective: how far did
 * the model end up from the no-vig market, and is that gap
 * justified by the underlying confidence + data quality?
 *
 * Rules:
 *   - |model - market| < 4pp                       → MARKET_ALIGNED
 *   - < 8pp                                        → SMALL_DIFFERENCE
 *   - 8..12pp + confidence ≥ 0.55 + DQ ≥ 0.55      → HEALTHY_EDGE
 *   - 8..12pp + confidence < 0.55                  → DANGEROUS_DISAGREEMENT
 *   - ≥ 12pp + (confidence < 0.6 || DQ < 0.6)      → LIKELY_MODEL_OVERCONFIDENCE
 *   - ≥ 12pp + proxy-only / matchup-only support   → LIKELY_MODEL_OVERCONFIDENCE
 *   - ≥ 12pp + multi-signal high confidence        → HEALTHY_EDGE (rare)
 */

export type MarketDisagreementClassification =
  | "MARKET_ALIGNED"
  | "SMALL_DIFFERENCE"
  | "HEALTHY_EDGE"
  | "DANGEROUS_DISAGREEMENT"
  | "LIKELY_MODEL_OVERCONFIDENCE";

export interface MarketDisagreementInput {
  modelProbability: number;
  noVigMarketProbability: number;
  confidence: number;
  dataQuality: number;
  /**
   * Indicates whether the model's lift is supported by independent
   * signals (true) or only by proxies / matchup intelligence
   * (false). Independent signals: recent usage, team volume,
   * weather, injury report, coaching uncertainty.
   */
  hasIndependentSignals?: boolean;
  /**
   * Count of independent high-confidence signals supporting the
   * lift. ≥ 2 is meaningful corroboration.
   */
  independentSignalCount?: number;
}

export interface MarketDisagreementOutput {
  /** Absolute |model - market| in percentage points. */
  disagreementPp: number;
  /** Signed difference (model - market) in pp. */
  signedDisagreementPp: number;
  classification: MarketDisagreementClassification;
  overconfidenceWarning?: string;
  reasons: string[];
  risks: string[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

export function calculateMarketDisagreement(
  input: MarketDisagreementInput,
): MarketDisagreementOutput {
  const signed = (input.modelProbability - input.noVigMarketProbability) * 100;
  const magnitude = Math.abs(signed);
  const reasons: string[] = [];
  const risks: string[] = [];

  let classification: MarketDisagreementClassification;
  if (magnitude < 4) {
    classification = "MARKET_ALIGNED";
    reasons.push(
      `Model probability within ${magnitude.toFixed(1)}pp of market — aligned`,
    );
  } else if (magnitude < 8) {
    classification = "SMALL_DIFFERENCE";
    reasons.push(
      `Model probability ${magnitude.toFixed(1)}pp from market — small but real difference`,
    );
  } else if (magnitude < 12) {
    if (input.confidence >= 0.55 && input.dataQuality >= 0.55) {
      classification = "HEALTHY_EDGE";
      reasons.push(
        `Healthy ${magnitude.toFixed(1)}pp disagreement with confidence ${(input.confidence * 100).toFixed(0)}% and data quality ${(input.dataQuality * 100).toFixed(0)}%`,
      );
    } else {
      classification = "DANGEROUS_DISAGREEMENT";
      risks.push(
        `${magnitude.toFixed(1)}pp gap from market but confidence ${(input.confidence * 100).toFixed(0)}% / data quality ${(input.dataQuality * 100).toFixed(0)}% are below 55%`,
      );
    }
  } else {
    const multiSignal = (input.independentSignalCount ?? 0) >= 2;
    const independent = input.hasIndependentSignals !== false;
    if (
      multiSignal &&
      independent &&
      input.confidence >= 0.6 &&
      input.dataQuality >= 0.6
    ) {
      classification = "HEALTHY_EDGE";
      reasons.push(
        `Large ${magnitude.toFixed(1)}pp gap supported by ${input.independentSignalCount} independent high-confidence signals`,
      );
    } else {
      classification = "LIKELY_MODEL_OVERCONFIDENCE";
      risks.push(
        `Model ${magnitude.toFixed(1)}pp away from market without sufficient independent support — likely overconfident`,
      );
    }
  }

  let overconfidenceWarning: string | undefined;
  if (
    classification === "LIKELY_MODEL_OVERCONFIDENCE" ||
    classification === "DANGEROUS_DISAGREEMENT"
  ) {
    overconfidenceWarning = buildOverconfidenceWarning({
      classification,
      magnitudePp: magnitude,
      confidence: input.confidence,
      dataQuality: input.dataQuality,
      independent: input.hasIndependentSignals !== false,
      signalCount: input.independentSignalCount ?? 0,
    });
  }

  return {
    disagreementPp: clamp(magnitude, 0, 100),
    signedDisagreementPp: signed,
    classification,
    overconfidenceWarning,
    reasons,
    risks,
  };
}

export function classifyMarketDisagreement(
  input: MarketDisagreementInput,
): MarketDisagreementClassification {
  return calculateMarketDisagreement(input).classification;
}

export function buildOverconfidenceWarning(args: {
  classification: MarketDisagreementClassification;
  magnitudePp: number;
  confidence: number;
  dataQuality: number;
  independent: boolean;
  signalCount: number;
}): string {
  if (args.classification === "LIKELY_MODEL_OVERCONFIDENCE") {
    if (!args.independent) {
      return `Model is ${args.magnitudePp.toFixed(1)}pp away from market on proxy / matchup signal alone — treat as overconfident and PASS unless independent evidence stacks up`;
    }
    if (args.signalCount < 2) {
      return `Single-signal ${args.magnitudePp.toFixed(1)}pp model disagreement — needs at least two independent supports before booking`;
    }
    return `Model ${args.magnitudePp.toFixed(1)}pp from market with confidence ${(args.confidence * 100).toFixed(0)}% / data quality ${(args.dataQuality * 100).toFixed(0)}% — likely overconfident`;
  }
  return `${args.magnitudePp.toFixed(1)}pp gap with sub-55% confidence — treat with caution`;
}
