import pino from 'pino';
import { env, isProduction, isTest } from './env.js';

/**
 * Structured logging. Sensitive fields are redacted at the logger rather than
 * left to each call site to remember — a password must not reach a log even
 * once, and "remember to omit it" is not a control.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'res.headers["set-cookie"]',
      'password',
      'currentPassword',
      'newPassword',
      'passwordHash',
      'token',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
  transport:
    isProduction || isTest
      ? undefined
      : { target: 'pino/file', options: { destination: 1 } },
});
