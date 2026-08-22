import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { isPeriodId } from '@cgi/core';
import { Action, User } from '../models/index.js';
import { auth, careHome, requireCapability, resolveCareHome } from '../middleware/auth.js';
import { ApiError, asyncRoute } from '../errors.js';
import { record } from '../services/audit.js';

const router = Router();

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.');

/** References are per organisation and readable, e.g. ACT-004. */
async function nextReference(organisationId: Types.ObjectId): Promise<string> {
  const latest = await Action.findOne({ organisationId }).sort({ createdAt: -1 }).select('reference').lean();
  const n = latest ? Number(latest.reference.split('-')[1] ?? 0) + 1 : 1;
  return `ACT-${String(n).padStart(3, '0')}`;
}

/**
 * Loads an action by id *and* tenant in one query. Loading first and comparing
 * afterwards is how object-level authorisation gets forgotten.
 */
async function findAction(req: Parameters<typeof auth>[0], id: string) {
  const ctx = auth(req);
  const home = careHome(req);
  if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Action not found.');
  const action = await Action.findOne({
    _id: new Types.ObjectId(id),
    organisationId: ctx.organisationId,
    careHomeId: home._id,
  });
  if (!action) throw ApiError.notFound('Action not found.');
  return action;
}

function serialise(a: InstanceType<typeof Action>) {
  return {
    id: String(a._id),
    reference: a.reference,
    title: a.title,
    description: a.description,
    signalId: a.signalId,
    indicatorIds: a.indicatorIds,
    priority: a.priority,
    assessment: a.assessment,
    ownerName: a.ownerName,
    ownerId: a.ownerId ? String(a.ownerId) : null,
    dueDate: a.dueDate,
    reviewDate: a.reviewDate,
    status: a.status,
    closure: a.closure,
    outcome: a.outcome,
    interventionPeriod: a.interventionPeriod,
    createdAt: (a as { createdAt?: Date }).createdAt,
    completedAt: a.completedAt,
  };
}

router.get(
  '/:careHomeId/actions',
  resolveCareHome,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const status = req.query.status;
    const filter: Record<string, unknown> = { organisationId: ctx.organisationId, careHomeId: home._id };
    if (status === 'open' || status === 'completed') {
      filter.status = status === 'open' ? 'Open' : 'Completed';
    }

    const actions = await Action.find(filter).sort({ dueDate: 1, createdAt: -1 }).limit(200);
    const today = new Date().toISOString().slice(0, 10);

    res.json({
      actions: actions.map((a) => ({
        ...serialise(a),
        overdue: a.status !== 'Completed' && Boolean(a.dueDate) && (a.dueDate as string) < today,
      })),
      today,
    });
  }),
);

const createSchema = z.object({
  title: z.string().min(3).max(300),
  description: z.string().max(4000).optional(),
  signalId: z.string().regex(/^SIG-\d{2}$/).nullable().optional(),
  indicatorIds: z.array(z.string().regex(/^Q\d{2}$/)).max(15).optional(),
  priority: z.enum(['High', 'Medium', 'Low']).optional(),
  assessment: z
    .enum(['Requires review', 'Confirmed concern', 'Explained by known context', 'Not relevant', 'False positive'])
    .optional(),
  ownerId: z.string().optional(),
  dueDate: isoDate,
  reviewDate: isoDate,
  interventionPeriod: z.string().refine(isPeriodId).nullable().optional(),
});

router.post(
  '/:careHomeId/actions',
  resolveCareHome,
  requireCapability('manageActions'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const home = careHome(req);
    const body = createSchema.parse(req.body);

    if (body.reviewDate < body.dueDate) {
      throw ApiError.badRequest('The review date cannot be before the due date.');
    }

    /* An owner must be a member of the same organisation. */
    let ownerName = ctx.user.name;
    let ownerId = ctx.user._id;
    if (body.ownerId) {
      if (!Types.ObjectId.isValid(body.ownerId)) throw ApiError.badRequest('That owner is not valid.');
      const owner = await User.findOne({
        _id: new Types.ObjectId(body.ownerId),
        'memberships.organisationId': ctx.organisationId,
      })
        .select('name')
        .lean();
      if (!owner) throw ApiError.badRequest('That owner is not a member of this organisation.');
      ownerName = owner.name;
      ownerId = owner._id;
    }

    const action = await Action.create({
      ...body,
      organisationId: ctx.organisationId,
      careHomeId: home._id,
      reference: await nextReference(ctx.organisationId),
      ownerId,
      ownerName,
      createdBy: ctx.user._id,
    });

    await record({
      req,
      action: 'action.created',
      entity: 'Action',
      entityId: String(action._id),
      careHomeId: home._id,
      detail: { reference: action.reference, signalId: action.signalId, indicatorIds: action.indicatorIds },
    });

    res.status(201).json({ action: serialise(action) });
  }),
);

const updateSchema = z.object({
  assessment: createSchema.shape.assessment,
  priority: createSchema.shape.priority,
  dueDate: isoDate.optional(),
  reviewDate: isoDate.optional(),
  description: z.string().max(4000).optional(),
  ownerId: z.string().optional(),
});

router.patch(
  '/:careHomeId/actions/:actionId',
  resolveCareHome,
  requireCapability('manageActions'),
  asyncRoute(async (req, res) => {
    const home = careHome(req);
    const action = await findAction(req, String(req.params.actionId));
    if (action.status === 'Completed') {
      throw ApiError.conflict('That action is closed. Its record is kept as it was.');
    }
    const body = updateSchema.parse(req.body);
    const changed: string[] = [];

    for (const [key, value] of Object.entries(body)) {
      if (value === undefined || key === 'ownerId') continue;
      (action as unknown as Record<string, unknown>)[key] = value;
      changed.push(key);
    }
    await action.save();

    await record({
      req,
      action: 'action.updated',
      entity: 'Action',
      entityId: String(action._id),
      careHomeId: home._id,
      detail: { reference: action.reference, changed },
    });

    res.json({ action: serialise(action) });
  }),
);

const closeSchema = z.object({
  closure: z.enum(['Resolved', 'Ongoing', 'Not relevant', 'False positive']),
  outcome: z.string().min(3).max(4000),
});

/**
 * Closing an action is what turns detection into a record. The closure reason
 * is kept — including "false positive", which is the one the pilot most needs
 * in order to tune thresholds.
 */
router.post(
  '/:careHomeId/actions/:actionId/close',
  resolveCareHome,
  requireCapability('manageActions'),
  asyncRoute(async (req, res) => {
    const home = careHome(req);
    const action = await findAction(req, String(req.params.actionId));
    if (action.status === 'Completed') throw ApiError.conflict('That action is already closed.');

    const body = closeSchema.parse(req.body);
    action.closure = body.closure;
    action.outcome = body.outcome;
    action.status = 'Completed';
    action.completedAt = new Date();
    await action.save();

    await record({
      req,
      action: 'action.closed',
      entity: 'Action',
      entityId: String(action._id),
      careHomeId: home._id,
      detail: { reference: action.reference, closure: body.closure },
    });

    res.json({ action: serialise(action) });
  }),
);

export default router;
