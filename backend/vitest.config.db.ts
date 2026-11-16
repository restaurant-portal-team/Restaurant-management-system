import { defineConfig } from 'vitest/config';

/**
 * Real-database behavioral suite (F02 Gate C). Run explicitly with `npm run test:db`.
 * Not part of `npm test` / `npm run test:e2e`. Requires backend/.env (restaurant_app runtime credentials).
 * All writes are rolled back.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/db/**/*.db-spec.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test' },
  },
});
