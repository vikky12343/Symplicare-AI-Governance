/**
 * The trend engine.
 *
 * No model, no prediction, no training. Every status below can be traced to the
 * numbers in `Evaluation.reasons` and the thresholds in the `RuleSet` that was
 * passed in. The source specification names seven tests — direction, magnitude,
 * persistence, deviation, acceleration, convergence and context — and each is
 * implemented here as its own step.
 *
 * Everything in this file is pure: readings in, evaluation out. That is what
 * makes a status reproducible months later from a stored dataset version.
 */

import type {
  ContextNote,
  Evaluation,
  Indicator,
  Reading,
  Status,
  StatusCounts,
  TestResult,
  Tone,
} from './types.js';
import type { RuleSet } from './rules.js';
import { DEFAULT_RULES } from './rules.js';
import { clamp, median, movingRangeSigma, round } from './stats.js';
import { fmtBase, fmtSigned, fmtUnit, plural } from './format.js';
import { periodLabel } from './periods.js';

export const STATUS_ORDER: readonly Status[] = [
  'Deteriorating',
  'Watch',
  'Stable',
  'Improving',
  'Insufficient data',
];

export const STATUS_RANK: Readonly<Record<Status, number>> = {
  Deteriorating: 0,
  Watch: 1,
  Stable: 2,
  Improving: 3,
  'Insufficient data': 4,
};

const TONE_OF: Readonly<Record<Status, Tone>> = {
  Deteriorating: 'bad',
  Watch: 'watch',
  Stable: 'stable',
  Improving: 'good',
  'Insufficient data': 'none',
};

export function toneOf(status: Status): Tone {
  return TONE_OF[status];
}

/**
 * +1 when a rise is the harmful direction, -1 when a fall is. Read from the
 * dictionary's own "Direction of harm" field — never assumed uniform, because
 * it is not: Q13 Satisfaction is the one where lower is worse.
 */
export function harmSign(ind: Indicator): 1 | -1 {
  return /lower/i.test(ind.harm) ? -1 : 1;
}

/** The smallest difference an indicator's source data can meaningfully express. */
function minimumTick(ind: Indicator): number {
  return ind.dp === 0 ? 0.75 : ind.dp === 1 ? 0.08 : 0.008;
}

/**
 * The home's normal spread for an indicator: short-term variation, floored so
 * that a perfectly flat history cannot divide by almost zero.
 */
function spreadOf(window: readonly number[], tick: number): number {
  return Math.max(movingRangeSigma(window), tick);
}

/**
 * Readings strictly before `index` that can form a baseline, oldest first.
 * A stale carried-forward value is usable as context but is never allowed to
 * shape the baseline it would otherwise be compared against.
 */
function priorUsable(readings: readonly Reading[], index: number, count: number): Reading[] {
  const out: Reading[] = [];
  for (let k = index - 1; k >= 0 && out.length < count; k--) {
    const r = readings[k];
    if (r && r.value !== null && r.state === 'ok') out.unshift(r);
  }
  return out;
}

/** Every reading up to and including `index` that carries a number. */
function valuesUpTo(readings: readonly Reading[], index: number): Reading[] {
  const out: Reading[] = [];
  for (let k = 0; k <= index; k++) {
    const r = readings[k];
    if (r && r.value !== null) out.push(r);
  }
  return out;
}

function emptyEvaluation(ind: Indicator, reading: Reading, index: number): Evaluation {
  return {
    indicatorId: ind.id,
    period: reading.period,
    index,
    status: 'Insufficient data',
    value: reading.value,
    state: reading.state,
    harmSign: harmSign(ind),
    baseline: null,
    spread: null,
    baselineFrom: null,
    baselineTo: null,
    baselinePeriods: 0,
    changeAbs: null,
    changePct: null,
    deviation: null,
    deviationClamped: false,
    run: 0,
    runDir: 0,
    harmfulRun: 0,
    helpfulRun: 0,
    persistence: 0,
    persistenceDir: 0,
    accelerating: false,
    acceleration: null,
    momChange: null,
    momFrom: null,
    smallNumbers: false,
    cappedBySmallNumbers: false,
    context: [],
    reasons: [],
    why: '',
  };
}

export interface EvaluateOptions {
  rules?: RuleSet;
  context?: readonly ContextNote[];
  /** Defaults to the last reading in the series. */
  atIndex?: number;
}

