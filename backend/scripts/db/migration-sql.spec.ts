/**
 * OFFLINE safety checks for Prisma migration SQL files (no database connection).
 *
 * Guards the approved F02 migration policy:
 * - every migration is wrapped in exactly one explicit BEGIN ... COMMIT;
 * - no destructive or non-transactional statements and no privilege/role changes;
 * - the hand-written CHECK constraints for business invariants are present;
 * - the Prisma-generated block matches what `prisma migrate diff --from-empty --to-schema` produces
 *   offline from the current schema (detects schema/migration drift without touching any database);
 * - the applied initial migration is byte-for-byte unchanged (checksum recorded at Gate B);
 * - DROP is forbidden everywhere, with ONE narrowly scoped, human-approved exception (Q1b): the
 *   remediation migration may DROP + re-ADD exactly three named CHECK constraints.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKEND_ROOT } from './migration-env.ts';

const MIGRATIONS_DIR = join(BACKEND_ROOT, 'prisma', 'migrations');
const INIT_MIGRATION = '20261116145432_init_schema';
/** SHA-256 of the initial migration as applied at Gate B (recorded in _prisma_migrations.checksum). */
const INIT_MIGRATION_SHA256 = 'dd7664b88aae285edacfa666b6985ae9ce9ecc4d71cdd34c3730b389183230f9';

/** Human-approved Q1b exception: the ONLY migration allowed to DROP anything, and only these constraints. */
const REMEDIATION_MIGRATION = '20261116153418_name_key_builtin_lower';
const REMEDIATION_ALLOWED_DROPS = [
  'menu_categories_name_key_normalised_chk',
  'menu_items_name_key_normalised_chk',
  'ingredients_name_key_normalised_chk',
] as const;

/** F03 (decision D1): additive staff_sessions table. */
const SESSIONS_MIGRATION = '20261120100000_staff_sessions';

/** Removes the approved DROP CONSTRAINT clauses (remediation migration only) before forbidden-statement scans. */
function withoutApprovedDrops(folder: string, code: string): string {
  if (folder !== REMEDIATION_MIGRATION) return code;
  let result = code;
  for (const name of REMEDIATION_ALLOWED_DROPS) {
    result = result.replace(new RegExp(`DROP CONSTRAINT "${name}",`, 'g'), '');
  }
  return result;
}

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

