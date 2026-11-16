/**
 * npm run db:assert-isolation [-- --self-test]
 *
 * LEVEL 2 preflight: connects (read-only) with the migration credentials to the main and shadow
 * databases and refuses if they are the same database. Runs automatically before db:migrate:*.
 *
 * --self-test: uses MIGRATION_DATABASE_URL for BOTH sides; the guard is expected to REFUSE.
 *
 * Output contains only database names, role names and status words — never URLs or passwords.
 */
import { assertShadowIsolatedStatic, UnsafeDatabaseConfigError } from './destination.ts';
import { fetchIdentity, isSameDatabase } from './identity.ts';
import { loadMigrationEnv } from './migration-env.ts';
import { describeCode, safeErrorCode } from './safe-error.ts';

function fail(message: string): never {
  console.error(`[db:assert-isolation] FAIL: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const selfTest = process.argv.includes('--self-test');
  const { migrationUrl, shadowUrl, source } = loadMigrationEnv();

  if (migrationUrl === undefined || shadowUrl === undefined) {
    fail(
      'MIGRATION_DATABASE_URL and SHADOW_DATABASE_URL must both be set (backend/.env.migrate).',
    );
  }

  try {
    assertShadowIsolatedStatic(migrationUrl, shadowUrl);
  } catch (error: unknown) {
    fail(error instanceof UnsafeDatabaseConfigError ? error.message : 'static check failed');
  }

  const secondUrl = selfTest ? migrationUrl : shadowUrl;

  let primary;
  let second;
  try {
    primary = await fetchIdentity(migrationUrl);
  } catch (error: unknown) {
    const code = safeErrorCode(error);
    fail(`cannot connect to the migration database [${code}: ${describeCode(code)}]`);
  }
  try {
    second = await fetchIdentity(secondUrl);
  } catch (error: unknown) {
    const code = safeErrorCode(error);
    fail(`cannot connect to the shadow database [${code}: ${describeCode(code)}]`);
  }

  const same = isSameDatabase(primary, second);

  if (selfTest) {
    if (same) {
      console.log(
        '[db:assert-isolation] SELF-TEST PASS: identical destinations were detected and would be refused.',
      );
      return;
    }
    fail('SELF-TEST did not detect identical destinations.');
  }

  if (same) {
    fail(
      `shadow database resolves to the SAME database as the migration database ("${primary.database}"). Refusing.`,
    );
  }

  console.log(
    `[db:assert-isolation] PASS: isolated (source: ${source}). main="${primary.database}" shadow="${second.database}" role="${primary.role}".`,
  );
}

try {
  await main();
} catch (error: unknown) {
  // Never print the raw error: URL parsing and driver errors can echo connection strings.
  console.error(`[db:assert-isolation] FAIL: unexpected error [${safeErrorCode(error)}]`);
  process.exit(1);
}
