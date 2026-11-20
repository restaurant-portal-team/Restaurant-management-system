/**
 * Password hashing and policy (F03). Pure functions with no relative imports, so the same code is used
 * by the NestJS runtime and by the human-run owner bootstrap script (node type-stripping).
 *
 * Argon2id with the OWASP-recommended baseline: m = 19 MiB, t = 2, p = 1 (the @node-rs/argon2
 * defaults; the algorithm default is Argon2id and is asserted by unit tests).
 */
import { hash, verify } from '@node-rs/argon2';

const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

/** Upper bound on any password we will hash or verify (prevents hashing huge inputs). */
export const PASSWORD_MAX_LENGTH = 256;
/** Minimum length for NEW passwords (owner bootstrap now, staff setup in F05). No composition rules (NIST). */
export const NEW_PASSWORD_MIN_LENGTH = 12;
export const NEW_PASSWORD_MAX_LENGTH = 128;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

/** Returns false (never throws) for malformed hashes or oversized input. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  if (plain.length > PASSWORD_MAX_LENGTH) return false;
  try {
    return await verify(storedHash, plain);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burns the same verification cost when the account does not exist, is inactive or has no password,
 * so response timing does not reveal which emails belong to staff (user enumeration).
 */
export async function verifyAgainstDummy(plain: string): Promise<void> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  await verifyPassword(await dummyHash, plain.slice(0, PASSWORD_MAX_LENGTH));
}

/** Returns a problem description for a NEW password, or null when acceptable. */
export function newPasswordProblem(password: string, email?: string): string | null {
  if (password.length < NEW_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${NEW_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > NEW_PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${NEW_PASSWORD_MAX_LENGTH} characters.`;
  }
  if (password.trim() !== password) return 'Password must not start or end with spaces.';
  if (password.toLowerCase() === email?.toLowerCase()) {
    return 'Password must not be the same as the email address.';
  }
  return null;
}

/** Staff emails are stored trimmed and lower-cased (DB CHECK users_email_normalised_chk). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
