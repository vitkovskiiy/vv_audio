import { defineConfig } from '@playwright/test';

const PORT = 3123;

/**
 * E2E: the built client + the real server (in-memory storage, static track metadata, no seed),
 * driven through a real Chromium. Two browser contexts = two people on two devices.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // the full Chromium build (no separate headless-shell download)
    channel: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite build && npx tsx server/main.ts',
    url: `http://127.0.0.1:${PORT}/healthz`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { PORT: String(PORT), STORAGE: 'memory', SOURCES: 'static', SEED: '0' },
  },
});
