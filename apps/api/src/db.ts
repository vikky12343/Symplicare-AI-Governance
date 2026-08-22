import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { env, isProduction, isTest } from './env.js';
import { logger } from './logger.js';

/**
 * Database connection.
 *
 * When MONGODB_URI is not set outside production, an in-process MongoDB is
 * started so the platform runs with no infrastructure at all. Production
 * refuses to do this — see env.ts.
 */

let memoryServer: { stop: () => Promise<unknown> } | null = null;

export async function connectDatabase(uriOverride?: string): Promise<string> {
  let uri = uriOverride ?? env.MONGODB_URI;

  if (!uri) {
    if (isProduction) throw new Error('MONGODB_URI is required in production');
    const { MongoMemoryServer } = await import('mongodb-memory-server');

    /* Outside tests the data directory persists, so `seed` followed by `dev`
       behaves the way a real database would. Tests get a throwaway instance. */
    const persist = !isTest;
    const dbPath = resolve(process.cwd(), '.mongo-data');
    if (persist) await mkdir(dbPath, { recursive: true });

    const server = await MongoMemoryServer.create(
      persist ? { instance: { dbPath, storageEngine: 'wiredTiger' } } : undefined,
    );
    memoryServer = server;
    uri = server.getUri();
    logger.warn(
      { uri, persisted: persist },
      persist
        ? 'No MONGODB_URI set — started an in-process MongoDB storing data in .mongo-data. Set MONGODB_URI for a real deployment.'
        : 'No MONGODB_URI set — started a throwaway in-process MongoDB.',
    );
  }

  mongoose.set('strictQuery', true);
  /* Fail fast rather than buffering commands against a database that is not there. */
  mongoose.set('bufferCommands', false);

  await mongoose.connect(uri, {
    dbName: env.MONGODB_DB,
    serverSelectionTimeoutMS: 10_000,
    autoIndex: !isProduction,
  });

  logger.info({ db: env.MONGODB_DB }, 'Connected to MongoDB');
  return uri;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}

/** Indexes are created explicitly in production rather than on every boot. */
export async function syncIndexes(): Promise<void> {
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  logger.info('Indexes synchronised');
}
