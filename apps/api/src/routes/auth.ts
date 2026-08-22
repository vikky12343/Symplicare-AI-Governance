import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { Organisation, Session, User, type Role, Invitation } from '../models/index.js';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../auth/passwords.js';
import {
  clearSessionCookies,
  createSession,
  readSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
} from '../auth/sessions.js';
import { ApiError, asyncRoute } from '../errors.js';
import { requireAuth, requireCsrf, auth } from '../middleware/auth.js';
import { capabilitiesOf } from '../middleware/capabilities.js';
import { organisationOf, profileOf } from './profile.js';
import { record } from '../services/audit.js';
import { isProduction, isTest } from '../env.js';
import { logger } from '../logger.js';

const router = Router();

/* Credential endpoints get their own, much tighter budget. */
const credentialLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 100_000 : 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: { code: 'rate_limited', message: 'Too many attempts. Wait a few minutes and try again.' },
  },
});

const LOCK_AFTER = 8;
const LOCK_MINUTES = 15;

const passwordRules = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200, 'That is longer than 200 characters.')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'Include an uppercase letter, a lowercase letter and a digit.',
  });

const signupSchema = z.object({
  name: z.string().min(2).max(200),
  email: z.string().email('Enter a valid work email address.').max(254),
  password: passwordRules,
  /* Optional: sign-up asks for as little as it can, and the organisation is
     renamed in Settings by the owner who just created it. */
  organisationName: z.string().min(2).max(200).optional(),
});

/**
 * A first name for the new organisation when the person did not give one.
 * A work address carries the organisation in its domain far more often than
 * not, so `sarah@willowbank-care.co.uk` opens "Willowbank Care" rather than
 * something the owner has to correct before it means anything.
 */
function organisationNameFrom(email: string, personName: string): string {
  const domain = email.split('@')[1] ?? '';
  const label = domain.split('.')[0] ?? '';
  const generic = ['gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'yahoo', 'icloud', 'aol', 'proton', 'protonmail', 'me', 'msn'];

  if (label.length >= 2 && !generic.includes(label.toLowerCase())) {
    const titled = label
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
    if (titled.length >= 2) return titled.slice(0, 200);
  }

  return `${personName.trim()}'s organisation`.slice(0, 200);
}

router.post(
  '/signup',
  credentialLimit,
  asyncRoute(async (req, res) => {
    const body = signupSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const existing = await User.findOne({ email }).select('_id').lean();
    if (existing) {
      /* Do not confirm which addresses are registered. */
      throw ApiError.conflict('That email address cannot be used to sign up. Try signing in instead.');
    }

    const organisationName = body.organisationName?.trim() || organisationNameFrom(email, body.name);
    const organisation = await Organisation.create({ name: organisationName });
    const verificationToken = generateToken();

    const user = await User.create({
      email,
      name: body.name.trim(),
      passwordHash: await hashPassword(body.password),
      verificationTokenHash: hashToken(verificationToken),
      verificationExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      memberships: [{ organisationId: organisation._id, role: 'Organisation Owner' as Role, careHomeIds: [] }],
    });

    await record({
      req,
      action: 'auth.signup',
      entity: 'User',
      entityId: String(user._id),
      organisationId: organisation._id,
      userId: user._id,
      userName: user.name,
      detail: { organisation: organisation.name },
    });

    /* A real deployment emails this. Nothing is logged in production. */
    if (!isProduction) logger.info({ email, verificationToken }, 'Email verification token issued');

    res.status(201).json({
      user: { id: String(user._id), email: user.email, name: user.name },
      organisation: { id: String(organisation._id), name: organisation.name },
      emailVerificationRequired: true,
      ...(isProduction ? {} : { verificationToken }),
    });
  }),
);

const acceptInviteSchema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().min(2).max(200),
  password: passwordRules,
});

router.post(
  '/accept-invite',
  credentialLimit,
  asyncRoute(async (req, res) => {
    const body = acceptInviteSchema.parse(req.body);

    const invite = await Invitation.findOne({
      tokenHash: hashToken(body.token),
      expiresAt: { $gt: new Date() },
    });

    if (!invite) throw ApiError.badRequest('That invitation link has expired or is invalid.');

    const existing = await User.findOne({ email: invite.email }).select('_id').lean();
    if (existing) throw ApiError.conflict('That email address is already registered.');

    const user = await User.create({
      email: invite.email,
      name: body.name.trim(),
      passwordHash: await hashPassword(body.password),
      emailVerifiedAt: new Date(),
      memberships: [{ organisationId: invite.organisationId, role: invite.role, careHomeIds: [] }],
    });

    await Invitation.deleteOne({ _id: invite._id });

    await record({
      req,
      action: 'member.joined',
      entity: 'User',
      entityId: String(user._id),
      organisationId: invite.organisationId,
      userId: user._id,
      userName: user.name,
      detail: { role: invite.role },
    });

    res.status(201).json({
      user: { id: String(user._id), email: user.email, name: user.name },
      joined: true,
    });
  }),
);

