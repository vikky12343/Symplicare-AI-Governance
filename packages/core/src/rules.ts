/**
 * Trend rule configuration.
 *
 * The source pack is explicit that these thresholds are a starting point to be
 * validated against real homes, not universal truths. They are therefore stored
 * per organisation and passed into every engine call rather than compiled in.
 */

export interface RuleSet {
  /** Periods of the home's own history used to form its baseline. */
  baselineWindow: number;
  /** Fewest comparable periods before any status is calculated at all. */
  baselineMin: number;
  /** Multiples of the home's normal spread before a reading counts as unusual. */
  bandSigma: number;
  /** Where a single reading is treated as a strong deviation. */
  strongSigma: number;
  /** Consecutive periods moving the same way before direction counts. */
  runDeteriorate: number;
  runImprove: number;
  /** Percentage move against baseline before a change counts as material. */
  materialPct: number;
  /** Related indicators that must move together to raise a combined signal. */
  convergeMin: number;
  /**
   * Below this many recorded events in a period, an indicator is surfaced but
   * never escalated to a sustained deterioration on its own — one extra event
   * would move the figure materially.
   */
  smallNumberFloor: number;
}

export const DEFAULT_RULES: Readonly<RuleSet> = Object.freeze({
  baselineWindow: 6,
  baselineMin: 4,
  bandSigma: 1.5,
  strongSigma: 2.5,
  runDeteriorate: 3,
  runImprove: 3,
  materialPct: 10,
  convergeMin: 2,
  smallNumberFloor: 5,
});

/** Bounds a stored or user-supplied rule set to values the engine can honour. */
export function normaliseRules(input?: Partial<RuleSet> | null): RuleSet {
  const r = { ...DEFAULT_RULES, ...(input ?? {}) };
  const clamp = (v: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
  return {
    baselineWindow: Math.round(clamp(r.baselineWindow, 3, 24, 6)),
    baselineMin: Math.round(clamp(r.baselineMin, 2, 12, 4)),
    bandSigma: clamp(r.bandSigma, 0.5, 6, 1.5),
    strongSigma: clamp(r.strongSigma, 1, 10, 2.5),
    runDeteriorate: Math.round(clamp(r.runDeteriorate, 2, 12, 3)),
    runImprove: Math.round(clamp(r.runImprove, 2, 12, 3)),
    materialPct: clamp(r.materialPct, 0, 100, 10),
    convergeMin: Math.round(clamp(r.convergeMin, 2, 8, 2)),
    smallNumberFloor: Math.round(clamp(r.smallNumberFloor, 0, 50, 5)),
  };
}
