import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    restoreMocks: true,
    // Dummy, non-secret values: e2e tests never read backend/.env and never touch a database.
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://e2e_user:e2e_dummy@127.0.0.1:5432/e2e_dummy_db',
      CORS_ORIGIN: 'http://localhost:5173',
      THROTTLE_LIMIT: '5',
      THROTTLE_TTL_MS: '60000',
    },
  },
});
