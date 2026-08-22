/** Small statistical helpers. Robust measures throughout — a care home's
 *  history is short and a single outlier should not move the baseline. */

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Median absolute deviation, scaled so it is comparable with a standard
 *  deviation for normally distributed data. */
export function mad(values: readonly number[], centre?: number): number {
  if (values.length < 2) return 0;
  const c = centre ?? (median(values) as number);
  return (median(values.map((v) => Math.abs(v - c))) as number) * 1.4826;
}

/**
 * Short-term variation, estimated from successive differences.
 *
 * This is the moving-range estimator used in control charts, and it is here for
 * the reason control charts use it: the spread of a *trending* window is
 * dominated by the trend itself, so judging a rise against it hides the rise.
 * Successive differences measure how much the series moves period to period,
 * which is what "normal for this home" actually means.
 *
 * 1.128 is the d2 constant for a moving range of two.
 */
export function movingRangeSigma(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < values.length; i++) {
    ranges.push(Math.abs((values[i] as number) - (values[i - 1] as number)));
  }
  return (median(ranges) as number) / 1.128;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function round(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
