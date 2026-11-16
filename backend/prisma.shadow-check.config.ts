/**
 * SHADOW-ONLY Prisma CLI configuration for migration dry runs (F02 Gate A, human-approved 2026-11-16).
 *
 * Used exclusively by:  npm run db:migrate:check-shadow
 *   = db:assert-isolation (LEVEL 2 live identity preflight)
 *     + prisma migrate diff --config prisma.shadow-check.config.ts
 *         --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
 *
 * Guarantees:
 * - The datasource contains ONLY shadowDatabaseUrl. No main database URL (restaurant_dev) is given to Prisma,
 *   so the dry run cannot connect to, reset or migrate restaurant_dev.
 * - No fallback: schema.prisma declares no url/env(), Prisma 7 does not auto-load .env files, and this file
 *   never reads DATABASE_URL. MIGRATION_DATABASE_URL is read into memory ONLY for the static isolation
 *   comparison below and is never passed to Prisma.
 * - Fails closed if SHADOW_DATABASE_URL is missing or resolves to the migration database (LEVEL 1 guard).
 *
 * Prisma wipes and re-creates objects in the shadow database during the dry run (expected; it holds no data).
 */
import { defineConfig } from 'prisma/config';
import { assertShadowIsolatedStatic } from './scripts/db/destination.ts';
import { loadMigrationEnv } from './scripts/db/migration-env.ts';

const { migrationUrl, shadowUrl } = loadMigrationEnv();

if (shadowUrl === undefined) {
  throw new Error('SHADOW_DATABASE_URL is required for the shadow dry run (backend/.env.migrate).');
}

assertShadowIsolatedStatic(migrationUrl, shadowUrl);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    shadowDatabaseUrl: shadowUrl,
  },
});
