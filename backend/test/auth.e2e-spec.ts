import { Controller, Get, type INestApplication, Logger, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { SESSION_COOKIE } from '../src/auth/auth.constants.js';
import { Roles } from '../src/auth/decorators.js';
import { hashPassword } from '../src/auth/password.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * F03 authentication / RBAC end-to-end tests with the real HTTP pipeline (guards, cookies, CORS,
 * validation, throttling) and an in-memory Prisma fake, so no database or credentials are needed.
 */

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'correct horse battery';

type Role = 'OWNER' | 'KITCHEN_STAFF' | 'WAITER';

interface FakeUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  isActive: boolean;
  passwordHash: string | null;
}

interface FakeSession {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Minimal stateful stand-in for the Prisma calls used by AuthService and SessionService. */
function createFakePrisma(users: FakeUser[]) {
  const sessions: FakeSession[] = [];
  const matches = (session: FakeSession, where: Partial<FakeSession>): boolean =>
    Object.entries(where).every(([key, value]) => session[key as keyof FakeSession] === value);

  return {
    users,
    sessions,
    $queryRaw: vi.fn().mockResolvedValue([]),
    $disconnect: vi.fn(),
    user: {
      findUnique: vi.fn(({ where }: { where: { email: string } }) =>
        Promise.resolve(users.find((user) => user.email === where.email) ?? null),
      ),
    },
    staffSession: {
      create: vi.fn(({ data }: { data: Omit<FakeSession, 'id' | 'revokedAt'> }) => {
        sessions.push({ ...data, id: `session-${String(sessions.length + 1)}`, revokedAt: null });
        return Promise.resolve({ id: `session-${String(sessions.length)}` });
      }),
      findUnique: vi.fn(({ where }: { where: { tokenHash: string } }) => {
        const session = sessions.find((s) => s.tokenHash === where.tokenHash);
        if (!session) return Promise.resolve(null);
        const user = users.find((u) => u.id === session.userId);
        return Promise.resolve({ ...session, user });
      }),
      updateMany: vi.fn(({ where, data }: { where: Partial<FakeSession>; data: Partial<FakeSession> }) => {
        const hits = sessions.filter((session) => matches(session, where));
        for (const session of hits) Object.assign(session, data);
        return Promise.resolve({ count: hits.length });
      }),
    },
  };
}

@Controller('e2e-probe')
class ProbeController {
  @Get('any-staff')
  anyStaff() {
    return { ok: true };
  }

  @Roles('OWNER')
  @Get('owner')
  owner() {
    return { ok: true };
  }

  @Roles('KITCHEN_STAFF')
  @Get('kitchen')
  kitchen() {
    return { ok: true };
  }

  @Roles('WAITER')
  @Get('waiter')
  waiter() {
    return { ok: true };
  }

  @Roles('OWNER')
  @Post('owner-action')
  ownerAction() {
    return { ok: true };
  }
}

let passwordHash: string;

function staffUsers(): FakeUser[] {
  const base = { isActive: true, passwordHash };
  return [
    { id: 'u-owner', fullName: 'Owner One', email: 'owner@example.com', role: 'OWNER', ...base },
    { id: 'u-kitchen', fullName: 'Cook One', email: 'cook@example.com', role: 'KITCHEN_STAFF', ...base },
    { id: 'u-waiter', fullName: 'Waiter One', email: 'waiter@example.com', role: 'WAITER', ...base },
    { id: 'u-inactive', fullName: 'Former Staff', email: 'former@example.com', role: 'WAITER', ...base, isActive: false },
    { id: 'u-pending', fullName: 'Pending Staff', email: 'pending@example.com', role: 'WAITER', ...base, passwordHash: null },
  ];
}

async function createApp(prisma: ReturnType<typeof createFakePrisma>): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule], controllers: [ProbeController] })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

function sessionCookie(res: request.Response): string {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error('no session cookie set');
  return cookie;
}

