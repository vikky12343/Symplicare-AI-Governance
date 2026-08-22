/**
 * Period comparison and aggregation.
 *
 * Quarterly and yearly views are derived from the monthly source values and
 * never replace them — the source pack requires that aggregation does not
 * destroy the underlying months.
 */

import type { Comparison, ComparisonRow, Indicator, Reading, Signal } from './types.js';
import type { RuleSet } from './rules.js';
import { DEFAULT_RULES } from './rules.js';
import { evaluateAll, harmSign } from './engine.js';
import { buildSignals } from './signals.js';
import { completeness } from './quality.js';
import { mean, round } from './stats.js';
import { quarterMonths, yearMonths } from './periods.js';

export interface Aggregate {
  value: number | null;
  monthsUsed: number;
  monthsExpected: number;
  complete: boolean;
}

function aggregate(readings: readonly Reading[], periods: readonly string[]): Aggregate {
  const inScope = readings.filter((r) => periods.includes(r.period));
  /* Only periods where something was actually due count toward completeness —
     a quarterly indicator has no missing months, it has months with nothing due. */
  const expected = inScope.filter((r) => r.state !== 'off-cycle').length;
  const values = inScope.filter((r) => r.value !== null && r.state === 'ok').map((r) => r.value as number);
  const m = mean(values);
  return {
    value: m === null ? null : round(m, 3),
    monthsUsed: values.length,
    monthsExpected: expected,
    complete: expected > 0 && values.length === expected,
  };
}

export function quarterValue(
  readings: readonly Reading[],
  year: number,
  quarter: number,
): Aggregate {
  return aggregate(readings, quarterMonths(year, quarter));
}

export function yearValue(readings: readonly Reading[], year: number): Aggregate {
  return aggregate(readings, yearMonths(year));
}

/** Rolling average of the last `n` usable readings ending at `period`. */
export function rollingAverage(
  readings: readonly Reading[],
  period: string,
  n: number,
): number | null {
  const end = readings.findIndex((r) => r.period === period);
  if (end < 0) return null;
  const values: number[] = [];
  for (let k = end; k >= 0 && values.length < n; k--) {
    const r = readings[k];
    if (r && r.value !== null && r.state === 'ok') values.push(r.value);
  }
  if (values.length < n) return null;
  return round(values.reduce((a, b) => a + b, 0) / n, 3);
}

export interface CompareInput {
  indicators: readonly Indicator[];
  series: ReadonlyMap<string, readonly Reading[]>;
  fromPeriod: string;
  toPeriod: string;
  rules?: RuleSet;
}

/**
 * Compare two periods.
 *
 * A move only counts as movement when it clears both a material percentage and
 * the indicator's own normal spread. Anything smaller is ordinary variation,
 * and calling it a change would fill the comparison with noise.
 */
export function comparePeriods(input: CompareInput): Comparison {
  const rules = input.rules ?? DEFAULT_RULES;
  const from = evaluateAll(input.indicators, input.series, input.fromPeriod, { rules });
  const to = evaluateAll(input.indicators, input.series, input.toPeriod, { rules });

  const rows: ComparisonRow[] = input.indicators.map((ind) => {
    const a = from.get(ind.id);
    const b = to.get(ind.id);
    const hasBoth = Boolean(a && b && a.value !== null && b.value !== null);

    if (!hasBoth || !a || !b) {
      return {
        indicatorId: ind.id,
        from: a?.value ?? null,
        to: b?.value ?? null,
        delta: null,
        pct: null,
        harmful: null,
        movement: 'Not comparable',
        statusNow: b?.status ?? 'Insufficient data',
      };
    }

    const delta = round((b.value as number) - (a.value as number), 3);
    const pct = a.value === 0 ? null : round((delta / Math.abs(a.value as number)) * 100, 1);
    const harmful = Math.sign(delta) === harmSign(ind);
    const spread = b.spread ?? a.spread ?? 0;
    const moved = Math.abs(delta) > spread * 0.9 && Math.abs(pct ?? 0) >= rules.materialPct;

    return {
      indicatorId: ind.id,
      from: a.value,
      to: b.value,
      delta,
      pct,
      harmful,
      movement: !moved ? 'Broadly stable' : harmful ? 'Deteriorated' : 'Improved',
      statusNow: b.status,
    };
  });

  const ids = (movement: ComparisonRow['movement']) =>
    rows.filter((r) => r.movement === movement).map((r) => r.indicatorId);

  const signalsBefore = buildSignals({
    indicators: input.indicators,
    series: input.series,
    period: input.fromPeriod,
    rules,
  }).filter((s) => s.raised);
  const signalsAfter = buildSignals({
    indicators: input.indicators,
    series: input.series,
    period: input.toPeriod,
    rules,
  }).filter((s) => s.raised);

  const beforeIds = new Set(signalsBefore.map((s) => s.id));
  const afterIds = new Set(signalsAfter.map((s) => s.id));

  return {
    fromPeriod: input.fromPeriod,
    toPeriod: input.toPeriod,
    rows,
    improved: ids('Improved'),
    deteriorated: ids('Deteriorated'),
    stable: ids('Broadly stable'),
    notComparable: ids('Not comparable'),
    newSignals: signalsAfter
      .filter((s: Signal) => !beforeIds.has(s.id))
      .map((s) => ({ id: s.id, title: s.title, severity: s.severity, narrative: s.narrative })),
    resolvedSignals: signalsBefore
      .filter((s: Signal) => !afterIds.has(s.id))
      .map((s) => ({ id: s.id, title: s.title })),
    quality: {
      from: completeness(input.indicators, input.series, input.fromPeriod),
      to: completeness(input.indicators, input.series, input.toPeriod),
    },
  };
}

/**
 * Indicator values either side of an intervention.
 *
 * Descriptive only. The wording that consumes this must not claim the
 * intervention caused the movement.
 */
export interface BeforeAfter {
  indicatorId: string;
  before: number | null;
  after: number | null;
  interventionPeriod: string;
  window: number;
}

export function beforeAfter(
  indicatorId: string,
  readings: readonly Reading[],
  interventionPeriod: string,
  window = 4,
): BeforeAfter | null {
  const at = readings.findIndex((r) => r.period === interventionPeriod);
  if (at < 0) return null;

  const slice = (fromIndex: number, toIndex: number) => {
    const values: number[] = [];
    for (let k = Math.max(0, fromIndex); k <= Math.min(readings.length - 1, toIndex); k++) {
      const r = readings[k];
      if (r && r.value !== null && r.state === 'ok') values.push(r.value);
    }
    const m = mean(values);
    return m === null ? null : round(m, 2);
  };

  return {
    indicatorId,
    before: slice(at - window, at - 1),
    after: slice(at + 1, at + window),
    interventionPeriod,
    window,
  };
}
