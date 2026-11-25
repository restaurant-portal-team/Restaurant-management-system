import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { createFakeStaffDb, type FakeStaffDb, fakeUser } from '../../test/support/fake-staff-db.js';
import type { AuthenticatedStaff } from '../auth/auth.types.js';
import type { AppConfig } from '../config/env.validation.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { buildSetupUrl, hashSetupToken, SETUP_TOKEN_PATTERN } from './setup-token.js';
import { StaffService } from './staff.service.js';
import { staffStatus, toStaffView } from './staff.types.js';

const OWNER: AuthenticatedStaff = {
  id: 'owner-1',
  fullName: 'Owner',
  email: 'owner@example.com',
  role: 'OWNER',
  sessionId: 's1',
};

function config(origins: string[]): ConfigService<AppConfig, true> {
  return { get: () => origins } as unknown as ConfigService<AppConfig, true>;
}

function service(db: FakeStaffDb, origins = ['https://portal.example']): StaffService {
  return new StaffService(db as unknown as PrismaService, config(origins));
}

const tokenOf = (url: string): string => url.split('#token=')[1] ?? '';

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

describe('staff lifecycle helpers', () => {
  it('derives PENDING / ACTIVE / DEACTIVATED from existing columns', () => {
    expect(staffStatus({ isActive: false, deactivatedAt: null })).toBe('PENDING');
    expect(staffStatus({ isActive: true, deactivatedAt: null })).toBe('ACTIVE');
    expect(staffStatus({ isActive: false, deactivatedAt: new Date() })).toBe('DEACTIVATED');
  });

  it('toStaffView never exposes hashes or internal flags', () => {
    const row = {
      ...fakeUser({ id: 'u1', role: 'WAITER', passwordHash: '$argon2id$x' }),
    };
    const view = toStaffView(row);
    expect(Object.keys(view).sort()).toEqual(
      ['activatedAt', 'createdAt', 'deactivatedAt', 'email', 'fullName', 'id', 'role', 'status'].sort(),
    );
  });

  it('builds setup URLs from the trusted origin with the token in the fragment', () => {
    expect(buildSetupUrl('https://portal.example', 'abc')).toBe('https://portal.example/setup-password#token=abc');
  });
});

