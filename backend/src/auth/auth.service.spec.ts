import { Logger, UnauthorizedException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants.js';
import { AuthService } from './auth.service.js';
import * as passwords from './password.js';
import type { SessionService } from './session.service.js';

const PASSWORD = 'correct horse battery';
let passwordHash: string;

beforeAll(async () => {
  passwordHash = await passwords.hashPassword(PASSWORD);
});

function setup(user: Record<string, unknown> | null) {
  const findUnique = vi.fn().mockResolvedValue(user);
  const prisma = { user: { findUnique } } as unknown as PrismaService;
  const create = vi.fn().mockResolvedValue({ token: 'T'.repeat(43), expiresAt: new Date('2026-11-20T22:00:00Z') });
  const sessions = { create } as unknown as SessionService;
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  return { service: new AuthService(prisma, sessions), findUnique, create, warn };
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    fullName: 'Owner One',
    email: 'owner@example.com',
    role: 'OWNER',
    isActive: true,
    passwordHash,
    ...overrides,
  };
}

describe('AuthService.login', () => {
  it('normalises the email, verifies the password and creates a session', async () => {
    const { service, findUnique, create } = setup(activeUser());

    const result = await service.login('  Owner@Example.com ', PASSWORD, 'req-12345678');

    expect(findUnique.mock.calls[0]?.[0].where).toEqual({ email: 'owner@example.com' });
    expect(create).toHaveBeenCalledWith('user-1');
    expect(result.profile).toEqual({ id: 'user-1', fullName: 'Owner One', email: 'owner@example.com', role: 'OWNER' });
    expect(JSON.stringify(result.profile)).not.toMatch(/argon2|passwordHash/);
  });

  it.each([
    ['unknown account', () => null, 'unknown_account'],
    ['inactive account', () => activeUser({ isActive: false }), 'inactive'],
    ['account without password (setup not completed)', () => activeUser({ passwordHash: null }), 'no_password'],
    ['wrong password', () => activeUser(), 'bad_password'],
  ])('rejects %s with the same generic 401 and no session', async (_label, makeUser, reason) => {
    // Built lazily: the shared hash only exists after beforeAll.
    const { service, create, warn } = setup(makeUser());
    const dummy = vi.spyOn(passwords, 'verifyAgainstDummy');
    const password = reason === 'bad_password' ? 'wrong password!!' : PASSWORD;

    const attempt = service.login('owner@example.com', password, 'req-12345678');

    await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(attempt).rejects.toThrow(INVALID_CREDENTIALS_MESSAGE);
    expect(create).not.toHaveBeenCalled();
    if (reason !== 'bad_password') expect(dummy).toHaveBeenCalled();
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain(`reason=${reason}`);
    expect(logged).not.toMatch(/owner@example\.com|correct horse|wrong password/);
  });
});
