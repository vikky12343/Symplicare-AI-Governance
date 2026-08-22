import { Router } from 'express';
import { z } from 'zod';
import {
  CARE_HOME_TYPES,
  CareHome,
  IndicatorValue,
  Notification,
  type CareHomeAttrs,
  type CareHomeDoc,
} from '../models/index.js';
import { auth, careHome, homeScope, requireCapability, resolveCareHome } from '../middleware/auth.js';
import { ApiError, asyncRoute } from '../errors.js';
import { INDICATOR_IDS, parsePeriod } from '@cgi/core';
import { latestPeriod } from '../services/series.js';
import { record } from '../services/audit.js';

const router = Router();

/**
 * Everything a card, a table row or an edit form needs, in one shape.
 *
 * Accepts either a hydrated document or the lean object `.lean()` returns,
 * which is why the fields are read structurally rather than off a model type.
 */
type HomeLike = Partial<Record<keyof CareHomeAttrs, unknown>> & { _id: unknown };

function homeOf(h: CareHomeDoc | HomeLike) {
  const v = h as Record<string, unknown>;
  return {
    id: String(h._id),
    code: v.code as string,
    name: v.name as string,
    type: (v.type as string) ?? 'Residential',
    addressLine1: (v.addressLine1 as string) ?? '',
    addressLine2: (v.addressLine2 as string) ?? '',
    town: (v.town as string) ?? '',
    county: (v.county as string) ?? '',
    postcode: (v.postcode as string) ?? '',
    beds: (v.beds as number) ?? null,
    residents: (v.residents as number) ?? null,
    cqcLocationId: (v.cqcLocationId as string) ?? '',
    contactName: (v.contactName as string) ?? '',
    contactPhone: (v.contactPhone as string) ?? '',
    contactEmail: (v.contactEmail as string) ?? '',
    quarterlyIndicators: (v.quarterlyIndicators as string[]) ?? [],
    notes: (v.notes as string) ?? '',
    archivedAt: (v.archivedAt as Date) ?? null,
  };
}

/**
 * A code the manager never has to think about.
 *
 * Uploads address homes by code, so one is still required — but asking for it
 * on the add form is asking the manager to invent an identifier for a filing
 * system they have not seen yet. Derive it from the name and make it unique.
 */
async function deriveCode(organisationId: unknown, name: string): Promise<string> {
  const stem =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 20) || 'HOME';

  for (let n = 0; n < 200; n += 1) {
    const candidate = n === 0 ? stem : `${stem}-${n + 1}`;
    const clash = await CareHome.exists({ organisationId, code: candidate });
    if (!clash) return candidate;
  }
  return `${stem}-${Date.now().toString(36).toUpperCase()}`;
}

const homeBody = z.object({
  name: z.string().trim().min(2, 'Enter the care home name.').max(200),
  code: z
    .string()
    .trim()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, numbers and hyphens only.')
    .optional(),
  type: z.enum(CARE_HOME_TYPES).optional(),
  addressLine1: z.string().trim().max(200).optional().or(z.literal('')),
  addressLine2: z.string().trim().max(200).optional().or(z.literal('')),
  town: z.string().trim().max(120).optional().or(z.literal('')),
  county: z.string().trim().max(120).optional().or(z.literal('')),
  postcode: z.string().trim().max(16).optional().or(z.literal('')),
  beds: z.number().int().min(1).max(2000).nullable().optional(),
  residents: z.number().int().min(0).max(2000).nullable().optional(),
  cqcLocationId: z.string().trim().max(64).optional().or(z.literal('')),
  contactName: z.string().trim().max(200).optional().or(z.literal('')),
  contactPhone: z.string().trim().max(40).optional().or(z.literal('')),
  contactEmail: z.string().trim().max(254).email('Enter a valid email address.').optional().or(z.literal('')),
  quarterlyIndicators: z.array(z.enum(INDICATOR_IDS as [string, ...string[]])).optional(),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

/**
 * Every home this caller may see. Scoped by organisation and by membership.
 *
 * `includeArchived` is opt-in so nothing that already calls this route starts
 * seeing archived homes it never asked for.
 */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const includeArchived = req.query.includeArchived === 'true';
    const filter = homeScope(ctx);

    const homes = await CareHome.find({
      ...filter,
      ...(includeArchived ? {} : { archivedAt: null }),
      ...(filter.careHomeId ? { _id: filter.careHomeId } : {}),
    })
      .sort({ name: 1 })
      .lean();

    const withPeriods = await Promise.all(
      homes.map(async (h) => ({
        ...homeOf(h),
        latestPeriod: await latestPeriod(ctx.organisationId, h._id),
      })),
    );

    res.json({ careHomes: withPeriods });
  }),
);

