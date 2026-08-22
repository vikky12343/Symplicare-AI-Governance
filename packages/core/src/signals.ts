/**
 * Convergence — the sixth test, and the one the product exists for.
 *
 * A signal is a group of related indicators judged together. It is a prompt for
 * governance review, never a prediction and never a statement about the safety
 * of a service. Every signal carries the evidence it was built from.
 */

import type { Evaluation, Indicator, Reading, Signal, SignalDefinition, Status } from './types.js';
import type { RuleSet } from './rules.js';
import { DEFAULT_RULES } from './rules.js';
import { STATUS_RANK, evaluateAll } from './engine.js';
import { getIndicator } from './indicators.js';
import { periodLabel } from './periods.js';

export const SIGNAL_DEFINITIONS: readonly SignalDefinition[] = [
  {
    id: 'SIG-01',
    title: 'Emerging workforce and governance pressure',
    indicatorIds: ['Q04', 'Q05', 'Q08', 'Q06'],
    kind: 'Potential leading',
    frame: 'Staffing cover, agency reliance and management oversight are moving together.',
  },
  {
    id: 'SIG-02',
    title: 'Governance backlog building',
    indicatorIds: ['Q09', 'Q10', 'Q15'],
    kind: 'Potential leading',
    frame: 'Identified issues are being raised faster than they are being closed.',
  },
  {
    id: 'SIG-03',
    title: 'Experience and complaint themes repeating',
    indicatorIds: ['Q11', 'Q12', 'Q13'],
    kind: 'Mixed evidence',
    frame: 'Complaint volume, repeated themes and satisfaction read together.',
  },
  {
    id: 'SIG-04',
    title: 'Training and supervision compliance slipping',
    indicatorIds: ['Q07', 'Q08'],
    kind: 'Potential leading',
    frame: 'Competency and oversight requirements are falling behind.',
  },
  {
    id: 'SIG-05',
    title: 'Quality and safety outcomes',
    indicatorIds: ['Q01', 'Q02', 'Q03'],
    kind: 'Lagging / outcome',
    frame:
      'Outcome measures shown for context and learning. These are not treated as early warning.',
  },
  {
    id: 'SIG-06',
    title: 'Service delivery under strain',
    indicatorIds: ['Q14', 'Q04'],
    kind: 'Potential leading',
    frame: 'Missed or delayed activities alongside staffing cover.',
  },
] as const;

export interface BuildSignalsInput {
  series: ReadonlyMap<string, readonly Reading[]>;
  period: string;
  rules?: RuleSet;
  definitions?: readonly SignalDefinition[];
  context?: Parameters<typeof evaluateAll>[3] extends { context?: infer C } ? C : never;
}

function severityOf(
  def: SignalDefinition,
  usable: Evaluation[],
  bad: Evaluation[],
  watch: Evaluation[],
  good: Evaluation[],
  rules: RuleSet,
): Status {
  if (usable.length === 0) return 'Insufficient data';
  let severity: Status = 'Stable';
  if (bad.length >= rules.convergeMin) severity = 'Deteriorating';
  else if (bad.length >= 1 || watch.length >= rules.convergeMin) severity = 'Watch';
  else if (good.length === usable.length) severity = 'Improving';

  /* A lagging or outcome group is never promoted to an early warning. The
     source specification is explicit that an incident rate on its own does not
     predict a future incident. */
  if (def.kind === 'Lagging / outcome' && severity === 'Deteriorating') severity = 'Watch';
  return severity;
}

function narrate(
  def: SignalDefinition,
  harmful: Evaluation[],
  improving: Evaluation[],
  converged: boolean,
  mixed: boolean,
  period: string,
): string {
  if (harmful.length === 0 && improving.length === 0) {
    return `${def.frame} Nothing in this group is currently outside its normal range.`;
  }
  const names = (list: Evaluation[]) =>
    list.map((m) => `${m.indicatorId} ${getIndicator(m.indicatorId).short}`).join(', ');

  let s: string;
  if (converged) {
    const runs = harmful.map((m) => m.harmfulRun).filter(Boolean);
    const longest = runs.length ? Math.max(...runs) : 0;
    s =
      names(harmful) +
      (harmful.length === 2 ? ' are both' : ' are all') +
      ' moving in the direction recorded as harmful in the dictionary';
    if (longest >= 3) s += `, the longest for ${longest} consecutive periods`;
    s += `. The pattern sits above this home's own recent baseline as at ${periodLabel(period)} and should be reviewed by the management team.`;
  } else if (harmful.length === 1) {
    s = `${names(harmful)} is moving adversely while the rest of the group holds. Review the single indicator rather than treating this as a broad deterioration.`;
  } else {
    s = `${names(improving)} ${improving.length === 1 ? 'is' : 'are'} improving and nothing in this group is above its normal range.`;
  }
  if (mixed) {
    s += ` The evidence is mixed: ${names(improving)} ${improving.length === 1 ? 'is' : 'are'} moving the other way, so this is not a uniform deterioration.`;
  }
  return s;
}