/**
 * Evaluate one indicator at one period against the home's own history.
 *
 * `readings` must be ordered oldest first and contiguous by period, including
 * the periods where nothing was submitted — a gap is a fact about the record,
 * and removing it would let a trend silently bridge a month it never saw.
 */
export function evaluate(
  ind: Indicator,
  readings: readonly Reading[],
  options: EvaluateOptions = {},
): Evaluation {
  const rules = options.rules ?? DEFAULT_RULES;
  const index = options.atIndex ?? readings.length - 1;
  const reading = readings[index];
  if (!reading) throw new Error(`No reading at index ${index} for ${ind.id}`);

  const out = emptyEvaluation(ind, reading, index);
  const sign = out.harmSign;

  /* No value: say which kind of nothing this is, and stop. */
  if (reading.value === null) {
    out.why =
      reading.state === 'off-cycle'
        ? `${ind.id} reports quarterly for this home. No value is due for ${periodLabel(reading.period)}.`
        : `No value was submitted for ${periodLabel(reading.period)}. The period is not calculated, nothing is imputed and nothing is carried forward.`;
    return out;
  }

  const previous = priorUsable(readings, index, 1)[0];
  if (previous && previous.value !== null) {
    out.momChange = round(reading.value - previous.value, 3);
    out.momFrom = previous.period;
  }

  const prior = priorUsable(readings, index, rules.baselineWindow);
  out.baselinePeriods = prior.length;
  if (prior.length < rules.baselineMin) {
    out.why = `Only ${prior.length} comparable ${plural(prior.length, 'period')} before this one. A baseline needs at least ${rules.baselineMin}.`;
    return out;
  }

  /* ---------------------------------------------------------- baseline */
  const window = prior.map((r) => r.value as number);
  const baseline = median(window) as number;
  const tick = minimumTick(ind);
  const spread = spreadOf(window, tick);

  out.baseline = baseline;
  out.spread = spread;
  out.baselineFrom = prior[0]?.period ?? null;
  out.baselineTo = prior[prior.length - 1]?.period ?? null;

  /* -------------------------------------------------- 1 · magnitude */
  out.changeAbs = round(reading.value - baseline, 3);
  out.changePct = baseline === 0 ? null : round(((reading.value - baseline) / Math.abs(baseline)) * 100, 1);

  /* -------------------------------------------------- 2 · deviation */
  const rawDeviation = ((reading.value - baseline) * sign) / spread;
  out.deviation = round(clamp(rawDeviation, -12, 12), 2);
  out.deviationClamped = Math.abs(rawDeviation) > 12;

  /* -------------------------------------------------- 3 · direction */
  const sequence = valuesUpTo(readings, index).slice(-8);
  let run = 0;
  let dir = 0;
  for (let k = sequence.length - 1; k > 0; k--) {
    const a = sequence[k]?.value as number;
    const b = sequence[k - 1]?.value as number;
    const step = Math.sign(a - b);
    if (step === 0) break;
    if (dir === 0) {
      dir = step;
      run = 1;
    } else if (step === dir) {
      run++;
    } else break;
  }
  out.run = run;
  out.runDir = dir;
  out.harmfulRun = dir === sign ? run : 0;
  out.helpfulRun = dir === -sign ? run : 0;

  /* ------------------------------------------------ 4 · persistence */
  /* Consecutive periods sitting outside the baseline band, each judged against
     the baseline as it stood at the time rather than against today's. */
  const periodIndex = new Map(readings.map((r, i) => [r.period, i]));
  let persistence = 0;
  let persistenceDir = 0;
  for (let k = sequence.length - 1; k >= 0; k--) {
    const row = sequence[k];
    if (!row) break;
    const at = periodIndex.get(row.period);
    if (at === undefined) break;
    const p = priorUsable(readings, at, rules.baselineWindow);
    if (p.length < rules.baselineMin) break;
    const pv = p.map((r) => r.value as number);
    const b = median(pv) as number;
    const dv = (((row.value as number) - b) * sign) / spreadOf(pv, tick);
    const side = dv >= rules.bandSigma ? 1 : dv <= -rules.bandSigma ? -1 : 0;
    if (side === 0) break;
    if (persistenceDir === 0) persistenceDir = side;
    else if (side !== persistenceDir) break;
    persistence++;
  }
  out.persistence = persistence;
  out.persistenceDir = persistenceDir;

  /* ----------------------------------------------- 5 · acceleration */
  if (sequence.length >= 4) {
    const deltas: number[] = [];
    for (let k = 1; k < sequence.length; k++) {
      deltas.push(((sequence[k]?.value as number) - (sequence[k - 1]?.value as number)) * sign);
    }
    const latest = deltas[deltas.length - 1] as number;
    const before = deltas.slice(-4, -1);
    const avg = before.reduce((a, b) => a + b, 0) / (before.length || 1);
    out.accelerating = latest > 0 && avg > 0 && latest > avg * 1.35;
    out.acceleration = { latest: round(latest, 3), previousAverage: round(avg, 3) };
  }

  /* ---------------------------------------------------- 6 · context */
  out.context = (options.context ?? []).filter(
    (c) => c.indicatorIds.includes(ind.id) && c.period <= reading.period,
  );

  /* ---------------------------------------------------- the verdict */
  const dv = out.deviation;
  const material = out.changePct === null ? true : Math.abs(out.changePct) >= rules.materialPct;
  const sustained = persistence >= rules.runDeteriorate && persistenceDir === 1;
  const strong = dv >= rules.strongSigma;
  const runHarm = out.harmfulRun >= rules.runDeteriorate;

  /* Deterioration is only called when two independent tests agree. One large
     reading, on its own, is never enough — that is what Watch is for. */
  if (
    material &&
    ((sustained && (runHarm || strong)) ||
      (strong && persistence >= 2) ||
      (out.harmfulRun >= rules.runDeteriorate + 1 && dv >= rules.bandSigma))
  ) {
    out.status = 'Deteriorating';
  } else if (material && (dv >= rules.bandSigma || runHarm || (persistence >= 2 && persistenceDir === 1))) {
    out.status = 'Watch';
  } else if (
    material &&
    ((persistence >= 2 && persistenceDir === -1) || out.helpfulRun >= rules.runImprove || dv <= -rules.bandSigma)
  ) {
    out.status = 'Improving';
  } else {
    out.status = 'Stable';
  }

  /* Small numbers guard. Where a period rests on a handful of recorded events,
     one more or one fewer moves the figure a long way, so the indicator is
     surfaced but never escalated on its own. */
  const scale =
    reading.numerator !== undefined && reading.numerator !== null
      ? reading.numerator
      : ind.dp === 0
        ? reading.value
        : null;
  out.smallNumbers = scale !== null && scale < rules.smallNumberFloor;
  if (out.smallNumbers && out.status === 'Deteriorating') {
    out.status = 'Watch';
    out.cappedBySmallNumbers = true;
  }

  out.reasons = explain(ind, out, rules, scale);
  out.why = plainWhy(ind, out, rules);
  return out;
}

