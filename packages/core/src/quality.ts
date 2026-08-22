/**
 * Data quality.
 *
 * The source rule is absolute and is enforced here rather than described:
 * a missing numerator or denominator means do not calculate, do not impute
 * zero, do not carry forward. Q13 is the one documented exception, and a
 * carried-forward reading is flagged stale so it is never mistaken for fresh.
 */

import type { Completeness, Indicator, Reading, Tone } from './types.js';
import { plural } from './format.js';
import { periodLabel, parsePeriod } from './periods.js';

export function completeness(
  indicators: readonly Indicator[],
  series: ReadonlyMap<string, readonly Reading[]>,
  period: string,
): Completeness {
  let due = 0;
  let got = 0;
  let stale = 0;
  const missing: string[] = [];

  for (const ind of indicators) {
    const reading = series.get(ind.id)?.find((r) => r.period === period);
    if (!reading) continue;
    /* Nothing was due this period, so it cannot be missing. */
    if (reading.state === 'off-cycle') continue;
    due++;
    if (reading.value !== null) got++;
    else missing.push(ind.id);
    if (reading.state === 'stale') stale++;
  }

  return { due, got, stale, missing, pct: due ? Math.round((got / due) * 100) : 0 };
}

export function completenessTrend(
  indicators: readonly Indicator[],
  series: ReadonlyMap<string, readonly Reading[]>,
  periods: readonly string[],
): { period: string; pct: number }[] {
  return periods.map((period) => ({ period, pct: completeness(indicators, series, period).pct }));
}

export interface DataIssue {
  level: Tone;
  indicatorId: string;
  kind: 'Missing periods' | 'Stale value' | 'Quarterly cadence' | 'Denominator missing';
  text: string;
}

export function dataIssues(
  indicators: readonly Indicator[],
  series: ReadonlyMap<string, readonly Reading[]>,
): DataIssue[] {
  const out: DataIssue[] = [];

  for (const ind of indicators) {
    const readings = series.get(ind.id);
    if (!readings) continue;

    const gaps = readings.filter((r) => r.state === 'not-submitted');
    if (gaps.length) {
      out.push({
        level: gaps.length >= 3 ? 'bad' : 'watch',
        indicatorId: ind.id,
        kind: 'Missing periods',
        text: `${gaps.length} ${plural(gaps.length, 'period')} with no submitted value: ${gaps
          .map((g) => parsePeriod(g.period).short)
          .join(', ')}. Not calculated, not imputed, not carried forward.`,
      });
    }

    const stales = readings.filter((r) => r.state === 'stale');
    if (stales.length) {
      out.push({
        level: 'none',
        indicatorId: ind.id,
        kind: 'Stale value',
        text: `${stales.length} ${plural(stales.length, 'period')} carried forward from the last survey and flagged stale — the documented exception for ${ind.id}.`,
      });
    }

    const offCycle = readings.filter((r) => r.state === 'off-cycle');
    if (offCycle.length) {
      out.push({
        level: 'none',
        indicatorId: ind.id,
        kind: 'Quarterly cadence',
        text: `Reported quarterly for this home, so ${offCycle.length} monthly periods carry no value by design.`,
      });
    }

    /* A value supplied without the parts it is defined from cannot be
       re-derived or checked later. */
    if (ind.den) {
      const unverifiable = readings.filter(
        (r) =>
          r.value !== null &&
          r.state === 'ok' &&
          (r.numerator === null || r.numerator === undefined || r.denominator === null || r.denominator === undefined),
      );
      if (unverifiable.length) {
        out.push({
          level: 'watch',
          indicatorId: ind.id,
          kind: 'Denominator missing',
          text: `${unverifiable.length} ${plural(unverifiable.length, 'period')} supplied as a bare value without ${ind.num.toLowerCase()} and ${ind.den.toLowerCase()}, so the calculation cannot be re-derived.`,
        });
      }
    }
  }

  return out;
}

/** Periods where a home submitted nothing at all. */
export function missingSubmissions(
  indicators: readonly Indicator[],
  series: ReadonlyMap<string, readonly Reading[]>,
  periods: readonly string[],
): string[] {
  return periods.filter((period) => {
    const c = completeness(indicators, series, period);
    return c.due > 0 && c.got === 0;
  });
}

export function qualitySummary(
  indicators: readonly Indicator[],
  series: ReadonlyMap<string, readonly Reading[]>,
  period: string,
): string {
  const c = completeness(indicators, series, period);
  if (c.missing.length === 0) {
    return `Every indicator due in ${periodLabel(period)} was submitted. No value was imputed or carried forward.${
      c.stale ? ` ${c.stale} reading was carried forward under the documented Q13 exception and is flagged stale.` : ''
    }`;
  }
  return `${c.missing.length} ${plural(c.missing.length, 'indicator')} had no submitted value for ${periodLabel(
    period,
  )} (${c.missing.join(', ')}). These are recorded as insufficient data rather than counted as zero.`;
}
