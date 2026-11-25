/**
 * F05 staff management e2e: the real AppModule (global guards, validation, throttling, exception filter)
 * with an in-memory database fake. No database or credentials are needed. Real-PostgreSQL concurrency
 * behaviour is covered by test/db-isolated/f05-staff-concurrency.db-spec.ts.
 */
import { createHash } from 'node:crypto';
import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { SESSION_COOKIE } from '../src/auth/auth.constants.js';
import { hashPassword } from '../src/auth/password.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createFakeStaffDb, type FakeStaffDb, fakeUser } from './support/fake-staff-db.js';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new staff password';
const OWNER_ID = '0190a000-0000-7000-8000-000000000001';
const COOK_ID = '0190a000-0000-7000-8000-000000000002';
const WAITER_ID = '0190a000-0000-7000-8000-000000000003';
const OTHER_OWNER_ID = '0190a000-0000-7000-8000-000000000004';
const UNKNOWN_ID = '0190a000-0000-7000-8000-0000000000ff';

let passwordHash: string;
const logged: string[] = [];

function seedUsers() {
  const active = {
    isActive: true,
    passwordHash,
    activatedAt: new Date('2026-11-02T09:00:00Z'),
  };
  return [
    fakeUser({
      id: OWNER_ID,
      role: 'OWNER',
      email: 'owner@example.com',
      ...active,
    }),
    fakeUser({
      id: OTHER_OWNER_ID,
      role: 'OWNER',
      email: 'owner2@example.com',
      ...active,
    }),
    fakeUser({
      id: COOK_ID,
      role: 'KITCHEN_STAFF',
      email: 'cook@example.com',
      ...active,
    }),
    fakeUser({
      id: WAITER_ID,
      role: 'WAITER',
      email: 'waiter@example.com',
      ...active,
    }),
  ];
}

async function createApp(db: FakeStaffDb): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(db)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({
    logger: false,
  });
  configureApp(app);
  await app.init();
  return app;
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
});

beforeEach(() => {
  // Re-installed per test: the e2e config restores mocks after each test.
  const capture = (message: unknown) => {
    logged.push(String(message));
  };
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(capture);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(capture);
});

