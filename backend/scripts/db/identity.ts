/**
 * Live database identity — LEVEL 2 shadow-database guard (read-only).
 *
 * Identity tuple obtained from the server itself (no superuser privileges required):
 *   - pg_postmaster_start_time() + inet_server_port()  -> identifies the running PostgreSQL cluster
 *   - OID of current_database() in that cluster        -> identifies the database
 *
 * LIMITATIONS (defense-in-depth, not an absolute guarantee):
 * - Two different clusters are distinguished by start time + port; two clusters started in the
 *   same microsecond on the same port behind different hosts would be indistinguishable
 *   (practically impossible, but not a cryptographic guarantee).
 * - The check reflects the moment it runs. Connection poolers/proxies that route the same URL to
 *   different servers over time are out of scope.
 * - It only protects commands launched through the npm db:* scripts; direct `npx prisma` calls
 *   rely on the LEVEL 1 static guard in prisma.config.ts.
 */
import pg from 'pg';

export interface DatabaseIdentity {
  database: string;
  databaseOid: string;
  startedAt: string;
  serverPort: number | null;
  role: string;
}

const IDENTITY_SQL = `
  SELECT current_database()                                                   AS database,
         (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
         pg_postmaster_start_time()::text                                       AS started_at,
         inet_server_port()                                                     AS server_port,
         current_user::text                                                     AS role`;

interface IdentityRow {
  database: string;
  database_oid: string;
  started_at: string;
  server_port: number | null;
  role: string;
}

export function createClient(connectionString: string): pg.Client {
  return new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    application_name: 'restaurant-portal-db-check',
  });
}

export async function withClient<T>(
  connectionString: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = createClient(connectionString);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function fetchIdentity(connectionString: string): Promise<DatabaseIdentity> {
  return withClient(connectionString, async (client) => {
    const result = await client.query<IdentityRow>(IDENTITY_SQL);
    const row = result.rows[0];
    if (!row) throw new Error('Identity query returned no rows');
    return {
      database: row.database,
      databaseOid: row.database_oid,
      startedAt: row.started_at,
      serverPort: row.server_port,
      role: row.role,
    };
  });
}

export function isSameCluster(a: DatabaseIdentity, b: DatabaseIdentity): boolean {
  return a.startedAt === b.startedAt && a.serverPort === b.serverPort;
}

export function isSameDatabase(a: DatabaseIdentity, b: DatabaseIdentity): boolean {
  return isSameCluster(a, b) && a.databaseOid === b.databaseOid;
}
