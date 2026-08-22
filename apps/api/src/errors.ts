import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from './logger.js';
import { isProduction } from './env.js';

/**
 * Errors that reach the client say what went wrong and what to do about it,
 * and nothing more. Stack traces, driver messages and query shapes stay on the
 * server.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, 'bad_request', message, details);
  }
  static unauthorised(message = 'Sign in to continue.'): ApiError {
    return new ApiError(401, 'unauthorised', message);
  }
  static forbidden(message = 'You do not have access to this.'): ApiError {
    return new ApiError(403, 'forbidden', message);
  }
  static notFound(message = 'Not found.'): ApiError {
    return new ApiError(404, 'not_found', message);
  }
  /**
   * A home that exists but has nothing filed against it yet.
   *
   * Distinct from `not_found` on purpose: a new home with no data is the
   * expected state of every workspace on its first day, and the client should
   * be able to tell that apart from something having gone wrong.
   */
  static noData(message = 'No data has been submitted for this care home yet.'): ApiError {
    return new ApiError(404, 'no_data', message);
  }
  static conflict(message: string, details?: unknown): ApiError {
    return new ApiError(409, 'conflict', message, details);
  }
  static tooLarge(message: string): ApiError {
    return new ApiError(413, 'payload_too_large', message);
  }
  static tooMany(message = 'Too many requests. Try again shortly.'): ApiError {
    return new ApiError(429, 'rate_limited', message);
  }
}

export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound('No such endpoint.'));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  /* Validation failures are the client's to fix, so they come back field by field. */
  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_failed',
        message: 'Some fields need attention.',
        fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
    return;
  }

  if (err instanceof ApiError) {
    if (err.status >= 500) logger.error({ err, path: req.path }, 'Request failed');
    else logger.debug({ code: err.code, path: req.path }, err.message);
    res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
    return;
  }

  /* Duplicate key: say what clashed, not which index caught it. */
  if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
    res.status(409).json({
      error: { code: 'conflict', message: 'That record already exists.' },
    });
    return;
  }

  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'internal_error',
      message: 'Something went wrong at our end. The failure has been logged.',
      ...(isProduction ? {} : { hint: err instanceof Error ? err.message : String(err) }),
    },
  });
}

/** Wraps an async handler so a rejected promise reaches the error handler. */
export function asyncRoute<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, next).catch(next);
  };
}
