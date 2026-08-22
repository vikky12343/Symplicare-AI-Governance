/**
 * Governance assurance.
 *
 * Internal indicators mapped to the five key questions used in adult social
 * care assessment, so a management conversation lines up with the structure an
 * assessment uses.
 *
 * This is the organisation's own view of its own data. It is not a rating, it
 * does not predict one, and a stable internal indicator does not evidence
 * regulatory compliance. The wording that renders this must say so.
 */

import type { Evaluation, Indicator, KeyQuestion, Reading, Status } from './types.js';
import type { RuleSet } from './rules.js';
import { evaluateAll } from './engine.js';
import { KEY_QUESTIONS } from './indicators.js';

export interface AssuranceArea {
  keyQuestion: KeyQuestion;
  state: Status;
  members: Evaluation[];
  deteriorating: number;
  watch: number;
}

export function assurance(input: {
  indicators: readonly Indicator[];
  series: ReadonlyMap<string, readonly Reading[]>;
  period: string;
  rules?: RuleSet;
}): AssuranceArea[] {
  const evaluations = evaluateAll(input.indicators, input.series, input.period, {
    rules: input.rules,
  });

  return KEY_QUESTIONS.map((keyQuestion) => {
    const members = input.indicators
      .filter((i) => i.kloe === keyQuestion)
      .map((i) => evaluations.get(i.id))
      .filter((e): e is Evaluation => Boolean(e));

    const usable = members.filter((m) => m.status !== 'Insufficient data');
    const deteriorating = usable.filter((m) => m.status === 'Deteriorating').length;
    const watch = usable.filter((m) => m.status === 'Watch').length;

    let state: Status = 'Stable';
    if (usable.length === 0) state = 'Insufficient data';
    else if (deteriorating >= 2) state = 'Deteriorating';
    else if (deteriorating >= 1 || watch >= 2) state = 'Watch';
    else if (usable.every((m) => m.status === 'Improving')) state = 'Improving';

    return { keyQuestion, state, members, deteriorating, watch };
  });
}

/**
 * Regulatory mapping, versioned so that a future framework change can be
 * incorporated without altering what a historical report meant.
 */
export const MAPPING_VERSION = '2026-08-cqc-single-assessment';

export interface RegulatoryMapping {
  indicatorId: string;
  keyQuestion: KeyQuestion;
  regulation: string;
}

export function regulatoryMapping(indicators: readonly Indicator[]): RegulatoryMapping[] {
  return indicators.map((i) => ({
    indicatorId: i.id,
    keyQuestion: i.kloe,
    regulation: i.reg,
  }));
}