const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  mfaToken: z.string().length(6).optional(),
});

router.post(
  '/login',
  credentialLimit,
  asyncRoute(async (req, res) => {
    const body = loginSchema.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const user = await User.findOne({ email }).select('+passwordHash +mfaSecret');

    /* One message for every failure mode, so the response cannot be used to
       enumerate accounts or discover which are locked. */
    const refuse = async (reason: string) => {
      await record({
        req,
        action: 'auth.login.failed',
        entity: 'User',
        entityId: user ? String(user._id) : undefined,
        /* Attribute the attempt to the account's own organisation so it shows
           up in that organisation's audit log — a failed sign-in against a real
           account is precisely what a governance reviewer needs to see. An
           attempt against an unknown address belongs to no tenant. */
        organisationId: user?.memberships[0]?.organisationId ?? null,
        userId: user?._id ?? null,
        userName: user?.name ?? email,
        outcome: 'denied',
        detail: { reason, email },
      });
      throw ApiError.unauthorised('That email address and password do not match.');
    };

    if (!user) {
      /* Spend comparable time either way so timing does not reveal existence. */
      await hashPassword(body.password);
      return refuse('no such user');
    }
    if (user.disabledAt) return refuse('account disabled');
    if (user.lockedUntil && user.lockedUntil > new Date()) return refuse('account locked');

    const ok = await verifyPassword(body.password, user.passwordHash);
    if (!ok) {
      const failed = (user.failedLoginCount ?? 0) + 1;
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            failedLoginCount: failed,
            ...(failed >= LOCK_AFTER
              ? { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) }
              : {}),
          },
        },
      );
      return refuse('wrong password');
    }

    if (user.mfaEnabled) {
      if (!body.mfaToken) {
        return res.json({ mfaRequired: true, message: 'Please provide your authenticator code.' });
      }
      if (!user.mfaSecret) {
        return refuse('mfa configuration error');
      }
      const isValid = speakeasy.totp.verify({
        secret: user.mfaSecret,
        encoding: 'base32',
        token: body.mfaToken,
      });
      if (!isValid) {
        return refuse('wrong mfa code');
      }
    }

    await User.updateOne(
      { _id: user._id },
      { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } },
    );

    const session = await createSession(res, user, req);
    const membership = user.memberships[0];

    await record({
      req,
      action: 'auth.login',
      entity: 'Session',
      entityId: String(session._id),
      organisationId: membership?.organisationId ?? null,
      userId: user._id,
      userName: user.name,
    });

    res.json({
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        emailVerified: Boolean(user.emailVerifiedAt),
        role: membership?.role ?? null,
        capabilities: membership ? capabilitiesOf(membership.role) : [],
        organisationId: membership ? String(membership.organisationId) : null,
      },
    });
  }),
);

router.post(
  '/verify-email',
  credentialLimit,
  asyncRoute(async (req, res) => {
    const { token } = z.object({ token: z.string().min(10).max(200) }).parse(req.body);
    const user = await User.findOne({
      verificationTokenHash: hashToken(token),
      verificationExpiresAt: { $gt: new Date() },
    }).select('+verificationTokenHash +verificationExpiresAt');

    if (!user) throw ApiError.badRequest('That verification link has expired or has already been used.');

    user.emailVerifiedAt = new Date();
    user.verificationTokenHash = null;
    user.verificationExpiresAt = null;
    await user.save();

    await record({ req, action: 'auth.email.verified', entity: 'User', entityId: String(user._id), userId: user._id, userName: user.name });
    res.json({ verified: true });
  }),
);

router.post(
  '/forgot-password',
  credentialLimit,
  asyncRoute(async (req, res) => {
    const { email } = z.object({ email: z.string().email().max(254) }).parse(req.body);
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    if (user) {
      const token = generateToken();
      user.resetTokenHash = hashToken(token);
      user.resetExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();
      if (!isProduction) logger.info({ email, resetToken: token }, 'Password reset token issued');
    }

    /* Always the same answer, whether or not the address exists. */
    res.json({ sent: true, message: 'If that address has an account, a reset link is on its way.' });
  }),
);

