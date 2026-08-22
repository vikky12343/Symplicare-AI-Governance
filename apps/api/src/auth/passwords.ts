import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from the Node standard library.
 *
 * scrypt is memory-hard and needs no native module, so there is nothing to
 * compile and nothing to go stale. Parameters are stored inside the hash so
 * they can be raised later without invalidating existing passwords.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 };
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  const derived = await scryptAsync(password.normalize('NFKC'), salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 128 * Number(n) * Number(r) * 2,
  });
  /* Constant-time compare so a wrong password cannot be found by timing. */
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Opaque token for sessions, email verification and password reset. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Only the hash of a token is stored. A leaked database therefore cannot be
 * replayed as a live session or a valid reset link.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function checksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
