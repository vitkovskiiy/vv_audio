import { defineConfig } from 'vitest/config';

/**
 * Integration tests: a real PostgreSQL 18 in a throwaway Docker container (Testcontainers)
 * and the real Fastify app listening on a real port. Needs Docker running.
 */
export default defineConfig({
  test: {
    include: ['server/test/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['server/test/integration/global-setup.ts'],
    // the container takes a while to pull and start the first time
    hookTimeout: 180_000,
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
