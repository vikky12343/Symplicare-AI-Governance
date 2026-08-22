import { Router } from 'express';
import { Types } from 'mongoose';
import { INDICATORS, isPeriodId, parsePeriod } from '@cgi/core';
import { Action, CareHome, IndicatorValue, Report, type CareHomeDoc } from '../models/index.js';
import { auth, homeScope } from '../middleware/auth.js';
import { asyncRoute } from '../errors.js';
import { dashboard } from '../services/analytics.js';

/**
 * The manager's opening screen, for the whole organisation or one home.
 *
 * Everything here is derived from data already in the database — the same
 * evaluations the per-home dashboard runs, the same actions, the same reports.
 * Nothing is invented for the sake of a tile: a figure that cannot be computed
 * comes back as null and the client renders it as absent.
 */

const router = Router();

/**
 * Governance health.
 *
 * The share of indicators that could be read this period and are sitting
 * inside their normal range. Deliberately NOT a composite quality index: the
 * product specification is explicit that the tracker should not produce a
 * universal quality score, and a manager should be able to reconstruct this
 * number by counting statuses on the indicator list.
 *
 * Indicators that cannot be read are excluded from both halves rather than
 * counted as healthy — a home that submitted nothing would otherwise score
 * 100%.
 */
export function healthFrom(counts: Record<string, number>): number | null {
  const readable =
    (counts.Deteriorating ?? 0) + (counts.Watch ?? 0) + (counts.Stable ?? 0) + (counts.Improving ?? 0);
  if (readable === 0) return null;
  const settled = (counts.Stable ?? 0) + (counts.Improving ?? 0);
  return Math.round((settled / readable) * 100);
}

