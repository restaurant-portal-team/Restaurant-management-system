/**
 * OFFLINE safety checks for Prisma migration SQL files (no database connection).
 *
 * Guards the approved F02 migration policy:
 * - every migration is wrapped in exactly one explicit BEGIN ... COMMIT;
 * - no destructive or non-transactional statements and no privilege/role changes;
 * - the hand-written CHECK constraints for business invariants are present;
 * - the Prisma-generated block matches what `prisma migrate diff --from-empty --to-schema` produces
 *   offline from the current schema (detects schema/migration drift without touching any database).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_ROOT } from './migration-env.ts';

const MIGRATIONS_DIR = join(BACKEND_ROOT, 'prisma', 'migrations');
const INIT_MIGRATION = '20261116145432_init_schema';

const GENERATED_START = '-- ===== BEGIN PRISMA-GENERATED';
const GENERATED_END = '-- ===== END PRISMA-GENERATED =====';

function migrationFolders(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readMigration(folder: string): string {
  return readFileSync(join(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8');
}

/** SQL without line comments, for statement-level checks. */
function stripComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function generatedBlock(sql: string): string {
  const start = sql.indexOf(GENERATED_START);
  const end = sql.indexOf(GENERATED_END);
  if (start === -1 || end === -1 || end < start) throw new Error('generated block markers missing');
  const afterMarkerLine = sql.indexOf('\n', start) + 1;
  return sql.slice(afterMarkerLine, end).trim();
}

