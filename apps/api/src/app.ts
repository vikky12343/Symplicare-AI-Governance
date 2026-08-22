import express, { type Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { rateLimit } from 'express-rate-limit';
import { env, isProduction, isTest } from './env.js';
import { logger } from './logger.js';
import { errorHandler, notFoundHandler } from './errors.js';
import { requireAuth, requireCsrf } from './middleware/auth.js';

import authRoutes from './routes/auth.js';
import homeRoutes from './routes/homes.js';
import profileRoutes from './routes/profile.js';
import overviewRoutes from './routes/overview.js';
import indicatorRoutes from './routes/indicators.js';
import analyticsRoutes from './routes/analytics.js';
import datasetRoutes from './routes/datasets.js';
import actionRoutes from './routes/actions.js';
import reportRoutes from './routes/reports.js';
import evidenceRoutes from './routes/evidence.js';
import adminRoutes from './routes/admin.js';

/**
 * The Express application.
 *
 * Exported as a factory so tests can build one against a throwaway database
 * without starting a listener.
 */
export function createApp(): Express {
  const app = express();

  /* Behind a proxy, req.ip must come from the forwarded header or the rate
     limiter buckets every user together. One hop, not blind trust. */
  app.set('trust proxy', isProduction ? 1 : false);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      /* The API serves JSON and file downloads to a separate origin. */
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );

  app.use(
    cors({
      origin: env.WEB_ORIGIN.split(',').map((o) => o.trim()),
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      maxAge: 600,
    }),
  );

  if (!isTest) {
    app.use(pinoHttp({ logger, autoLogging: { ignore: (req: { url?: string }) => req.url === '/api/health' } }));
  }

  /* Request bodies are small by design; uploads go through multer with its own
     ceiling rather than through the JSON parser. */
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());

  const general = rateLimit({
    windowMs: 60_000,
    limit: isTest ? 100_000 : 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: { code: 'rate_limited', message: 'Too many requests. Try again shortly.' } },
  });
  app.use('/api', general);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'care-governance-api', time: new Date().toISOString() });
  });

  /* Public: sign up, sign in, verify. Rate limited harder inside the router. */
  app.use('/api/auth', authRoutes);

  /* Everything below requires a session and a CSRF token on writes. */
  app.use('/api', requireAuth, requireCsrf);
  app.use('/api/indicators', indicatorRoutes);
  app.use('/api/care-homes', homeRoutes);
  app.use('/api/care-homes', analyticsRoutes);
  app.use('/api/care-homes', datasetRoutes);
  app.use('/api/care-homes', actionRoutes);
  app.use('/api/care-homes', reportRoutes);
  app.use('/api/care-homes', evidenceRoutes);
  app.use('/api/overview', overviewRoutes);
  app.use('/api/profile', profileRoutes);
  app.use('/api/admin', adminRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
