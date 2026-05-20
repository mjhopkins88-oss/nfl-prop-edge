/**
 * Signal deduplication for the v2 player prop pipeline.
 *
 * Prevents the model from counting the same underlying idea
 * multiple times. Categories are coarse on purpose — they map to
 * the `SignalCategory` enum in `prop-model-config.ts`.
 *
 * Behavior:
 *   1. Group signals by category.
 *   2. Within a category, the total adjustment is capped at the
 *      most impactful signal × `MULTI_SIGNAL_BONUS` (default 1.25)
 *      regardless of how many sub-signals were added.
 *   3. Across categories, no cap — different categories are
 *      independent.
 *
 * Example: `oLineInjuryRisk` and `pressureProxy` both belong to
 * MATCHUP. If pressure says "-2pp" and OL injury says "-1.5pp",
 * the combined matchup hit is capped at 2.5pp (not 3.5pp), so we
 * never penalize the same "pressure-sensitive QB" idea twice.
 */

import type { SignalCategory } from "./prop-model-config";

export interface DedupSignal {
  /** Human-readable signal name (used in trace notes). */
  name: string;
  category: SignalCategory;
  /** Signed adjustment in percentage points (negative = penalty). */
  deltaPp: number;
  /** 0..1 — how confident we are this signal applies. */
  confidence: number;
  /** Independent signals are exempt from cross-category capping. */
  independent?: boolean;
  /** Optional explanation surfaced in trace / risks. */
  explanation?: string;
}

export interface SignalDeduplicationResult {
  /** Adjustments per category, after capping. */
  byCategory: Array<{
    category: SignalCategory;
    rawSumPp: number;
    cappedSumPp: number;
    signalCount: number;
    dominantSignal?: string;
    notes: string[];
  }>;
  /** Sum of capped adjustments across all categories (in pp). */
  totalCappedAdjustmentPp: number;
  /** Sum of raw adjustments (pre-cap) across all categories (in pp). */
  totalRawAdjustmentPp: number;
  /** Free-text notes about deduplication decisions. */
  notes: string[];
}

const MULTI_SIGNAL_BONUS = 1.25;

function maxByAbsDelta(signals: DedupSignal[]): DedupSignal | undefined {
  let best: DedupSignal | undefined;
  for (const s of signals) {
    if (!best || Math.abs(s.deltaPp) > Math.abs(best.deltaPp)) best = s;
  }
  return best;
}

export function detectOverlappingSignals(
  signals: DedupSignal[],
): Map<SignalCategory, DedupSignal[]> {
  const m = new Map<SignalCategory, DedupSignal[]>();
  for (const s of signals) {
    const arr = m.get(s.category) ?? [];
    arr.push(s);
    m.set(s.category, arr);
  }
  return m;
}

export function capCombinedSignalImpact(
  signals: DedupSignal[],
): SignalDeduplicationResult {
  const groups = detectOverlappingSignals(signals);
  const byCategory: SignalDeduplicationResult["byCategory"] = [];
  const notes: string[] = [];
  let totalCapped = 0;
  let totalRaw = 0;

  for (const [category, group] of groups.entries()) {
    const rawSum = group.reduce((a, b) => a + b.deltaPp, 0);
    const dominant = maxByAbsDelta(group);
    if (!dominant) continue;
    // Within-category cap: max signal × MULTI_SIGNAL_BONUS, preserving sign.
    const cap = Math.abs(dominant.deltaPp) * MULTI_SIGNAL_BONUS;
    const cappedAbs = Math.min(Math.abs(rawSum), cap);
    const cappedSum = Math.sign(rawSum || 1) * cappedAbs;
    const categoryNotes: string[] = [];
    if (group.length > 1 && Math.abs(rawSum) > cap) {
      categoryNotes.push(
        `Capped ${category} from raw ${rawSum.toFixed(2)}pp to ${cappedSum.toFixed(2)}pp — multiple signals overlapped`,
      );
      notes.push(
        `${category}: ${group.length} signals collapsed to ${cappedSum.toFixed(2)}pp (dominant: ${dominant.name})`,
      );
    }
    byCategory.push({
      category,
      rawSumPp: rawSum,
      cappedSumPp: cappedSum,
      signalCount: group.length,
      dominantSignal: dominant.name,
      notes: categoryNotes,
    });
    totalCapped += cappedSum;
    totalRaw += rawSum;
  }

  return {
    byCategory,
    totalCappedAdjustmentPp: totalCapped,
    totalRawAdjustmentPp: totalRaw,
    notes,
  };
}

export function buildSignalDeduplicationNotes(
  result: SignalDeduplicationResult,
): string[] {
  if (result.byCategory.length === 0) return [];
  const lines: string[] = [];
  for (const cat of result.byCategory) {
    if (cat.signalCount > 1) {
      lines.push(
        `${cat.category}: ${cat.signalCount} signals → ${cat.cappedSumPp.toFixed(2)}pp (capped from ${cat.rawSumPp.toFixed(2)}pp)`,
      );
    } else {
      lines.push(
        `${cat.category}: ${cat.cappedSumPp.toFixed(2)}pp from "${cat.dominantSignal}"`,
      );
    }
  }
  return lines;
}
