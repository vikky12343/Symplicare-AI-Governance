import { Router } from 'express';
import { z } from 'zod';
import { INDICATOR_BY_ID, isPeriodId } from '@cgi/core';
import { auth, careHome, resolveCareHome } from '../middleware/auth.js';
import { ApiError, asyncRoute } from '../errors.js';
import {
  assuranceReport,
  compare,
  dashboard,
  indicatorDetail,
  qualityReport,
  timeline,
} from '../services/analytics.js';
import { latestPeriod } from '../services/series.js';

const router = Router();

/** Falls back to the home's most recent submitted period. */
async function resolvePeriod(req: Parameters<typeof auth>[0]): Promise<string> {
  const raw = req.query.period;
  if (typeof raw === 'string' && raw.length > 0) {
    if (!isPeriodId(raw)) throw ApiError.badRequest(`"${raw}" is not a reporting period. Expected YYYY-MM.`);
    return raw;
  }
  const ctx = auth(req);
  const home = careHome(req);
  const latest = await latestPeriod(ctx.organisationId, home._id);
  if (!latest) throw ApiError.noData('No data has been uploaded for this care home yet.');
  return latest;
}

router.get(
  '/:careHomeId/dashboard',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const period = await resolvePeriod(req);
    res.json(await dashboard({ organisationId: ctx.organisationId, careHomeId: home._id, period }));
  }),
);

router.get(
  '/:careHomeId/indicators/:indicatorId',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const indicatorId = String(req.params.indicatorId).toUpperCase();
    if (!INDICATOR_BY_ID.has(indicatorId)) throw ApiError.notFound('No such indicator.');
    const period = await resolvePeriod(req);

    res.json(
      await indicatorDetail({
        organisationId: ctx.organisationId,
        careHomeId: home._id,
        period,
        indicatorId,
      }),
    );
  }),
);

const compareSchema = z.object({
  from: z.string().refine(isPeriodId, 'Expected YYYY-MM.'),
  to: z.string().refine(isPeriodId, 'Expected YYYY-MM.'),
});

router.get(
  '/:careHomeId/compare',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const { from, to } = compareSchema.parse(req.query);
    res.json(
      await compare({ organisationId: ctx.organisationId, careHomeId: home._id, fromPeriod: from, toPeriod: to }),
    );
  }),
);

router.get(
  '/:careHomeId/quality',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const period = await resolvePeriod(req);
    res.json(await qualityReport({ organisationId: ctx.organisationId, careHomeId: home._id, period }));
  }),
);

router.get(
  '/:careHomeId/assurance',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const period = await resolvePeriod(req);
    res.json(await assuranceReport({ organisationId: ctx.organisationId, careHomeId: home._id, period }));
  }),
);

router.get(
  '/:careHomeId/signal-timeline',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const period = await resolvePeriod(req);
    res.json({ events: await timeline({ organisationId: ctx.organisationId, careHomeId: home._id, period }) });
  }),
);

export default router;
