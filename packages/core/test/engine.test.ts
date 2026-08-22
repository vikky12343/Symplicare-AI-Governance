import { describe, expect, it } from 'vitest';
import { evaluate, evaluateAll, harmSign, statusCounts } from '../src/engine.js';
import { getIndicator, INDICATORS } from '../src/indicators.js';
import { DEFAULT_RULES, normaliseRules } from '../src/rules.js';
import { asMap, ratedSeries, series } from './helpers.js';

const Q05 = getIndicator('Q05'); // Agency dependence, %, higher = worse
const Q13 = getIndicator('Q13'); // Satisfaction, score, LOWER = worse
const Q14 = getIndicator('Q14'); // Delayed/missed activities, %
const Q03 = getIndicator('Q03'); // Safeguarding concerns, rate per 1,000

describe('direction of harm', () => {
  it('reads the direction from the dictionary rather than assuming it', () => {
    expect(harmSign(Q05)).toBe(1);
    expect(harmSign(Q13)).toBe(-1);
  });

  it('treats a falling satisfaction score as deterioration, not improvement', () => {
    const falling = series([82, 81, 80, 79, 78, 74, 70, 66]);
    const e = evaluate(Q13, falling);
    expect(e.status).toBe('Deteriorating');
    expect(e.harmfulRun).toBeGreaterThanOrEqual(3);
  });

  it('treats a rising satisfaction score as improvement', () => {
    const rising = series([66, 68, 70, 72, 74, 78, 82, 86]);
    expect(evaluate(Q13, rising).status).toBe('Improving');
  });
});

describe('insufficient data', () => {
  it('calculates nothing before there are enough comparable periods', () => {
    const e = evaluate(Q05, series([12, 13, 14]));
    expect(e.status).toBe('Insufficient data');
    expect(e.baseline).toBeNull();
    expect(e.why).toContain('at least 4');
  });

  it('never imputes a missing period', () => {
    const e = evaluate(Q05, series([12, 12.4, 12.1, 12.6, 12.3, 12.5, null]));
    expect(e.status).toBe('Insufficient data');
    expect(e.value).toBeNull();
    expect(e.why).toContain('nothing is carried forward');
  });

  it('distinguishes a gap in the record from a period where nothing was due', () => {
    const readings = series([12, 12.4, 12.1, 12.6, 12.3, 12.5, null]);
    const offCycle = readings.map((r, i) => (i === 6 ? { ...r, state: 'off-cycle' as const } : r));
    expect(evaluate(Q05, offCycle).why).toContain('No value is due');
    expect(evaluate(Q05, readings).why).toContain('No value was submitted');
  });

  it('excludes a stale carried-forward value from the baseline it feeds', () => {
    const readings = series([78, 78, 78, 78, 78, 78, 78]);
    const withStale = readings.map((r, i) => (i > 2 ? { ...r, state: 'stale' as const } : r));
    const e = evaluate(Q13, withStale);
    /* Only three genuine readings remain, which is below the minimum. */
    expect(e.status).toBe('Insufficient data');
  });
});

describe('the isolated spike', () => {
  /* This is the case the source scenario sheet exists to catch: one bad month
     against a flat history must not read as a trend. */
  const flatThenSpike = series([3.1, 3.0, 3.2, 3.1, 3.0, 3.2, 3.1, 7.9]);

  it('is Watch, never Deteriorating', () => {
    const e = evaluate(Q14, flatThenSpike);
    expect(e.status).toBe('Watch');
    expect(e.persistence).toBe(1);
  });

  it('says why in words a manager can act on', () => {
    const e = evaluate(Q14, flatThenSpike);
    expect(e.reasons.map((r) => r.text).join(' ')).toContain('One period only');
    expect(e.why).toContain('not yet a trend');
  });

  it('becomes Deteriorating once it persists', () => {
    const sustained = series([3.1, 3.0, 3.2, 3.1, 3.0, 7.6, 7.9, 8.4]);
    expect(evaluate(Q14, sustained).status).toBe('Deteriorating');
  });
});

describe('deterioration requires two tests to agree', () => {
  it('calls a sustained, material, converging rise', () => {
    const e = evaluate(Q05, series([11.5, 12.1, 12.8, 15.2, 18.4, 20.9, 22.6, 24.2]));
    expect(e.status).toBe('Deteriorating');
    expect(e.harmfulRun).toBeGreaterThanOrEqual(3);
    expect(e.deviation).toBeGreaterThanOrEqual(DEFAULT_RULES.bandSigma);
  });

  it('leaves ordinary variation alone', () => {
    const e = evaluate(Q05, series([12.0, 12.6, 11.8, 12.4, 12.1, 12.7, 11.9, 12.3]));
    expect(e.status).toBe('Stable');
  });

  it('does not escalate on magnitude alone when the move is immaterial', () => {
    /* A tight series where a small absolute move is many spreads from baseline
       but nowhere near the material percentage threshold. */
    const e = evaluate(Q05, series([12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.0, 12.4]));
    expect(e.changePct).toBeLessThan(DEFAULT_RULES.materialPct);
    expect(e.status).toBe('Stable');
  });
});

