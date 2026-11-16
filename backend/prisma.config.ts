/**
 * Prisma CLI configuration (Prisma 7.10.1).
 *
 * Credential separation:
 * - Prisma CLI (migrate/status/db execute) uses ONLY restaurant_migrator credentials from
 *   backend/.env.migrate (MIGRATION_DATABASE_URL, SHADOW_DATABASE_URL).
 * - The NestJS runtime uses ONLY DATABASE_URL (restaurant_app) from backend/.env via
 *   @prisma/adapter-pg. This file never reads backend/.env or DATABASE_URL.
 *
 * Safety: the LEVEL 1 static shadow-database guard below runs on every Prisma CLI command,
 * including direct `npx prisma ...` calls that bypass the npm-script LEVEL 2 preflight.
 */
import { defineConfig } from 'prisma/config';
import { assertShadowIsolatedStatic } from './scripts/db/destination.ts';
import { loadMigrationEnv } from './scripts/db/migration-env.ts';

const { migrationUrl, shadowUrl } = loadMigrationEnv();

assertShadowIsolatedStatic(migrationUrl, shadowUrl);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    ...(migrationUrl !== undefined && { url: migrationUrl }),
    ...(shadowUrl !== undefined && { shadowDatabaseUrl: shadowUrl }),
  },
});