describe('F05 staff management (e2e)', () => {
  let app: INestApplication<App>;
  let db: FakeStaffDb;
  const http = () => request(app.getHttpServer());
  const call = (method: 'get' | 'post' | 'patch', path: string) => http()[method](path);

  beforeEach(async () => {
    logged.length = 0;
    db = createFakeStaffDb(seedUsers());
    app = await createApp(db);
  });

  afterEach(async () => {
    await app.close();
  });

  async function login(email: string, password = PASSWORD): Promise<string> {
    const res = await http().post('/api/v1/auth/login').set('Origin', ORIGIN).send({ email, password }).expect(200);
    const cookies = res.headers['set-cookie'] as unknown as string[];
    return cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))?.split(';')[0] ?? '';
  }

  async function createStaff(owner: string, body: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/v1/staff')
      .set('Origin', ORIGIN)
      .set('Cookie', owner)
      .send({
        fullName: 'Ali  Raza',
        email: ' Ali.Raza@Example.com ',
        role: 'WAITER',
        ...body,
      })
      .expect(201);
    const body_ = res.body as {
      staff: { id: string; status: string };
      setup: { url: string; expiresAt: string };
    };
    return {
      res,
      staff: body_.staff,
      url: body_.setup.url,
      token: body_.setup.url.split('#token=')[1] ?? '',
    };
  }

  const setup = (token: string, password = NEW_PASSWORD) =>
    http().post('/api/v1/staff/setup-password').set('Origin', ORIGIN).send({ token, password });

  describe('authorization (OWNER only, deny by default)', () => {
    const routes: [string, string, Record<string, unknown>?][] = [
      ['get', '/api/v1/staff'],
      ['post', '/api/v1/staff', { fullName: 'X', email: 'x@example.com', role: 'WAITER' }],
      ['patch', `/api/v1/staff/${WAITER_ID}`, { fullName: 'Y' }],
      ['post', `/api/v1/staff/${WAITER_ID}/deactivate`],
      ['post', `/api/v1/staff/${WAITER_ID}/activate`],
      ['post', `/api/v1/staff/${WAITER_ID}/setup-link`],
    ];

    it('returns 401 without a session on every staff route', async () => {
      for (const [method, path, body] of routes) {
        const res = await call(method as 'get', path)
          .set('Origin', ORIGIN)
          .send(body);
        expect(res.status, `${method} ${path}`).toBe(401);
      }
    });

    it.each([
      ['KITCHEN_STAFF', 'cook@example.com'],
      ['WAITER', 'waiter@example.com'],
    ])('returns 403 for %s on every staff route and changes nothing', async (_role, email) => {
      const cookie = await login(email);
      const before = JSON.stringify(db.users);
      for (const [method, path, body] of routes) {
        const res = await call(method as 'get', path)
          .set('Origin', ORIGIN)
          .set('Cookie', cookie)
          .send(body);
        expect(res.status, `${method} ${path}`).toBe(403);
      }
      expect(JSON.stringify(db.users)).toBe(before);
      expect(db.tokens).toHaveLength(0);
    });

    it('lists only KITCHEN_STAFF and WAITER accounts, without secrets', async () => {
      const owner = await login('owner@example.com');
      const res = await http().get('/api/v1/staff').set('Cookie', owner).expect(200);
      const staff = (res.body as { staff: { id: string; role: string; status: string }[] }).staff;
      expect(staff.map((s) => s.role).sort()).toEqual(['KITCHEN_STAFF', 'WAITER']);
      expect(staff.every((s) => s.status === 'ACTIVE')).toBe(true);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|tokenHash|isActive|createdById/);
    });

    it('treats OWNER accounts as not found for every management action (S3)', async () => {
      const owner = await login('owner@example.com');
      for (const target of [OWNER_ID, OTHER_OWNER_ID, UNKNOWN_ID]) {
        for (const [method, path, body] of [
          ['patch', `/api/v1/staff/${target}`, { fullName: 'Hacked' }],
          ['post', `/api/v1/staff/${target}/deactivate`, undefined],
          ['post', `/api/v1/staff/${target}/activate`, undefined],
          ['post', `/api/v1/staff/${target}/setup-link`, undefined],
        ] as const) {
          const res = await call(method, path).set('Origin', ORIGIN).set('Cookie', owner).send(body);
          expect(res.status, `${method} ${path}`).toBe(404);
          expect(res.body).toMatchObject({
            message: 'Staff member not found.',
          });
        }
      }
      expect(db.users.find((u) => u.id === OWNER_ID)).toMatchObject({
        isActive: true,
        fullName: `User ${OWNER_ID}`,
      });
    });

    it('requires an allowed Origin on mutations (CSRF)', async () => {
      const owner = await login('owner@example.com');
      await http()
        .post('/api/v1/staff')
        .set('Cookie', owner)
        .send({ fullName: 'X', email: 'x@example.com', role: 'WAITER' })
        .expect(403);
      await http()
        .post('/api/v1/staff/setup-password')
        .set('Origin', 'https://evil.example')
        .send({ token: 'a'.repeat(43), password: NEW_PASSWORD })
        .expect(403);
      expect(db.users).toHaveLength(4);
    });
  });

  describe('validation', () => {
    it.each([
      ['OWNER role', { role: 'OWNER' }],
      ['unknown role', { role: 'ADMIN' }],
      ['mass assignment of isActive', { isActive: true }],
      ['mass assignment of passwordHash', { passwordHash: 'x' }],
      ['invalid email', { email: 'not-an-email' }],
      ['control characters in the name', { fullName: 'Ali\tRaza' }],
      ['blank name', { fullName: '   ' }],
    ])('rejects %s with 400 and creates nothing', async (_label, override) => {
      const owner = await login('owner@example.com');
      const res = await http()
        .post('/api/v1/staff')
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({
          fullName: 'Ali Raza',
          email: 'ali@example.com',
          role: 'WAITER',
          ...override,
        });
      expect(res.status).toBe(400);
      expect(db.users).toHaveLength(4);
      expect(db.tokens).toHaveLength(0);
    });

    it('rejects malformed ids, unknown query parameters and empty updates', async () => {
      const owner = await login('owner@example.com');
      await http()
        .patch('/api/v1/staff/not-a-uuid')
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({ fullName: 'x' })
        .expect(400);
      await http().get('/api/v1/staff?status=BOGUS').set('Cookie', owner).expect(400);
      await http().get('/api/v1/staff?role=OWNER').set('Cookie', owner).expect(400);
      await http().patch(`/api/v1/staff/${WAITER_ID}`).set('Origin', ORIGIN).set('Cookie', owner).send({}).expect(400);
      await http()
        .patch(`/api/v1/staff/${WAITER_ID}`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({ role: 'OWNER' })
        .expect(400);
    });

    it('returns 409 for a duplicate email (case-insensitive)', async () => {
      const owner = await login('owner@example.com');
      await http()
        .post('/api/v1/staff')
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({ fullName: 'Dup', email: 'WAITER@example.com', role: 'WAITER' })
        .expect(409);
    });
  });

  describe('create and one-time setup link (S1/S2)', () => {
    it('creates a pending account and returns the setup link once, storing only its hash', async () => {
      const owner = await login('owner@example.com');
      const { res, staff, url, token } = await createStaff(owner);

      expect(res.headers['cache-control']).toBe('no-store');
      expect(staff).toMatchObject({
        fullName: 'Ali Raza',
        email: 'ali.raza@example.com',
        role: 'WAITER',
        status: 'PENDING',
      });
      expect(url).toMatch(/^http:\/\/localhost:5173\/setup-password#token=[A-Za-z0-9_-]{43}$/);
      expect(JSON.stringify(res.body)).not.toMatch(/argon2|passwordHash|tokenHash/);

      const stored = db.tokens[0];
      expect(stored?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(JSON.stringify(db.tokens)).not.toContain(token);
      const ttl = (stored?.expiresAt as Date).getTime() - (stored?.createdAt as Date).getTime();
      expect(ttl).toBe(24 * 60 * 60 * 1000);
      expect(db.users.find((u) => u.id === staff.id)).toMatchObject({
        createdById: OWNER_ID,
        isActive: false,
        passwordHash: null,
      });
    });

    it('activates the account exactly once; the new staff member can then sign in', async () => {
      const owner = await login('owner@example.com');
      const { staff, token } = await createStaff(owner);

      // Pending accounts cannot sign in.
      await http()
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: 'ali.raza@example.com', password: NEW_PASSWORD })
        .expect(401);

      const ok = await setup(token).expect(204);
      expect(ok.headers['cache-control']).toBe('no-store');
      const user = db.users.find((u) => u.id === staff.id);
      expect(user).toMatchObject({ isActive: true });
      expect(user?.passwordHash).toMatch(/^\$argon2id\$/);
      expect(user?.activatedAt).toBeInstanceOf(Date);

      const reuse = await setup(token, 'another long password!').expect(400);
      expect(reuse.body).toMatchObject({
        message: 'This setup link is invalid or has expired. Ask the owner for a new link.',
      });

      const cookie = await login('ali.raza@example.com', NEW_PASSWORD);
      const me = await http().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      expect(me.body).toMatchObject({ role: 'WAITER' });
    });

    it('rejects weak passwords without consuming the link', async () => {
      const owner = await login('owner@example.com');
      const { token } = await createStaff(owner);
      const res = await setup(token, 'short').expect(400);
      expect(res.body).toMatchObject({
        message: 'Password must be at least 12 characters.',
      });
      await setup(token, 'ali.raza@example.com').expect(400);
      await setup(token).expect(204);
    });

    it('rejects unknown, malformed and expired tokens with the same generic message', async () => {
      const owner = await login('owner@example.com');
      const { token } = await createStaff(owner);
      const generic = {
        message: 'This setup link is invalid or has expired. Ask the owner for a new link.',
      };

      expect((await setup('A'.repeat(43)).expect(400)).body).toMatchObject(generic);
      expect((await setup('short-token').expect(400)).body).toMatchObject({
        statusCode: 400,
      });

      const stored = db.tokens[0];
      if (stored) stored.expiresAt = new Date(Date.now() - 1000);
      expect((await setup(token).expect(400)).body).toMatchObject(generic);
      expect(db.users.filter((u) => u.isActive)).toHaveLength(4);
    });

    it('regeneration invalidates the old link immediately; only pending accounts get links', async () => {
      const owner = await login('owner@example.com');
      const { staff, token: oldToken } = await createStaff(owner);

      const regen = await http()
        .post(`/api/v1/staff/${staff.id}/setup-link`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .expect(200);
      expect(regen.headers['cache-control']).toBe('no-store');
      const newToken = (regen.body as { setup: { url: string } }).setup.url.split('#token=')[1] ?? '';
      expect(newToken).not.toBe(oldToken);

      await setup(oldToken).expect(400);
      await setup(newToken).expect(204);

      // Activated accounts never get setup links (no password reset through this flow).
      await http().post(`/api/v1/staff/${staff.id}/setup-link`).set('Origin', ORIGIN).set('Cookie', owner).expect(409);
      await http().post(`/api/v1/staff/${WAITER_ID}/setup-link`).set('Origin', ORIGIN).set('Cookie', owner).expect(409);
    });
  });

  describe('lifecycle transitions and session revocation', () => {
    it('deactivation revokes sessions immediately; reactivation restores sign-in', async () => {
      const owner = await login('owner@example.com');
      const waiter = await login('waiter@example.com');
      await http().get('/api/v1/auth/me').set('Cookie', waiter).expect(200);

      const res = await http()
        .post(`/api/v1/staff/${WAITER_ID}/deactivate`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .expect(200);
      expect(res.body).toMatchObject({
        staff: { id: WAITER_ID, status: 'DEACTIVATED' },
      });
      expect(db.sessions.filter((s) => s.userId === WAITER_ID).every((s) => s.revokedAt instanceof Date)).toBe(true);
      await http().get('/api/v1/auth/me').set('Cookie', waiter).expect(401);
      await http()
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: 'waiter@example.com', password: PASSWORD })
        .expect(401);

      await http().post(`/api/v1/staff/${WAITER_ID}/deactivate`).set('Origin', ORIGIN).set('Cookie', owner).expect(409);

      const back = await http()
        .post(`/api/v1/staff/${WAITER_ID}/activate`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .expect(200);
      expect(back.body).toMatchObject({
        staff: { status: 'ACTIVE', deactivatedAt: null },
      });
      await http().post(`/api/v1/staff/${WAITER_ID}/activate`).set('Origin', ORIGIN).set('Cookie', owner).expect(409);
      await login('waiter@example.com');
    });

    it('a deactivated pending account can never be activated, by link or by the owner', async () => {
      const owner = await login('owner@example.com');
      const { staff, token } = await createStaff(owner);

      // Pending accounts cannot be activated manually (no password, no activation history).
      await http().post(`/api/v1/staff/${staff.id}/activate`).set('Origin', ORIGIN).set('Cookie', owner).expect(409);

      await http().post(`/api/v1/staff/${staff.id}/deactivate`).set('Origin', ORIGIN).set('Cookie', owner).expect(200);
      await setup(token).expect(400);
      await http().post(`/api/v1/staff/${staff.id}/setup-link`).set('Origin', ORIGIN).set('Cookie', owner).expect(409);
      const res = await http()
        .post(`/api/v1/staff/${staff.id}/activate`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .expect(409);
      expect(res.body).toMatchObject({
        message: 'This account never completed setup and cannot be reactivated.',
      });
      expect(db.users.find((u) => u.id === staff.id)).toMatchObject({
        isActive: false,
        passwordHash: null,
      });
    });

    it('a role change revokes every session of that account (S3)', async () => {
      const owner = await login('owner@example.com');
      const cook = await login('cook@example.com');
      const res = await http()
        .patch(`/api/v1/staff/${COOK_ID}`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({ role: 'WAITER' })
        .expect(200);
      expect(res.body).toMatchObject({ staff: { role: 'WAITER' } });
      await http().get('/api/v1/auth/me').set('Cookie', cook).expect(401);
      // The owner's own session is untouched.
      await http().get('/api/v1/auth/me').set('Cookie', owner).expect(200);
    });

    it('a name-only change keeps sessions; email changes are pending-only and kill old links (S4)', async () => {
      const owner = await login('owner@example.com');
      const cook = await login('cook@example.com');
      await http()
        .patch(`/api/v1/staff/${COOK_ID}`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({ fullName: 'Chef  Imran' })
        .expect(200);
      await http().get('/api/v1/auth/me').set('Cookie', cook).expect(200);
      expect(db.users.find((u) => u.id === COOK_ID)?.fullName).toBe('Chef Imran');

      const active = await http()
        .patch(`/api/v1/staff/${COOK_ID}`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({ email: 'new.cook@example.com' })
        .expect(409);
      expect(active.body).toMatchObject({
        message: 'Email can only be changed before the staff member completes account setup.',
      });

      const { staff, token } = await createStaff(owner);
      await http()
        .patch(`/api/v1/staff/${staff.id}`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({ email: 'ali.correct@example.com' })
        .expect(200);
      await setup(token).expect(400);
      await http()
        .patch(`/api/v1/staff/${staff.id}`)
        .set('Origin', ORIGIN)
        .set('Cookie', owner)
        .send({ email: 'cook@example.com' })
        .expect(409);
    });
  });

  describe('abuse protection and sensitive data', () => {
    it('rate-limits the public setup endpoint per client', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push((await setup('A'.repeat(43))).status);
      }
      expect(statuses.slice(0, 5)).toEqual([400, 400, 400, 400, 400]);
      expect(statuses[5]).toBe(429);
    });

    it('never logs tokens, token hashes, passwords, emails or names', async () => {
      const owner = await login('owner@example.com');
      const { staff, token } = await createStaff(owner);
      await setup(token, 'short').expect(400);
      await setup(token).expect(204);
      await setup(token).expect(400);
      await http().post(`/api/v1/staff/${staff.id}/deactivate`).set('Origin', ORIGIN).set('Cookie', owner).expect(200);

      const text = logged.join('\n');
      expect(text).toContain(`staff_created actor=${OWNER_ID} target=${staff.id}`);
      expect(text).toContain(`staff_setup_completed user=${staff.id}`);
      expect(text).toContain('setup_rejected');
      expect(text).toContain(`staff_deactivated actor=${OWNER_ID} target=${staff.id}`);
      const hash = createHash('sha256').update(token).digest('hex');
      for (const secret of [token, hash, NEW_PASSWORD, PASSWORD, 'ali.raza@example.com', 'Ali Raza', 'argon2']) {
        expect(text).not.toContain(secret);
      }
    });
  });
});
