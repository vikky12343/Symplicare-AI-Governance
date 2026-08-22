import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { normaliseRules } from '@cgi/core';
import { AuditLog, Organisation, ROLES, User, Invitation, Session } from '../models/index.js';
import { auth, requireCapability } from '../middleware/auth.js';
import { ApiError, asyncRoute } from '../errors.js';
import { capabilitiesOf } from '../middleware/capabilities.js';
import { revokeAllSessions } from '../auth/sessions.js';
import { record } from '../services/audit.js';
import { generateToken, hashToken } from '../auth/passwords.js';

const router = Router();

router.get(
  '/organisation',
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const organisation = await Organisation.findById(ctx.organisationId).lean();
    if (!organisation) throw ApiError.notFound('Organisation not found.');
    res.json({
      organisation: {
        id: String(organisation._id),
        name: organisation.name,
        reportingCycle: organisation.reportingCycle,
        timezone: organisation.timezone,
        retentionMonths: organisation.retentionMonths,
        rules: normaliseRules(organisation.rules as never),
      },
    });
  }),
);

/**
 * Trend thresholds are configuration, not opinion — the source pack says they
 * must be validated against real homes rather than assumed. Changing them is
 * therefore allowed, audited, and always normalised into a range the engine
 * can honour.
 */
router.patch(
  '/organisation/rules',
  requireCapability('manageSettings'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const body = z
      .object({
        baselineWindow: z.number().optional(),
        baselineMin: z.number().optional(),
        bandSigma: z.number().optional(),
        strongSigma: z.number().optional(),
        runDeteriorate: z.number().optional(),
        runImprove: z.number().optional(),
        materialPct: z.number().optional(),
        convergeMin: z.number().optional(),
        smallNumberFloor: z.number().optional(),
      })
      .parse(req.body);

    const organisation = await Organisation.findById(ctx.organisationId);
    if (!organisation) throw ApiError.notFound('Organisation not found.');

    const before = normaliseRules(organisation.rules as never);
    const after = normaliseRules({ ...before, ...body });
    organisation.rules = after;
    await organisation.save();

    await record({
      req,
      action: 'settings.rules.changed',
      entity: 'Organisation',
      entityId: String(organisation._id),
      detail: { before, after },
    });

    res.json({
      rules: after,
      note: 'Statuses are recalculated on the next request. Reports already generated keep the thresholds they were built with.',
    });
  }),
);

router.get(
  '/members',
  requireCapability('manageMembers'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const users = await User.find({ 'memberships.organisationId': ctx.organisationId })
      .select('name email memberships lastLoginAt disabledAt emailVerifiedAt')
      .lean();

    res.json({
      members: users.map((u) => {
        const membership = u.memberships.find((m) => String(m.organisationId) === String(ctx.organisationId));
        return {
          id: String(u._id),
          name: u.name,
          email: u.email,
          role: membership?.role ?? null,
          careHomeIds: (membership?.careHomeIds ?? []).map(String),
          emailVerified: Boolean(u.emailVerifiedAt),
          lastLoginAt: u.lastLoginAt,
          disabled: Boolean(u.disabledAt),
        };
      }),
      roles: ROLES,
    });
  }),
);

router.patch(
  '/members/:userId/role',
  requireCapability('manageMembers'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const id = String(req.params.userId);
    if (!Types.ObjectId.isValid(id)) throw ApiError.notFound('Member not found.');

    const { role } = z.object({ role: z.enum(ROLES) }).parse(req.body);

    if (String(ctx.user._id) === id) {
      throw ApiError.badRequest('You cannot change your own role. Ask another owner to do it.');
    }

    const user = await User.findOne({
      _id: new Types.ObjectId(id),
      'memberships.organisationId': ctx.organisationId,
    });
    if (!user) throw ApiError.notFound('Member not found.');

    const membership = user.memberships.find(
      (m) => String(m.organisationId) === String(ctx.organisationId),
    );
    if (!membership) throw ApiError.notFound('Member not found.');

    /* An organisation must keep at least one owner. */
    if (membership.role === 'Organisation Owner' && role !== 'Organisation Owner') {
      const owners = await User.countDocuments({
        memberships: { $elemMatch: { organisationId: ctx.organisationId, role: 'Organisation Owner' } },
      });
      if (owners <= 1) throw ApiError.conflict('This organisation must keep at least one owner.');
    }

    const previousRole = membership.role;
    membership.role = role;
    await user.save();

    /* A role change takes effect at once: end that user's sessions so the next
       request is authorised against the new role. */
    const revoked = await revokeAllSessions(user._id);

    await record({
      req,
      action: 'member.role.changed',
      entity: 'User',
      entityId: String(user._id),
      detail: { from: previousRole, to: role, sessionsRevoked: revoked },
    });

    res.json({
      member: { id: String(user._id), role, capabilities: capabilitiesOf(role) },
      sessionsRevoked: revoked,
    });
  }),
);

router.post(
  '/invites',
  requireCapability('manageMembers'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const { email, role } = z.object({
      email: z.string().email().max(254),
      role: z.enum(ROLES),
    }).parse(req.body);

    const normalisedEmail = email.toLowerCase().trim();

    const existing = await User.findOne({ email: normalisedEmail }).select('_id').lean();
    if (existing) {
      throw ApiError.conflict('That email address is already registered.');
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const invite = await Invitation.create({
      organisationId: ctx.organisationId,
      email: normalisedEmail,
      role,
      tokenHash: hashToken(token),
      expiresAt,
      createdBy: ctx.user._id,
      createdByName: ctx.user.name,
    });

    await record({
      req,
      action: 'member.invited',
      entity: 'Invitation',
      entityId: String(invite._id),
      detail: { email: normalisedEmail, role },
    });

    res.status(201).json({ invited: true, token });
  }),
);

router.get(
  '/audit',
  requireCapability('readAuditLog'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const limit = Math.min(Number(req.query.limit ?? 100), 500);
    const filter: Record<string, unknown> = { organisationId: ctx.organisationId };
    if (typeof req.query.action === 'string') filter.action = req.query.action;

    const entries = await AuditLog.find(filter).sort({ at: -1 }).limit(limit).lean();
    res.json({
      entries: entries.map((e) => ({
        id: String(e._id),
        at: e.at,
        userName: e.userName,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        outcome: e.outcome,
        detail: e.detail,
      })),
    });
  }),
);

router.delete(
  '/organisation',
  requireCapability('manageSettings'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const org = await Organisation.findById(ctx.organisationId);
    if (!org) throw ApiError.notFound('Organisation not found.');
    if (org.archivedAt) throw ApiError.conflict('Organisation is already archived.');

    org.archivedAt = new Date();
    await org.save();

    const users = await User.find({ 'memberships.organisationId': org._id }).select('_id').lean();
    await Session.deleteMany({ userId: { $in: users.map((u) => u._id) } });
    await User.updateMany(
      { 'memberships.organisationId': org._id },
      { $pull: { memberships: { organisationId: org._id } } }
    );

    await record({
      req,
      action: 'organisation.deleted',
      entity: 'Organisation',
      entityId: String(org._id),
      detail: { name: org.name },
    });

    res.json({ deleted: true });
  }),
);

export default router;
