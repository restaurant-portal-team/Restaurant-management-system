/**
 * Helpers for the rollback-only database behavioral suite (F02 Gate C).
 *
 * SAFETY:
 * - Connects ONLY with the runtime role (DATABASE_URL from backend/.env, read into memory; never printed).
 * - Refuses to run unless current_user = restaurant_app AND current_database() = restaurant_dev.
 * - Every write happens inside BEGIN ... ROLLBACK (inRollback). There is no COMMIT anywhere in this suite.
 * - Expected failures run inside SAVEPOINTs so the surrounding transaction stays usable.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { BACKEND_ROOT, loadMigrationEnv } from '../../scripts/db/migration-env.ts';

export const EXPECTED_ROLE = 'restaurant_app';
export const EXPECTED_DATABASE = 'restaurant_dev';

export function runtimeUrl(): string {
  const file = resolve(BACKEND_ROOT, '.env');
  if (!existsSync(file)) throw new Error('backend/.env is missing');
  const value = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL?.trim();
  if (!value) throw new Error('DATABASE_URL is missing in backend/.env');
  return value;
}

export async function connectRuntime(): Promise<pg.Client> {
  const client = new pg.Client({
    connectionString: runtimeUrl(),
    application_name: 'f02-gate-c-behavioral',
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  const who = await client.query<{ role: string; db: string }>(
    'SELECT current_user::text AS role, current_database() AS db',
  );
  const row = who.rows[0];
  if (row?.role !== EXPECTED_ROLE || row.db !== EXPECTED_DATABASE) {
    await client.end();
    throw new Error('Refusing to run: not connected as restaurant_app to restaurant_dev');
  }
  await client.query("SET statement_timeout = '15s'");
  return client;
}

/**
 * READ-ONLY migrator-side connection (MIGRATION_DATABASE_URL from backend/.env.migrate, never printed).
 * Used only for verifying migration history/ownership. The session is forced read-only
 * (default_transaction_read_only = on), so any write attempt fails with SQLSTATE 25006.
 */
export async function connectMigratorReadOnly(): Promise<pg.Client> {
  const { migrationUrl } = loadMigrationEnv();
  if (!migrationUrl) throw new Error('MIGRATION_DATABASE_URL is missing in backend/.env.migrate');
  const client = new pg.Client({
    connectionString: migrationUrl,
    application_name: 'f02-migration-history-readonly',
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  await client.query('SET default_transaction_read_only = on');
  await client.query("SET statement_timeout = '15s'");
  const who = await client.query<{ role: string; db: string; ro: string }>(
    "SELECT current_user::text AS role, current_database() AS db, current_setting('default_transaction_read_only') AS ro",
  );
  const row = who.rows[0];
  if (row?.role !== 'restaurant_migrator' || row.db !== EXPECTED_DATABASE || row.ro !== 'on') {
    await client.end();
    throw new Error('Refusing to run: not a read-only restaurant_migrator session on restaurant_dev');
  }
  return client;
}

/** Runs fn inside a transaction that is ALWAYS rolled back. */
export async function inRollback<T>(client: pg.Client, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

export type QueryOutcome =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number }
  | { ok: false; code: string; constraint: string | undefined };

let savepointCounter = 0;

/** Executes one statement inside a SAVEPOINT; failures are captured and rolled back to the savepoint. */
export async function tryQuery(
  client: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<QueryOutcome> {
  savepointCounter += 1;
  const savepoint = `gate_c_sp_${savepointCounter}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    const result = await client.query<Record<string, unknown>>(sql, params);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return { ok: true, rows: result.rows, rowCount: result.rowCount ?? 0 };
  } catch (error: unknown) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    const dbError = error as Partial<pg.DatabaseError>;
    return { ok: false, code: dbError.code ?? 'UNKNOWN', constraint: dbError.constraint };
  }
}

export function failureOf(outcome: QueryOutcome): { code: string; constraint: string | undefined } {
  return outcome.ok
    ? { code: 'NO_ERROR', constraint: undefined }
    : { code: outcome.code, constraint: outcome.constraint };
}
