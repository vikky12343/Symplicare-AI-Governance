import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  CareHome,
  MANAGER_ROLES,
  ORGANISATION_TYPES,
  Organisation,
  type UserDoc,
} from '../models/index.js';
import { auth, requireCapability } from '../middleware/auth.js';
import { capabilitiesOf } from '../middleware/capabilities.js';
import { ApiError, asyncRoute } from '../errors.js';
import { readObject, storeObject } from '../services/storage.js';
import { record } from '../services/audit.js';

/**
 * The manager's own account: their profile, their photograph, and how far they
 * have got through first-time setup.
 *
 * Onboarding and the profile are the same fields reached two different ways.
 * Setup is a one-time guided pass over them; the profile page is the permanent
 * home for the same data, so nobody is ever sent back through setup to change
 * a phone number.
 */

const router = Router();

/* ------------------------------------------------------------------ photo */

const AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AVATAR_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (AVATAR_TYPES[file.mimetype]) return cb(null, true);
    cb(new ApiError(415, 'unsupported_media_type', 'Use a JPG, PNG or WebP image.'));
  },
});

/**
 * The magic numbers for the formats we accept. A browser can be told to send
 * any content type it likes, so the bytes are what decide.
 */
function sniff(body: Buffer): string | null {
  if (body.length > 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff) return 'jpg';
  if (body.length > 8 && body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'png';
  }
  if (
    body.length > 12 &&
    body.subarray(0, 4).toString('ascii') === 'RIFF' &&
    body.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

const MIME_OF: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** What the client needs to render an avatar without another round trip. */
export function avatarUrlOf(user: UserDoc): string | null {
  if (!user.avatarKey) return null;
  /* The timestamp busts the browser cache the moment the photo changes, so a
     new picture never shows up as the old one. */
  const stamp = user.avatarUpdatedAt ? new Date(user.avatarUpdatedAt).getTime() : 0;
  return `/api/profile/photo?v=${stamp}`;
}

export function profileOf(user: UserDoc) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    phone: user.phone ?? '',
    jobTitle: user.jobTitle ?? '',
    managerRole: user.managerRole ?? null,
    avatarUrl: avatarUrlOf(user),
    emailVerified: Boolean(user.emailVerifiedAt),
    mfaEnabled: Boolean(user.mfaEnabled),
    onboarding: {
      completed: Boolean(user.onboarding?.completed),
      step: user.onboarding?.step ?? 1,
    },
  };
}

/** Keeps `name` — which every other screen and audit entry reads — in step. */
function displayName(user: UserDoc): string {
  const joined = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return joined || user.name;
}

router.get('/', (req, res) => {
  const ctx = auth(req);
  res.json({
    profile: profileOf(ctx.user),
    role: ctx.role,
    capabilities: capabilitiesOf(ctx.role),
  });
});

const profileSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name.').max(100),
  lastName: z.string().trim().min(1, 'Enter your last name.').max(100),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  jobTitle: z.string().trim().max(120).optional().or(z.literal('')),
  managerRole: z.enum(MANAGER_ROLES).optional().nullable(),
});

router.patch(
  '/',
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const body = profileSchema.parse(req.body);

    ctx.user.firstName = body.firstName;
    ctx.user.lastName = body.lastName;
    ctx.user.phone = body.phone ?? '';
    ctx.user.jobTitle = body.jobTitle ?? '';
    if (body.managerRole !== undefined) ctx.user.managerRole = body.managerRole;
    ctx.user.name = displayName(ctx.user);
    await ctx.user.save();

    await record({
      req,
      action: 'profile.updated',
      entity: 'User',
      entityId: String(ctx.user._id),
      detail: { name: ctx.user.name },
    });

    res.json({ profile: profileOf(ctx.user) });
  }),
);

router.get(
  '/photo',
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    if (!ctx.user.avatarKey) throw ApiError.notFound('No profile photo.');

    const body = await readObject(ctx.user.avatarKey);
    if (!body) throw ApiError.notFound('No profile photo.');

    const ext = ctx.user.avatarKey.split('.').pop() ?? 'jpg';
    res.setHeader('Content-Type', MIME_OF[ext] ?? 'application/octet-stream');
    /* Private: this is one person's photograph, not a shared asset. The URL
       carries a version stamp, so a long max-age is still safe. */
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(body);
  }),
);

