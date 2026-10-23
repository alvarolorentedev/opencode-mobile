import { test as base, expect } from '@playwright/test';

import { usesCompatibility, workerBackend } from './backend.mjs';

// Every test gets a default backend URL before the app scripts run. This is a
// runtime default only: saved settings still win, and nothing is written to
// localStorage. Compatibility contracts point at that worker's V1 server.
export const test = base.extend({
  e2eBackend: [
    async ({ page }, use, testInfo) => {
      const backend = workerBackend(testInfo.workerIndex);
      const serverUrl = usesCompatibility(testInfo.title) ? backend.v1 : backend.v2;
      await page.addInitScript((url) => {
        globalThis.__OPENCODE_E2E_SERVER_URL__ = url;
      }, serverUrl);
      await use(backend);
    },
    { auto: true },
  ],
});

export { expect };
