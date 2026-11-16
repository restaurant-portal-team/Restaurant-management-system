import { Logger } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { HealthService } from './health.service.js';

function createService(queryRaw: () => Promise<unknown>): HealthService {
  const prisma = { $queryRaw: vi.fn(queryRaw) } as unknown as PrismaService;
  return new HealthService(prisma);
}

describe('HealthService', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('reports ok when the database answers', async () => {
    const report = await createService(() => Promise.resolve([{ '?column?': 1 }])).check();
    expect(report.status).toBe('ok');
    expect(report.database).toBe('up');
    expect(Number.isNaN(Date.parse(report.timestamp))).toBe(false);
  });

  it('reports database down without leaking driver details', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = Object.assign(
      new Error('connect ECONNREFUSED postgresql://restaurant_app:secret@127.0.0.1'),
      { code: 'ECONNREFUSED' },
    );

    const report = await createService(() => Promise.reject(error)).check();

    expect(report).toMatchObject({ status: 'error', database: 'down' });
    expect(warn).toHaveBeenCalledWith('Database health check failed (ECONNREFUSED)');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('times out a hanging database check', async () => {
    vi.useFakeTimers();
    try {
      const pending = createService(() => new Promise(() => undefined)).check();
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toMatchObject({ status: 'error', database: 'down' });
    } finally {
      vi.useRealTimers();
    }
  });
});
