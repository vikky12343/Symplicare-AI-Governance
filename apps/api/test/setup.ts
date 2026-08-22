import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-that-is-definitely-long-enough-000000';

let memory: MongoMemoryServer | null = null;

export async function startDatabase(): Promise<void> {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri(), { dbName: 'care_governance_test' });
}

export async function stopDatabase(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await memory?.stop();
  memory = null;
}

export async function clearDatabase(): Promise<void> {
  const collections = await mongoose.connection.db?.collections();
  for (const collection of collections ?? []) await collection.deleteMany({});
}

/**
 * A signed-in client that carries its own cookie jar and CSRF token, so tests
 * exercise the same session and CSRF path a browser would.
 */
export class Client {
  cookies: string[] = [];
  csrf = '';

  constructor(private readonly app: Express) {}

  private capture(res: request.Response): void {
    const setCookie = res.headers['set-cookie'];
    if (!setCookie) return;
    const list = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const raw of list) {
      const [pair] = raw.split(';');
      if (!pair) continue;
      const [name] = pair.split('=');
      this.cookies = this.cookies.filter((c) => !c.startsWith(`${name}=`));
      this.cookies.push(pair);
      if (name === 'cgi_csrf') this.csrf = pair.split('=')[1] ?? '';
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.cookies.length) h.Cookie = this.cookies.join('; ');
    if (this.csrf) h['X-CSRF-Token'] = this.csrf;
    return h;
  }

  async get(path: string): Promise<request.Response> {
    const res = await request(this.app).get(path).set(this.headers());
    this.capture(res);
    return res;
  }

  async post(path: string, body?: unknown): Promise<request.Response> {
    const res = await request(this.app).post(path).set(this.headers()).send(body as object);
    this.capture(res);
    return res;
  }

  async patch(path: string, body?: unknown): Promise<request.Response> {
    const res = await request(this.app).patch(path).set(this.headers()).send(body as object);
    this.capture(res);
    return res;
  }

  async attach(path: string, field: string, buffer: Buffer, filename: string, contentType: string) {
    const res = await request(this.app)
      .post(path)
      .set(this.headers())
      .attach(field, buffer, { filename, contentType });
    this.capture(res);
    return res;
  }

  /** Deliberately omits the CSRF header, for the negative test. */
  async postWithoutCsrf(path: string, body?: unknown): Promise<request.Response> {
    const h: Record<string, string> = {};
    if (this.cookies.length) h.Cookie = this.cookies.join('; ');
    return request(this.app).post(path).set(h).send(body as object);
  }
}

export const STRONG_PASSWORD = 'Governance2026Secure';

/** Signs a brand new organisation up and returns a client signed in as its owner. */
export async function signUpOrganisation(
  app: Express,
  options: { email: string; organisationName: string; name?: string },
): Promise<{ client: Client; organisationId: string; userId: string }> {
  const client = new Client(app);
  const signup = await client.post('/api/auth/signup', {
    name: options.name ?? 'Test Owner',
    email: options.email,
    password: STRONG_PASSWORD,
    organisationName: options.organisationName,
  });
  if (signup.status !== 201) throw new Error(`Signup failed: ${JSON.stringify(signup.body)}`);

  const login = await client.post('/api/auth/login', {
    email: options.email,
    password: STRONG_PASSWORD,
  });
  if (login.status !== 200) throw new Error(`Login failed: ${JSON.stringify(login.body)}`);

  return {
    client,
    organisationId: signup.body.organisation.id,
    userId: signup.body.user.id,
  };
}