router.post(
  '/reset-password',
  credentialLimit,
  asyncRoute(async (req, res) => {
    const body = z
      .object({ token: z.string().min(10).max(200), password: passwordRules })
      .parse(req.body);

    const user = await User.findOne({
      resetTokenHash: hashToken(body.token),
      resetExpiresAt: { $gt: new Date() },
    }).select('+resetTokenHash +resetExpiresAt');

    if (!user) throw ApiError.badRequest('That reset link has expired or has already been used.');

    user.passwordHash = await hashPassword(body.password);
    user.resetTokenHash = null;
    user.resetExpiresAt = null;
    user.failedLoginCount = 0;
    user.lockedUntil = null;
    await user.save();

    /* A password reset ends every existing session, everywhere. */
    const revoked = await revokeAllSessions(user._id);

    await record({
      req,
      action: 'auth.password.changed',
      entity: 'User',
      entityId: String(user._id),
      userId: user._id,
      userName: user.name,
      detail: { via: 'reset', sessionsRevoked: revoked },
    });

    res.json({ reset: true, sessionsRevoked: revoked });
  }),
);

/* ------------------------------------------------------- authenticated */

router.get(
  '/me',
  requireAuth,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const organisation = await Organisation.findById(ctx.organisationId).lean();
    res.json({
      user: {
        ...profileOf(ctx.user),
        role: ctx.role,
        capabilities: capabilitiesOf(ctx.role),
        careHomeIds: ctx.careHomeIds.map(String),
      },
      organisation: organisation ? organisationOf(organisation) : null,
    });
  }),
);

router.post(
  '/change-password',
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const body = z
      .object({ currentPassword: z.string().min(1).max(200), newPassword: passwordRules })
      .parse(req.body);

    const user = await User.findById(ctx.user._id).select('+passwordHash');
    if (!user) throw ApiError.unauthorised();

    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      await record({ req, action: 'auth.password.changed', outcome: 'denied', detail: { reason: 'wrong current password' } });
      throw ApiError.badRequest('Your current password is not correct.');
    }

    user.passwordHash = await hashPassword(body.newPassword);
    await user.save();

    /* Keep this session alive but give it a new id, and end all the others. */
    const session = await readSession(req);
    if (session) await rotateSession(res, session);
    const revoked = await Session.updateMany(
      { userId: user._id, revokedAt: null, _id: { $ne: session?._id } },
      { $set: { revokedAt: new Date() } },
    );

    await record({
      req,
      action: 'auth.password.changed',
      entity: 'User',
      entityId: String(user._id),
      detail: { via: 'change', sessionsRevoked: revoked.modifiedCount },
    });

    res.json({ changed: true, otherSessionsRevoked: revoked.modifiedCount });
  }),
);

router.post(
  '/logout',
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    const session = await readSession(req);
    if (session) await revokeSession(session);
    clearSessionCookies(res);
    await record({ req, action: 'auth.logout' });
    res.json({ ok: true });
  }),
);

router.post(
  '/logout-all',
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const revoked = await revokeAllSessions(ctx.user._id);
    clearSessionCookies(res);
    await record({ req, action: 'auth.logout.all', detail: { sessionsRevoked: revoked } });
    res.json({ ok: true, sessionsRevoked: revoked });
  }),
);

router.get(
  '/sessions',
  requireAuth,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const sessions = await Session.find({ userId: ctx.user._id, revokedAt: null })
      .select('userAgent ip createdAt lastSeenAt expiresAt')
      .sort({ lastSeenAt: -1 })
      .lean();
    res.json({
      sessions: sessions.map((s) => ({
        id: String(s._id),
        userAgent: s.userAgent,
        ip: s.ip,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        current: String(s._id) === String(ctx.sessionId),
      })),
    });
  }),
);

router.post(
  '/mfa/setup',
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const user = await User.findById(ctx.user._id).select('+mfaSecret');
    if (!user) throw ApiError.unauthorised();

    const secret = speakeasy.generateSecret({ name: `Symplicare AI (${user.email})` });
    user.mfaSecret = secret.base32;
    await user.save();

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url!);

    res.json({ secret: secret.base32, qrCodeUrl });
  }),
);

router.post(
  '/mfa/verify',
  requireAuth,
  requireCsrf,
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const body = z.object({ token: z.string().min(6).max(6) }).parse(req.body);

    const user = await User.findById(ctx.user._id).select('+mfaSecret');
    if (!user || !user.mfaSecret) throw ApiError.badRequest('MFA is not set up for this account.');

    const isValid = speakeasy.totp.verify({
      secret: user.mfaSecret,
      encoding: 'base32',
      token: body.token,
    });
    if (!isValid) throw ApiError.badRequest('Invalid MFA code.');

    user.mfaEnabled = true;
    await user.save();

    await record({
      req,
      action: 'auth.mfa.enabled',
      entity: 'User',
      entityId: String(user._id),
    });

    res.json({ verified: true });
  }),
);

export default router;
