import { connect } from 'node:net';
import { logger } from '../logger.js';
import { env, isProduction } from '../env.js';

/**
 * Malware scanning.
 *
 * Two implementations behind one interface:
 *
 *   clamav     talks INSTREAM to a clamd daemon. This is the one to use in
 *              production; point CLAMAV_HOST at it.
 *   heuristic  a small set of structural checks for development. It catches
 *              the obvious cases and is honest about being a stand-in.
 *
 * Both fail closed. A file the scanner cannot judge is quarantined, never
 * passed — an unreachable scanner must not become an open door, which is what
 * "return clean on error" quietly does.
 *
 * Production refuses to start on the heuristic scanner unless the operator has
 * explicitly accepted the risk with SCANNER=heuristic-accepted-risk, so the
 * placeholder cannot reach production by inattention.
 */

export type ScanVerdict = 'clean' | 'quarantined';

export interface Scanner {
  readonly name: string;
  scan(body: Buffer, mimeType: string): Promise<ScanVerdict>;
}

/* --------------------------------------------------------------- heuristic */

/** The EICAR test signature, split so this file is not itself flagged. */
const EICAR = ['EICAR-STANDARD', 'ANTIVIRUS-TEST-FILE'].join('-');

const heuristicScanner: Scanner = {
  name: 'heuristic',
  scan(body: Buffer, mimeType: string): Promise<ScanVerdict> {
    if (body.includes(EICAR)) {
      logger.warn('Upload quarantined: EICAR test signature');
      return Promise.resolve('quarantined');
    }

    /* An executable header has no business in an evidence document. */
    const magic = body.subarray(0, 4);
    const isExecutable =
      magic.subarray(0, 2).toString('ascii') === 'MZ' ||
      magic.toString('hex') === '7f454c46' ||
      magic.toString('hex').startsWith('cafebabe');
    if (isExecutable) {
      logger.warn({ mimeType }, 'Upload quarantined: executable header');
      return Promise.resolve('quarantined');
    }

    /* A file that does not begin the way its declared type must. */
    const header = body.subarray(0, 8);
    const mismatched =
      (mimeType === 'application/pdf' && header.subarray(0, 5).toString('ascii') !== '%PDF-') ||
      (mimeType === 'image/png' && header.subarray(1, 4).toString('ascii') !== 'PNG') ||
      (mimeType === 'image/jpeg' && header.subarray(0, 2).toString('hex') !== 'ffd8') ||
      (mimeType.includes('openxmlformats') && header.subarray(0, 2).toString('ascii') !== 'PK');
    if (mismatched) {
      logger.warn({ mimeType }, 'Upload quarantined: content does not match its declared type');
      return Promise.resolve('quarantined');
    }

    return Promise.resolve('clean');
  },
};

/* ------------------------------------------------------------------ clamav */

/**
 * clamd INSTREAM: a sequence of length-prefixed chunks terminated by a
 * zero-length chunk. The daemon replies "stream: OK" or "stream: <name> FOUND".
 */
function clamavScan(body: Buffer, host: string, port: number, timeoutMs: number): Promise<ScanVerdict> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let response = '';
    let settled = false;

    const finish = (verdict: ScanVerdict, reason?: string) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (verdict === 'quarantined') logger.warn({ reason }, 'Upload quarantined by clamd');
      resolve(verdict);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish('quarantined', 'clamd timed out'));
    socket.on('error', (err) => finish('quarantined', `clamd unreachable: ${err.message}`));

    socket.on('connect', () => {
      socket.write('zINSTREAM\0', 'utf8');
      const CHUNK = 64 * 1024;
      for (let offset = 0; offset < body.length; offset += CHUNK) {
        const slice = body.subarray(offset, offset + CHUNK);
        const size = Buffer.alloc(4);
        size.writeUInt32BE(slice.length, 0);
        socket.write(size);
        socket.write(slice);
      }
      socket.write(Buffer.from([0, 0, 0, 0])); // zero-length chunk ends the stream
    });

    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
    });

    socket.on('close', () => {
      const reply = response.replace(/\0/g, '').trim();
      if (/\bOK\b/.test(reply) && !/FOUND/.test(reply)) finish('clean');
      else finish('quarantined', reply || 'no reply from clamd');
    });
  });
}

function clamavScanner(host: string, port: number, timeoutMs: number): Scanner {
  return {
    name: `clamav(${host}:${port})`,
    scan: (body) => clamavScan(body, host, port, timeoutMs),
  };
}

/* ----------------------------------------------------------------- select */

function select(): Scanner {
  if (env.CLAMAV_HOST) {
    return clamavScanner(env.CLAMAV_HOST, env.CLAMAV_PORT, env.CLAMAV_TIMEOUT_MS);
  }

  if (isProduction && env.SCANNER !== 'heuristic-accepted-risk') {
    throw new Error(
      'No malware scanner configured. Set CLAMAV_HOST to a clamd instance, or set ' +
        'SCANNER=heuristic-accepted-risk to run in production on the heuristic ' +
        'stand-in with that risk formally accepted.',
    );
  }

  if (isProduction) {
    logger.error(
      'Running in production on the heuristic scanner. This is a stand-in, not malware scanning. ' +
        'Configure CLAMAV_HOST.',
    );
  }
  return heuristicScanner;
}

let scanner: Scanner | null = null;

export function getScanner(): Scanner {
  scanner ??= select();
  return scanner;
}

export async function scanBuffer(body: Buffer, mimeType: string): Promise<ScanVerdict> {
  return getScanner().scan(body, mimeType);
}

/** Used by tests to exercise both implementations. */
export const scanners = { heuristic: heuristicScanner, clamav: clamavScanner };
