import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Session, type SessionDoc, type UserDoc } from '../models/index.js';
import { generateToken, hashToken } from './passwords.js';
import { env, isProduction } from '../env.js';

export const SESSION_COOKIE = 'cgi_session';
export const CSRF_COOKIE = 'cgi_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function ttlMs(): number {
  return env.SESSION_TTL_HOURS * 60 * 60 * 1000;
}

/**
 * Sessions live in the database, not in a self-contained token.
 *
 * That is a deliberate trade: it costs a lookup per request, and in exchange a
 * revoked session, a disabled user or a changed role takes effect on the next
 * request rather than whenever a token happens to expire. "Log out everywhere"
 * is not implementable against stateless tokens.
 */
export async function createSession(
  res: Response,
  user: UserDoc,
  req: Request,
): Promise<SessionDoc> {
  const token = generateToken();
  const csrfToken = generateToken(24);

  const session = await Session.create({
    userId: user._id,
    tokenHash: hashToken(token),
    csrfToken,
    userAgent: String(req.get('user-agent') ?? '').slice(0, 400),
    ip: clientIp(req),
    expiresAt: new Date(Date.now() + ttlMs()),
  });

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: ttlMs(),
  });
  /* Readable by the client so it can echo it back — the double-submit half of
     the CSRF defence. The session cookie itself stays httpOnly. */
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: ttlMs(),
  });

  return session;
}

export async function readSession(req: Request): Promise<SessionDoc | null> {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (typeof raw !== 'string' || raw.length === 0) return null;

  const session = await Session.findOne({
    tokenHash: hashToken(raw),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  return session;
}

/**
 * Rotating the token on privilege changes means a session id captured earlier
 * cannot be reused afterwards.
 */
export async function rotateSession(res: Response, session: SessionDoc): Promise<void> {
  const token = generateToken();
  session.tokenHash = hashToken(token);
  session.expiresAt = new Date(Date.now() + ttlMs());
  await session.save();

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: ttlMs(),
  });
}

export async function revokeSession(session: SessionDoc): Promise<void> {
  session.revokedAt = new Date();
  await session.save();
}

/** Log out everywhere. */
export async function revokeAllSessions(userId: Types.ObjectId): Promise<number> {
  const result = await Session.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  return result.modifiedCount;
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(CSRF_COOKIE, { path: '/' });
}

export function clientIp(req: Request): string {
  return String(req.ip ?? req.socket.remoteAddress ?? '').slice(0, 64);
}