describe('Prisma migrations (offline)', () => {
  it('has a PostgreSQL migration lock file', () => {
    const lock = readFileSync(join(MIGRATIONS_DIR, 'migration_lock.toml'), 'utf8');
    expect(lock).toMatch(/provider\s*=\s*"postgresql"/);
  });

  it('contains the approved initial migration', () => {
    expect(migrationFolders()).toContain(INIT_MIGRATION);
    expect(existsSync(join(MIGRATIONS_DIR, INIT_MIGRATION, 'migration.sql'))).toBe(true);
  });

  describe.each(migrationFolders())('%s', (folder) => {
    const sql = readMigration(folder);
    const code = stripComments(sql);

    it('is ASCII-only with LF line endings', () => {
      expect(Buffer.from(sql, 'utf8').every((byte) => byte <= 0x7f)).toBe(true);
      expect(sql.includes('\r')).toBe(false);
    });

    it('is wrapped in exactly one explicit transaction', () => {
      const statements = code
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      expect(statements[0]).toBe('BEGIN');
      expect(statements.at(-1)).toBe('COMMIT');
      expect(code.match(/^\s*BEGIN\s*;/gim)).toHaveLength(1);
      expect(code.match(/^\s*COMMIT\s*;/gim)).toHaveLength(1);
      expect(code).not.toMatch(/\bROLLBACK\b|\bSAVEPOINT\b/i);
    });

    it('sets local lock and statement timeouts', () => {
      expect(code).toMatch(/SET LOCAL lock_timeout\s*=/);
      expect(code).toMatch(/SET LOCAL statement_timeout\s*=/);
    });

    it('contains no destructive, non-transactional or privilege statements', () => {
      const forbidden: [string, RegExp][] = [
        ['DROP', /\bDROP\b/i],
        ['TRUNCATE', /\bTRUNCATE\b/i],
        ['DELETE FROM', /\bDELETE\s+FROM\b/i],
        ['UPDATE statement', /^\s*UPDATE\s/im],
        ['INSERT', /\bINSERT\s+INTO\b/i],
        ['CONCURRENTLY', /\bCONCURRENTLY\b/i],
        ['ALTER TYPE', /\bALTER\s+TYPE\b/i],
        ['GRANT', /\bGRANT\b/i],
        ['REVOKE', /\bREVOKE\b/i],
        ['ROLE changes', /\b(CREATE|ALTER|DROP)\s+ROLE\b/i],
        ['EXTENSION', /\bCREATE\s+EXTENSION\b/i],
        ['VACUUM', /\bVACUUM\b/i],
      ];
      for (const [name, pattern] of forbidden) {
        expect(pattern.test(code), `forbidden statement: ${name}`).toBe(false);
      }
    });
  });

  describe('initial migration content', () => {
    const sql = readMigration(INIT_MIGRATION);

    it('creates every table with a primary key', () => {
      const tables = [...sql.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((m) => m[1]);
      expect(tables.sort()).toEqual(
        [
          'inventory_movements',
          'ingredients',
          'menu_categories',
          'menu_items',
          'order_ingredient_requirements',
          'order_items',
          'orders',
          'payments',
          'recipe_ingredients',
          'restaurant_tables',
          'staff_setup_tokens',
          'users',
        ].sort(),
      );
      for (const table of tables) {
        expect(sql).toContain(`CONSTRAINT "${table}_pkey" PRIMARY KEY`);
      }
    });

    it('uses ON DELETE RESTRICT for every foreign key', () => {
      const fks = sql.match(/FOREIGN KEY .*$/gm) ?? [];
      // users 1, staff_setup_tokens 1, menu_items 1, recipe_ingredients 2, orders 5, order_items 2,
      // order_ingredient_requirements 2, inventory_movements 3, payments 2
      expect(fks.length).toBe(19);
      for (const fk of fks) expect(fk).toMatch(/ON DELETE RESTRICT ON UPDATE RESTRICT;$/);
    });

    it('contains the approved invariant CHECK constraints', () => {
      const required = [
        'users_email_normalised_chk',
        'users_active_requires_setup_chk',
        'menu_categories_name_key_normalised_chk',
        'menu_items_name_key_normalised_chk',
        'ingredients_stock_non_negative_chk',
        'ingredients_name_key_normalised_chk',
        'recipe_ingredients_quantity_positive_chk',
        'orders_accepted_state_chk',
        'orders_pending_not_accepted_chk',
        'orders_cancelled_state_chk',
        'order_items_quantity_positive_chk',
        'inventory_movements_balance_non_negative_chk',
        'inventory_movements_sign_by_type_chk',
        'inventory_movements_stock_out_order_chk',
        'inventory_movements_reason_required_chk',
        'payments_discount_range_chk',
        'payments_total_consistent_chk',
      ];
      for (const name of required) expect(sql).toContain(`"${name}"`);
      expect(sql.match(/ADD CONSTRAINT "[a-z_]+_chk"/g)).toHaveLength(41);
    });

    it('enforces case-insensitive name uniqueness via name_key unique indexes (decision Q1)', () => {
      expect(sql).toContain(
        'CREATE UNIQUE INDEX "menu_categories_name_key_key" ON "menu_categories"("name_key");',
      );
      expect(sql).toContain(
        'CREATE UNIQUE INDEX "menu_items_category_id_name_key_key" ON "menu_items"("category_id", "name_key");',
      );
      expect(sql).toContain('CREATE UNIQUE INDEX "ingredients_name_key_key" ON "ingredients"("name_key");');
      // The old case-sensitive unique indexes must not exist.
      expect(sql).not.toMatch(/ON "menu_categories"\("name"\)/);
      expect(sql).not.toMatch(/ON "menu_items"\("category_id", "name"\)/);
      expect(sql).not.toMatch(/ON "ingredients"\("name"\)/);
      // users 3, staff_setup_tokens 2, restaurant_tables 2, menu_categories 1, menu_items 2, ingredients 1,
      // recipe_ingredients 1, orders 9, order_items 2, order_ingredient_requirements 1,
      // inventory_movements 3, payments 3  (primary keys are table constraints, not counted here)
      expect(sql.match(/CREATE (UNIQUE )?INDEX/g)).toHaveLength(30);
    });

    it('does NOT encode changeable business policy as DB constraints (decision A1 and review)', () => {
      expect(sql).not.toMatch(/payment_status.{0,40}SERVED/s);
      expect(sql).not.toMatch(/"quantity" BETWEEN/);
      expect(sql).not.toMatch(/"price" > 0/);
    });

    it(
      'Prisma-generated block matches an offline diff of the current schema (no DB connection)',
      () => {
        const fresh = execFileSync(
          process.execPath,
          [
            join(BACKEND_ROOT, 'node_modules', 'prisma', 'build', 'index.js'),
            'migrate',
            'diff',
            '--from-empty',
            '--to-schema',
            join(BACKEND_ROOT, 'prisma', 'schema.prisma'),
            '--script',
          ],
          { cwd: BACKEND_ROOT, encoding: 'utf8', env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: '1' } },
        );
        expect(generatedBlock(sql)).toBe(fresh.trim());
      },
      60_000,
    );
  });
});
