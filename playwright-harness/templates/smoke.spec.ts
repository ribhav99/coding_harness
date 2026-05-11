import { test, expect } from '@playwright/test';

/**
 * Bootstrap smoke test (coding-harness BLUEPRINT.md §12).
 *
 * Confirms `make dev` boots the app on http://localhost:3000/ and the root
 * page renders. If this passes after bootstrap, the project's Playwright
 * wiring is correct end-to-end.
 *
 * Delete or evolve this spec as the project grows real tests — its only
 * job is to fail loudly when the harness contract is broken (wrong port,
 * server not boot, baseURL drift).
 */
test('root page responds', async ({ page }) => {
  const response = await page.goto('/');
  expect(response, 'page.goto returned null — server unreachable').not.toBeNull();
  expect(response!.ok(), `unexpected status ${response!.status()} from /`).toBeTruthy();
});