function explain(ind: Indicator, e: Evaluation, rules: RuleSet, scale: number | null): TestResult[] {
  const r: TestResult[] = [];
  const dv = e.deviation as number;

  if (e.harmfulRun >= 2) {
    r.push({
      test: 'Direction',
      text: `Moved in the harmful direction for ${e.harmfulRun} consecutive periods.`,
    });
  }
  if (e.helpfulRun >= 2) {
    r.push({
      test: 'Direction',
      text: `Moved in the improving direction for ${e.helpfulRun} consecutive periods.`,
    });
  }
  if (e.changePct !== null && Math.abs(e.changePct) >= rules.materialPct) {
    r.push({
      test: 'Magnitude',
      text: `${fmtSigned(e.changePct, 1)}% against a baseline of ${fmtBase(e.baseline, ind)} (${e.baselinePeriods} periods to ${periodLabel(e.baselineTo as string)}).`,
    });
  }
  if (Math.abs(dv) >= rules.bandSigma) {
    r.push({
      test: 'Deviation',
      text:
        Math.abs(dv) >= 10
          ? `Far outside the range this home normally sits in — more than ten times its usual spread ${dv > 0 ? 'above' : 'below'} baseline.`
          : `Sits ${Math.abs(dv).toFixed(1)}× the home's normal spread ${dv > 0 ? 'above' : 'below'} baseline, outside its usual range.`,
    });
  }
  if (e.persistence >= 2) {
    r.push({
      test: 'Persistence',
      text: `Outside the baseline band for ${e.persistence} consecutive periods, so this is not a single reading.`,
    });
  }
  if (e.persistence === 1 && Math.abs(dv) >= rules.strongSigma) {
    r.push({
      test: 'Persistence',
      text: 'One period only. A single unusual reading is not treated as a sustained trend.',
    });
  }
  if (e.accelerating && e.acceleration) {
    r.push({
      test: 'Acceleration',
      text: `The rate of change increased this period (${e.acceleration.latest} against a recent average of ${e.acceleration.previousAverage}).`,
    });
  }
  if (e.context.length) {
    r.push({ test: 'Context', text: 'A manager has recorded an explanation covering this period.' });
  }
  if (e.state === 'stale') {
    r.push({
      test: 'Data',
      text: `Carried forward from the last survey and flagged stale — the documented exception for ${ind.id}.`,
    });
  }
  if (e.smallNumbers && scale !== null) {
    r.push({
      test: 'Small numbers',
      text: `Built on ${scale} recorded ${plural(scale, 'item')} this period. One more or one fewer moves the figure materially, so this indicator is not escalated on its own.`,
    });
  }
  return r;
}

