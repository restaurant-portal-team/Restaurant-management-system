import {
  hashPassword,
  newPasswordProblem,
  normalizeEmail,
  PASSWORD_MAX_LENGTH,
  verifyAgainstDummy,
  verifyPassword,
} from './password.js';

describe('password hashing (Argon2id)', () => {
  it('hashes with Argon2id and the OWASP baseline parameters, never storing plaintext', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(hash).not.toContain('correct horse battery');
  });

  it('uses a random salt (same password, different hashes)', async () => {
    expect(await hashPassword('same-password-123')).not.toBe(await hashPassword('same-password-123'));
  });

  it('verifies correct and rejects wrong passwords', async () => {
    const hash = await hashPassword('correct horse battery');
    await expect(verifyPassword(hash, 'correct horse battery')).resolves.toBe(true);
    await expect(verifyPassword(hash, 'wrong horse battery')).resolves.toBe(false);
  });

  it('returns false instead of throwing for malformed hashes or oversized input', async () => {
    await expect(verifyPassword('not-a-hash', 'whatever')).resolves.toBe(false);
    const hash = await hashPassword('x'.repeat(20));
    await expect(verifyPassword(hash, 'x'.repeat(PASSWORD_MAX_LENGTH + 1))).resolves.toBe(false);
  });

  it('dummy verification completes without throwing (timing equalisation)', async () => {
    await expect(verifyAgainstDummy('anything')).resolves.toBeUndefined();
    await expect(verifyAgainstDummy('y'.repeat(10_000))).resolves.toBeUndefined();
  });
});

describe('newPasswordProblem', () => {
  it('enforces length 12-128, no surrounding spaces and not equal to the email', () => {
    expect(newPasswordProblem('short')).toMatch(/at least 12/);
    expect(newPasswordProblem('a'.repeat(129))).toMatch(/at most 128/);
    expect(newPasswordProblem(' leading-space-pw')).toMatch(/spaces/);
    expect(newPasswordProblem('owner@example.com', 'OWNER@example.com')).toMatch(/email/);
    expect(newPasswordProblem('a long enough passphrase', 'owner@example.com')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('trims and lower-cases (matches the DB CHECK)', () => {
    expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
  });
});
