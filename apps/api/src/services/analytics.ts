import type { Types } from 'mongoose';
import {
  INDICATORS,
  assurance,
  baselineCorridor,
  buildSignals,
  comparePeriods,
  completeness,
  completenessTrend,
  dataIssues,
  evaluate,
  evaluateAll,
  firstRaisedPeriod,
  getIndicator,
  lastPeriods,
  quarterValue,
  rollingAverage,
  signalTimeline,
  sortSignals,
  statusCounts,
  yearValue,
  parsePeriod,
  shiftPeriod,
  type Evaluation,
  type Reading,
  type RuleSet,
} from '@cgi/core';
import { loadContext, loadRules, loadSeries } from './series.js';
import { CareHome, IndicatorValue } from '../models/index.js';
import { ApiError } from '../errors.js';

/**
 * Everything the dashboard needs, computed on the server.
 *
 * The engine runs here and not in the browser for two reasons: a status has to
 * be the same for every user looking at the same home, and a report has to be
 * reproducible from stored data long after any particular client is gone.
 */

export interface AnalysisContext {
  organisationId: Types.ObjectId;
  careHomeId: Types.ObjectId;
  period: string;
  windowMonths?: number;
}

async function prepare(ctx: AnalysisContext) {
  const home = await CareHome.findOne({
    _id: ctx.careHomeId,
    organisationId: ctx.organisationId,
  }).lean();
  if (!home) throw ApiError.notFound('Care home not found.');

  const windowMonths = ctx.windowMonths ?? 24;

  /* The window never starts before this home's first submission.
     A month the home was not yet reporting is not a gap in its record — it is
     a month it was not asked about — and counting it as one told every home
     in its first two years that all fifteen indicators had repeated gaps. */
  const [firstReported] = (
    await IndicatorValue.find({
      organisationId: ctx.organisationId,
      careHomeId: ctx.careHomeId,
      current: true,
    })
      .sort({ period: 1 })
      .limit(1)
      .select('period')
      .lean()
  ).map((r) => r.period);

  const periods = lastPeriods(ctx.period, windowMonths).filter(
    (p) => !firstReported || p >= firstReported,
  );
  const [series, rules, context] = await Promise.all([
    loadSeries({
      organisationId: ctx.organisationId,
      careHomeId: ctx.careHomeId,
      periods,
      quarterlyIndicators: home.quarterlyIndicators ?? [],
    }),
    loadRules(ctx.organisationId),
    loadContext(ctx.organisationId, ctx.careHomeId),
  ]);

  return { home, periods, series, rules, context };
}

function serialiseEvaluation(e: Evaluation, series?: ReadonlyMap<string, readonly Reading[]>) {
  const ind = getIndicator(e.indicatorId);
  return {
    ...e,
    indicator: {
      id: ind.id,
      name: ind.name,
      short: ind.short,
      domain: ind.domain,
      unit: ind.unit,
      type: ind.type,
      harm: ind.harm,
      dp: ind.dp,
      kloe: ind.kloe,
    },
    /* The sparkline travels with every evaluation, so a signal's members can be
       drawn without the client having to join them back to the indicator list. */
    sparkline: (series?.get(e.indicatorId) ?? [])
      .slice(-12)
      .map((r) => ({ period: r.period, value: r.value, state: r.state })),
  };
}

export async function dashboard(ctx: AnalysisContext) {
  const { home, periods, series, rules, context } = await prepare(ctx);

  const evaluations = evaluateAll(INDICATORS, series, ctx.period, { rules, context });
  const signals = sortSignals(buildSignals({ indicators: INDICATORS, series, period: ctx.period, rules, context }));
  const raised = signals.filter((s) => s.raised);

  /* Only the raised patterns get the backwards replay — it is the expensive
     part, and a pattern that is not raised has no first-raised date. */
  for (const signal of raised) {
    signal.firstRaisedPeriod = firstRaisedPeriod({
      indicators: INDICATORS,
      series,
      periods,
      signalId: signal.id,
      rules,
    });
  }

  const counts = statusCounts(evaluations.values());
  const quality = completeness(INDICATORS, series, ctx.period);

  /* The heatmap needs a real status per indicator per period, computed the same
     way as the current one. A placeholder would misrepresent the history. */
  const matrixPeriods = periods.slice(-12);
  const matrix: Record<string, Record<string, string>> = {};
  for (const ind of INDICATORS) {
    const readings = series.get(ind.id) ?? [];
    const row: Record<string, string> = {};
    for (const p of matrixPeriods) {
      const index = readings.findIndex((r) => r.period === p);
      row[p] = index < 0 ? 'Insufficient data' : evaluate(ind, readings, { rules, context, atIndex: index }).status;
    }
    matrix[ind.id] = row;
  }

  return {
    matrixPeriods,
    matrix,
    careHome: { id: String(home._id), code: home.code, name: home.name, town: home.town, beds: home.beds },
    period: ctx.period,
    periodLabel: parsePeriod(ctx.period).label,
    rules,
    counts,
    quality,
    indicators: INDICATORS.map((ind) => {
      const e = evaluations.get(ind.id);
      return e
        ? serialiseEvaluation(e, series)
        : { indicatorId: ind.id, status: 'Insufficient data' as const, sparkline: [] };
    }),
    signals: signals.map((s) => ({
      ...s,
      members: s.members.map((m) => serialiseEvaluation(m, series)),
      harmful: s.harmful.map((m) => m.indicatorId),
      improving: s.improving.map((m) => m.indicatorId),
    })),
  };
}

