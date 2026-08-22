import { describe, expect, it } from 'vitest';
import { buildSignals, firstRaisedPeriod, signalTimeline, SIGNAL_DEFINITIONS } from '../src/signals.js';
import { comparePeriods, quarterValue, rollingAverage, yearValue, beforeAfter } from '../src/compare.js';
import { completeness, dataIssues, qualitySummary } from '../src/quality.js';
import { assurance } from '../src/assurance.js';
import { INDICATORS, getIndicator } from '../src/indicators.js';
import { lastPeriods } from '../src/periods.js';
import { asMap, series } from './helpers.js';

/** A home under converging workforce pressure, with everything else holding. */
function pressuredHome() {
  return asMap({
    Q01: series([13.2, 13.6, 13.1, 13.5, 13.3, 13.7, 13.4, 13.6]),
    Q02: series([2.5, 2.4, 2.3, 2.2, 2.1, 2.0, 1.9, 1.8]),
    Q03: series([0.9, 1.0, 0.9, 0.95, 0.9, 1.0, 0.95, 0.9]),
    Q04: series([3.4, 3.6, 3.5, 4.1, 4.6, 5.1, 5.5, 5.9]),
    Q05: series([11.5, 12.1, 12.8, 15.2, 18.4, 20.9, 22.6, 24.2]),
    Q06: series([1.7, 1.8, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95]),
    Q07: series([5.0, 4.6, 4.2, 3.8, 3.4, 3.0, 2.7, 2.4]),
    Q08: series([4.0, 4.3, 4.6, 5.6, 7.0, 8.4, 9.6, 10.6]),
    Q09: series([5.0, 5.2, 5.1, 5.4, 5.3, 5.6, 5.5, 5.7]),
    Q10: series([1, 1, 1, 1, 1, 1, 1, 1]),
    Q11: series([1.9, 2.0, 1.95, 2.0, 1.9, 2.05, 1.95, 2.0]),
    Q12: series([1, 1, 1, 1, 1, 1, 1, 1]),
    Q13: series([76, 77, 77, 78, 78, 79, 79, 80]),
    Q14: series([3.1, 3.0, 3.2, 3.1, 3.0, 3.2, 3.1, 3.0]),
    Q15: series([2, 2, 2, 2, 2, 2, 1, 1]),
  });
}

const PERIOD = '2026-06';
const ALL = INDICATORS;

