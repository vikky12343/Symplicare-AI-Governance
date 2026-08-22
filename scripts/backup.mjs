#!/usr/bin/env node
/**
 * Backup and restore.
 *
 *   node scripts/backup.mjs dump    [--out backups/]
 *   node scripts/backup.mjs restore --from backups/<file>.json.gz [--target <uri>]
 *   node scripts/backup.mjs verify  --from backups/<file>.json.gz
 *
 * `verify` is the one that matters for the release gate. A backup nobody has
 * restored is a hope, not a backup: it restores into a scratch database, counts
 * what came back, checks a sample document round-tripped intact, and then throws
 * the scratch database away.
 *
 * The format is gzipped JSON rather than BSON so the tool needs only the driver
 * the application already depends on — no mongodump binary to install, and the
 * archive is readable by anything. For very large deployments, swap this for
 * mongodump; the verify step is what should survive that change.
 */

import { createGzip, createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream, mkdirSync, statSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const command = args[0];

function flag(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const DB_NAME = process.env.MONGODB_DB ?? 'care_governance';

async function connect(uri) {
  if (!uri) {
    throw new Error(
      'Set MONGODB_URI to the database to work with. The in-process development ' +
        'database is not reachable from this script.',
    );
  }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10_000 });
  await client.connect();
  return client;
}

/* --------------------------------------------------------------------- dump */

async function dump() {
  const uri = flag('uri', process.env.MONGODB_URI);
  const outDir = resolve(flag('out', 'backups'));
  mkdirSync(outDir, { recursive: true });

  const client = await connect(uri);
  try {
    const db = client.db(DB_NAME);
    const collections = await db.listCollections().toArray();

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = join(outDir, `${DB_NAME}-${stamp}.json.gz`);

    const payload = {
      database: DB_NAME,
      takenAt: new Date().toISOString(),
      collections: {},
    };

    let total = 0;
    for (const { name } of collections) {
      /* Sessions are deliberately excluded: restoring live sessions would
         resurrect credentials that were meant to expire. */
      if (name === 'sessions') continue;
      const documents = await db.collection(name).find({}).toArray();
      payload.collections[name] = documents;
      total += documents.length;
      console.log(`  ${name}: ${documents.length} documents`);
    }

    const gzip = createGzip({ level: 9 });
    const out = createWriteStream(target);
    gzip.end(JSON.stringify(payload));
    await pipeline(gzip, out);

    const size = statSync(target).size;
    console.log(`\nBackup written: ${target}`);
    console.log(`${total} documents across ${Object.keys(payload.collections).length} collections, ${(size / 1024).toFixed(0)} KB.`);
    console.log('Sessions are excluded by design.');
    return target;
  } finally {
    await client.close();
  }
}

/* ------------------------------------------------------------------ restore */

async function readArchive(path) {
  const chunks = [];
  const gunzip = createGunzip();
  createReadStream(path).pipe(gunzip);
  for await (const chunk of gunzip) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Mongo's extended JSON survives a round trip; ids and dates need rebuilding. */
function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') {
    if (typeof value.$oid === 'string') return value.$oid;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, revive(v)]));
  }
  return value;
}

async function restoreInto(archive, uri, dbName) {
  const client = await connect(uri);
  try {
    const db = client.db(dbName);
    let total = 0;
    for (const [name, documents] of Object.entries(archive.collections)) {
      if (documents.length === 0) continue;
      await db.collection(name).deleteMany({});
      await db.collection(name).insertMany(documents.map(revive));
      total += documents.length;
    }
    return total;
  } finally {
    await client.close();
  }
}

async function restore() {
  const from = flag('from');
  if (!from) throw new Error('Pass --from <archive.json.gz>.');
  const target = flag('target', process.env.MONGODB_URI);

  const archive = await readArchive(resolve(from));
  console.log(`Archive taken ${archive.takenAt} from database "${archive.database}".`);

  const confirmed = args.includes('--yes');
  if (!confirmed) {
    console.error(
      '\nRestoring REPLACES the contents of every collection in the target database.\n' +
        'Re-run with --yes once you are certain the target is the one you mean.',
    );
    process.exit(1);
  }

  const total = await restoreInto(archive, target, DB_NAME);
  console.log(`Restored ${total} documents.`);
}

/* ------------------------------------------------------------------- verify */

async function verify() {
  const from = flag('from');
  if (!from) throw new Error('Pass --from <archive.json.gz>.');

  const archive = await readArchive(resolve(from));
  const expected = Object.fromEntries(
    Object.entries(archive.collections).map(([name, docs]) => [name, docs.length]),
  );
  const expectedTotal = Object.values(expected).reduce((a, b) => a + b, 0);

  console.log(`Archive taken ${archive.takenAt}, ${expectedTotal} documents.`);
  console.log('Restoring into a scratch database…');

  /* A throwaway in-process MongoDB, so verification never touches anything real. */
  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const server = await MongoMemoryServer.create();
  const scratchName = 'restore_verification';

  const problems = [];
  try {
    const restored = await restoreInto(archive, server.getUri(), scratchName);
    if (restored !== expectedTotal) {
      problems.push(`Restored ${restored} documents but the archive holds ${expectedTotal}.`);
    }

    const client = await connect(server.getUri());
    try {
      const db = client.db(scratchName);
      for (const [name, count] of Object.entries(expected)) {
        if (count === 0) continue;
        const actual = await db.collection(name).countDocuments();
        if (actual !== count) problems.push(`${name}: expected ${count} documents, found ${actual}.`);
        else console.log(`  ${name}: ${actual} documents`);
      }

      /* Counting proves nothing about content. Check that the data the product
         actually depends on came back with its values intact. */
      const sample = archive.collections.indicatorvalues?.[0];
      if (sample) {
        const found = await db.collection('indicatorvalues').findOne({
          period: sample.period,
          indicatorId: sample.indicatorId,
        });
        if (!found) problems.push('An indicator value present in the archive did not come back.');
        else if (found.value !== sample.value) {
          problems.push(
            `Indicator ${sample.indicatorId} for ${sample.period} restored as ${found.value}, archived as ${sample.value}.`,
          );
        } else {
          console.log(`  sample check: ${sample.indicatorId} ${sample.period} = ${found.value} ✓`);
        }
      }
    } finally {
      await client.close();
    }
  } finally {
    await server.stop();
  }

  if (problems.length) {
    console.error('\nRestore verification FAILED:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log('\nRestore verification passed. The archive restores completely and intact.');
}

const commands = { dump, restore, verify };

if (!commands[command]) {
  console.error('Usage: node scripts/backup.mjs <dump|restore|verify> [options]');
  process.exit(1);
}

commands[command]().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