export async function indicatorDetail(ctx: AnalysisContext & { indicatorId: string }) {
  const ind = getIndicator(ctx.indicatorId);
  const { series, rules, context, periods } = await prepare(ctx);

  const readings = series.get(ind.id) ?? [];
  const index = readings.findIndex((r) => r.period === ctx.period);
  if (index < 0) throw ApiError.notFound('No readings for that period.');

  const evaluation = evaluate(ind, readings, { rules, context, atIndex: index });
  const { year, quarter } = parsePeriod(ctx.period);
  const previousQuarter = quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: quarter - 1 };
  const yearAgoPeriod = shiftPeriod(ctx.period, -12);
  const yearAgoIndex = readings.findIndex((r) => r.period === yearAgoPeriod);

  return {
    indicator: ind,
    period: ctx.period,
    evaluation,
    readings: readings.map((r) => ({ ...r })),
    corridor: baselineCorridor(ind, readings, rules),
    comparisons: {
      monthOnMonth: evaluation.momChange,
      yearOnYear:
        yearAgoIndex >= 0 && readings[yearAgoIndex]?.value !== null && evaluation.value !== null
          ? Number((evaluation.value - (readings[yearAgoIndex]?.value as number)).toFixed(3))
          : null,
      thisQuarter: quarterValue(readings, year, quarter),
      previousQuarter: quarterValue(readings, previousQuarter.year, previousQuarter.quarter),
      sameQuarterLastYear: quarterValue(readings, year - 1, quarter),
      thisYear: yearValue(readings, year),
      previousYear: yearValue(readings, year - 1),
      rolling3: rollingAverage(readings, ctx.period, 3),
      rolling6: rollingAverage(readings, ctx.period, 6),
    },
    periods,
  };
}

export async function compare(
  ctx: Omit<AnalysisContext, 'period'> & { fromPeriod: string; toPeriod: string },
) {
  const home = await CareHome.findOne({
    _id: ctx.careHomeId,
    organisationId: ctx.organisationId,
  }).lean();
  if (!home) throw ApiError.notFound('Care home not found.');

  const earliest = ctx.fromPeriod < ctx.toPeriod ? ctx.fromPeriod : ctx.toPeriod;
  const latest = ctx.fromPeriod < ctx.toPeriod ? ctx.toPeriod : ctx.fromPeriod;
  /* Both periods need their own baseline history behind them. */
  const periods = lastPeriods(latest, monthsBetween(earliest, latest) + 12);

  const [series, rules] = await Promise.all([
    loadSeries({
      organisationId: ctx.organisationId,
      careHomeId: ctx.careHomeId,
      periods,
      quarterlyIndicators: home.quarterlyIndicators ?? [],
    }),
    loadRules(ctx.organisationId),
  ]);

  const result = comparePeriods({
    indicators: INDICATORS,
    series,
    fromPeriod: ctx.fromPeriod,
    toPeriod: ctx.toPeriod,
    rules,
  });

  return {
    ...result,
    fromLabel: parsePeriod(ctx.fromPeriod).label,
    toLabel: parsePeriod(ctx.toPeriod).label,
    indicators: Object.fromEntries(INDICATORS.map((i) => [i.id, { short: i.short, unit: i.unit, dp: i.dp }])),
  };
}

function monthsBetween(from: string, to: string): number {
  const a = parsePeriod(from);
  const b = parsePeriod(to);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

export async function qualityReport(ctx: AnalysisContext) {
  const { series, periods } = await prepare(ctx);
  return {
    period: ctx.period,
    completeness: completeness(INDICATORS, series, ctx.period),
    trend: completenessTrend(INDICATORS, series, periods.slice(-12)),
    issues: dataIssues(INDICATORS, series),
  };
}

export async function assuranceReport(ctx: AnalysisContext) {
  const { series, rules } = await prepare(ctx);
  const areas = assurance({ indicators: INDICATORS, series, period: ctx.period, rules });
  return {
    period: ctx.period,
    areas: areas.map((a) => ({
      ...a,
      members: a.members.map((m) => serialiseEvaluation(m, series)),
    })),
  };
}

export async function timeline(ctx: AnalysisContext) {
  const { series, rules, periods } = await prepare(ctx);
  return signalTimeline({ indicators: INDICATORS, series, periods, rules }).slice(0, 20);
}

/** The frozen snapshot a report keeps, so its numbers never move afterwards. */
export async function buildSnapshot(ctx: AnalysisContext, rules: RuleSet) {
  const { series, context } = await prepare(ctx);
  const evaluations = evaluateAll(INDICATORS, series, ctx.period, { rules, context });
  const signals = buildSignals({ indicators: INDICATORS, series, period: ctx.period, rules, context });

  return {
    period: ctx.period,
    counts: statusCounts(evaluations.values()),
    quality: completeness(INDICATORS, series, ctx.period),
    indicators: [...evaluations.values()].map((e) => ({
      indicatorId: e.indicatorId,
      value: e.value,
      baseline: e.baseline,
      changePct: e.changePct,
      status: e.status,
      why: e.why,
      state: e.state,
    })),
    signals: signals
      .filter((s) => s.raised)
      .map((s) => ({ id: s.id, title: s.title, severity: s.severity, narrative: s.narrative })),
  };
}

export type Snapshot = Awaited<ReturnType<typeof buildSnapshot>>;

export function readingsOf(series: Map<string, Reading[]>, indicatorId: string): Reading[] {
  return series.get(indicatorId) ?? [];
}