describe('convergence', () => {
  it('raises the workforce pattern when related indicators move together', () => {
    const signals = buildSignals({ indicators: ALL, series: pressuredHome(), period: PERIOD });
    const workforce = signals.find((s) => s.id === 'SIG-01');
    expect(workforce?.severity).toBe('Deteriorating');
    expect(workforce?.converged).toBe(true);
    expect(workforce?.harmful.map((h) => h.indicatorId)).toEqual(
      expect.arrayContaining(['Q04', 'Q05', 'Q08']),
    );
  });

  it('names the contributing indicators and the length of the run', () => {
    const signals = buildSignals({ indicators: ALL, series: pressuredHome(), period: PERIOD });
    const narrative = signals.find((s) => s.id === 'SIG-01')?.narrative ?? '';
    expect(narrative).toContain('Q05 Agency dependence');
    expect(narrative).toContain('consecutive periods');
    expect(narrative).toContain('should be reviewed by the management team');
  });

  it('never claims harm, prediction or a regulatory outcome', () => {
    const signals = buildSignals({ indicators: ALL, series: pressuredHome(), period: PERIOD });
    const text = signals.map((s) => `${s.title} ${s.narrative}`).join(' ').toLowerCase();
    for (const forbidden of ['will occur', 'unsafe', 'inadequate', 'rating', 'guarantee', 'predict']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('does not raise a pattern when only one member moves', () => {
    const map = pressuredHome();
    map.set('Q05', series([11.5, 11.8, 12.0, 11.9, 12.1, 11.8, 12.0, 12.2]));
    map.set('Q08', series([4.0, 4.1, 4.0, 4.2, 4.1, 4.0, 4.2, 4.1]));
    map.set('Q06', series([1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7, 1.7]));
    const workforce = buildSignals({ indicators: ALL, series: map, period: PERIOD }).find(
      (s) => s.id === 'SIG-01',
    );
    expect(workforce?.converged).toBe(false);
    expect(workforce?.severity).not.toBe('Deteriorating');
  });

  it('reports mixed evidence rather than resolving it', () => {
    const map = pressuredHome();
    map.set('Q11', series([1.8, 1.9, 2.0, 2.2, 2.4, 2.6, 2.8, 3.0])); // complaints rising
    map.set('Q13', series([66, 69, 72, 75, 78, 82, 86, 90])); // satisfaction improving
    const experience = buildSignals({ indicators: ALL, series: map, period: PERIOD }).find(
      (s) => s.id === 'SIG-03',
    );
    expect(experience?.mixed).toBe(true);
    expect(experience?.narrative).toContain('The evidence is mixed');
  });

  it('never promotes a lagging group to an early warning', () => {
    const map = pressuredHome();
    /* Push all three outcome indicators hard into deterioration. */
    map.set('Q01', series([13, 13.2, 13.1, 16, 19, 22, 25, 28]));
    map.set('Q02', series([2.0, 2.1, 2.0, 2.6, 3.2, 3.8, 4.4, 5.0]));
    map.set('Q03', series([0.9, 0.95, 0.9, 1.4, 1.9, 2.4, 2.9, 3.4]));
    const outcomes = buildSignals({ indicators: ALL, series: map, period: PERIOD }).find(
      (s) => s.id === 'SIG-05',
    );
    expect(outcomes?.kind).toBe('Lagging / outcome');
    expect(outcomes?.severity).not.toBe('Deteriorating');
  });
});

describe('signal history', () => {
  const periods = lastPeriods(PERIOD, 8);

  it('finds the period a pattern first met its rule', () => {
    const first = firstRaisedPeriod({
      indicators: ALL,
      series: pressuredHome(),
      periods,
      signalId: 'SIG-01',
    });
    expect(first).not.toBeNull();
    expect(periods).toContain(first);
  });

  it('returns null for a pattern that is not currently raised', () => {
    const first = firstRaisedPeriod({
      indicators: ALL,
      series: pressuredHome(),
      periods,
      signalId: 'SIG-05',
    });
    expect(first).toBeNull();
  });

  it('builds a timeline of raises and clears, newest first', () => {
    const events = signalTimeline({ indicators: ALL, series: pressuredHome(), periods });
    expect(events.length).toBeGreaterThan(0);
    for (let i = 1; i < events.length; i++) {
      expect((events[i - 1] as { period: string }).period >= (events[i] as { period: string }).period).toBe(true);
    }
  });

  it('covers every defined pattern', () => {
    expect(SIGNAL_DEFINITIONS.map((d) => d.id)).toEqual([
      'SIG-01', 'SIG-02', 'SIG-03', 'SIG-04', 'SIG-05', 'SIG-06',
    ]);
  });
});

describe('comparison', () => {
  it('separates real movement from ordinary variation', () => {
    const c = comparePeriods({
      indicators: ALL,
      series: pressuredHome(),
      fromPeriod: '2025-11',
      toPeriod: '2026-06',
    });
    expect(c.deteriorated).toEqual(expect.arrayContaining(['Q05', 'Q08']));
    expect(c.stable.length).toBeGreaterThan(0);
    expect(c.rows).toHaveLength(15);
  });

  it('marks a period pair as not comparable rather than guessing', () => {
    const map = pressuredHome();
    map.set('Q05', series([null, 12, 13, 15, 18, 21, 23, 25]));
    const c = comparePeriods({
      indicators: ALL,
      series: map,
      fromPeriod: lastPeriods(PERIOD, 8)[0] as string,
      toPeriod: PERIOD,
    });
    expect(c.notComparable).toContain('Q05');
  });

  it('reports which signals are new and which have cleared', () => {
    const c = comparePeriods({
      indicators: ALL,
      series: pressuredHome(),
      fromPeriod: '2025-11',
      toPeriod: '2026-06',
    });
    expect(c.newSignals.some((s) => s.id === 'SIG-01')).toBe(true);
    expect(c.resolvedSignals).toEqual([]);
  });
});

describe('aggregation', () => {
  const readings = series([11.5, 12.1, 12.8, 15.2, 18.4, 20.9, 22.6, 24.2]); // Nov 25 .. Jun 26

  it('averages a quarter from its months and says how many it used', () => {
    const q = quarterValue(readings, 2026, 2); // Apr, May, Jun
    expect(q.monthsUsed).toBe(3);
    expect(q.complete).toBe(true);
    expect(q.value).toBeCloseTo((20.9 + 22.6 + 24.2) / 3, 2);
  });

  it('flags a partial quarter instead of silently averaging what it has', () => {
    const withGap = readings.map((r, i) => (i === 7 ? { ...r, value: null, state: 'not-submitted' as const } : r));
    const q = quarterValue(withGap, 2026, 2);
    expect(q.complete).toBe(false);
    expect(q.monthsUsed).toBe(2);
  });

  it('does not count an off-cycle month as missing', () => {
    const quarterly = readings.map((r, i) =>
      i === 5 || i === 6 ? { ...r, value: null, state: 'off-cycle' as const } : r,
    );
    const q = quarterValue(quarterly, 2026, 2);
    expect(q.monthsExpected).toBe(1);
    expect(q.complete).toBe(true);
  });

  it('computes rolling averages only when the window is full', () => {
    expect(rollingAverage(readings, PERIOD, 3)).toBeCloseTo((20.9 + 22.6 + 24.2) / 3, 2);
    expect(rollingAverage(readings, PERIOD, 24)).toBeNull();
  });

  it('summarises a year from its months', () => {
    expect(yearValue(readings, 2026).monthsUsed).toBe(6);
  });

  it('compares either side of an intervention without claiming cause', () => {
    const recovering = series([25, 26, 25, 24, 21, 19, 17, 16]);
    const ba = beforeAfter('Q05', recovering, '2026-03', 3);
    expect(ba?.before).toBeGreaterThan(ba?.after as number);
    expect(ba?.interventionPeriod).toBe('2026-03');
  });
});

describe('data quality', () => {
  it('counts only what was due', () => {
    const map = pressuredHome();
    map.set('Q15', series([2, 2, 2, 2, 2, 2, 1, 1]).map((r, i) =>
      i === 7 ? { ...r, value: null, state: 'off-cycle' as const } : r,
    ));
    const c = completeness(ALL, map, PERIOD);
    expect(c.due).toBe(14);
    expect(c.got).toBe(14);
    expect(c.pct).toBe(100);
  });

  it('reports a gap as a gap', () => {
    const map = pressuredHome();
    map.set('Q04', series([3.4, 3.6, 3.5, 4.1, 4.6, 5.1, 5.5, null]));
    const c = completeness(ALL, map, PERIOD);
    expect(c.missing).toContain('Q04');
    expect(c.pct).toBeLessThan(100);
    expect(qualitySummary(ALL, map, PERIOD)).toContain('rather than counted as zero');
  });

  it('registers repeated gaps as a finding', () => {
    const map = pressuredHome();
    map.set('Q04', series([3.4, null, 3.5, null, 4.6, null, 5.5, 5.9]));
    const issues = dataIssues(ALL, map);
    const gap = issues.find((i) => i.indicatorId === 'Q04' && i.kind === 'Missing periods');
    expect(gap?.level).toBe('bad');
    expect(gap?.text).toContain('not imputed');
  });
});

describe('governance assurance', () => {
  it('maps every indicator to one of the five key questions', () => {
    const areas = assurance({ indicators: ALL, series: pressuredHome(), period: PERIOD });
    expect(areas).toHaveLength(5);
    expect(areas.reduce((n, a) => n + a.members.length, 0)).toBe(15);
  });

  it('surfaces the weakest area', () => {
    const areas = assurance({ indicators: ALL, series: pressuredHome(), period: PERIOD });
    const wellLed = areas.find((a) => a.keyQuestion === 'Well-led');
    expect(wellLed?.state).toBe('Deteriorating');
  });

  it('keeps Q13 under Caring', () => {
    expect(getIndicator('Q13').kloe).toBe('Caring');
  });
});
