/**
 * Isolated test database for F05 concurrency tests (human approval 2026-11-26, section 7).
 *
 * SAFETY:
 * - Connects as the runtime role restaurant_app, using the DATABASE_URL credentials from backend/.env with
 *   the database name replaced by restaurant_test (read into memory; never printed).
 * - Refuses to run unless current_user = restaurant_app AND current_database() = restaurant_test, so these
 *   tests can never write to restaurant_dev or any other database.
 * - The tests COMMIT their own throw-away rows (unique example.test emails). The runtime role cannot DELETE
 *   users or tokens (S6), so rows accumulate; the human may recreate restaurant_test at any time.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { runtimeUrl } from '../db/db-helpers.ts';

export const ISOLATED_DATABASE = 'restaurant_test';

export function isolatedUrl(): string {
  const url = new URL(runtimeUrl());
  url.pathname = `/${ISOLATED_DATABASE}`;
  return url.toString();
}

export async function connectIsolated(): Promise<PrismaClient> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: isolatedUrl(),
      application_name: 'f05-isolated-concurrency',
      max: 12,
      connectionTimeoutMillis: 5_000,
    }),
  });
  let who: { role: string; db: string }[];
  try {
    who = await prisma.$queryRaw<
      { role: string; db: string }[]
    >`SELECT current_user::text AS role, current_database() AS db`;
  } catch {
    await prisma.$disconnect();
    // Never echo the driver error: it may contain connection details.
    throw new Error(
      `Cannot connect to ${ISOLATED_DATABASE} as restaurant_app. Was the test database created (F05 human gate)?`,
    );
  }
  if (who[0]?.role !== 'restaurant_app' || who[0].db !== ISOLATED_DATABASE) {
    await prisma.$disconnect();
    throw new Error(`Refusing to run: not connected as restaurant_app to ${ISOLATED_DATABASE}`);
  }
  return prisma;
}
