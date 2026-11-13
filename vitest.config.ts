import { defineConfig } from 'vitest/config';

/**
 * Unit tests: in-memory repositories, no Docker, milliseconds per file — fast enough for Stryker
 * to rerun them for every mutant. Integration tests have their own config (vitest.integration.config.ts).
 */
export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts'],
    exclude: ['server/test/integration/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts'],
      exclude: ['server/test/**', 'server/db/migrations/**'],
      reporter: ['text-summary', 'text', 'html'],
      reportsDirectory: 'coverage',
      // spec.md, критерії 1–2: `npm test` fails below these branch thresholds
      thresholds: {
        'server/services/queue.service.ts': { branches: 100 },
        'server/services/access.ts': { branches: 80 },
        'server/services/idempotency.ts': { branches: 80 },
        'server/services/playback.service.ts': { branches: 80 },
      },
    },
  },
});
