/**
 * npm run db:verify-roles
 *
 * READ-ONLY verification of the human-created PostgreSQL roles (F01). It runs SELECT queries
 * against catalog views only; it never creates, alters, grants or revokes anything.
 *
 * Reads backend/.env (DATABASE_URL, runtime) and backend/.env.migrate (migration + shadow) into
 * private memory via node:util.parseEnv. Prints only role names, database names, booleans and
 * SQLSTATE codes — never URLs or passwords.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { withClient } from './identity.ts';
import { BACKEND_ROOT, loadMigrationEnv } from './migration-env.ts';
import { describeCode, safeErrorCode } from './safe-error.ts';

interface Check {
  name: string;
  expected: string;
  actual: string;
}

const checks: Check[] = [];

function record(name: string, expected: unknown, actual: unknown): void {
  checks.push({ name, expected: String(expected), actual: String(actual) });
}

interface RoleRow {
  role: string;
  database: string;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  owns_db: boolean;
  db_create: boolean;
  schema_create: boolean;
  schema_usage: boolean;
}

const ROLE_SQL = `
  SELECT current_user::text                                      AS role,
         current_database()                                      AS database,
         r.rolsuper, r.rolcreatedb, r.rolcreaterole,
         pg_get_userbyid(d.datdba) = current_user                AS owns_db,
         has_database_privilege(current_database(), 'CREATE')    AS db_create,
         has_schema_privilege('public', 'CREATE')                AS schema_create,
         has_schema_privilege('public', 'USAGE')                 AS schema_usage
  FROM pg_roles r
  JOIN pg_database d ON d.datname = current_database()
  WHERE r.rolname = current_user`;

const DEFAULT_ACL_SQL = `
  SELECT d.defaclobjtype::text AS objtype, x.privilege_type
  FROM pg_default_acl d
  JOIN pg_namespace n ON n.oid = d.defaclnamespace
  CROSS JOIN LATERAL aclexplode(d.defaclacl) x
  WHERE n.nspname = 'public'
    AND d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = $1)
    AND x.grantee    = (SELECT oid FROM pg_roles WHERE rolname = $2)
  ORDER BY 1, 2`;

async function roleInfo(url: string): Promise<RoleRow> {
  return withClient(url, async (client) => {
    const result = await client.query<RoleRow>(ROLE_SQL);
    const row = result.rows[0];
    if (!row) throw new Error('Role query returned no rows');
    return row;
  });
}

function readRuntimeUrl(): string | undefined {
  const file = resolve(BACKEND_ROOT, '.env');
  if (!existsSync(file)) return undefined;
  const value = parseEnv(readFileSync(file, 'utf8')).DATABASE_URL?.trim();
  return value === '' ? undefined : value;
}

/** Same credentials as the runtime URL, but targeting the shadow database name. */
function runtimeUrlForDatabaseOf(runtimeUrl: string, otherUrl: string): string {
  const target = new URL(runtimeUrl);
  target.pathname = new URL(otherUrl).pathname;
  return target.toString();
}

async function main(): Promise<void> {
  const runtimeUrl = readRuntimeUrl();
  const { migrationUrl, shadowUrl } = loadMigrationEnv();

  if (!runtimeUrl || !migrationUrl || !shadowUrl) {
    console.error(
      '[db:verify-roles] FAIL: DATABASE_URL (backend/.env) and MIGRATION_DATABASE_URL + SHADOW_DATABASE_URL (backend/.env.migrate) are required.',
    );
    process.exit(1);
  }

  const connect = async (label: string, url: string): Promise<RoleRow | null> => {
    try {
      return await roleInfo(url);
    } catch (error: unknown) {
      const code = safeErrorCode(error);
      record(`${label}: connect`, 'connected', `error ${code} (${describeCode(code)})`);
      return null;
    }
  };

  // Runtime role on the main database.
  const app = await connect('runtime -> main db', runtimeUrl);
  if (app) {
    record('runtime -> main db: connect', 'connected', 'connected');
    record('runtime: role name', 'restaurant_app', app.role);
    record('runtime: rolsuper', false, app.rolsuper);
    record('runtime: rolcreatedb', false, app.rolcreatedb);
    record('runtime: rolcreaterole', false, app.rolcreaterole);
    record('runtime: owns database', false, app.owns_db);
    record('runtime: CREATE on database', false, app.db_create);
    record('runtime: CREATE on schema public', false, app.schema_create);
    record('runtime: USAGE on schema public', true, app.schema_usage);
  }

  // Runtime role must NOT be able to connect to the shadow database.
  try {
    await roleInfo(runtimeUrlForDatabaseOf(runtimeUrl, shadowUrl));
    record('runtime -> shadow db: connect', 'denied (42501)', 'CONNECTED (unexpected)');
  } catch (error: unknown) {
    const code = safeErrorCode(error);
    record('runtime -> shadow db: connect', 'denied (42501)', `denied (${code})`);
  }

  // Migration role on main and shadow databases.
  const migrator = await connect('migrator -> main db', migrationUrl);
  if (migrator) {
    record('migrator -> main db: connect', 'connected', 'connected');
    record('migrator: role name', 'restaurant_migrator', migrator.role);
    record('migrator: rolsuper', false, migrator.rolsuper);
    record('migrator: rolcreatedb', false, migrator.rolcreatedb);
    record('migrator: rolcreaterole', false, migrator.rolcreaterole);
    record('migrator: owns main database', true, migrator.owns_db);
    record('migrator: CREATE on schema public (main)', true, migrator.schema_create);
  }

  const shadow = await connect('migrator -> shadow db', shadowUrl);
  if (shadow) {
    record('migrator -> shadow db: connect', 'connected', 'connected');
    record('migrator: shadow database name', 'restaurant-dev-shadow', shadow.database);
    record('migrator: owns shadow database', true, shadow.owns_db);
    record('migrator: CREATE on schema public (shadow)', true, shadow.schema_create);
  }

  // Default privileges configured by the human for future migrator-created objects (catalog read).
  if (app && migrator) {
    record('runtime and migrator are different roles', true, app.role !== migrator.role);
    try {
      const acl = await withClient(migrationUrl, (client) =>
        client.query<{ objtype: string; privilege_type: string }>(DEFAULT_ACL_SQL, [
          migrator.role,
          app.role,
        ]),
      );
      const privileges = (type: string): string =>
        acl.rows
          .filter((row) => row.objtype === type)
          .map((row) => row.privilege_type)
          .sort()
          .join(',') || '(none)';
      record('default privileges: tables -> runtime', 'DELETE,INSERT,SELECT,UPDATE', privileges('r'));
      record('default privileges: sequences -> runtime', 'SELECT,USAGE', privileges('S'));
    } catch (error: unknown) {
      record('default privileges: read', 'readable', `error ${safeErrorCode(error)}`);
    }
  }

  let failures = 0;
  console.log('\n[db:verify-roles] Read-only role verification\n');
  for (const check of checks) {
    const ok = check.expected === check.actual;
    if (!ok) failures += 1;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${check.name.padEnd(46)} expected=${check.expected}  actual=${check.actual}`,
    );
  }
  console.log(`\n${checks.length - failures}/${checks.length} checks passed.`);
  process.exit(failures === 0 ? 0 : 1);
}

try {
  await main();
} catch (error: unknown) {
  // Never print the raw error: URL parsing and driver errors can echo connection strings.
  console.error(`[db:verify-roles] FAIL: unexpected error [${safeErrorCode(error)}]`);
  process.exit(1);
}
