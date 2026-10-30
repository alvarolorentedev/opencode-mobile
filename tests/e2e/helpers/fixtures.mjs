import { test as base, expect } from '@playwright/test';

import { usesCompatibility, workerBackend } from './backend.mjs';

// Every test gets a default backend URL before the app scripts run. This is a
// runtime default only: saved settings still win, and nothing is written to
// localStorage. Compatibility contracts point at that worker's V1 server.
export const test = base.extend({
  e2eBackend: [
    async ({ page }, use, testInfo) => {
      // parallelIndex stays within 0..workers-1 when Playwright restarts a
      // worker; workerIndex keeps growing and would map to a server that does
      // not exist.
      const backend = workerBackend(testInfo.parallelIndex);
      const serverUrl = usesCompatibility(testInfo.title) ? backend.v1 : backend.v2;
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));
      await page.addInitScript((url) => {
        globalThis.__OPENCODE_E2E_SERVER_URL__ = url;
      }, serverUrl);
      await use(backend);
      if (testInfo.status !== testInfo.expectedStatus && pageErrors.length > 0) {
        await testInfo.attach('page-errors', {
          body: pageErrors.join('\n\n'),
          contentType: 'text/plain',
        });
      }
    },
    { auto: true },
  ],
  // The fake server is worker-global. Reset it before every test so a failure
  // or a scenario left behind by one flow cannot change the next flow, and so
  // `--last-failed` is reproducible regardless of which worker runs it.
  resetBackend: [
    async ({ request }, use, testInfo) => {
      const backend = workerBackend(testInfo.parallelIndex);
      const serverUrl = usesCompatibility(testInfo.title) ? backend.v1 : backend.v2;
      const response = await request.post(`${serverUrl}/__control/reset`, {
        data: { scenario: 'happy-path' },
      });
      expect(response.ok()).toBeTruthy();
      await use();
      if (testInfo.status !== testInfo.expectedStatus && testInfo.status !== 'skipped') {
        try {
          const state = await request.get(`${serverUrl}/__control/state`);
          if (state.ok()) {
            await testInfo.attach('fake-server-state', {
              body: await state.text(),
              contentType: 'application/json',
            });
          }
        } catch {
          // A dead server is already visible in the failure; do not mask it.
        }
      }
    },
    { auto: true },
  ],
});

export { expect };
