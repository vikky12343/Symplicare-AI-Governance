import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import {
  Client,
  STRONG_PASSWORD,
  clearDatabase,
  signUpOrganisation,
  startDatabase,
  stopDatabase,
} from './setup.js';

/**
 * The security tests from the release gate: authentication, vertical privilege
 * escalation, horizontal access (tenant isolation and IDOR), CSRF, upload
 * handling and audit coverage.
 *
 * These are the checks that would block a deployment, so they are written to
 * fail loudly rather than to pass easily.
 */

let app: Express;

beforeAll(async () => {
  await startDatabase();
  const { createApp } = await import('../src/app.js');
  app = createApp();
});

afterAll(async () => {
  await stopDatabase();
});

beforeEach(async () => {
  await clearDatabase();
});

describe('authentication', () => {
  it('refuses everything without a session', async () => {
    const anon = new Client(app);
    for (const path of ['/api/care-homes', '/api/indicators', '/api/admin/organisation']) {
      const res = await anon.get(path);
      expect(res.status, path).toBe(401);
    }
  });

  it('rejects a weak password at signup', async () => {
    const client = new Client(app);
    const res = await client.post('/api/auth/signup', {
      name: 'Weak',
      email: 'weak@example.com',
      password: 'password',
      organisationName: 'Weak Ltd',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/12 characters/);
  });

  it('gives the same answer whether or not an account exists', async () => {
    await signUpOrganisation(app, { email: 'real@example.com', organisationName: 'Real Care' });

    const a = await new Client(app).post('/api/auth/login', {
      email: 'real@example.com',
      password: 'WrongPassword123',
    });
    const b = await new Client(app).post('/api/auth/login', {
      email: 'nobody@example.com',
      password: 'WrongPassword123',
    });

    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('does not reveal that an email is taken in a way that confirms the account', async () => {
    await signUpOrganisation(app, { email: 'taken@example.com', organisationName: 'Taken Care' });
    const res = await new Client(app).post('/api/auth/signup', {
      name: 'Someone Else',
      email: 'taken@example.com',
      password: STRONG_PASSWORD,
      organisationName: 'Another Home',
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).not.toMatch(/already (registered|exists)/i);
  });

  it('never returns the password hash', async () => {
    const { client } = await signUpOrganisation(app, {
      email: 'hash@example.com',
      organisationName: 'Hash Care',
    });
    const me = await client.get('/api/auth/me');
    expect(JSON.stringify(me.body)).not.toMatch(/scrypt|passwordHash/);
  });

  it('ends every session when the password is changed', async () => {
    const { client } = await signUpOrganisation(app, {
      email: 'rotate@example.com',
      organisationName: 'Rotate Care',
    });

    /* A second browser for the same user. */
    const second = new Client(app);
    await second.post('/api/auth/login', { email: 'rotate@example.com', password: STRONG_PASSWORD });
    expect((await second.get('/api/auth/me')).status).toBe(200);

    const change = await client.post('/api/auth/change-password', {
      currentPassword: STRONG_PASSWORD,
      newPassword: 'CompletelyNewPass2026',
    });
    expect(change.status).toBe(200);
    expect(change.body.otherSessionsRevoked).toBeGreaterThanOrEqual(1);

    /* The other session is dead; this one survives with a rotated id. */
    expect((await second.get('/api/auth/me')).status).toBe(401);
    expect((await client.get('/api/auth/me')).status).toBe(200);
  });

  it('logs out everywhere on request', async () => {
    const { client } = await signUpOrganisation(app, {
      email: 'logoutall@example.com',
      organisationName: 'Logout Care',
    });
    const second = new Client(app);
    await second.post('/api/auth/login', { email: 'logoutall@example.com', password: STRONG_PASSWORD });

    await client.post('/api/auth/logout-all');
    expect((await second.get('/api/auth/me')).status).toBe(401);
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('locks an account after repeated failures', async () => {
    await signUpOrganisation(app, { email: 'lock@example.com', organisationName: 'Lock Care' });
    for (let i = 0; i < 9; i++) {
      await new Client(app).post('/api/auth/login', { email: 'lock@example.com', password: 'Wrong123456789' });
    }
    /* Even the right password is refused while the lock holds. */
    const res = await new Client(app).post('/api/auth/login', {
      email: 'lock@example.com',
      password: STRONG_PASSWORD,
    });
    expect(res.status).toBe(401);
  });
});

describe('CSRF', () => {
  it('refuses a state-changing request without the token', async () => {
    const { client } = await signUpOrganisation(app, {
      email: 'csrf@example.com',
      organisationName: 'CSRF Care',
    });
    const res = await client.postWithoutCsrf('/api/care-homes', { code: 'CH-9', name: 'No Token House' });
    expect(res.status).toBe(403);
  });

  it('allows reads without one', async () => {
    const { client } = await signUpOrganisation(app, {
      email: 'csrfread@example.com',
      organisationName: 'CSRF Read Care',
    });
    const saved = client.csrf;
    client.csrf = '';
    expect((await client.get('/api/care-homes')).status).toBe(200);
    client.csrf = saved;
  });
});

describe('tenant isolation', () => {
  /**
   * The check that matters most: one organisation must not reach another's
   * data, including by guessing an id it was never shown.
   */
  it('hides another organisation’s care home behind the same answer as one that does not exist', async () => {
    const alpha = await signUpOrganisation(app, {
      email: 'alpha@example.com',
      organisationName: 'Alpha Care Group',
    });
    const beta = await signUpOrganisation(app, {
      email: 'beta@example.com',
      organisationName: 'Beta Care Group',
    });

    const created = await alpha.client.post('/api/care-homes', {
      code: 'CH-A1',
      name: 'Alpha House',
      town: 'Sheffield',
      beds: 40,
    });
    expect(created.status).toBe(201);
    const alphaHomeId = created.body.careHome.id;

    /* Beta knows the id and asks for it directly. */
    const stolen = await beta.client.get(`/api/care-homes/${alphaHomeId}`);
    const invented = await beta.client.get('/api/care-homes/000000000000000000000000');

    expect(stolen.status).toBe(404);
    expect(invented.status).toBe(404);
    /* Identical responses, so the API cannot be used to discover which ids exist. */
    expect(stolen.body).toEqual(invented.body);
  });

  it('keeps every analytics route inside the tenant', async () => {
    const alpha = await signUpOrganisation(app, { email: 'a2@example.com', organisationName: 'Alpha Two' });
    const beta = await signUpOrganisation(app, { email: 'b2@example.com', organisationName: 'Beta Two' });

    const created = await alpha.client.post('/api/care-homes', { code: 'CH-A2', name: 'Alpha Two House' });
    const id = created.body.careHome.id;

    for (const path of [
      `/api/care-homes/${id}/dashboard`,
      `/api/care-homes/${id}/quality`,
      `/api/care-homes/${id}/assurance`,
      `/api/care-homes/${id}/actions`,
      `/api/care-homes/${id}/reports`,
      `/api/care-homes/${id}/evidence`,
      `/api/care-homes/${id}/datasets`,
      `/api/care-homes/${id}/periods`,
    ]) {
      const res = await beta.client.get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it('does not list another organisation’s homes', async () => {
    const alpha = await signUpOrganisation(app, { email: 'a3@example.com', organisationName: 'Alpha Three' });
    const beta = await signUpOrganisation(app, { email: 'b3@example.com', organisationName: 'Beta Three' });

    await alpha.client.post('/api/care-homes', { code: 'CH-A3', name: 'Alpha Three House' });
    const list = await beta.client.get('/api/care-homes');

    expect(list.status).toBe(200);
    expect(list.body.careHomes).toEqual([]);
  });

  it('refuses a write aimed at another organisation’s home', async () => {
    const alpha = await signUpOrganisation(app, { email: 'a4@example.com', organisationName: 'Alpha Four' });
    const beta = await signUpOrganisation(app, { email: 'b4@example.com', organisationName: 'Beta Four' });

    const created = await alpha.client.post('/api/care-homes', { code: 'CH-A4', name: 'Alpha Four House' });
    const id = created.body.careHome.id;

    const res = await beta.client.post(`/api/care-homes/${id}/actions`, {
      title: 'Injected action',
      dueDate: '2026-09-01',
      reviewDate: '2026-10-01',
    });
    expect(res.status).toBe(404);
  });

  it('cannot be steered by an organisation id in the request body', async () => {
    const alpha = await signUpOrganisation(app, { email: 'a5@example.com', organisationName: 'Alpha Five' });
    const beta = await signUpOrganisation(app, { email: 'b5@example.com', organisationName: 'Beta Five' });

    /* Beta creates a home while claiming to be Alpha. The body is data; the
       session is the authority. */
    const created = await beta.client.post('/api/care-homes', {
      code: 'CH-B5',
      name: 'Beta Five House',
      organisationId: alpha.organisationId,
    });
    expect(created.status).toBe(201);

    const alphaList = await alpha.client.get('/api/care-homes');
    expect(alphaList.body.careHomes).toEqual([]);
    const betaList = await beta.client.get('/api/care-homes');
    expect(betaList.body.careHomes).toHaveLength(1);
  });
});

describe('role capabilities', () => {
  it('refuses an action a role does not hold, and says which role', async () => {
    const owner = await signUpOrganisation(app, { email: 'owner2@example.com', organisationName: 'Roles Care' });
    const created = await owner.client.post('/api/care-homes', { code: 'CH-R1', name: 'Roles House' });
    const homeId = created.body.careHome.id;

    /* Add a Viewer and sign in as them. */
    const { User } = await import('../src/models/index.js');
    const { hashPassword } = await import('../src/auth/passwords.js');
    const { Types } = await import('mongoose');
    await User.create({
      email: 'viewer@example.com',
      name: 'Read Only',
      passwordHash: await hashPassword(STRONG_PASSWORD),
      emailVerifiedAt: new Date(),
      memberships: [
        { organisationId: new Types.ObjectId(owner.organisationId), role: 'Viewer', careHomeIds: [] },
      ],
    });

    const viewer = new Client(app);
    await viewer.post('/api/auth/login', { email: 'viewer@example.com', password: STRONG_PASSWORD });

    /* A viewer can read. */
    expect((await viewer.get(`/api/care-homes/${homeId}/dashboard`)).status).not.toBe(403);

    /* A viewer cannot write. */
    const action = await viewer.post(`/api/care-homes/${homeId}/actions`, {
      title: 'Not allowed',
      dueDate: '2026-09-01',
      reviewDate: '2026-10-01',
    });
    expect(action.status).toBe(403);
    expect(action.body.error.message).toMatch(/Viewer/);

    const report = await viewer.post(`/api/care-homes/${homeId}/reports`, { period: '2026-06' });
    expect(report.status).toBe(403);

    const members = await viewer.get('/api/admin/members');
    expect(members.status).toBe(403);
  });

  it('applies a role change on the very next request', async () => {
    const owner = await signUpOrganisation(app, { email: 'owner3@example.com', organisationName: 'Change Care' });

    const { User } = await import('../src/models/index.js');
    const { hashPassword } = await import('../src/auth/passwords.js');
    const { Types } = await import('mongoose');
    const staff = await User.create({
      email: 'staff@example.com',
      name: 'Some Staff',
      passwordHash: await hashPassword(STRONG_PASSWORD),
      emailVerifiedAt: new Date(),
      memberships: [
        { organisationId: new Types.ObjectId(owner.organisationId), role: 'Staff', careHomeIds: [] },
      ],
    });

    const client = new Client(app);
    await client.post('/api/auth/login', { email: 'staff@example.com', password: STRONG_PASSWORD });
    expect((await client.get('/api/auth/me')).status).toBe(200);

    const changed = await owner.client.patch(`/api/admin/members/${String(staff._id)}/role`, { role: 'Viewer' });
    expect(changed.status).toBe(200);

    /* Server-side sessions mean the change bites immediately. */
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });

  it('will not let the last owner demote themselves', async () => {
    const owner = await signUpOrganisation(app, { email: 'owner4@example.com', organisationName: 'Last Owner Care' });
    const me = await owner.client.get('/api/auth/me');
    const res = await owner.client.patch(`/api/admin/members/${me.body.user.id}/role`, { role: 'Viewer' });
    expect(res.status).toBe(400);
  });
});

describe('uploads', () => {
  async function homeFor(email: string, organisationName: string) {
    const org = await signUpOrganisation(app, { email, organisationName });
    const created = await org.client.post('/api/care-homes', { code: 'CH-U1', name: 'Upload House', beds: 48 });
    return { client: org.client, homeId: created.body.careHome.id as string };
  }

  it('refuses a file that is not a CSV', async () => {
    const { client, homeId } = await homeFor('upload1@example.com', 'Upload Care One');
    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from('MZ  binary'),
      'payload.exe',
      'application/octet-stream',
    );
    expect(res.status).toBe(415);
  });

  it('refuses a binary file wearing a .csv extension', async () => {
    const { client, homeId } = await homeFor('upload2@example.com', 'Upload Care Two');
    const res = await client.attach(
      `/api/care-homes/${homeId}/imports/validate`,
      'file',
      Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x01, 0x02]),
      'sneaky.csv',
      'text/csv',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/does not look like a spreadsheet or a CSV/);
  });

  it('quarantines an evidence file that carries a malware signature', async () => {
    const { client, homeId } = await homeFor('upload3@example.com', 'Upload Care Three');
    const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    const res = await client.attach(
      `/api/care-homes/${homeId}/evidence`,
      'file',
      eicar,
      'test.csv',
      'text/csv',
    );
    expect(res.status).toBe(201);
    expect(res.body.evidence.scanStatus).toBe('quarantined');

    /* A quarantined file cannot be retrieved. */
    const download = await client.get(`/api/care-homes/${homeId}/evidence/${res.body.evidence.id}/download`);
    expect(download.status).toBe(403);
  });

  it('refuses a PDF that does not begin like a PDF', async () => {
    const { client, homeId } = await homeFor('upload4@example.com', 'Upload Care Four');
    const res = await client.attach(
      `/api/care-homes/${homeId}/evidence`,
      'file',
      Buffer.from('this is not really a pdf'),
      'audit.pdf',
      'application/pdf',
    );
    expect(res.body.evidence.scanStatus).toBe('quarantined');
  });
});

describe('audit trail', () => {
  it('records both successful and refused attempts, without secrets', async () => {
    const owner = await signUpOrganisation(app, { email: 'audit@example.com', organisationName: 'Audit Care' });
    await new Client(app).post('/api/auth/login', { email: 'audit@example.com', password: 'WrongPassword123' });

    const log = await owner.client.get('/api/admin/audit');
    expect(log.status).toBe(200);

    const actions = log.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('auth.signup');
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.login.failed');

    const failed = log.body.entries.find((e: { action: string }) => e.action === 'auth.login.failed');
    expect(failed.outcome).toBe('denied');

    /* Nothing in the log may carry a credential. */
    const serialised = JSON.stringify(log.body);
    expect(serialised).not.toMatch(/WrongPassword123|Governance2026Secure|scrypt\$/);
  });

  it('is not readable by a role without the capability', async () => {
    const owner = await signUpOrganisation(app, { email: 'audit2@example.com', organisationName: 'Audit Two' });

    const { User } = await import('../src/models/index.js');
    const { hashPassword } = await import('../src/auth/passwords.js');
    const { Types } = await import('mongoose');
    await User.create({
      email: 'nosy@example.com',
      name: 'Nosy Staff',
      passwordHash: await hashPassword(STRONG_PASSWORD),
      emailVerifiedAt: new Date(),
      memberships: [
        { organisationId: new Types.ObjectId(owner.organisationId), role: 'Staff', careHomeIds: [] },
      ],
    });

    const nosy = new Client(app);
    await nosy.post('/api/auth/login', { email: 'nosy@example.com', password: STRONG_PASSWORD });
    expect((await nosy.get('/api/admin/audit')).status).toBe(403);
  });
});

describe('error handling', () => {
  it('does not leak internals in an error body', async () => {
    const { client } = await signUpOrganisation(app, { email: 'errors@example.com', organisationName: 'Errors Care' });
    const res = await client.get('/api/care-homes/not-an-object-id/dashboard');
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/at .*\.ts:|node_modules|MongoServerError|ObjectId\(/);
  });

  it('returns field-level messages a form can display', async () => {
    const client = new Client(app);
    const res = await client.post('/api/auth/signup', {
      name: 'A',
      email: 'not-an-email',
      password: 'short',
      organisationName: '',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields.length).toBeGreaterThan(1);
    expect(res.body.error.fields[0]).toHaveProperty('path');
  });
});

describe('security headers', () => {
  it('sets the headers the release gate checks for', async () => {
    const res = await new Client(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
