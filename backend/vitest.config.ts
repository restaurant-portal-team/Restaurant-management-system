import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    exclude: ['node_modules', 'dist', 'src/generated'],
    restoreMocks: true,
  },
});