/** Individual SQL statements (comments removed, whitespace normalised) for order-insensitive comparison. */
function sqlStatements(sql: string): string[] {
  return stripComments(sql.replace(/\r/g, ''))
    .split(';')
    .map((statement) => statement.trim().replace(/\s+/g, ' '))
    .filter(Boolean);
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
      const scanned = withoutApprovedDrops(folder, code);
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
        expect(pattern.test(scanned), `forbidden statement: ${name}`).toBe(false);
      }
    });
  });

  it('keeps the applied initial migration byte-for-byte unchanged (Gate B checksum)', () => {
    const digest = createHash('sha256')
      .update(readFileSync(join(MIGRATIONS_DIR, INIT_MIGRATION, 'migration.sql')))
      .digest('hex');
    expect(digest).toBe(INIT_MIGRATION_SHA256);
  });

  it('allows DROP CONSTRAINT in no migration other than the approved remediation', () => {
    for (const folder of migrationFolders()) {
      if (folder === REMEDIATION_MIGRATION) continue;
      expect(stripComments(readMigration(folder)), folder).not.toMatch(/DROP\s+CONSTRAINT/i);
    }
  });

  describe('Q1b remediation migration (narrow DROP CONSTRAINT exception)', () => {
    const code = stripComments(readMigration(REMEDIATION_MIGRATION));

    it('exists and sorts after the initial migration', () => {
      const folders = migrationFolders();
      expect(folders).toContain(REMEDIATION_MIGRATION);
      expect(folders.indexOf(REMEDIATION_MIGRATION)).toBeGreaterThan(folders.indexOf(INIT_MIGRATION));
    });

    it('drops exactly the three approved constraints, each once', () => {
      const dropped = [...code.matchAll(/DROP\s+CONSTRAINT\s+"([a-z_]+)"/gi)].map((m) => m[1]);
      expect(dropped.sort()).toEqual([...REMEDIATION_ALLOWED_DROPS].sort());
      expect(code).not.toMatch(/DROP\s+(TABLE|COLUMN|INDEX|SCHEMA|TYPE|SEQUENCE|VIEW|FUNCTION|TRIGGER)/i);
      expect(code).not.toMatch(/\bIF\s+EXISTS\b/i);
    });

    it('re-adds each constraint with the same name in the SAME ALTER TABLE statement using pg_c_utf8', () => {
      const tableOf: Record<(typeof REMEDIATION_ALLOWED_DROPS)[number], string> = {
        menu_categories_name_key_normalised_chk: 'menu_categories',
        menu_items_name_key_normalised_chk: 'menu_items',
        ingredients_name_key_normalised_chk: 'ingredients',
      };
      for (const name of REMEDIATION_ALLOWED_DROPS) {
        const statement = new RegExp(
          String.raw`ALTER TABLE "${tableOf[name]}"\s+DROP CONSTRAINT "${name}",\s+ADD CONSTRAINT "${name}"\s+` +
            String.raw`CHECK \("name_key" = lower\(btrim\("name"\) COLLATE "pg_c_utf8"\)\);`,
        );
        expect(code, name).toMatch(statement);
      }
    });

    it('contains only the three ALTER TABLE statements besides BEGIN/SET LOCAL/COMMIT', () => {
      const statements = code
        .split(';')
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
      const other = statements.filter((s) => !/^(BEGIN|COMMIT|SET LOCAL |ALTER TABLE )/.test(s));
      expect(other).toEqual([]);
      expect(statements.filter((s) => s.startsWith('ALTER TABLE '))).toHaveLength(3);
      expect(code).not.toMatch(/\b(CREATE|INSERT|UPDATE|DELETE)\b/i);
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
  });

  describe('F03 staff sessions migration (decision D1)', () => {
    const code = stripComments(readMigration(SESSIONS_MIGRATION));

    it('exists and sorts after the F02 migrations', () => {
      const folders = migrationFolders();
      expect(folders).toContain(SESSIONS_MIGRATION);
      expect(folders.indexOf(SESSIONS_MIGRATION)).toBeGreaterThan(folders.indexOf(REMEDIATION_MIGRATION));
    });

    it('only creates the staff_sessions table, its indexes, FK and CHECK constraints', () => {
      expect([...code.matchAll(/CREATE TABLE "([a-z_]+)"/g)].map((m) => m[1])).toEqual(['staff_sessions']);
      expect(code.match(/CREATE (UNIQUE )?INDEX/g)).toHaveLength(2);
      const statements = code
        .split(';')
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .filter(Boolean);
      const other = statements.filter(
        (s) => !/^(BEGIN|COMMIT|SET LOCAL |CREATE TABLE "staff_sessions"|CREATE (UNIQUE )?INDEX |ALTER TABLE "staff_sessions" )/.test(s),
      );
      expect(other).toEqual([]);
    });

    it('uses ON DELETE RESTRICT and stores only a hex SHA-256 token hash', () => {
      expect(code).toMatch(/FOREIGN KEY \("user_id"\) REFERENCES "users"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT;/);
      expect(code).toContain(`CHECK ("token_hash" ~ '^[0-9a-f]{64}$')`);
      expect(code.match(/ADD CONSTRAINT "staff_sessions_[a-z_]+_chk"/g)).toHaveLength(4);
    });
  });

  it(
    'Prisma-generated blocks of all migrations together match an offline diff of the current schema (no DB connection)',
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
      // Each Prisma-generated statement must appear exactly once across the migrations (order-insensitive),
      // so drift in any migration - or a schema change without a migration - fails this test.
      const generated = migrationFolders()
        .map(readMigration)
        .filter((sql) => sql.includes(GENERATED_START))
        .flatMap((sql) => sqlStatements(generatedBlock(sql)));
      expect(generated.sort()).toEqual(sqlStatements(fresh).sort());
    },
    60_000,
  );
});