/** Health for one period, read off the status matrix the dashboard builds. */
function healthAt(matrix: Record<string, Record<string, string>>, period: string): number | null {
  const counts: Record<string, number> = {};
  for (const ind of INDICATORS) {
    const status = matrix[ind.id]?.[period] ?? 'Insufficient data';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return healthFrom(counts);
}

/** The month before this one, so a tile can say what changed. */
function previousPeriod(period: string): string {
  const [y, m] = period.split('-').map(Number);
  const date = new Date(Date.UTC(y as number, (m as number) - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

type HomeView = {
  home: CareHomeDoc;
  data: Awaited<ReturnType<typeof dashboard>> | null;
};

router.get(
  '/',
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const scopeParam = typeof req.query.careHomeId === 'string' ? req.query.careHomeId : 'all';
    const filter = homeScope(ctx);

    const homes = await CareHome.find({
      ...filter,
      archivedAt: null,
      ...(filter.careHomeId ? { _id: filter.careHomeId } : {}),
      ...(scopeParam !== 'all' && Types.ObjectId.isValid(scopeParam)
        ? { _id: new Types.ObjectId(scopeParam) }
        : {}),
    })
      .sort({ name: 1 })
      .lean();

    if (homes.length === 0) {
      res.json({
        scope: { kind: 'all', careHomeId: 'all', name: 'All care homes', homeCount: 0 },
        periods: [],
        period: null,
        periodLabel: null,
        kpis: null,
        trend: [],
        topSignals: [],
        actions: { total: 0, overdue: 0, inProgress: 0, dueSoon: 0 },
        homes: [],
        reports: [],
      });
      return;
    }

    /* The period the manager asked for, or the most recent one anything in
       scope has actually reported. */
    const requested = typeof req.query.period === 'string' && isPeriodId(req.query.period) ? req.query.period : null;
    const reported = (await IndicatorValue.distinct('period', {
      organisationId: ctx.organisationId,
      careHomeId: { $in: homes.map((h) => h._id) },
      current: true,
    }));
    const periods = reported.sort().reverse();
    const period = requested && periods.includes(requested) ? requested : (periods[0] ?? null);

    if (!period) {
      res.json({
        scope: scopeOf(homes, scopeParam),
        periods: [],
        period: null,
        periodLabel: null,
        kpis: null,
        trend: [],
        topSignals: [],
        actions: await actionCounts(ctx.organisationId, homes),
        homes: homes.map((h) => ({
          id: String(h._id),
          name: h.name,
          town: h.town ?? '',
          health: null,
          sparkline: [],
          openSignals: null,
          openActions: 0,
          lastReport: null,
        })),
        reports: [],
      });
      return;
    }

    /* One evaluation pass per home. The dashboard already returns a twelve
       period status matrix, so the trend comes out of the same call rather
       than twelve more. */
    const views: HomeView[] = await Promise.all(
      homes.map(async (home) => {
        try {
          const data = await dashboard({
            organisationId: ctx.organisationId,
            careHomeId: home._id,
            period,
          });
          return { home: home as unknown as CareHomeDoc, data };
        } catch {
          /* A home with nothing filed for this period is not an error; it
             simply has nothing to contribute to the aggregate. */
          return { home: home as unknown as CareHomeDoc, data: null };
        }
      }),
    );

    const withData = views.filter((v) => v.data !== null);

    /* Aggregate counts across every home in scope. */
    const counts: Record<string, number> = {};
    for (const v of withData) {
      for (const [status, n] of Object.entries(v.data!.counts)) {
        counts[status] = (counts[status] ?? 0) + (n);
      }
    }

    const matrixPeriods = withData[0]?.data?.matrixPeriods ?? [];
    const trend = matrixPeriods.map((p) => {
      const perHome = withData.map((v) => healthAt(v.data!.matrix, p)).filter((n): n is number => n !== null);
      return {
        period: p,
        label: parsePeriod(p).label,
        value: perHome.length ? Math.round(perHome.reduce((a, b) => a + b, 0) / perHome.length) : null,
      };
    });

    const openSignals = withData.reduce((n, v) => n + v.data!.signals.filter((s) => s.raised).length, 0);
    const criticalSignals = withData.reduce(
      (n, v) => n + v.data!.signals.filter((s) => s.raised && s.severity === 'Deteriorating').length,
      0,
    );

    const prev = previousPeriod(period);
    const prevCounts: Record<string, number> = {};
    for (const v of withData) {
      for (const ind of INDICATORS) {
        const status = v.data!.matrix[ind.id]?.[prev] ?? 'Insufficient data';
        prevCounts[status] = (prevCounts[status] ?? 0) + 1;
      }
    }

    /* Every raised pattern across the organisation, worst first, named by the
       home it belongs to so the manager knows where to look. */
    const topSignals = withData
      .flatMap((v) =>
        v.data!.signals
          .filter((s) => s.raised)
          .map((s) => ({
            id: `${String(v.home._id)}:${s.id}`,
            careHomeId: String(v.home._id),
            careHomeName: v.home.name,
            title: s.title,
            severity: s.severity,
            indicators: s.harmful.length,
          })),
      )
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.indicators - a.indicators)
      .slice(0, 6);

    const actions = await actionCounts(ctx.organisationId, homes);

    const perHomeActions = await Action.aggregate<{ _id: Types.ObjectId; n: number }>([
      {
        $match: {
          organisationId: ctx.organisationId,
          careHomeId: { $in: homes.map((h) => h._id) },
          status: 'Open',
        },
      },
      { $group: { _id: '$careHomeId', n: { $sum: 1 } } },
    ]);
    const openByHome = new Map(perHomeActions.map((a) => [String(a._id), a.n]));

    const reportDocs = await Report.find({
      organisationId: ctx.organisationId,
      careHomeId: { $in: homes.map((h) => h._id) },
    })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    const nameOf = new Map(homes.map((h) => [String(h._id), h.name]));
    const lastReportByHome = await Report.aggregate<{ _id: Types.ObjectId; at: Date }>([
      { $match: { organisationId: ctx.organisationId, careHomeId: { $in: homes.map((h) => h._id) } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$careHomeId', at: { $first: '$createdAt' } } },
    ]);
    const lastReport = new Map(lastReportByHome.map((r) => [String(r._id), r.at]));

    const monthStart = new Date(`${period}-01T00:00:00.000Z`);
    const monthEnd = new Date(monthStart);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1);
    const reportsThisMonth = await Report.countDocuments({
      organisationId: ctx.organisationId,
      careHomeId: { $in: homes.map((h) => h._id) },
      createdAt: { $gte: monthStart, $lt: monthEnd },
    });
    const prevStart = new Date(monthStart);
    prevStart.setUTCMonth(prevStart.getUTCMonth() - 1);
    const reportsPrevMonth = await Report.countDocuments({
      organisationId: ctx.organisationId,
      careHomeId: { $in: homes.map((h) => h._id) },
      createdAt: { $gte: prevStart, $lt: monthStart },
    });

    res.json({
      scope: scopeOf(homes, scopeParam),
      periods: periods.map((p) => ({ id: p, label: parsePeriod(p).label })),
      period,
      periodLabel: parsePeriod(period).label,
      previousLabel: parsePeriod(prev).label,
      kpis: {
        governanceHealth: {
          value: healthFrom(counts),
          previous: healthFrom(prevCounts),
          unit: '%',
        },
        openSignals: { value: openSignals, previous: null },
        criticalSignals: { value: criticalSignals, previous: null },
        openActions: { value: actions.total, previous: null },
        reports: { value: reportsThisMonth, previous: reportsPrevMonth },
      },
      counts,
      trend,
      topSignals,
      actions,
      homes: views.map((v) => ({
        id: String(v.home._id),
        name: v.home.name,
        town: v.home.town ?? '',
        health: v.data ? healthFrom(v.data.counts) : null,
        sparkline: v.data
          ? v.data.matrixPeriods.map((p) => healthAt(v.data!.matrix, p)).filter((n): n is number => n !== null)
          : [],
        openSignals: v.data ? v.data.signals.filter((s) => s.raised).length : null,
        openActions: openByHome.get(String(v.home._id)) ?? 0,
        lastReport: lastReport.get(String(v.home._id)) ?? null,
      })),
      reports: reportDocs.map((r) => ({
        id: String(r._id),
        reference: r.reference,
        kind: r.kind,
        period: r.period,
        periodLabel: parsePeriod(r.period).label,
        careHomeId: String(r.careHomeId),
        careHomeName: nameOf.get(String(r.careHomeId)) ?? '',
        approvalStatus: r.approvalStatus,
        at: (r as { createdAt?: Date }).createdAt ?? null,
      })),
    });
  }),
);

function scopeOf(homes: { _id: unknown; name: string }[], scopeParam: string) {
  const single = scopeParam !== 'all' && homes.length === 1;
  return {
    kind: single ? ('home' as const) : ('all' as const),
    careHomeId: single ? String(homes[0]!._id) : 'all',
    name: single ? homes[0]!.name : 'All care homes',
    homeCount: homes.length,
  };
}

function severityRank(severity: string): number {
  return ['Deteriorating', 'Watch', 'Stable', 'Improving'].indexOf(severity);
}

/**
 * Open actions, split the way a manager triages them: already late, due within
 * the week, and everything else in flight.
 */
async function actionCounts(organisationId: Types.ObjectId, homes: { _id: Types.ObjectId }[]) {
  const open = await Action.find({
    organisationId,
    careHomeId: { $in: homes.map((h) => h._id) },
    status: 'Open',
  })
    .select('dueDate')
    .lean();

  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  const soonIso = soon.toISOString().slice(0, 10);

  let overdue = 0;
  let dueSoon = 0;
  for (const a of open) {
    if (a.dueDate && a.dueDate < today) overdue += 1;
    else if (a.dueDate && a.dueDate <= soonIso) dueSoon += 1;
  }
  return { total: open.length, overdue, dueSoon, inProgress: open.length - overdue - dueSoon };
}

export default router;
