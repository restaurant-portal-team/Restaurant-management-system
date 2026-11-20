import type { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/env.validation.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { hashSessionToken, SessionService } from './session.service.js';

const NOW = new Date('2026-11-20T10:00:00.000Z');
const minutes = (n: number): number => n * 60_000;

function setup() {
  const staffSession = {
    create: vi.fn().mockResolvedValue({ id: 'session-1' }),
    findUnique: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = { staffSession } as unknown as PrismaService;
  const values: Record<string, number> = { SESSION_ABSOLUTE_TTL_MINUTES: 720, SESSION_IDLE_TIMEOUT_MINUTES: 120 };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<AppConfig, true>;
  return { service: new SessionService(prisma, config), staffSession };
}

function storedSession(overrides: Record<string, unknown> = {}, user: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    lastSeenAt: new Date(NOW.getTime() - minutes(5)),
    expiresAt: new Date(NOW.getTime() + minutes(600)),
    revokedAt: null,
    user: { id: 'user-1', fullName: 'Owner One', email: 'owner@example.com', role: 'OWNER', isActive: true, ...user },
    ...overrides,
  };
}

const VALID_TOKEN = 'A'.repeat(43);

describe('SessionService', () => {
  it('creates a 43-char random token, stores ONLY its SHA-256 hash, and expires after 12 h', async () => {
    const { service, staffSession } = setup();
    const { token, expiresAt } = await service.create('user-1', NOW);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime() - NOW.getTime()).toBe(minutes(720));
    const data = staffSession.create.mock.calls[0]?.[0].data as Record<string, unknown>;
    expect(data.tokenHash).toBe(hashSessionToken(token));
    expect(data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(data)).not.toContain(token);
  });

  it('issues a different token for every session', async () => {
    const { service } = setup();
    const a = await service.create('user-1', NOW);
    const b = await service.create('user-1', NOW);
    expect(a.token).not.toBe(b.token);
  });

  it('rejects missing or malformed tokens without querying the database', async () => {
    const { service, staffSession } = setup();
    await expect(service.validate(undefined, NOW)).resolves.toBeNull();
    await expect(service.validate("x' OR 1=1 --", NOW)).resolves.toBeNull();
    await expect(service.validate('A'.repeat(44), NOW)).resolves.toBeNull();
    expect(staffSession.findUnique).not.toHaveBeenCalled();
  });

  it('looks sessions up by token hash and returns the staff member with the role from the DB', async () => {
    const { service, staffSession } = setup();
    staffSession.findUnique.mockResolvedValue(storedSession());

    const staff = await service.validate(VALID_TOKEN, NOW);

    expect(staffSession.findUnique.mock.calls[0]?.[0].where).toEqual({ tokenHash: hashSessionToken(VALID_TOKEN) });
    expect(staff).toEqual({
      id: 'user-1',
      fullName: 'Owner One',
      email: 'owner@example.com',
      role: 'OWNER',
      sessionId: 'session-1',
    });
  });

  it.each([
    ['unknown token', null],
    ['revoked session', storedSession({ revokedAt: new Date(NOW.getTime() - minutes(1)) })],
  ])('returns null for an %s', async (_label, row) => {
    const { service, staffSession } = setup();
    staffSession.findUnique.mockResolvedValue(row);
    await expect(service.validate(VALID_TOKEN, NOW)).resolves.toBeNull();
  });

  it.each([
    ['absolute expiry reached', storedSession({ expiresAt: NOW })],
    ['idle for 2 h', storedSession({ lastSeenAt: new Date(NOW.getTime() - minutes(120)) })],
    ['user deactivated', storedSession({}, { isActive: false })],
  ])('rejects AND revokes the session when %s', async (_label, row) => {
    const { service, staffSession } = setup();
    staffSession.findUnique.mockResolvedValue(row);

    await expect(service.validate(VALID_TOKEN, NOW)).resolves.toBeNull();
    expect(staffSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', revokedAt: null },
      data: { revokedAt: NOW },
    });
  });

  it('touches last_seen_at at most once per minute', async () => {
    const { service, staffSession } = setup();
    staffSession.findUnique.mockResolvedValue(storedSession({ lastSeenAt: new Date(NOW.getTime() - 30_000) }));
    await service.validate(VALID_TOKEN, NOW);
    expect(staffSession.updateMany).not.toHaveBeenCalled();

    staffSession.findUnique.mockResolvedValue(storedSession({ lastSeenAt: new Date(NOW.getTime() - minutes(2)) }));
    await service.validate(VALID_TOKEN, NOW);
    expect(staffSession.updateMany).toHaveBeenCalledWith({
      where: { id: 'session-1', revokedAt: null },
      data: { lastSeenAt: NOW },
    });
  });

  it('revokeByToken is idempotent and ignores malformed tokens', async () => {
    const { service, staffSession } = setup();
    await service.revokeByToken('bad token', NOW);
    expect(staffSession.updateMany).not.toHaveBeenCalled();

    await service.revokeByToken(VALID_TOKEN, NOW);
    expect(staffSession.updateMany).toHaveBeenCalledWith({
      where: { tokenHash: hashSessionToken(VALID_TOKEN), revokedAt: null },
      data: { revokedAt: NOW },
    });
  });
});
