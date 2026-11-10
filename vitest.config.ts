import { defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Workspace packages resolve to TypeScript sources in tests (no build step needed).
const conditions = ['@mediverify/source', ...defaultServerConditions];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    // Integration files share one test database; run files sequentially for deterministic job claims.
    fileParallelism: false,
    // `pnpm test:coverage` (unit + integration). Thresholds sit a little under the measured numbers so
    // coverage can't silently erode; raise them as tests are added.
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**', 'apps/*/src/**'],
      exclude: ['**/*.d.ts', 'apps/web/src/main.tsx', 'apps/*/src/main.ts'],
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      thresholds: { statements: 55, branches: 74, functions: 70, lines: 55 },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: [
            'packages/*/test/**/*.test.ts',
            'apps/*/test/**/*.test.ts',
            'tests/unit/**/*.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['tests/helpers/global-setup.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
