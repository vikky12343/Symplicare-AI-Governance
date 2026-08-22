import { createServer, type Server, type Socket } from 'node:net';

/**
 * `net.Server.close()` waits for every connection to end, and a server that
 * never reads or ends its side keeps its half open forever. Tests therefore
 * track their sockets and tear them down explicitly.
 */
function trackedServer(onConnection: (socket: Socket) => void): {
  server: Server;
  shutdown: () => Promise<void>;
} {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    onConnection(socket);
  });
  return {
    server,
    shutdown: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scanners } from '../src/services/scanner.js';

/**
 * The scanner's contract is that it fails closed. Every path that cannot
 * positively establish a file is clean must quarantine it — an unreachable
 * scanner is the case most likely to go wrong in production, and the one where
 * "assume clean" would silently open the door.
 */

const EICAR = Buffer.from(
  `X5O!P%@AP[4\\PZX54(P^)7CC)7}${['EICAR-STANDARD', 'ANTIVIRUS-TEST-FILE'].join('-')}!$H+H*`,
);
const CLEAN_PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64, 0x20)]);

describe('heuristic scanner', () => {
  const scanner = scanners.heuristic;

  it('passes a file that matches its declared type', async () => {
    await expect(scanner.scan(CLEAN_PDF, 'application/pdf')).resolves.toBe('clean');
  });

  it('quarantines a known test signature', async () => {
    await expect(scanner.scan(EICAR, 'text/csv')).resolves.toBe('quarantined');
  });

  it('quarantines a Windows executable', async () => {
    await expect(scanner.scan(Buffer.from([0x4d, 0x5a, 0x90, 0x00]), 'text/csv')).resolves.toBe('quarantined');
  });

  it('quarantines an ELF binary', async () => {
    await expect(scanner.scan(Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'text/csv')).resolves.toBe('quarantined');
  });

  it('quarantines a file that lies about its type', async () => {
    const cases: [string, Buffer][] = [
      ['application/pdf', Buffer.from('not really a pdf at all')],
      ['image/png', Buffer.from('still not a png')],
      ['image/jpeg', Buffer.from('nor a jpeg')],
      [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        Buffer.from('definitely not a zip container'),
      ],
    ];
    for (const [mimeType, body] of cases) {
      await expect(scanner.scan(body, mimeType), mimeType).resolves.toBe('quarantined');
    }
  });
});

describe('clamav scanner', () => {
  let server: Server;
  let shutdown: () => Promise<void>;
  let port: number;
  let reply = 'stream: OK\0';

  beforeAll(async () => {
    /* A stand-in clamd that speaks just enough of the INSTREAM protocol. */
    ({ server, shutdown } = trackedServer((socket) => {
      socket.on('data', (chunk) => {
        /* The client ends the stream with a zero-length chunk. */
        if (chunk.length >= 4 && chunk.subarray(chunk.length - 4).equals(Buffer.alloc(4))) {
          socket.end(reply);
        }
      });
    }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await shutdown();
  });

  it('passes a file clamd reports as OK', async () => {
    reply = 'stream: OK\0';
    const scanner = scanners.clamav('127.0.0.1', port, 5000);
    await expect(scanner.scan(CLEAN_PDF, 'application/pdf')).resolves.toBe('clean');
  });

  it('quarantines a file clamd reports as FOUND', async () => {
    reply = 'stream: Eicar-Test-Signature FOUND\0';
    const scanner = scanners.clamav('127.0.0.1', port, 5000);
    await expect(scanner.scan(EICAR, 'text/csv')).resolves.toBe('quarantined');
  });

  it('quarantines when clamd says something it does not understand', async () => {
    reply = 'stream: ERROR internal failure\0';
    const scanner = scanners.clamav('127.0.0.1', port, 5000);
    await expect(scanner.scan(CLEAN_PDF, 'application/pdf')).resolves.toBe('quarantined');
  });

  it('quarantines when clamd closes without replying', async () => {
    reply = '';
    const scanner = scanners.clamav('127.0.0.1', port, 5000);
    await expect(scanner.scan(CLEAN_PDF, 'application/pdf')).resolves.toBe('quarantined');
  });

  it('quarantines when clamd is unreachable, rather than assuming clean', async () => {
    /* Port 1 is reserved and nothing listens on it. */
    const scanner = scanners.clamav('127.0.0.1', 1, 2000);
    await expect(scanner.scan(CLEAN_PDF, 'application/pdf')).resolves.toBe('quarantined');
  });

  it('quarantines when clamd accepts the connection but never answers', async () => {
    const silent = trackedServer(() => undefined);
    await new Promise<void>((resolve) => silent.server.listen(0, '127.0.0.1', resolve));
    const silentPort = (silent.server.address() as { port: number }).port;

    const scanner = scanners.clamav('127.0.0.1', silentPort, 400);
    await expect(scanner.scan(CLEAN_PDF, 'application/pdf')).resolves.toBe('quarantined');

    await silent.shutdown();
  });
});
