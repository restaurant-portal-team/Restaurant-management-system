/**
 * F02 — READ-ONLY migrator-side verification of migration history and Gate D privilege state.
 *
 * Runs as restaurant_migrator on restaurant_dev in a forced read-only session (no writes possible).
 * The runtime role (restaurant_app) intentionally has no access to _prisma_migrations after Gate D,
 * so migration history is verified here instead of in the runtime behavioral suite.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type pg from 'pg';
import { BACKEND_ROOT } from '../../scripts/db/migration-env.ts';
import { connectMigratorReadOnly } from './db-helpers.ts';

const MIGRATIONS = ['20261116145432_init_schema', '20261116153418_name_key_builtin_lower'] as const;

function localChecksum(name: string): string {
  return createHash('sha256')
    .update(readFileSync(join(BACKEND_ROOT, 'prisma', 'migrations', name, 'migration.sql')))
    .digest('hex');
}

describe('F02 migration history and Gate D state (read-only, restaurant_migrator @ restaurant_dev)', () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await connectMigratorReadOnly();
  });

  afterAll(async () => {
    await client.end();
  });

  it('records exactly the approved migrations, finished, not rolled back, no logs, checksums == local files', async () => {
    const result = await client.query<{
      migration_name: string;
      checksum: string;
      finished: boolean;
      rolled_back: boolean;
      has_logs: boolean;
      applied_steps_count: number;
    }>(
      `SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back,
              logs IS NOT NULL AS has_logs, applied_steps_count
         FROM public._prisma_migrations ORDER BY migration_name`,
    );
    expect(result.rows.map((row) => row.migration_name)).toEqual([...MIGRATIONS]);
    for (const row of result.rows) {
      expect(row, row.migration_name).toMatchObject({
        checksum: localChecksum(row.migration_name),
        finished: true,
        rolled_back: false,
        has_logs: false,
        applied_steps_count: 1,
      });
    }
  });

  it('migrator retains full access to _prisma_migrations and its own CONNECT/CREATE/TEMPORARY', async () => {
    const result = await client.query<Record<string, boolean | string>>(
      `SELECT pg_get_userbyid(c.relowner) AS owner,
              has_table_privilege('public._prisma_migrations', 'SELECT') AS sel,
              has_table_privilege('public._prisma_migrations', 'INSERT') AS ins,
              has_table_privilege('public._prisma_migrations', 'UPDATE') AS upd,
              has_table_privilege('public._prisma_migrations', 'DELETE') AS del,
              has_database_privilege(current_database(), 'CONNECT') AS db_connect,
              has_database_privilege(current_database(), 'CREATE') AS db_create,
              has_database_privilege(current_database(), 'TEMPORARY') AS db_temp
         FROM pg_class c WHERE c.oid = 'public._prisma_migrations'::regclass`,
    );
    expect(result.rows[0]).toEqual({
      owner: 'restaurant_migrator',
      sel: true,
      ins: true,
      upd: true,
      del: true,
      db_connect: true,
      db_create: true,
      db_temp: true,
    });
  });

  it('Gate D: hardened ACLs on _prisma_migrations and restaurant_dev (effective privileges of restaurant_app)', async () => {
    const result = await client.query<Record<string, boolean | string | null>>(
      `SELECT has_table_privilege('restaurant_app', 'public._prisma_migrations', 'SELECT') AS app_sel,
              has_table_privilege('restaurant_app', 'public._prisma_migrations', 'INSERT') AS app_ins,
              has_table_privilege('restaurant_app', 'public._prisma_migrations', 'UPDATE') AS app_upd,
              has_table_privilege('restaurant_app', 'public._prisma_migrations', 'DELETE') AS app_del,
              has_database_privilege('restaurant_app', current_database(), 'TEMPORARY') AS app_temp,
              has_database_privilege('restaurant_app', current_database(), 'CONNECT') AS app_connect,
              (SELECT relacl::text FROM pg_class WHERE oid = 'public._prisma_migrations'::regclass) AS relacl,
              (SELECT datacl::text FROM pg_database WHERE datname = current_database()) AS datacl`,
    );
    expect(result.rows[0]).toEqual({
      app_sel: false,
      app_ins: false,
      app_upd: false,
      app_del: false,
      app_temp: false,
      app_connect: true,
      relacl: '{restaurant_migrator=arwdDxtm/restaurant_migrator}',
      datacl: '{restaurant_migrator=CTc/restaurant_migrator,restaurant_app=c/restaurant_migrator}',
    });
  });

  it('Gate E: exact ACLs and effective runtime privileges on the audit tables', async () => {
    const result = await client.query<Record<string, boolean | string | null>>(
      `SELECT (SELECT relacl::text FROM pg_class WHERE oid = 'public.inventory_movements'::regclass) AS movements_acl,
              (SELECT relacl::text FROM pg_class WHERE oid = 'public.payments'::regclass) AS payments_acl,
              has_table_privilege('restaurant_app', 'public.inventory_movements', 'SELECT') AS mov_sel,
              has_table_privilege('restaurant_app', 'public.inventory_movements', 'INSERT') AS mov_ins,
              has_table_privilege('restaurant_app', 'public.inventory_movements', 'UPDATE') AS mov_upd,
              has_table_privilege('restaurant_app', 'public.inventory_movements', 'DELETE') AS mov_del,
              has_any_column_privilege('restaurant_app', 'public.inventory_movements', 'UPDATE') AS mov_col_upd,
              has_table_privilege('restaurant_app', 'public.payments', 'SELECT') AS pay_sel,
              has_table_privilege('restaurant_app', 'public.payments', 'INSERT') AS pay_ins,
              has_table_privilege('restaurant_app', 'public.payments', 'UPDATE') AS pay_upd,
              has_table_privilege('restaurant_app', 'public.payments', 'DELETE') AS pay_del,
              has_table_privilege('restaurant_migrator', 'public.inventory_movements', 'UPDATE') AS mig_mov_upd,
              has_table_privilege('restaurant_migrator', 'public.payments', 'DELETE') AS mig_pay_del`,
    );
    expect(result.rows[0]).toEqual({
      movements_acl: '{restaurant_app=ar/restaurant_migrator,restaurant_migrator=arwdDxtm/restaurant_migrator}',
      payments_acl: '{restaurant_app=arw/restaurant_migrator,restaurant_migrator=arwdDxtm/restaurant_migrator}',
      mov_sel: true,
      mov_ins: true,
      mov_upd: false,
      mov_del: false,
      mov_col_upd: false,
      pay_sel: true,
      pay_ins: true,
      pay_upd: true,
      pay_del: false,
      mig_mov_upd: true,
      mig_pay_del: true,
    });
  });

  it('this verification session is genuinely read-only (write attempt -> 25006)', async () => {
    await expect(client.query('CREATE TABLE public.gate_d_ro_probe (x int)')).rejects.toMatchObject({
      code: '25006',
    });
  });
});
