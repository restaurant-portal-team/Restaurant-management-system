/**
 * F02 Gate C — rollback-only behavioral tests against restaurant_dev as restaurant_app.
 * Human-approved 2026-11-16. Every write is rolled back; no COMMIT exists in this suite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import type pg from 'pg';
import { BACKEND_ROOT } from '../../scripts/db/migration-env.ts';
import { normalizeName } from '../../src/common/name-normalization.js';
import { PG_SIMPLE_LOWER_PAIRS } from '../../src/common/unicode/pg-simple-lower.generated.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { connectRuntime, failureOf, inRollback, runtimeUrl, tryQuery } from './db-helpers.ts';

const APP_TABLES = [
  'users',
  'staff_setup_tokens',
  'restaurant_tables',
  'menu_categories',
  'menu_items',
  'ingredients',
  'recipe_ingredients',
  'orders',
  'order_items',
  'order_ingredient_requirements',
  'inventory_movements',
  'payments',
] as const;

const MIGRATION_SQL = readFileSync(
  join(BACKEND_ROOT, 'prisma', 'migrations', '20261116145432_init_schema', 'migration.sql'),
  'utf8',
);
const ALL_CHECKS = [...MIGRATION_SQL.matchAll(/ADD CONSTRAINT "([a-z_]+_chk)"/g)].map((m) => m[1] ?? '');

/** payments_subtotal_non_negative_chk is logically implied by payments_discount_range_chk. */
const IMPLIED_CHECKS = new Set(['payments_subtotal_non_negative_chk']);

interface Ids {
  owner: string;
  table: string;
  category: string;
  category2: string;
  item: string;
  ingredient: string;
  ingredient2: string;
  order: string;
}

const lit = (uuid: string): string => {
  if (!/^[0-9a-f-]{36}$/.test(uuid)) throw new Error('unexpected id format');
  return `'${uuid}'::uuid`;
};

async function one(client: pg.Client, sql: string, params: unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(sql, params);
  const id = result.rows[0]?.id;
  if (!id) throw new Error('seed insert returned no id');
  return id;
}

/** Valid base graph (inside the caller's rolled-back transaction). */
async function seed(client: pg.Client): Promise<Ids> {
  const owner = await one(
    client,
    `INSERT INTO users (id, full_name, email, password_hash, role, is_active, activated_at, updated_at)
     VALUES (gen_random_uuid(), 'Gate C Owner', 'gatec.owner@example.test', '$argon2id$placeholder',
             'OWNER', true, now(), now()) RETURNING id`,
  );
  const table = await one(
    client,
    `INSERT INTO restaurant_tables (id, number, label, updated_at)
     VALUES (gen_random_uuid(), 9001, 'Gate C', now()) RETURNING id`,
  );
  const category = await one(
    client,
    `INSERT INTO menu_categories (id, name, name_key, updated_at)
     VALUES (gen_random_uuid(), 'Gate C Mains', 'gate c mains', now()) RETURNING id`,
  );
  const category2 = await one(
    client,
    `INSERT INTO menu_categories (id, name, name_key, updated_at)
     VALUES (gen_random_uuid(), 'Gate C Drinks', 'gate c drinks', now()) RETURNING id`,
  );
  const item = await one(
    client,
    `INSERT INTO menu_items (id, category_id, name, name_key, price, updated_at)
     VALUES (gen_random_uuid(), ${lit(category)}, 'Gate C Pizza', 'gate c pizza', 10.50, now()) RETURNING id`,
  );
  const ingredient = await one(
    client,
    `INSERT INTO ingredients (id, name, name_key, unit, stock_quantity, minimum_stock, updated_at)
     VALUES (gen_random_uuid(), 'Gate C Cheese', 'gate c cheese', 'G', 1000, 100, now()) RETURNING id`,
  );
  const ingredient2 = await one(
    client,
    `INSERT INTO ingredients (id, name, name_key, unit, stock_quantity, minimum_stock, updated_at)
     VALUES (gen_random_uuid(), 'Gate C Flour', 'gate c flour', 'G', 5000, 500, now()) RETURNING id`,
  );
  await client.query(
    `INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity_per_dish, updated_at)
     VALUES (${lit(item)}, ${lit(ingredient)}, 150, now())`,
  );
  const order = await one(
    client,
    `INSERT INTO orders (id, table_id, tracking_token_hash, subtotal, updated_at)
     VALUES (gen_random_uuid(), ${lit(table)}, 'gatec-tracking-hash-1', 21.00, now()) RETURNING id`,
  );
  await client.query(
    `INSERT INTO order_items (id, order_id, menu_item_id, name_snapshot, unit_price_snapshot, quantity)
     VALUES (gen_random_uuid(), ${lit(order)}, ${lit(item)}, 'Gate C Pizza', 10.50, 2)`,
  );
  await client.query(
    `INSERT INTO order_ingredient_requirements (order_id, ingredient_id, required_quantity)
     VALUES (${lit(order)}, ${lit(ingredient)}, 300)`,
  );
  return { owner, table, category, category2, item, ingredient, ingredient2, order };
}

function orderInsert(ids: Ids, overrides: Record<string, string>): string {
  const columns: Record<string, string> = {
    id: 'gen_random_uuid()',
    table_id: lit(ids.table),
    tracking_token_hash: 'gen_random_uuid()::text',
    subtotal: '10',
    updated_at: 'now()',
    ...overrides,
  };
  return `INSERT INTO orders (${Object.keys(columns).join(', ')}) VALUES (${Object.values(columns).join(', ')})`;
}

