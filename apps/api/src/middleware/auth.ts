import type { NextFunction, Request, Response } from 'express';
import { Types } from 'mongoose';
import { CareHome, Session, User, type CareHomeDoc, type Role, type UserDoc } from '../models/index.js';
import { CSRF_HEADER, readSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { can, type Capability } from './capabilities.js';

/**
 * Request context.
 *
 * Everything downstream reads the tenant from here and never from a parameter
 * the client supplied. An organisation id in a request body is data; the one on
 * this object is the only one that authorises anything.
 */
export interface AuthContext {
  user: UserDoc;
  sessionId: Types.ObjectId;
  organisationId: Types.ObjectId;
  role: Role;
  /** Empty means every home in the organisation. */
  careHomeIds: Types.ObjectId[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
      careHome?: CareHomeDoc;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await readSession(req);
    if (!session) throw ApiError.unauthorised('Sign in to continue.');

    const user = await User.findById(session.userId);
    if (!user) throw ApiError.unauthorised('Sign in to continue.');
    if (user.disabledAt) throw ApiError.forbidden('This account has been disabled.');

    const membership = user.memberships[0];
    if (!membership) throw ApiError.forbidden('This account is not a member of any organisation.');

    /* Touch last-seen at most once a minute — a read per request is fine, a
       write per request is not. */
    if (Date.now() - new Date(session.lastSeenAt).getTime() > 60_000) {
      await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date() } });
    }

    req.auth = {
      user,
      sessionId: session._id,
      organisationId: membership.organisationId,
      role: membership.role,
      careHomeIds: membership.careHomeIds ?? [],
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Double-submit CSRF check on every state-changing request. The cookie is
 * SameSite=strict as well, so this is the second of two independent defences.
 */
export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const header = req.get(CSRF_HEADER);
  const cookie = req.cookies?.cgi_csrf;
  if (!header || !cookie || header !== cookie) {
    return next(ApiError.forbidden('This request could not be verified. Refresh the page and try again.'));
  }
  next();
}

export function auth(req: Request): AuthContext {
  if (!req.auth) throw ApiError.unauthorised('Sign in to continue.');
  return req.auth;
}

/** Vertical access control: does this role hold the capability at all? */
export function requireCapability(capability: Capability) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = req.auth;
    if (!ctx) return next(ApiError.unauthorised('Sign in to continue.'));
    if (!can(ctx.role, capability)) {
      return next(ApiError.forbidden(`Your role (${ctx.role}) cannot ${describe(capability)}.`));
    }
    next();
  };
}

function describe(capability: Capability): string {
  return capability.replace(/([A-Z])/g, ' $1').toLowerCase();
}

/**
 * Horizontal access control: resolve `:careHomeId` and prove it belongs to the
 * caller's organisation *and* to the caller's own set of homes.
 *
 * This is the check that stops one organisation reading another's data by
 * guessing an id, so it loads the home by id **and** organisation together
 * rather than loading it first and comparing afterwards.
 */
export async function resolveCareHome(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const ctx = auth(req);
    const raw = req.params.careHomeId ?? req.query.careHomeId;
    if (typeof raw !== 'string' || !Types.ObjectId.isValid(raw)) {
      throw ApiError.badRequest('A valid care home id is required.');
    }

    const careHome = await CareHome.findOne({
      _id: new Types.ObjectId(raw),
      organisationId: ctx.organisationId,
      archivedAt: null,
    });
    /* Not found and not yours are answered identically, so the response cannot
       be used to discover which ids exist in other organisations. */
    if (!careHome) throw ApiError.notFound('Care home not found.');

    if (ctx.careHomeIds.length > 0 && !ctx.careHomeIds.some((id) => id.equals(careHome._id))) {
      throw ApiError.notFound('Care home not found.');
    }

    req.careHome = careHome;
    next();
  } catch (err) {
    next(err);
  }
}

export function careHome(req: Request): CareHomeDoc {
  if (!req.careHome) throw ApiError.badRequest('A care home is required for this request.');
  return req.careHome;
}

/** The homes this caller may see, as a query filter fragment. */
export function homeScope(ctx: AuthContext): Record<string, unknown> {
  return ctx.careHomeIds.length > 0
    ? { organisationId: ctx.organisationId, careHomeId: { $in: ctx.careHomeIds } }
    : { organisationId: ctx.organisationId };
}