export function buildSignals(input: {
  indicators: readonly Indicator[];
  series: ReadonlyMap<string, readonly Reading[]>;
  period: string;
  rules?: RuleSet;
  definitions?: readonly SignalDefinition[];
  context?: readonly import('./types.js').ContextNote[];
}): Signal[] {
  const rules = input.rules ?? DEFAULT_RULES;
  const definitions = input.definitions ?? SIGNAL_DEFINITIONS;
  const evaluations = evaluateAll(input.indicators, input.series, input.period, {
    rules,
    context: input.context,
  });

  return definitions.map((def) => {
    const members = def.indicatorIds
      .map((id) => evaluations.get(id))
      .filter((e): e is Evaluation => Boolean(e));
    const usable = members.filter((m) => m.status !== 'Insufficient data');
    const bad = usable.filter((m) => m.status === 'Deteriorating');
    const watch = usable.filter((m) => m.status === 'Watch');
    const good = usable.filter((m) => m.status === 'Improving');
    const harmful = [...bad, ...watch];

    const severity = severityOf(def, usable, bad, watch, good, rules);
    const converged = harmful.length >= rules.convergeMin;
    const mixed = harmful.length >= 1 && good.length >= 1;

    return {
      id: def.id,
      title: def.title,
      kind: def.kind,
      severity,
      raised: severity === 'Deteriorating' || severity === 'Watch',
      converged,
      mixed,
      narrative: narrate(def, harmful, good, converged, mixed, input.period),
      members,
      harmful,
      improving: good,
    } satisfies Signal;
  });
}

export function sortSignals(signals: Signal[]): Signal[] {
  return [...signals].sort((a, b) => STATUS_RANK[a.severity] - STATUS_RANK[b.severity]);
}

/**
 * When did this pattern first meet its own rule, in an unbroken run up to now?
 * Replays the same rules backwards through the history rather than trusting a
 * stored flag, so the answer stays correct if the thresholds change.
 */
export function firstRaisedPeriod(input: {
  indicators: readonly Indicator[];
  series: ReadonlyMap<string, readonly Reading[]>;
  periods: readonly string[];
  signalId: string;
  rules?: RuleSet;
  definitions?: readonly SignalDefinition[];
}): string | null {
  const definitions = (input.definitions ?? SIGNAL_DEFINITIONS).filter((d) => d.id === input.signalId);
  if (definitions.length === 0) return null;

  let first: string | null = null;
  for (const period of input.periods) {
    const [signal] = buildSignals({
      indicators: input.indicators,
      series: input.series,
      period,
      rules: input.rules,
      definitions,
    });
    if (signal?.raised) {
      if (first === null) first = period;
    } else {
      first = null;
    }
  }
  return first;
}

/** Signals that appeared or cleared across a span, newest first. */
export interface SignalEvent {
  period: string;
  signalId: string;
  title: string;
  kind: 'raised' | 'cleared';
  severity: Status;
}

export function signalTimeline(input: {
  indicators: readonly Indicator[];
  series: ReadonlyMap<string, readonly Reading[]>;
  periods: readonly string[];
  rules?: RuleSet;
  definitions?: readonly SignalDefinition[];
}): SignalEvent[] {
  const definitions = input.definitions ?? SIGNAL_DEFINITIONS;
  const events: SignalEvent[] = [];

  for (const def of definitions) {
    let wasRaised = false;
    for (const period of input.periods) {
      const [signal] = buildSignals({
        indicators: input.indicators,
        series: input.series,
        period,
        rules: input.rules,
        definitions: [def],
      });
      if (!signal) continue;
      if (signal.raised && !wasRaised) {
        events.push({ period, signalId: def.id, title: def.title, kind: 'raised', severity: signal.severity });
      } else if (!signal.raised && wasRaised) {
        events.push({ period, signalId: def.id, title: def.title, kind: 'cleared', severity: signal.severity });
      }
      wasRaised = signal.raised;
    }
  }
  return events.sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0));
}
