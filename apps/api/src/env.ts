import 'dotenv/config';
import { z } from 'zod';

/**
 * Configuration is validated at boot. A misconfigured secret should stop the
 * process, not surface later as a silently insecure session.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  /** Leave unset to run against an in-process MongoDB (development and test only). */
  MONGODB_URI: z.string().min(1).optional(),
  MONGODB_DB: z.string().default('care_governance'),

  /** Signs session cookies. Must be supplied in production. */
  SESSION_SECRET: z.string().min(32).optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(12),

  WEB_ORIGIN: z.string().default('http://localhost:5173'),

  /** Uploads. The ceiling is enforced before the file is parsed. */
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  /** Malware scanning. Set CLAMAV_HOST to a clamd instance for production. */
  CLAMAV_HOST: z.string().min(1).optional(),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
  CLAMAV_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  SCANNER: z.enum(['clamav', 'heuristic', 'heuristic-accepted-risk']).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/**
 * An empty variable means "not set". Writing `MONGODB_URI=` in a .env file to
 * blank it is common, and it should behave the same as omitting the line.
 */
const supplied = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''),
);

const parsed = schema.safeParse(supplied);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

if (isProduction) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
  if (!env.MONGODB_URI) throw new Error('MONGODB_URI is required in production');
}

/** Development falls back to an ephemeral secret so nothing is committed. */
export const sessionSecret =
  env.SESSION_SECRET ?? 'development-only-secret-do-not-use-in-production-0000';