describe('StaffService', () => {
  let db: FakeStaffDb;
  let staff: StaffService;

  beforeEach(() => {
    db = createFakeStaffDb([
      fakeUser({
        id: 'owner-1',
        role: 'OWNER',
        isActive: true,
        passwordHash: 'h',
        activatedAt: new Date(),
      }),
    ]);
    staff = service(db);
  });

  it('uses the first configured CORS origin (never request headers) and refuses to start without one', () => {
    expect(() => service(db, [])).toThrow(/CORS_ORIGIN/);
  });

  it('create: pending account, 43-char token, only the hash stored, owner recorded as creator', async () => {
    const { staff: view, setup } = await staff.create(
      {
        fullName: '  Sara   Khan ',
        email: 'sara@example.com',
        role: 'KITCHEN_STAFF',
      },
      OWNER,
    );
    const token = tokenOf(setup.url);
    expect(token).toMatch(SETUP_TOKEN_PATTERN);
    expect(setup.url.startsWith('https://portal.example/setup-password#token=')).toBe(true);
    expect(view).toMatchObject({
      fullName: 'Sara Khan',
      status: 'PENDING',
      role: 'KITCHEN_STAFF',
    });
    expect(db.tokens).toHaveLength(1);
    expect(db.tokens[0]?.tokenHash).toBe(hashSetupToken(token));
    expect(db.users.find((u) => u.id === view.id)?.createdById).toBe('owner-1');
  });

  it('create: a duplicate email rolls back and creates no token', async () => {
    await staff.create({ fullName: 'A', email: 'dup@example.com', role: 'WAITER' }, OWNER);
    await expect(
      staff.create({ fullName: 'B', email: 'dup@example.com', role: 'WAITER' }, OWNER),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.users).toHaveLength(2);
    expect(db.tokens).toHaveLength(1);
  });

  it('completeSetup: activates once, hashes with Argon2id, consumes the token', async () => {
    const { staff: view, setup } = await staff.create({ fullName: 'A', email: 'a@example.com', role: 'WAITER' }, OWNER);
    await staff.completeSetup(tokenOf(setup.url), 'a long enough password');
    const user = db.users.find((u) => u.id === view.id);
    expect(user).toMatchObject({ isActive: true });
    expect(user?.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(db.tokens[0]?.usedAt).toBeInstanceOf(Date);
    await expect(staff.completeSetup(tokenOf(setup.url), 'a long enough password')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('completeSetup: rolls back the activation when the token was replaced in between', async () => {
    const { staff: view, setup } = await staff.create({ fullName: 'A', email: 'a@example.com', role: 'WAITER' }, OWNER);
    const original = db.staffSetupToken.updateMany.bind(db.staffSetupToken);
    // Simulate a concurrent regeneration that expires the token right before the claim.
    db.staffSetupToken.updateMany = (args) => {
      for (const t of db.tokens) t.expiresAt = new Date(Date.now() - 1);
      return original(args);
    };
    await expect(staff.completeSetup(tokenOf(setup.url), 'a long enough password')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(db.users.find((u) => u.id === view.id)).toMatchObject({
      isActive: false,
      passwordHash: null,
      activatedAt: null,
    });
  });

  it('update: rejects empty updates and unknown/OWNER targets', async () => {
    await expect(staff.update('owner-1', { fullName: 'x' }, OWNER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(staff.update('missing', { fullName: 'x' }, OWNER)).rejects.toBeInstanceOf(NotFoundException);
    await expect(staff.update('owner-1', {}, OWNER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update: unchanged role does not revoke sessions; a changed role does', async () => {
    const { staff: view } = await staff.create({ fullName: 'A', email: 'a@example.com', role: 'WAITER' }, OWNER);
    db.sessions.push({
      id: 's-a',
      userId: view.id,
      tokenHash: 'x',
      revokedAt: null,
    });
    await staff.update(view.id, { role: 'WAITER' }, OWNER);
    expect(db.sessions[0]?.revokedAt).toBeNull();
    await staff.update(view.id, { role: 'KITCHEN_STAFF' }, OWNER);
    expect(db.sessions[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it('deactivate: revokes sessions and expires outstanding links atomically', async () => {
    const { staff: view, setup } = await staff.create({ fullName: 'A', email: 'a@example.com', role: 'WAITER' }, OWNER);
    db.sessions.push({
      id: 's-a',
      userId: view.id,
      tokenHash: 'x',
      revokedAt: null,
    });
    const result = await staff.deactivate(view.id, OWNER);
    expect(result.status).toBe('DEACTIVATED');
    expect(db.sessions[0]?.revokedAt).toBeInstanceOf(Date);
    expect((db.tokens[0]?.expiresAt as Date).getTime()).toBeLessThanOrEqual(Date.now());
    await expect(staff.completeSetup(tokenOf(setup.url), 'a long enough password')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('activate: only previously activated, deactivated accounts with a password', async () => {
    const { staff: view, setup } = await staff.create({ fullName: 'A', email: 'a@example.com', role: 'WAITER' }, OWNER);
    await expect(staff.activate(view.id, OWNER)).rejects.toThrow(/not completed account setup/);
    await staff.completeSetup(tokenOf(setup.url), 'a long enough password');
    await expect(staff.activate(view.id, OWNER)).rejects.toThrow(/already active/);
    await staff.deactivate(view.id, OWNER);
    expect((await staff.activate(view.id, OWNER)).status).toBe('ACTIVE');
  });

  it('list: filters by status and never returns OWNER accounts', async () => {
    const a = await staff.create({ fullName: 'A', email: 'a@example.com', role: 'WAITER' }, OWNER);
    const b = await staff.create({ fullName: 'B', email: 'b@example.com', role: 'WAITER' }, OWNER);
    await staff.deactivate(b.staff.id, OWNER);
    expect((await staff.list(undefined)).map((s) => s.id).sort()).toEqual([a.staff.id, b.staff.id].sort());
    expect((await staff.list('PENDING')).map((s) => s.id)).toEqual([a.staff.id]);
    expect((await staff.list('DEACTIVATED')).map((s) => s.id)).toEqual([b.staff.id]);
    expect(await staff.list('ACTIVE')).toEqual([]);
  });
});
