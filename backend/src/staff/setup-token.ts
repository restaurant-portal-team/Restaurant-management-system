import { createHash, randomBytes } from 'node:crypto';

/** S2: setup links are valid for 24 hours. */
export const SETUP_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** 32 random bytes, base64url without padding = 43 characters. */
export const SETUP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** Rate limit for the public POST /staff/setup-password (per client IP). */
export const SETUP_PASSWORD_THROTTLE = { limit: 5, ttl: 60_000 } as const;

/** Generic message for every unusable link: unknown, used, expired, replaced, or account no longer pending. */
export const INVALID_SETUP_LINK_MESSAGE = 'This setup link is invalid or has expired. Ask the owner for a new link.';

/** Lowercase hex SHA-256. Only this hash is stored (staff_setup_tokens.token_hash); the raw token never is. */
export function hashSetupToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateSetupToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSetupToken(token) };
}

/**
 * The token travels in the URL fragment (#token=...), which browsers never send to servers or in Referer
 * headers. The origin comes from trusted configuration (the first CORS_ORIGIN entry), never from Host headers.
 */
export function buildSetupUrl(webOrigin: string, token: string): string {
  return `${webOrigin}/setup-password#token=${token}`;
}