function movementInsert(ids: Ids, overrides: Record<string, string>): string {
  const columns: Record<string, string> = {
    id: 'gen_random_uuid()',
    ingredient_id: lit(ids.ingredient),
    actor_id: lit(ids.owner),
    ...overrides,
  };
  return `INSERT INTO inventory_movements (${Object.keys(columns).join(', ')}) VALUES (${Object.values(columns).join(', ')})`;
}

/** One statement per CHECK constraint, crafted to violate exactly that constraint. */
function checkCases(ids: Ids): [string, string][] {
  const user = (cols: string, vals: string): string =>
    `INSERT INTO users (id, role, updated_at, ${cols}) VALUES (gen_random_uuid(), 'WAITER', now(), ${vals})`;
  const owner = lit(ids.owner);
  const accepted = { accepted_at: 'now()', accepted_by_id: owner, inventory_deducted_at: 'now()' };
  const ready = { ready_at: 'now()', ready_by_id: owner };
  return [
    ['users_email_normalised_chk', user('full_name, email', "'A', 'Upper@Example.test'")],
    ['users_full_name_not_blank_chk', user('full_name, email', "'   ', 'blank@example.test'")],
    ['users_active_requires_setup_chk', user('full_name, email, is_active', "'A', 'act@example.test', true")],
    ['staff_setup_tokens_expiry_chk', `INSERT INTO staff_setup_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), ${owner}, 'tok-exp', now() - interval '1 hour')`],
    ['staff_setup_tokens_used_after_created_chk', `INSERT INTO staff_setup_tokens (id, user_id, token_hash, expires_at, used_at) VALUES (gen_random_uuid(), ${owner}, 'tok-used', now() + interval '1 hour', now() - interval '1 day')`],
    ['restaurant_tables_number_positive_chk', "INSERT INTO restaurant_tables (id, number, updated_at) VALUES (gen_random_uuid(), 0, now())"],
    ['restaurant_tables_label_not_blank_chk', "INSERT INTO restaurant_tables (id, number, label, updated_at) VALUES (gen_random_uuid(), 9002, '  ', now())"],
    ['menu_categories_name_not_blank_chk', "INSERT INTO menu_categories (id, name, name_key, updated_at) VALUES (gen_random_uuid(), '  ', '', now())"],
    ['menu_categories_name_key_normalised_chk', "INSERT INTO menu_categories (id, name, name_key, updated_at) VALUES (gen_random_uuid(), 'Soups', 'SOUPS', now())"],
    ['menu_items_name_not_blank_chk', `INSERT INTO menu_items (id, category_id, name, name_key, price, updated_at) VALUES (gen_random_uuid(), ${lit(ids.category)}, '  ', '', 1, now())`],
    ['menu_items_name_key_normalised_chk', `INSERT INTO menu_items (id, category_id, name, name_key, price, updated_at) VALUES (gen_random_uuid(), ${lit(ids.category)}, 'Tea', 'TEA', 1, now())`],
    ['menu_items_price_non_negative_chk', `INSERT INTO menu_items (id, category_id, name, name_key, price, updated_at) VALUES (gen_random_uuid(), ${lit(ids.category)}, 'Neg', 'neg', -1, now())`],
    ['ingredients_name_not_blank_chk', "INSERT INTO ingredients (id, name, name_key, unit, updated_at) VALUES (gen_random_uuid(), '  ', '', 'G', now())"],
    ['ingredients_name_key_normalised_chk', "INSERT INTO ingredients (id, name, name_key, unit, updated_at) VALUES (gen_random_uuid(), 'Salt', 'SALT', 'G', now())"],
    ['ingredients_stock_non_negative_chk', "INSERT INTO ingredients (id, name, name_key, unit, stock_quantity, updated_at) VALUES (gen_random_uuid(), 'Neg Stock', 'neg stock', 'G', -0.001, now())"],
    ['ingredients_minimum_non_negative_chk', "INSERT INTO ingredients (id, name, name_key, unit, minimum_stock, updated_at) VALUES (gen_random_uuid(), 'Neg Min', 'neg min', 'G', -1, now())"],
    ['recipe_ingredients_quantity_positive_chk', `INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity_per_dish, updated_at) VALUES (${lit(ids.item)}, ${lit(ids.ingredient2)}, 0, now())`],
    ['orders_subtotal_non_negative_chk', orderInsert(ids, { subtotal: '-1' })],
    ['orders_version_non_negative_chk', orderInsert(ids, { version: '-1' })],
    ['orders_accepted_pair_chk', orderInsert(ids, { status: "'PREPARING'", accepted_at: 'now()', inventory_deducted_at: 'now()' })],
    ['orders_ready_pair_chk', orderInsert(ids, { status: "'PREPARING'", ...accepted, ready_at: 'now()' })],
    ['orders_served_pair_chk', orderInsert(ids, { status: "'PREPARING'", ...accepted, served_at: 'now()' })],
    ['orders_pending_not_accepted_chk', orderInsert(ids, { inventory_deducted_at: 'now()' })],
    ['orders_accepted_state_chk', orderInsert(ids, { status: "'PREPARING'", accepted_at: 'now()', accepted_by_id: owner })],
    ['orders_ready_state_chk', orderInsert(ids, { status: "'READY'", ...accepted })],
    ['orders_served_state_chk', orderInsert(ids, { status: "'SERVED'", ...accepted, ...ready })],
    ['orders_cancelled_state_chk', orderInsert(ids, { status: "'CANCELLED'" })],
    ['orders_cancel_fields_chk', orderInsert(ids, { cancel_reason: "'changed mind'" })],
    ['order_items_quantity_positive_chk', `INSERT INTO order_items (id, order_id, menu_item_id, name_snapshot, unit_price_snapshot, quantity) VALUES (gen_random_uuid(), ${lit(ids.order)}, ${lit(ids.item)}, 'X', 1, 0)`],
    ['order_items_unit_price_non_negative_chk', `INSERT INTO order_items (id, order_id, menu_item_id, name_snapshot, unit_price_snapshot, quantity) VALUES (gen_random_uuid(), ${lit(ids.order)}, ${lit(ids.item)}, 'X', -1, 1)`],
    ['order_items_name_snapshot_not_blank_chk', `INSERT INTO order_items (id, order_id, menu_item_id, name_snapshot, unit_price_snapshot, quantity) VALUES (gen_random_uuid(), ${lit(ids.order)}, ${lit(ids.item)}, '  ', 1, 1)`],
    ['order_ingredient_requirements_quantity_positive_chk', `INSERT INTO order_ingredient_requirements (order_id, ingredient_id, required_quantity) VALUES (${lit(ids.order)}, ${lit(ids.ingredient2)}, 0)`],
    ['inventory_movements_delta_non_zero_chk', movementInsert(ids, { type: "'ADJUSTMENT'", quantity_delta: '0', balance_after: '1000', reason: "'recount'" })],
    ['inventory_movements_balance_non_negative_chk', movementInsert(ids, { type: "'STOCK_IN'", quantity_delta: '5', balance_after: '-1' })],
    ['inventory_movements_sign_by_type_chk', movementInsert(ids, { type: "'STOCK_IN'", quantity_delta: '-5', balance_after: '995' })],
    ['inventory_movements_stock_out_order_chk', movementInsert(ids, { type: "'STOCK_OUT'", quantity_delta: '-1', balance_after: '999' })],
    ['inventory_movements_reason_required_chk', movementInsert(ids, { type: "'WASTE'", quantity_delta: '-1', balance_after: '999' })],
    ['inventory_movements_unit_cost_chk', movementInsert(ids, { type: "'WASTE'", quantity_delta: '-1', balance_after: '999', reason: "'spoiled'", unit_cost: '2' })],
    ['payments_subtotal_non_negative_chk', `INSERT INTO payments (id, order_id, subtotal, discount_amount, total_amount, recorded_by_id) VALUES (gen_random_uuid(), ${lit(ids.order)}, -1, 0, -1, ${owner})`],
    ['payments_discount_range_chk', `INSERT INTO payments (id, order_id, subtotal, discount_amount, total_amount, recorded_by_id) VALUES (gen_random_uuid(), ${lit(ids.order)}, 10, 11, -1, ${owner})`],
    ['payments_total_consistent_chk', `INSERT INTO payments (id, order_id, subtotal, discount_amount, total_amount, recorded_by_id) VALUES (gen_random_uuid(), ${lit(ids.order)}, 10, 1, 8, ${owner})`],
  ];
}