router.post(
  '/',
  requireCapability('manageSettings'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const body = homeBody.parse(req.body);
    const code = body.code ?? (await deriveCode(ctx.organisationId, body.name));

    let home;
    try {
      home = await CareHome.create({ ...body, code, organisationId: ctx.organisationId });
    } catch (error) {
      /* 11000 is the driver's duplicate-key code; the unique index on
         (organisationId, code) is what raises it. */
      if ((error as { code?: number }).code === 11000) {
        throw ApiError.conflict('A care home with this code already exists.');
      }
      throw error;
    }

    await record({
      req,
      action: 'home.created',
      entity: 'CareHome',
      entityId: String(home._id),
      careHomeId: home._id,
      detail: { code: home.code, name: home.name },
    });

    res.status(201).json({ careHome: homeOf(home) });
  }),
);

/** The periods this home actually has data for, newest first. */
router.get(
  '/:careHomeId/periods',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const periods = await IndicatorValue.distinct('period', {
      organisationId: ctx.organisationId,
      careHomeId: home._id,
      current: true,
    });
    const sorted = periods.sort().reverse();
    res.json({
      periods: sorted.map((p) => ({ id: p, label: parsePeriod(p).label })),
      latest: sorted[0] ?? null,
    });
  }),
);

router.get('/:careHomeId', resolveCareHome, (req, res) => {
  res.json({ careHome: homeOf(careHome(req)) });
});

router.patch(
  '/:careHomeId',
  resolveCareHome,
  requireCapability('manageSettings'),
  asyncRoute(async (req, res) => {
    const home = careHome(req);
    const body = homeBody.partial().parse(req.body);

    /* The code addresses this home in every upload that has ever been filed
       against it, so changing it is deliberate rather than incidental. */
    if (body.code && body.code.toUpperCase() !== home.code) {
      const clash = await CareHome.exists({
        organisationId: home.organisationId,
        code: body.code.toUpperCase(),
        _id: { $ne: home._id },
      });
      if (clash) throw ApiError.conflict('A care home with this code already exists.');
    }

    Object.assign(home, body);
    await home.save();

    await record({
      req,
      action: 'home.updated',
      entity: 'CareHome',
      entityId: String(home._id),
      careHomeId: home._id,
      detail: { code: home.code, name: home.name },
    });

    res.json({ careHome: homeOf(home) });
  }),
);

router.patch(
  '/:careHomeId/archive',
  resolveCareHome,
  requireCapability('manageSettings'),
  asyncRoute(async (req, res) => {
    const home = careHome(req);
    if (home.archivedAt) throw ApiError.conflict('This care home is already archived.');

    home.archivedAt = new Date();
    await home.save();

    await record({
      req,
      action: 'home.archived',
      entity: 'CareHome',
      entityId: String(home._id),
      careHomeId: home._id,
      detail: { code: home.code },
    });

    res.json({ archived: true });
  }),
);

/**
 * Archiving is reversible, so restoring it is a first-class route rather than
 * something an administrator does in the database.
 *
 * `resolveCareHome` deliberately refuses archived homes, so this one resolves
 * the id itself — under the same organisation scope, which is the check that
 * matters.
 */
router.patch(
  '/:careHomeId/restore',
  requireCapability('manageSettings'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const id = req.params.careHomeId;
    const home = await CareHome.findOne({ _id: id, organisationId: ctx.organisationId });
    if (!home) throw ApiError.notFound('Care home not found.');
    if (!home.archivedAt) throw ApiError.conflict('This care home is not archived.');

    home.archivedAt = null;
    await home.save();

    await record({
      req,
      action: 'home.restored',
      entity: 'CareHome',
      entityId: String(home._id),
      careHomeId: home._id,
      detail: { code: home.code },
    });

    res.json({ careHome: homeOf(home) });
  }),
);

router.get(
  '/:careHomeId/notifications',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const notifications = await Notification.find({
      organisationId: ctx.organisationId,
      $or: [{ careHomeId: home._id }, { careHomeId: null }],
    })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();

    res.json({
      notifications: notifications.map((n) => ({
        id: String(n._id),
        kind: n.kind,
        text: n.text,
        level: n.level,
        at: (n as { createdAt?: Date }).createdAt,
        read: (n.readBy ?? []).some((u) => String(u) === String(ctx.user._id)),
      })),
    });
  }),
);

export default router;
