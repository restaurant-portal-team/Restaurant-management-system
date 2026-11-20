/** Name of the HttpOnly session cookie. Contains only an opaque random token. */
export const SESSION_COOKIE = 'rmp_session';

/** Cookie is only sent to the API, never to other paths. */
export const SESSION_COOKIE_PATH = '/api/v1';

/** Metadata keys used by the global guards. */
export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Stricter rate limit for POST /auth/login (per client IP). */
export const LOGIN_THROTTLE = { limit: 5, ttl: 60_000 } as const;

/** last_seen_at is written at most this often per session (limits write load). */
export const SESSION_TOUCH_INTERVAL_MS = 60_000;

/** Generic messages: never reveal whether an email exists or why a login failed. */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
export const AUTH_REQUIRED_MESSAGE = 'Authentication required.';
export const FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';
export const ORIGIN_REJECTED_MESSAGE = 'Request origin is not allowed.';
