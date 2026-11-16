/**
 * Static (offline) PostgreSQL destination comparison — LEVEL 1 shadow-database guard.
 *
 * Used by prisma.config.ts on EVERY Prisma CLI invocation (including direct `npx prisma ...`)
 * to refuse configurations where the migration database and the shadow database resolve to
 * the same destination. Prisma wipes the shadow database, so pointing it at the real
 * database would destroy data.
 *
 * LIMITATIONS (defense-in-depth, not an absolute guarantee):
 * - Works on URL text only; no DNS resolution and no network access. Two different host names
 *   that resolve to the same server (e.g. the machine's own hostname vs 127.0.0.1, a LAN IP,
 *   hosts-file aliases, port forwarding or proxies) cannot be detected here. The LEVEL 2 live
 *   identity preflight (scripts/db/assert-isolation.ts) covers those cases when it is run.
 * - Loopback names (localhost, 127.0.0.0/8, ::1) are treated as the same machine on purpose,
 *   so the guard is conservative (may refuse, never silently allow) for local setups.
 *
 * SECURITY: error messages never include URLs, user names or passwords.
 */

export interface PgDestination {
  /** Normalised host: 'loopback', 'socket:<path>' or a lower-cased host name / IP. */
  host: string;
  port: number;
  /** Database name; PostgreSQL defaults it to the user name when omitted. */
  database: string;
}

const DEFAULT_PG_PORT = 5432;

export class UnsafeDatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeDatabaseConfigError';
  }
}

function isLoopback(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '0:0:0:0:0:0:0:1' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

function normaliseHost(rawHost: string): string {
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host === '' || host.startsWith('/')) {
    return `socket:${host || 'default'}`;
  }
  return isLoopback(host) ? 'loopback' : host;
}

/**
 * Parses a PostgreSQL connection URL into a comparable destination.
 * @param label Variable name used in error messages (never the value).
 */
export function parsePgDestination(url: string, label: string): PgDestination {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UnsafeDatabaseConfigError(`${label} is not a valid PostgreSQL connection URL.`);
  }

  if (parsed.protocol !== 'postgresql:' && parsed.protocol !== 'postgres:') {
    throw new UnsafeDatabaseConfigError(`${label} must use the postgresql:// scheme.`);
  }

  // libpq / node-postgres allow overriding host and port through query parameters.
  const hostOverride = parsed.searchParams.get('host');
  const portOverride = parsed.searchParams.get('port');

  let decodedHost: string;
  let database: string;
  let user: string;
  try {
    decodedHost = decodeURIComponent(hostOverride ?? parsed.hostname);
    database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    user = decodeURIComponent(parsed.username);
  } catch {
    throw new UnsafeDatabaseConfigError(`${label} contains invalid percent-encoding.`);
  }

  const portText = portOverride ?? parsed.port;
  const port = portText === '' ? DEFAULT_PG_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UnsafeDatabaseConfigError(`${label} has an invalid port.`);
  }

  const effectiveDatabase = database || user;
  if (!effectiveDatabase) {
    throw new UnsafeDatabaseConfigError(`${label} must name a database.`);
  }

  return { host: normaliseHost(decodedHost), port, database: effectiveDatabase };
}

export function isSameDestination(a: PgDestination, b: PgDestination): boolean {
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

/**
 * Throws if the shadow database could be the main migration database.
 * Fails safe: any unparsable URL is rejected instead of being ignored.
 */
export function assertShadowIsolatedStatic(
  migrationUrl: string | undefined,
  shadowUrl: string | undefined,
): void {
  if (shadowUrl === undefined) return;
  if (migrationUrl === undefined) {
    throw new UnsafeDatabaseConfigError(
      'SHADOW_DATABASE_URL is set but MIGRATION_DATABASE_URL is missing.',
    );
  }

  const main = parsePgDestination(migrationUrl, 'MIGRATION_DATABASE_URL');
  const shadow = parsePgDestination(shadowUrl, 'SHADOW_DATABASE_URL');

  if (isSameDestination(main, shadow)) {
    throw new UnsafeDatabaseConfigError(
      'Refusing to run: SHADOW_DATABASE_URL resolves to the same database as ' +
        'MIGRATION_DATABASE_URL. Prisma wipes the shadow database; it must be a separate database.',
    );
  }
}
