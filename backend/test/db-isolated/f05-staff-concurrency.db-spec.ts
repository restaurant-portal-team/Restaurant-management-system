/**
 * F05 concurrency tests on the ISOLATED database restaurant_test (never restaurant_dev).
 * The real StaffService runs against real PostgreSQL; requests race through independent pooled
 * connections (Promise.allSettled), so row locks and READ COMMITTED re-evaluation are exercised for real.
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AuthenticatedStaff } from '../../src/auth/auth.types.js';
import type { AppConfig } from '../../src/config/env.validation.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { hashSetupToken } from '../../src/staff/setup-token.js';
import { StaffService } from '../../src/staff/staff.service.js';
import { connectIsolated } from './isolated-db.ts';

const ROUNDS = 5;
const PASSWORD = 'a long enough staff password';
const config = {
  get: () => ['http://localhost:5173'],
} as unknown as ConfigService<AppConfig, true>;

const tokenOf = (url: string): string => url.split('#token=')[1] ?? '';
const unique = (): string => `f05.${randomUUID()}@example.test`;

describe('F05 concurrency (restaurant_app @ restaurant_test, committed throw-away rows)', () => {
  let prisma: PrismaClient;
  let staff: StaffService;
  let owner: AuthenticatedStaff;

  beforeAll(async () => {
    prisma = await connectIsolated();
    staff = new StaffService(prisma as unknown as PrismaService, config);
    const row = await prisma.user.create({
      data: {
        fullName: 'F05 Concurrency Owner',
        email: unique(),
        role: 'OWNER',
        isActive: true,
        passwordHash: '$argon2id$not-a-real-hash',
        activatedAt: new Date(),
      },
    });
    owner = {
      id: row.id,
      fullName: row.fullName,
      email: row.email,
      role: 'OWNER',
      sessionId: 'n/a',
    };
  });

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const pending = () => staff.create({ fullName: 'Concurrent Staff', email: unique(), role: 'WAITER' }, owner);

  const outstanding = (userId: string) =>
    prisma.staffSetupToken.count({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
    });

  it('the same setup token is consumed exactly once under parallel requests', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { staff: view, setup } = await pending();
      const token = tokenOf(setup.url);
      const results = await Promise.allSettled(Array.from({ length: 6 }, () => staff.completeSetup(token, PASSWORD)));

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const row = await prisma.staffSetupToken.findUniqueOrThrow({
        where: { tokenHash: hashSetupToken(token) },
      });
      expect(row.usedAt).toBeInstanceOf(Date);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: view.id },
      });
      expect(user.isActive).toBe(true);
      expect(await outstanding(view.id)).toBe(0);
    }
  });

  it('regeneration racing with setup leaves exactly one consistent outcome', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { staff: view, setup } = await pending();
      const results = await Promise.allSettled([
        staff.completeSetup(tokenOf(setup.url), PASSWORD),
        staff.regenerateSetupLink(view.id, owner),
        staff.regenerateSetupLink(view.id, owner),
      ]);
      const [setupResult] = results;
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: view.id },
      });

      if (setupResult.status === 'fulfilled') {
        // Setup won: the account is active and no link is usable (regenerations after it were refused).
        expect(user.isActive).toBe(true);
        expect(await outstanding(view.id)).toBe(0);
      } else {
        // A regeneration won first: the old token is dead and exactly one new link remains usable.
        expect(user.isActive).toBe(false);
        expect(user.passwordHash).toBeNull();
        expect(await outstanding(view.id)).toBe(1);
        const old = await prisma.staffSetupToken.findUniqueOrThrow({
          where: { tokenHash: hashSetupToken(tokenOf(setup.url)) },
        });
        expect(old.usedAt).toBeNull();
        expect(old.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
      }
    }
  });

  it('deactivation racing with setup never leaves an active account', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { staff: view, setup } = await pending();
      const [setupResult, deactivateResult] = await Promise.allSettled([
        staff.completeSetup(tokenOf(setup.url), PASSWORD),
        staff.deactivate(view.id, owner),
      ]);
      expect(deactivateResult.status).toBe('fulfilled');
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: view.id },
      });
      expect(user.isActive).toBe(false);
      expect(user.deactivatedAt).toBeInstanceOf(Date);
      expect(await outstanding(view.id)).toBe(0);
      // If setup lost the race, nothing about the account changed.
      if (setupResult.status === 'rejected') expect(user.passwordHash).toBeNull();
    }
  });

  it('an email change racing with setup: exactly one of them succeeds', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const { staff: view, setup } = await pending();
      const newEmail = unique();
      const [setupResult, emailResult] = await Promise.allSettled([
        staff.completeSetup(tokenOf(setup.url), PASSWORD),
        staff.update(view.id, { email: newEmail }, owner),
      ]);
      expect([setupResult.status, emailResult.status].filter((s) => s === 'fulfilled')).toHaveLength(1);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: view.id },
      });
      if (emailResult.status === 'fulfilled') {
        expect(user.email).toBe(newEmail);
        expect(user.isActive).toBe(false);
        expect(await outstanding(view.id)).toBe(0);
      } else {
        expect(user.isActive).toBe(true);
        expect(user.email).toBe(view.email);
      }
    }
  });

  it('parallel deactivations succeed once; role changes and deactivation revoke every session', async () => {
    const { staff: view, setup } = await pending();
    await staff.completeSetup(tokenOf(setup.url), PASSWORD);
    const sessionData = () => ({
      userId: view.id,
      tokenHash: hashSetupToken(randomUUID()),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await prisma.staffSession.createMany({
      data: [sessionData(), sessionData()],
    });

    await staff.update(view.id, { role: 'KITCHEN_STAFF' }, owner);
    expect(
      await prisma.staffSession.count({
        where: { userId: view.id, revokedAt: null },
      }),
    ).toBe(0);

    await prisma.staffSession.create({ data: sessionData() });
    const results = await Promise.allSettled([1, 2, 3].map(() => staff.deactivate(view.id, owner)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      await prisma.staffSession.count({
        where: { userId: view.id, revokedAt: null },
      }),
    ).toBe(0);
  });

  it('OWNER accounts cannot be changed through the service, even when targeted directly', async () => {
    await expect(staff.deactivate(owner.id, owner)).rejects.toThrow('Staff member not found.');
    await expect(staff.update(owner.id, { role: 'WAITER' }, owner)).rejects.toThrow('Staff member not found.');
    await expect(staff.regenerateSetupLink(owner.id, owner)).rejects.toThrow('Staff member not found.');
    const row = await prisma.user.findUniqueOrThrow({
      where: { id: owner.id },
    });
    expect(row).toMatchObject({
      role: 'OWNER',
      isActive: true,
      deactivatedAt: null,
    });
  });
});