describe('small numbers guard', () => {
  it('caps a rare-event indicator at Watch however extreme the deviation', () => {
    /* Roughly one safeguarding concern a month in a 950 resident-day home. */
    const readings = ratedSeries([0.8, 0.9, 0.8, 1.0, 0.9, 0.8, 2.1, 2.4], 950);
    const e = evaluate(Q03, readings);
    expect(e.smallNumbers).toBe(true);
    expect(e.status).toBe('Watch');
    expect(e.cappedBySmallNumbers).toBe(true);
    expect(e.why).toContain('too few recorded events');
  });

  it('does not cap once the counts are large enough to be stable', () => {
    const readings = ratedSeries([13, 13.4, 13.1, 13.6, 13.2, 15.8, 17.4, 19.2], 1300);
    const e = evaluate(getIndicator('Q01'), readings);
    expect(e.smallNumbers).toBe(false);
    expect(e.status).toBe('Deteriorating');
  });
});

describe('baseline and spread', () => {
  it('uses the home’s own recent history, not a sector average', () => {
    const e = evaluate(Q05, series([20, 21, 20, 22, 21, 20, 21, 22]));
    expect(e.baseline).toBeGreaterThan(19);
    expect(e.baseline).toBeLessThan(23);
    expect(e.status).toBe('Stable');
  });

  it('reports which periods formed the baseline', () => {
    const e = evaluate(Q05, series([12, 13, 12, 13, 12, 13, 12, 13], '2026-06'));
    expect(e.baselinePeriods).toBe(DEFAULT_RULES.baselineWindow);
    expect(e.baselineTo).toBe('2026-05');
    expect(e.baselineFrom).toBe('2025-12');
  });

  it('is not fooled into flagging every step of a smooth drift', () => {
    /* Without the long-run spread floor, a noiseless ramp sits permanently
       outside its own trailing baseline. */
    const smooth = series(Array.from({ length: 12 }, (_, i) => 10 + i * 0.05));
    const e = evaluate(Q05, smooth);
    expect(e.status).toBe('Stable');
  });
});

describe('rule configuration', () => {
  it('changes the verdict when thresholds change', () => {
    const readings = series([12.0, 12.4, 12.2, 12.9, 13.4, 14.0, 14.6, 15.1]);
    const strict = evaluate(Q05, readings, { rules: normaliseRules({ bandSigma: 4, strongSigma: 6 }) });
    const loose = evaluate(Q05, readings, { rules: normaliseRules({ bandSigma: 0.5, materialPct: 1 }) });
    expect(loose.status).not.toBe(strict.status);
  });

  it('clamps nonsense input to something the engine can honour', () => {
    const r = normaliseRules({ baselineWindow: 999, bandSigma: -4, convergeMin: 1 });
    expect(r.baselineWindow).toBeLessThanOrEqual(24);
    expect(r.bandSigma).toBeGreaterThan(0);
    expect(r.convergeMin).toBeGreaterThanOrEqual(2);
  });
});

describe('reproducibility', () => {
  it('is a pure function of its inputs', () => {
    const readings = series([12, 13, 14, 15, 16, 18, 20, 23]);
    const a = evaluate(Q05, readings);
    const b = evaluate(Q05, readings);
    expect(a).toEqual(b);
  });

  it('evaluates a whole home and counts the statuses', () => {
    const map = asMap({
      Q05: series([11, 12, 13, 15, 18, 21, 23, 25]),
      Q13: series([66, 69, 72, 75, 78, 82, 86, 90]),
      Q14: series([3.1, 3.0, 3.2, 3.1, 3.0, 3.2, 3.1, 3.0]),
    });
    const evaluations = evaluateAll(
      INDICATORS.filter((i) => map.has(i.id)),
      map,
      '2026-06',
    );
    expect(evaluations.size).toBe(3);
    const counts = statusCounts(evaluations.values());
    expect(counts.Deteriorating + counts.Watch).toBeGreaterThanOrEqual(1);
    expect(counts.Improving).toBeGreaterThanOrEqual(1);
    expect(counts.Stable).toBeGreaterThanOrEqual(1);
  });
});

describe('the dictionary is carried through unchanged', () => {
  it('holds exactly fifteen indicators', () => {
    expect(INDICATORS).toHaveLength(15);
  });

  it('keeps Q13 as the one lower-is-worse indicator', () => {
    const lower = INDICATORS.filter((i) => i.harm === 'Lower = worse');
    expect(lower.map((i) => i.id)).toEqual(['Q13']);
  });

  it('keeps Q13 as the one documented carry-forward exception', () => {
    const carryForward = INDICATORS.filter((i) => /carry forward the last/i.test(i.missing));
    expect(carryForward.map((i) => i.id)).toEqual(['Q13']);
    for (const ind of INDICATORS.filter((i) => i.id !== 'Q13')) {
      expect(ind.missing).toContain('Never impute zero or carry forward');
    }
  });
});
