export interface RiskInputs {
  dataQualityScore: number;
  roleStabilityScore: number;
  gameScriptScore: number;
  paceScore: number;
  marketContextScore: number;
  weatherEnvironmentScore: number;
  injuryContextScore: number;
  correlationExposureScore: number;
}

export const DEFAULT_RISK_INPUTS: RiskInputs = {
  dataQualityScore: 0.78,
  roleStabilityScore: 0.78,
  gameScriptScore: 0.7,
  paceScore: 0.7,
  marketContextScore: 0.68,
  weatherEnvironmentScore: 0.8,
  injuryContextScore: 0.8,
  correlationExposureScore: 0.75,
};

const propRiskOverrides: Record<string, Partial<RiskInputs>> = {
  // Strong edge but injury context concern (Metcalf questionable per mock notes)
  "metcalf-recyds-sf": { injuryContextScore: 0.3 },
  // Already exposed to CMC rushing yards — correlation gate blocks the receptions play
  "cmc-rec-sea": { correlationExposureScore: 0.3 },
  // Weather concern in CIN @ BAL (heavy winds, low passing environment)
  "lamar-passyds-cin": { weatherEnvironmentScore: 0.25 },
  // Sharp market move against — market context gate blocks
  "arsb-recyds-min": { marketContextScore: 0.3 },
};

export function getRiskInputsForProp(propId: string): RiskInputs {
  return { ...DEFAULT_RISK_INPUTS, ...(propRiskOverrides[propId] ?? {}) };
}