function plainWhy(ind: Indicator, e: Evaluation, rules: RuleSet): string {
  const moved = e.runDir === 1 ? 'risen' : 'fallen';
  switch (e.status) {
    case 'Deteriorating':
      return `${ind.short} has ${moved} to ${fmtUnit(e.value, ind)}, ${fmtSigned(e.changePct, 0)}% against its own recent baseline, ${
        e.persistence >= 2
          ? `and has stayed outside its normal range for ${e.persistence} consecutive periods.`
          : `after moving that way for ${e.harmfulRun} consecutive ${plural(e.harmfulRun, 'period')}.`
      }`;
    case 'Watch':
      if (e.cappedBySmallNumbers) {
        return `${ind.short} has moved enough to meet the deterioration rule, but the period rests on too few recorded events to call it on its own. Worth checking against the source records.`;
      }
      if (e.persistence <= 1 && Math.abs(e.deviation ?? 0) >= rules.strongSigma) {
        return `${ind.short} is unusual for this home in ${periodLabel(e.period)}, but only for a single period. Worth checking, not yet a trend.`;
      }
      return `${ind.short} is moving in the harmful direction and is above its usual range. Not yet sustained enough to call deterioration.`;
    case 'Improving':
      return `${ind.short} is moving away from harm and is now ${fmtUnit(e.value, ind)}, ${fmtSigned(e.changePct, 0)}% against baseline.`;
    case 'Insufficient data':
      return e.why;
    case 'Stable':
      return `${ind.short} is within its normal range for this home (${fmtUnit(e.value, ind)} against a baseline of ${fmtBase(e.baseline, ind)}).`;
  }
}

/** Evaluate every indicator in a home's series at the same period. */
export function evaluateAll(
  indicators: readonly Indicator[],
  series: ReadonlyMap<string, readonly Reading[]>,
  period: string,
  options: Omit<EvaluateOptions, 'atIndex'> = {},
): Map<string, Evaluation> {
  const out = new Map<string, Evaluation>();
  for (const ind of indicators) {
    const readings = series.get(ind.id);
    if (!readings || readings.length === 0) continue;
    const index = readings.findIndex((r) => r.period === period);
    if (index < 0) continue;
    out.set(ind.id, evaluate(ind, readings, { ...options, atIndex: index }));
  }
  return out;
}

export function statusCounts(evaluations: Iterable<Evaluation>): StatusCounts {
  const counts: StatusCounts = {
    Deteriorating: 0,
    Watch: 0,
    Stable: 0,
    Improving: 0,
    'Insufficient data': 0,
  };
  for (const e of evaluations) counts[e.status]++;
  return counts;
}

/** The baseline corridor for a chart: one band per period, as it stood then. */
export interface BaselineBand {
  period: string;
  lo: number;
  hi: number;
  mid: number;
}

export function baselineCorridor(
  ind: Indicator,
  readings: readonly Reading[],
  rules: RuleSet = DEFAULT_RULES,
): (BaselineBand | null)[] {
  return readings.map((r, i) => {
    const e = evaluate(ind, readings, { rules, atIndex: i });
    if (e.baseline === null || e.spread === null) return null;
    return {
      period: r.period,
      lo: e.baseline - e.spread * rules.bandSigma,
      hi: e.baseline + e.spread * rules.bandSigma,
      mid: e.baseline,
    };
  });
}
