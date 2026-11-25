import { defineConfig } from 'vitest/config';

/**
 * F05 concurrency suite on the ISOLATED test database restaurant_test. Run explicitly with
 * `npm run test:db:isolated`. Never runs against restaurant_dev (the helper refuses).
 * Requires backend/.env (restaurant_app credentials) and the human-created restaurant_test database.
 */
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/db-isolated/**/*.db-spec.ts'],
    fileParallelism: false,
    sequence: { concurrent: false },
    restoreMocks: true,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    env: { NODE_ENV: 'test' },
  },
});
