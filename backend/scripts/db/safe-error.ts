/**
 * Converts any database/driver error into a short, credential-free classification.
 * Driver messages and URL parse errors can echo connection strings, so they are never printed.
 */
export function safeErrorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    // PostgreSQL SQLSTATE (e.g. 28P01, 42501, 3D000) or Node network codes (e.g. ECONNREFUSED).
    if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  return error instanceof Error ? error.name : 'UNKNOWN_ERROR';
}

/** Human hint for common codes; never includes secrets. */
export function describeCode(code: string): string {
  const hints: Record<string, string> = {
    '28P01': 'password authentication failed (check the password / URL-encoding in your env file)',
    '28000': 'role not permitted to log in',
    '3D000': 'database does not exist',
    '42501': 'insufficient privilege (permission denied)',
    ECONNREFUSED: 'connection refused (is PostgreSQL running on this host/port?)',
    ENOTFOUND: 'host not found',
    ETIMEDOUT: 'connection timed out',
  };
  return hints[code] ?? 'see PostgreSQL error code reference';
}
