import { defineConfig, devices } from '@playwright/test';

/**
 * Pinned-convention Playwright config (coding-harness BLUEPRINT.md §12).
 *
 * Copied verbatim into a project at bootstrap. Do not edit `baseURL` or
 * `testDir` here — those are the bundled-harness conventions:
 *
 *   - App listens on http://localhost:3000/
 *   - Specs live in tests/e2e/*.spec.ts
 *
 * The dev server is booted externally by playwright-harness/with_server.py
 * before this config is used; do NOT add a `webServer` block here, or the
 * server will be booted twice and ports will clash.
 *
 * Workers are pinned to 1 because the shared dev server cannot safely
 * handle concurrent test traffic without per-test isolation that we don't
 * enforce. If a project genuinely supports concurrent e2e runs, raise this
 * locally (and add the test-isolation primitives that make it safe).
 */
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