router.post(
  '/photo',
  avatarUpload.single('photo'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    if (!req.file) throw ApiError.badRequest('Attach an image to upload.');

    const kind = sniff(req.file.buffer);
    if (!kind) throw ApiError.badRequest('That file is not a JPG, PNG or WebP image.');

    /* A fresh key each time. The previous object is left in place rather than
       deleted under a request that might still be serving it. */
    const key = `avatars/${String(ctx.user._id)}/${Date.now()}.${kind}`;
    await storeObject(key, req.file.buffer);

    ctx.user.avatarKey = key;
    ctx.user.avatarUpdatedAt = new Date();
    await ctx.user.save();

    await record({ req, action: 'profile.updated', entity: 'User', entityId: String(ctx.user._id), detail: { photo: 'set' } });

    res.status(201).json({ profile: profileOf(ctx.user) });
  }),
);

router.delete(
  '/photo',
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    ctx.user.avatarKey = null;
    ctx.user.avatarUpdatedAt = new Date();
    await ctx.user.save();

    await record({ req, action: 'profile.updated', entity: 'User', entityId: String(ctx.user._id), detail: { photo: 'removed' } });

    res.json({ profile: profileOf(ctx.user) });
  }),
);

/* ----------------------------------------------------------- organisation */

router.patch(
  '/organisation',
  requireCapability('manageSettings'),
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const body = z
      .object({
        name: z.string().trim().min(2, 'Enter your organisation name.').max(200),
        type: z.enum(ORGANISATION_TYPES).optional(),
        addressLine1: z.string().trim().max(200).optional().or(z.literal('')),
        addressLine2: z.string().trim().max(200).optional().or(z.literal('')),
        town: z.string().trim().max(120).optional().or(z.literal('')),
        county: z.string().trim().max(120).optional().or(z.literal('')),
        postcode: z.string().trim().max(16).optional().or(z.literal('')),
      })
      .parse(req.body);

    const organisation = await Organisation.findById(ctx.organisationId);
    if (!organisation) throw ApiError.notFound('Organisation not found.');

    Object.assign(organisation, body);
    await organisation.save();

    await record({
      req,
      action: 'settings.updated',
      entity: 'Organisation',
      entityId: String(organisation._id),
      detail: { name: organisation.name },
    });

    res.json({ organisation: organisationOf(organisation) });
  }),
);

export function organisationOf(o: {
  _id: unknown;
  name: string;
  type?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  town?: string | null;
  county?: string | null;
  postcode?: string | null;
  reportingCycle?: string | null;
}) {
  return {
    id: String(o._id),
    name: o.name,
    type: o.type ?? 'Care Provider',
    addressLine1: o.addressLine1 ?? '',
    addressLine2: o.addressLine2 ?? '',
    town: o.town ?? '',
    county: o.county ?? '',
    postcode: o.postcode ?? '',
    reportingCycle: o.reportingCycle ?? 'Calendar month',
  };
}

/* ------------------------------------------------------------- onboarding */

/**
 * Setup progress is stored on the user, not in the browser, so closing the tab
 * loses nothing. Each step's data is saved by the endpoint that owns it — the
 * profile by PATCH /profile, the organisation by PATCH /profile/organisation,
 * the homes by POST /care-homes — and this only records how far they got.
 */
router.patch(
  '/onboarding',
  asyncRoute(async (req, res) => {
    const ctx = auth(req);
    const body = z.object({ step: z.number().int().min(1).max(5) }).parse(req.body);

    if (!ctx.user.onboarding?.completed) {
      ctx.user.set('onboarding.step', Math.max(body.step, ctx.user.onboarding?.step ?? 1));
      await ctx.user.save();
    }
    res.json({ onboarding: profileOf(ctx.user).onboarding });
  }),
);

router.post(
  '/onboarding/complete',
  asyncRoute(async (req, res) => {
    const ctx = auth(req);

    /* Completion is a claim about the state of the workspace, so it is checked
       against the workspace rather than trusted from the client. A half-set-up
       account sent to the dashboard is worse than one more step. */
    const missing: string[] = [];
    if (!ctx.user.firstName || !ctx.user.lastName) missing.push('your name');

    const organisation = await Organisation.findById(ctx.organisationId).lean();
    if (!organisation?.name) missing.push('your organisation');

    const homes = await CareHome.countDocuments({ organisationId: ctx.organisationId, archivedAt: null });
    if (homes === 0) missing.push('at least one care home');

    if (missing.length > 0) {
      throw ApiError.badRequest(`Setup is not finished yet — we still need ${missing.join(', ')}.`);
    }

    ctx.user.set('onboarding.completed', true);
    ctx.user.set('onboarding.completedAt', new Date());
    ctx.user.set('onboarding.step', 5);
    await ctx.user.save();

    await record({
      req,
      action: 'profile.updated',
      entity: 'User',
      entityId: String(ctx.user._id),
      detail: { onboarding: 'completed', careHomes: homes },
    });

    res.json({ profile: profileOf(ctx.user) });
  }),
);

export default router;