async function login(app: INestApplication<App>, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .send({ email, password: PASSWORD })
    .expect(200);
  return sessionCookie(res).split(';')[0] ?? '';
}

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('F03 auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof createFakePrisma>;

  beforeEach(async () => {
    prisma = createFakePrisma(staffUsers());
    app = await createApp(prisma);
  });

  afterEach(async () => {
    await app.close();
  });

  it('keeps /health public', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('denies by default: protected routes return 401 without a session', async () => {
    for (const path of ['/api/v1/auth/me', '/api/v1/e2e-probe/any-staff', '/api/v1/e2e-probe/owner']) {
      const res = await request(app.getHttpServer()).get(path).expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, message: 'Authentication required.' });
    }
  });

  it('logs in, sets a hardened HttpOnly cookie and never returns secrets', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: '  OWNER@example.com ', password: PASSWORD })
      .expect(200);

    expect(res.body).toEqual({
      user: { id: 'u-owner', fullName: 'Owner One', email: 'owner@example.com', role: 'OWNER' },
    });
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1/);
    expect(cookie).toMatch(/Expires=/);
    expect(cookie).not.toMatch(/;\s*Secure/i); // NODE_ENV=test; Secure is enabled in production
    expect(res.headers['cache-control']).toBe('no-store');

    const token = (cookie.split(';')[0] ?? '').split('=')[1] ?? '';
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|hash|session/i);
    expect(prisma.sessions[0]?.tokenHash).not.toBe(token);
  });

  it('returns the same generic 401 for unknown, wrong-password, inactive and not-activated accounts', async () => {
    const attempts = [
      { email: 'nobody@example.com', password: PASSWORD },
      { email: 'owner@example.com', password: 'wrong password!!' },
      { email: 'former@example.com', password: PASSWORD },
      { email: 'pending@example.com', password: PASSWORD },
    ];
    for (const body of attempts) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send(body)
        .expect(401);
      expect(res.body).toMatchObject({ statusCode: 401, message: 'Invalid email or password.' });
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(prisma.sessions).toHaveLength(0);
  });

  it('validates the login body (unknown fields, bad email, missing password)', async () => {
    const bodies = [
      { email: 'owner@example.com', password: PASSWORD, role: 'OWNER' },
      { email: 'not-an-email', password: PASSWORD },
      { email: 'owner@example.com' },
    ];
    for (const body of bodies) {
      await request(app.getHttpServer()).post('/api/v1/auth/login').set('Origin', ORIGIN).send(body).expect(400);
    }
  });

  it('rejects state-changing requests without an allowed Origin (CSRF defence)', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'owner@example.com', password: PASSWORD })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'owner@example.com', password: PASSWORD })
      .expect(403);

    const cookie = await login(app, 'owner@example.com');
    await request(app.getHttpServer())
      .post('/api/v1/e2e-probe/owner-action')
      .set('Cookie', cookie)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/e2e-probe/owner-action')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .expect(201);
  });

  it('GET /auth/me returns the profile with the role from the database', async () => {
    const cookie = await login(app, 'cook@example.com');
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    expect(res.body).toEqual({ id: 'u-kitchen', fullName: 'Cook One', email: 'cook@example.com', role: 'KITCHEN_STAFF' });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('enforces the role matrix server-side (403 for other roles)', async () => {
    const expected: Record<Role, Record<string, number>> = {
      OWNER: { owner: 200, kitchen: 403, waiter: 403, 'any-staff': 200 },
      KITCHEN_STAFF: { owner: 403, kitchen: 200, waiter: 403, 'any-staff': 200 },
      WAITER: { owner: 403, kitchen: 403, waiter: 200, 'any-staff': 200 },
    };
    const emails: Record<Role, string> = {
      OWNER: 'owner@example.com',
      KITCHEN_STAFF: 'cook@example.com',
      WAITER: 'waiter@example.com',
    };
    for (const role of Object.keys(expected) as Role[]) {
      const cookie = await login(app, emails[role]);
      for (const [probe, status] of Object.entries(expected[role])) {
        const res = await request(app.getHttpServer())
          .get(`/api/v1/e2e-probe/${probe}`)
          .set('Cookie', cookie)
          .expect(status);
        if (status === 403) expect(res.body).toMatchObject({ statusCode: 403, error: 'Forbidden' });
      }
    }
  });

  it('logout revokes the session server-side, clears the cookie and is idempotent', async () => {
    const cookie = await login(app, 'waiter@example.com');
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Cookie', cookie)
      .set('Origin', ORIGIN)
      .expect(204);
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect(prisma.sessions[0]?.revokedAt).toBeInstanceOf(Date);

    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Cookie', cookie).set('Origin', ORIGIN).expect(204);
    await request(app.getHttpServer()).post('/api/v1/auth/logout').set('Origin', ORIGIN).expect(204);
  });

  it('deactivating a user revokes access on the very next request', async () => {
    const cookie = await login(app, 'waiter@example.com');
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);

    const waiter = prisma.users.find((user) => user.id === 'u-waiter');
    if (waiter) waiter.isActive = false;

    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    expect(prisma.sessions[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it('rejects expired sessions and forged cookies', async () => {
    const cookie = await login(app, 'owner@example.com');
    const session = prisma.sessions[0];
    if (session) session.expiresAt = new Date(Date.now() - 1_000);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);

    await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Cookie', `${SESSION_COOKIE}=${'A'.repeat(43)}`)
      .expect(401);
  });

  it('issues a new session on re-login and revokes the previous one (no session fixation)', async () => {
    const first = await login(app, 'owner@example.com');
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', first)
      .set('Origin', ORIGIN)
      .send({ email: 'owner@example.com', password: PASSWORD })
      .expect(200);
    const second = sessionCookie(res).split(';')[0] ?? '';

    expect(second).not.toBe(first);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', first).expect(401);
    await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', second).expect(200);
  });

  it('rate-limits login attempts per client (429 after 5 per minute)', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .send({ email: 'owner@example.com', password: 'wrong password!!' })
        .expect(401);
    }
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'owner@example.com', password: PASSWORD })
      .expect(429);
    expect(res.body).toMatchObject({ statusCode: 429 });
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