/**
 * Application row counts as seen by the runtime role. _prisma_migrations is deliberately NOT read here:
 * after Gate D the runtime role has no access to migration history (verified separately by the read-only
 * migrator-side suite test/db/migration-history.db-spec.ts).
 */
async function tableCounts(client: pg.Client): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of APP_TABLES) {
    const result = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM public."${table}"`);
    counts[table] = Number(result.rows[0]?.n);
  }
  return counts;
}

describe('F02 Gate C — rollback-only behavioral tests (restaurant_app @ restaurant_dev)', () => {
  let client: pg.Client;
  let baseline: Record<string, number>;
  let sequenceBefore: string;

  beforeAll(async () => {
    client = await connectRuntime();
    const who = await client.query<{ role: string; db: string }>(
      'SELECT current_user::text AS role, current_database() AS db',
    );
    console.log(`[gate-c] connected as ${who.rows[0]?.role ?? '?'} @ ${who.rows[0]?.db ?? '?'}`);
    baseline = await tableCounts(client);
    const seq = await client.query<{ v: string }>(
      'SELECT last_value::text || CASE WHEN is_called THEN \'(called)\' ELSE \'(not called)\' END AS v FROM public.orders_order_number_seq',
    );
    sequenceBefore = seq.rows[0]?.v ?? 'unknown';
    console.log(`[gate-c] baseline row counts: ${JSON.stringify(baseline)}`);
    console.log(`[gate-c] orders_order_number_seq before: ${sequenceBefore}`);
  });

  afterAll(async () => {
    await client.end();
  });

  it('starts from an empty application schema', () => {
    // Migration history (exactly 2 approved migrations, checksums) is verified by the read-only migrator-side
    // suite test/db/migration-history.db-spec.ts — the runtime role must not be able to read it (Gate D).
    expect(Object.keys(baseline).sort()).toEqual([...APP_TABLES].sort());
    for (const table of APP_TABLES) expect(baseline[table], table).toBe(0);
  });

  describe('privilege matrix (catalog)', () => {
    it('grants DML only (no TRUNCATE/REFERENCES/TRIGGER) on every application table owned by the migrator; Gate E audit restrictions', async () => {
      // Gate E (human-executed 2026-11-16): inventory_movements is append-only for the runtime role (no UPDATE/DELETE);
      // payments cannot be deleted by the runtime role (UPDATE retained for future corrections/voids).
      const restricted: Partial<Record<(typeof APP_TABLES)[number], { upd: boolean; del: boolean }>> = {
        inventory_movements: { upd: false, del: false },
        payments: { upd: true, del: false },
      };
      for (const table of APP_TABLES) {
        const result = await client.query<Record<string, boolean | string>>(
          `SELECT pg_get_userbyid(c.relowner) AS owner,
                  has_table_privilege(c.oid, 'SELECT') AS sel, has_table_privilege(c.oid, 'INSERT') AS ins,
                  has_table_privilege(c.oid, 'UPDATE') AS upd, has_table_privilege(c.oid, 'DELETE') AS del,
                  has_table_privilege(c.oid, 'TRUNCATE') AS trunc, has_table_privilege(c.oid, 'REFERENCES') AS refs,
                  has_table_privilege(c.oid, 'TRIGGER') AS trig
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relname = $1`,
          [table],
        );
        expect(result.rows[0], table).toEqual({
          owner: 'restaurant_migrator',
          sel: true,
          ins: true,
          upd: restricted[table]?.upd ?? true,
          del: restricted[table]?.del ?? true,
          trunc: false,
          refs: false,
          trig: false,
        });
      }
    });

    it('grants USAGE/SELECT but not UPDATE on the order number sequence', async () => {
      const result = await client.query<Record<string, boolean | string>>(
        `SELECT pg_get_userbyid(c.relowner) AS owner,
                has_sequence_privilege(c.oid, 'USAGE') AS usage, has_sequence_privilege(c.oid, 'SELECT') AS sel,
                has_sequence_privilege(c.oid, 'UPDATE') AS upd
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'S'`,
      );
      expect(result.rows).toEqual([{ owner: 'restaurant_migrator', usage: true, sel: true, upd: false }]);
    });

    it('denies CREATE on schema public and on the database', async () => {
      const result = await client.query<{ schema_create: boolean; db_create: boolean }>(
        `SELECT has_schema_privilege('public', 'CREATE') AS schema_create,
                has_database_privilege(current_database(), 'CREATE') AS db_create`,
      );
      expect(result.rows[0]).toEqual({ schema_create: false, db_create: false });
    });

    it('Gate D (D1): restaurant_app has NO privileges on _prisma_migrations (effective, catalog)', async () => {
      const result = await client.query<Record<string, boolean | string | null>>(
        `SELECT has_table_privilege('public._prisma_migrations', 'SELECT') AS sel,
                has_table_privilege('public._prisma_migrations', 'INSERT') AS ins,
                has_table_privilege('public._prisma_migrations', 'UPDATE') AS upd,
                has_table_privilege('public._prisma_migrations', 'DELETE') AS del,
                has_table_privilege('public._prisma_migrations', 'TRUNCATE') AS trunc,
                has_table_privilege('public._prisma_migrations', 'REFERENCES') AS refs,
                has_table_privilege('public._prisma_migrations', 'TRIGGER') AS trig,
                (SELECT relacl::text FROM pg_class WHERE oid = 'public._prisma_migrations'::regclass) AS relacl`,
      );
      console.log(`[gate-c] _prisma_migrations privileges for restaurant_app: ${JSON.stringify(result.rows[0])}`);
      expect(result.rows[0]).toEqual({
        sel: false,
        ins: false,
        upd: false,
        del: false,
        trunc: false,
        refs: false,
        trig: false,
        relacl: '{restaurant_migrator=arwdDxtm/restaurant_migrator}',
      });
    });

    it('Gate D (D1): restaurant_app cannot read or modify _prisma_migrations (42501, rolled back)', async () => {
      const statements = [
        'SELECT migration_name FROM public._prisma_migrations LIMIT 1',
        "INSERT INTO public._prisma_migrations (id, checksum, migration_name, started_at) VALUES ('gate-c', 'x', 'gate_c_probe', now())",
        "UPDATE public._prisma_migrations SET logs = 'gate-c' WHERE false",
        'DELETE FROM public._prisma_migrations WHERE false',
      ];
      for (const sql of statements) {
        const outcome = await inRollback(client, () => tryQuery(client, sql));
        expect(failureOf(outcome).code, sql).toBe('42501');
      }
    });

    it('Gate D (D2): no TEMPORARY privilege on restaurant_dev for restaurant_app; CONNECT retained', async () => {
      const result = await client.query<{ temp: boolean; connect: boolean; public_temp: boolean }>(
        `SELECT has_database_privilege(current_database(), 'TEMPORARY') AS temp,
                has_database_privilege(current_database(), 'CONNECT') AS connect,
                EXISTS (SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(d.datacl) x
                         WHERE d.datname = current_database() AND x.grantee = 0 AND x.privilege_type = 'TEMPORARY') AS public_temp`,
      );
      expect(result.rows[0]).toEqual({ temp: false, connect: true, public_temp: false });
    });
  });

  describe('unauthorized DDL is rejected with SQLSTATE 42501', () => {
    const ddl: [string, string][] = [
      ['CREATE TABLE', 'CREATE TABLE public.gate_c_probe (id int)'],
      ['ALTER TABLE ADD COLUMN', 'ALTER TABLE public.users ADD COLUMN gate_c_probe int'],
      ['ALTER TABLE DROP CONSTRAINT', 'ALTER TABLE public.orders DROP CONSTRAINT orders_accepted_state_chk'],
      ['DROP TABLE', 'DROP TABLE public.payments'],
      ['TRUNCATE', 'TRUNCATE public.inventory_movements'],
      ['CREATE INDEX', 'CREATE INDEX gate_c_probe_idx ON public.orders (created_at)'],
      ['CREATE TYPE', "CREATE TYPE public.gate_c_probe AS ENUM ('a')"],
      ['ALTER TYPE', "ALTER TYPE public.order_status ADD VALUE 'GATE_C_PROBE'"],
      ['ALTER SEQUENCE', 'ALTER SEQUENCE public.orders_order_number_seq RESTART WITH 1'],
      ['setval (sequence UPDATE)', "SELECT setval('public.orders_order_number_seq', 1)"],
      ['DROP SCHEMA', 'DROP SCHEMA public CASCADE'],
      ['CREATE SCHEMA', 'CREATE SCHEMA gate_c_probe'],
    ];

    it.each(ddl)('%s', async (_label, sql) => {
      const outcome = await inRollback(client, () => tryQuery(client, sql));
      expect(failureOf(outcome).code).toBe('42501');
    });

    it('Gate D (D2): CREATE TEMP TABLE is rejected with 42501', async () => {
      const outcome = await inRollback(client, () =>
        tryQuery(client, 'CREATE TEMP TABLE gate_c_tmp (x int) ON COMMIT DROP'),
      );
      expect(failureOf(outcome).code).toBe('42501');
    });
  });

  describe('Gate E audit-table restrictions (rolled back)', () => {
    it('inventory_movements is append-only: INSERT allowed; UPDATE, DELETE and SELECT FOR UPDATE -> 42501', async () => {
      await inRollback(client, async () => {
        const ids = await seed(client);
        const insert = await tryQuery(
          client,
          `${movementInsert(ids, { type: "'STOCK_IN'", quantity_delta: '10', balance_after: '1010', unit_cost: '1.25' })} RETURNING id`,
        );
        expect(insert.ok, 'INSERT inventory_movements').toBe(true);
        const movementId = insert.ok ? String(insert.rows[0]?.id) : '';
        expect(movementId).toMatch(/^[0-9a-f-]{36}$/);

        const denied: [string, string][] = [
          ['UPDATE', `UPDATE inventory_movements SET reason = 'edited' WHERE id = ${lit(movementId)}`],
          ['DELETE', `DELETE FROM inventory_movements WHERE id = ${lit(movementId)}`],
          ['SELECT FOR UPDATE', `SELECT id FROM inventory_movements WHERE id = ${lit(movementId)} FOR UPDATE`],
        ];
        for (const [label, sql] of denied) {
          expect(failureOf(await tryQuery(client, sql)).code, label).toBe('42501');
        }

        const column = await client.query<{ any_col_upd: boolean }>(
          "SELECT has_any_column_privilege('public.inventory_movements', 'UPDATE') AS any_col_upd",
        );
        expect(column.rows[0]?.any_col_upd).toBe(false);

        const stillThere = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM inventory_movements WHERE id = ${lit(movementId)} AND reason IS NULL`,
        );
        expect(stillThere.rows[0]?.n).toBe(1);
      });
    });

    it('payments cannot be deleted: INSERT and UPDATE allowed; DELETE -> 42501', async () => {
      await inRollback(client, async () => {
        const ids = await seed(client);
        const insert = await tryQuery(
          client,
          `INSERT INTO payments (id, order_id, subtotal, discount_amount, total_amount, recorded_by_id)
           VALUES (gen_random_uuid(), ${lit(ids.order)}, 21.00, 0, 21.00, ${lit(ids.owner)}) RETURNING id`,
        );
        expect(insert.ok, 'INSERT payments').toBe(true);
        const paymentId = insert.ok ? String(insert.rows[0]?.id) : '';

        const update = await tryQuery(
          client,
          `UPDATE payments SET note = 'corrected note' WHERE id = ${lit(paymentId)}`,
        );
        expect(update.ok && update.rowCount, 'UPDATE payments').toBe(1);

        const remove = await tryQuery(client, `DELETE FROM payments WHERE id = ${lit(paymentId)}`);
        expect(failureOf(remove).code, 'DELETE payments').toBe('42501');

        const stillThere = await client.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM payments WHERE id = ${lit(paymentId)} AND note = 'corrected note'`,
        );
        expect(stillThere.rows[0]?.n).toBe(1);
      });
    });
  });

  describe('valid workflow (rolled back)', () => {
    it('supports the full order lifecycle with exactly-once stock deduction semantics', async () => {
      await inRollback(client, async () => {
        const ids = await seed(client);
        const owner = lit(ids.owner);
        const accept = `UPDATE orders SET status = 'PREPARING', accepted_by_id = ${owner}, accepted_at = now(),
                          inventory_deducted_at = now(), version = version + 1, updated_at = now()
                        WHERE id = ${lit(ids.order)} AND status = 'PENDING' AND inventory_deducted_at IS NULL`;
        const first = await tryQuery(client, accept);
        const second = await tryQuery(client, accept);
        expect(first.ok && first.rowCount).toBe(1);
        expect(second.ok && second.rowCount).toBe(0);

        const out = await tryQuery(
          client,
          movementInsert(ids, { order_id: lit(ids.order), type: "'STOCK_OUT'", quantity_delta: '-300', balance_after: '700' }),
        );
        expect(out.ok).toBe(true);
        const duplicateOut = await tryQuery(
          client,
          movementInsert(ids, { order_id: lit(ids.order), type: "'STOCK_OUT'", quantity_delta: '-300', balance_after: '400' }),
        );
        expect(failureOf(duplicateOut)).toEqual({
          code: '23505',
          constraint: 'inventory_movements_order_id_ingredient_id_type_key',
        });

        const stock = await tryQuery(
          client,
          `UPDATE ingredients SET stock_quantity = stock_quantity - 300, updated_at = now() WHERE id = ${lit(ids.ingredient)}`,
        );
        expect(stock.ok && stock.rowCount).toBe(1);

        const overDraw = await tryQuery(
          client,
          `UPDATE ingredients SET stock_quantity = stock_quantity - 701 WHERE id = ${lit(ids.ingredient)}`,
        );
        expect(failureOf(overDraw)).toEqual({ code: '23514', constraint: 'ingredients_stock_non_negative_chk' });

        const ready = await tryQuery(
          client,
          `UPDATE orders SET status = 'READY', ready_by_id = ${owner}, ready_at = now() WHERE id = ${lit(ids.order)}`,
        );
        const served = await tryQuery(
          client,
          `UPDATE orders SET status = 'SERVED', served_by_id = ${owner}, served_at = now() WHERE id = ${lit(ids.order)}`,
        );
        const payment = await tryQuery(
          client,
          `INSERT INTO payments (id, order_id, subtotal, discount_amount, total_amount, recorded_by_id)
           VALUES (gen_random_uuid(), ${lit(ids.order)}, 21.00, 1.00, 20.00, ${owner})`,
        );
        const paid = await tryQuery(client, `UPDATE orders SET payment_status = 'PAID' WHERE id = ${lit(ids.order)}`);
        expect([ready.ok, served.ok, payment.ok, paid.ok]).toEqual([true, true, true, true]);

        const duplicatePayment = await tryQuery(
          client,
          `INSERT INTO payments (id, order_id, subtotal, discount_amount, total_amount, recorded_by_id)
           VALUES (gen_random_uuid(), ${lit(ids.order)}, 21.00, 0, 21.00, ${owner})`,
        );
        expect(failureOf(duplicatePayment)).toEqual({ code: '23505', constraint: 'payments_order_id_key' });

        const recipeDelete = await tryQuery(
          client,
          `DELETE FROM recipe_ingredients WHERE menu_item_id = ${lit(ids.item)} AND ingredient_id = ${lit(ids.ingredient)}`,
        );
        expect(recipeDelete.ok && recipeDelete.rowCount).toBe(1);
      });
    });

    it('allows the same item name in different categories but not twice in one category', async () => {
      await inRollback(client, async () => {
        const ids = await seed(client);
        const insert = (category: string, raw: string): string => {
          const { name, nameKey } = normalizeName(raw, 120);
          return `INSERT INTO menu_items (id, category_id, name, name_key, price, updated_at)
                  VALUES (gen_random_uuid(), ${lit(category)}, '${name}', '${nameKey}', 1, now())`;
        };
        expect((await tryQuery(client, insert(ids.category2, 'Gate C Pizza'))).ok).toBe(true);
        expect(failureOf(await tryQuery(client, insert(ids.category, '  GATE c   PIZZA ')))).toEqual({
          code: '23505',
          constraint: 'menu_items_category_id_name_key_key',
        });
      });
    });
  });

  describe('CHECK constraints (each crafted to violate exactly one)', () => {
    it('rejects every invalid row with SQLSTATE 23514 and covers all 41 CHECK constraints', async () => {
      const results: { expected: string; code: string; constraint: string | undefined }[] = [];
      await inRollback(client, async () => {
        const ids = await seed(client);
        for (const [expected, sql] of checkCases(ids)) {
          const failure = failureOf(await tryQuery(client, sql));
          results.push({ expected, ...failure });
        }
      });

      const covered = new Set<string>();
      for (const result of results) {
        expect(result.code, result.expected).toBe('23514');
        if (IMPLIED_CHECKS.has(result.expected)) {
          // Cannot be violated alone; PostgreSQL reports the alphabetically first failing CHECK.
          expect(['payments_discount_range_chk', result.expected], result.expected).toContain(result.constraint);
        } else {
          expect(result.constraint, result.expected).toBe(result.expected);
        }
        covered.add(result.expected);
      }
      expect(ALL_CHECKS).toHaveLength(41);
      expect([...covered].sort()).toEqual([...ALL_CHECKS].sort());
    });
  });

  describe('unique, foreign key, NOT NULL and type constraints', () => {
    it('rejects duplicates with 23505 on every business unique key', async () => {
      await inRollback(client, async () => {
        const ids = await seed(client);
        const cases: [string, string][] = [
          ['users_email_key', "INSERT INTO users (id, full_name, email, role, updated_at) VALUES (gen_random_uuid(), 'Dup', 'gatec.owner@example.test', 'WAITER', now())"],
          ['restaurant_tables_number_key', "INSERT INTO restaurant_tables (id, number, updated_at) VALUES (gen_random_uuid(), 9001, now())"],
          ['menu_categories_name_key_key', "INSERT INTO menu_categories (id, name, name_key, updated_at) VALUES (gen_random_uuid(), 'GATE C MAINS', 'gate c mains', now())"],
          ['ingredients_name_key_key', "INSERT INTO ingredients (id, name, name_key, unit, updated_at) VALUES (gen_random_uuid(), 'gate C CHEESE', 'gate c cheese', 'G', now())"],
          ['orders_tracking_token_hash_key', orderInsert(ids, { tracking_token_hash: "'gatec-tracking-hash-1'" })],
          ['recipe_ingredients_pkey', `INSERT INTO recipe_ingredients (menu_item_id, ingredient_id, quantity_per_dish, updated_at) VALUES (${lit(ids.item)}, ${lit(ids.ingredient)}, 1, now())`],
          ['order_ingredient_requirements_pkey', `INSERT INTO order_ingredient_requirements (order_id, ingredient_id, required_quantity) VALUES (${lit(ids.order)}, ${lit(ids.ingredient)}, 1)`],
        ];
        await client.query(
          `INSERT INTO staff_setup_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), ${lit(ids.owner)}, 'tok-dup', now() + interval '1 day')`,
        );
        cases.push([
          'staff_setup_tokens_token_hash_key',
          `INSERT INTO staff_setup_tokens (id, user_id, token_hash, expires_at) VALUES (gen_random_uuid(), ${lit(ids.owner)}, 'tok-dup', now() + interval '1 day')`,
        ]);
        await client.query(`UPDATE restaurant_tables SET ordering_token_hash = 'tbl-hash' WHERE id = ${lit(ids.table)}`);
        cases.push([
          'restaurant_tables_ordering_token_hash_key',
          "INSERT INTO restaurant_tables (id, number, ordering_token_hash, updated_at) VALUES (gen_random_uuid(), 9003, 'tbl-hash', now())",
        ]);
        for (const [constraint, sql] of cases) {
          expect(failureOf(await tryQuery(client, sql)), constraint).toEqual({ code: '23505', constraint });
        }
      });
    });

    it('enforces foreign keys with 23503, including ON DELETE RESTRICT', async () => {
      await inRollback(client, async () => {
        const ids = await seed(client);
        const missing = "'00000000-0000-7000-8000-000000000000'::uuid";
        const cases: [string, string][] = [
          ['orders_table_id_fkey', orderInsert(ids, { table_id: missing })],
          ['menu_items_category_id_fkey', `INSERT INTO menu_items (id, category_id, name, name_key, price, updated_at) VALUES (gen_random_uuid(), ${missing}, 'Orphan', 'orphan', 1, now())`],
          ['inventory_movements_actor_id_fkey', movementInsert(ids, { actor_id: missing, type: "'STOCK_IN'", quantity_delta: '1', balance_after: '1001' })],
          ['orders_table_id_fkey', `DELETE FROM restaurant_tables WHERE id = ${lit(ids.table)}`],
          ['menu_items_category_id_fkey', `DELETE FROM menu_categories WHERE id = ${lit(ids.category)}`],
          ['order_items_order_id_fkey', `DELETE FROM orders WHERE id = ${lit(ids.order)}`],
          ['recipe_ingredients_ingredient_id_fkey', `DELETE FROM ingredients WHERE id = ${lit(ids.ingredient)}`],
        ];
        for (const [constraint, sql] of cases) {
          expect(failureOf(await tryQuery(client, sql)), constraint).toEqual({ code: '23503', constraint });
        }
      });
    });

    it('enforces NOT NULL (23502), enum values (22P02) and length limits (22001); ids have no DB default', async () => {
      await inRollback(client, async () => {
        const ids = await seed(client);
        const notNull: string[] = [
          "INSERT INTO users (full_name, email, role, updated_at) VALUES ('No Id', 'noid@example.test', 'WAITER', now())",
          "INSERT INTO users (id, full_name, role, updated_at) VALUES (gen_random_uuid(), 'No Email', 'WAITER', now())",
          orderInsert(ids, { tracking_token_hash: 'NULL' }),
          `INSERT INTO order_items (id, order_id, menu_item_id, unit_price_snapshot, quantity) VALUES (gen_random_uuid(), ${lit(ids.order)}, ${lit(ids.item)}, 1, 1)`,
          "INSERT INTO menu_categories (id, name, name_key) VALUES (gen_random_uuid(), 'No Updated At', 'no updated at')",
        ];
        for (const sql of notNull) expect(failureOf(await tryQuery(client, sql)).code, sql).toBe('23502');

        const badEnum = await tryQuery(
          client,
          "INSERT INTO users (id, full_name, email, role, updated_at) VALUES (gen_random_uuid(), 'Cust', 'cust@example.test', 'CUSTOMER', now())",
        );
        expect(failureOf(badEnum).code).toBe('22P02');

        const tooLong = await tryQuery(
          client,
          `INSERT INTO menu_categories (id, name, name_key, updated_at) VALUES (gen_random_uuid(), '${'x'.repeat(81)}', '${'x'.repeat(81)}', now())`,
        );
        expect(failureOf(tooLong).code).toBe('22001');
      });
    });
  });

  describe('UUID v7 through the Prisma application workflow (rolled back)', () => {
    it('Prisma Client generates RFC 9562 version-7 ids and the interactive transaction rolls back', async () => {
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl() }) });
      class Rollback extends Error {}
      const created: string[] = [];
      try {
        await expect(
          prisma.$transaction(async (tx) => {
            for (const raw of ['Gate C UUID One', 'Gate C UUID Two']) {
              const { name, nameKey } = normalizeName(raw, 80);
              const category = await tx.menuCategory.create({ data: { name, nameKey } });
              created.push(category.id);
            }
            throw new Rollback('intentional rollback');
          }),
        ).rejects.toBeInstanceOf(Rollback);

        const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
        expect(created).toHaveLength(2);
        for (const id of created) {
          expect(id).toMatch(v7);
          const millis = Number.parseInt(id.replace(/-/g, '').slice(0, 12), 16);
          expect(Math.abs(Date.now() - millis)).toBeLessThan(5 * 60_000);
        }
        expect(created[0] && created[1] && created[0] < created[1]).toBe(true);

        const remaining = await prisma.menuCategory.count({ where: { id: { in: created } } });
        expect(remaining).toBe(0);
        console.log(`[gate-c] Prisma UUID v7 sample: ${created[0] ?? ''}`);
      } finally {
        await prisma.$disconnect();
      }
    });
  });

  describe('Q1b Unicode compatibility: normalizeName() vs PostgreSQL lower()', () => {
    const samples = [
      'Chicken Pizza',
      'چکن کڑاہی',
      'دال',
      'Crème Brûlée',
      'STRASSE',
      'Straße',
      'İskender',
      'ılık',
      'ΣΟΥΒΛΑΚΙ',
      'ΟΔΥΣΣΕΥΣ',
      'ẞ Brot',
      'ǅemal',
      'Ꭰ Cherokee',
      'Ａ Fullwidth',
      '𐐀 Deseret',
    ];

    it('database locale settings are recorded', async () => {
      const result = await client.query<Record<string, string>>(
        `SELECT datlocprovider::text AS provider, datcollate AS collate, datctype AS ctype,
                pg_encoding_to_char(encoding) AS encoding
           FROM pg_database WHERE datname = current_database()`,
      );
      console.log(`[gate-c] restaurant_dev locale: ${JSON.stringify(result.rows[0])}`);
      expect(result.rows[0]?.encoding).toBe('UTF8');
    });

    it('name_key CHECK constraints use the builtin pg_c_utf8 collation (catalog, read-only)', async () => {
      const result = await client.query<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname IN ('menu_categories_name_key_normalised_chk', 'menu_items_name_key_normalised_chk',
                            'ingredients_name_key_normalised_chk')
          ORDER BY conname`,
      );
      expect(result.rows).toHaveLength(3);
      for (const row of result.rows) expect(row.def, row.conname).toContain('pg_c_utf8');
    });

    it('FULL RANGE: PostgreSQL lower(chr(cp) COLLATE "pg_c_utf8") equals the application table for every code point', async () => {
      const result = await client.query<{ cp: number; lower_cp: number }>(
        `SELECT cp, ascii(lower(chr(cp) COLLATE "pg_c_utf8")) AS lower_cp
           FROM generate_series(1, 1114111) AS cp
          WHERE cp NOT BETWEEN 55296 AND 57343
            AND lower(chr(cp) COLLATE "pg_c_utf8") <> chr(cp)
          ORDER BY cp`,
      );
      const database = result.rows.map((row) => [row.cp, row.lower_cp]);
      const application: number[][] = [];
      for (let i = 0; i < PG_SIMPLE_LOWER_PAIRS.length; i += 2) {
        application.push([PG_SIMPLE_LOWER_PAIRS[i] ?? -1, PG_SIMPLE_LOWER_PAIRS[i + 1] ?? -1]);
      }
      console.log(`[gate-c] full-range pg_c_utf8 changing code points: database=${database.length} application=${application.length}`);
      expect(database).toEqual(application);
    });

    it('application nameKey equals PostgreSQL lower(btrim(name) COLLATE "pg_c_utf8") and the CHECK accepts every sample', async () => {
      const report: { sample: string; js: string; pg: string; match: boolean; insert: string }[] = [];
      await inRollback(client, async () => {
        for (const sample of samples) {
          const { name, nameKey } = normalizeName(sample, 80);
          const pgResult = await client.query<{ k: string }>(
            'SELECT lower(btrim($1) COLLATE "pg_c_utf8") AS k',
            [name],
          );
          const pgKey = pgResult.rows[0]?.k ?? '';
          const insert = await tryQuery(
            client,
            'INSERT INTO menu_categories (id, name, name_key, updated_at) VALUES (gen_random_uuid(), $1, $2, now())',
            [name, nameKey],
          );
          report.push({
            sample,
            js: nameKey,
            pg: pgKey,
            match: pgKey === nameKey,
            insert: insert.ok ? 'accepted' : `rejected ${insert.code} ${insert.constraint ?? ''}`,
          });
        }
      });
      for (const row of report) {
        const codepoints = (s: string): string =>
          Array.from(s, (c) => (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')).join(' ');
        console.log(
          `[gate-c][unicode] ${row.match ? 'MATCH   ' : 'MISMATCH'} ${row.insert.padEnd(46)} sample="${row.sample}" js="${row.js}" [${codepoints(row.js)}] pg="${row.pg}" [${codepoints(row.pg)}]`,
        );
      }
      const mismatches = report.filter((row) => !row.match || row.insert !== 'accepted').map((row) => row.sample);
      expect(mismatches, 'Unicode incompatibilities (STOP and report)').toEqual([]);
    });

    it('rejects duplicate normalised names (case/whitespace variants) with 23505, including Urdu', async () => {
      await inRollback(client, async () => {
        const pairs: [string, string][] = [
          ['Pizza', '  PIZZA  '],
          ['iskender', 'İSKENDER'],
          ['οδυσσευσ', 'ΟΔΥΣΣΕΥΣ'],
          ['Chicken   Karahi', 'chicken karahi'],
          ['دال', '  دال   '],
          ['چکن کڑاہی', 'چکن   کڑاہی'],
        ];
        for (const [first, second] of pairs) {
          const a = normalizeName(first, 80);
          const b = normalizeName(second, 80);
          const sql = 'INSERT INTO menu_categories (id, name, name_key, updated_at) VALUES (gen_random_uuid(), $1, $2, now())';
          expect((await tryQuery(client, sql, [a.name, a.nameKey])).ok, first).toBe(true);
          expect(failureOf(await tryQuery(client, sql, [b.name, b.nameKey])), second).toEqual({
            code: '23505',
            constraint: 'menu_categories_name_key_key',
          });
        }
      });
    });
  });

  describe('post-conditions', () => {
    it('leaves application data unchanged (nothing committed)', async () => {
      const after = await tableCounts(client);
      expect(after).toEqual(baseline);
      const seq = await client.query<{ v: string }>(
        'SELECT last_value::text || CASE WHEN is_called THEN \'(called)\' ELSE \'(not called)\' END AS v FROM public.orders_order_number_seq',
      );
      console.log(`[gate-c] orders_order_number_seq after: ${seq.rows[0]?.v ?? 'unknown'} (before: ${sequenceBefore}; nextval is not transactional — gaps expected)`);
    });
  });
});
