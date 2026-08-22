import { Types } from 'mongoose';
import {
  INDICATORS,
  isQuarterEnd,
  lastPeriods,
  normaliseRules,
  periodRange,
  type ContextNote as CoreContextNote,
  type Reading,
  type RuleSet,
} from '@cgi/core';
import { CareHome, ContextNote, IndicatorValue, Organisation } from '../models/index.js';

/**
 * Turning stored rows into the contiguous series the engine expects.
 *
 * The engine requires every period in the window to be present, including the
 * ones with nothing in them: a gap is a fact about the record, and closing it
 * would let a trend bridge a month that was never submitted.
 */

export interface SeriesOptions {
  careHomeId: Types.ObjectId;
  organisationId: Types.ObjectId;
  /** Inclusive, oldest first. */
  periods: string[];
  quarterlyIndicators?: string[];
}

export async function loadSeries(
  options: SeriesOptions,
): Promise<Map<string, Reading[]>> {
  const rows = await IndicatorValue.find({
    organisationId: options.organisationId,
    careHomeId: options.careHomeId,
    period: { $in: options.periods },
    current: true,
  }).lean();

  const byKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) byKey.set(`${row.indicatorId}|${row.period}`, row);

  const quarterly = new Set(options.quarterlyIndicators ?? []);
  const series = new Map<string, Reading[]>();

  for (const ind of INDICATORS) {
    const readings: Reading[] = options.periods.map((period) => {
      const row = byKey.get(`${ind.id}|${period}`);
      if (row) {
        return {
          period,
          value: row.value ?? null,
          state: row.state,
          numerator: row.numerator ?? null,
          denominator: row.denominator ?? null,
        };
      }
      /* Nothing stored. Say which kind of nothing it is: a home that reports
         this indicator quarterly has no value due in the other months. */
      return {
        period,
        value: null,
        state: quarterly.has(ind.id) && !isQuarterEnd(period) ? 'off-cycle' : 'not-submitted',
      };
    });
    series.set(ind.id, readings);
  }

  return series;
}

/** The default analysis window: two years back from the requested period. */
export function windowFor(period: string, months = 24): string[] {
  return lastPeriods(period, months);
}

export function rangeFor(from: string, to: string): string[] {
  return periodRange(from, to);
}

export async function loadContext(
  organisationId: Types.ObjectId,
  careHomeId: Types.ObjectId,
): Promise<CoreContextNote[]> {
  const notes = await ContextNote.find({ organisationId, careHomeId }).lean();
  return notes.map((n) => ({
    period: n.period,
    indicatorIds: n.indicatorIds ?? [],
    text: n.text,
    by: n.createdByName ?? 'Unknown',
    recordedAt: (n as { createdAt?: Date }).createdAt?.toISOString() ?? '',
  }));
}

/** Trend thresholds for an organisation, always normalised before use. */
export async function loadRules(organisationId: Types.ObjectId): Promise<RuleSet> {
  const org = await Organisation.findById(organisationId).lean();
  return normaliseRules((org?.rules ?? {}) as Partial<RuleSet>);
}

export async function loadHomeContext(organisationId: Types.ObjectId, careHomeId: Types.ObjectId) {
  const [home, rules, context] = await Promise.all([
    CareHome.findOne({ _id: careHomeId, organisationId }).lean(),
    loadRules(organisationId),
    loadContext(organisationId, careHomeId),
  ]);
  return { home, rules, context };
}

/** The most recent period this home has any submitted value for. */
export async function latestPeriod(
  organisationId: Types.ObjectId,
  careHomeId: Types.ObjectId,
): Promise<string | null> {
  const row = await IndicatorValue.findOne({
    organisationId,
    careHomeId,
    current: true,
    value: { $ne: null },
  })
    .sort({ period: -1 })
    .select('period')
    .lean();
  return row?.period ?? null;
}
