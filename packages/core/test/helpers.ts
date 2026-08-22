import type { Reading, ReadingState } from '../src/types.js';
import { lastPeriods } from '../src/periods.js';

/** Builds a contiguous reading series ending at `to`, oldest first. */
export function series(values: (number | null)[], to = '2026-06', state: ReadingState = 'ok'): Reading[] {
  const periods = lastPeriods(to, values.length);
  return values.map((v, i) => ({
    period: periods[i] as string,
    value: v,
    state: v === null ? 'not-submitted' : state,
  }));
}

/** As above, but with numerator and denominator attached to every value. */
export function ratedSeries(
  values: (number | null)[],
  denominator: number,
  multiplier = 1000,
  to = '2026-06',
): Reading[] {
  return series(values, to).map((r) => ({
    ...r,
    numerator: r.value === null ? null : Math.round((r.value * denominator) / multiplier),
    denominator: r.value === null ? null : denominator,
  }));
}

export function asMap(entries: Record<string, Reading[]>): Map<string, Reading[]> {
  return new Map(Object.entries(entries));
}
