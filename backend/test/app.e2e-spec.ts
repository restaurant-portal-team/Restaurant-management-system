import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * End-to-end tests with the real HTTP setup (prefix, Helmet, CORS, validation, filter, throttling)
 * and a mocked PrismaService, so no database or credentials are needed.
 */
const prismaMock = { $queryRaw: vi.fn(), $disconnect: vi.fn() };

async function createApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(prismaMock)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>({ logger: false });
  configureApp(app);
  await app.init();
  return app;
}

describe('API foundation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    prismaMock.$queryRaw.mockReset();
  });

  describe('GET /api/v1/health', () => {
    it('returns 200 with the minimal public contract when the database is up', async () => {
      prismaMock.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(Object.keys(res.body as object).sort()).toEqual(['database', 'status', 'timestamp']);
      expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('returns 503 with a safe body when the database is down', async () => {
      prismaMock.$queryRaw.mockRejectedValue(
        Object.assign(new Error('password authentication failed for secret-pw'), {
          code: '28P01',
        }),
      );

      const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);

      expect(res.body).toMatchObject({ status: 'error', database: 'down' });
      expect(JSON.stringify(res.body)).not.toMatch(/secret|password|28P01|stack/i);
    });

    it('is only served under the /api/v1 prefix', async () => {
      await request(app.getHttpServer()).get('/health').expect(404);
    });
  });

  describe('security headers', () => {
    it('applies Helmet headers and hides x-powered-by', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const res = await request(app.getHttpServer()).get('/api/v1/health');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('CORS', () => {
    it('allows the configured frontend origin', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'http://localhost:5173');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not grant CORS to other origins (including preflight)', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('Origin', 'https://evil.example');
      expect(res.headers['access-control-allow-origin']).toBeUndefined();

      const preflight = await request(app.getHttpServer())
        .options('/api/v1/health')
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'GET');
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('returns a consistent, safe 404 body without stack traces', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);

      expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
      expect(typeof (res.body as { requestId: unknown }).requestId).toBe('string');
      expect(JSON.stringify(res.body)).not.toMatch(/stack|node_modules|\\src\\|\/src\//i);
    });
  });

  describe('request id', () => {
    it('echoes a safe x-request-id and replaces unsafe ones', async () => {
      prismaMock.$queryRaw.mockResolvedValue([]);
      const safe = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Request-Id', 'test-req-12345');
      expect(safe.headers['x-request-id']).toBe('test-req-12345');

      const unsafe = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('X-Request-Id', 'bad id with spaces');
      expect(unsafe.headers['x-request-id']).not.toBe('bad id with spaces');
    });
  });
});

describe('rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 429 with a safe body after the configured limit', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const server = app.getHttpServer();
    // THROTTLE_LIMIT=5 in vitest.config.e2e.ts
    for (let i = 0; i < 5; i += 1) {
      await request(server).get('/api/v1/health').expect(200);
    }
    const res = await request(server).get('/api/v1/health').expect(429);
    expect(res.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
  });
});
